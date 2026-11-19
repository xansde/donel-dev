// Local feature flags (t-7c942870, cadeira Dev rápido: "flag no lugar de staging"). The Donel Dev has no PostHog; a
// flag is a file `~/.donel/flags/<name>` on the machine of the process that reads it: present = on. It is read at
// the moment of use, so turning it on or off needs no deploy nor restart, and turning it off is the way back.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FLAG_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A delivery with the skeptical reviewer's approved verdict in its proof closes alone (t-b559eaec). */
export const SKEPTIC_CLOSES_FLAG = 'cetico-fecha-entrega';

export function localFlagOn(name: string, home: string = homedir()): boolean {
  if (!FLAG_NAME.test(name)) return false;
  try {
    return existsSync(join(home, '.donel', 'flags', name));
  } catch {
    return false;
  }
}
