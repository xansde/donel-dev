// Ledger v5, fatia 3 (docs/planos/ledger-v5.md, D5: tela B) — the readable table of the Oráculo: every task, with
// who asked (a person or a source, never a role), with whom it is now, who does it, who registered it, the risk, the
// due date, the last delivery and the decision; the ready filters, the search, and a side panel with the timeline
// and the proofs. The words come from the mirror (`shared/ledger/table.ts` over `tarefaRow`), so the app and the
// Supabase table say the same. Read only: a decision opens the card (`onOpenCard`), as everywhere else.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CLOSING_LABELS, type ClosingKind } from '../../shared/ledger/closing';
import { DEFAULT_OWNER_NAME, type LedgerSessionsMap, type PlaceInfoOf } from '../../shared/ledger/mirror';
import {
  currentProofs,
  filterCounts,
  inFilter,
  LEDGER_TABLE_FILTERS,
  ledgerTableRows,
  matchesSearch,
  sessionCell,
  timelineOf,
  type LedgerTableFilter,
  type LedgerTableRow,
} from '../../shared/ledger/table';
import type { LedgerDoc, LedgerProof, LedgerTask } from '../../shared/ledger/contract';
import type { OwnerInboxKind } from '../../shared/ledger/inbox';
import styles from './LedgerTable.module.css';

// Every closing kind has a tone: a new kind fails the typecheck here instead of showing a grey pill.
const CLOSING_TONE: Readonly<Record<ClosingKind, string | undefined>> = {
  'concluida-por-prova': styles.toneDone,
  enviada: styles.toneDone,
  substituida: styles.toneMuted,
  cancelada: styles.toneMuted,
};

const STATE_TONE: Readonly<Record<string, string | undefined>> = {
  aberta: styles.toneMuted,
  'em execução': styles.toneRun,
  entregue: styles.toneDelivered,
  aceita: styles.toneDone,
  'aceita, esperando envio': styles.toneWait,
  rejeitada: styles.toneBad,
  ...Object.fromEntries((Object.keys(CLOSING_LABELS) as ClosingKind[]).map((kind) => [CLOSING_LABELS[kind], CLOSING_TONE[kind]])),
};

function dayMonth(iso: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[2]}/${match[1]}` : iso;
}

function when(at: number): string {
  return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Past due and still open. */
function overdue(row: LedgerTableRow, today: string): boolean {
  return !row.closed && row.row.prazo < today;
}

function ProofItem({ proof }: { readonly proof: LedgerProof }): React.JSX.Element {
  if (proof.kind === 'texto') return <pre className={styles.proofText}>{proof.text}</pre>;
  const label = proof.kind === 'link' ? proof.url : proof.file;
  return (
    <button type="button" className={styles.proofLink} title={label} onClick={() => void window.donel?.ledger?.openProof(proof)}>
      {proof.kind === 'link' ? '↗ ' : '▣ '}
      {label}
    </button>
  );
}

function Panel({
  item,
  places,
  ownerName,
  onOpenCard,
  onClose,
}: {
  readonly item: LedgerTableRow;
  readonly places: PlaceInfoOf | undefined;
  readonly ownerName: string;
  readonly onOpenCard: (task: LedgerTask) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { row, task } = item;
  const timeline = timelineOf(task, places, ownerName);
  const proofs = currentProofs(task);
  const ref = useRef<HTMLElement>(null);
  // At phone width the panel is under the table: bring it into view when a row is picked.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [task.id]);
  return (
    <aside ref={ref} className={styles.panel} aria-label="Detalhe da tarefa">
      <div className={styles.panelHead}>
        <span className={styles.code}>{row.id}</span>
        <span className={`${styles.pill} ${STATE_TONE[row.estado] ?? ''}`}>{row.estado}</span>
        <span className={row.risco === 'alto' ? styles.riskHigh : styles.riskLow}>risco {row.risco}</span>
        <span className={styles.board}>{row.quadro}</span>
        <button type="button" className={styles.close} aria-label="Fechar o detalhe" onClick={onClose}>
          ✕
        </button>
      </div>
      <h2 className={styles.panelTitle}>{row.titulo}</h2>
      {item.onCard ? (
        <button type="button" className={styles.primary} onClick={() => onOpenCard(task)}>
          Abrir a carta para decidir
        </button>
      ) : null}

      <h3 className={styles.section}>A frase de quem pediu</h3>
      <blockquote className={styles.quote}>{row.pedido}</blockquote>

      <h3 className={styles.section}>Papéis</h3>
      <dl className={styles.roles}>
        <dt>Pediu</dt>
        <dd className={item.askedMissing ? styles.missing : undefined}>{item.askedBy}</dd>
        <dt>Registrou</dt>
        <dd>{row.quem_criou}</dd>
        <dt>Faz agora</dt>
        <dd>{row.quem_faz_agora}</dd>
        <dt>Com quem está</dt>
        <dd className={item.waitsForOwner ? styles.you : undefined}>{item.withWhom}</dd>
        <dt>Decide</dt>
        <dd>{row.risco === 'alto' ? 'você (risco alto)' : 'Revisor ou você (risco baixo)'}</dd>
        <dt>Prazo</dt>
        <dd>{dayMonth(row.prazo)}</dd>
      </dl>

      <h3 className={styles.section}>Pronto quando</h3>
      <p className={styles.text}>{task.doneWhen}</p>

      {row.decisao ? (
        <>
          <h3 className={styles.section}>Decisão</h3>
          <p className={styles.text}>{row.decisao}</p>
          {row.motivo ? <p className={styles.textMuted}>{row.motivo}</p> : null}
        </>
      ) : null}

      <h3 className={styles.section}>Provas{proofs.length ? ` da última entrega (${proofs.length})` : ''}</h3>
      {proofs.length ? (
        <div className={styles.proofs}>
          {proofs.map((proof, index) => (
            <ProofItem key={index} proof={proof} />
          ))}
        </div>
      ) : (
        <p className={styles.textMuted}>Nenhuma entrega ainda.</p>
      )}

      <h3 className={styles.section}>Linha do tempo</h3>
      <ol className={styles.timeline}>
        {timeline.map((entry, index) => (
          <li key={index}>
            <span className={styles.time}>{when(entry.at)}</span>
            <span>
              {entry.text}
              {entry.note ? <span className={styles.note}>{entry.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.footer}>{timeline.length === 1 ? '1 passo' : `${timeline.length} passos`}</p>
    </aside>
  );
}

export function LedgerTable({
  doc,
  places,
  ownerName,
  onOpenCard,
  inbox,
  sessions,
}: {
  readonly doc: LedgerDoc;
  readonly places: PlaceInfoOf | undefined;
  readonly ownerName: string | null;
  /** The session of each live task (t-5c0df1df, the column "Sessão"). */
  readonly sessions?: LedgerSessionsMap;
  /** Opens the card of a task that waits for the owner (where he decides). */
  readonly onOpenCard: (task: LedgerTask) => void;
  /** The box "Esperando você" (task id → kind): the filter "Esperando você" shows the same items. */
  readonly inbox?: ReadonlyMap<string, OwnerInboxKind>;
}): React.JSX.Element {
  const owner = ownerName?.trim() || DEFAULT_OWNER_NAME;
  const rows = useMemo(() => ledgerTableRows(doc, places, owner, inbox), [doc, places, owner, inbox]);
  const counts = useMemo(() => filterCounts(rows), [rows]);
  const [filter, setFilter] = useState<LedgerTableFilter>('tudo');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shown = rows.filter((row) => inFilter(row, filter) && matchesSearch(row, query));
  const selected = rows.find((row) => row.task.id === selectedId) ?? null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className={styles.wrap} data-testid="ledger-table">
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filtros">
          {LEDGER_TABLE_FILTERS.map(({ id, label }) => (
            <button key={id} type="button" className={filter === id ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <b>{counts[id]}</b>
            </button>
          ))}
        </div>
        <input
          type="search"
          className={styles.search}
          placeholder="Buscar por frase, pessoa, lugar, código…"
          aria-label="Buscar tarefas"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className={selected ? `${styles.body} ${styles.bodyWithPanel}` : styles.body}>
        <div className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colCode}>Código</th>
                <th className={styles.colTitle}>Título</th>
                <th className={styles.colState}>Estado</th>
                <th className={styles.colWith}>Com quem está</th>
                <th className={styles.colAsked}>Quem pediu</th>
                <th className={`${styles.colDoer} ${styles.secondary}`}>Quem faz agora</th>
                <th className={`${styles.colSession} ${styles.secondary}`}>Sessão</th>
                <th className={`${styles.colCreator} ${styles.secondary}`}>Quem criou</th>
                <th className={`${styles.colRisk} ${styles.secondary}`}>Risco</th>
                <th className={`${styles.colDue} ${styles.secondary}`}>Prazo</th>
                <th className={`${styles.colLast} ${styles.secondary}`}>Última entrega</th>
                <th className={`${styles.colDecision} ${styles.secondary}`}>Decisão</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const { row } = item;
                return (
                  <tr
                    key={row.id}
                    className={item.task.id === selectedId ? styles.rowOn : undefined}
                    tabIndex={0}
                    aria-selected={item.task.id === selectedId}
                    onClick={() => setSelectedId(item.task.id === selectedId ? null : item.task.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(item.task.id === selectedId ? null : item.task.id);
                      }
                    }}
                  >
                    <td className={styles.code} title={`${row.quadro} · ${row.id}`}>
                      {row.id}
                    </td>
                    <td title={row.titulo}>
                      {item.task.slack ? '✉ ' : ''}
                      {row.titulo}
                    </td>
                    <td>
                      <span className={`${styles.pill} ${STATE_TONE[row.estado] ?? ''}`}>{row.estado}</span>
                    </td>
                    <td className={item.waitsForOwner ? styles.you : undefined} title={item.withWhom}>
                      {item.withWhom}
                    </td>
                    <td className={item.askedMissing ? styles.missing : undefined} title={item.askedBy}>
                      {item.askedBy}
                    </td>
                    <td className={styles.secondary} title={row.quem_faz_agora}>
                      {row.quem_faz_agora}
                    </td>
                    <td className={`${styles.secondary} ${styles.code}`} title={sessionCell(item.task, sessions).full}>
                      {sessionCell(item.task, sessions).text}
                    </td>
                    <td className={styles.secondary} title={row.quem_criou}>
                      {row.quem_criou}
                    </td>
                    <td className={`${styles.secondary} ${row.risco === 'alto' ? styles.riskHigh : ''}`}>{row.risco}</td>
                    <td className={`${styles.secondary} ${overdue(item, today) ? styles.overdue : ''}`}>
                      {dayMonth(row.prazo)}
                      {overdue(item, today) ? ' · vencido' : ''}
                    </td>
                    <td className={styles.secondary} title={row.ultima_entrega ?? ''}>
                      {row.ultima_entrega ?? '—'}
                    </td>
                    <td className={styles.secondary} title={row.decisao ?? ''}>
                      {row.decisao ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 ? <p className={styles.emptyRows}>{query ? 'Nada com essa busca neste filtro.' : 'Nenhuma tarefa neste filtro.'}</p> : null}
        </div>
        {selected ? <Panel item={selected} places={places} ownerName={owner} onOpenCard={onOpenCard} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  );
}
