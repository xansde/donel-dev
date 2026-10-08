import { ChevronRight, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { StateDot } from '../StateDot';
import styles from './WorkFold.module.css';

/**
 * G1: a barra da dobra muda com o estado —
 * `working` = "trabalhando — …" (StateDot working, tempo vivo);
 * `waiting` = "esperando você — …" (StateDot permission, pulsa);
 * `done` = "trabalhou — …" (ícone de camadas e a duração).
 */
export type WorkFoldState = 'working' | 'waiting' | 'done';

export interface WorkFoldProps {
  state: WorkFoldState;
  /** Texto completo, já com o prefixo do estado: "trabalhou — 9 ações, 2 notas". */
  label: string;
  /** Tempo (vivo ou final): "2 min 41 s". */
  elapsed?: string;
  /** Selo à direita ("tem pergunta aqui" = `AnnotationTag tone="warn"`). */
  badge?: ReactNode;
  expanded?: boolean;
  onToggle: () => void;
  /** Conteúdo desdobrado (ações, notas) — mostrado quando `expanded`. */
  children?: ReactNode;
  className?: string;
}

/**
 * Barra "trabalhou — N ações, M notas" do Modo Foco (014-chat, decisão D):
 * só contorno, 36 px, fundo transparente — para não competir com a mensagem do
 * dono. Clicar abre só aquela rodada.
 */
export function WorkFold({
  state,
  label,
  elapsed,
  badge,
  expanded = false,
  onToggle,
  children,
  className,
}: WorkFoldProps) {
  return (
    <div className={[styles.fold, className].filter(Boolean).join(' ')}>
      <button type="button" className={styles.bar} onClick={onToggle} aria-expanded={expanded}>
        <ChevronRight
          className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
          size={14}
          strokeWidth={2}
          aria-hidden="true"
        />
        {state === 'done' ? (
          <Layers className={styles.icon} size={16} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <StateDot state={state === 'working' ? 'working' : 'permission'} />
        )}
        <span>{label}</span>
        {elapsed ? <span className={styles.elapsed}>{elapsed}</span> : null}
        <span className={styles.spacer} />
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </button>
      {expanded && children ? <div className={styles.content}>{children}</div> : null}
    </div>
  );
}
