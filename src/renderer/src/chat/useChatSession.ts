// T049 (014-chat) - `useChatSession(ptyId)`: the React view of one tab's
// conversation. Mounting subscribes (the store attaches on the first
// subscriber), unmounting detaches on the last. Pass `null` for a tab that has
// no chat (shell tab, chat disabled): the hook then returns an idle state and
// touches no IPC.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { RowDetail, RowDetailPart } from '../../../shared/chat/ipc';
import type { ConversationRow } from '../../../shared/chat/rows';
import { getChatStore, type ChatSessionState, type ChatStore } from './ChatStore';

const NOOP_UNSUBSCRIBE = (): void => undefined;
const IDLE: ChatSessionState = {
  ptyId: '',
  status: 'idle',
  rows: [],
  cursor: null,
  loadingOlder: false,
  live: null,
  reception: 'ok',
  permissionMode: 'default',
  source: null,
  error: null,
  conversationVersion: 0,
};

export interface ChatSession extends ChatSessionState {
  /** Loads the next older page (no-op while loading or at the start of the conversation). */
  loadOlder(): Promise<void>;
  rowDetail(rowId: string, part: RowDetailPart): Promise<RowDetail>;
  /** The actions folded in an `action-group` row. */
  groupChildren(groupId: string): Promise<readonly ConversationRow[]>;
  openExternal(url: string): Promise<void>;
  openGenerated(path: string): Promise<void>;
}

export function useChatSession(ptyId: string | null, store: ChatStore = getChatStore()): ChatSession {
  const subscribe = useCallback(
    (onChange: () => void) => (ptyId === null ? NOOP_UNSUBSCRIBE : store.subscribe(ptyId, onChange)),
    [store, ptyId],
  );
  const getSnapshot = useCallback(() => (ptyId === null ? IDLE : store.getState(ptyId)), [store, ptyId]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return useMemo<ChatSession>(
    () => ({
      ...state,
      loadOlder: () => (ptyId === null ? Promise.resolve() : store.loadOlder(ptyId)),
      rowDetail: (rowId, part) =>
        ptyId === null ? Promise.resolve({ part, text: '', truncated: false }) : store.rowDetail(ptyId, rowId, part),
      groupChildren: (groupId) => (ptyId === null ? Promise.resolve([]) : store.groupChildren(ptyId, groupId)),
      openExternal: (url) => store.openExternal(url),
      openGenerated: (path) => (ptyId === null ? Promise.resolve() : store.openGenerated(ptyId, path)),
    }),
    [state, store, ptyId],
  );
}
