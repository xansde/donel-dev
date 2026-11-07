// Oráculo no centro (owner, 06/11: "Estou com telas redundantes") — the center of "Uso geral" shows the Oráculo
// Harrow instead of a conversation the Jobu already shows: the cards waiting for the owner, of every board, with the
// same cards as the Mindscape (`LedgerCards`, no copy of the card). The terminals are one click away (the switch in
// the bar on top, Ctrl+Shift+O); every decision goes to the main as the owner, as on the board.

import { useEffect, useState } from 'react';
import { ledgerStrip, ownerQueue } from '../../shared/ledger/contract';
import type { LedgerSnapshot } from '../../shared/ledger/channels';
import type { PlaceNameOf } from '../../shared/ledger/labels';
import { LedgerCards } from './Mindscape/LedgerCards';
import styles from './OracleCenter.module.css';

export function OracleCenter({ placeName }: { readonly placeName?: PlaceNameOf }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);

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
    const off = api.onChanged(setSnapshot);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const queue = snapshot ? ownerQueue(snapshot.doc, null) : [];
  const strip = snapshot ? ledgerStrip(snapshot.doc, null) : null;

  return (
    <div className={styles.oracle} data-testid="oracle-center">
      {queue.length > 0 ? (
        <LedgerCards queue={queue} placeName={placeName} />
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
