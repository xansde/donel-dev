// Mindscape de homologação, fatia 4 — the factory's band on its board, in the Cadeiras lens: what the numbers say is
// wrong (a broken lock by name, counted by the same `alertsOf` as the numbers panel, so it shows even with the panel
// closed), the numbers the factory marked for the band (`faixa: true`, e.g. how long the team waits for it) and how
// many high-risk deliveries of this board wait for the owner. A click on that opens the Oráculo's cards over the
// board, only those. Read only: no aviso, no task, no write — the owner is never in the path of the seal.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { alertsOf } from '../../../shared/homologacao/factoryAlerts';
import type { FactoryMetricsView } from '../../../shared/homologacao/ipc';
import type { LedgerTask } from '../../../shared/ledger/contract';
import type { PlaceNameOf } from '../../../shared/ledger/labels';
import { LedgerCards } from './LedgerCards';
import styles from './FactoryBand.module.css';

export interface FactoryBandProps {
  /** `null` = no numbers file in the config: only the waiting count shows. */
  readonly metrics: FactoryMetricsView | null;
  /** High-risk tasks of this board delivered and waiting for the owner, oldest first. */
  readonly waiting: readonly LedgerTask[];
  readonly placeName?: PlaceNameOf;
  /** The board's area: the cards cover it (as the Oráculo strip does). */
  readonly cardsHost: HTMLElement | null;
}

export function FactoryBand({ metrics, waiting, placeName, cardsHost }: FactoryBandProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (waiting.length === 0) setOpen(false);
  }, [waiting.length]);

  const alerts = metrics ? alertsOf(metrics, now) : [];
  const problems = alerts.filter((alert) => alert.level === 'problema');
  const parsed = metrics?.file.value;
  const banded = parsed?.kind === 'ok' ? parsed.metrics.filter((metric) => metric.band) : [];

  return (
    <div className={styles.band} data-testid="factory-band" data-level={problems.length > 0 ? 'problema' : 'bem'}>
      {metrics ? (
        <span className={problems.length > 0 ? `${styles.count} ${styles.problem}` : styles.count} data-testid="factory-band-problems" title="Contado como no painel Números da factory">
          <b>{problems.length}</b> problema{problems.length === 1 ? '' : 's'} nos números
          {problems.length > 0 ? <span className={styles.names}>{problems.map((alert) => alert.text).join(' · ')}</span> : null}
        </span>
      ) : null}
      {banded.map((metric) => (
        <span key={metric.id} className={styles.highlight} data-testid="factory-band-metric" title={metric.question}>
          <span className={styles.highlightName}>{metric.name}</span>
          <b>{metric.text}</b>
        </span>
      ))}
      <button
        type="button"
        className={waiting.length > 0 ? `${styles.count} ${styles.waiting}` : styles.count}
        disabled={waiting.length === 0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="factory-band-waiting"
        title="Entregas de risco alto deste quadro que esperam você decidir; abre as cartas do Oráculo, só elas"
      >
        <b>{waiting.length}</b> de risco alto esperando você
      </button>
      {open && waiting.length > 0 && cardsHost ? createPortal(<LedgerCards queue={waiting} placeName={placeName} onClose={() => setOpen(false)} />, cardsHost) : null}
    </div>
  );
}
