import { AnnotationTag } from '@donel-dev/design-system';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import type { SkillRow } from '../../../../shared/chat/rows';
import styles from './rows.module.css';

export interface SkillBadgeProps {
  row: SkillRow;
}

/**
 * Skill seal (T053, AS 3.6): "usou a skill `tdd`" when the model called it,
 * "skill `tdd` carregada" when the owner invoked it with `/tdd`.
 */
function SkillBadgeImpl({ row }: SkillBadgeProps) {
  const name = <span className={styles.skillName}>{row.name}</span>;
  return (
    <div className={styles.skillRow}>
      <AnnotationTag tone="muted">
        <span className={styles.skillTag}>
          <Sparkles size={12} strokeWidth={1.75} aria-hidden="true" />
          {row.how === 'used-by-claude' ? <>usou a skill {name}</> : <>skill {name} carregada</>}
        </span>
      </AnnotationTag>
    </div>
  );
}

export const SkillBadge = memo(SkillBadgeImpl);
