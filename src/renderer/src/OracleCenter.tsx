// Oráculo no centro (owner, 06/11: "Estou com telas redundantes") — the center of "Uso geral" shows the Oráculo
// Harrow instead of a conversation the Jobu already shows: the cards waiting for the owner, of every board, with the
// same cards as the Mindscape (`LedgerCards`, no copy of the card). The terminals are one click away (the switch in
// the bar on top, Ctrl+Shift+O); every decision goes to the main as the owner, as on the board.
// Ledger v5, fatia 1 — on top, the box "Esperando você" (`OwnerInbox`): every kind of thing that waits for the owner,
// not only the high-risk deliveries; it opens the cards on the item picked, and folds away when empty.

import { useEffect, useState } from 'react';
import { ledgerStrip } from '../../shared/ledger/contract';
import type { LedgerSnapshot } from '../../shared/ledger/channels';
import { inboxBoards, ownerInbox, type PlaceStates } from '../../shared/ledger/inbox';
import type { PlaceNameOf } from '../../shared/ledger/labels';
import { OwnerInbox } from './Mindscape/OwnerInbox';
import styles from './OracleCenter.module.css';

export function OracleCenter({
  placeName,
  placeStatesOf,
}: {
  readonly placeName?: PlaceNameOf;
  /** The places of these boards (for the orphans); absent = no orphan is shown. */
  readonly placeStatesOf?: (projectPaths: readonly string[]) => PlaceStates;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
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
    // The box has thresholds in time (a delivery stopped for 24 h, a letter stuck for 30 min).
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, []);

  const items = snapshot ? ownerInbox(snapshot.doc, null, now, placeStatesOf?.(inboxBoards(snapshot.doc))) : [];
  const strip = snapshot ? ledgerStrip(snapshot.doc, null) : null;

  return (
    <div className={styles.oracle} data-testid="oracle-center">
      {items.length > 0 ? (
        <div className={styles.scroll}>
          <OwnerInbox items={items} now={now} placeName={placeName} showBoard />
        </div>
      ) : (
        <div className={styles.empty}>
          <p className={styles.title}>Nada esperando você</p>
          <p className={styles.hint}>
            {strip && strip.total > 0
              ? `${strip.open} abertas · ${strip.running} em execução · ${strip.deliveredUnaccepted} entregues sem aceite`
              : 'Quando uma sessão entregar algo para você decidir, a carta aparece aqui.'}
          </p>
          <p className={styles.hint}>Fale com o Líder pelo Jobu. As sessões estão em Terminais, no alto.</p>
        </div>
      )}
    </div>
  );
}
