// T049 (014-chat) - `window.donel.chat`: the part of the chat IPC contract
// (contracts/ipc-chat.md) that exists in the preload. Event subscriptions follow
// the preload rule of ONE subscriber per channel (subscribeChannel.ts): the
// renderer's single `ChatStore` is that subscriber and fans out by `ptyId`.

import type {
  ChatConversationSwitchedEvent,
  ChatLiveEvent,
  ChatLoadOlderOutput,
  ChatReceptionEvent,
  ChatRowDetailInput,
  ChatRowsEvent,
  ChatSnapshot,
  RowDetail,
} from './ipc';
import type { RowScope } from './rows';

export interface DonelChatApi {
  /** First page from the end of the tab's conversation. Idempotent. */
  attach(ptyId: string): Promise<ChatSnapshot>;
  detach(ptyId: string): Promise<void>;
  loadOlder(ptyId: string, scope: RowScope, cursor: string): Promise<ChatLoadOlderOutput>;
  rowDetail(input: ChatRowDetailInput): Promise<RowDetail>;
  /** Only `http:`/`https:` are opened (checked again in the main). */
  openExternal(url: string): Promise<void>;
  /** Document/image files inside the tab's cwd or the attachments folder only. */
  openGenerated(ptyId: string, path: string): Promise<void>;

  onRows(listener: (event: ChatRowsEvent) => void): () => void;
  onLive(listener: (event: ChatLiveEvent) => void): () => void;
  onConversationSwitched(listener: (event: ChatConversationSwitchedEvent) => void): () => void;
  onReception(listener: (event: ChatReceptionEvent) => void): () => void;
}
