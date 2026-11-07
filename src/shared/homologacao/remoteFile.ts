// Mindscape de homologação V1 — read one file of a remote place over ssh, read-only. Pure: the main runs the
// script (src/main/homologacao/remote-file-reader.ts). Shared by the factory's numbers (`metricas.json`) and the
// shape of the rigs (`rigs.json`). Tested in tests/factory-metrics-parse.test.ts.

const MARK = 'DONEL_FILE';
/** The files are ~17 KB; past this the read is cut and the parser refuses it. */
const MAX_BYTES = 1024 * 1024;

/** Single-quoted for the shell: the path is the owner's config, but it never runs as code. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The script, sent by stdin to `bash -s`. Only `cat`s the file (through `head -c`): nothing is written. The
 * markers let whatever a login profile prints be ignored and tell a missing file from a cut answer.
 */
export function buildRemoteFileScript(path: string): string {
  return [
    `f=${shellQuote(path)}`,
    `if [ -f "$f" ] && [ -r "$f" ]; then`,
    `  echo '${MARK} begin'; head -c ${MAX_BYTES} -- "$f"; printf '\\n${MARK} end\\n'`,
    `else echo '${MARK} missing'; fi`,
    '',
  ].join('\n');
}

/** `found: false` = the place answered and the file is not there; `null` = no answer (ssh down, timeout, cut). */
export type RemoteFileOutput = { readonly found: true; readonly text: string } | { readonly found: false };

export function parseRemoteFileOutput(stdout: string): RemoteFileOutput | null {
  const begin = `${MARK} begin\n`;
  const at = stdout.startsWith(begin) ? 0 : stdout.indexOf(`\n${begin}`);
  if (at >= 0) {
    const from = (at === 0 && stdout.startsWith(begin) ? 0 : at + 1) + begin.length;
    const end = stdout.lastIndexOf(`\n${MARK} end`);
    // No end marker after the text: the answer was cut, so it is no reading.
    return end >= from - 1 ? { found: true, text: stdout.slice(from, Math.max(from, end)) } : null;
  }
  return stdout.split(/\r?\n/).some((line) => line.trim() === `${MARK} missing`) ? { found: false } : null;
}

/**
 * What the app knows of one remote file. `off` = the config does not ask for it (no ssh goes out); `pending` = no
 * read finished yet; `missing` = the place answered without the file; `unreachable` = no answer. `value` is from
 * the last good read (`lastOkAt`) and stays while the file is missing or the place is down.
 */
export interface RemoteFileState<T> {
  readonly status: 'off' | 'pending' | 'ok' | 'missing' | 'unreachable';
  readonly checkedAt: number | null;
  readonly lastOkAt: number | null;
  readonly value: T | null;
}
