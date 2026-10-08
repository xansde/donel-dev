import { ActionLine } from '@donel-dev/design-system';
import { memo, useState } from 'react';
import type { QuestionRow } from '../../../../shared/chat/rows';
import styles from './rows.module.css';

export interface QuestionRowViewProps {
  row: QuestionRow;
}

const MAX_OBJECT_CHARS = 80;

function clip(text: string): string {
  return text.length > MAX_OBJECT_CHARS ? `${text.slice(0, MAX_OBJECT_CHARS - 1)}…` : text;
}

/**
 * A question the Claude asked (`AskUserQuestion`), already in the conversation
 * (T053): an `ActionLine` with the first question and the outcome; opening it
 * lists each question with its answer. The live panel is another task.
 */
function QuestionRowViewImpl({ row }: QuestionRowViewProps) {
  const [expanded, setExpanded] = useState(false);
  const first = row.questions[0];
  const answered = Object.keys(row.answers).length > 0;
  const extra = row.questions.length - 1;
  const object = first ? `${clip(first.header ?? first.question)}${extra > 0 ? ` (+${extra})` : ''}` : undefined;

  return (
    <ActionLine
      category="tool"
      verb="Perguntou"
      object={object}
      statusText={answered ? undefined : '— aguardando resposta'}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
    >
      <div className={styles.qaList}>
        {row.questions.map((question) => (
          <div key={question.question}>
            <div className={styles.qaQuestion}>{question.question}</div>
            <div className={styles.qaAnswer}>{row.answers[question.question] ?? '—'}</div>
          </div>
        ))}
      </div>
    </ActionLine>
  );
}

export const QuestionRowView = memo(QuestionRowViewImpl);
