import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteSessionRegistry } from '../src/main/remote-session';
import { encodeMirrorFrame, MIRROR_MAX_FAILURES, MIRROR_NO_PYTHON_EXIT, mirrorBootLine, sshMirrorSpawner } from '../src/main/remote-mirror';

// t-9ab0ce2e (13/11) — the PC at 89% of RAM with 108 ssh: one `ssh … tail -F` per remote tab, on top of the tab's own
// ssh. The transcript mirror must use ONE ssh per remote place, must never lose or repeat bytes (the chat reads it: a
// lost byte is a lost message, a repeated one a doubled message), and a shared mirror that does not work must give the
// place back its per-tab tails instead of leaving the chat of every tab there stopped.

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  killed: boolean;
  kill(): void;
}

function fakeChild(onLine: (line: string) => void = () => undefined): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  child.stdin.on('data', (chunk: Buffer) => chunk.toString('utf8').split('\n').filter(Boolean).forEach(onLine));
  return child;
}

function fakeSpawner() {
  const spawned: { target: string; child: FakeChild; commands: string[] }[] = [];
  const spawn = (target: string): FakeChild => {
    const record = { target, child: undefined as unknown as FakeChild, commands: [] as string[] };
    record.child = fakeChild((line) => record.commands.push(line));
    spawned.push(record);
    return record.child;
  };
  return { spawned, spawn };
}

function fakeTails() {
  const tails: { target: string; command: string; child: FakeChild }[] = [];
  const spawnTail = (target: string, command: string) => {
    const child = fakeChild();
    tails.push({ target, command, child });
    return child as never;
  };
  return { tails, spawnTail };
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const SID_A = '11111111-2222-4333-8444-555555555555';
const SID_B = '22222222-2222-4333-8444-555555555555';
const SID_C = '33333333-2222-4333-8444-555555555555';
const FAST = { startupTimeoutMs: 1_000, backoffMs: [0, 0, 0] };
const up = (child: FakeChild): boolean => child.stdout.write(encodeMirrorFrame('0', Buffer.alloc(0), 'R'));

afterEach(() => {
  vi.useRealTimers();
});

describe('espelho do transcript: um ssh por máquina', () => {
  it('o script vai pelo stdin: o argv do ssh não leva aspas de script, e a primeira linha sobe o multiplexador', () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawnMirror = sshMirrorSpawner(['-o', 'BatchMode=yes'], (command, args) => {
      calls.push({ command, args });
      return fakeChild() as never;
    });
    spawnMirror('root@hom');
    expect(calls).toEqual([{ command: 'ssh', args: ['-o', 'BatchMode=yes', '-T', '--', 'root@hom', 'bash -l -s'] }]);
    const boot = mirrorBootLine();
    expect(boot.endsWith('\n')).toBe(true);
    expect(boot.slice(0, -1)).not.toContain('\n');
    expect(boot).toMatch(/^command -v python3 >\/dev\/null 2>&1 \|\| exit 127; exec python3 -u -c "\$\(printf %s [A-Za-z0-9+/=]+ \| base64 -d\)"\n$/);
  });

  it('várias abas na mesma VPS dividem um ssh; cada transcript vai ao seu espelho, sem perder nem repetir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'espelho-'));
    const { spawned, spawn } = fakeSpawner();
    const registry = new RemoteSessionRegistry(dir, { spawnMirror: spawn, timing: FAST });
    const a = registry.attach('pty-a', 'root@hom', SID_A, 'seazone/x');
    const b = registry.attach('pty-b', 'root@hom', SID_B, 'seazone/x');
    registry.attach('pty-c', 'eu@vps', SID_C, 'seazone/y');
    await tick();
    // 3 tabs, 2 places: 2 ssh, never 3. The multiplexer goes first on stdin, then the transcripts.
    expect(spawned.map((s) => s.target).sort()).toEqual(['eu@vps', 'root@hom']);
    const hom = spawned.find((s) => s.target === 'root@hom')!;
    expect(hom.commands[0]).toBe(mirrorBootLine().trimEnd());
    expect(hom.commands.filter((line) => line.startsWith('A '))).toHaveLength(2);
    up(hom.child);

    // Frames of both tabs, interleaved and cut in odd places.
    const wire = Buffer.concat([encodeMirrorFrame('1', Buffer.from('{"a":1}\n')), encodeMirrorFrame('2', Buffer.from('{"b":1}\n')), encodeMirrorFrame('1', Buffer.from('{"a":2}\n'))]);
    for (let at = 0; at < wire.length; at += 5) hom.child.stdout.write(wire.subarray(at, at + 5));
    await tick();
    expect(readFileSync(a, 'utf8')).toBe('{"a":1}\n{"a":2}\n');
    expect(readFileSync(b, 'utf8')).toBe('{"b":1}\n');

    // The shared ssh falls (link lost): one new ssh, each transcript asked again from the byte its mirror has.
    // A late frame of the falling ssh is dropped (it was never counted: the new ssh asks for it again).
    hom.child.emit('close', 255);
    hom.child.stdout.write(encodeMirrorFrame('1', Buffer.from('{"atrasado":1}\n')));
    await tick();
    const again = spawned.filter((s) => s.target === 'root@hom');
    expect(again).toHaveLength(2);
    const readds = again[1]!.commands.filter((line) => line.startsWith('A '));
    expect(readds.map((line) => line.split(' ')[2]).sort()).toEqual(['16', '8']);
    expect(readFileSync(a, 'utf8')).toBe('{"a":1}\n{"a":2}\n');
    up(again[1]!.child);

    // One tail ended on the place (killed): that transcript alone is asked again, from its byte.
    again[1]!.child.stdout.write(encodeMirrorFrame('2', Buffer.alloc(0), 'E'));
    await tick();
    expect(again[1]!.commands.filter((line) => line.startsWith('A 2 '))).toEqual([expect.stringMatching(/^A 2 8 /), expect.stringMatching(/^A 2 8 /)]);

    // The tab's ssh came back ("sem ligação"): its mirror restarts from its byte; a repoint to the same transcript
    // meanwhile must not rewrite the mirror from zero.
    registry.resumePump('pty-a');
    registry.repoint('pty-a', SID_A, '/root/.claude/projects/x/' + SID_A + '.jsonl');
    await tick();
    expect(readFileSync(a, 'utf8')).toBe('{"a":1}\n{"a":2}\n');

    // The tab closes: its transcript leaves the shared ssh; the last tab of a place ends that ssh.
    registry.onPtyExit('pty-a');
    await tick();
    expect(again[1]!.commands.some((line) => line.startsWith('D '))).toBe(true);
    registry.onPtyExit('pty-b');
    await tick();
    expect(again[1]!.child.killed).toBe(true);
    registry.stopAll();
  });

  it('espelho compartilhado que não funciona: depois de N tentativas a máquina volta ao tail -F por aba, do byte certo, e o motivo fica registrado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'espelho-'));
    const { spawned, spawn } = fakeSpawner();
    const { tails, spawnTail } = fakeTails();
    const reasons: string[] = [];
    const registry = new RemoteSessionRegistry(dir, {
      spawnMirror: spawn,
      spawnTail,
      timing: { startupTimeoutMs: 30, backoffMs: [0, 0, 0] },
      onMirrorFallback: (target, reason) => reasons.push(`${target}: ${reason}`),
    });
    const a = registry.attach('pty-a', 'root@hom', SID_A, 'seazone/x');
    registry.attach('pty-b', 'root@hom', SID_B, 'seazone/x');
    await tick();
    const first = spawned[0]!;
    up(first.child);
    first.child.stdout.write(encodeMirrorFrame('1', Buffer.from('{"a":1}\n')));
    await tick();
    // The multiplexer breaks: the first try crashes, the others never come up (python broken, ssh failing on the PC).
    first.child.emit('close', 1);
    await tick(300);
    expect(spawned.length).toBe(1 + MIRROR_MAX_FAILURES - 1);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^root@hom: 3 tentativas seguidas sem funcionar; a última: não subiu em 0 s/);
    // Back to one tail per tab, each from the byte its mirror has; and no shared ssh again for that place.
    expect(tails.map((tail) => tail.command.split(' ').slice(0, 3).join(' ')).sort()).toEqual(['tail -c +1', 'tail -c +9']);
    tails.find((tail) => tail.command.startsWith('tail -c +9'))!.child.stdout.write('{"a":2}\n');
    await tick();
    expect(readFileSync(a, 'utf8')).toBe('{"a":1}\n{"a":2}\n');
    registry.attach('pty-c', 'root@hom', SID_C, 'seazone/x');
    expect(spawned.length).toBe(MIRROR_MAX_FAILURES);
    expect(tails).toHaveLength(3);
    registry.stopAll();
  });

  it('sem python3 na máquina: volta ao tail -F por aba na primeira vez, sem reabrir ssh', async () => {
    const { spawned, spawn } = fakeSpawner();
    const { tails, spawnTail } = fakeTails();
    const reasons: string[] = [];
    const registry = new RemoteSessionRegistry(mkdtempSync(join(tmpdir(), 'espelho-')), { spawnMirror: spawn, spawnTail, timing: FAST, onMirrorFallback: (_t, reason) => reasons.push(reason) });
    registry.attach('pty-a', 'eu@sem-python', SID_A, 'seazone/x');
    spawned[0]!.child.emit('close', MIRROR_NO_PYTHON_EXIT);
    await tick();
    expect(spawned).toHaveLength(1);
    expect(reasons).toEqual(['o lugar não tem python3']);
    expect(tails).toHaveLength(1);
    registry.stopAll();
  });

  it('as novas tentativas esperam como a religação da aba (1, 3, 10 s…) e o primeiro byte zera a conta', async () => {
    vi.useFakeTimers();
    const { spawned, spawn } = fakeSpawner();
    const registry = new RemoteSessionRegistry(mkdtempSync(join(tmpdir(), 'espelho-')), { spawnMirror: spawn, spawnTail: fakeTails().spawnTail });
    registry.attach('pty-a', 'root@hom', SID_A, 'seazone/x');
    spawned[0]!.child.emit('close', 255); // 1st failure: waits 1 s
    await vi.advanceTimersByTimeAsync(999);
    expect(spawned).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned).toHaveLength(2);
    spawned[1]!.child.emit('close', 255); // 2nd failure: waits 3 s
    await vi.advanceTimersByTimeAsync(2_999);
    expect(spawned).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned).toHaveLength(3);
    // This one works (a transcript byte), then the link drops: the count starts over, 1 s again, no giving up.
    up(spawned[2]!.child);
    spawned[2]!.child.stdout.write(encodeMirrorFrame('1', Buffer.from('x')));
    await vi.advanceTimersByTimeAsync(0);
    spawned[2]!.child.emit('close', 255);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawned).toHaveLength(4);
    registry.stopAll();
  });
});
