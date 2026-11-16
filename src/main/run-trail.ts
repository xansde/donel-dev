// Rastro da execução (t-fe46929a, 16/11) — `<userData>/main-running.json` says "this copy of the app is running".
// At 06:10Z of 16/11 the app on the owner's PC was ended from outside (no quit path ran, no Application Error, no
// dump) and opened again, and `main-events.log` had nothing of either: no line at boot and none at the end. The file
// is written at boot, refreshed every minute while the app lives and removed when the app quits on its own path
// (`will-quit`). Found at the next boot, it proves the previous run ended without quitting, with its pid, version
// and the last minute it was seen alive. Like `main-events.log`, it never throws: a full disk must not take the app
// down.

import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export interface RunInfo {
  readonly pid: number;
  readonly version: string;
  /** ISO time the process started. */
  readonly startedAt: string;
  /** ISO time of the last heartbeat (the run was alive at least until then). */
  readonly lastAliveAt: string;
}

export interface RunTrail {
  /** Records this run and returns the previous one when it ended without quitting (else `null`). */
  start(): RunInfo | null;
  /** Moves `lastAliveAt` to now. */
  beat(): void;
  /** The run ends on its own path: the file goes away. */
  end(): void;
}

function isRunInfo(value: unknown): value is RunInfo {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.pid === 'number' && typeof v.version === 'string' && typeof v.startedAt === 'string' && typeof v.lastAliveAt === 'string';
}

export function createRunTrail(
  path: string,
  run: { readonly pid: number; readonly version: string; readonly startedAtMs: number },
  now: () => Date = () => new Date(),
): RunTrail {
  const startedAt = new Date(run.startedAtMs).toISOString();
  let ended = false;

  const write = (): void => {
    if (ended) return;
    try {
      const info: RunInfo = { pid: run.pid, version: run.version, startedAt, lastAliveAt: now().toISOString() };
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(info), 'utf8');
      renameSync(tmp, path);
    } catch (error) {
      console.error('[donel-dev] main-running.json não foi gravado:', error);
    }
  };

  return {
    start() {
      let previous: RunInfo | null = null;
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (isRunInfo(parsed)) previous = parsed;
      } catch {
        // no file (the previous run quit) or unreadable
      }
      write();
      return previous;
    },
    beat: write,
    end() {
      ended = true;
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    },
  };
}
