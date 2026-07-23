import { Terminal, X } from 'lucide-react';
import { SESSION_STATE_LABEL_PT, StateDot, type SessionState } from '../StateDot';
import styles from './TerminalTab.module.css';

export interface TerminalTabProps {
  /** Nome da sessão, em mono. */
  name: string;
  /** Modelo abreviado, ex. "sonnet", "fable". */
  model?: string;
  /**
   * Estado do semáforo. Omitido = "terminal comum" (sem sessão Claude) — a
   * aba troca o dot por um ícone de shell (design-system.md §6, Brief 1).
   */
  state?: SessionState;
  active?: boolean;
  onClick?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * Aba de terminal do shell principal: dot de estado + nome (mono) + modelo
 * abreviado; ativa = `bg-raised` com borda superior `accent` (§6, Brief 1).
 */
export function TerminalTab({ name, model, state, active = false, onClick, onClose, className }: TerminalTabProps) {
  const stateLabel = state ? SESSION_STATE_LABEL_PT[state] : 'Terminal comum';
  const tooltip = model ? `${stateLabel} · ${model}` : stateLabel;

  return (
    <div
      className={[styles.tab, active ? styles.active : '', className].filter(Boolean).join(' ')}
      role="tab"
      aria-selected={active}
      title={tooltip}
    >
      <button type="button" className={styles.body} onClick={onClick}>
        {state ? (
          <StateDot state={state} />
        ) : (
          <Terminal size={16} strokeWidth={1.5} className={styles.shellIcon} aria-hidden="true" />
        )}
        <span className={styles.name}>{name}</span>
        {model ? <span className={styles.model}>{model}</span> : null}
      </button>
      {onClose ? (
        <button type="button" className={styles.close} onClick={onClose} aria-label={`Fechar aba ${name}`}>
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
