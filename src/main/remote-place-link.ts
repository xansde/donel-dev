// Ligação do lugar — one ssh per remote place for every remote tab there (t-9accc989 item 3, 16/11). On 15/11 the PC
// opened ~320 ssh to the Homologações in 10 min: each remote tab held an `ssh -t -R … run.sh` of its own for as long as
// it lived, and every drop opened them all again. OpenSSH's own multiplexing (ControlMaster) does not exist in the ssh
// of Windows (it passes file descriptors over a unix socket, which Windows cannot), so the multiplexing is the app's:
// the tabs of one place ride ONE `ssh … bash -l -s` running a small python3 multiplexer there, the same pattern as the
// transcript mirror (remote-mirror.ts). Design and rollback: docs/design/ssh-por-lugar.md.
//
// Wire: both directions are frames `<kind> <key> <n>\n` + exactly `n` bytes, on the ssh's stdin/stdout.
// - app → place: `T <ch>` + JSON {cmd, cols, rows, term, ports} opens a terminal channel: the place binds every
//   reverse-tunnel port on 127.0.0.1 (any failure ends the channel with 255, as ssh's ExitOnForwardFailure did), then
//   runs `cmd` in a pty; `I <ch>` input bytes; `W <ch>` "cols rows"; `K <ch>` closes it (SIGHUP, as an ssh dropping);
//   `D <conn>` bytes for a tunnel connection; `H <conn>` the app's side of it reached its end.
// - place → app: `R 0` once when up; `O <ch>` output bytes; `X <ch>` "code" when the channel ended; `C <conn>`
//   "<ch> <port>" a connection arrived on a tunnel port; `D <conn>` its bytes; `H <conn>` the place's side ended.
// The ssh falling ends every channel with 255, exactly as each tab's own ssh dropping did, so the relink supervisor
// (remote-link.ts) and everything after it see no difference. A place where the link does not work (no python3, or
// `maxFailures` tries in a row that never came up) is left out for `retryAfterMs`: its tabs spawn their own ssh, as
// before. `DONEL_SSH_LINK=off` turns the link off for every place.

import { connect as netConnect, type Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import type { MirrorChild, SpawnMirror } from './remote-mirror';

/**
 * The multiplexer that runs on the place. Every fd it writes to (ptys, tunnel sockets) is non-blocking with its own
 * pending bytes, so a terminal or a client that stops reading never stalls the other tabs. It exits when the app
 * closes its stdin (the ssh fell or the app quit), sending SIGHUP to every terminal: the tmux client detaches and the
 * tmux session (with its `claude`) lives on, exactly as when a tab's own ssh dropped.
 */
export const PLACE_LINK_PY = String.raw`
import fcntl, json, os, pty, select, signal, socket, struct, sys, termios
out = sys.stdout.buffer
stdin_fd = sys.stdin.fileno()
chans = {}
conns = {}
lsns = {}
ptys = {}
pend = {}
seq = [0]
def frame(kind, key, data=b''):
    out.write(kind + b' ' + key + b' ' + str(len(data)).encode('ascii') + b'\n' + data)
    out.flush()
def winsize(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    except Exception:
        pass
def drop_conn(cid, tell):
    c = conns.pop(cid, None)
    if not c:
        return
    pend.pop(c['sock'].fileno(), None)
    try:
        c['sock'].close()
    except Exception:
        pass
    if tell:
        frame(b'H', cid)
def code_of(status):
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 255
def end_chan(key, code, hup=True):
    ch = chans.pop(key, None)
    if not ch:
        return
    for s in ch['lsns']:
        lsns.pop(s.fileno(), None)
        try:
            s.close()
        except Exception:
            pass
    for cid in [c for c, v in conns.items() if v['chan'] == key]:
        drop_conn(cid, False)
    fd = ch['fd']
    if fd is not None:
        ptys.pop(fd, None)
        pend.pop(fd, None)
        try:
            os.close(fd)
        except Exception:
            pass
    pid = ch['pid']
    if pid:
        if hup:
            try:
                os.killpg(pid, signal.SIGHUP)
            except Exception:
                pass
        try:
            _, status = os.waitpid(pid, 0)
            if code is None:
                code = code_of(status)
        except Exception:
            pass
    frame(b'X', key, str(255 if code is None else code).encode('ascii'))
def open_chan(key, spec):
    if key in chans:
        end_chan(key, 255)
    ch = {'pid': 0, 'fd': None, 'lsns': [], 'ports': {}}
    chans[key] = ch
    try:
        for port in spec.get('ports', []):
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            ch['lsns'].append(s)
            s.bind(('127.0.0.1', int(port)))
            s.listen(16)
            s.setblocking(False)
            lsns[s.fileno()] = (key, int(port), s)
    except Exception:
        end_chan(key, 255)
        return
    cols, rows = int(spec.get('cols', 80)), int(spec.get('rows', 24))
    try:
        pid, fd = pty.fork()
    except Exception:
        end_chan(key, 255)
        return
    if pid == 0:
        try:
            os.closerange(3, 65536)
            winsize(0, cols, rows)
            os.environ['TERM'] = spec.get('term') or 'xterm-256color'
            os.environ.pop('TMUX', None)
            try:
                os.environ['SSH_TTY'] = os.ttyname(0)
            except Exception:
                pass
            os.execvp('/bin/sh', ['sh', '-c', spec['cmd']])
        finally:
            os._exit(127)
    os.set_inheritable(fd, False)
    os.set_blocking(fd, False)
    ch['pid'] = pid
    ch['fd'] = fd
    ptys[fd] = key
def queue(fd, data):
    if data:
        pend[fd] = pend.get(fd, b'') + data
def handle(kind, key, data):
    if kind == b'T':
        try:
            open_chan(key, json.loads(data.decode('utf-8')))
        except Exception:
            end_chan(key, 255)
    elif kind == b'I':
        ch = chans.get(key)
        if ch and ch['fd'] is not None:
            queue(ch['fd'], data)
    elif kind == b'W':
        ch = chans.get(key)
        if ch and ch['fd'] is not None:
            cols, rows = data.split(b' ')
            winsize(ch['fd'], int(cols), int(rows))
    elif kind == b'K':
        end_chan(key, None)
    elif kind == b'D':
        c = conns.get(key)
        if c:
            queue(c['sock'].fileno(), data)
    elif kind == b'H':
        c = conns.get(key)
        if c:
            if pend.get(c['sock'].fileno()):
                c['eof'] = True
            else:
                try:
                    c['sock'].shutdown(socket.SHUT_WR)
                    c['wdone'] = True
                    if c.get('rdone'):
                        drop_conn(key, False)
                except Exception:
                    drop_conn(key, True)
inbuf = b''
out.write(b'\n')
frame(b'R', b'0')
while True:
    rl = [stdin_fd] + list(ptys) + list(lsns) + [c['sock'].fileno() for c in conns.values() if not c.get('rdone')]
    wl = [fd for fd, data in pend.items() if data]
    ready, writable, _ = select.select(rl, wl, [])
    for fd in writable:
        data = pend.get(fd)
        if not data:
            continue
        try:
            n = os.write(fd, data)
            pend[fd] = data[n:]
        except BlockingIOError:
            continue
        except OSError:
            pend[fd] = b''
            if fd in ptys:
                continue
            for cid, c in list(conns.items()):
                if c['sock'].fileno() == fd:
                    drop_conn(cid, True)
            continue
        if not pend[fd]:
            for cid, c in list(conns.items()):
                if c['sock'].fileno() == fd and c.get('eof'):
                    c['eof'] = False
                    try:
                        c['sock'].shutdown(socket.SHUT_WR)
                        c['wdone'] = True
                        if c.get('rdone'):
                            drop_conn(cid, False)
                    except Exception:
                        drop_conn(cid, True)
    for fd in ready:
        if fd == stdin_fd:
            continue
        if fd in ptys:
            key = ptys[fd]
            try:
                data = os.read(fd, 65536)
            except BlockingIOError:
                continue
            except OSError:
                data = b''
            if data:
                frame(b'O', key, data)
            else:
                end_chan(key, None, False)
        elif fd in lsns:
            key, port, s = lsns[fd]
            try:
                sock, _ = s.accept()
            except Exception:
                continue
            sock.setblocking(False)
            seq[0] += 1
            cid = b'c%d' % seq[0]
            conns[cid] = {'sock': sock, 'chan': key}
            frame(b'C', cid, key + b' ' + str(port).encode('ascii'))
        else:
            for cid, c in list(conns.items()):
                if c['sock'].fileno() != fd:
                    continue
                try:
                    data = c['sock'].recv(65536)
                except BlockingIOError:
                    break
                except OSError:
                    drop_conn(cid, True)
                    break
                if data:
                    frame(b'D', cid, data)
                else:
                    c['rdone'] = True
                    frame(b'H', cid)
                    if c.get('wdone'):
                        drop_conn(cid, False)
                break
    if stdin_fd in ready:
        chunk = os.read(stdin_fd, 65536)
        if not chunk:
            for key in list(chans):
                end_chan(key, None)
            break
        inbuf += chunk
        while True:
            nl = inbuf.find(b'\n')
            if nl < 0:
                break
            head = inbuf[:nl].split(b' ')
            if len(head) != 3 or not head[2].isdigit():
                inbuf = inbuf[nl + 1:]
                continue
            size = int(head[2])
            if len(inbuf) < nl + 1 + size:
                break
            data = inbuf[nl + 1:nl + 1 + size]
            inbuf = inbuf[nl + 1 + size:]
            try:
                handle(head[0], head[1], data)
            except Exception:
                pass
`;

/** Exit code of the link's ssh when the place has no python3: its tabs go back to one ssh each at once. */
export const LINK_NO_PYTHON_EXIT = 127;
/** What a tab's terminal exits with when the link falls: the code of an ssh that dropped (remote-link.ts relinks it). */
export const LINK_LOST_EXIT = 255;
/** The TERM the place's pty gets (the tab's xterm.js speaks it). */
export const LINK_TERM = 'xterm-256color';

/**
 * Pure — the one line `bash -l -s` reads from stdin: it checks python3 and execs the multiplexer, given as base64 (only
 * `[A-Za-z0-9+/=]`). `bash -s` reads a pipe one byte at a time, so every byte after this line reaches python's stdin.
 */
export function linkBootLine(): string {
  const b64 = Buffer.from(PLACE_LINK_PY, 'utf8').toString('base64');
  return `command -v python3 >/dev/null 2>&1 || exit ${LINK_NO_PYTHON_EXIT}; exec python3 -u -c "$(printf %s ${b64} | base64 -d)"\n`;
}

/** Pure — one frame of the wire, either direction. */
export function encodeLinkFrame(kind: string, key: string, data: Buffer | string = Buffer.alloc(0)): Buffer {
  const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return Buffer.concat([Buffer.from(`${kind} ${key} ${body.length}\n`, 'ascii'), body]);
}

const FRAME_KINDS = new Set(['R', 'O', 'X', 'C', 'D', 'H', 'T', 'I', 'W', 'K']);

/** Pure — reassembles frames from chunks cut anywhere; a line that is not a frame (the login shell's) is dropped. */
export class LinkFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer, on: (kind: string, key: string, data: Buffer) => void): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) return;
      const header = this.buffer.subarray(0, newline).toString('ascii').split(' ');
      const size = Number(header[2]);
      if (header.length !== 3 || !FRAME_KINDS.has(header[0]!) || !header[1] || !Number.isInteger(size) || size < 0) {
        this.buffer = this.buffer.subarray(newline + 1);
        continue;
      }
      if (this.buffer.length < newline + 1 + size) return;
      const data = this.buffer.subarray(newline + 1, newline + 1 + size);
      this.buffer = this.buffer.subarray(newline + 1 + size);
      on(header[0]!, header[1]!, data);
    }
  }
}

export interface LinkTunnel {
  readonly remotePort: number;
  readonly localPort: number;
}

export interface LinkTerminalSpec {
  /** The command the place runs in the pty (what the tab's own ssh ran: `remoteAttachCommand`). */
  readonly command: string;
  readonly cols: number;
  readonly rows: number;
  /** Reverse tunnels: 127.0.0.1:remotePort on the place reaches 127.0.0.1:localPort here, while the terminal lives. */
  readonly tunnels: readonly LinkTunnel[];
}

interface Disposable {
  dispose(): void;
}

export interface LinkExit {
  exitCode: number;
  signal?: number;
}

/** What the PtyManager needs of a tab's process: the same surface as node-pty's IPty. */
export interface LinkTerminal {
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (exit: LinkExit) => void): Disposable;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PlaceLinkDeps {
  /** The link's ssh: `ssh … -T -- <target> bash -l -s`, stdin and stdout piped (the mirror's spawner). */
  readonly spawnLink: SpawnMirror;
  /** A login slot of the place (ssh-gate.ts); given back on `R`, on the exit or by the gate's own timer. */
  acquire(sshTarget: string): Promise<() => void>;
  /** A connection to the app's own port (hook bridge, browser MCP). */
  readonly connectLocal?: (port: number) => Socket;
}

export interface PlaceLinkTiming {
  /** No `R` this long after the spawn: that try failed. */
  readonly startupTimeoutMs: number;
  /** The link of a place with no tab left closes after this (a relink right after a close reuses it). */
  readonly idleCloseMs: number;
  /** A place left out (no python3, or `maxFailures`) is tried again after this. */
  readonly retryAfterMs: number;
  /** Tries in a row that never came up before the place is left out. */
  readonly maxFailures: number;
}

export const DEFAULT_LINK_TIMING: PlaceLinkTiming = { startupTimeoutMs: 20_000, idleCloseMs: 30_000, retryAfterMs: 10 * 60_000, maxFailures: 2 };

export type PlaceLinkEvent =
  | { readonly kind: 'up' }
  | { readonly kind: 'fell'; readonly reason: string; readonly tabs: number }
  | { readonly kind: 'left-out'; readonly reason: string };

class LinkChannel implements LinkTerminal {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(exit: LinkExit) => void>();
  private readonly decoder = new StringDecoder('utf8');
  ended = false;

  constructor(
    readonly key: string,
    readonly spec: LinkTerminalSpec,
    private readonly link: PlaceLink,
  ) {}

  onData(listener: (data: string) => void): Disposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (exit: LinkExit) => void): Disposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data: string | Buffer): void {
    if (this.ended) return;
    this.link.send('I', this.key, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  }

  resize(cols: number, rows: number): void {
    if (this.ended || !(cols > 0) || !(rows > 0)) return;
    this.link.send('W', this.key, `${Math.floor(cols)} ${Math.floor(rows)}`);
  }

  /** The tab closes: the place hangs its terminal up (the tmux client detaches). The exit comes once, right after. */
  kill(): void {
    if (this.ended) return;
    this.link.send('K', this.key);
    this.finish({ exitCode: 0, signal: 1 }, true);
  }

  output(data: Buffer): void {
    if (this.ended) return;
    const text = this.decoder.write(data);
    if (text) for (const listener of this.dataListeners) listener(text);
  }

  finish(exit: LinkExit, deferred = false): void {
    if (this.ended) return;
    this.ended = true;
    const tail = this.decoder.end();
    if (tail) for (const listener of this.dataListeners) listener(tail);
    this.link.forget(this);
    // As node-pty: the exit of a killed process arrives after `kill()` returns, never inside it.
    const emit = (): void => {
      for (const listener of this.exitListeners) listener(exit);
    };
    if (deferred) setTimeout(emit, 0);
    else emit();
  }
}

interface LinkConn {
  readonly socket: Socket;
  readonly channel: LinkChannel;
  /** The app's side already told the place it ended. */
  ended: boolean;
}

/** The link of one place: its ssh (started on the first tab, closed a while after the last one goes) and its channels. */
export class PlaceLink {
  private child: MirrorChild | null = null;
  private starting = false;
  private queue: Buffer[] = [];
  private readonly channels = new Map<string, LinkChannel>();
  private readonly conns = new Map<string, LinkConn>();
  private seq = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private leftOutUntil = 0;
  private stopped = false;

  constructor(
    private readonly sshTarget: string,
    private readonly deps: PlaceLinkDeps,
    private readonly timing: PlaceLinkTiming,
    private readonly onEvent: (event: PlaceLinkEvent) => void,
    private readonly now: () => number,
  ) {}

  /** `false` while the place is left out (its tabs use their own ssh) or after `stop`. */
  get available(): boolean {
    return !this.stopped && this.now() >= this.leftOutUntil;
  }

  /** Tabs riding this link now. */
  get size(): number {
    return this.channels.size;
  }

  openTerminal(spec: LinkTerminalSpec): LinkTerminal {
    this.seq += 1;
    const channel = new LinkChannel(`t${this.seq}`, spec, this);
    this.channels.set(channel.key, channel);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const open = { cmd: spec.command, cols: Math.floor(spec.cols), rows: Math.floor(spec.rows), term: LINK_TERM, ports: spec.tunnels.map((tunnel) => tunnel.remotePort) };
    this.send('T', channel.key, JSON.stringify(open));
    this.ensure();
    return channel;
  }

  /** The app quits: the link closes (the place hangs every terminal up; the tmux sessions live on). */
  stop(): void {
    this.stopped = true;
    this.closeLink();
  }

  /** @internal — a frame for the place: written now, or queued until the ssh is spawned. */
  send(kind: string, key: string, data?: Buffer | string): void {
    const frame = encodeLinkFrame(kind, key, data);
    const stdin = this.child?.stdin;
    if (stdin && !stdin.destroyed && stdin.writable) stdin.write(frame);
    else if (!this.child) this.queue.push(frame);
  }

  /** @internal — a channel ended: its tunnel connections go with it; the last one out starts the idle timer. */
  forget(channel: LinkChannel): void {
    if (this.channels.get(channel.key) === channel) this.channels.delete(channel.key);
    for (const [key, conn] of this.conns) {
      if (conn.channel !== channel) continue;
      this.conns.delete(key);
      conn.socket.destroy();
    }
    if (this.channels.size === 0 && (this.child || this.starting) && !this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.channels.size === 0) this.closeLink();
      }, this.timing.idleCloseMs);
    }
  }

  private closeLink(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.queue = [];
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin?.end();
      child.kill();
    }
    for (const conn of this.conns.values()) conn.socket.destroy();
    this.conns.clear();
  }

  private ensure(): void {
    if (this.child || this.starting || this.stopped) return;
    this.starting = true;
    void this.deps.acquire(this.sshTarget).then((release) => {
      this.starting = false;
      // Every tab went (or the app quit) while it waited for a login slot.
      if (this.stopped || this.channels.size === 0) {
        release();
        this.queue = [];
        return;
      }
      this.spawn(release);
    });
  }

  private spawn(release: () => void): void {
    let child: MirrorChild;
    try {
      child = this.deps.spawnLink(this.sshTarget);
    } catch (error) {
      release();
      this.fell(null, false, `não consegui abrir o ssh (${error instanceof Error ? error.message : String(error)})`, false);
      return;
    }
    this.child = child;
    let up = false;
    const startup = setTimeout(() => {
      if (this.child !== child) return;
      this.child = null;
      child.stdin?.end();
      child.kill();
      release();
      this.fell(null, false, `não subiu em ${Math.round(this.timing.startupTimeoutMs / 1000)} s`);
    }, this.timing.startupTimeoutMs);
    const decoder = new LinkFrameDecoder();
    // A write after the ssh died is EPIPE: without a listener it would bring the whole main process down.
    child.stdin?.on('error', () => undefined);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.child !== child) return;
      decoder.push(chunk, (kind, key, data) => {
        if (kind === 'R') {
          if (up) return;
          up = true;
          clearTimeout(startup);
          release();
          this.failures = 0;
          this.onEvent({ kind: 'up' });
          return;
        }
        this.receive(kind, key, data);
      });
    });
    const ended = (code: number | null, why?: string): void => {
      clearTimeout(startup);
      release();
      if (this.child !== child) return;
      this.child = null;
      this.fell(code, up, why ?? `saiu com código ${code ?? 'nenhum'}`);
    };
    child.on('close', (code) => ended(code));
    child.on('error', (error) => ended(null, `o ssh falhou (${error.message})`));
    const queued = this.queue;
    this.queue = [];
    child.stdin?.write(linkBootLine());
    for (const frame of queued) child.stdin?.write(frame);
  }

  /** The ssh ended: every tab on it ends as its own ssh would have (255). A try that never came up counts. */
  private fell(code: number | null, wasUp: boolean, reason: string, mayCount = true): void {
    this.queue = [];
    for (const conn of this.conns.values()) conn.socket.destroy();
    this.conns.clear();
    const tabs = [...this.channels.values()];
    if (this.stopped) return;
    // Only a try that shows the link cannot work on this place counts: no python3, the multiplexer failing (any code
    // but ssh's own 255) or never answering. An ssh that could not connect (255, or no spawn) is the place being
    // down, not the link being broken: its tabs relink as before, on the link again.
    const linkBroken = mayCount && code !== LINK_LOST_EXIT;
    if (!wasUp && linkBroken) {
      this.failures += 1;
      const noPython = code === LINK_NO_PYTHON_EXIT;
      if (noPython || this.failures >= this.timing.maxFailures) {
        this.failures = 0;
        this.leftOutUntil = this.now() + this.timing.retryAfterMs;
        this.onEvent({ kind: 'left-out', reason: noPython ? 'o lugar não tem python3' : reason });
      }
    }
    if (tabs.length > 0 || wasUp) this.onEvent({ kind: 'fell', reason, tabs: tabs.length });
    for (const channel of tabs) channel.finish({ exitCode: LINK_LOST_EXIT });
  }

  private receive(kind: string, key: string, data: Buffer): void {
    switch (kind) {
      case 'O':
        this.channels.get(key)?.output(data);
        return;
      case 'X': {
        const code = Number(data.toString('ascii'));
        this.channels.get(key)?.finish({ exitCode: Number.isInteger(code) ? code : LINK_LOST_EXIT });
        return;
      }
      case 'C':
        this.accept(key, data.toString('ascii'));
        return;
      case 'D':
        this.conns.get(key)?.socket.write(Buffer.from(data));
        return;
      case 'H':
        this.conns.get(key)?.socket.end();
        return;
      default:
    }
  }

  /** A connection arrived on a tunnel port of a channel: it goes to the app's own port for that tunnel. */
  private accept(connKey: string, payload: string): void {
    const [channelKey, port] = payload.split(' ');
    const channel = channelKey ? this.channels.get(channelKey) : undefined;
    const tunnel = channel?.spec.tunnels.find((candidate) => candidate.remotePort === Number(port));
    if (!channel || !tunnel) {
      this.send('H', connKey);
      return;
    }
    const socket = (this.deps.connectLocal ?? connectLocalPort)(tunnel.localPort);
    const conn: LinkConn = { socket, channel, ended: false };
    this.conns.set(connKey, conn);
    const tellEnd = (): void => {
      if (conn.ended) return;
      conn.ended = true;
      if (this.conns.get(connKey) === conn) this.send('H', connKey);
    };
    socket.on('data', (chunk: Buffer) => {
      if (this.conns.get(connKey) === conn) this.send('D', connKey, chunk);
    });
    socket.on('end', tellEnd);
    socket.on('error', () => {
      tellEnd();
      socket.destroy();
    });
    socket.on('close', () => {
      tellEnd();
      if (this.conns.get(connKey) === conn) this.conns.delete(connKey);
    });
  }
}

function connectLocalPort(port: number): Socket {
  return netConnect({ host: '127.0.0.1', port, allowHalfOpen: true });
}

/** The app's links, one per place. `linkFor` is `null` when the tab must spawn its own ssh (off, or place left out). */
export class PlaceLinks {
  private readonly links = new Map<string, PlaceLink>();
  private stopped = false;

  constructor(
    private readonly deps: PlaceLinkDeps,
    private readonly timing: PlaceLinkTiming = DEFAULT_LINK_TIMING,
    private readonly options: {
      readonly enabled?: boolean;
      readonly onEvent?: (sshTarget: string, event: PlaceLinkEvent) => void;
      readonly now?: () => number;
    } = {},
  ) {}

  linkFor(sshTarget: string): PlaceLink | null {
    if (this.options.enabled === false || this.stopped) return null;
    let link = this.links.get(sshTarget);
    if (!link) {
      link = new PlaceLink(sshTarget, this.deps, this.timing, (event) => this.options.onEvent?.(sshTarget, event), this.options.now ?? Date.now);
      this.links.set(sshTarget, link);
    }
    return link.available ? link : null;
  }

  stopAll(): void {
    this.stopped = true;
    for (const link of this.links.values()) link.stop();
  }
}

/** Pure — `DONEL_SSH_LINK=off` (or `0`/`false`/`no`) puts every remote tab back on its own ssh. */
export function placeLinkEnabled(value: string | undefined): boolean {
  return !['off', '0', 'false', 'no'].includes((value ?? '').trim().toLowerCase());
}
