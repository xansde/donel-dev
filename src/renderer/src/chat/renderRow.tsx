// T054/T055/T060 (014-chat) - the single point where the timeline turns a row
// into UI: every `kind` renders its real component from `rows/`. Timeline.tsx
// only knows `renderRow(row, ctx)`; the data and callbacks come from the
// `RowRenderContext` that `ChatView` builds once per tab.

import { useEffect, useState, type ReactNode } from 'react';
import type { RowDetail, RowDetailPart } from '../../../shared/chat/ipc';
import type { ActionGroupRow, ConversationRow, LiveState, RowAttachment } from '../../../shared/chat/rows';
import type { SendOverlay } from './composer/optimistic';
import { ConversationSwitchBanner } from './ReceptionBanner';
import {
  ActionGroupView,
  ActionRowView,
  AssistantMessage,
  LocalCommand,
  Notice,
  PlanRowView,
  QuestionRowView,
  ShellRowView,
  SkillBadge,
  SubagentRowView,
  Thinking,
  Unknown,
  UserMessage,
} from './rows';

export type ImageAttachmentRef = Extract<RowAttachment, { kind: 'image' }>;

/** How one `assistant` row sits inside its answer (the run of text blocks of a turn). */
export interface AnswerInfo {
  /** First text block of the answer: shows the "CLAUDE - hh:mm / copiar resposta" header. */
  readonly showHeader: boolean;
  /** Markdown source of the whole answer (`joinAnswerMarkdown` of its blocks). */
  readonly copyMarkdown: string;
}

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
  /** Header and copy source of an assistant row (`undefined`: treat it as a single-block answer). */
  answerInfo(rowId: string): AnswerInfo | undefined;
  /** "abrir" on the "Conversa nova" notice: shows the previous sessions of the project. */
  onOpenPreviousSessions(): void;
  /** Live state of the conversation (`null` until the first one arrives). */
  readonly live: LiveState | null;
  /** Live send state of a message the chat itself sent (T067, D-C11); `undefined` = history. */
  sendOverlay?(rowId: string): SendOverlay | undefined;
  /** "tentar de novo" on a failed send. */
  retrySend?(sendId: string): void;
  /** "descartar" on a failed send: removes the card. */
  discardSend?(sendId: string): void;
}

/** The children of a group are not in the patches: load them once, show the group meanwhile. */
function GroupRow({ row, ctx }: { row: ActionGroupRow; ctx: RowRenderContext }): React.JSX.Element {
  const [children, setChildren] = useState<readonly ConversationRow[]>([]);
  const signature = row.children.join('|');
  useEffect(() => {
    let alive = true;
    ctx.groupChildren(row.id).then(
      (rows) => {
        if (alive) setChildren(rows);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
    // `signature` re-loads when the group gains an action; `ctx.groupChildren` is stable per tab.
  }, [row.id, signature, ctx.groupChildren]);
  return <ActionGroupView row={row} childRows={children} requestDetail={ctx.requestDetail} />;
}

export function renderRow(row: ConversationRow, ctx: RowRenderContext): ReactNode {
  switch (row.kind) {
    case 'user':
    {
      const overlay = ctx.sendOverlay?.(row.id);
      return (
        <UserMessage
          row={row}
          assetUrl={ctx.assetUrl}
          sendState={overlay?.sendState}
          queuedReason={overlay?.queuedReason}
          failedReason={overlay?.failedReason}
          onRetry={overlay?.sendId !== undefined ? () => ctx.retrySend?.(overlay.sendId!) : undefined}
          onDiscard={overlay?.sendId !== undefined ? () => ctx.discardSend?.(overlay.sendId!) : undefined}
        />
      );
    }
    case 'assistant': {
      const info = ctx.answerInfo(row.id);
      return (
        <AssistantMessage
          row={row}
          onOpenExternal={ctx.onOpenExternal}
          showHeader={info?.showHeader ?? true}
          copyMarkdown={info?.copyMarkdown}
        />
      );
    }
    case 'thinking':
      return <Thinking row={row} requestDetail={ctx.requestDetail} />;
    case 'action':
      return <ActionRowView row={row} requestDetail={ctx.requestDetail} />;
    case 'action-group':
      return <GroupRow row={row} ctx={ctx} />;
    case 'skill':
      return <SkillBadge row={row} />;
    case 'subagent':
      return <SubagentRowView row={row} />;
    case 'question':
      return <QuestionRowView row={row} />;
    case 'plan':
      return <PlanRowView row={row} onOpenExternal={ctx.onOpenExternal} />;
    case 'shell': {
      const overlay = ctx.sendOverlay?.(row.id);
      return <ShellRowView row={row} sendState={overlay?.sendState} />;
    }
    case 'local-command':
      return <LocalCommand row={row} />;
    case 'notice':
      if (row.notice === 'conversation-switch') {
        return <ConversationSwitchBanner source={row.params.source} onOpen={ctx.onOpenPreviousSessions} />;
      }
      return <Notice row={row} onOpenGenerated={ctx.onOpenGenerated} />;
    case 'unknown':
      return <Unknown row={row} requestDetail={ctx.requestDetail} />;
  }
}
