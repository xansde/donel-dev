// Oráculo no centro (owner, 06/11: "Estou com telas redundantes") — the center of "Uso geral" shows the Oráculo
// Harrow instead of a conversation the Jobu already shows. Ledger v5 (D5: tela B with the box of A on top):
// - on top, the box "Esperando você" (fatia 1, `OwnerInbox`): every kind of thing that waits for the owner, not only
//   the high-risk deliveries; it folds into one line when empty;
// - below, the readable table of every task (fatia 3, `LedgerTable`), whose filter "Esperando você" is the same list.
// The cards (`LedgerCards`, the same as the Mindscape's) open over it, where the owner decides; every decision goes
// to the main as the owner. The terminals are one click away (Ctrl+Shift+O).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ledgerStrip, type LedgerTask } from '../../shared/ledger/contract';
import type { LedgerSnapshot } from '../../shared/ledger/channels';
import { CARD_KINDS, inboxBoards, ownerInbox, type OwnerInboxKind, type PlaceStates } from '../../shared/ledger/inbox';
import type { PlaceNameOf } from '../../shared/ledger/labels';
import { placeInfoOfMap, type LedgerPlacesSnapshot } from '../../shared/ledger/mirror';
import { LedgerCards } from './Mindscape/LedgerCards';
import { OwnerInbox } from './Mindscape/OwnerInbox';
import { LedgerTable, type SessionOf } from './LedgerTable';
import styles from './OracleCenter.module.css';

export function OracleCenter({
  placeName,
  placeStatesOf,
  sessionOf,
}: {
  readonly placeName?: PlaceNameOf;
  /** The session that runs each task (place → its conversation, from the board), for the table's "Sessão". */
  readonly sessionOf?: SessionOf;
  /** The places of these boards (for the orphans); absent = no orphan is shown. */
  readonly placeStatesOf?: (projectPaths: readonly string[]) => PlaceStates;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [names, setNames] = useState<LedgerPlacesSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** The cards open over the table, on the task the owner picked. */
  const [cardFor, setCardFor] = useState<string | null>(null);
  const closeCards = useCallback(() => setCardFor(null), []);

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
      setNow(Date.now());
      readNames();
    });
    // The box has thresholds in time (a delivery stopped for 24 h, a letter stuck for 30 min).
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, []);

  const places = useMemo(() => placeInfoOfMap(names?.places ?? {}, placeName), [names, placeName]);
  const items = useMemo(
    () => (snapshot ? ownerInbox(snapshot.doc, null, now, placeStatesOf?.(inboxBoards(snapshot.doc))) : []),
    [snapshot, now, placeStatesOf],
  );
  const inbox = useMemo(() => new Map<string, OwnerInboxKind>(items.map((item) => [item.task.id, item.kind])), [items]);
  const cardQueue = items.filter((item) => CARD_KINDS.has(item.kind)).map((item) => item.task);
  const strip = snapshot ? ledgerStrip(snapshot.doc, null) : null;
  const openCard = useCallback((task: LedgerTask) => setCardFor(task.id), []);

  return (
    <div className={styles.oracle} data-testid="oracle-center">
      <div className={styles.layout}>
        {items.length > 0 ? (
          <div className={styles.inboxSlot}>
            <OwnerInbox items={items} now={now} placeName={placeName} showBoard />
          </div>
        ) : (
          <section className={styles.waiting} aria-label="Esperando você">
            <span className={styles.waitingMeta}>
              Nada esperando você
              {strip && strip.total > 0 ? ` · ${strip.open} abertas · ${strip.running} em execução · ${strip.deliveredUnaccepted} entregues sem aceite` : ''}
            </span>
          </section>
        )}
        {snapshot?.readOnly ? <p className={styles.waitingMeta}>Gravado por uma versão mais nova do Donel: aqui é só leitura.</p> : null}
        {snapshot && Object.keys(snapshot.doc.tasks).length > 0 ? (
          <LedgerTable doc={snapshot.doc} places={places} sessionOf={sessionOf} ownerName={names?.ownerName ?? null} onOpenCard={openCard} inbox={inbox} />
        ) : (
          <div className={styles.empty}>
            <p className={styles.title}>Nenhuma tarefa ainda</p>
            <p className={styles.hint}>Quando uma sessão registrar uma tarefa, ela aparece aqui. Fale com o Líder pelo Jobu.</p>
          </div>
        )}
      </div>
      {cardFor !== null && cardQueue.length > 0 ? (
        <LedgerCards key={cardFor} queue={cardQueue} placeName={placeName} initialId={cardFor} onClose={closeCards} />
      ) : null}
    </div>
  );
}
