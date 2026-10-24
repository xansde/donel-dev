import { DiffBlock } from '@donel-dev/design-system';
import { memo, useMemo, useState } from 'react';
import { parseUnifiedDiff } from './unifiedDiff';

export interface DiffViewProps {
  /** `RowDetail.text` of part `diff` (hunks of the transcript's `structuredPatch`). */
  text: string;
  /** File path in the block header. */
  path?: string;
  /** Visible lines before "ver tudo" (D-C7: 40). */
  maxLines?: number;
}

/**
 * Diff of an edit/write action (T053). The DS `DiffBlock` cuts at 40 lines
 * (D-C7); "ver tudo" shows the rest — the whole diff is already in memory, so
 * no new request is needed.
 */
function DiffViewImpl({ text, path, maxLines }: DiffViewProps) {
  const parsed = useMemo(() => parseUnifiedDiff(text), [text]);
  const [showAll, setShowAll] = useState(false);
  return (
    <DiffBlock
      lines={parsed.lines}
      path={path}
      hunk={parsed.hunk}
      maxLines={maxLines}
      showAll={showAll}
      onViewAll={() => setShowAll(true)}
    />
  );
}

export const DiffView = memo(DiffViewImpl);
