import { MessageHeader } from '@donel-dev/design-system';
import { memo } from 'react';
import type { AssistantRow } from '../../../../shared/chat/rows';
import { Markdown, useCopyFeedback } from '../markdown';
import { formatClock } from './format';
import styles from './rows.module.css';

export interface AssistantMessageProps {
  row: AssistantRow;
  onOpenExternal: (url: string) => void;
  /** Header "CLAUDE · hh:mm" + "copiar resposta". Only the first block of an answer shows it. */
  showHeader?: boolean;
  /** "Claude" in the conversation, "Subagente" in the side panel. */
  label?: string;
  /**
   * Markdown copied by "copiar resposta". One answer is split in several rows
   * (one per text block): the container passes `joinAnswerMarkdown` of all of
   * them. Defaults to this block's own markdown.
   */
  copyMarkdown?: string;
}

/**
 * Text of the assistant (T052): open text on `--bg-app` under the header
 * (decision A), markdown from `Markdown`. Copy = the markdown SOURCE (D-C9).
 */
function AssistantMessageImpl({ row, onOpenExternal, showHeader = true, label, copyMarkdown }: AssistantMessageProps) {
  const { copied, copy } = useCopyFeedback();
  return (
    <article className={styles.answer} aria-label={label === 'Subagente' ? 'Resposta do subagente' : 'Resposta do Claude'}>
      {showHeader ? (
        <MessageHeader
          label={label}
          time={formatClock(row.at)}
          copied={copied}
          onCopy={() => void copy(copyMarkdown ?? row.markdown)}
        />
      ) : null}
      <Markdown source={row.markdown} onOpenExternal={onOpenExternal} />
    </article>
  );
}

export const AssistantMessage = memo(AssistantMessageImpl);
