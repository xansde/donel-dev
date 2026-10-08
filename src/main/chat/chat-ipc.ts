// T045/T048 (014-chat) - IPC handlers of the `chat:` domain. With
// `chat.enabled = false` NOTHING is registered (ipc-chat.md §4): the app is the
// one of before the chat. `enabled` is read once at boot, so flipping the
// preference at runtime takes effect on the next start of the app.
//
// Handlers here: attach, detach, load-older, row-detail, open-external,
// open-generated, ack-lookup (T064), screen-state (T070), answer (T076), focus-state (T079). The
// other contract channels (subagent-*, catalog, files, save-image) belong to later tasks.

import { CHAT_CHANNELS } from '../../shared/chat/ipc';
import type {
  ChatAckLookupInput,
  ChatAckLookupOutput,
  ChatAnswerInput,
  ChatAnswerOutput,
  ChatAttachInput,
  ChatAttachOutput,
  ChatDetachInput,
  ChatFocusStateInput,
  ChatLoadOlderInput,
  ChatLoadOlderOutput,
  ChatOpenExternalInput,
  ChatOpenGeneratedInput,
  ChatRowDetailInput,
  ChatScreenStateInput,
  RowDetail,
} from '../../shared/chat/ipc';
import { isExternalUrlAllowed, isGeneratedFileOpenable } from '../../shared/chat/linkPolicy';
import type { ChatHub } from './chat-hub';

/** The slice of Electron's `ipcMain` used here. */
export interface IpcMainLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface ChatIpcDeps {
  readonly ipcMain: IpcMainLike;
  /** `chat.enabled` from the config, read at boot. */
  readonly enabled: boolean;
  readonly hub: ChatHub;
  /** `shell.openExternal` */
  readonly openExternal: (url: string) => Promise<void>;
  /** `shell.openPath` (resolves to an error message, '' on success) */
  readonly openPath: (path: string) => Promise<string>;
  /** T079 - `chat:focus-state`: the active tab (and tab names) for the notification rule. */
  readonly onFocusState?: (input: ChatFocusStateInput) => void;
}

export interface ChatIpcRegistration {
  readonly registered: boolean;
  /** Removes every handler it registered. */
  dispose(): void;
}

const HANDLED: readonly string[] = [
  CHAT_CHANNELS.attach,
  CHAT_CHANNELS.detach,
  CHAT_CHANNELS.loadOlder,
  CHAT_CHANNELS.rowDetail,
  CHAT_CHANNELS.openExternal,
  CHAT_CHANNELS.openGenerated,
  CHAT_CHANNELS.ackLookup,
  CHAT_CHANNELS.screenState,
  CHAT_CHANNELS.answer,
  CHAT_CHANNELS.focusState,
];

const SCREEN_REASONS: ReadonlySet<string> = new Set(['hook-timeout', 'interactive-screen', 'permission-dialog', 'unrecognized']);

const isString = (v: unknown): v is string => typeof v === 'string';

export function registerChatIpcHandlers(deps: ChatIpcDeps): ChatIpcRegistration {
  if (!deps.enabled) return { registered: false, dispose: () => undefined };
  const { ipcMain, hub } = deps;

  ipcMain.handle(CHAT_CHANNELS.attach, (_e, input: ChatAttachInput): Promise<ChatAttachOutput> => {
    if (!isString(input?.ptyId)) throw new Error('chat:attach: ptyId inválido');
    return hub.attach(input.ptyId);
  });

  ipcMain.handle(CHAT_CHANNELS.detach, (_e, input: ChatDetachInput): void => {
    if (isString(input?.ptyId)) hub.detach(input.ptyId);
  });

  ipcMain.handle(CHAT_CHANNELS.loadOlder, (_e, input: ChatLoadOlderInput): Promise<ChatLoadOlderOutput> => {
    if (!isString(input?.ptyId) || !isString(input.cursor)) return Promise.resolve({ rows: [], cursor: null });
    return hub.loadOlder(input.ptyId, input.scope ?? 'main', input.cursor);
  });

  ipcMain.handle(CHAT_CHANNELS.rowDetail, (_e, input: ChatRowDetailInput): Promise<RowDetail> => {
    if (!isString(input?.ptyId) || !isString(input.rowId)) return Promise.resolve({ part: input?.part ?? 'raw', text: '', truncated: false });
    return hub.rowDetail(input);
  });

  ipcMain.handle(CHAT_CHANNELS.openExternal, async (_e, input: ChatOpenExternalInput): Promise<void> => {
    if (!isString(input?.url) || !isExternalUrlAllowed(input.url)) return;
    await deps.openExternal(input.url);
  });

  ipcMain.handle(CHAT_CHANNELS.openGenerated, async (_e, input: ChatOpenGeneratedInput): Promise<void> => {
    if (!isString(input?.ptyId) || !isString(input.path)) return;
    if (!isGeneratedFileOpenable(input.path, hub.generatedFileRoots(input.ptyId))) return;
    await deps.openPath(input.path);
  });

  ipcMain.handle(CHAT_CHANNELS.ackLookup, (_e, input: ChatAckLookupInput): Promise<ChatAckLookupOutput> => {
    if (!isString(input?.ptyId) || !isString(input.text) || !isString(input.since)) return Promise.resolve({ matched: false });
    return hub.ackLookup(input.ptyId, input.text, input.since);
  });

  ipcMain.handle(CHAT_CHANNELS.screenState, (_e, input: ChatScreenStateInput): void => {
    if (!isString(input?.ptyId)) return;
    const reason = input.terminalNeeded;
    if (reason === null || SCREEN_REASONS.has(reason)) hub.reportScreenState(input.ptyId, reason);
  });

  ipcMain.handle(CHAT_CHANNELS.answer, (_e, input: ChatAnswerInput): ChatAnswerOutput => {
    if (!isString(input?.ptyId) || !isString(input.pendingId) || input.answer === null || typeof input.answer !== 'object') {
      return { ok: false, reason: 'unknown' };
    }
    return hub.answer(input.ptyId, input.pendingId, input.answer);
  });

  ipcMain.handle(CHAT_CHANNELS.focusState, (_e, input: ChatFocusStateInput): void => {
    if (input === null || typeof input !== 'object') return;
    if (input.activePtyId !== null && !isString(input.activePtyId)) return;
    const names: Record<string, string> = {};
    if (input.tabNames !== undefined && input.tabNames !== null && typeof input.tabNames === 'object') {
      for (const [key, value] of Object.entries(input.tabNames)) if (isString(value)) names[key] = value;
    }
    deps.onFocusState?.({ activePtyId: input.activePtyId ?? null, tabNames: names });
  });

  return {
    registered: true,
    dispose: () => {
      for (const channel of HANDLED) ipcMain.removeHandler(channel);
    },
  };
}
