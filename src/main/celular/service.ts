// Ledger no celular — liga as peças: o arquivo `celular.json` (ligado + celulares pareados), o servidor
// na Tailscale e os canais das Preferências. Desligado por padrão; o dono liga em Preferências → Celular.

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
import { allowFirewallRule, readFirewallRule, readTailnet } from './firewall';
import type { LedgerService } from '../ledger-store';
import { createLedgerMobilePort, type MobileLedgerPort, type PlaceNameOf } from './ledger-port';
import { qrSvg } from './qr';
import { createMobileHandler, MOBILE_PORT, startMobileServer, type MobileServer } from './server';
import { pickTailscaleAddress } from './tailscale';

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
}

export interface CelularService {
  dispose(): Promise<void>;
}

export function createCelularService(deps: CelularServiceDeps): CelularService {
  const auth: CelularAuth = createCelularAuth({ filePath: join(deps.userDataDir, 'celular.json'), io: deps.io });
  const ledger: MobileLedgerPort = createLedgerMobilePort(deps.ledger, deps.placeName);
  const handler = createMobileHandler({
    auth,
    ledger: () => ledger,
    assets: PWA_ASSETS,
    provasRoot: deps.provasRoot,
  });
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
        server = await startMobileServer({ host, port: MOBILE_PORT, handler });
        status = 'listening';
        error = null;
      } catch (cause) {
        server = null;
        status = 'error';
        const code = (cause as NodeJS.ErrnoException | undefined)?.code;
        error = code === 'EADDRINUSE' ? `A porta ${MOBILE_PORT} já está em uso neste PC.` : 'O servidor do celular não subiu.';
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
    const url = `${server.url}/#parear=${code}`;
    return { ok: true, pairing: { url, qrSvg: qrSvg(url), expiresAt: new Date(expiresAt).toISOString() } };
  });
  deps.ipcMain.handle(CELULAR_CHANNELS.revoke, (event, deviceId: unknown): CelularState => {
    if (!deps.isMainSender(event.sender)) throw new Error('forbidden');
    if (typeof deviceId === 'string') auth.revoke(deviceId);
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
    dispose: async () => {
      clearInterval(timer);
      transition = transition.then(stop);
      await transition;
    },
  };
}
