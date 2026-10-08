import { Ban, ChevronRight, CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import { AnnotationTag } from '../AnnotationTag';
import { StateDot } from '../StateDot';
import styles from './SubagentRow.module.css';

/** Estados do subagente (`data-model.md` §7). */
export type SubagentState = 'running' | 'completed' | 'failed' | 'killed' | 'stopped' | 'unknown';

/** Texto padrão de cada estado; o contêiner pode compor ("falhou em 12 s"). */
export const SUBAGENT_STATE_LABEL_PT: Record<SubagentState, string> = {
  running: 'Rodando',
  completed: 'Concluído',
  failed: 'Falhou',
  killed: 'Encerrado',
  stopped: 'Parado',
  unknown: 'Estado desconhecido',
};

export interface SubagentRowProps {
  /** Descrição curta do subagente. */
  name: string;
  /** Tipo (`general-purpose`, `Explore`…) em ficha. */
  type?: string;
  /** Modelo em ficha. */
  model?: string;
  state: SubagentState;
  /** Sobrescreve o texto do estado. */
  stateText?: string;
  /** Detalhe em mono à direita do estado: ação atual ou "resultado: …". */
  detail?: string;
  /** Linha aberta no painel lateral. */
  selected?: boolean;
  /** Abre o painel do subagente. Sem ele a linha é só leitura estática. */
  onOpen?: () => void;
  className?: string;
}

function StateGlyph({ state }: { state: SubagentState }) {
  switch (state) {
    case 'running':
      return <StateDot state="working" />;
    case 'completed':
      return <CircleCheck className={styles.ok} size={16} strokeWidth={1.75} aria-hidden="true" />;
    case 'failed':
      return <CircleX className={styles.failed} size={16} strokeWidth={1.75} aria-hidden="true" />;
    case 'killed':
    case 'stopped':
      return <Ban className={styles.muted} size={16} strokeWidth={1.75} aria-hidden="true" />;
    default:
      return <CircleHelp className={styles.muted} size={16} strokeWidth={1.75} aria-hidden="true" />;
  }
}

/**
 * Linha viva de subagente, só leitura (014-chat, extensão 11): glifo de estado,
 * nome, fichas de tipo e modelo, estado e detalhe. Falhou = coral FIXO (D-C26).
 */
export function SubagentRow({
  name,
  type,
  model,
  state,
  stateText,
  detail,
  selected = false,
  onOpen,
  className,
}: SubagentRowProps) {
  const rowClass = [styles.row, selected ? styles.selected : '', onOpen ? styles.clickable : '', className]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className={styles.glyph}>
        <StateGlyph state={state} />
      </span>
      <span className={styles.main}>
        <span className={styles.top}>
          <span className={styles.name}>{name}</span>
          {type ? <AnnotationTag tone="muted">{type}</AnnotationTag> : null}
          {model ? <AnnotationTag tone="muted">{model}</AnnotationTag> : null}
        </span>
        <span className={styles.bottom}>
          <span className={state === 'failed' ? styles.stateFailed : styles.state}>
            {stateText ?? SUBAGENT_STATE_LABEL_PT[state]}
          </span>
          {detail ? <span className={styles.detail}>{detail}</span> : null}
        </span>
      </span>
      {onOpen ? <ChevronRight className={styles.chevron} size={14} strokeWidth={2} aria-hidden="true" /> : null}
    </>
  );

  return onOpen ? (
    <button type="button" className={rowClass} onClick={onOpen} aria-pressed={selected}>
      {content}
    </button>
  ) : (
    <div className={rowClass}>{content}</div>
  );
}
