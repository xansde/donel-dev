// t-a1ad1ca2 — the files the owner sends from the phone chat (contract v1.4,
// ~/seazone/_scratch/celular-tailnet/contrato-arquivo.md). The route (celular-v2.ts) writes the bytes to
// `<dir>/chat-arquivos/<id>-<clean name>` before the row (celular-local.ts), and the row is one delivery to the Líder,
// with the path. This module holds what both sides need: the clean name, the readable size, and the 30-day sweep.

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const CHAT_ARQUIVO_DIR = 'chat-arquivos';
/** Up to 15 MB of file (contract v1.4); the body, base64 in JSON, is about 20 MB. */
export const MAX_ARQUIVO_BYTES = 15 * 1024 * 1024;
export const MAX_ARQUIVO_BODY = Math.ceil(MAX_ARQUIVO_BYTES / 3) * 4 + 64 * 1024;
export const MAX_NOME_LIMPO = 80;
/** The file is kept this long. */
export const CHAT_ARQUIVO_KEEP_MS = 30 * 86_400_000;
const SWEEP_EVERY_MS = 6 * 60 * 60_000;
const FALLBACK_NAME = 'arquivo';

/**
 * The name the file is kept under: only ASCII letters, digits, `.`, `-` and `_`, up to 80 characters, never `..` and
 * never starting with a dot (accents dropped, anything else one `_`). Too long, the extension is kept.
 */
export function nomeLimpo(nome: string): string {
  let clean = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
  if (!clean) return FALLBACK_NAME;
  if (clean.length > MAX_NOME_LIMPO) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';
    clean = `${clean.slice(0, MAX_NOME_LIMPO - ext.length).replace(/[._-]+$/, '')}${ext}`;
  }
  return clean;
}

/** `812 B`, `40 KB`, `2,3 MB`. */
export function tamanhoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Deletes the files older than 30 days. */
export function sweepChatArquivos(dir: string, nowMs: number, log: (line: string) => void): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  let removed = 0;
  for (const name of names) {
    const file = join(dir, name);
    try {
      if (nowMs - statSync(file).mtimeMs > CHAT_ARQUIVO_KEEP_MS) {
        unlinkSync(file);
        removed += 1;
      }
    } catch {
      // gone meanwhile
    }
  }
  if (removed) log(`[chat-arquivo] faxina: ${removed} arquivo(s) com mais de 30 dias apagado(s) de ${CHAT_ARQUIVO_DIR}/`);
}

/** The sweep now and every 6 h; the returned function stops it. */
export function startChatArquivoSweep(dir: string, log: (line: string) => void, now: () => number = Date.now): () => void {
  const sweep = (): void => sweepChatArquivos(dir, now(), log);
  sweep();
  const timer = setInterval(sweep, SWEEP_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
