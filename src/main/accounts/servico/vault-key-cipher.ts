// Serviço da VPS (ADR 0008) — a cifra do cofre fora do Electron. No PC o cofre
// usa `safeStorage` (DPAPI); na VPS não há Electron, então a mesma interface
// (`SafeStorageLike`, vault.ts) é atendida por AES-256-GCM com uma chave de 32
// bytes que mora FORA do repositório e fora do arquivo do cofre:
//
// 1. `$CREDENTIALS_DIRECTORY/donel-vault-key` — o systemd decifra a chave
//    (`LoadCredentialEncrypted=`, cifrada com a chave do host) e a entrega só
//    ao processo do serviço. É o caminho de produção.
// 2. `~/.donel/vault.key` (0600) — fallback para rodar à mão e em teste. Mais
//    fraco: quem lê o home lê a chave. O serviço registra qual dos dois usou.
//
// Nunca degrada para texto plano: sem chave válida, `isEncryptionAvailable()`
// é `false` e o cofre recusa gravar (mesma regra do PC).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SafeStorageLike } from '../vault';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_PREFIX = Buffer.from('dv1:', 'utf8');

/** AES-256-GCM: `dv1:` + iv(12) + tag(16) + texto cifrado. Chave errada ou dado adulterado = `decryptString` lança. */
export function createKeyCipher(key: Buffer | null): SafeStorageLike {
  const usable = key !== null && key.length === KEY_BYTES;
  return {
    isEncryptionAvailable: () => usable,
    encryptString(plainText) {
      if (!usable || !key) throw new Error('vault key unavailable');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      return Buffer.concat([FORMAT_PREFIX, iv, cipher.getAuthTag(), body]);
    },
    decryptString(encrypted) {
      if (!usable || !key) throw new Error('vault key unavailable');
      if (encrypted.length < FORMAT_PREFIX.length + IV_BYTES + TAG_BYTES || !encrypted.subarray(0, FORMAT_PREFIX.length).equals(FORMAT_PREFIX)) {
        throw new Error('vault entry in unknown format');
      }
      const ivStart = FORMAT_PREFIX.length;
      const iv = encrypted.subarray(ivStart, ivStart + IV_BYTES);
      const tag = encrypted.subarray(ivStart + IV_BYTES, ivStart + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted.subarray(ivStart + IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    },
  };
}

export type VaultKeySource = 'systemd-credential' | 'key-file' | 'none';

/** Chave em texto: 64 hex ou 44 base64; qualquer outra coisa é `null`. Nunca ecoa o conteúdo. */
function parseKeyText(text: string): Buffer | null {
  const trimmed = text.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    return decoded.length === KEY_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Acha a chave do cofre. Com `createKeyFileIfMissing`, o fallback cria uma
 * chave nova (0600) quando não há nenhuma — só faz sentido no primeiro uso de
 * um cofre vazio: chave nova num cofre que já tem entradas as torna ilegíveis.
 */
export function loadVaultKey(options: { readonly credentialsDirectory: string | undefined; readonly keyFilePath: string; readonly createKeyFileIfMissing: boolean }): {
  readonly key: Buffer | null;
  readonly source: VaultKeySource;
} {
  if (options.credentialsDirectory) {
    const credentialPath = join(options.credentialsDirectory, 'donel-vault-key');
    if (existsSync(credentialPath)) {
      const key = parseKeyText(readFileSync(credentialPath, 'utf8'));
      return key ? { key, source: 'systemd-credential' } : { key: null, source: 'none' };
    }
  }
  if (existsSync(options.keyFilePath)) {
    const key = parseKeyText(readFileSync(options.keyFilePath, 'utf8'));
    return key ? { key, source: 'key-file' } : { key: null, source: 'none' };
  }
  if (!options.createKeyFileIfMissing) return { key: null, source: 'none' };
  mkdirSync(dirname(options.keyFilePath), { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(options.keyFilePath, key.toString('hex'), { mode: 0o600, flag: 'wx' });
  chmodSync(options.keyFilePath, 0o600);
  return { key, source: 'key-file' };
}
