import { ChevronRight, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './ActionGroup.module.css';

export interface ActionGroupProps {
  /** Rótulo do grupo: "9 ações — leu 4, editou 2, rodou 3" (calculado fora). */
  summary: string;
  /** Duração total ("2 min 41 s"). */
  duration?: string;
  expanded?: boolean;
  onToggle: () => void;
  /**
   * Falhas içadas: uma `ActionLine status="failed"` por item, visíveis sem
   * expandir (recuo de 26 px, coral a 8%). Some quando o grupo abre — a falha
   * já aparece na própria lista.
   */
  failures?: ReactNode[];
  /** As `ActionLine` do grupo, mostradas quando `expanded`. */
  children?: ReactNode;
  className?: string;
}

/**
 * Grupo de 2+ ações seguidas (014-chat, decisão B). Recolhido: camadas, "N
 * ações — …" e a duração total, com as falhas içadas logo abaixo. Aberto: trilho
 * de 1 px à esquerda (margem 11, recuo 14).
 */
export function ActionGroup({
  summary,
  duration,
  expanded = false,
  onToggle,
  failures,
  children,
  className,
}: ActionGroupProps) {
  const hasFailures = !expanded && failures && failures.length > 0;
  return (
    <div className={[styles.group, className].filter(Boolean).join(' ')}>
      <button type="button" className={styles.header} onClick={onToggle} aria-expanded={expanded}>
        <ChevronRight
          className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
          size={14}
          strokeWidth={2}
          aria-hidden="true"
        />
        <Layers className={styles.icon} size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{summary}</span>
        <span className={styles.spacer} />
        {duration ? <span className={styles.duration}>{duration}</span> : null}
      </button>
      {hasFailures
        ? failures.map((failure, index) => (
            <div key={index} className={styles.failure}>
              {failure}
            </div>
          ))
        : null}
      {expanded && children ? <div className={styles.rail}>{children}</div> : null}
    </div>
  );
}
