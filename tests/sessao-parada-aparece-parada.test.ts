// t-1293c818, item 5 — a session sitting at the prompt is "parada", never "trabalhando" nor "sem sinal". After the app
// reopens, every session came back as working/unconfirmed until its first turn: an update waited on them and the
// notices and the hand-over of tasks treated a live Líder as mute (`whoHears` wants a confirmed session).

import { describe, expect, it } from 'vitest';
import { SessionSemaphoreManager } from '../src/main/session-semaphore-manager';
import type { HookBridge } from '../src/main/hook-bridge';
import { settledRemoteSessions, type RemoteHealthReport } from '../src/shared/health/remote';
import type { RemoteSessionReading } from '../src/shared/health/remoteSessions';
import { createPetState, reducePet } from '../src/shared/pet/petState';
import type { WatchedSession } from '../src/shared/pet/types';

function manager(now: { at: number }) {
  let emit: ((event: unknown) => void) | null = null;
  const bridge = { onAny: (listener: (event: unknown) => void) => ((emit = listener), () => undefined) } as unknown as HookBridge;
  const semaphore = new SessionSemaphoreManager({ getRecentLines: () => [], tickIntervalMs: 60_000, now: () => now.at });
  semaphore.attachBridge(bridge);
  semaphore.registerSession('pty-1', 's-1');
  const hook = (event: string, payload: Record<string, unknown> = {}) => emit!({ type: 'hook', ptyId: 'pty-1', event, payload });
  return { semaphore, hook };
}

describe('sessão retomada e parada no prompt aparece parada', () => {
  it('a resumed session (SessionStart resume) is stopped and heard, with no turn yet', () => {
    const { semaphore, hook } = manager({ at: 1_000 });
    hook('SessionStart', { source: 'resume' });
    expect(semaphore.getSnapshot('pty-1')).toMatchObject({ state: 'waiting' });
    expect(semaphore.getSnapshot('pty-1')?.unconfirmed).toBeUndefined();
    semaphore.dispose();
  });

  it('a brand-new session is not taken as stopped before its first message, nor a compaction in the middle of a turn', () => {
    const fresh = manager({ at: 1_000 });
    fresh.hook('SessionStart', { source: 'startup' });
    expect(fresh.semaphore.getSnapshot('pty-1')).toMatchObject({ state: 'working', unconfirmed: true });
    fresh.semaphore.dispose();

    const busy = manager({ at: 1_000 });
    busy.hook('UserPromptSubmit');
    busy.hook('SessionStart', { source: 'compact' });
    expect(busy.semaphore.getSnapshot('pty-1')?.state).toBe('working');
    busy.semaphore.dispose();
  });

  it('a session on a remote place reattached with no hook: the place saying it is idle makes it stopped', () => {
    const now = { at: 10_000 };
    const { semaphore, hook } = manager(now);
    now.at = 80_000;
    semaphore.settleFromPlace('pty-1', 70_000);
    expect(semaphore.getSnapshot('pty-1')).toMatchObject({ state: 'waiting' });
    expect(semaphore.getSnapshot('pty-1')?.unconfirmed).toBeUndefined();
    hook('UserPromptSubmit');
    expect(semaphore.getSnapshot('pty-1')?.state).toBe('working');
    semaphore.dispose();
  });

  it('a reading older than the last hook never stops a session that moved after it', () => {
    const now = { at: 10_000 };
    const { semaphore, hook } = manager(now);
    now.at = 75_000;
    hook('UserPromptSubmit'); // the owner sent a message while the place was being read
    now.at = 80_000;
    semaphore.settleFromPlace('pty-1', 70_000);
    expect(semaphore.getSnapshot('pty-1')?.state).toBe('working');
    semaphore.dispose();

    const born = { at: 75_000 }; // opened after the read started: the reading does not know it
    const late = manager(born);
    late.semaphore.settleFromPlace('pty-1', 70_000);
    expect(late.semaphore.getSnapshot('pty-1')).toMatchObject({ state: 'working', unconfirmed: true });
    late.semaphore.dispose();
  });
});

describe('which sessions the place itself says are idle', () => {
  const MIN = 60_000;
  function reading(over: Partial<RemoteSessionReading>): RemoteSessionReading {
    return {
      sid: 's1',
      name: 'Dev',
      rssBytes: 0,
      cpuTicks: 0,
      clkTck: 100,
      pane: 'idle',
      paneActivityAt: null,
      transcript: true,
      lastAt: null,
      turn: 'ended',
      last: 'reply',
      tool: null,
      apiError: null,
      retry: null,
      background: { procs: 0, names: [], pendingTasks: 0 },
      ...over,
    };
  }
  function report(details: RemoteSessionReading[], over: Partial<RemoteHealthReport> = {}): RemoteHealthReport {
    return {
      id: 'vps',
      label: 'VPS',
      status: 'ok',
      checkedAt: 100 * MIN,
      lastOkAt: 100 * MIN,
      severity: 'ok',
      reading: { sessionDetails: details, readAt: 0 } as unknown as RemoteHealthReport['reading'],
      ...over,
    };
  }

  it('only an idle pane whose turn ended, read just now', () => {
    const details = [
      reading({ sid: 'parada' }),
      reading({ sid: 'girando', pane: 'busy' }),
      reading({ sid: 'turno-aberto', turn: 'open' }),
      reading({ sid: 'nunca-pediu', transcript: false, turn: null }),
      reading({ sid: 'tarefa-no-fundo', background: { procs: 0, names: [], pendingTasks: 1 } }),
      reading({ sid: 'permissao', pane: 'permission' }),
    ];
    const settled = settledRemoteSessions([report(details)], 15_000);
    expect(settled).toEqual([{ sid: 'parada', readStartedAt: 100 * MIN - 15_000 }]);
  });

  it('never from a place that did not answer this time (its reading is the old one)', () => {
    expect(settledRemoteSessions([report([reading({})], { status: 'unreachable', checkedAt: 101 * MIN })], 15_000)).toEqual([]);
  });
});

describe('Jobu: a session found stopped is not a turn that ended', () => {
  const watched = (semaphore: WatchedSession['semaphore']): WatchedSession => ({ ptyId: 'a', name: 'a', semaphore, blockedKind: null });

  it('idle → waiting gives no "terminou"; working → waiting still does', () => {
    let state = reducePet(createPetState(), { type: 'sessions', sessions: [watched('idle')] }, 0);
    state = reducePet(state, { type: 'sessions', sessions: [watched('waiting')] }, 1_000);
    expect(state.bubble).toBeNull();

    let worked = reducePet(createPetState(), { type: 'sessions', sessions: [watched('working')] }, 0);
    worked = reducePet(worked, { type: 'sessions', sessions: [watched('waiting')] }, 1_000);
    expect(worked.bubble?.text).toMatch(/terminou/);
  });
});
