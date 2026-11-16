import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeLinkFrame,
  LINK_LOST_EXIT,
  LINK_NO_PYTHON_EXIT,
  LinkFrameDecoder,
  linkBootLine,
  PlaceLinks,
  type LinkTerminal,
  type PlaceLinkTiming,
} from '../src/main/remote-place-link';

// t-9accc989 (3), 16/11 — on 15/11 the PC opened ~320 ssh to the Homologações in 10 min: every remote tab held an ssh
// of its own for as long as it lived, and every drop opened them all again. The tabs of one place now ride ONE ssh (a
// python3 multiplexer on the place, like the transcript mirror): N tabs, one login. The terminal must never lose,
// split or repeat bytes (the chat types through it), a dropped link must read as the ssh dropping (exit 255, so the
// relink supervisor takes over), the hooks and MCP reverse tunnels must still reach the app, and a place where the
// link does not work must give the tabs back their own ssh.

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  killed: boolean;
  kill(): void;
  received: Buffer[];
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.killed = false;
  child.received = [];
  child.kill = () => {
    child.killed = true;
  };
  child.stdin.on('data', (chunk: Buffer) => child.received.push(chunk));
  return child;
}

/** The frames the app sent to a fake place, after the boot line. */
function sentFrames(child: FakeChild): { kind: string; key: string; data: Buffer }[] {
  const all = Buffer.concat(child.received);
  const boot = all.indexOf(0x0a);
  const frames: { kind: string; key: string; data: Buffer }[] = [];
  new LinkFrameDecoder().push(all.subarray(boot + 1), (kind, key, data) => frames.push({ kind, key, data: Buffer.from(data) }));
  return frames;
}

const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const FAST: PlaceLinkTiming = { startupTimeoutMs: 1_000, idleCloseMs: 50, retryAfterMs: 60_000, maxFailures: 2 };
const noGate = async (): Promise<() => void> => () => undefined;

function fakePlaces(timing: PlaceLinkTiming = FAST, connectLocal?: ConstructorParameters<typeof PlaceLinks>[0]['connectLocal']) {
  const spawned: { target: string; child: FakeChild }[] = [];
  const links = new PlaceLinks(
    {
      spawnLink: (target) => {
        const child = fakeChild();
        spawned.push({ target, child });
        return child as never;
      },
      acquire: noGate,
      ...(connectLocal ? { connectLocal } : {}),
    },
    timing,
  );
  return { spawned, links };
}

const up = (child: FakeChild): void => {
  child.stdout.write(encodeLinkFrame('R', '0'));
};

function collect(terminal: LinkTerminal) {
  const seen = { data: '', exits: [] as { exitCode: number; signal?: number }[] };
  terminal.onData((data) => {
    seen.data += data;
  });
  terminal.onExit((exit) => seen.exits.push(exit));
  return seen;
}

const spec = (sid: string, tunnels: { remotePort: number; localPort: number }[] = []) => ({
  command: `bash -l "$HOME/.donel/s/${sid}/run.sh"`,
  cols: 100,
  rows: 30,
  tunnels,
});

let stoppers: Array<() => void> = [];
afterEach(() => {
  for (const stop of stoppers) stop();
  stoppers = [];
});

describe('sessões remotas: uma ligação ssh por lugar, não uma por aba', () => {
  it('cinco abas no mesmo lugar sobem um ssh só; outro lugar sobe o seu', async () => {
    const { spawned, links } = fakePlaces();
    stoppers.push(() => links.stopAll());
    for (let i = 0; i < 5; i += 1) links.linkFor('root@hom')!.openTerminal(spec(`sid-${i}`));
    links.linkFor('xansde@vps')!.openTerminal(spec('sid-x'));
    await tick();
    expect(spawned.map((entry) => entry.target)).toEqual(['root@hom', 'xansde@vps']);
    const hom = spawned[0]!.child;
    expect(Buffer.concat(hom.received).toString('utf8').startsWith(linkBootLine())).toBe(true);
    const opens = sentFrames(hom).filter((frame) => frame.kind === 'T');
    expect(opens).toHaveLength(5);
    expect(JSON.parse(opens[0]!.data.toString('utf8'))).toMatchObject({ cmd: 'bash -l "$HOME/.donel/s/sid-0/run.sh"', cols: 100, rows: 30, ports: [] });
  });

  it('a saída de cada aba chega inteira, na aba certa, mesmo com um caractere cortado entre dois quadros; entrada e tamanho vão em quadros', async () => {
    const { spawned, links } = fakePlaces();
    stoppers.push(() => links.stopAll());
    const link = links.linkFor('root@hom')!;
    const a = link.openTerminal(spec('sid-a'));
    const b = link.openTerminal(spec('sid-b'));
    const seenA = collect(a);
    const seenB = collect(b);
    await tick();
    const child = spawned[0]!.child;
    up(child);
    const [keyA, keyB] = sentFrames(child)
      .filter((frame) => frame.kind === 'T')
      .map((frame) => frame.key);
    const word = Buffer.from('ação ❯ ok', 'utf8');
    child.stdout.write(Buffer.concat([encodeLinkFrame('O', keyA!, word.subarray(0, 3)), encodeLinkFrame('O', keyB!, Buffer.from('B'))]));
    child.stdout.write(encodeLinkFrame('O', keyA!, word.subarray(3)));
    await tick();
    expect(seenA.data).toBe('ação ❯ ok');
    expect(seenB.data).toBe('B');

    a.write('olá\r');
    a.resize(120, 40);
    await tick();
    const toPlace = sentFrames(child).filter((frame) => frame.key === keyA && frame.kind !== 'T');
    expect(toPlace.map((frame) => [frame.kind, frame.data.toString('utf8')])).toEqual([
      ['I', 'olá\r'],
      ['W', '120 40'],
    ]);
  });

  it('a ligação que cai encerra todas as abas do lugar com 255 (como o ssh), e a próxima aba sobe uma ligação nova', async () => {
    const { spawned, links } = fakePlaces();
    stoppers.push(() => links.stopAll());
    const link = links.linkFor('root@hom')!;
    const seen = [link.openTerminal(spec('sid-a')), link.openTerminal(spec('sid-b'))].map(collect);
    await tick();
    up(spawned[0]!.child);
    spawned[0]!.child.emit('close', 255);
    await tick();
    expect(seen.map((entry) => entry.exits)).toEqual([[{ exitCode: LINK_LOST_EXIT }], [{ exitCode: LINK_LOST_EXIT }]]);

    links.linkFor('root@hom')!.openTerminal(spec('sid-a'));
    await tick();
    expect(spawned).toHaveLength(2);
  });

  it('o fim da sessão lá chega com o código dela; fechar a aba avisa o lugar e sai uma vez só', async () => {
    const { spawned, links } = fakePlaces();
    stoppers.push(() => links.stopAll());
    const link = links.linkFor('root@hom')!;
    const ended = collect(link.openTerminal(spec('sid-a')));
    const closed = link.openTerminal(spec('sid-b'));
    const seenClosed = collect(closed);
    await tick();
    const child = spawned[0]!.child;
    up(child);
    const [keyA, keyB] = sentFrames(child)
      .filter((frame) => frame.kind === 'T')
      .map((frame) => frame.key);
    child.stdout.write(encodeLinkFrame('X', keyA!, Buffer.from('0')));
    closed.kill();
    await tick();
    child.stdout.write(encodeLinkFrame('X', keyB!, Buffer.from('129')));
    await tick();
    expect(ended.exits).toEqual([{ exitCode: 0 }]);
    expect(seenClosed.exits).toHaveLength(1);
    expect(sentFrames(child).some((frame) => frame.kind === 'K' && frame.key === keyB)).toBe(true);
  });

  it('o lugar sem python3 devolve as abas ao ssh próprio de cada uma, e é tentado de novo depois', async () => {
    const { spawned, links } = fakePlaces({ ...FAST, retryAfterMs: 80 });
    stoppers.push(() => links.stopAll());
    const seen = collect(links.linkFor('root@hom')!.openTerminal(spec('sid-a')));
    await tick();
    spawned[0]!.child.emit('close', LINK_NO_PYTHON_EXIT);
    await tick();
    expect(seen.exits).toEqual([{ exitCode: LINK_LOST_EXIT }]);
    expect(links.linkFor('root@hom')).toBeNull(); // the caller spawns the tab's own ssh, as before
    expect(links.linkFor('xansde@vps')).not.toBeNull();
    await tick(120);
    expect(links.linkFor('root@hom')).not.toBeNull();
  });

  it('duas tentativas seguidas sem a ligação subir também devolvem o lugar ao ssh por aba', async () => {
    const { spawned, links } = fakePlaces();
    stoppers.push(() => links.stopAll());
    links.linkFor('root@hom')!.openTerminal(spec('sid-a'));
    await tick();
    spawned[0]!.child.emit('close', 255);
    links.linkFor('root@hom')!.openTerminal(spec('sid-a'));
    await tick();
    expect(links.linkFor('root@hom')).not.toBeNull();
    spawned[1]!.child.emit('close', 255);
    await tick();
    expect(links.linkFor('root@hom')).toBeNull();
  });

  it('desligada (DONEL_SSH_LINK=off), nenhuma aba usa a ligação', () => {
    const links = new PlaceLinks({ spawnLink: () => fakeChild() as never, acquire: noGate }, FAST, { enabled: false });
    expect(links.linkFor('root@hom')).toBeNull();
  });

  it('o túnel reverso do hook leva os bytes nos dois sentidos até a porta local da aba', async () => {
    const server = await listen((socket) => {
      socket.on('data', (data) => socket.write(`eco:${data.toString('utf8')}`));
      socket.on('end', () => socket.end());
    });
    stoppers.push(() => server.close());
    const localPort = (server.address() as AddressInfo).port;
    const { spawned, links } = fakePlaces();
    stoppers.push(() => links.stopAll());
    links.linkFor('root@hom')!.openTerminal(spec('sid-a', [{ remotePort: 23999, localPort }]));
    await tick();
    const child = spawned[0]!.child;
    up(child);
    const open = sentFrames(child).find((frame) => frame.kind === 'T')!;
    expect(JSON.parse(open.data.toString('utf8')).ports).toEqual([23999]);
    child.stdout.write(encodeLinkFrame('C', 'c1', Buffer.from(`${open.key} 23999`)));
    child.stdout.write(encodeLinkFrame('D', 'c1', Buffer.from('POST /hook')));
    child.stdout.write(encodeLinkFrame('H', 'c1'));
    await tick(80);
    const back = sentFrames(child).filter((frame) => frame.key === 'c1');
    expect(Buffer.concat(back.filter((frame) => frame.kind === 'D').map((frame) => frame.data)).toString('utf8')).toBe('eco:POST /hook');
    expect(back.at(-1)!.kind).toBe('H');
  });
});

function listen(onSocket: Parameters<typeof createServer>[1]): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer({ allowHalfOpen: true }, onSocket);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// The multiplexer itself, run for real: `bash -s` here stands for the place's `ssh … bash -l -s`.
const canRunPlace = process.platform !== 'win32' && spawnSyncOk('python3') && spawnSyncOk('bash');

describe.skipIf(!canRunPlace)('o multiplexador de verdade (python3 + pty)', () => {
  it('uma aba roda o comando num terminal do tamanho pedido, recebe o que se digita e sai com o código dele; o túnel chega à porta local', async () => {
    const server = await listen((socket) => {
      socket.on('data', (data) => socket.write(`eco:${data.toString('utf8')}`));
      socket.on('end', () => socket.end());
    });
    stoppers.push(() => server.close());
    const localPort = (server.address() as AddressInfo).port;
    const remotePort = 20000 + Math.floor(Math.random() * 20000);
    const children: ChildProcess[] = [];
    const links = new PlaceLinks(
      {
        spawnLink: () => {
          const env = { ...process.env };
          delete env.TMUX;
          const child = spawn('bash', ['-s'], { stdio: ['pipe', 'pipe', 'ignore'], env });
          children.push(child);
          return child;
        },
        acquire: noGate,
      },
      { ...FAST, startupTimeoutMs: 10_000 },
    );
    stoppers.push(() => links.stopAll());
    const link = links.linkFor('local')!;
    const terminal = link.openTerminal({
      command: `stty size; read line; echo "got:$line"; python3 -c "import socket; s = socket.create_connection(('127.0.0.1', ${remotePort})); s.sendall(b'ping'); s.shutdown(socket.SHUT_WR); print(s.recv(100).decode())"; exit 7`,
      cols: 91,
      rows: 23,
      tunnels: [{ remotePort, localPort }],
    });
    const seen = collect(terminal);
    await waitFor(() => seen.data.includes('23 91'));
    terminal.write('olá\r');
    await waitFor(() => seen.exits.length > 0, 15_000);
    expect(seen.data).toContain('got:olá');
    expect(seen.data).toContain('eco:ping');
    expect(seen.exits).toEqual([{ exitCode: 7 }]);
    links.stopAll();
    await waitFor(() => children.every((child) => child.exitCode !== null || child.signalCode !== null));
  }, 30_000);
});

function spawnSyncOk(command: string): boolean {
  try {
    return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > until) throw new Error('timeout');
    await tick(20);
  }
}
