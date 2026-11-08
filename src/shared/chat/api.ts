// T049 (014-chat) - `window.donel.chat`: the part of the chat IPC contract
// (contracts/ipc-chat.md) that exists in the preload. Event subscriptions follow
// the preload rule of ONE subscriber per channel (subscribeChannel.ts): the
// renderer's single `ChatStore` is that subscriber and fans out by `ptyId`.

import type {
  ChatAckLookupOutput,
  ChatAnswerOutput,
  ChatCatalogOutput,
  ChatFilesOutput,
  ChatFocusPendingEvent,
  ChatConversationSwitchedEvent,
  ChatLiveEvent,
  ChatLoadOlderOutput,
  ChatPromptSignalEvent,
  ChatReceptionEvent,
  ChatRowDetailInput,
  ChatRowsEvent,
  ChatSaveImageOutput,
  ChatSnapshot,
  PendingAnswer,
  RowDetail,
} from './ipc';
import type { RowScope, TerminalNeededReason } from './rows';
import type { SendFailureDetail } from './sendDiagnostics';

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

  /** T084 - entradas do menu `/` (nativos + disco + `skill_listing`), com cache por pasta no main. `/login` e `/logout` não vêm: ver `inspectTypedCommand`. */
  catalog(ptyId: string): Promise<ChatCatalogOutput>;
  /** T086 - arquivos do projeto para o menu `@`, relativos ao `cwd` da aba, já ranqueados pela consulta. */
  files(ptyId: string, query: string, limit: number): Promise<ChatFilesOutput>;

  /** T088 - grava a imagem colada/arrastada em `userData/chat-attachments/<sessionId>/` e devolve o caminho absoluto (o main valida tipo e tamanho). */
  saveImage(ptyId: string, bytes: ArrayBuffer, mediaType: string): Promise<ChatSaveImageOutput>;
  /** T088 - caminho no disco de um `File` do seletor/arraste (Electron: `webUtils`); `''` quando o arquivo nao tem caminho. */
  pathForFile(file: unknown): string;

  /** Aceite tardio: o texto entrou desde `since` (ISO)? Procura nos `UserPromptSubmit` guardados e no transcript. */
  ackLookup(ptyId: string, text: string, since: string): Promise<ChatAckLookupOutput>;
  /** Fontes de tela que pedem o terminal (`null` = a caixa voltou); o main as combina com as dos hooks. */
  screenState(ptyId: string, terminalNeeded: TerminalNeededReason | null): Promise<void>;
  /** Envio que terminou em "não foi": o detalhe do portão vai para o `chat-diagnostics.log` (nunca texto). */
  sendFailed(ptyId: string, detail: SendFailureDetail): Promise<void>;
  /** 08/11 — text the app erased from the terminal box: the main keeps it in userData and says so in the chat. */
  boxCleared?(ptyId: string, text: string): Promise<void>;

  /** T076 - responde a pendência aberta; o renderer nunca monta o JSON do hook. */
  answer(ptyId: string, pendingId: string, answer: PendingAnswer): Promise<ChatAnswerOutput>;
  /** T079 - aba ativa e nomes das abas, para a regra de notificação; o main lê o foco da janela por conta própria. */
  focusState(activePtyId: string | null, tabNames?: Readonly<Record<string, string>>): Promise<void>;
  /** T079 - clique na notificação de uma pendência. Um só assinante (o `App`). */
  onFocusPending(listener: (event: ChatFocusPendingEvent) => void): () => void;

  onRows(listener: (event: ChatRowsEvent) => void): () => void;
  onLive(listener: (event: ChatLiveEvent) => void): () => void;
  onConversationSwitched(listener: (event: ChatConversationSwitchedEvent) => void): () => void;
  onReception(listener: (event: ChatReceptionEvent) => void): () => void;
  onPromptSignal(listener: (event: ChatPromptSignalEvent) => void): () => void;
}
