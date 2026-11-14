// Espelho do transcript, um ssh por lugar remoto (t-9ab0ce2e, 13/11) — the PC reached 89% of RAM with 108 ssh: each
// remote tab had its own `ssh … tail -F <transcript>` next to the tab's own ssh, and on Windows every ssh.exe drags a
// conhost along. Now every transcript of one place goes through ONE ssh, to a small multiplexer on the place (python3)
// that runs one `tail -F` per transcript and frames their bytes.
//
// Wire (both directions are plain bytes on the ssh's stdio):
// - the ssh runs a fixed `bash -l -s`; its first stdin line (`mirrorBootLine`) checks python3 and execs the
//   multiplexer, given as base64. No part of the script is ever an argument of ssh.exe.
// - app → place, one command per line: `A <key> <from> <base64 path>` follows a transcript from byte `from` (a path
//   relative to `$HOME`, or absolute); `D <key>` stops following it.
// - place → app: `R 0 0` once when up; frames `F <key> <n>\n` + exactly `n` bytes of that transcript; `E <key> 0`
//   when the tail of that transcript ended or could not start.
// The ssh falling (link lost) is no loss: a new one asks every transcript again from the byte its mirror already has,
// so the mirror is appended to, never rewritten nor repeated. A mirror that does not work (no python3, ssh failing,
// the multiplexer crashing) gives up after a few tries, and the registry follows those transcripts with one tail per
// tab, as before: a broken shared mirror never leaves the chat of a whole place stopped.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { RELINK_DELAYS_MS } from './remote-link';

/**
 * The multiplexer that runs on the place. Exits when the app closes its stdin (the ssh fell or the app quit). The fds
 * a `select` returned are matched against a snapshot taken before it, and the tails are read before the commands are
 * handled: a `D`+`A` in the same chunk can reuse the fd number of the tail it stopped, and reading that new tail would
 * block every other transcript of the place. A tail that ends is reaped and reported (`E`), never spun on. Paths are
 * bytes end to end (a folder name in any encoding).
 */
export const MIRROR_MUX_PY = String.raw`
import base64, os, select, subprocess, sys
home = os.fsencode(os.path.expanduser('~'))
tails = {}
out = sys.stdout.buffer
stdin_fd = sys.stdin.fileno()
inbuf = b''
def stop(key):
    proc = tails.pop(key, None)
    if proc:
        try:
            proc.kill(); proc.wait(); proc.stdout.close()
        except Exception:
            pass
def frame(kind, key, data=b''):
    out.write(kind + b' ' + key.encode('ascii', 'replace') + b' ' + str(len(data)).encode('ascii') + b'\n' + data)
    out.flush()
frame(b'R', '0')
while True:
    watched = dict((p.stdout.fileno(), (k, p)) for k, p in tails.items())
    ready, _, _ = select.select([stdin_fd] + list(watched), [], [])
    for fd in ready:
        if fd == stdin_fd or fd not in watched:
            continue
        key, proc = watched[fd]
        if tails.get(key) is not proc:
            continue
        data = os.read(fd, 65536)
        if data:
            frame(b'F', key, data)
        else:
            stop(key)
            frame(b'E', key)
    if stdin_fd in ready:
        chunk = os.read(stdin_fd, 65536)
        if not chunk:
            for key in list(tails):
                stop(key)
            break
        inbuf += chunk
        while b'\n' in inbuf:
            line, inbuf = inbuf.split(b'\n', 1)
            parts = line.decode('ascii', 'replace').split(' ')
            if parts[0] == 'A' and len(parts) == 4:
                stop(parts[1])
                try:
                    path = base64.b64decode(parts[3])
                    if not path.startswith(b'/'):
                        path = os.path.join(home, path)
                    tails[parts[1]] = subprocess.Popen([b'tail', b'-c', b'+%d' % (int(parts[2]) + 1), b'-F', path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                except Exception:
                    frame(b'E', parts[1])
            elif parts[0] == 'D' and len(parts) == 2:
                stop(parts[1])
`;

/** Exit code of the shared ssh when the place has no python3: no retry, straight to one tail per tab. */
export const MIRROR_NO_PYTHON_EXIT = 127;
/** Tries of the shared ssh in a row without it working: then one tail per tab for this place. */
export const MIRROR_MAX_FAILURES = 3;

/**
 * Pure — the argv of the shared ssh. The remote command is a fixed `bash -l -s` (as every setup script): the
 * multiplexer goes on stdin (`mirrorBootLine`), never as an argument, so no quote of it crosses ssh.exe's argv.
 */
export function mirrorSshArgs(sshOptions: readonly string[], sshTarget: string): string[] {
  return [...sshOptions, '-T', '--', sshTarget, 'bash -l -s'];
}

/**
 * Pure — the one line `bash -s` reads from stdin: it checks python3 and execs the multiplexer, given as base64 (only
 * `[A-Za-z0-9+/=]`). `bash -s` reads a pipe one byte at a time, so every line after this one reaches python's stdin.
 */
export function mirrorBootLine(): string {
  const b64 = Buffer.from(MIRROR_MUX_PY, 'utf8').toString('base64');
  return `command -v python3 >/dev/null 2>&1 || exit ${MIRROR_NO_PYTHON_EXIT}; exec python3 -u -c "$(printf %s ${b64} | base64 -d)"\n`;
}

/** Pure — one frame as the place sends it: `F` bytes, `E` the tail of that transcript ended, `R` the multiplexer is up. */
export function encodeMirrorFrame(key: string, data: Buffer, kind: 'F' | 'E' | 'R' = 'F'): Buffer {
  return Buffer.concat([Buffer.from(`${kind} ${key} ${data.length}\n`, 'ascii'), data]);
}

export interface MirrorFrameHandlers {
  frame(key: string, data: Buffer): void;
  ended(key: string): void;
  ready(): void;
}

/** Pure — reassembles frames from chunks cut anywhere. */
export class MirrorFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer, on: MirrorFrameHandlers): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) return;
      const header = this.buffer.subarray(0, newline).toString('ascii').split(' ');
      const size = Number(header[2]);
      if (!['F', 'E', 'R'].includes(header[0]!) || header.length !== 3 || !Number.isInteger(size) || size < 0) {
        // Not a frame (a stray line from the place's login shell): drop that line and go on.
        this.buffer = this.buffer.subarray(newline + 1);
        continue;
      }
      if (this.buffer.length < newline + 1 + size) return;
      if (header[0] === 'R') on.ready();
      else if (header[0] === 'E') on.ended(header[1]!);
      else on.frame(header[1]!, this.buffer.subarray(newline + 1, newline + 1 + size));
      this.buffer = this.buffer.subarray(newline + 1 + size);
    }
  }
}

/** What the hub needs of the shared ssh process. */
export interface MirrorChild {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  kill(): void;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export type SpawnMirror = (sshTarget: string) => MirrorChild;

/** One transcript followed through the shared ssh. */
export interface MirrorFollow {
  readonly key: string;
  /** Relative to `$HOME` or absolute. */
  readonly path: string;
  /** Bytes the local mirror already has: where a new ssh starts again. */
  bytes(): number;
  write(data: Buffer): void;
}

/** How the hub waits (the registry's defaults; the tests pass small ones). */
export interface MirrorHubTiming {
  /** No `R` from the place in this long after the spawn: that try failed. */
  readonly startupTimeoutMs: number;
  /** Waits before each new try, by tries in a row (the last one repeats): as the tab's own relink. */
  readonly backoffMs: readonly number[];
}

export const DEFAULT_MIRROR_TIMING: MirrorHubTiming = { startupTimeoutMs: 20_000, backoffMs: RELINK_DELAYS_MS };

/**
 * The shared ssh of one place and the transcripts it follows. A try that ends without a single transcript byte (it
 * did not come up in time, exited, failed to spawn, crashed right after `R`) is a failure; `MIRROR_MAX_FAILURES` in a
 * row, or no python3 at once, and the hub gives up for good (`onGiveUp`, with the reason): the registry then follows
 * those transcripts with one tail per tab. The first transcript byte zeroes the count: a working mirror whose link
 * drops just tries again, with the backoff.
 */
export class MirrorHub {
  private child: MirrorChild | null = null;
  private readonly follows = new Map<string, MirrorFollow>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private gaveUp = false;
  private failures = 0;
  /** Tries of each transcript whose tail ended on the place, for its backoff. */
  private readonly endedTries = new Map<string, number>();

  constructor(
    private readonly sshTarget: string,
    private readonly spawnMirror: SpawnMirror,
    private readonly timing: MirrorHubTiming,
    private readonly onGiveUp: (follows: readonly MirrorFollow[], reason: string) => void = () => undefined,
  ) {}

  get size(): number {
    return this.follows.size;
  }

  get isUnavailable(): boolean {
    return this.gaveUp;
  }

  add(follow: MirrorFollow): void {
    this.follows.set(follow.key, follow);
    if (this.ensureChild()) this.send(follow);
  }

  remove(key: string): void {
    if (!this.follows.delete(key)) return;
    this.endedTries.delete(key);
    this.write(`D ${key}\n`);
    if (this.follows.size === 0) this.close();
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin?.end();
      child.kill();
    }
  }

  private clearTimers(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.restartTimer = null;
    this.startupTimer = null;
  }

  private delay(tries: number): number {
    const list = this.timing.backoffMs;
    return list[Math.min(Math.max(tries, 1), list.length) - 1] ?? 0;
  }

  private giveUp(reason: string): void {
    if (this.gaveUp) return;
    this.gaveUp = true;
    this.close();
    const moved = [...this.follows.values()];
    this.follows.clear();
    this.onGiveUp(moved, reason);
  }

  /** Starts the shared ssh when there is none; true when it was already running (the caller sends its own line). */
  private ensureChild(): boolean {
    if (this.child) return true;
    if (this.restartTimer || this.gaveUp) return false; // a retry is due: it asks for every transcript
    this.closed = false;
    let worked = false; // a transcript byte came through this try
    let child: MirrorChild;
    try {
      child = this.spawnMirror(this.sshTarget);
    } catch (error) {
      this.failed(null, `não consegui abrir o ssh (${error instanceof Error ? error.message : String(error)})`, false);
      return false;
    }
    this.child = child;
    const decoder = new MirrorFrameDecoder();
    // A write after the ssh died is EPIPE: without a listener it would bring the whole main process down.
    child.stdin?.on('error', () => undefined);
    child.stdout?.on('data', (chunk: Buffer) => {
      // Bytes of an ssh that is not the current one are dropped: never counted, so the next one asks for them again.
      if (this.child !== child) return;
      decoder.push(chunk, {
        frame: (key, data) => {
          if (!worked) {
            worked = true;
            this.failures = 0;
          }
          this.endedTries.delete(key);
          this.follows.get(key)?.write(data);
        },
        ended: (key) => this.retry(key, child),
        ready: () => {
          if (this.startupTimer) clearTimeout(this.startupTimer);
          this.startupTimer = null;
        },
      });
    });
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      if (this.child !== child) return;
      // Did not come up: this try counts as a failure (its own `close` is ignored, the child is not current any more).
      this.child = null;
      child.stdin?.end();
      child.kill();
      this.failed(null, `não subiu em ${Math.round(this.timing.startupTimeoutMs / 1000)} s`, worked);
    }, this.timing.startupTimeoutMs);
    const fell = (code: number | null, why?: string): void => {
      if (this.child !== child) return;
      this.child = null;
      if (this.startupTimer) clearTimeout(this.startupTimer);
      this.startupTimer = null;
      this.failed(code, why ?? `saiu com código ${code ?? 'nenhum'}`, worked);
    };
    child.on('close', (code) => fell(code));
    child.on('error', (error) => fell(null, `o ssh falhou (${error.message})`));
    // The multiplexer itself goes first, on stdin (`bash -l -s` runs this line), then every transcript.
    this.write(mirrorBootLine());
    for (const follow of this.follows.values()) this.send(follow);
    return false;
  }

  /** One try ended. `worked`: it carried transcript bytes (a dropped link, not a broken mirror). */
  private failed(code: number | null, reason: string, worked: boolean): void {
    if (this.closed || this.follows.size === 0) return;
    if (code === MIRROR_NO_PYTHON_EXIT) return this.giveUp('o lugar não tem python3');
    this.failures = worked ? 1 : this.failures + 1;
    if (!worked && this.failures >= MIRROR_MAX_FAILURES) return this.giveUp(`${this.failures} tentativas seguidas sem funcionar; a última: ${reason}`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.closed || this.follows.size === 0) return;
      this.ensureChild(); // a new ssh asks for every transcript itself
    }, this.delay(this.failures));
  }

  /** The tail of one transcript ended on the place (killed, or could not start): ask for it again, with its backoff. */
  private retry(key: string, child: MirrorChild): void {
    const tries = (this.endedTries.get(key) ?? 0) + 1;
    this.endedTries.set(key, tries);
    setTimeout(() => {
      const follow = this.follows.get(key);
      if (follow && this.child === child) this.send(follow);
    }, this.delay(tries));
  }

  private send(follow: MirrorFollow): void {
    this.write(`A ${follow.key} ${follow.bytes()} ${Buffer.from(follow.path, 'utf8').toString('base64')}\n`);
  }

  private write(line: string): void {
    const stdin = this.child?.stdin;
    if (stdin && !stdin.destroyed && stdin.writable) stdin.write(line);
  }
}

/** The real shared ssh: `ssh … bash -l -s` with stdin and stdout piped, keepalive like the tab's. */
export function sshMirrorSpawner(
  sshOptions: readonly string[],
  spawnProcess: (command: string, args: readonly string[], options: { windowsHide: boolean; stdio: ['pipe', 'pipe', 'ignore'] }) => ChildProcess = (command, args, options) =>
    nodeSpawn(command, [...args], options),
): SpawnMirror {
  return (sshTarget) => spawnProcess('ssh', mirrorSshArgs(sshOptions, sshTarget), { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
}
