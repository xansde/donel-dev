// Ledger com prova (item 19) — the strip of numbers on top of the board: open, running, delivered without an
// accept, waiting for the owner (with the oldest) and "validadas sem você". No screen of its own: "esperando
// você" opens a short list under the strip where the owner accepts (or confirms a Revisor's accept) or rejects
// with a reason. The numbers are pure (`ledgerStrip`, shared/ledger/contract.ts); every decision goes to the
// main as the owner. Hidden while the board has no task.

import { useEffect, useState } from 'react';
import { lastDelivery, ledgerStrip, ownerQueue, waitingSince, type LedgerActor, type LedgerProof, type LedgerTask } from '../../../shared/ledger/contract';
import type { LedgerSnapshot } from '../../../shared/ledger/channels';
import styles from './Mindscape.module.css';

function ago(since: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function who(actor: LedgerActor): string {
  return actor.kind === 'dono' ? 'você' : actor.placeId;
}

function ProofView({ proof }: { readonly proof: LedgerProof }): React.JSX.Element {
  if (proof.kind === 'texto') {
    return (
      <details className={styles.ledgerProofText}>
        <summary>Saída ({proof.text.length} caracteres)</summary>
        <pre>{proof.text}</pre>
      </details>
    );
  }
  const label = proof.kind === 'link' ? proof.url : proof.mediaType.startsWith('video/') ? 'Abrir vídeo' : 'Abrir print';
  return (
    <button type="button" className={styles.ledgerLink} onClick={() => void window.donel.ledger.openProof(proof)} title={proof.kind === 'link' ? proof.url : proof.file}>
      {label}
    </button>
  );
}

function QueueItem({ task, now }: { readonly task: LedgerTask; readonly now: number }): React.JSX.Element {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const delivery = lastDelivery(task);
  const sample = task.state === 'aceita';
  const decide = async (accept: boolean): Promise<void> => {
    const result = await window.donel.ledger.decide(accept ? { id: task.id, accept: true } : { id: task.id, accept: false, reason }).catch(() => null);
    if (!result) setError('O app não respondeu.');
    else if (!result.ok) setError(result.reason);
  };
  return (
    <li className={styles.ledgerItem} data-testid="ledger-item">
      <div className={styles.ledgerItemHead}>
        <strong>{task.request}</strong>
        <span className={styles.ledgerMeta}>
          {sample ? 'amostra: aceita pelo Revisor' : `risco ${task.risk}`} · prazo {task.due} · há {ago(waitingSince(task), now)}
        </span>
      </div>
      <div className={styles.ledgerMeta}>Pronto quando: {task.doneWhen}</div>
      {delivery ? (
        <div className={styles.ledgerProofs}>
          <span className={styles.ledgerMeta}>Entregue por {who(delivery.by)}{delivery.text ? `: ${delivery.text}` : ''}</span>
          {delivery.proofs?.map((proof, index) => <ProofView key={index} proof={proof} />)}
        </div>
      ) : null}
      {rejecting ? (
        <div className={styles.ledgerActions}>
          <input className={styles.ledgerReason} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" autoFocus />
          <button type="button" disabled={!reason.trim()} onClick={() => void decide(false)}>
            Rejeitar
          </button>
          <button type="button" onClick={() => setRejecting(false)}>
            Voltar
          </button>
        </div>
      ) : (
        <div className={styles.ledgerActions}>
          <button type="button" onClick={() => void decide(true)}>
            {sample ? 'Conferi' : 'Aceitar'}
          </button>
          <button type="button" onClick={() => setRejecting(true)}>
            Rejeitar…
          </button>
        </div>
      )}
      {error ? <div className={styles.ledgerError}>{error}</div> : null}
    </li>
  );
}

export function LedgerStrip({ projectPath }: { readonly projectPath: string | undefined }): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [open, setOpen] = useState(false);
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
      {open && queue.length > 0 ? (
        <ul className={styles.ledgerQueue}>
          {queue.map((task) => (
            <QueueItem key={`${task.id}:${task.events.length}`} task={task} now={now} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
