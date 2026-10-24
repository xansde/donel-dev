import { ActionLine } from '@donel-dev/design-system';
import { memo, useState } from 'react';
import type { ThinkingRow } from '../../../../shared/chat/rows';
import { formatDuration } from './format';
import styles from './rows.module.css';
import { useRowDetail } from './useRowDetail';
import type { RequestRowDetail } from './useRowDetail';

export interface ThinkingProps {
  row: ThinkingRow;
  /** `chat:row-detail` with part `content` — only asked when `hasText`. */
  requestDetail: RequestRowDetail;
}

/**
 * "Pensou · 6 s" (T053). D-C5: chevron and expansion exist ONLY when the row
 * has text (`hasText`); otherwise the line is fixed.
 */
function ThinkingImpl({ row, requestDetail }: ThinkingProps) {
  const [expanded, setExpanded] = useState(false);
  const { states, load } = useRowDetail(requestDetail, row.id);
  const content = states.content;

  const toggle = () => {
    if (!expanded) load('content');
    setExpanded(!expanded);
  };

  return (
    <ActionLine
      category="thinking"
      verb="Pensou"
      duration={formatDuration(row.durationMs) || undefined}
      expanded={expanded}
      onToggle={row.hasText ? toggle : undefined}
    >
      {content?.status === 'ready' ? (
        <p className={styles.thinkingText}>{content.detail.text}</p>
      ) : (
        <div className={styles.note}>{content?.status === 'error' ? 'Não foi possível carregar.' : 'carregando…'}</div>
      )}
    </ActionLine>
  );
}

export const Thinking = memo(ThinkingImpl);
