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
import { cleanPedidoText, createPedidoRouter, createPedidosStore, pedidoCelular, type MobilePedidosPort, type PedidoTarefa } from './pedidos';
import { createTranscriptionJobs, DEFAULT_WHISPER_URL, whisperServerTranscriber } from './transcrever';
import { createPushStore, isPushSubscription, newlyWaiting, pushMessageFor, sendPush, type PushFetch } from './webpush';
import type { LedgerDoc } from '../../shared/ledger/contract';

/** What the phone's server needs, without Electron: the PC's app and the Oráculo's daemon on the VPS both run it. */
export interface CelularCoreDeps {
  readonly userDataDir: string;
  readonly io: ConfigIoDeps;
  /** O ledger V1 (`null` se não abriu) e a pasta das provas copiadas por ele. */
  readonly ledger: () => LedgerService | null;
  readonly provasRoot: string;
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
  readonly deliverToLeader?: () => ((text: string, pedidoId?: string) => Promise<boolean>) | null;
  /** Oráculo na VPS: `true` = the phone talks to the VPS; this server stays down (no double notices). */
  readonly suspended?: () => boolean;
  /** Pedido por áudio: o whisper do PC (ausente = sem transcrição, o celular manda texto). */
  readonly whisperUrl?: string | null;
}

export interface CelularCore extends CelularService {
  state(): CelularState;
  /** Brings the server up or down (enabled, Tailscale address, suspended). */
  reconcile(): Promise<void>;
  setEnabled(enabled: boolean): Promise<CelularState>;
  pair(): Promise<CelularPairResult>;
  revoke(deviceId: string): CelularState;
}

/** What the PC's Preferences call when the Oráculo lives on the VPS: the daemon's phone, through its API. */
export interface CelularRemote {
  getState(): Promise<CelularState>;
  setEnabled(enabled: boolean): Promise<CelularState>;
  pair(): Promise<CelularPairResult>;
  revoke(deviceId: string): Promise<CelularState>;
  linkPedido(pedidoId: string, tarefa: PedidoTarefa): Promise<boolean>;
}

export interface CelularServiceDeps extends CelularCoreDeps {
  readonly ipcMain: IpcMain;
  /** Só a janela principal mexe nisto. */
  readonly isMainSender: (sender: Electron.WebContents) => boolean;
  /** Oráculo na VPS: the daemon's phone (`null` = the ledger lives on this PC). */
  readonly remote?: () => CelularRemote | null;
}

export interface CelularService {
  /** O Oráculo mudou: avisa os celulares inscritos de cada carta que passou a esperar o dono. */
  ledgerChanged(doc: LedgerDoc): void;
  /** O Líder criou uma tarefa a partir de um pedido do dono (`pedidoDoDono` do `tarefa_criar`). */
  linkPedido(pedidoId: string, tarefa: PedidoTarefa): boolean;
  dispose(): Promise<void>;
}

export function createCelularCore(deps: CelularCoreDeps): CelularCore {
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
    transcribe: whisperServerTranscriber({ url: deps.whisperUrl ?? (process.env.DONEL_WHISPER_URL || DEFAULT_WHISPER_URL) }),
  });
  const router = createPedidoRouter({
    store: pedidosStore,
    deliver: (text, pedidoId) => deps.deliverToLeader?.()?.(text, pedidoId) ?? Promise.resolve(false),
    audioPath: (file) => join(audioDir, file),
  });
  const taskState = (taskId: string): string | undefined => {
    try {
      return deps.ledger()?.load().doc.tasks[taskId]?.state;
    } catch {
      return undefined;
    }
  };
  const pedidos: MobilePedidosPort = {
    listar: () => pedidosStore.list(20).map((pedido) => pedidoCelular(pedido, taskState)),
    criar(input) {
      const texto = cleanPedidoText(input.texto);
      if (!texto) return { ok: false, mensagem: 'O pedido está vazio.' };
      if (input.audioId && !audioJobs.has(input.audioId)) return { ok: false, mensagem: 'O áudio deste pedido não está no PC.' };
      try {
        const pedido = router.submit({ requestId: input.pedidoId, texto, ...(input.audioId ? { audio: `${input.audioId}.wav` } : {}) });
        return { ok: true, pedido: pedidoCelular(pedido, taskState) };
      } catch (error) {
        console.error('[donel-dev] pedidos: não gravou:', error);
        return { ok: false, mensagem: 'O PC não conseguiu guardar o pedido. Tente de novo.' };
      }
    },
    transcrever: (wav) => audioJobs.start(wav),
    transcricao: (audioId) => audioJobs.status(audioId),
  };
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
  // Ledger v5, fatia 2: every item of the box "Esperando você", not only the letters to decide.
  let waiting = new Map<string, number>();
  let lastDoc: LedgerDoc | null = null;
  try {
    const doc = deps.ledger()?.load().doc;
    if (doc) {
      lastDoc = doc;
      waiting = newlyWaiting(new Map(), doc, Date.now()).next;
    }
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
      if (!auth.enabled || deps.suspended?.()) {
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

  async function pair(): Promise<CelularPairResult> {
    await reconcile();
    if (!server) return { ok: false, reason: status === 'no-tailscale' ? 'Ligue a Tailscale para parear.' : (error ?? 'Ligue o app do celular primeiro.') };
    const { code, expiresAt } = auth.createPairingCode();
    // Com `tailscale serve` no ar, o celular pareia no endereço https: só nele há avisos (service worker).
    const base = (await readServeHttpsUrl()) ?? server.url;
    const url = `${base}/#parear=${code}`;
    return { ok: true, pairing: { url, qrSvg: qrSvg(url), expiresAt: new Date(expiresAt).toISOString() } };
  }

  if (auth.enabled) void reconcile();
  // A Tailscale pode subir depois do app (ou trocar de endereço): confere de minuto em minuto.
  function warnNewItems(doc: LedgerDoc): void {
    const { fresh, next } = newlyWaiting(waiting, doc, Date.now());
    waiting = next;
    if (!auth.enabled || deps.suspended?.() || fresh.length === 0) return;
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
      for (const item of fresh) {
        void sendPush(subscription, pushMessageFor(item), keys, pushFetch).then((outcome) => {
          if (outcome === 'gone') push.remove(deviceId);
          else if (outcome === 'failed') console.error('[donel-dev] celular: o aviso não saiu para um aparelho.');
        });
      }
    }
  }

  const timer = setInterval(() => {
    if (auth.enabled) void reconcile();
    // Some items of the box are born with time alone (a letter stuck for 30 min, a delivery stopped for a day).
    if (lastDoc) warnNewItems(lastDoc);
  }, 60_000);
  timer.unref?.();

  return {
    state,
    reconcile,
    async setEnabled(enabled) {
      auth.setEnabled(enabled);
      await reconcile();
      return state();
    },
    pair,
    revoke(deviceId) {
      auth.revoke(deviceId);
      push.remove(deviceId);
      return state();
    },
    ledgerChanged(doc) {
      lastDoc = doc;
      warnNewItems(doc);
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

/** The PC's app: the core plus the Preferences' IPC (forwarded to the VPS when the Oráculo lives there). */
export function createCelularService(deps: CelularServiceDeps): CelularService {
  const core = createCelularCore({ ...deps, suspended: () => deps.remote?.() != null });
  const guard = (sender: Electron.WebContents): void => {
    if (!deps.isMainSender(sender)) throw new Error('forbidden');
  };
  deps.ipcMain.handle(CELULAR_CHANNELS.getState, async (event): Promise<CelularState> => {
    guard(event.sender);
    const remote = deps.remote?.();
    if (remote) return remote.getState();
    // A Tailscale pode ter subido ou mudado de endereço desde a última vez.
    await core.reconcile();
    return core.state();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.setEnabled, async (event, enabled: unknown): Promise<CelularState> => {
    guard(event.sender);
    const remote = deps.remote?.();
    return remote ? remote.setEnabled(enabled === true) : core.setEnabled(enabled === true);
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.pair, async (event): Promise<CelularPairResult> => {
    guard(event.sender);
    const remote = deps.remote?.();
    return remote ? remote.pair() : core.pair();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.revoke, async (event, deviceId: unknown): Promise<CelularState> => {
    guard(event.sender);
    const remote = deps.remote?.();
    if (typeof deviceId !== 'string') return remote ? remote.getState() : core.state();
    return remote ? remote.revoke(deviceId) : core.revoke(deviceId);
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.tailnet, async (event): Promise<CelularTailnet> => {
    guard(event.sender);
    return readTailnet();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.firewall, async (event): Promise<CelularFirewallRule> => {
    guard(event.sender);
    return readFirewallRule();
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.allowFirewall, async (event): Promise<CelularAllowFirewallResult> => {
    guard(event.sender);
    return allowFirewallRule();
  });
  return {
    ledgerChanged: (doc) => core.ledgerChanged(doc),
    linkPedido(pedidoId, tarefa) {
      const remote = deps.remote?.();
      if (remote) {
        void remote.linkPedido(pedidoId, tarefa);
        return true;
      }
      return core.linkPedido(pedidoId, tarefa);
    },
    dispose: () => core.dispose(),
  };
}
