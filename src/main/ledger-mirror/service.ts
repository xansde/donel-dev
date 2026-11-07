// Espelho do Oráculo — the main's side: where the destination is (`<userData>/ledger-espelho.json`, its own file so
// an older channel's config sanitize never drops it), the service key in the app's vault (same mechanism as the
// providers' secrets: `provider-secrets.ts`), the log (`<userData>/ledger-espelho.log`) and the IPC state. The
// destination is pluggable (`MirrorSink`): only `supabase` exists today. Off until the owner configures it.

import { appendFileSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigIoDeps } from '../config-store';
import { decryptVaultEntry, writeVaultEntry, type SafeStorageLike, type VaultIoDeps } from '../accounts/vault';
import type { LedgerDoc } from '../../shared/ledger/contract';
import { isSupabaseUrl, withPlaceMemory, type LedgerMirrorConfigureResult, type LedgerMirrorState, type PlaceInfo, type PlaceInfoOf } from '../../shared/ledger/mirror';
import { createLedgerMirror, type LedgerMirror, type MirrorSink } from './mirror';
import { createSupabaseSink } from './supabase-sink';

export const MIRROR_VAULT_KEY = 'mirror:supabase:service-key';
const LOG_MAX_BYTES = 512 * 1024;

interface MirrorSettings {
  readonly kind: 'supabase';
  readonly enabled: boolean;
  readonly url: string;
  /** How the owner is named in the rows ("Alexandre"); absent = "Dono". */
  readonly ownerName?: string;
}

const MAX_OWNER_NAME_CHARS = 60;

function cleanOwnerName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_OWNER_NAME_CHARS);
  return name || undefined;
}

function parseSettings(text: string | null): MirrorSettings | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<MirrorSettings>;
    if (raw.kind !== 'supabase' || typeof raw.url !== 'string' || !isSupabaseUrl(raw.url)) return null;
    const ownerName = cleanOwnerName(raw.ownerName);
    return { kind: 'supabase', enabled: raw.enabled === true, url: raw.url.trim().replace(/\/+$/, ''), ...(ownerName ? { ownerName } : {}) };
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
  /** The places as the boards say now (role of the card, name of the session). */
  readonly places?: () => PlaceInfoOf;
  /** The current ledger, for the first sync after configuring. */
  readonly loadDoc: () => LedgerDoc | null;
}

export interface LedgerMirrorService {
  changed(doc: LedgerDoc): void;
  state(): LedgerMirrorState;
  configure(url: unknown, key: unknown, ownerName?: unknown): Promise<LedgerMirrorConfigureResult>;
  disable(): void;
  syncNow(): Promise<LedgerMirrorState>;
  dispose(): void;
}

/** `ledger-espelho-nomes.json`: placeId → the last role and name seen. Anything else is dropped. */
function readNames(text: string | null): Map<string, PlaceInfo> {
  const names = new Map<string, PlaceInfo>();
  if (!text) return names;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    for (const [placeId, value] of Object.entries(raw ?? {})) {
      if (!value || typeof value !== 'object') continue;
      const { roleId, name } = value as { roleId?: unknown; name?: unknown };
      const info: PlaceInfo = { ...(typeof roleId === 'string' && roleId ? { roleId } : {}), ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}) };
      if (info.roleId || info.name) names.set(placeId, info);
    }
  } catch {
    // a broken file: start again from what the boards say
  }
  return names;
}

export function createLedgerMirrorService(deps: LedgerMirrorServiceDeps): LedgerMirrorService {
  const settingsPath = join(deps.userDataPath, 'ledger-espelho.json');
  const logPath = join(deps.userDataPath, 'ledger-espelho.log');
  const namesPath = join(deps.userDataPath, 'ledger-espelho-nomes.json');
  let settings = parseSettings(deps.io.readFileText(settingsPath));

  // The names of the places, kept after their session closes (the session registry forgets it): a task keeps
  // saying "Dev · Mindscape de cadeiras" a week later. Its own file, written only here.
  const names = readNames(deps.io.readFileText(namesPath));
  const saveNames = (): void => {
    try {
      const tmp = `${namesPath}.tmp`;
      deps.io.writeFileText(tmp, JSON.stringify(Object.fromEntries(names), null, 2));
      deps.io.renameFile(tmp, namesPath);
    } catch {
      // a name not saved is learned again at the next push
    }
  };
  const places = withPlaceMemory(() => deps.places?.(), names, saveNames);

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

  const mirror: LedgerMirror = createLedgerMirror({ sink: currentSink, places, ownerName: () => settings?.ownerName, log });

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
      ownerName: settings?.ownerName ?? null,
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

  async function configure(url: unknown, key: unknown, ownerName?: unknown): Promise<LedgerMirrorConfigureResult> {
    if (typeof url !== 'string' || !isSupabaseUrl(url)) return { ok: false, reason: 'Endereço inválido: use https://<projeto>.supabase.co.' };
    if (key !== undefined && key !== '') {
      if (typeof key !== 'string' || key.trim().length < 20) return { ok: false, reason: 'Chave inválida.' };
      const vault = deps.vaultPath();
      if (!vault) return { ok: false, reason: 'O cofre do app ainda não abriu.' };
      const written = writeVaultEntry(vault, deps.safeStorage, deps.vaultIo, MIRROR_VAULT_KEY, key.trim());
      if (written.kind !== 'ok') return { ok: false, reason: 'O cofre do Windows não está disponível neste PC.' };
    }
    if (readKey() === null) return { ok: false, reason: 'Falta a chave de serviço do Supabase.' };
    const name = cleanOwnerName(ownerName);
    writeSettings({ kind: 'supabase', enabled: true, url: url.trim().replace(/\/+$/, ''), ...(name ? { ownerName: name } : {}) });
    log(`configurado: ${settings!.url}`);
    await syncAll();
    return { ok: true };
  }

  return {
    changed: (doc) => mirror.changed(doc),
    state,
    configure,
    disable() {
      if (settings) writeSettings({ ...settings, enabled: false });
      log('desligado');
    },
    async syncNow() {
      await syncAll();
      return state();
    },
    dispose: () => mirror.dispose(),
  };
}
