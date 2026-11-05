// T006 (014-chat) — canais IPC e payloads do domínio `chat:`, conforme
// specs/014-chat/contracts/ipc-chat.md §1–§2. Tipos de linha, pendência e
// estado vivo vêm de ./rows (data-model.md). Tudo serializável.

import type { SendFailureDetail } from './sendDiagnostics';
import type {
  ChatPermissionMode,
  ChatReception,
  ConversationRow,
  ConversationSource,
  LiveState,
  RowScope,
  TerminalNeededReason,
} from './rows';

export const CHAT_CHANNELS = {
  // Pedidos (renderer -> main, invoke)
  attach: 'chat:attach',
  detach: 'chat:detach',
  loadOlder: 'chat:load-older',
  rowDetail: 'chat:row-detail',
  answer: 'chat:answer',
  subagentOpen: 'chat:subagent-open',
  subagentClose: 'chat:subagent-close',
  catalog: 'chat:catalog',
  files: 'chat:files',
  saveImage: 'chat:save-image',
  ackLookup: 'chat:ack-lookup',
  openExternal: 'chat:open-external',
  openGenerated: 'chat:open-generated',
  focusState: 'chat:focus-state',
  screenState: 'chat:screen-state',
  /** Diagnóstico de um envio que terminou em "não foi" (só o portão, nunca texto) -> `chat-diagnostics.log`. */
  sendFailed: 'chat:send-failed',
  setChatPrefs: 'config:setChatPrefs',
  // Eventos (main -> renderer)
  rows: 'chat:rows',
  live: 'chat:live',
  conversationSwitched: 'chat:conversation-switched',
  promptSignal: 'chat:prompt-signal',
  reception: 'chat:reception',
  /** T079 - o clique na notificação de uma pendência: ativar a aba e pôr o foco no painel. */
  focusPending: 'chat:focus-pending',
} as const;

export type ChatChannel = (typeof CHAT_CHANNELS)[keyof typeof CHAT_CHANNELS];

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

/** Cursor opaco de paginação para trás; só o main o interpreta. */
export type ChatCursor = string;

export interface ChatSnapshot {
  readonly source: ConversationSource;
  readonly rows: readonly ConversationRow[];
  /** `null` = início da conversa já carregado. */
  readonly cursor: ChatCursor | null;
  readonly live: LiveState;
  readonly permissionMode: ChatPermissionMode;
  /** Current reception state, so a late `chat:attach` does not miss the last `chat:reception` event. */
  readonly reception: ChatReception;
}

export type PendingAnswer =
  | { readonly kind: 'allow' }
  | { readonly kind: 'allow-always' }
  | { readonly kind: 'deny'; readonly reason?: string }
  | {
      readonly kind: 'answers';
      readonly answers: Readonly<Record<string, string>>;
      /** Per-question note of the owner (`AskUserQuestion` input `annotations[question].notes`); absent = no note. */
      readonly annotations?: Readonly<Record<string, { readonly notes: string }>>;
    }
  | { readonly kind: 'plan-approve' }
  | { readonly kind: 'plan-adjust'; readonly text: string }
  | { readonly kind: 'interrupt' };

export type RowPatchOp = 'append' | 'replace' | 'prepend' | 'reset';

export interface RowPatch {
  readonly op: RowPatchOp;
  readonly rows: readonly ConversationRow[];
}

export type RowDetailPart = 'diff' | 'output' | 'output-full' | 'files' | 'raw' | 'content';

/**
 * Saída de `chat:row-detail`. O contrato não fixa o formato; aqui é um texto
 * por parte pedida, com marca de truncamento (saída longa vem truncada, salvo
 * `output-full`).
 */
export interface RowDetail {
  readonly part: RowDetailPart;
  readonly text: string;
  readonly truncated: boolean;
  /** Para `files`: lista de caminhos, quando aplicável. */
  readonly files?: readonly string[];
  /** Para uma linha `action-group`: as ações filhas (o grupo da vista agrupada esconde-as dos patches). */
  readonly rows?: readonly ConversationRow[];
}

export type CommandSource = 'builtin' | 'skill' | 'command' | 'plugin';
/** Where the entry comes from (the origin chip of the menu): CLI, `~/.claude`, the project's `.claude`, or a plugin. */
export type CommandScope = 'builtin' | 'user' | 'project' | 'plugin';

export interface CommandEntry {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly source: CommandSource;
  readonly scope: CommandScope;
  readonly opensScreen: boolean;
}

export type PromptSignalKind =
  | 'submit'
  | 'enqueue'
  | 'deliver'
  | 'command'
  | 'shell'
  | 'local'
  | 'unknown-command'
  | 'session-switch'
  | 'compact';

export type ConversationSwitchReason = 'clear' | 'resume' | 'fork';

// ---------------------------------------------------------------------------
// §1 — pedidos (entrada / saída por canal)
// ---------------------------------------------------------------------------

export interface ChatAttachInput { readonly ptyId: string }
export type ChatAttachOutput = ChatSnapshot;

export interface ChatDetachInput { readonly ptyId: string }
export type ChatDetachOutput = void;

export interface ChatLoadOlderInput {
  readonly ptyId: string;
  readonly scope: RowScope;
  readonly cursor: ChatCursor;
}
export interface ChatLoadOlderOutput {
  readonly rows: readonly ConversationRow[];
  /** `null` = início da conversa. */
  readonly cursor: ChatCursor | null;
}

export interface ChatRowDetailInput {
  readonly ptyId: string;
  readonly scope: RowScope;
  readonly rowId: string;
  readonly part: RowDetailPart;
}
export type ChatRowDetailOutput = RowDetail;

export interface ChatAnswerInput {
  readonly ptyId: string;
  readonly pendingId: string;
  readonly answer: PendingAnswer;
}
export type ChatAnswerOutput =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-open' | 'unknown' };

export interface ChatSubagentOpenInput { readonly ptyId: string; readonly agentId: string }
export type ChatSubagentOpenOutput = ChatSnapshot;

export interface ChatSubagentCloseInput { readonly ptyId: string; readonly agentId: string }
export type ChatSubagentCloseOutput = void;

export interface ChatCatalogInput { readonly ptyId: string }
export type ChatCatalogOutput = readonly CommandEntry[];

export interface ChatFilesInput {
  readonly ptyId: string;
  readonly query: string;
  readonly limit: number;
}
/** Caminhos relativos ao `cwd`. */
export type ChatFilesOutput = readonly string[];

export interface ChatSaveImageInput {
  readonly ptyId: string;
  readonly bytes: ArrayBuffer;
  readonly mediaType: string;
}
export interface ChatSaveImageOutput { readonly id: string; readonly path: string }

export interface ChatAckLookupInput {
  readonly ptyId: string;
  readonly text: string;
  /** Instante ISO-8601 a partir do qual procurar. */
  readonly since: string;
}
export interface ChatAckLookupOutput {
  readonly matched: boolean;
  /** Sinal pelo qual o aceite foi achado (contracts/send-protocol.md §7). */
  readonly via?: string;
}

export interface ChatOpenExternalInput { readonly url: string }
export type ChatOpenExternalOutput = void;

export interface ChatOpenGeneratedInput { readonly ptyId: string; readonly path: string }
export type ChatOpenGeneratedOutput = void;

export interface ChatFocusStateInput {
  readonly activePtyId: string | null;
  /** T079 - nome atual de cada aba (`ptyId` -> nome): o título da notificação é o nome da aba, que só o renderer resolve. */
  readonly tabNames?: Readonly<Record<string, string>>;
}
export type ChatFocusStateOutput = void;

/** `chat:screen-state` - fontes de tela (detectores do renderer) que pedem o terminal; `null` = a caixa voltou. */
export interface ChatScreenStateInput {
  readonly ptyId: string;
  readonly terminalNeeded: TerminalNeededReason | null;
}
export type ChatScreenStateOutput = void;

/** `chat:send-failed` - o detalhe do portão de um envio que falhou; o main o filtra campo a campo antes de gravar. */
export interface ChatSendFailedInput {
  readonly ptyId: string;
  readonly detail: SendFailureDetail;
}
export type ChatSendFailedOutput = void;

/** `config:setChatPrefs` — a saída (`AppConfigDto`) é tipada em ../config. */
export interface SetChatPrefsInput {
  readonly enabled?: boolean;
  readonly focusMode?: boolean;
}

// ---------------------------------------------------------------------------
// §2 — eventos (main -> renderer)
// ---------------------------------------------------------------------------

export interface ChatRowsEvent {
  readonly ptyId: string;
  readonly scope: RowScope;
  readonly patches: readonly RowPatch[];
}

export interface ChatLiveEvent {
  readonly ptyId: string;
  readonly live: LiveState;
}

export interface ChatConversationSwitchedEvent {
  readonly ptyId: string;
  readonly sessionId: string;
  readonly reason: ConversationSwitchReason;
}

/** `chat:focus-pending` - clique na notificação: ativar a aba `ptyId` e pôr o foco no painel de pendências. */
export interface ChatFocusPendingEvent {
  readonly ptyId: string;
}

export interface ChatPromptSignalEvent {
  readonly ptyId: string;
  readonly signal: PromptSignalKind;
  readonly text?: string;
  readonly at: string;
  /** `hook` = UserPromptSubmit/SessionStart da ponte; `transcript` = linha do transcript. */
  readonly origin?: 'hook' | 'transcript';
}

export interface ChatReceptionEvent {
  readonly ptyId: string;
  readonly reception: ChatReception;
}
