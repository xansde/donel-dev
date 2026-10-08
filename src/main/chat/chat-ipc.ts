// T045/T048 (014-chat) - IPC handlers of the `chat:` domain. With
// `chat.enabled = false` NOTHING is registered (ipc-chat.md §4): the app is the
// one of before the chat. `enabled` is read once at boot, so flipping the
// preference at runtime takes effect on the next start of the app.
//
// Handlers here: attach, detach, load-older, row-detail, open-external,
// open-generated, ack-lookup (T064), screen-state (T070), save-image (T088). The other contract
// channels (answer, subagent-*, catalog, files, save-image, focus-state) belong to later tasks.

import { CHAT_CHANNELS } from '../../shared/chat/ipc';
import type {
  ChatAckLookupInput,
  ChatAckLookupOutput,
  ChatAttachInput,
  ChatAttachOutput,
  ChatDetachInput,
  ChatLoadOlderInput,
  ChatLoadOlderOutput,
  ChatOpenExternalInput,
  ChatOpenGeneratedInput,
  ChatRowDetailInput,
  ChatSaveImageInput,
  ChatSaveImageOutput,
  ChatScreenStateInput,
  RowDetail,
} from '../../shared/chat/ipc';
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
  /** `shell.openExternal` */
  readonly openExternal: (url: string) => Promise<void>;
  /** `shell.openPath` (resolves to an error message, '' on success) */
  readonly openPath: (path: string) => Promise<string>;
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
  CHAT_CHANNELS.saveImage,
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

  return {
    registered: true,
    dispose: () => {
      for (const channel of HANDLED) ipcMain.removeHandler(channel);
    },
  };
}
