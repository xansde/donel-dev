// Ledger com prova (item 19) — the strip of numbers on top of the board: open, running, delivered without an
// accept, waiting for the owner (with the oldest) and "validadas sem você". "Esperando você" opens the cards
// (forma A, `LedgerCards.tsx`) over the board, where the owner decides. The numbers are pure (`ledgerStrip`,
// shared/ledger/contract.ts); every decision goes to the main as the owner. Hidden while the board has no task.
// Ledger v5, fatia 1 — "esperando você" counts the whole box of the board (`ownerInbox`: letters to send, sends to
// check, orphans… not only high-risk deliveries), says how long the oldest one waits, and opens that box.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ledgerStrip } from '../../../shared/ledger/contract';
import type { LedgerSnapshot } from '../../../shared/ledger/channels';
import { inboxSummary, ownerInbox, type PlaceStates } from '../../../shared/ledger/inbox';
import type { PlaceNameOf } from '../../../shared/ledger/labels';
import { OwnerInbox, waitedFor } from './OwnerInbox';
import styles from './Mindscape.module.css';

export function LedgerStrip({
  projectPath,
  placeName,
  cardsHost,
  placeStatesOf,
}: {
  readonly projectPath: string | undefined;
  readonly placeName?: PlaceNameOf;
  /** The board's area: the cards cover it, never the tabs nor the strip (as in the prototype). */
  readonly cardsHost?: HTMLElement | null;
  /** The places of these boards (for the orphans); absent = no orphan is shown. */
  readonly placeStatesOf?: (projectPaths: readonly string[]) => PlaceStates;
}): React.JSX.Element | null {
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

  const items = snapshot && projectPath ? ownerInbox(snapshot.doc, projectPath, now, placeStatesOf?.([projectPath])) : [];
  // The box emptied while open (the last item decided): it closes, and does not pop open by itself later.
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  if (!snapshot || !projectPath) return null;
  const strip = ledgerStrip(snapshot.doc, projectPath);
  if (strip.total === 0) return null;
  const waiting = inboxSummary(items);

  return (
    <div className={styles.ledger} data-testid="ledger-strip">
      <div className={styles.ledgerNumbers}>
        <span className={styles.ledgerTitle}>Oráculo Harrow</span>
        <span>{strip.open} abertas</span>
        <span>{strip.running} em execução</span>
        <span>{strip.deliveredUnaccepted} entregues sem aceite</span>
        <button
          type="button"
          className={waiting.total > 0 ? `${styles.ledgerWaiting} ${styles.ledgerWaitingOn}` : styles.ledgerWaiting}
          disabled={waiting.total === 0}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {waiting.total} esperando você
          {waiting.oldestSince !== null ? ` · a mais antiga há ${waitedFor(waiting.oldestSince, now)}` : ''}
        </button>
        <span>{strip.validatedWithoutOwnerPct === null ? 'nenhuma validada ainda' : `${strip.validatedWithoutOwnerPct}% validadas sem você`}</span>
        {snapshot.readOnly ? <span className={styles.ledgerMeta}>gravado por versão mais nova: só leitura</span> : null}
      </div>
      {open && items.length > 0 && cardsHost ? createPortal(<OwnerInbox items={items} now={now} placeName={placeName} onClose={close} />, cardsHost) : null}
    </div>
  );
}
