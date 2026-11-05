// t-45e87762 — "Esperando você" only while the session really asks the owner something, and gone once it moves on.
// A wrong one sends the owner to sessions that wait for nobody; a missing one hides a real ask.

import { describe, expect, it } from 'vitest';
import { INITIAL_SEMAPHORE_STATE, reduceSemaphoreState, type SemaphoreEvent, type SemaphoreMachineState } from '../src/main/semaphore-state-machine';
import { mapHookEventName, notificationNeedsOwner } from '../src/main/session-semaphore-manager';
import { createPetState, reducePet, waitingCount, waitingSessions } from '../src/shared/pet/petState';
import type { WatchedSession } from '../src/shared/pet/types';

function run(events: readonly SemaphoreEvent[]): SemaphoreMachineState {
  return events.reduce(reduceSemaphoreState, INITIAL_SEMAPHORE_STATE);
}

describe('semaphore: "esperando você" follows the dialog on the screen', () => {
  it('the asked tool running (PostToolUse) ends the wait', () => {
    expect(run([{ type: 'preToolUse', at: 1 }, { type: 'notification', at: 2 }, { type: 'postToolUse', at: 3 }]).state).toBe('working');
  });

  it("a sub-agent's tool calls do not end the main thread's dialog", () => {
    const asked = run([{ type: 'preToolUse', at: 1, toolName: 'Agent' }, { type: 'preToolUse', at: 2, toolName: 'Bash' }, { type: 'notification', at: 3 }]);
    const after: SemaphoreEvent[] = [
      { type: 'preToolUse', at: 4, agentId: 'bg', toolName: 'Read' },
      { type: 'postToolUse', at: 5, agentId: 'bg', toolName: 'Read' },
    ];
    expect(after.reduce(reduceSemaphoreState, asked).state).toBe('permission');
  });

  it('the owner answering a sub-agent ends the wait as soon as its tool runs (Revisor, #225 item 1)', () => {
    const state = run([
      { type: 'preToolUse', at: 1, toolName: 'Agent' },
      { type: 'preToolUse', at: 2, agentId: 'sub', toolName: 'Bash' },
      { type: 'notification', at: 3 },
      { type: 'postToolUse', at: 10, agentId: 'sub', toolName: 'Bash' },
    ]);
    expect(state.state).toBe('working');
    const next: SemaphoreEvent[] = [
      { type: 'preToolUse', at: 11, agentId: 'sub', toolName: 'Read' },
      { type: 'postToolUse', at: 12, agentId: 'sub', toolName: 'Read' },
    ];
    expect(next.reduce(reduceSemaphoreState, state).state).toBe('working');
  });

  it('a parallel sibling finishing does not erase the ask still on screen (Revisor, #225 item 2)', () => {
    const sibling = run([
      { type: 'preToolUse', at: 1, toolName: 'Read' },
      { type: 'preToolUse', at: 2, toolName: 'Read' },
      { type: 'notification', at: 3 },
      { type: 'postToolUse', at: 4, toolName: 'Read' },
    ]);
    expect(sibling.state).toBe('permission');
    expect(reduceSemaphoreState(sibling, { type: 'postToolUse', at: 9, toolName: 'Read' }).state).toBe('working');
  });

  it('a call that ended in error also stops counting as running', () => {
    expect(mapHookEventName('PostToolUseFailure')).toBe('postToolUse');
  });

  it('only a dialog on this screen asks the owner: idle, a background job or a missing type do not', () => {
    expect(notificationNeedsOwner({ notification_type: 'permission_prompt' })).toBe(true);
    expect(notificationNeedsOwner({ notification_type: 'elicitation_dialog' })).toBe(true);
    expect(notificationNeedsOwner({ notification_type: 'idle_prompt' })).toBe(false);
    expect(notificationNeedsOwner({ notification_type: 'agent_needs_input' })).toBe(false);
    expect(notificationNeedsOwner({ message: 'Claude is waiting for your input' })).toBe(false);
  });
});

describe('Jobu: the "Esperando você" list', () => {
  const watched = (ptyId: string, semaphore: WatchedSession['semaphore']): WatchedSession => ({ ptyId, name: ptyId, semaphore, blockedKind: null });

  it('lists the session that asks, not the one whose turn just ended, and drops it once answered', () => {
    let state = reducePet(createPetState(), { type: 'sessions', sessions: [watched('a', 'working'), watched('b', 'working')] }, 0);
    state = reducePet(state, { type: 'sessions', sessions: [watched('a', 'waiting'), watched('b', 'permission')] }, 1_000);
    expect(waitingSessions(state).map((entry) => entry.ptyId)).toEqual(['b']);
    expect(waitingCount(state)).toBe(1);

    state = reducePet(state, { type: 'sessions', sessions: [watched('a', 'waiting'), watched('b', 'working')] }, 2_000);
    expect(waitingCount(state)).toBe(0);
  });
});
