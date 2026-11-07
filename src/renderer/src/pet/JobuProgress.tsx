// Painel de progresso do Jobu (owner's ask, 05/11; by front since 07/11) — the owner's asks grouped by front of work,
// each with its state and who has it, a bar per front, and what ended folded into "N concluídas hoje". Folded by
// default and silent: it opens by the "Progresso" button in the bubble of the Líder (or the little dot on the Jobu),
// and remembers that it was open and which fronts the owner folded.
// The numbers are `jobuProgress` (src/shared/pet/progress.ts); this file only reads the ledger and draws.
//
// Always current: the panel is recomputed on every real event it can hear — a write to the ledger (every `tarefa_*`)
// and a session event of the Jobu (a turn that ended) — and when it opens, from a fresh read of the ledger.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyLedgerDoc, type LedgerDoc } from '../../../shared/ledger/contract';
import { dueLabel, jobuProgress, type Front, type FrontTask, type FrontTaskState, type JobuProgress as Progress } from '../../../shared/pet/progress';
import styles from './JobuProgress.module.css';

const OPEN_KEY = 'donel.pet.progressOpen';
const SEEN_KEY = 'donel.pet.progressSeenAt';
const FOLDED_KEY = 'donel.pet.progressFolded';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private profile: the panel only forgets.
  }
}

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export interface JobuProgressState {
  readonly progress: Progress;
  /** When it was last recomputed (ms). */
  readonly computedAt: number;
  /** The ledger could not be read. */
  readonly failed: boolean;
  /** Something changed since the owner last looked at the panel. */
  readonly unseen: boolean;
  readonly open: boolean;
  setOpen(open: boolean): void;
  /** The owner is looking at the panel now. */
  markSeen(): void;
}

/**
 * Reads the ledger and keeps the panel current. `eventKey` changes on every session event the Jobu hears (a new bubble):
 * that recomputes too, since the estimate of a task under way depends on the clock.
 */
export function useJobuProgress(eventKey: string): JobuProgressState {
  const [doc, setDoc] = useState<LedgerDoc>(emptyLedgerDoc);
  const [failed, setFailed] = useState(false);
  const [computedAt, setComputedAt] = useState(() => Date.now());
  const [open, setOpenState] = useState(() => readStored(OPEN_KEY) === '1');
  const [seenAt, setSeenAt] = useState(() => Number(readStored(SEEN_KEY)) || 0);

  const reload = useCallback((): void => {
    void window.donel.ledger
      .load()
      .then((snapshot) => {
        setDoc(snapshot.doc);
        setFailed(false);
        setComputedAt(Date.now());
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const off = window.donel.ledger.onChanged((snapshot) => {
      setDoc(snapshot.doc);
      setFailed(false);
      setComputedAt(Date.now());
    });
    reload();
    return off;
  }, [reload]);

  useEffect(() => setComputedAt(Date.now()), [eventKey]);

  const progress = useMemo(() => jobuProgress(doc, computedAt), [doc, computedAt]);

  const setOpen = useCallback(
    (next: boolean): void => {
      setOpenState(next);
      writeStored(OPEN_KEY, next ? '1' : '0');
      if (next) reload(); // opening always shows the latest version of the ledger
    },
    [reload],
  );

  const changedAt = progress.changedAt;
  const markSeen = useCallback((): void => {
    if (changedAt === null || changedAt <= seenAt) return;
    setSeenAt(changedAt);
    writeStored(SEEN_KEY, String(changedAt));
  }, [changedAt, seenAt]);

  return { progress, computedAt, failed, unseen: changedAt !== null && changedAt > seenAt, open, setOpen, markSeen };
}

const STATE_LABEL: Readonly<Record<FrontTaskState, string>> = {
  esperando: 'esperando você',
  travado: 'travado',
  tocando: 'tocando',
  parado: 'parado',
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function readFolded(): Set<string> {
  try {
    const raw = JSON.parse(readStored(FOLDED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The bar of a front: one segment per ask, filled by its steps, colored by its state. */
function FrontBar({ front }: { readonly front: Front }): React.JSX.Element {
  const pct = front.totalSteps === 0 ? 0 : Math.round((100 * front.steps) / front.totalSteps);
  return (
    <span className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={front.totalSteps} aria-valuenow={front.steps} aria-valuetext={`${pct}% das etapas`}>
      <span className={styles.fill} data-state={front.counts.esperando ? 'esperando' : front.counts.travado ? 'travado' : 'tocando'} style={{ width: `${pct}%` }} />
    </span>
  );
}

function TaskLine({ task, now }: { readonly task: FrontTask; readonly now: number }): React.JSX.Element {
  return (
    <li className={styles.task} data-testid="pet-progress-task" data-state={task.state}>
      <span className={styles.dot} data-state={task.state} aria-hidden="true" />
      <span className={styles.taskBody}>
        <span className={styles.taskTitle} title={task.title}>
          {task.title}
        </span>
        <span className={styles.who} data-state={task.state}>
          {STATE_LABEL[task.state]} · {task.who}
        </span>
      </span>
      <span className={styles.end} data-late={task.late && task.state !== 'esperando' ? 'true' : undefined}>
        {dueLabel(task.due, now)}
      </span>
    </li>
  );
}

function FrontLine({ front, now, folded, onToggle }: { readonly front: Front; readonly now: number; readonly folded: boolean; readonly onToggle: () => void }): React.JSX.Element {
  const { counts } = front;
  const chips = [
    counts.esperando ? <span key="e" className={styles.waiting}>{counts.esperando} esperando você</span> : null,
    counts.travado ? <span key="t" className={styles.stuck}>{plural(counts.travado, 'travado', 'travados')}</span> : null,
    counts.tocando ? <span key="o">{counts.tocando} tocando</span> : null,
    counts.parado ? <span key="p">{plural(counts.parado, 'parado', 'parados')}</span> : null,
    front.doneToday ? <span key="d">{plural(front.doneToday, 'concluída hoje', 'concluídas hoje')}</span> : null,
  ].filter((chip) => chip !== null);
  const pct = front.totalSteps === 0 ? 0 : Math.round((100 * front.steps) / front.totalSteps);
  return (
    <li className={styles.board} data-testid="pet-progress-board">
      <button type="button" className={styles.frontHead} aria-expanded={!folded} onClick={onToggle}>
        <span className={styles.chevron} aria-hidden="true">
          {folded ? '▸' : '▾'}
        </span>
        <span className={styles.boardTitle}>{front.name || 'Sem frente'}</span>
        <span className={styles.end}>{pct}%</span>
      </button>
      <FrontBar front={front} />
      <div className={styles.meta}>
        {chips.map((chip, index) => (
          <span key={index}>
            {index > 0 ? ' · ' : ''}
            {chip}
          </span>
        ))}
      </div>
      {folded ? null : (
        <ul className={styles.tasks}>
          {front.tasks.map((task) => (
            <TaskLine key={task.id} task={task} now={now} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The panel itself, in the body of the bubble of the Líder. */
export function JobuProgressPanel({ state }: { readonly state: JobuProgressState }): React.JSX.Element {
  const { progress, computedAt, failed, markSeen } = state;
  const [folded, setFolded] = useState(readFolded);
  // Looking at the panel is seeing what changed: the dot on the Jobu goes.
  useEffect(() => markSeen(), [markSeen]);
  const toggle = (name: string): void =>
    setFolded((previous) => {
      const next = new Set(previous);
      if (!next.delete(name)) next.add(name);
      writeStored(FOLDED_KEY, JSON.stringify([...next]));
      return next;
    });
  const { counts, doneToday } = progress;
  return (
    <div className={styles.panel} data-testid="pet-progress">
      <div className={styles.head}>
        <span>Progresso · seus pedidos</span>
        <span className={styles.stamp}>{failed ? 'não consegui ler o Oráculo' : `atualizado às ${clock(computedAt)}`}</span>
      </div>
      {progress.fronts.length === 0 ? (
        <p className={styles.empty}>Nenhum pedido seu em aberto.</p>
      ) : (
        <>
          <div className={styles.summary}>
            {(['esperando', 'travado', 'tocando', 'parado'] as const).map((key) => (
              <span key={key}>
                <span className={styles.dot} data-state={key} aria-hidden="true" />
                <b>{counts[key]}</b> {key === 'esperando' ? 'esperando você' : key === 'travado' ? 'travados' : key === 'parado' ? 'parados' : 'tocando'}
              </span>
            ))}
          </div>
          <ul className={styles.boards}>
            {progress.fronts.map((front) => (
              <FrontLine key={front.name} front={front} now={computedAt} folded={folded.has(front.name)} onToggle={() => toggle(front.name)} />
            ))}
          </ul>
        </>
      )}
      {doneToday.length > 0 ? (
        <details className={styles.done}>
          <summary>{plural(doneToday.length, 'concluída hoje', 'concluídas hoje')}</summary>
          <ul className={styles.tasks}>
            {doneToday.map((task) => (
              <li key={task.id} className={styles.task}>
                <span className={styles.dot} data-state="concluida" aria-hidden="true" />
                <span className={styles.taskBody}>
                  <span className={styles.taskTitle} title={task.title}>
                    {task.title}
                  </span>
                  <span className={styles.who}>{task.front || 'Sem frente'}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className={styles.how}>Só os seus pedidos, pela frente que o Líder deu a cada um. A barra conta as etapas dos pedidos da frente (assumido, entregue, aceito), contando os aceitos hoje. Parado: ninguém assumiu, ninguém deu notícia em um dia, ou a entrega espera conferência há 12 h.</p>
    </div>
  );
}
