// T079 (014-chat, R23) - system notification when a pending opens. The decision is pure
// (`shouldNotifyPending`); the Electron pieces (Notification, window focus, config) are injected,
// so `createPendingNotifier` is tested with fakes. Notification text is built by
// `pendingNotificationBody` (D-C17: never carries command, question or content).

import type { NotificationPreference } from '../../shared/config';
import type { Pending } from '../../shared/chat/rows';
import { pendingNotificationBody } from '../../shared/chat/pendingText';

export interface NotifyDecisionInput {
  readonly preference: NotificationPreference;
  readonly windowFocused: boolean;
  /** Active tab reported by `chat:focus-state`; `null` = unknown / no tab. */
  readonly activePtyId: string | null;
  readonly ptyId: string;
}

/**
 * Notify when the window is out of focus OR the tab is not the active one (FR-024).
 * A pending counts as a permission: `all` and `permission-only` notify, `none` does not.
 */
export function shouldNotifyPending(input: NotifyDecisionInput): boolean {
  if (input.preference === 'none') return false;
  return !input.windowFocused || input.activePtyId !== input.ptyId;
}

export interface NotificationLike {
  on(event: 'click', listener: () => void): void;
  show(): void;
}

export interface PendingNotifierDeps {
  readonly preference: () => NotificationPreference;
  /**
   * 015-jobu-pet (R8): the Jobu is on screen. He says it with a bubble, so the system notification would be
   * the same news twice (FR-020): with him on, it stays quiet - also while he is silenced or hidden by a
   * full-screen app, so nothing pops up over a presentation. Off or hidden by the owner, it is back as before.
   */
  readonly isPetEnabled: () => boolean;
  readonly isWindowFocused: () => boolean;
  readonly isSupported: () => boolean;
  readonly create: (options: { title: string; body: string }) => NotificationLike;
  /** Click: focus the window, activate the tab and focus the pending panel. */
  readonly onClick: (ptyId: string) => void;
}

export interface PendingNotifier {
  /** `chat:focus-state`. */
  setFocusState(activePtyId: string | null, tabNames?: Readonly<Record<string, string>>): void;
  notifyPending(ptyId: string, pending: Pending): boolean;
}

const FALLBACK_TITLE = 'Donel Dev';

export function createPendingNotifier(deps: PendingNotifierDeps): PendingNotifier {
  let activePtyId: string | null = null;
  let tabNames: Readonly<Record<string, string>> = {};
  // keep the notifications referenced until clicked/closed, so they are not collected early
  const alive = new Set<NotificationLike>();

  return {
    setFocusState(active, names) {
      activePtyId = active;
      if (names !== undefined) tabNames = names;
    },
    notifyPending(ptyId, pending) {
      if (deps.isPetEnabled()) return false;
      if (!deps.isSupported()) return false;
      if (!shouldNotifyPending({ preference: deps.preference(), windowFocused: deps.isWindowFocused(), activePtyId, ptyId })) return false;
      try {
        const title = tabNames[ptyId] ?? FALLBACK_TITLE;
        const notification = deps.create({ title, body: pendingNotificationBody(pending) });
        alive.add(notification);
        notification.on('click', () => {
          alive.delete(notification);
          deps.onClick(ptyId);
        });
        notification.show();
        return true;
      } catch {
        return false; // notifications are optional - never take the hub down
      }
    },
  };
}
