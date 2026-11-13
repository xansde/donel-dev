import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RemoteSessionRegistry } from '../src/main/remote-session';
import { encodeMirrorFrame } from '../src/main/remote-mirror';

// t-9ab0ce2e (13/11) — the PC at 89% of RAM with 108 ssh: one `ssh … tail -F` per remote tab, on top of the tab's own
// ssh. The transcript mirror must use ONE ssh per remote place, and a mirror must never lose or repeat bytes (the
// chat reads it: a lost byte is a lost message, a repeated one a doubled message).

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  killed: boolean;
  kill(): void;
}

function fakeSpawner() {
  const spawned: { target: string; child: FakeChild; commands: string[] }[] = [];
  const spawn = (target: string): FakeChild => {
    const child = new EventEmitter() as FakeChild;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    const record = { target, child, commands: [] as string[] };
    child.stdin.on('data', (chunk: Buffer) => record.commands.push(...chunk.toString('utf8').split('\n').filter(Boolean)));
    spawned.push(record);
    return child;
  };
  return { spawned, spawn };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const SID_A = '11111111-2222-4333-8444-555555555555';
const SID_B = '22222222-2222-4333-8444-555555555555';
const SID_C = '33333333-2222-4333-8444-555555555555';

describe('espelho do transcript: um ssh por máquina', () => {
  it('várias abas na mesma VPS dividem um ssh; cada transcript vai ao seu espelho, sem perder nem repetir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'espelho-'));
    const { spawned, spawn } = fakeSpawner();
    const registry = new RemoteSessionRegistry(dir, { spawnMirror: spawn, restartDelayMs: 0 });
    const a = registry.attach('pty-a', 'root@hom', SID_A, 'seazone/x');
    const b = registry.attach('pty-b', 'root@hom', SID_B, 'seazone/x');
    registry.attach('pty-c', 'eu@vps', SID_C, 'seazone/y');
    await tick();
    // 3 tabs, 2 places: 2 ssh, never 3.
    expect(spawned.map((s) => s.target).sort()).toEqual(['eu@vps', 'root@hom']);
    const hom = spawned.find((s) => s.target === 'root@hom')!;
    expect(hom.commands.filter((line) => line.startsWith('A '))).toHaveLength(2);

    // Frames of both tabs, interleaved and cut in odd places.
    const wire = Buffer.concat([encodeMirrorFrame('1', Buffer.from('{"a":1}\n')), encodeMirrorFrame('2', Buffer.from('{"b":1}\n')), encodeMirrorFrame('1', Buffer.from('{"a":2}\n'))]);
    for (let at = 0; at < wire.length; at += 5) hom.child.stdout.write(wire.subarray(at, at + 5));
    await tick();
    expect(readFileSync(a, 'utf8')).toBe('{"a":1}\n{"a":2}\n');
    expect(readFileSync(b, 'utf8')).toBe('{"b":1}\n');

    // The shared ssh falls (link lost): one new ssh, each transcript asked again from the byte its mirror has.
    hom.child.emit('exit', 255);
    await tick();
    const again = spawned.filter((s) => s.target === 'root@hom');
    expect(again).toHaveLength(2);
    const readds = again[1]!.commands.filter((line) => line.startsWith('A '));
    expect(readds.map((line) => line.split(' ')[2]).sort()).toEqual(['16', '8']);

    // The tab closes: its transcript leaves the shared ssh; the last tab of a place ends that ssh.
    registry.onPtyExit('pty-a');
    await tick();
    expect(again[1]!.commands.some((line) => line.startsWith('D '))).toBe(true);
    registry.onPtyExit('pty-b');
    await tick();
    expect(again[1]!.child.killed).toBe(true);
    registry.stopAll();
  });
});
