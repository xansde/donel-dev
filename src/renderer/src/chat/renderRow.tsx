// T054/T055 (014-chat) - the single point where the timeline turns a row into
// UI. For now every kind renders a minimal plain-text placeholder; the real
// row components (`rows/`, `markdown/`) are wired here after the merge, WITHOUT
// touching Timeline.tsx - `renderRow(row, ctx)` is the whole contract.

import type { ReactNode } from 'react';
import type { RowDetail, RowDetailPart } from '../../../shared/chat/ipc';
import type { ConversationRow, LiveState, RowAttachment } from '../../../shared/chat/rows';
import { ConversationSwitchBanner } from './ReceptionBanner';

export type ImageAttachmentRef = Extract<RowAttachment, { kind: 'image' }>;

/** What a row component may ask of the chat session; built once per tab by `ChatView`. */
export interface RowRenderContext {
  /** Opens an http(s) link in the system browser (the main process applies the link policy). */
  onOpenExternal(url: string): void;
  /** Opens a file Claude generated with the system's default app (the main process allows only document/image types). */
  onOpenGenerated(path: string): void;
  /** Loads the heavy part of a row (full command, output, diff...) on demand. */
  requestDetail(rowId: string, part: RowDetailPart): Promise<RowDetail>;
  /** `donel-asset:` URL of an image inside the transcript. */
  assetUrl(ref: ImageAttachmentRef): string;
  /** The actions folded in an `action-group` row. */
  groupChildren(groupId: string): Promise<readonly ConversationRow[]>;
  /** "abrir" on the "Conversa nova" notice: shows the previous sessions of the project. */
  onOpenPreviousSessions(): void;
  /** Live state of the conversation (`null` until the first one arrives). */
  readonly live: LiveState | null;
}

function placeholderText(row: ConversationRow): string {
  switch (row.kind) {
    case 'user':
      return row.text;
    case 'assistant':
      return row.markdown;
    case 'thinking':
      return 'pensando…';
    case 'action':
      return `${row.tool}`;
    case 'action-group':
      return `${row.children.length} ações`;
    case 'skill':
      return `skill ${row.name}`;
    case 'subagent':
      return `subagente ${row.agentType} — ${row.description}`;
    case 'question':
      return `pergunta (${row.questions.length})`;
    case 'plan':
      return row.markdown;
    case 'shell':
      return `$ ${row.command}`;
    case 'local-command':
      return `/${row.command}`;
    case 'notice':
      return `aviso: ${row.notice}`;
    case 'unknown':
      return `Conteúdo não reconhecido (${row.typeLabel})`;
  }
}

export function renderRow(row: ConversationRow, ctx: RowRenderContext): ReactNode {
  if (row.kind === 'notice' && row.notice === 'conversation-switch') {
    return <ConversationSwitchBanner source={row.params.source} onOpen={ctx.onOpenPreviousSessions} />;
  }
  return (
    <div data-testid={`chat-row-${row.kind}`} data-row-id={row.id} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {placeholderText(row)}
    </div>
  );
}
