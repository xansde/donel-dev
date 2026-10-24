// Conversation rows (T052/T053). Presentational: NOTHING here calls
// `window.donel.chat` — data and callbacks come in by props, so the next task
// (the timeline/ChatView wiring, T055+) only has to provide the following.
//
// INTERFACE THE WIRING MUST PROVIDE
// ---------------------------------
//   onOpenExternal(url: string): void
//       -> `chat:open-external` { url }. Used by AssistantMessage and PlanRowView
//          (through <Markdown>). Only http(s)/mailto URLs ever reach it.
//   onOpenGenerated(path: string): void
//       -> `chat:open-generated` { ptyId, path }. Used by Notice ("Gerou … — abrir").
//   requestDetail(rowId: string, part: RowDetailPart): Promise<RowDetail>
//       -> `chat:row-detail` { ptyId, scope, rowId, part } (bind ptyId/scope in a
//          closure). Used by ActionRowView, ActionGroupView (children), Thinking,
//          Unknown. Parts and the `RowDetail.text` format expected per part:
//            'diff'        hunks of the transcript `structuredPatch`: `@@ -a,b +c,d @@`
//                          headers, then lines prefixed ' ', '+' or '-' (a created file:
//                          `@@ -0,0 +1,N @@` + N '+' lines). See markdown/unifiedDiff.ts.
//            'output'      command result, <= 40 lines / 8 KB; when the CLI recorded a
//                          failure its first line is "Exit code N" (the only source of
//                          the exit code — D-C3). `truncated: true` enables "ver tudo".
//            'output-full' the same, untruncated (asked after "ver tudo").
//            'files'       search/glob results: `files` (preferred) or one path per line.
//            'raw'         JSON/text of input + output, or the unknown line (<= 4 KB).
//            'content'     the text of a `thinking` block (only asked when hasText).
//   assetUrl(image): string
//       -> a `donel-asset:` URL for a user image block (T046). `image` is the
//          `{ kind: 'image', ref: LineRef, blockIndex }` attachment of the UserRow.
//          Used by UserMessage.
//
// ALSO OWNED BY THE CONTAINER (props, not callbacks)
//   - childRows for ActionGroupView: the rows named by `row.children`, in order.
//   - showHeader/copyMarkdown for AssistantMessage: show the "CLAUDE · hh:mm /
//     copiar resposta" header on the first text block of an answer and pass
//     `joinAnswerMarkdown(all blocks of that answer)` as `copyMarkdown`.
//   - sendState/queuedReason/failedReason/onRetry for UserMessage (live sends only).
//   - onOpen/selected for SubagentRowView (T094; read-only until then).
//   - Durations: the row model carries no per-action duration, so action lines and
//     groups show none; `thinking` shows its own (`durationMs`).
export { UserMessage } from './UserMessage';
export type { UserMessageProps, UserImageAttachment } from './UserMessage';
export { AssistantMessage } from './AssistantMessage';
export type { AssistantMessageProps } from './AssistantMessage';
export { Notice } from './Notice';
export type { NoticeProps } from './Notice';
export { Unknown } from './Unknown';
export type { UnknownProps } from './Unknown';
export { LocalCommand } from './LocalCommand';
export type { LocalCommandProps } from './LocalCommand';
export { ShellRowView } from './ShellRow';
export type { ShellRowViewProps } from './ShellRow';
export { ActionRowView } from './ActionRow';
export type { ActionRowViewProps } from './ActionRow';
export { ActionGroupView } from './ActionGroup';
export type { ActionGroupViewProps } from './ActionGroup';
export { Thinking } from './Thinking';
export type { ThinkingProps } from './Thinking';
export { SkillBadge } from './SkillBadge';
export type { SkillBadgeProps } from './SkillBadge';
export { QuestionRowView } from './QuestionRow';
export type { QuestionRowViewProps } from './QuestionRow';
export { PlanRowView } from './PlanRow';
export type { PlanRowViewProps } from './PlanRow';
export { SubagentRowView } from './SubagentRow';
export type { SubagentRowViewProps } from './SubagentRow';
export { formatClock, formatDuration, progressiveVerb } from './format';
export { useRowDetail } from './useRowDetail';
export type { RequestRowDetail, DetailState } from './useRowDetail';
