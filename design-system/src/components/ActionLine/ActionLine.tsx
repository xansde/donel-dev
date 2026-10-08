import {
  Ban,
  ChevronRight,
  CircleX,
  FileText,
  Lightbulb,
  LoaderCircle,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './ActionLine.module.css';

/** Ícone por categoria (014-chat, decisão B). */
export type ActionCategory = 'read' | 'search' | 'edit' | 'command' | 'skill' | 'thinking' | 'tool';

/**
 * Estado da ação (D-C3): o estado vem do `tool_result`, nunca da saída.
 * Sucesso = o ícone da categoria, sem texto; os demais pintam a linha.
 */
export type ActionStatus = 'running' | 'done' | 'failed' | 'denied' | 'interrupted';

const CATEGORY_ICON = {
  read: FileText,
  search: Search,
  edit: Pencil,
  command: SquareTerminal,
  skill: Sparkles,
  thinking: Lightbulb,
  tool: Wrench,
} as const;

const DEFAULT_STATUS_TEXT: Partial<Record<ActionStatus, string>> = {
  failed: '— falhou',
  denied: '— negado',
  interrupted: '— interrompido',
};

export interface ActionLineProps {
  category: ActionCategory;
  /**
   * Verbo já no tempo certo (D-C4): gerúndio quando `status="running"`
   * ("Rodando"), passado quando concluída ("Rodou").
   */
  verb: string;
  /** Objeto em mono de 12,5 px: caminho, comando, padrão de busca. */
  object?: string;
  status?: ActionStatus;
  /** Sobrescreve o texto do estado ("— falhou", "saiu com código 1"…). */
  statusText?: string;
  /** Linhas acrescentadas (`+a`, `--zone-ok`). */
  added?: number;
  /** Linhas removidas (`−b`, coral fixo; `−0` em muted). */
  removed?: number;
  /** Duração à direita ("0,3 s"). */
  duration?: string;
  /**
   * Com `onToggle` a linha vira botão com chevron e mostra `children` quando
   * `expanded`. Sem `onToggle` é uma linha fixa (ex.: "Pensou" sem texto, D-C5).
   */
  expanded?: boolean;
  onToggle?: () => void;
  /** Detalhe aberto: `DiffBlock`, `CommandOutput`, texto do "pensou"… */
  children?: ReactNode;
  className?: string;
}

/**
 * Linha de ação de 28 px (014-chat, decisão B): ícone de 16 px por categoria,
 * verbo em muted, objeto em mono, contagem `+a −b`, resultado só quando é
 * estado e duração à direita. Usada na conversa e no painel do subagente.
 */
export function ActionLine({
  category,
  verb,
  object,
  status = 'done',
  statusText,
  added,
  removed,
  duration,
  expanded = false,
  onToggle,
  children,
  className,
}: ActionLineProps) {
  const Icon = CATEGORY_ICON[category];
  const resultText = statusText ?? DEFAULT_STATUS_TEXT[status];
  const chevronFirst = category === 'thinking';

  const chevron = (
    <ChevronRight
      className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
      size={14}
      strokeWidth={2}
      aria-hidden="true"
    />
  );

  const content = (
    <>
      {onToggle && chevronFirst ? chevron : null}
      {status === 'running' ? (
        <LoaderCircle className={styles.spinner} size={16} strokeWidth={1.75} aria-hidden="true" />
      ) : status === 'failed' ? (
        <CircleX className={styles.iconFailed} size={16} strokeWidth={1.75} aria-hidden="true" />
      ) : status === 'denied' || status === 'interrupted' ? (
        <Ban className={styles.iconFailed} size={16} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Icon className={styles.icon} size={16} strokeWidth={1.75} aria-hidden="true" />
      )}
      <span className={styles.verb}>{verb}</span>
      {object ? <span className={styles.object}>{object}</span> : null}
      {added !== undefined ? <span className={styles.added}>+{added}</span> : null}
      {removed !== undefined ? (
        <span className={removed === 0 ? styles.removedZero : styles.removed}>−{removed}</span>
      ) : null}
      {resultText ? <span className={styles.result}>{resultText}</span> : null}
      <span className={styles.spacer} />
      {duration ? <span className={styles.duration}>{duration}</span> : null}
      {onToggle && !chevronFirst ? chevron : null}
    </>
  );

  const rowClass = [styles.row, status === 'failed' ? styles.failed : '', onToggle ? styles.clickable : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      {onToggle ? (
        <button type="button" className={rowClass} onClick={onToggle} aria-expanded={expanded}>
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      {onToggle && expanded && children ? <div className={styles.detail}>{children}</div> : null}
    </div>
  );
}
