// T049 (014-chat) - `window.donel.chat`: the part of the chat IPC contract
// (contracts/ipc-chat.md) that exists in the preload. Event subscriptions follow
// the preload rule of ONE subscriber per channel (subscribeChannel.ts): the
// renderer's single `ChatStore` is that subscriber and fans out by `ptyId`.

import type {
  ChatAckLookupOutput,
  ChatAnswerOutput,
  PendingAnswer,
  ChatConversationSwitchedEvent,
  ChatLiveEvent,
  ChatLoadOlderOutput,
  ChatPromptSignalEvent,
  ChatReceptionEvent,
  ChatRowDetailInput,
  ChatRowsEvent,
  ChatSnapshot,
  RowDetail,
} from './ipc';
import type { RowScope, TerminalNeededReason } from './rows';

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

  /** Aceite tardio: o texto entrou desde `since` (ISO)? Procura nos `UserPromptSubmit` guardados e no transcript. */
  ackLookup(ptyId: string, text: string, since: string): Promise<ChatAckLookupOutput>;
  /** Resposta do dono a uma pendência aberta (`chat:answer`). `not-open` = alguém respondeu antes. */
  answer(ptyId: string, pendingId: string, answer: PendingAnswer): Promise<ChatAnswerOutput>;
  /** Fontes de tela que pedem o terminal (`null` = a caixa voltou); o main as combina com as dos hooks. */
  screenState(ptyId: string, terminalNeeded: TerminalNeededReason | null): Promise<void>;

  onRows(listener: (event: ChatRowsEvent) => void): () => void;
  onLive(listener: (event: ChatLiveEvent) => void): () => void;
  onConversationSwitched(listener: (event: ChatConversationSwitchedEvent) => void): () => void;
  onReception(listener: (event: ChatReceptionEvent) => void): () => void;
  onPromptSignal(listener: (event: ChatPromptSignalEvent) => void): () => void;
}
