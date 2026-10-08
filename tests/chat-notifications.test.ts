// T079 (014-chat, R23) - pending notification: pure decision + notifier with fakes, and the
// semaphore override that shows "esperando você" while a pending is open.
import { describe, expect, it } from 'vitest';
import { createPendingNotifier, shouldNotifyPending, type NotificationLike } from '../src/main/chat/notifications';
import { SessionSemaphoreManager, type SemaphoreUpdate } from '../src/main/session-semaphore-manager';
import type { Pending } from '../src/shared/chat/rows';

describe('shouldNotifyPending', () => {
  const base = { preference: 'permission-only' as const, windowFocused: true, activePtyId: 'a', ptyId: 'a' };

  it('does not notify when the window is focused and the tab is the active one', () => {
    expect(shouldNotifyPending(base)).toBe(false);
  });
  it('notifies when the window is out of focus, even for the active tab', () => {
    expect(shouldNotifyPending({ ...base, windowFocused: false })).toBe(true);
  });
  it('notifies when the tab is not the active one, even with the window focused', () => {
    expect(shouldNotifyPending({ ...base, activePtyId: 'b' })).toBe(true);
    expect(shouldNotifyPending({ ...base, activePtyId: null })).toBe(true);
  });
  it('respects the preference: none never notifies; all and permission-only do (a pending is a permission)', () => {
    expect(shouldNotifyPending({ ...base, windowFocused: false, preference: 'none' })).toBe(false);
    expect(shouldNotifyPending({ ...base, windowFocused: false, preference: 'all' })).toBe(true);
    expect(shouldNotifyPending({ ...base, windowFocused: false, preference: 'permission-only' })).toBe(true);
  });
});

const pending: Pending = {
  id: 'r1',
  kind: 'permission',
  match: { toolName: 'Bash', toolInput: { command: 'rm secret.txt' } },
  toolUseId: null,
  scope: 'main',
  arrivedAt: '2026-10-08T10:00:00.000Z',
  state: 'open',
  payload: { toolName: 'Bash', toolInput: { command: 'rm secret.txt' } },
};

function notifierHarness(over: { focused?: boolean; supported?: boolean; preference?: 'all' | 'permission-only' | 'none' } = {}) {
  const shown: { title: string; body: string }[] = [];
  const clicks: string[] = [];
  const listeners: (() => void)[] = [];
  const notifier = createPendingNotifier({
    preference: () => over.preference ?? 'permission-only',
    isWindowFocused: () => over.focused ?? false,
    isSupported: () => over.supported ?? true,
    create: (options) => {
      const n: NotificationLike = {
        on: (_event, listener) => void listeners.push(listener),
        show: () => void shown.push(options),
      };
      return n;
    },
    onClick: (ptyId) => clicks.push(ptyId),
  });
  return { notifier, shown, clicks, listeners };
}

describe('createPendingNotifier', () => {
  it('titles with the tab name, never carries the command, and click reports the tab', () => {
    const h = notifierHarness();
    h.notifier.setFocusState('other', { p1: 'atlas · repasse' });
    expect(h.notifier.notifyPending('p1', pending)).toBe(true);
    expect(h.shown).toEqual([{ title: 'atlas · repasse', body: 'Esperando você — permissão para rodar um comando' }]);
    expect(h.shown[0]!.body).not.toContain('secret');
    h.listeners[0]!();
    expect(h.clicks).toEqual(['p1']);
  });

  it('stays quiet for the active tab with the window focused, with preference none, or when unsupported', () => {
    const quiet = notifierHarness({ focused: true });
    quiet.notifier.setFocusState('p1');
    expect(quiet.notifier.notifyPending('p1', pending)).toBe(false);
    expect(notifierHarness({ preference: 'none' }).notifier.notifyPending('p1', pending)).toBe(false);
    expect(notifierHarness({ supported: false }).notifier.notifyPending('p1', pending)).toBe(false);
  });

  it('falls back to the app name when the tab name is unknown', () => {
    const h = notifierHarness();
    h.notifier.notifyPending('p1', pending);
    expect(h.shown[0]!.title).toBe('Donel Dev');
  });
});

describe('semaphore with an open pending (T079)', () => {
  it('publishes permission while a pending is open and goes back to the machine state after', () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const updates: SemaphoreUpdate[] = [];
    manager.onUpdate((u) => updates.push(u));
    manager.registerSession('pty-1', 'claude-a');
    expect(updates.at(-1)!.state).toBe('working');
    manager.setPendingOpen('pty-1', true);
    expect(updates.at(-1)!.state).toBe('permission');
    manager.setPendingOpen('pty-1', true); // idempotent: no extra update
    const count = updates.length;
    manager.setPendingOpen('pty-1', false);
    expect(updates.length).toBe(count + 1);
    expect(updates.at(-1)!.state).toBe('working');
    manager.dispose();
  });
});
