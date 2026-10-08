import { CommandOutput, OwnerMessage } from '@donel-dev/design-system';
import type { CommandOutputLine } from '@donel-dev/design-system';
import { memo, useMemo, useState } from 'react';
import type { ShellRow } from '../../../../shared/chat/rows';
import { formatClock } from './format';
import styles from './rows.module.css';

export interface ShellRowViewProps {
  row: ShellRow;
}

function splitLines(text: string | undefined): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

/**
 * The owner's `!command` (T052): `OwnerMessage` in mono ("! cmd") + the output
 * in the `CommandOutput` frame, stderr lines in the failure color.
 */
function ShellRowViewImpl({ row }: ShellRowViewProps) {
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo<CommandOutputLine[]>(
    () => [
      ...splitLines(row.stdout).map((text) => ({ text })),
      ...splitLines(row.stderr).map((text) => ({ text, tone: 'error' as const })),
    ],
    [row.stdout, row.stderr],
  );
  return (
    <div>
      <OwnerMessage mono time={formatClock(row.at)}>
        {`! ${row.command}`}
      </OwnerMessage>
      {lines.length > 0 ? (
        <div className={styles.below}>
          <CommandOutput title="saída" lines={lines} showAll={showAll} onViewAll={() => setShowAll(true)} />
        </div>
      ) : null}
    </div>
  );
}

export const ShellRowView = memo(ShellRowViewImpl);
