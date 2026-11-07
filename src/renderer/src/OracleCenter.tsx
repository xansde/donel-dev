// Oráculo no centro (owner, 06/11: "Estou com telas redundantes") — the center of "Uso geral" shows the Oráculo
// Harrow instead of a conversation the Jobu already shows. Ledger v5, fatia 3 (D5: tela B with the box of A on top):
// on top, what waits for the owner (the slot of the box "Esperando você", fatia 1); below, the readable table of
// every task (`LedgerTable`). The cards (`LedgerCards`, the same as the Mindscape's) open over it, where the owner
// decides; every decision goes to the main as the owner. The terminals are one click away (Ctrl+Shift+O).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ledgerStrip, ownerQueue, type LedgerTask } from '../../shared/ledger/contract';
import type { LedgerSnapshot } from '../../shared/ledger/channels';
import type { PlaceNameOf } from '../../shared/ledger/labels';
import { placeInfoOfMap, type LedgerPlacesSnapshot } from '../../shared/ledger/mirror';
import { LedgerCards } from './Mindscape/LedgerCards';
import { LedgerTable } from './LedgerTable';
import styles from './OracleCenter.module.css';

function ago(since: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} dias`;
}

export function OracleCenter({ placeName }: { readonly placeName?: PlaceNameOf }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [names, setNames] = useState<LedgerPlacesSnapshot | null>(null);
  /** The cards open over the table: the first one is the task the owner picked. */
  const [cardsFirst, setCardsFirst] = useState<string | null | undefined>(undefined);
  const closeCards = useCallback(() => setCardsFirst(undefined), []);

  useEffect(() => {
    const api = window.donel?.ledger;
    if (!api) return undefined;
    let alive = true;
    // The names of the places, as the mirror says them (the boards and the names it remembers): reread on each change.
    const readNames = (): void => {
      void window.donel?.ledgerMirror
        ?.places()
        .then((next) => {
          if (alive) setNames(next);
        })
        .catch(() => undefined);
    };
    api
      .load()
      .then((loaded) => {
        if (alive) setSnapshot(loaded);
      })
      .catch(() => undefined);
    readNames();
    const off = api.onChanged((next) => {
      setSnapshot(next);
      readNames();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const places = useMemo(() => placeInfoOfMap(names?.places ?? {}, placeName), [names, placeName]);
  const queue = snapshot ? ownerQueue(snapshot.doc, null) : [];
  const strip = snapshot ? ledgerStrip(snapshot.doc, null) : null;
  const cards =
    cardsFirst === undefined ? [] : cardsFirst === null ? queue : [...queue.filter((task) => task.id === cardsFirst), ...queue.filter((task) => task.id !== cardsFirst)];
  const openCard = useCallback((task: LedgerTask) => setCardsFirst(task.id), []);

  return (
    <div className={styles.oracle} data-testid="oracle-center">
      <div className={styles.layout}>
        {/* The box "Esperando você" (fatia 1) takes this place; until then, the count and the cards. */}
        <section className={styles.waiting} data-slot="caixa-esperando-voce" aria-label="Esperando você">
          {queue.length > 0 ? (
            <>
              <span className={styles.waitingCount}>◆ {queue.length} esperando você</span>
              {strip?.oldestWaitingSince != null ? <span className={styles.waitingMeta}>a mais antiga há {ago(strip.oldestWaitingSince, Date.now())}</span> : null}
              <button type="button" className={styles.waitingOpen} onClick={() => setCardsFirst(null)}>
                Abrir as cartas
              </button>
            </>
          ) : (
            <span className={styles.waitingMeta}>
              Nada esperando você
              {strip && strip.total > 0 ? ` · ${strip.open} abertas · ${strip.running} em execução · ${strip.deliveredUnaccepted} entregues sem aceite` : ''}
            </span>
          )}
          {snapshot?.readOnly ? <span className={styles.waitingMeta}>gravado por versão mais nova: só leitura</span> : null}
        </section>
        {snapshot && snapshot.doc && Object.keys(snapshot.doc.tasks).length > 0 ? (
          <LedgerTable doc={snapshot.doc} places={places} ownerName={names?.ownerName ?? null} onOpenCard={openCard} />
        ) : (
          <div className={styles.empty}>
            <p className={styles.title}>Nenhuma tarefa ainda</p>
            <p className={styles.hint}>Quando uma sessão registrar uma tarefa, ela aparece aqui. Fale com o Líder pelo Jobu.</p>
          </div>
        )}
      </div>
      {cards.length > 0 ? <LedgerCards key={cardsFirst ?? 'fila'} queue={cards} placeName={placeName} onClose={closeCards} /> : null}
    </div>
  );
}
