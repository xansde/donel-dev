// T056 (014-chat) - which view a tab shows. `TabState.view` is the explicit
// choice; without one, a `claude` tab (not a login tab) opens on the chat as
// long as `chat.enabled` is on. Everything else is the terminal, exactly as the
// app behaved before the chat existed.

import type { ChatView } from '../../../shared/chat/rows';

export interface TabViewInput {
  readonly sessionType: 'claude' | 'shell';
  readonly accountLoginId?: string;
  readonly view?: ChatView;
}

export function hasChatView(tab: Pick<TabViewInput, 'sessionType' | 'accountLoginId'>, chatEnabled: boolean): boolean {
  return chatEnabled && tab.sessionType === 'claude' && !tab.accountLoginId;
}

export function effectiveTabView(tab: TabViewInput, chatEnabled: boolean): ChatView {
  if (!hasChatView(tab, chatEnabled)) return 'terminal';
  return tab.view ?? 'chat';
}

export const nextTabView = (view: ChatView): ChatView => (view === 'chat' ? 'terminal' : 'chat');

export interface ShortcutKey {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/** Ctrl+` (the backtick is a dead key on some layouts, hence the physical `code`). */
export function shouldHandleViewShortcut(event: ShortcutKey): boolean {
  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  return event.key === '`' || event.code === 'Backquote';
}
