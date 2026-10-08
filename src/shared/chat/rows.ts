// T005 (014-chat) — tipos do modelo de dados do chat, conforme
// specs/014-chat/data-model.md §1–§12. Puros e serializáveis: sem Map, Date nem
// funções; instantes em ISO-8601. Cruzam o IPC como estão (ver ./ipc.ts).

// ---------------------------------------------------------------------------
// §3 — entrada do transcript
// ---------------------------------------------------------------------------

/** Endereço de uma linha do JSONL, para reler sob demanda sem guardar o conteúdo. */
export interface LineRef {
  readonly path: string;
  readonly offset: number;
  readonly length: number;
}

export type TranscriptNodeRole = 'user' | 'assistant' | 'system' | 'attachment';

/** `type` conhecidos de linhas-meta; o `string` final cobre tipos que o CLI venha a criar. */
export type TranscriptMetaType =
  | 'permission-mode'
  | 'last-prompt'
  | 'custom-title'
  | 'ai-title'
  | 'queue-operation'
  | 'cost-state'
  | (string & {});

/** Resultado de classificar UMA linha do JSONL (contracts/conversation-rows.md §2). */
export type TranscriptEntry =
  | {
      readonly k: 'node';
      readonly uuid: string;
      readonly parentUuid: string | null;
      readonly logicalParentUuid?: string | null;
      readonly role: TranscriptNodeRole;
      readonly at: string;
      readonly raw: LineRef;
    }
  | {
      readonly k: 'meta';
      readonly type: TranscriptMetaType;
      readonly payload: unknown;
    }
  | {
      readonly k: 'invalid';
      readonly reason: 'json' | 'too-large';
      readonly raw: LineRef;
    };

// ---------------------------------------------------------------------------
// §2 — fonte da conversa
// ---------------------------------------------------------------------------

export interface ConversationSource {
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly cwd: string;
  /** Bytes já consumidos + resto de linha incompleta. Só cresce. */
  readonly forward: { readonly offset: number; readonly partial: string };
  /** Ponto até onde o histórico já foi carregado para trás (FR-010). */
  readonly backward: { readonly offset: number; readonly done: boolean };
  readonly leafUuid: string | null;
  readonly expectedParent: string | null;
}

// ---------------------------------------------------------------------------
// §1 — sessão de chat
// ---------------------------------------------------------------------------

export type ChatProcessState = 'starting' | 'alive' | 'ended';
export type ChatReception = 'ok' | 'missing' | 'stale';
export type ChatPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'auto';
export type ChatView = 'chat' | 'terminal';

export interface ChatSession {
  readonly ptyId: string;
  readonly tabKind: 'claude';
  readonly source: ConversationSource;
  readonly process: ChatProcessState;
  /** Presente quando `process === 'ended'` (FR-034). */
  readonly exitCode?: number | null;
  readonly reception: ChatReception;
  readonly permissionMode: ChatPermissionMode;
  readonly view: ChatView;
  readonly draft: ComposerDraft;
  /** `agentId` aberto no painel lateral (FR-027). */
  readonly subagentPanel: string | null;
}

// ---------------------------------------------------------------------------
// §4 — linha da conversa
// ---------------------------------------------------------------------------

export type ActionCategory =
  | 'read'
  | 'edit'
  | 'write'
  | 'bash'
  | 'search'
  | 'web'
  | 'agent'
  | 'skill'
  | 'mcp'
  | 'task'
  | 'other';

/** Já em português: "Leu" / `src/x.ts`; "Editou" / `App.tsx` / `+12 −3`. */
export interface ActionSummary {
  readonly verb: string;
  readonly target?: string;
  readonly stats?: string;
}

export type ActionStatus = 'running' | 'ok' | 'error' | 'denied' | 'interrupted';

export type NoticeKind =
  | 'compact'
  | 'account-switch'
  | 'limit'
  | 'api-error'
  | 'interrupted'
  | 'conversation-switch'
  | 'informational'
  | 'generated-file';

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'killed' | 'stopped' | 'unknown';

export type RowScope = 'main' | { readonly agentId: string };

export type RowAttachment =
  | { readonly kind: 'image'; readonly ref: LineRef; readonly blockIndex: number }
  | { readonly kind: 'mention'; readonly path: string };

/** Uma pergunta do `AskUserQuestion` (forma do CLI; campos extras preservados em `extra`). */
export interface QuestionOption {
  readonly label: string;
  readonly description?: string;
  /** Prévia em markdown/texto, quando a opção traz uma. */
  readonly preview?: string;
}

export interface Question {
  readonly question: string;
  readonly header?: string;
  readonly multiSelect?: boolean;
  readonly options: readonly QuestionOption[];
}

interface RowBase {
  /** Estável entre recargas: uuid, toolUseId, `group:<id>`, `agent:<id>` ou `app:<evento>`. */
  readonly id: string;
  readonly turnId: string | null;
  /** Só exibição — NUNCA ordenação. */
  readonly at: string;
  readonly scope: RowScope;
}

export interface UserRow extends RowBase {
  readonly kind: 'user';
  readonly text: string;
  readonly attachments: readonly RowAttachment[];
  readonly command?: { readonly name: string; readonly args: string };
  readonly queued?: boolean;
}

export interface AssistantRow extends RowBase {
  readonly kind: 'assistant';
  readonly markdown: string;
  readonly blockIndex: number;
  readonly messageId: string;
}

export interface ThinkingRow extends RowBase {
  readonly kind: 'thinking';
  readonly durationMs?: number;
  readonly hasText: boolean;
}

export interface ActionRow extends RowBase {
  readonly kind: 'action';
  readonly toolUseId: string;
  readonly tool: string;
  readonly category: ActionCategory;
  readonly summary: ActionSummary;
  readonly status: ActionStatus;
  readonly detail?: LineRef;
}

export interface ActionGroupRow extends RowBase {
  readonly kind: 'action-group';
  /** Ids das ações filhas. */
  readonly children: readonly string[];
  readonly counts: Readonly<Record<ActionCategory, number>>;
  /** Ids das ações com `status: 'error'`, visíveis no cabeçalho recolhido. */
  readonly failed: readonly string[];
}

export interface SkillRow extends RowBase {
  readonly kind: 'skill';
  readonly name: string;
  readonly how: 'loaded-by-user' | 'used-by-claude';
}

export interface SubagentRow extends RowBase {
  readonly kind: 'subagent';
  readonly agentId: string;
  readonly toolUseId: string;
  readonly description: string;
  readonly agentType: string;
  readonly model?: string;
  readonly status: SubagentStatus;
  readonly startedAt: string;
  readonly durationMs?: number;
  readonly lastAction?: ActionSummary;
  readonly background: boolean;
  readonly depth: number;
}

export interface QuestionRow extends RowBase {
  readonly kind: 'question';
  readonly questions: readonly Question[];
  readonly answers: Readonly<Record<string, string>>;
}

export interface PlanRow extends RowBase {
  readonly kind: 'plan';
  readonly markdown: string;
  readonly outcome: 'approved' | 'adjust-requested' | 'pending';
}

export interface ShellRow extends RowBase {
  readonly kind: 'shell';
  readonly command: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface LocalCommandRow extends RowBase {
  readonly kind: 'local-command';
  readonly command: string;
  readonly args?: string;
  readonly output?: string;
}

export interface NoticeRow extends RowBase {
  readonly kind: 'notice';
  readonly notice: NoticeKind;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface UnknownRow extends RowBase {
  readonly kind: 'unknown';
  readonly typeLabel: string;
  readonly raw: LineRef;
}

export type ConversationRow =
  | UserRow
  | AssistantRow
  | ThinkingRow
  | ActionRow
  | ActionGroupRow
  | SkillRow
  | SubagentRow
  | QuestionRow
  | PlanRow
  | ShellRow
  | LocalCommandRow
  | NoticeRow
  | UnknownRow;

export type ConversationRowKind = ConversationRow['kind'];

// ---------------------------------------------------------------------------
// §5 — rodada e Modo Foco
// ---------------------------------------------------------------------------

export interface Turn {
  readonly turnId: string;
  readonly opener: 'human' | 'notification' | 'resume';
  readonly rows: readonly string[];
  readonly complete: boolean;
  readonly finalRowId: string | null;
}

/** Saída de `foldForFocus(turns, rows)`. */
export type FocusItem =
  | { readonly kind: 'row'; readonly rowId: string }
  | {
      readonly kind: 'folded';
      readonly actions: number;
      readonly notes: number;
      readonly hasQuestion: boolean;
      readonly rows: readonly string[];
    };

// ---------------------------------------------------------------------------
// §6 / §7 — ação ao vivo e subagente
// ---------------------------------------------------------------------------

export interface LiveAction {
  readonly toolUseId: string;
  readonly tool: string;
  readonly summary: ActionSummary;
  readonly startedAt: string;
  readonly scope: RowScope;
}

export interface SubagentUsage {
  readonly durationMs?: number;
  readonly toolUses?: number;
  readonly subagentTokens?: number;
}

export interface Subagent {
  readonly agentId: string;
  readonly toolUseId: string;
  readonly agentType: string;
  readonly description: string;
  readonly model?: string;
  readonly effort?: string;
  readonly background: boolean;
  readonly depth: number;
  /** Liga o subagente aninhado ao pai. */
  readonly parentAgentId?: string;
  readonly status: SubagentStatus;
  readonly startedAt: string;
  readonly durationMs?: number;
  readonly usage?: SubagentUsage;
  readonly lastAction?: ActionSummary;
  readonly transcriptPath: string;
}

// ---------------------------------------------------------------------------
// §8 — pendência
// ---------------------------------------------------------------------------

export type PendingKind = 'question' | 'permission' | 'plan';

export type PendingState =
  | 'open'
  | 'answered'
  | 'resolved-elsewhere'
  | 'expired'
  | 'cancelled';

export interface QuestionPayload {
  readonly questions: readonly Question[];
}

export interface PermissionSuggestion {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface PermissionPayload {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  /** Diff pré-calculado, quando a ferramenta é de edição. */
  readonly diff?: string;
  readonly permissionSuggestions?: readonly PermissionSuggestion[];
}

export interface PlanPayload {
  readonly markdown: string;
}

export type PendingScope = 'main' | { readonly agentId: string; readonly description: string };

interface PendingBase {
  readonly id: string;
  readonly match: {
    readonly agentId?: string;
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
  };
  readonly toolUseId: string | null;
  readonly scope: PendingScope;
  readonly arrivedAt: string;
  readonly state: PendingState;
}

export type Pending =
  | (PendingBase & { readonly kind: 'question'; readonly payload: QuestionPayload })
  | (PendingBase & { readonly kind: 'permission'; readonly payload: PermissionPayload })
  | (PendingBase & { readonly kind: 'plan'; readonly payload: PlanPayload });

// ---------------------------------------------------------------------------
// §11 — anexos e rascunho (antes de §9 porque Send os usa)
// ---------------------------------------------------------------------------

export interface ImageAttachment {
  readonly id: string;
  readonly mediaType: string;
  readonly path: string;
  readonly width?: number;
  readonly height?: number;
}

export interface PastedText {
  readonly id: string;
  readonly text: string;
  readonly lines: number;
}

export interface ComposerDraft {
  readonly text: string;
  readonly images: readonly ImageAttachment[];
  readonly pastes: readonly PastedText[];
  readonly historyCursor: number | null;
}

// ---------------------------------------------------------------------------
// §9 — envio
// ---------------------------------------------------------------------------

export type SendKind = 'prompt' | 'slash' | 'shell';
export type SendMode = 'normal' | 'interrupt-first';
export type SendState =
  | 'waiting-cli'
  | 'typing'
  | 'confirming'
  | 'queued'
  | 'accepted'
  | 'failed';

export interface Send {
  readonly id: string;
  readonly text: string;
  readonly images: readonly ImageAttachment[];
  readonly kind: SendKind;
  readonly mode: SendMode;
  readonly state: SendState;
  readonly attempts: number;
  readonly createdAt: string;
  readonly confirmedAt?: string;
}

// ---------------------------------------------------------------------------
// §10 — estado vivo
// ---------------------------------------------------------------------------

export type LiveStatus =
  | 'starting'
  | 'idle'
  | 'working'
  | 'waiting-you'
  | 'terminal-needed'
  | 'ended'
  | 'not-receiving';

export type TerminalNeededReason =
  | 'hook-timeout'
  | 'interactive-screen'
  | 'permission-dialog'
  | 'unrecognized';

export interface LiveState {
  readonly status: LiveStatus;
  readonly currentAction: LiveAction | null;
  /** Só as `open`, na ordem de chegada. */
  readonly pendings: readonly Pending[];
  /** Envios ainda não finalizados. */
  readonly sends: readonly Send[];
  /** agentIds `running`. */
  readonly activeSubagents: readonly string[];
  readonly terminalNeeded: { readonly reason: TerminalNeededReason } | null;
}

// ---------------------------------------------------------------------------
// §12 — preferências persistidas
// ---------------------------------------------------------------------------

export interface ChatPrefs {
  readonly enabled: boolean;
  readonly focusMode: boolean;
}
