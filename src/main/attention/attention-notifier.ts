// notificacoes-completas (30/10) — the channels of the main process that tell the owner about his sessions when he is
// not looking: the Windows toast, the flash of the taskbar button and the badge over it. The news comes from the
// pet core (always fed, with the Jobu on or off: `PetServiceDeps.onNotices` / `onWaitingCountChanged`); which channel
// says what is THE rule (src/shared/attention/rule.ts). Electron stays out: the notification, the window and the
// overlay come in through the deps, so the whole behaviour is tested with fakes.

import type { NotificationPreference } from '../../shared/config';
import { noticeToast, shouldFlash, shouldToast } from '../../shared/attention/rule';
import type { BubbleEvent } from '../../shared/pet/types';
import type { NotificationLike } from '../chat/notifications';

export interface AttentionNotifierDeps {
  readonly preference: () => NotificationPreference;
  /** The Jobu is on screen: his bubble already said it (FR-020 of 015). */
  readonly isPetEnabled: () => boolean;
  /** The chat is on: its own toast says every pending it opens, with what the pending is (T079). */
  readonly chatCoversPending: () => boolean;
  /** The main window is in front of the owner: focused, visible, not minimized. */
  readonly isWindowInFront: () => boolean;
  readonly isSupported: () => boolean;
  readonly createNotification: (options: { title: string; body: string }) => NotificationLike;
  /** A click on a toast: the Donel comes to the front on the tab of that session. */
  readonly openSession: (ptyId: string) => void;
  readonly flashFrame: (flag: boolean) => void;
  /** The badge over the taskbar button: `0` takes it away. */
  readonly setOverlay: (count: number) => void;
}

export interface AttentionNotifier {
  /** The session news of one reduction of the pet core, in order. */
  onNotices(events: readonly BubbleEvent[]): void;
  /** How many sessions wait for the owner, unseen (pending, finished, failed). */
  onWaitingCount(count: number): void;
  /** The main window got the focus: the flash has served. */
  onWindowFocused(): void;
}

export function createAttentionNotifier(deps: AttentionNotifierDeps): AttentionNotifier {
  let flashing = false;
  let overlayCount = 0;
  // keep the notifications referenced until clicked, so they are not collected early (same as the chat's notifier)
  const alive = new Set<NotificationLike>();

  function toast(event: BubbleEvent): void {
    const preference = deps.preference();
    if (!shouldToast({ kind: event.kind, petEnabled: deps.isPetEnabled(), preference, chatCoversPending: deps.chatCoversPending() })) return;
    if (!deps.isSupported()) return;
    try {
      const notification = deps.createNotification(noticeToast(event));
      alive.add(notification);
      notification.on('click', () => {
        alive.delete(notification);
        deps.openSession(event.ptyId);
      });
      notification.show();
    } catch {
      // notifications are optional: never take the app down for one
    }
  }

  return {
    onNotices(events) {
      if (events.length === 0) return;
      for (const event of events) toast(event);
      if (!flashing && shouldFlash({ preference: deps.preference(), windowInFront: deps.isWindowInFront(), notices: events.length })) {
        flashing = true;
        deps.flashFrame(true);
      }
    },

    onWaitingCount(count) {
      const next = Math.max(0, count);
      if (next === overlayCount) return;
      overlayCount = next;
      deps.setOverlay(next);
    },

    onWindowFocused() {
      if (!flashing) return;
      flashing = false;
      deps.flashFrame(false);
    },
  };
}
