import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { RELINK_DELAYS_MS, RemoteLinkSupervisor, type RemoteLinkProbe } from '../src/main/remote-link';

// Sessões remotas — "sem ligação" (07/11). O ssh da aba caiu, o `claude` seguiu vivo no tmux do lugar remoto e o
// quadro deu o lugar como "fechada": o Líder abriu um substituto e as duas sessões mesclaram PRs ao mesmo tempo.
// Guarda: sessão que some do quadro com o processo vivo, e fechar (matar) uma sessão nesse estado.

const spawned: string[] = [];
vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: { end: (script: string) => {
        spawned.push(script);
        setTimeout(() => child.emit('close', 0), 0);
      } },
      stdout: Object.assign(new EventEmitter(), { setEncoding: () => undefined, pipe: () => undefined }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: () => undefined }),
      kill: () => true,
    });
    return child;
  },
}));

interface Harness {
  readonly sup: RemoteLinkSupervisor<string>;
  readonly finalized: Array<{ ptyId: string; exit: string; byOwner: boolean }>;
  readonly notes: Array<{ ptyId: string; linked: boolean }>;
  readonly relinked: string[];
  readonly timers: Array<{ run: () => void; ms: number; cleared: boolean }>;
  /** Fires the next pending timer and lets the probe answer. */
  tick(): Promise<void>;
}

function harness(answers: RemoteLinkProbe[], relinkWorks = true): Harness {
  const finalized: Harness['finalized'] = [];
  const notes: Harness['notes'] = [];
  const relinked: string[] = [];
  const timers: Harness['timers'] = [];
  const sup = new RemoteLinkSupervisor<string>({
    probe: async () => answers.shift() ?? 'unreachable',
    relink: (ptyId) => {
      relinked.push(ptyId);
      return relinkWorks;
    },
    finalize: (ptyId, exit, byOwner) => finalized.push({ ptyId, exit, byOwner }),
    notify: (ptyId, linked) => notes.push({ ptyId, linked }),
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    now: () => 0,
  });
  return {
    sup,
    finalized,
    notes,
    relinked,
    timers,
    tick: async () => {
      const next = timers.find((timer) => !timer.cleared && !(timer as { fired?: boolean }).fired);
      if (!next) throw new Error('nenhum timer pendente');
      (next as { fired?: boolean }).fired = true;
      next.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('sessão remota sem ligação', () => {
  it('o ssh cai com o tmux vivo: o lugar não fecha, fica "sem ligação" e o app religa o mesmo ptyId', async () => {
    const h = harness(['alive']);
    h.sup.track('pty-1', 'root@vps', 'sid-1');
    expect(h.sup.onPtyExit('pty-1', false, 'exit-255')).toBe(true);
    expect(h.sup.isLost('pty-1')).toBe(true);
    expect(h.notes).toEqual([{ ptyId: 'pty-1', linked: false }]);
    await h.tick();
    expect(h.relinked).toEqual(['pty-1']);
    expect(h.finalized).toEqual([]);
    expect(h.sup.isLost('pty-1')).toBe(false);
    expect(h.notes.at(-1)).toEqual({ ptyId: 'pty-1', linked: true });
  });

  it('o tmux de lá morreu: a saída acontece de verdade (fechada), sem matar nada lá', async () => {
    const h = harness(['gone']);
    h.sup.track('pty-1', 'root@vps', 'sid-1');
    h.sup.onPtyExit('pty-1', false, 'exit-255');
    await h.tick();
    expect(h.finalized).toEqual([{ ptyId: 'pty-1', exit: 'exit-255', byOwner: false }]);
    expect(h.relinked).toEqual([]);
  });

  it('lugar inalcançável nunca vira "fechada": segue sem ligação e tenta de novo, cada vez mais espaçado', async () => {
    const h = harness(['unreachable', 'unreachable', 'alive']);
    h.sup.track('pty-1', 'root@vps', 'sid-1');
    h.sup.onPtyExit('pty-1', false, 'exit-255');
    await h.tick();
    await h.tick();
    expect(h.finalized).toEqual([]);
    expect(h.sup.isLost('pty-1')).toBe(true);
    expect(h.timers.map((timer) => timer.ms)).toEqual(RELINK_DELAYS_MS.slice(0, 3));
    await h.tick();
    expect(h.relinked).toEqual(['pty-1']);
  });

  it('fechar uma sessão sem ligação a encerra como fechada pelo dono e cancela a religação', async () => {
    const h = harness(['alive']);
    h.sup.track('pty-1', 'root@vps', 'sid-1');
    h.sup.onPtyExit('pty-1', false, 'exit-255');
    expect(h.sup.kill('pty-1')).toBe(true);
    expect(h.finalized).toEqual([{ ptyId: 'pty-1', exit: 'exit-255', byOwner: true }]);
    expect(h.timers[0].cleared).toBe(true);
    expect(h.sup.kill('pty-1')).toBe(false); // the next close kills the PTY as usual
  });

  it('fechada durante a sonda: a resposta que chega depois não religa nem fecha de novo', async () => {
    let answer: (value: RemoteLinkProbe) => void = () => undefined;
    const finalized: boolean[] = [];
    const relinked: string[] = [];
    let run: () => void = () => undefined;
    const sup = new RemoteLinkSupervisor<string>({
      probe: () => new Promise((resolve) => (answer = resolve)),
      relink: (ptyId) => (relinked.push(ptyId), true),
      finalize: (_ptyId, _exit, byOwner) => finalized.push(byOwner),
      notify: () => undefined,
      setTimer: (fn) => (run = fn),
      clearTimer: () => undefined,
      now: () => 0,
    });
    sup.track('pty-1', 'root@vps', 'sid-1');
    sup.onPtyExit('pty-1', false, 'exit-255');
    run();
    sup.kill('pty-1');
    answer('alive');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(relinked).toEqual([]);
    expect(finalized).toEqual([true]);
  });

  it('fim normal da sessão (o ssh saiu com 0): pergunta à VPS na hora e fecha, sem passar por "sem ligação" (08/11)', async () => {
    const h = harness(['gone']);
    h.sup.track('pty-1', 'root@vps', 'sid-1');
    expect(h.sup.onPtyExit('pty-1', false, 'exit-0', true)).toBe(true);
    expect(h.timers[0].ms).toBe(0);
    await h.tick();
    expect(h.notes).toEqual([]);
    expect(h.finalized).toEqual([{ ptyId: 'pty-1', exit: 'exit-0', byOwner: false }]);
  });

  it('saída 0 com a VPS fora do ar: aí sim fica "sem ligação" e tenta de novo', async () => {
    const h = harness(['unreachable', 'alive']);
    h.sup.track('pty-1', 'root@vps', 'sid-1');
    h.sup.onPtyExit('pty-1', false, 'exit-0', true);
    await h.tick();
    expect(h.notes).toEqual([{ ptyId: 'pty-1', linked: false }]);
    await h.tick();
    expect(h.relinked).toEqual(['pty-1']);
  });

  it('o dono fechou, ou o app está saindo: a saída não é segurada', () => {
    const h = harness([]);
    h.sup.track('pty-1', 'root@vps', 'sid-1');
    expect(h.sup.onPtyExit('pty-1', true, 'exit-0')).toBe(false);
    h.sup.track('pty-2', 'root@vps', 'sid-2');
    h.sup.stopAll();
    expect(h.sup.onPtyExit('pty-2', false, 'exit-255')).toBe(false);
    expect(h.sup.onPtyExit('pty-local', false, 'exit-1')).toBe(false); // a local tab is never held
    expect(h.timers).toEqual([]);
  });

  it('fechar a aba depois de um /clear lá dentro encerra o tmux certo (o da pasta, não o da conversa nova)', async () => {
    const { RemoteSessionRegistry } = await import('../src/main/remote-session');
    const registry = new RemoteSessionRegistry('/tmp/donel-remote-link-test');
    vi.spyOn(registry as unknown as { startPump: () => string }, 'startPump').mockReturnValue('mirror');
    registry.attach('pty-1', 'root@vps', 'aaaaaaaa-0000-4000-8000-000000000001', 'proj');
    registry.repoint('pty-1', 'bbbbbbbb-0000-4000-8000-000000000002', '/root/.claude/projects/x/bbbbbbbb-0000-4000-8000-000000000002.jsonl');
    spawned.length = 0;
    registry.endRemote('pty-1');
    await registry.waitEnded('aaaaaaaa-0000-4000-8000-000000000001');
    expect(spawned.join('\n')).toContain("kill-session -t 'donel-aaaaaaaa-0000-4000-8000-000000000001'");
  });
});
