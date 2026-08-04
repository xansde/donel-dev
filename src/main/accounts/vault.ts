// T1107 (011-contas-e-provedores, etapa 1) — cofre de credenciais
// (`<userData>/accounts-vault.json`, data-model.md §2 VaultRecord). Cifra por
// `safeStorage` (Electron), IO e safeStorage INJETÁVEIS (mesmo padrão de
// ConfigIoDeps em config-store.ts). Write-only para fora: nenhum getter aqui
// devolve segredo ao renderer — este módulo só é chamado de dentro de
// src/main/accounts/ (claude-state.ts, mods/*). Se
// `safeStorage.isEncryptionAvailable()` for `false`, o cofre RECUSA gravar —
// nunca degrada para texto plano.

import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface VaultIoDeps {
  existsSync: (path: string) => boolean;
  readFileText: (path: string) => string | null;
  writeFileText: (path: string, content: string) => void;
  renameFile: (fromPath: string, toPath: string) => void;
  mkdirSync: (path: string) => void;
  unlinkFile: (path: string) => void;
}

export function createSystemVaultIoDeps(): VaultIoDeps {
  return {
    existsSync,
    readFileText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeFileText: (path, content) => {
      const fd = openSync(path, 'w');
      try {
        writeSync(fd, content, null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // 0600 onde o SO suportar (POSIX). No-op silencioso no Windows (NTFS
      // não tem esse bit — chmodSync ali é best-effort, nunca lança de forma
      // que derrube a escrita).
      try {
        chmodSync(path, 0o600);
      } catch {
        // best-effort — ver comentário acima.
      }
    },
    renameFile: (fromPath, toPath) => renameSync(fromPath, toPath),
    mkdirSync: (path) => mkdirSync(path, { recursive: true }),
    unlinkFile: (path) => {
      try {
        unlinkSync(path);
      } catch {
        // best-effort.
      }
    },
  };
}

export interface VaultRecord {
  readonly version: 1;
  /** accountId -> par cifrado (base64 do `safeStorage.encryptString`); `seazone:session` guarda o sessionRefreshToken (C11). */
  readonly entries: Readonly<Record<string, string>>;
}

const EMPTY_VAULT: VaultRecord = { version: 1, entries: {} };

/** Nunca lança: ausente/corrompido/tipos errados caem no registro vazio v1 (mesmo espírito de `sanitizeAppConfig`). */
export function readVaultFile(filePath: string, io: VaultIoDeps): VaultRecord {
  const raw = io.readFileText(filePath);
  if (raw === null) return EMPTY_VAULT;

  try {
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_VAULT;
    const rawEntries = parsed.entries;
    if (typeof rawEntries !== 'object' || rawEntries === null || Array.isArray(rawEntries)) return EMPTY_VAULT;

    const entries: Record<string, string> = {};
    for (const [id, value] of Object.entries(rawEntries as Record<string, unknown>)) {
      if (typeof value === 'string') entries[id] = value;
    }
    return { version: 1, entries };
  } catch {
    return EMPTY_VAULT;
  }
}

/** Escrita atômica (temp + rename), mesmo padrão de `writeAppConfig` (config-store.ts). */
function writeVaultFile(filePath: string, record: VaultRecord, io: VaultIoDeps): void {
  const dir = dirname(filePath);
  if (!io.existsSync(dir)) io.mkdirSync(dir);

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  io.writeFileText(tmpPath, JSON.stringify(record, null, 2));
  try {
    io.renameFile(tmpPath, filePath);
  } catch (error) {
    io.unlinkFile(tmpPath);
    throw error;
  }
}

export type VaultWriteResult = { readonly kind: 'ok' } | { readonly kind: 'vault-unavailable' };

/**
 * Interface mínima que os mods (seazone-mod.ts, local-mod.ts) enxergam do
 * cofre — desacopla os mods do path/safeStorage/IO concretos (facilita teste
 * com um fake em memória, ver tests/accountModContract.test.ts). O motor
 * (account-engine.ts) monta o adaptador real sobre `readVaultFile`/
 * `writeVaultEntry`/`decryptVaultEntry` acima.
 */
export interface VaultLike {
  read(id: string): string | null;
  write(id: string, plainText: string): VaultWriteResult;
}

/**
 * Cifra `plainText` com `safeStorage` e persiste na entrada `id`, sem tocar
 * nas demais entradas do arquivo. Recusa gravar (nunca degrada para texto
 * plano) quando `isEncryptionAvailable()` é `false`.
 */
export function writeVaultEntry(filePath: string, safeStorage: SafeStorageLike, io: VaultIoDeps, id: string, plainText: string): VaultWriteResult {
  if (!safeStorage.isEncryptionAvailable()) return { kind: 'vault-unavailable' };

  const current = readVaultFile(filePath, io);
  const encrypted = safeStorage.encryptString(plainText).toString('base64');
  writeVaultFile(filePath, { version: 1, entries: { ...current.entries, [id]: encrypted } }, io);
  return { kind: 'ok' };
}

/**
 * Devolve o texto plano da entrada `id`, ou `null` se ausente ou se a
 * decifragem falhar. NUNCA lança e NUNCA inclui o conteúdo cifrado/decifrado
 * na mensagem de erro (a exceção do `safeStorage` real fica só no console,
 * nunca propagada com o segredo dentro).
 */
export function decryptVaultEntry(filePath: string, safeStorage: SafeStorageLike, io: VaultIoDeps, id: string): string | null {
  const record = readVaultFile(filePath, io);
  const encrypted = record.entries[id];
  if (!encrypted) return null;

  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

/** Remove só a entrada `id`; no-op silencioso se ela não existir. */
export function deleteVaultEntry(filePath: string, io: VaultIoDeps, id: string): void {
  const current = readVaultFile(filePath, io);
  if (!(id in current.entries)) return;
  const entries = { ...current.entries };
  delete entries[id];
  writeVaultFile(filePath, { version: 1, entries }, io);
}
