import { SubagentRow as SubagentRowFrame } from '@donel-dev/design-system';
import { memo } from 'react';
import type { SubagentRow } from '../../../../shared/chat/rows';
import { formatDuration, progressiveVerb, subagentStateText } from './format';

export interface SubagentRowViewProps {
  row: SubagentRow;
  /**
   * Opens the side panel of this subagent (T094). Read-only phase: omit it and
   * the row is a static line without chevron.
   */
  onOpen?: (agentId: string) => void;
  /** Row currently open in the panel. */
  selected?: boolean;
}

/** Indent per nesting level of a subagent launched by another subagent. */
const DEPTH_INDENT_PX = 16;
const MAX_INDENT_LEVELS = 4;

/**
 * Live line of a subagent (T053, read-only): state glyph, description, type and
 * model chips, state and a detail — the current action while running (gerund),
 * the elapsed time when it ends.
 */
function SubagentRowViewImpl({ row, onOpen, selected }: SubagentRowViewProps) {
  const lastAction = row.lastAction
    ? [progressiveVerb(row.lastAction.verb), row.lastAction.target].filter(Boolean).join(' ')
    : undefined;
  const detail =
    row.status === 'running' ? lastAction : row.status === 'completed' ? formatDuration(row.durationMs) || undefined : undefined;

  return (
    <div style={row.depth > 0 ? { marginLeft: Math.min(row.depth, MAX_INDENT_LEVELS) * DEPTH_INDENT_PX } : undefined}>
      <SubagentRowFrame
        name={row.description}
        type={row.agentType}
        model={row.model}
        state={row.status}
        stateText={subagentStateText(row.status, row.durationMs)}
        detail={detail}
        selected={selected}
        onOpen={onOpen ? () => onOpen(row.agentId) : undefined}
      />
    </div>
  );
}

export const SubagentRowView = memo(SubagentRowViewImpl);
