// t-8406f473 — which sessions were served the `card_*` tools. The gate marks one (an empty file named by its folder sid)
// when its `tools/list` carries them; the board's cron reads the mark and wakes only those (a session with no card_*
// cannot move its card, so waking it only nags). A folder of its own under the board's: never the session's meta.json,
// which holds its keys.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CARD_TOOLS_MARKS = 'com-cartoes';
const SID = /^[0-9a-f-]{8,64}$/i;

/** Marks `sid` in `<boardDir>/com-cartoes/`; once (an existing mark is left alone). */
export function markCardTools(boardDir: string, sid: string): void {
  if (!SID.test(sid)) return;
  const dir = join(boardDir, CARD_TOOLS_MARKS);
  const file = join(dir, sid);
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, '', { mode: 0o600 });
}

/** Whether the gate marked `sid` (served the `card_*`). */
export function hasCardToolsMark(boardDir: string, sid: string): boolean {
  return SID.test(sid) && existsSync(join(boardDir, CARD_TOOLS_MARKS, sid));
}
