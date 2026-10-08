// Markdown and code of the chat (T051/T053). Presentational: no IPC here — the
// container passes `onOpenExternal` (→ `chat:open-external`).
export { Markdown } from './Markdown';
export type { MarkdownProps } from './Markdown';
export { ChatCodeBlock } from './CodeBlock';
export type { ChatCodeBlockProps } from './CodeBlock';
export { DiffView } from './DiffView';
export type { DiffViewProps } from './DiffView';
export { joinAnswerMarkdown } from './answerText';
export { useCopyFeedback } from './useCopyFeedback';
