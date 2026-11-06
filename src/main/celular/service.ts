// Ledger no celular — liga as peças: o arquivo `celular.json` (ligado + celulares pareados), o servidor
// na Tailscale e os canais das Preferências. Desligado por padrão; o dono liga em Preferências → Celular.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import {
  CELULAR_CHANNELS,
  type CelularAllowFirewallResult,
  type CelularFirewallRule,
  type CelularPairResult,
  type CelularState,
  type CelularTailnet,
} from '../../shared/celular';
import type { ConfigIoDeps } from '../config-store';
import { PWA_ASSETS } from './assets';
import { createCelularAuth, type CelularAuth } from './auth';
import { allowFirewallRule, readFirewallRule, readServeHttpsUrl, readTailnet } from './firewall';
import type { CardWriter } from '../ledger-card-writer';
import type { LedgerService } from '../ledger-store';
import { createLedgerMobilePort, type MobileLedgerPort, type PlaceNameOf } from './ledger-port';
import { qrSvg } from './qr';
import { createMobileHandler, MOBILE_PORT, startMobileServer, type MobileServer } from './server';
import { pickTailscaleAddress } from './tailscale';
import { createMobilePedidosPort, createPedidoRouter, createPedidosStore, type MobilePedidosPort, type PedidoTarefa } from './pedidos';
import { createTranscriptionJobs, DEFAULT_WHISPER_URL, whisperServerTranscriber } from './transcrever';
import { createPushStore, isPushSubscription, newlyWaiting, pushMessageFor, sendPush, type PushFetch } from './webpush';
import type { LedgerDoc } from '../../shared/ledger/contract';

export interface CelularServiceDeps {
  readonly ipcMain: IpcMain;
  readonly userDataDir: string;
  readonly io: ConfigIoDeps;
  /** O ledger V1 (`null` se não abriu) e a pasta das provas copiadas por ele. */
  readonly ledger: () => LedgerService | null;
  readonly provasRoot: string;
  /** Só a janela principal mexe nisto. */
  readonly isMainSender: (sender: Electron.WebContents) => boolean;
  /** O nome de um lugar no quadro, para a carta dizer quem fez (nunca o id). */
  readonly placeName?: PlaceNameOf;
  /** Escrever na carta (nasce com a ponte do quadro; `null` antes). */
  readonly cardWriter?: () => CardWriter | null;
  /** Aviso no celular: o POST ao serviço de push (padrão: `fetch` do Node). */
  readonly pushFetch?: PushFetch;
  /**
   * Pedir pelo Oráculo — entrega um texto no chat do Líder único (o motor do `sessao_enviar`); `true` = entrou.
   * Nasce com a ponte do quadro (`null` antes): até lá, o pedido espera na fila.
   */
  readonly deliverToLeader?: () => ((text: string) => Promise<boolean>) | null;
}

export interface CelularService {
  /** O Oráculo mudou: avisa os celulares inscritos de cada carta que passou a esperar o dono. */
  ledgerChanged(doc: LedgerDoc): void;
  /** O Líder criou uma tarefa a partir de um pedido do dono (`pedidoDoDono` do `tarefa_criar`). */
  linkPedido(pedidoId: string, tarefa: PedidoTarefa): boolean;
  dispose(): Promise<void>;
}

export function createCelularService(deps: CelularServiceDeps): CelularService {
  const auth: CelularAuth = createCelularAuth({ filePath: join(deps.userDataDir, 'celular.json'), io: deps.io });
  const ledger: MobileLedgerPort = createLedgerMobilePort(deps.ledger, deps.placeName, deps.cardWriter);
  const push = createPushStore(join(deps.userDataDir, 'celular-push.json'), deps.io);
  const pushFetch: PushFetch = deps.pushFetch ?? ((url, init) => fetch(url, init));
  // Pedir pelo Oráculo: a fila no disco, o áudio numa pasta, a transcrição pelo whisper.cpp local do OpenWhispr.
  const audioDir = join(deps.userDataDir, 'pedidos-audio');
  const pedidosStore = createPedidosStore({ filePath: join(deps.userDataDir, 'pedidos-do-dono.json'), io: deps.io });
  const audioJobs = createTranscriptionJobs({
    dir: audioDir,
    writeFile: (path, bytes) => {
      mkdirSync(audioDir, { recursive: true });
      writeFileSync(path, bytes);
    },
    exists: existsSync,
    transcribe: whisperServerTranscriber({ url: process.env.DONEL_WHISPER_URL || DEFAULT_WHISPER_URL }),
  });
  const router = createPedidoRouter({
    store: pedidosStore,
    deliver: (text) => deps.deliverToLeader?.()?.(text) ?? Promise.resolve(false),
    audioPath: (file) => join(audioDir, file),
  });
  const taskState = (taskId: string): string | undefined => {
    try {
      return deps.ledger()?.load().doc.tasks[taskId]?.state;
    } catch {
      return undefined;
    }
  };
  const pedidos: MobilePedidosPort = createMobilePedidosPort({ store: pedidosStore, router, audio: audioJobs, taskState });
  const handler = createMobileHandler({
    auth,
    ledger: () => ledger,
    assets: PWA_ASSETS,
    provasRoot: deps.provasRoot,
    push: {
      publicKey: () => push.keys().publicKey,
      subscribe: (deviceId, subscription) => {
        if (!isPushSubscription(subscription)) return false;
        push.subscribe(deviceId, subscription);
        return true;
      },
    },
    pedidos,
  });
  // O que já esperava o dono quando o app abriu não avisa de novo; só o que passar a esperar daqui em diante.
  let waiting = new Map<string, number>();
  try {
    const doc = deps.ledger()?.load().doc;
    if (doc) waiting = newlyWaiting(new Map(), doc).next;
  } catch {
    // ledger ilegível: a primeira mudança avisa o que estiver na fila
  }
  // Outra porta só para uma instância de teste ao lado do app aberto (as duas não dividem a 47815).
  const port = Number(process.env.DONEL_CELULAR_PORT) || MOBILE_PORT;
  let server: MobileServer | null = null;
  let status: CelularState['status'] = 'off';
  let error: string | null = null;
  let transition: Promise<void> = Promise.resolve();

  const state = (): CelularState => ({
    enabled: auth.enabled,
    status,
    url: server?.url ?? null,
    error,
    devices: auth.devices(),
  });

  async function stop(): Promise<void> {
    const current = server;
    server = null;
    if (current) await current.close();
  }

  /** Sobe ou desce o servidor conforme `enabled` e o endereço Tailscale de agora. */
  function reconcile(): Promise<void> {
    transition = transition.then(async () => {
      if (!auth.enabled) {
        await stop();
        status = 'off';
        error = null;
        return;
      }
      const host = pickTailscaleAddress(networkInterfaces());
      if (!host) {
        await stop();
        status = 'no-tailscale';
        error = null;
        return;
      }
      if (server && server.url.includes(`//${host}:`)) return; // já no ar no endereço certo
      await stop();
      try {
        server = await startMobileServer({ host, port, handler });
        status = 'listening';
        error = null;
      } catch (cause) {
        server = null;
        status = 'error';
        const code = (cause as NodeJS.ErrnoException | undefined)?.code;
        error = code === 'EADDRINUSE' ? `A porta ${port} já está em uso neste PC.` : 'O servidor do celular não subiu.';
        console.error('[donel-dev] celular: servidor não subiu:', cause);
      }
    });
    return transition;
  }

  deps.ipcMain.handle(CELULAR_CHANNELS.getState, async (event): Promise<CelularState> => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    // A Tailscale pode ter subido ou mudado de endereço desde a última vez.
    if (auth.enabled) await reconcile();
    return state();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.setEnabled, async (event, enabled: unknown): Promise<CelularState> => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    auth.setEnabled(enabled === true);
    await reconcile();
    return state();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.pair, async (event): Promise<CelularPairResult> => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    await reconcile();
    if (!server) return { ok: false, reason: status === 'no-tailscale' ? 'Ligue a Tailscale neste PC para parear.' : (error ?? 'Ligue o app do celular primeiro.') };
    const { code, expiresAt } = auth.createPairingCode();
    // Com `tailscale serve` no ar, o celular pareia no endereço https: só nele há avisos (service worker).
    const base = (await readServeHttpsUrl()) ?? server.url;
    const url = `${base}/#parear=${code}`;
    return { ok: true, pairing: { url, qrSvg: qrSvg(url), expiresAt: new Date(expiresAt).toISOString() } };
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.revoke, (event, deviceId: unknown): CelularState => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    if (typeof deviceId === 'string') {
      auth.revoke(deviceId);
      push.remove(deviceId);
    }
    return state();
  });

  deps.ipcMain.handle(CELULAR_CHANNELS.tailnet, async (event): Promise<CelularTailnet> => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    return readTailnet();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.firewall, async (event): Promise<CelularFirewallRule> => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    return readFirewallRule();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.allowFirewall, async (event): Promise<CelularAllowFirewallResult> => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    return allowFirewallRule();
  });

  if (auth.enabled) void reconcile();
  // A Tailscale pode subir depois do app (ou trocar de endereço): confere de minuto em minuto.
  const timer = setInterval(() => {
    if (auth.enabled) void reconcile();
  }, 60_000);
  timer.unref?.();

  return {
    ledgerChanged(doc) {
      const { fresh, next } = newlyWaiting(waiting, doc);
      waiting = next;
      if (!auth.enabled || fresh.length === 0) return;
      const paired = new Set(auth.devices().map((device) => device.id));
      let keys;
      try {
        keys = push.keys();
      } catch (error) {
        console.error('[donel-dev] celular: sem chave de aviso:', error);
        return;
      }
      for (const { deviceId, subscription } of push.subscriptions()) {
        if (!paired.has(deviceId)) {
          push.remove(deviceId); // aparelho revogado: não recebe mais nada
          continue;
        }
        for (const task of fresh) {
          void sendPush(subscription, pushMessageFor(task), keys, pushFetch).then((outcome) => {
            if (outcome === 'gone') push.remove(deviceId);
            else if (outcome === 'failed') console.error('[donel-dev] celular: o aviso não saiu para um aparelho.');
          });
        }
      }
    },
    linkPedido: (pedidoId, tarefa) => pedidosStore.linkTask(pedidoId, tarefa),
    dispose: async () => {
      clearInterval(timer);
      router.dispose();
      transition = transition.then(stop);
      await transition;
    },
  };
}
