// Ledger com prova (item 19) — the strip of numbers on top of the board: open, running, delivered without an
// accept, waiting for the owner (with the oldest) and "validadas sem você". "Esperando você" opens the cards
// (forma A, `LedgerCards.tsx`) over the board, where the owner decides. The numbers are pure (`ledgerStrip`,
// shared/ledger/contract.ts); every decision goes to the main as the owner. Hidden while the board has no task.

import { useCallback, useEffect, useState } from 'react';
import { ledgerStrip, ownerQueue } from '../../../shared/ledger/contract';
import type { LedgerSnapshot } from '../../../shared/ledger/channels';
import type { PlaceNameOf } from '../../../shared/ledger/labels';
import { LedgerCards } from './LedgerCards';
import styles from './Mindscape.module.css';

function ago(since: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export function LedgerStrip({ projectPath, placeName }: { readonly projectPath: string | undefined; readonly placeName?: PlaceNameOf }): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const api = window.donel?.ledger;
    if (!api) return undefined;
    let alive = true;
    api
      .load()
      .then((loaded) => {
        if (alive) setSnapshot(loaded);
      })
      .catch(() => undefined);
    const off = api.onChanged((next) => {
      setSnapshot(next);
      setNow(Date.now());
    });
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, []);

  if (!snapshot || !projectPath) return null;
  const strip = ledgerStrip(snapshot.doc, projectPath);
  if (strip.total === 0) return null;
  const queue = open ? ownerQueue(snapshot.doc, projectPath) : [];

  return (
    <div className={styles.ledger} data-testid="ledger-strip">
      <div className={styles.ledgerNumbers}>
        <span className={styles.ledgerTitle}>Oráculo Harrow</span>
        <span>{strip.open} abertas</span>
        <span>{strip.running} em execução</span>
        <span>{strip.deliveredUnaccepted} entregues sem aceite</span>
        <button
          type="button"
          className={strip.waitingForOwner > 0 ? `${styles.ledgerWaiting} ${styles.ledgerWaitingOn}` : styles.ledgerWaiting}
          disabled={strip.waitingForOwner === 0}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {strip.waitingForOwner} esperando você
          {strip.oldestWaitingSince !== null ? ` (a mais velha há ${ago(strip.oldestWaitingSince, now)})` : ''}
        </button>
        <span>{strip.validatedWithoutOwnerPct === null ? 'nenhuma validada ainda' : `${strip.validatedWithoutOwnerPct}% validadas sem você`}</span>
        {snapshot.readOnly ? <span className={styles.ledgerMeta}>gravado por versão mais nova: só leitura</span> : null}
      </div>
      {open && queue.length > 0 ? <LedgerCards queue={queue} placeName={placeName} onClose={close} /> : null}
    </div>
  );
}
