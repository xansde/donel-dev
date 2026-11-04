// T045/T048 (014-chat) - IPC handlers of the `chat:` domain. With
// `chat.enabled = false` NOTHING is registered (ipc-chat.md §4): the app is the
// one of before the chat. `enabled` is read once at boot, so flipping the
// preference at runtime takes effect on the next start of the app.
//
// Handlers here: attach, detach, load-older, row-detail, open-external,
// open-generated, ack-lookup (T064), screen-state (T070), send-failed, answer (T076), focus-state (T079), save-image
// (T088), catalog (T084) and files (T086). The other contract channel (subagent-*) belongs to a later task.

import { CHAT_CHANNELS } from '../../shared/chat/ipc';
import type {
  ChatAckLookupInput,
  ChatAckLookupOutput,
  ChatAnswerInput,
  ChatAnswerOutput,
  ChatAttachInput,
  ChatAttachOutput,
  ChatCatalogInput,
  ChatCatalogOutput,
  ChatDetachInput,
  ChatFilesInput,
  ChatFilesOutput,
  ChatFocusStateInput,
  ChatLoadOlderInput,
  ChatLoadOlderOutput,
  ChatOpenExternalInput,
  ChatOpenGeneratedInput,
  ChatRowDetailInput,
  ChatSaveImageInput,
  ChatSaveImageOutput,
  ChatScreenStateInput,
  ChatSendFailedInput,
  RowDetail,
} from '../../shared/chat/ipc';
import { sanitizeSendFailure, type SendFailureDetail } from '../../shared/chat/sendDiagnostics';
import { isExternalUrlAllowed, isGeneratedFileOpenable } from '../../shared/chat/linkPolicy';
import type { AttachmentStore } from './attachments';
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
  /** T088 - where `chat:save-image` writes. Without it the channel is not registered. */
  readonly attachments?: AttachmentStore;
  /** T084 - `chat:catalog`: the `/` menu entries for the tab's folder and conversation. Without it the channel is not registered. */
  readonly catalog?: (cwd: string, transcriptPath: string | null) => Promise<ChatCatalogOutput>;
  /** T086 - `chat:files`: ranked project files for the `@` menu. Without it the channel is not registered. */
  readonly files?: (cwd: string, query: string, limit: number) => Promise<ChatFilesOutput>;
  /** `shell.openExternal` */
  readonly openExternal: (url: string) => Promise<void>;
  /** `shell.openPath` (resolves to an error message, '' on success) */
  readonly openPath: (path: string) => Promise<string>;
  /** T079 - `chat:focus-state`: the active tab (and tab names) for the notification rule. */
  readonly onFocusState?: (input: ChatFocusStateInput) => void;
  /** `chat:send-failed`: a send ended in `failed`; the detail arrives already sanitized (goes to `chat-diagnostics.log`). */
  readonly onSendFailed?: (entry: { ptyId: string; reason: string; detail: SendFailureDetail }) => void;
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
  CHAT_CHANNELS.sendFailed,
  CHAT_CHANNELS.answer,
  CHAT_CHANNELS.focusState,
  CHAT_CHANNELS.saveImage,
  CHAT_CHANNELS.catalog,
  CHAT_CHANNELS.files,
];

const SCREEN_REASONS: ReadonlySet<string> = new Set(['hook-timeout', 'interactive-screen', 'permission-dialog', 'unrecognized']);

const isString = (v: unknown): v is string => typeof v === 'string';

export function registerChatIpcHandlers(deps: ChatIpcDeps): ChatIpcRegistration {
  if (!deps.enabled) return { registered: false, dispose: () => undefined };
  const { ipcMain, hub } = deps;

  // Item 18 — more than one window may follow the same conversation (the main window and the floating window of
  // the Líder). The hub has one session per tab, so it is detached only when the LAST window lets go of it.
  const holders = new Map<string, Set<number>>();
  const release = (ptyId: string, senderId: number): void => {
    const set = holders.get(ptyId);
    if (set === undefined || !set.delete(senderId)) return;
    if (set.size > 0) return;
    holders.delete(ptyId);
    hub.detach(ptyId);
  };
  const watched = new Set<number>();

  ipcMain.handle(CHAT_CHANNELS.attach, (e, input: ChatAttachInput): Promise<ChatAttachOutput> => {
    if (!isString(input?.ptyId)) throw new Error('chat:attach: ptyId inválido');
    const senderId = e.sender.id;
    let set = holders.get(input.ptyId);
    if (set === undefined) {
      set = new Set();
      holders.set(input.ptyId, set);
    }
    set.add(senderId);
    if (!watched.has(senderId)) {
      watched.add(senderId);
      // A window that goes away lets go of everything it held.
      e.sender.once('destroyed', () => {
        watched.delete(senderId);
        for (const ptyId of [...holders.keys()]) release(ptyId, senderId);
      });
    }
    return hub.attach(input.ptyId);
  });

  ipcMain.handle(CHAT_CHANNELS.detach, (e, input: ChatDetachInput): void => {
    if (isString(input?.ptyId)) release(input.ptyId, e.sender.id);
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

  ipcMain.handle(CHAT_CHANNELS.sendFailed, (_e, input: ChatSendFailedInput): void => {
    if (!isString(input?.ptyId)) return;
    const detail = sanitizeSendFailure(input.detail);
    if (detail === null) return;
    deps.onSendFailed?.({ ptyId: input.ptyId, reason: detail.reason, detail });
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

  const { attachments } = deps;
  if (attachments !== undefined) {
    ipcMain.handle(CHAT_CHANNELS.saveImage, async (_e, input: ChatSaveImageInput): Promise<ChatSaveImageOutput> => {
      if (!isString(input?.ptyId) || !isString(input.mediaType)) throw new Error('chat:save-image: pedido inválido');
      const bytes: unknown = input.bytes;
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new Error('chat:save-image: bytes inválidos');
      // The folder is named by the main (the tab's conversation), never by the renderer.
      const sessionId = hub.sessionIdOf(input.ptyId);
      if (sessionId === null) throw new Error('chat:save-image: a conversa da aba ainda não começou');
      const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return attachments.save(input.ptyId, sessionId, view, input.mediaType);
    });
  }

  const { catalog, files } = deps;
  if (catalog !== undefined) {
    ipcMain.handle(CHAT_CHANNELS.catalog, async (_e, input: ChatCatalogInput): Promise<ChatCatalogOutput> => {
      if (!isString(input?.ptyId)) return [];
      // The folder and the transcript are the tab's (known by the main), never taken from the renderer.
      const cwd = hub.cwdOf(input.ptyId);
      return catalog(cwd ?? '', hub.transcriptPathOf(input.ptyId));
    });
  }

  if (files !== undefined) {
    ipcMain.handle(CHAT_CHANNELS.files, async (_e, input: ChatFilesInput): Promise<ChatFilesOutput> => {
      if (!isString(input?.ptyId)) return [];
      const cwd = hub.cwdOf(input.ptyId);
      if (cwd === null) return [];
      const query = isString(input.query) ? input.query.slice(0, 200) : '';
      const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, Math.floor(input.limit))) : 50;
      return files(cwd, query, limit);
    });
  }

  return {
    registered: true,
    dispose: () => {
      for (const channel of HANDLED) ipcMain.removeHandler(channel);
    },
  };
}
