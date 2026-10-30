// notificacoes-completas — the main-process channels (toast, taskbar flash, taskbar badge) driven by the news of
// the pet core, with every Electron piece faked.
import { describe, expect, it } from 'vitest';
import { createAttentionNotifier, type AttentionNotifierDeps } from '../src/main/attention/attention-notifier';
import type { NotificationPreference } from '../src/shared/config';
import type { BubbleEvent } from '../src/shared/pet/types';

class FakeNotification {
  shown = false;
  private clickListener: (() => void) | null = null;
  constructor(readonly options: { title: string; body: string }) {}
  on(_event: 'click', listener: () => void): void {
    this.clickListener = listener;
  }
  show(): void {
    this.shown = true;
  }
  click(): void {
    this.clickListener?.();
  }
}

function world(over: Partial<{ preference: NotificationPreference; pet: boolean; chat: boolean; inFront: boolean; supported: boolean }> = {}) {
  const state = { preference: 'all' as NotificationPreference, pet: false, chat: false, inFront: false, supported: true, ...over };
  const toasts: FakeNotification[] = [];
  const opened: string[] = [];
  const flashes: boolean[] = [];
  const overlays: number[] = [];
  const deps: AttentionNotifierDeps = {
    preference: () => state.preference,
    isPetEnabled: () => state.pet,
    chatCoversPending: () => state.chat,
    isWindowInFront: () => state.inFront,
    isSupported: () => state.supported,
    createNotification: (options) => {
      const notification = new FakeNotification(options);
      toasts.push(notification);
      return notification;
    },
    openSession: (ptyId) => opened.push(ptyId),
    flashFrame: (flag) => flashes.push(flag),
    setOverlay: (count) => overlays.push(count),
  };
  return { state, toasts, opened, flashes, overlays, notifier: createAttentionNotifier(deps) };
}

function event(kind: BubbleEvent['kind'], ptyId = 'pty-1', name = 'atlas', extra: Partial<BubbleEvent> = {}): BubbleEvent {
  return { kind, ptyId, name, blockedKind: null, at: 0, ...extra };
}

describe('the toast', () => {
  it('with the Jobu off it says the news, and a click opens that session', () => {
    const w = world();
    w.notifier.onNotices([event('finished'), event('failed', 'pty-2', 'beacon', { reason: 'limite de uso' })]);
    expect(w.toasts.map((t) => t.options.title)).toEqual(['atlas terminou', 'beacon parou com erro: limite de uso']);
    expect(w.toasts.every((t) => t.shown)).toBe(true);
    w.toasts[1].click();
    expect(w.opened).toEqual(['pty-2']);
  });

  it('with the Jobu on there is no toast (his bubble said it), but the taskbar still flashes', () => {
    const w = world({ pet: true });
    w.notifier.onNotices([event('finished')]);
    expect(w.toasts).toEqual([]);
    expect(w.flashes).toEqual([true]);
  });

  it('with the chat on, a pending is the chat\'s toast: not repeated here', () => {
    const w = world({ chat: true });
    w.notifier.onNotices([event('blocked')]);
    expect(w.toasts).toEqual([]);
  });

  it('the default preference says only what needs the owner', () => {
    const w = world({ preference: 'permission-only' });
    w.notifier.onNotices([event('finished'), event('blocked', 'pty-2', 'beacon'), event('ended', 'pty-3', 'vega')]);
    expect(w.toasts.map((t) => t.options.title)).toEqual(['beacon precisa de você']);
  });

  it('no system support, or a notification that throws, never breaks the rest', () => {
    const w = world({ supported: false });
    w.notifier.onNotices([event('finished')]);
    expect(w.toasts).toEqual([]);
    expect(w.flashes).toEqual([true]);

    const flashes: boolean[] = [];
    const throwing = createAttentionNotifier({
      preference: () => 'all',
      isPetEnabled: () => false,
      chatCoversPending: () => false,
      isWindowInFront: () => false,
      isSupported: () => true,
      createNotification: () => {
        throw new Error('toast service down');
      },
      openSession: () => undefined,
      flashFrame: (flag) => flashes.push(flag),
      setOverlay: () => undefined,
    });
    expect(() => throwing.onNotices([event('finished')])).not.toThrow();
    expect(flashes).toEqual([true]);
  });
});

describe('the flash of the taskbar button', () => {
  it('starts once when news arrives out of focus and stops when the window gets the focus', () => {
    const w = world();
    w.notifier.onNotices([event('finished')]);
    w.notifier.onNotices([event('finished', 'pty-2', 'beacon')]);
    expect(w.flashes).toEqual([true]);
    w.notifier.onWindowFocused();
    w.notifier.onWindowFocused();
    expect(w.flashes).toEqual([true, false]);
  });

  it('does not flash with the Donel in front, nor with "Nenhuma"', () => {
    const front = world({ inFront: true });
    front.notifier.onNotices([event('finished')]);
    expect(front.flashes).toEqual([]);
    const none = world({ preference: 'none' });
    none.notifier.onNotices([event('blocked')]);
    expect(none.flashes).toEqual([]);
    expect(none.toasts).toEqual([]);
  });
});

describe('the badge over the taskbar button', () => {
  it('follows the count of sessions waiting, only when it changes, and goes away at zero', () => {
    const w = world();
    w.notifier.onWaitingCount(0);
    w.notifier.onWaitingCount(1);
    w.notifier.onWaitingCount(1);
    w.notifier.onWaitingCount(3);
    w.notifier.onWaitingCount(0);
    expect(w.overlays).toEqual([1, 3, 0]);
  });
});
