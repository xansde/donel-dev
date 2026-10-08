import { CommandOutput, OwnerMessage } from '@donel-dev/design-system';
import { memo, useState } from 'react';
import type { LocalCommandRow } from '../../../../shared/chat/rows';
import { formatClock } from './format';
import styles from './rows.module.css';

export interface LocalCommandProps {
  row: LocalCommandRow;
}

/**
 * Slash command run by the CLI itself, like `/color` or `/model x` (T052):
 * `OwnerMessage` in mono + the output in the `CommandOutput` frame (the output
 * is already in the row, so "ver tudo" is local).
 */
function LocalCommandImpl({ row }: LocalCommandProps) {
  const [showAll, setShowAll] = useState(false);
  const typed = row.command.startsWith('/') ? row.command : `/${row.command}`;
  const text = row.args ? `${typed} ${row.args}` : typed;
  return (
    <div>
      <OwnerMessage mono time={formatClock(row.at)}>
        {text}
      </OwnerMessage>
      {row.output ? (
        <div className={styles.below}>
          <CommandOutput title="saída" text={row.output} showAll={showAll} onViewAll={() => setShowAll(true)} />
        </div>
      ) : null}
    </div>
  );
}

export const LocalCommand = memo(LocalCommandImpl);
