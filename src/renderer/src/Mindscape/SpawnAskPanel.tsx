import styles from './SpawnAskPanel.module.css';

/** A session asked to open one more session over the cap (`sessao_abrir`); the tool waits for the owner. */
export interface SpawnAsk {
  readonly id: string;
  readonly caller: string;
  readonly role: string;
  readonly request: string;
  readonly open: number;
  readonly resolve: (allowed: boolean) => void;
}

interface SpawnAskPanelProps {
  readonly asks: readonly SpawnAsk[];
  readonly onAnswer: (id: string, allowed: boolean) => void;
}

/** Quadro por MCP (C) — "Precisa de você": the 5th session a caller wants to open, allowed or denied in one click. */
export function SpawnAskPanel({ asks, onAnswer }: SpawnAskPanelProps): React.JSX.Element | null {
  if (asks.length === 0) return null;
  return (
    <div className={styles.stack} role="region" aria-label="Pedidos de sessão nova" data-testid="spawn-asks">
      {asks.map((ask) => (
        <div key={ask.id} className={styles.card}>
          <div className={styles.title}>Precisa de você</div>
          <div className={styles.text}>
            <strong>{ask.caller}</strong> já tem {ask.open} sessões abertas e quer abrir mais uma, como <strong>{ask.role}</strong>:
          </div>
          <div className={styles.request}>{ask.request.length > 280 ? `${ask.request.slice(0, 280)}…` : ask.request}</div>
          <div className={styles.actions}>
            <button type="button" className={styles.deny} onClick={() => onAnswer(ask.id, false)}>
              Negar
            </button>
            <button type="button" className={styles.allow} onClick={() => onAnswer(ask.id, true)}>
              Permitir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
