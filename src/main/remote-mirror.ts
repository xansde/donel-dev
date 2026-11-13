// Espelho do transcript, um ssh por lugar remoto (t-9ab0ce2e, 13/11) — the PC reached 89% of RAM with 108 ssh: each
// remote tab had its own `ssh … tail -F <transcript>` next to the tab's own ssh, and on Windows every ssh.exe drags a
// conhost along. Now every transcript of one place goes through ONE ssh, to a small multiplexer on the place
// (python3, which the setup already relies on) that runs one `tail -F` per transcript and frames their bytes.
//
// Wire (both directions are plain bytes on the ssh's stdio):
// - app → place, one command per line: `A <key> <from> <base64 path>` follows a transcript from byte `from` (a path
//   relative to `$HOME`, or absolute); `D <key>` stops following it.
// - place → app: frames `F <key> <n>\n` followed by exactly `n` bytes of that transcript.
// The ssh falling (link lost, place rebooted) is no loss: the hub starts a new one and asks every transcript again
// from the byte its mirror already has, so the mirror is appended to, never rewritten nor repeated.

import { spawn as nodeSpawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * The multiplexer that runs on the place. Exits when the app closes its stdin (the ssh fell or the app quit). The fds
 * a `select` returned are matched against a snapshot taken before it, and the tails are read before the commands are
 * handled: a `D`+`A` in the same chunk can reuse the fd number of the tail it stopped, and reading that new tail would
 * block every other transcript of the place. A tail that ends is reaped and reported (`E`), never spun on.
 */
export const MIRROR_MUX_PY = String.raw`
import base64, os, select, subprocess, sys
home = os.path.expanduser('~')
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
    out.write(kind + b' ' + key.encode('ascii') + b' ' + str(len(data)).encode('ascii') + b'\n' + data)
    out.flush()
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
                path = base64.b64decode(parts[3]).decode('utf-8')
                if not path.startswith('/'):
                    path = os.path.join(home, path)
                tails[parts[1]] = subprocess.Popen(['tail', '-c', '+%d' % (int(parts[2]) + 1), '-F', path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            elif parts[0] == 'D' and len(parts) == 2:
                stop(parts[1])
`;

/** Exit code of the shared ssh when the place has no python3: the hub gives up and the registry uses one tail per tab. */
export const MIRROR_NO_PYTHON_EXIT = 127;

/** The remote command line of the shared ssh: the script travels base64 in argv (no quoting surprises). */
export function mirrorMuxCommand(): string {
  const b64 = Buffer.from(MIRROR_MUX_PY, 'utf8').toString('base64');
  return `command -v python3 >/dev/null 2>&1 || exit ${MIRROR_NO_PYTHON_EXIT}; exec python3 -u -c "import base64;exec(base64.b64decode('${b64}'))"`;
}

/** Pure — one frame as the place sends it: `F` carries bytes, `E` says the tail of that transcript ended. */
export function encodeMirrorFrame(key: string, data: Buffer, kind: 'F' | 'E' = 'F'): Buffer {
  return Buffer.concat([Buffer.from(`${kind} ${key} ${data.length}\n`, 'ascii'), data]);
}

/** Pure — reassembles frames from chunks cut anywhere. */
export class MirrorFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer, onFrame: (key: string, data: Buffer) => void, onEnd: (key: string) => void = () => undefined): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) return;
      const header = this.buffer.subarray(0, newline).toString('ascii').split(' ');
      const size = Number(header[2]);
      if ((header[0] !== 'F' && header[0] !== 'E') || header.length !== 3 || !Number.isInteger(size) || size < 0) {
        // Not a frame (a stray line from the place's shell): drop that line and go on.
        this.buffer = this.buffer.subarray(newline + 1);
        continue;
      }
      if (this.buffer.length < newline + 1 + size) return;
      if (header[0] === 'E') onEnd(header[1]!);
      else onFrame(header[1]!, this.buffer.subarray(newline + 1, newline + 1 + size));
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

/** The shared ssh of one place and the transcripts it follows. */
export class MirrorHub {
  private child: MirrorChild | null = null;
  private readonly follows = new Map<string, MirrorFollow>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** The place has no python3: this hub never spawns again (`onUnavailable` moved its transcripts). */
  private unavailable = false;

  constructor(
    private readonly sshTarget: string,
    private readonly spawnMirror: SpawnMirror,
    private readonly restartDelayMs: number,
    /** Called once when the place has no python3, with the follows it had (the registry falls back to one tail each). */
    private readonly onUnavailable: (follows: readonly MirrorFollow[]) => void = () => undefined,
  ) {}

  get size(): number {
    return this.follows.size;
  }

  get isUnavailable(): boolean {
    return this.unavailable;
  }

  add(follow: MirrorFollow): void {
    this.follows.set(follow.key, follow);
    if (this.ensureChild()) this.send(follow);
  }

  remove(key: string): void {
    if (!this.follows.delete(key)) return;
    this.write(`D ${key}\n`);
    if (this.follows.size === 0) this.close();
  }

  close(): void {
    this.closed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin?.end();
      child.kill();
    }
  }

  /** Starts the shared ssh when there is none; true when it was already running (the caller sends its own line). */
  private ensureChild(): boolean {
    if (this.child) return true;
    if (this.restartTimer || this.unavailable) return false; // a restart is due: it will ask for every transcript
    this.closed = false;
    const decoder = new MirrorFrameDecoder();
    const child = this.spawnMirror(this.sshTarget);
    this.child = child;
    // A write after the ssh died is EPIPE: without a listener it would bring the whole main process down.
    child.stdin?.on('error', () => undefined);
    child.stdout?.on('data', (chunk: Buffer) => {
      // Bytes of an ssh that is not the current one any more are dropped: they were never counted, so the new ssh
      // asks for them again from the byte the mirror has (never written twice).
      if (this.child !== child) return;
      decoder.push(
        chunk,
        (key, data) => this.follows.get(key)?.write(data),
        (key) => this.retry(key, child),
      );
    });
    const fell = (code: number | null): void => {
      if (this.child !== child) return;
      this.child = null;
      if (this.closed || this.follows.size === 0) return;
      if (code === MIRROR_NO_PYTHON_EXIT) {
        this.unavailable = true;
        const moved = [...this.follows.values()];
        this.follows.clear();
        this.onUnavailable(moved);
        return;
      }
      // The link fell: again, each transcript from the byte its mirror has.
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (this.closed || this.follows.size === 0) return;
        this.ensureChild(); // a new ssh asks for every transcript itself
      }, this.restartDelayMs);
    };
    child.on('close', fell);
    child.on('error', () => fell(null));
    for (const follow of this.follows.values()) this.send(follow);
    return false;
  }

  /** The tail of one transcript ended on the place (killed): ask for it again, from the byte its mirror has. */
  private retry(key: string, child: MirrorChild): void {
    setTimeout(() => {
      const follow = this.follows.get(key);
      if (follow && this.child === child) this.send(follow);
    }, this.restartDelayMs);
  }

  private send(follow: MirrorFollow): void {
    this.write(`A ${follow.key} ${follow.bytes()} ${Buffer.from(follow.path, 'utf8').toString('base64')}\n`);
  }

  private write(line: string): void {
    const stdin = this.child?.stdin;
    if (stdin && !stdin.destroyed && stdin.writable) stdin.write(line);
  }
}

/** The real shared ssh: one `ssh -T <target> python3 …` with stdin and stdout piped, keepalive like the tab's. */
export function sshMirrorSpawner(sshOptions: readonly string[]): SpawnMirror {
  return (sshTarget) => nodeSpawn('ssh', [...sshOptions, '-T', '--', sshTarget, mirrorMuxCommand()], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
}
