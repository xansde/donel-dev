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

/** The multiplexer that runs on the place. Exits when the app closes its stdin (the ssh fell or the app quit). */
export const MIRROR_MUX_PY = String.raw`
import base64, os, select, subprocess, sys
home = os.path.expanduser('~')
tails = {}
out = sys.stdout.buffer
inbuf = b''
def stop(key):
    proc = tails.pop(key, None)
    if proc:
        try:
            proc.kill(); proc.wait()
        except Exception:
            pass
while True:
    fds = [sys.stdin.fileno()] + [p.stdout.fileno() for p in tails.values()]
    ready, _, _ = select.select(fds, [], [])
    if sys.stdin.fileno() in ready:
        chunk = os.read(sys.stdin.fileno(), 65536)
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
    for key, proc in list(tails.items()):
        if proc.stdout.fileno() in ready:
            data = os.read(proc.stdout.fileno(), 65536)
            if data:
                out.write(b'F ' + key.encode('ascii') + b' ' + str(len(data)).encode('ascii') + b'\n' + data)
                out.flush()
`;

/** The remote command line of the shared ssh: the script travels base64 in argv (no quoting surprises). */
export function mirrorMuxCommand(): string {
  const b64 = Buffer.from(MIRROR_MUX_PY, 'utf8').toString('base64');
  return `python3 -u -c "import base64;exec(base64.b64decode('${b64}'))"`;
}

/** Pure — one frame as the place sends it (for tests and for symmetry with the decoder). */
export function encodeMirrorFrame(key: string, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`F ${key} ${data.length}\n`, 'ascii'), data]);
}

/** Pure — reassembles frames from chunks cut anywhere. */
export class MirrorFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer, onFrame: (key: string, data: Buffer) => void): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) return;
      const header = this.buffer.subarray(0, newline).toString('ascii').split(' ');
      const size = Number(header[2]);
      if (header[0] !== 'F' || header.length !== 3 || !Number.isInteger(size) || size < 0) {
        // Not a frame (a stray line from the place's shell): drop that line and go on.
        this.buffer = this.buffer.subarray(newline + 1);
        continue;
      }
      if (this.buffer.length < newline + 1 + size) return;
      onFrame(header[1]!, this.buffer.subarray(newline + 1, newline + 1 + size));
      this.buffer = this.buffer.subarray(newline + 1 + size);
    }
  }
}

/** What the hub needs of the shared ssh process. */
export interface MirrorChild {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  kill(): void;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
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

  constructor(
    private readonly sshTarget: string,
    private readonly spawnMirror: SpawnMirror,
    private readonly restartDelayMs: number,
  ) {}

  get size(): number {
    return this.follows.size;
  }

  add(follow: MirrorFollow): void {
    this.follows.set(follow.key, follow);
    if (this.ensureChild()) this.send(follow);
  }

  remove(key: string): void {
    if (!this.follows.delete(key)) return;
    this.child?.stdin?.write(`D ${key}\n`);
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
    if (this.restartTimer) return false; // a restart is due: it will ask for every transcript
    this.closed = false;
    const decoder = new MirrorFrameDecoder();
    const child = this.spawnMirror(this.sshTarget);
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      decoder.push(chunk, (key, data) => this.follows.get(key)?.write(data));
    });
    const fell = (): void => {
      if (this.child !== child) return;
      this.child = null;
      if (this.closed || this.follows.size === 0) return;
      // The link fell: again, each transcript from the byte its mirror has.
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (this.closed || this.follows.size === 0) return;
        this.ensureChild(); // a new ssh asks for every transcript itself
      }, this.restartDelayMs);
    };
    child.on('exit', fell);
    child.on('error', fell);
    for (const follow of this.follows.values()) this.send(follow);
    return false;
  }

  private send(follow: MirrorFollow): void {
    this.child?.stdin?.write(`A ${follow.key} ${follow.bytes()} ${Buffer.from(follow.path, 'utf8').toString('base64')}\n`);
  }
}

/** The real shared ssh: one `ssh -T <target> python3 …` with stdin and stdout piped, keepalive like the tab's. */
export function sshMirrorSpawner(sshOptions: readonly string[]): SpawnMirror {
  return (sshTarget) => nodeSpawn('ssh', [...sshOptions, '-T', '--', sshTarget, mirrorMuxCommand()], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
}
