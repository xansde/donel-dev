import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RemoteLinkSupervisor } from '../src/main/remote-link';
import { RemoteSessionRegistry } from '../src/main/remote-session';
import { SshGate } from '../src/main/ssh-gate';

// t-eb9a736a (15/11) — às 14:32Z a Homologações travou ~1 min (carga 50, memória apertada). Todas as abas de lá e o
// espelho caíram juntos; o app religou as ~55 abas de uma vez (sonda + ssh de cada uma) e, quando o espelho desistiu,
// abriu um `tail -F` por aba de uma vez: ~140 logins em 2 min numa máquina que mal respondia. Cada lugar agora aceita
// no máximo 6 logins em andamento; o resto espera a vez.

const TABS = 30;
const LIMIT = 6;
const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sid = (i: number): string => `${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`;

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  killed: boolean;
  kill(): void;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

describe('no máximo 6 logins ssh ao mesmo tempo por lugar', () => {
  it('o espelho desiste com 30 abas no lugar: os tail -F saem 6 por vez, cada um ao terminar o login de outro', async () => {
    const mirrors: FakeChild[] = [];
    const tails: FakeChild[] = [];
    const registry = new RemoteSessionRegistry(mkdtempSync(join(tmpdir(), 'limite-')), {
      spawnMirror: () => {
        const child = fakeChild();
        mirrors.push(child);
        return child;
      },
      spawnTail: () => {
        const child = fakeChild();
        tails.push(child);
        return child as never;
      },
      timing: { startupTimeoutMs: 30, backoffMs: [0, 0, 0], retryAfterMs: 60_000 },
      gate: new SshGate(LIMIT, 60_000),
    });
    for (let i = 0; i < TABS; i += 1) registry.attach(`pty-${i}`, 'root@hom', sid(i), 'seazone/x');
    await tick();
    mirrors[0]!.emit('close', 255); // the place stalls: the shared mirror falls and never comes back up
    await tick(300);
    // The rajada: before the gate, 30 tails here at once.
    expect(tails).toHaveLength(LIMIT);
    // A tail that shows its first byte has logged in: the next one goes.
    tails[0]!.stdout.write('{"a":1}\n');
    await tick();
    expect(tails).toHaveLength(LIMIT + 1);
    // A tail that ends also gives its slot back.
    tails[1]!.emit('close', 0);
    await tick();
    expect(tails).toHaveLength(LIMIT + 2);
    registry.stopAll();
  });

  it('30 abas caem juntas: as religações saem 6 por vez, e uma aba fechada na fila não religa', async () => {
    const gate = new SshGate(LIMIT, 60_000);
    const relinked: Array<{ ptyId: string; loggedIn: () => void }> = [];
    const finalized: string[] = [];
    const sup = new RemoteLinkSupervisor<string>({
      probe: async () => 'alive',
      acquire: (target) => gate.acquire(target),
      relink: (ptyId, loggedIn) => {
        relinked.push({ ptyId, loggedIn });
        return true;
      },
      finalize: (ptyId) => finalized.push(ptyId),
      notify: () => undefined,
      setTimer: (run) => setTimeout(run, 0),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => 0,
    });
    for (let i = 0; i < TABS; i += 1) sup.track(`pty-${i}`, 'root@hom', sid(i));
    for (let i = 0; i < TABS; i += 1) sup.onPtyExit(`pty-${i}`, false, 'caiu');
    await tick();
    // The rajada: before the gate, 30 ssh here at once.
    expect(relinked).toHaveLength(LIMIT);
    expect(gate.inFlight('root@hom')).toBe(LIMIT);
    // The first byte of a relinked tab frees its slot; the next tab in line relinks.
    relinked[0]!.loggedIn();
    await tick();
    expect(relinked).toHaveLength(LIMIT + 1);
    // A tab closed by the owner while it waited never gets its ssh.
    expect(sup.kill('pty-29')).toBe(true);
    for (const r of relinked) r.loggedIn();
    for (let round = 0; round < 10; round += 1) {
      await tick();
      for (const r of relinked) r.loggedIn();
    }
    expect(relinked.map((r) => r.ptyId)).not.toContain('pty-29');
    expect(relinked).toHaveLength(TABS - 1);
    expect(gate.inFlight('root@hom')).toBe(0);
    expect(finalized).toEqual(['pty-29']);
  });

  it('o lugar é por máquina, a vaga se solta sozinha depois do tempo e soltar duas vezes não abre vaga a mais', async () => {
    const timers: Array<{ run: () => void; cleared: boolean }> = [];
    const gate = new SshGate(2, 10_000, {
      setTimer: (run) => {
        const t = { run, cleared: false };
        timers.push(t);
        return t;
      },
      clearTimer: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    });
    const a = await gate.acquire('root@hom');
    await gate.acquire('root@hom');
    let third = false;
    void gate.acquire('root@hom').then(() => {
      third = true;
    });
    await gate.acquire('eu@vps'); // another place has its own slots
    await tick(0);
    expect(third).toBe(false);
    a();
    a(); // idempotent
    await tick(0);
    expect(third).toBe(true);
    expect(gate.inFlight('root@hom')).toBe(2);
    // A silent ssh (a tail with nothing new) frees its slot after the hold time.
    timers.filter((t) => !t.cleared).forEach((t) => t.run());
    expect(gate.inFlight('root@hom')).toBe(0);
    expect(gate.inFlight('eu@vps')).toBe(0);
  });
});
