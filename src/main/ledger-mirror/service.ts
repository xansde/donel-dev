// Espelho do Oráculo — the main's side: where the destination is (`<userData>/ledger-espelho.json`, its own file so
// an older channel's config sanitize never drops it), the service key in the app's vault (same mechanism as the
// providers' secrets: `provider-secrets.ts`), the log (`<userData>/ledger-espelho.log`) and the IPC state. The
// destination is pluggable (`MirrorSink`): only `supabase` exists today. Off until the owner configures it.

import { appendFileSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigIoDeps } from '../config-store';
import { decryptVaultEntry, writeVaultEntry, type SafeStorageLike, type VaultIoDeps } from '../accounts/vault';
import type { LedgerDoc } from '../../shared/ledger/contract';
import type { PlaceNameOf } from '../../shared/ledger/labels';
import { isSupabaseUrl, type LedgerMirrorConfigureResult, type LedgerMirrorState } from '../../shared/ledger/mirror';
import { createLedgerMirror, type LedgerMirror, type MirrorSink } from './mirror';
import { createSupabaseSink } from './supabase-sink';

export const MIRROR_VAULT_KEY = 'mirror:supabase:service-key';
const LOG_MAX_BYTES = 512 * 1024;

interface MirrorSettings {
  readonly kind: 'supabase';
  readonly enabled: boolean;
  readonly url: string;
}

function parseSettings(text: string | null): MirrorSettings | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<MirrorSettings>;
    if (raw.kind !== 'supabase' || typeof raw.url !== 'string' || !isSupabaseUrl(raw.url)) return null;
    return { kind: 'supabase', enabled: raw.enabled === true, url: raw.url.trim().replace(/\/+$/, '') };
  } catch {
    return null;
  }
}

export interface LedgerMirrorServiceDeps {
  readonly userDataPath: string;
  readonly io: ConfigIoDeps;
  /** `null` while the vault path is not known yet. */
  readonly vaultPath: () => string | null;
  readonly safeStorage: SafeStorageLike;
  readonly vaultIo: VaultIoDeps;
  readonly placeName?: PlaceNameOf;
  /** The current ledger, for the first sync after configuring. */
  readonly loadDoc: () => LedgerDoc | null;
}

export interface LedgerMirrorService {
  changed(doc: LedgerDoc): void;
  state(): LedgerMirrorState;
  configure(url: unknown, key: unknown): Promise<LedgerMirrorConfigureResult>;
  disable(): void;
  syncNow(): Promise<LedgerMirrorState>;
  /** Reads the agent's inbox file, if any (see `takeInbox`). */
  takeInbox(): Promise<void>;
  dispose(): void;
}

export function createLedgerMirrorService(deps: LedgerMirrorServiceDeps): LedgerMirrorService {
  const settingsPath = join(deps.userDataPath, 'ledger-espelho.json');
  const logPath = join(deps.userDataPath, 'ledger-espelho.log');
  let settings = parseSettings(deps.io.readFileText(settingsPath));

  const readKey = (): string | null => {
    const vault = deps.vaultPath();
    return vault ? decryptVaultEntry(vault, deps.safeStorage, deps.vaultIo, MIRROR_VAULT_KEY) : null;
  };

  const log = (line: string): void => {
    try {
      try {
        if (statSync(logPath).size > LOG_MAX_BYTES) renameSync(logPath, `${logPath}.1`);
      } catch {
        // no log yet
      }
      appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
    } catch {
      // the log never stops the mirror
    }
  };

  let sink: MirrorSink | null = null;
  let sinkUrl: string | null = null;
  const currentSink = (): MirrorSink | null => {
    if (!settings?.enabled) return null;
    if (sinkUrl !== settings.url) {
      sink = createSupabaseSink({ url: settings.url, key: readKey });
      sinkUrl = settings.url;
    }
    return sink;
  };

  const mirror: LedgerMirror = createLedgerMirror({ sink: currentSink, placeName: deps.placeName, log });

  const writeSettings = (next: MirrorSettings): void => {
    const tmp = `${settingsPath}.tmp`;
    deps.io.writeFileText(tmp, JSON.stringify(next, null, 2));
    deps.io.renameFile(tmp, settingsPath);
    settings = next;
  };

  const state = (): LedgerMirrorState => {
    const status = mirror.status();
    return {
      enabled: settings?.enabled ?? false,
      url: settings?.url ?? null,
      keyConfigured: readKey() !== null,
      lastSyncAt: status.lastSyncAt === null ? null : new Date(status.lastSyncAt).toISOString(),
      pending: status.pending,
      lastError: status.lastError,
    };
  };

  const syncAll = async (): Promise<void> => {
    const doc = deps.loadDoc();
    if (doc) mirror.changed(doc);
    await mirror.flush();
  };

  async function configure(url: unknown, key: unknown): Promise<LedgerMirrorConfigureResult> {
    if (typeof url !== 'string' || !isSupabaseUrl(url)) return { ok: false, reason: 'Endereço inválido: use https://<projeto>.supabase.co.' };
    if (key !== undefined && key !== '') {
      if (typeof key !== 'string' || key.trim().length < 20) return { ok: false, reason: 'Chave inválida.' };
      const vault = deps.vaultPath();
      if (!vault) return { ok: false, reason: 'O cofre do app ainda não abriu.' };
      const written = writeVaultEntry(vault, deps.safeStorage, deps.vaultIo, MIRROR_VAULT_KEY, key.trim());
      if (written.kind !== 'ok') return { ok: false, reason: 'O cofre do Windows não está disponível neste PC.' };
    }
    if (readKey() === null) return { ok: false, reason: 'Falta a chave de serviço do Supabase.' };
    writeSettings({ kind: 'supabase', enabled: true, url: url.trim().replace(/\/+$/, '') });
    log(`configurado: ${settings!.url}`);
    await syncAll();
    return { ok: true };
  }

  /**
   * An agent configures without the screen: it writes `ledger-espelho-entrada.json` ({ url, key }, straight from the
   * password manager), and the main moves the key into the vault and deletes the file — at start and on "Enviar agora".
   */
  const inboxPath = join(deps.userDataPath, 'ledger-espelho-entrada.json');
  async function takeInbox(): Promise<void> {
    const text = deps.io.readFileText(inboxPath);
    if (text === null) return;
    deps.io.unlinkFile(inboxPath);
    try {
      const raw = JSON.parse(text) as { url?: unknown; key?: unknown };
      const result = await configure(raw.url, raw.key);
      log(result.ok ? 'configurado pela entrada' : `entrada recusada: ${result.reason}`);
    } catch {
      log('entrada recusada: não é JSON');
    }
  }

  return {
    changed: (doc) => mirror.changed(doc),
    state,
    configure,
    takeInbox,
    disable() {
      if (settings) writeSettings({ ...settings, enabled: false });
      log('desligado');
    },
    async syncNow() {
      await takeInbox();
      await syncAll();
      return state();
    },
    dispose: () => mirror.dispose(),
  };
}
