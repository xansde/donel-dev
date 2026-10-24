import { ActionLine } from '@donel-dev/design-system';
import { memo, useState } from 'react';
import type { PlanRow } from '../../../../shared/chat/rows';
import { Markdown } from '../markdown';
import styles from './rows.module.css';

export interface PlanRowViewProps {
  row: PlanRow;
  onOpenExternal: (url: string) => void;
}

const OUTCOME_TEXT: Readonly<Record<PlanRow['outcome'], string>> = {
  approved: '— aprovado',
  'adjust-requested': '— ajuste pedido',
  pending: '— aguardando você',
};

/**
 * A plan the Claude proposed (`ExitPlanMode`) already in the conversation
 * (T053): an `ActionLine` born collapsed, with the outcome; opening it shows the
 * plan's markdown and nothing computed (D-C16). The live approval panel is
 * another task.
 */
function PlanRowViewImpl({ row, onOpenExternal }: PlanRowViewProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ActionLine
      category="tool"
      verb="Propôs um plano"
      statusText={OUTCOME_TEXT[row.outcome]}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
    >
      <div className={styles.planBody}>
        <Markdown source={row.markdown} onOpenExternal={onOpenExternal} />
      </div>
    </ActionLine>
  );
}

export const PlanRowView = memo(PlanRowViewImpl);
