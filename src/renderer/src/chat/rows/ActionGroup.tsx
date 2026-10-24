import { ActionGroup as ActionGroupFrame, ActionLine } from '@donel-dev/design-system';
import { memo, useState } from 'react';
import type { ActionGroupRow, ActionRow, ConversationRow, ThinkingRow } from '../../../../shared/chat/rows';
import { groupLabel } from '../../../../shared/chat/grouping';
import { ActionRowView } from './ActionRow';
import { dsActionCategory, progressiveVerb } from './format';
import styles from './rows.module.css';
import { Thinking } from './Thinking';
import type { RequestRowDetail } from './useRowDetail';

export interface ActionGroupViewProps {
  row: ActionGroupRow;
  /**
   * The rows named by `row.children`, in order (actions and the `thinking` rows
   * absorbed between them). Resolved by the container from its row index.
   */
  childRows: readonly ConversationRow[];
  requestDetail: RequestRowDetail;
}

type GroupChild = ActionRow | ThinkingRow;

function isGroupChild(row: ConversationRow): row is GroupChild {
  return row.kind === 'action' || row.kind === 'thinking';
}

/**
 * "N ações — …" (T053, decision B, D-C1): born COLLAPSED, with the failed
 * actions lifted into the header (visible without opening) and the action that
 * is still running shown right under it. Expanding shows every child line.
 * The label and numbers come from `groupLabel` (D-C2) — the model has no
 * per-action duration, so no total time is shown.
 */
function ActionGroupViewImpl({ row, childRows, requestDetail }: ActionGroupViewProps) {
  const [expanded, setExpanded] = useState(false);
  const children = childRows.filter(isGroupChild);
  const failed = children.filter((child): child is ActionRow => child.kind === 'action' && child.status === 'error');
  const running = children.filter((child): child is ActionRow => child.kind === 'action' && child.status === 'running');

  const failures = failed.map((action) => (
    <ActionLine
      key={action.id}
      category={dsActionCategory(action.category)}
      verb={action.summary.verb}
      object={action.summary.target}
      status="failed"
    />
  ));

  return (
    <div>
      <ActionGroupFrame
        summary={groupLabel(row.counts)}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        failures={failures}
      >
        {children.map((child) =>
          child.kind === 'thinking' ? (
            <Thinking key={child.id} row={child} requestDetail={requestDetail} />
          ) : (
            <ActionRowView key={child.id} row={child} requestDetail={requestDetail} />
          ),
        )}
      </ActionGroupFrame>
      {!expanded
        ? running.map((action) => (
            <div key={action.id} className={styles.running}>
              <ActionLine
                category={dsActionCategory(action.category)}
                verb={progressiveVerb(action.summary.verb)}
                object={action.summary.target}
                status="running"
              />
            </div>
          ))
        : null}
    </div>
  );
}

export const ActionGroupView = memo(ActionGroupViewImpl);
