// 08/11 (Revisor, #333) — when a message from another session clears the terminal box (Esc Esc), what was there is
// kept here first, so the owner can get it back: a draft of his could be in that box after a restart. One file per
// conversation, `<userData>/caixa-limpa/<sessionId>.txt`, appended, owner-only. Never a credential path: the text is
// what the box showed on screen.

import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SAFE_NAME = /^[A-Za-z0-9-]{1,64}$/;
const MAX_TEXT = 20_000;

/** Appends `text` to the file of `sessionId` (or of the PTY, before the first hook); returns the file path. */
export function keepClearedBoxText(dir: string, owner: string, text: string, now: Date = new Date()): string {
  const name = SAFE_NAME.test(owner) ? owner : 'sem-sessao';
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.txt`);
  appendFileSync(file, `--- ${now.toISOString()} · texto que o app apagou da caixa do terminal\n${text.slice(0, MAX_TEXT)}\n\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows: the mode is not enforced; userData is the owner's
  }
  return file;
}
