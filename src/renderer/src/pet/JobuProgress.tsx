// Painel de progresso do Jobu (owner's ask, 05/11) — one line per front of work (a board of the ledger), its tasks
// indented under it, each with a bar of estimated progress and an estimated end. Folded by default and silent: it opens
// by the "Progresso" button in the bubble of the Líder (or the little dot on the Jobu), and remembers that it was open.
// The numbers are `jobuProgress` (src/shared/pet/progress.ts); this file only reads the ledger and draws.
//
// Always current: the panel is recomputed on every real event it can hear — a write to the ledger (every `tarefa_*`)
// and a session event of the Jobu (a turn that ended) — and when it opens, from a fresh read of the ledger.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyLedgerDoc, type LedgerDoc } from '../../../shared/ledger/contract';
import { endLabel, jobuProgress, PROGRESS_STEPS, type JobuProgress as Progress, type ProgressBoard, type ProgressTask } from '../../../shared/pet/progress';
import styles from './JobuProgress.module.css';

const OPEN_KEY = 'donel.pet.progressOpen';
const SEEN_KEY = 'donel.pet.progressSeenAt';

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

function Bar({ steps, total, state }: { readonly steps: number; readonly total: number; readonly state: string }): React.JSX.Element {
  const pct = total === 0 ? 0 : Math.round((100 * steps) / total);
  return (
    <span className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={steps} aria-valuetext={`${steps} de ${total} etapas`}>
      <span className={styles.fill} data-state={state} style={{ width: `${pct}%` }} />
    </span>
  );
}

function TaskLine({ task, now }: { readonly task: ProgressTask; readonly now: number }): React.JSX.Element {
  return (
    <li className={styles.task} data-testid="pet-progress-task" data-state={task.state}>
      <div className={styles.line}>
        <span className={styles.taskTitle} title={task.title}>
          {task.title}
        </span>
        <span className={styles.end} data-late={task.late ? 'true' : undefined}>
          ~{endLabel(task.endsAt, now)}
        </span>
      </div>
      <Bar steps={task.steps} total={PROGRESS_STEPS} state={task.state} />
      <div className={styles.meta}>
        {task.stepLabel}
        {task.places.length ? ` · ${task.places.join(' → ')}` : ''}
      </div>
      <div className={styles.source}>estimado {task.source}</div>
    </li>
  );
}

function BoardLine({ board, now }: { readonly board: ProgressBoard; readonly now: number }): React.JSX.Element {
  return (
    <li className={styles.board} data-testid="pet-progress-board">
      <div className={styles.line}>
        <span className={styles.boardTitle} title={board.projectPath}>
          {board.title}
        </span>
        <span className={styles.end} data-late={board.late ? 'true' : undefined}>
          ~{endLabel(board.endsAt, now)}
        </span>
      </div>
      <Bar steps={board.steps} total={board.totalSteps} state="em-execucao" />
      <div className={styles.meta}>
        {board.tasks.length} {board.tasks.length === 1 ? 'tarefa rolando' : 'tarefas rolando'} · {board.steps} de {board.totalSteps} etapas · fim = a última tarefa
      </div>
      <ul className={styles.tasks}>
        {board.tasks.map((task) => (
          <TaskLine key={task.id} task={task} now={now} />
        ))}
      </ul>
    </li>
  );
}

/** The panel itself, in the body of the bubble of the Líder. */
export function JobuProgressPanel({ state }: { readonly state: JobuProgressState }): React.JSX.Element {
  const { progress, computedAt, failed, markSeen } = state;
  // Looking at the panel is seeing what changed: the dot on the Jobu goes.
  useEffect(() => markSeen(), [markSeen]);
  return (
    <div className={styles.panel} data-testid="pet-progress">
      <div className={styles.head}>
        <span>Progresso</span>
        <span className={styles.stamp}>{failed ? 'não consegui ler o Oráculo' : `atualizado às ${clock(computedAt)}`}</span>
      </div>
      {progress.boards.length === 0 ? (
        <p className={styles.empty}>Nada rodando agora.</p>
      ) : (
        <ul className={styles.boards}>
          {progress.boards.map((board) => (
            <BoardLine key={board.projectPath} board={board} now={computedAt} />
          ))}
        </ul>
      )}
      <p className={styles.how}>Só o que está rolando: a tarefa aceita sai na hora. A barra conta as etapas da tarefa: assumida, entregue, aceita. A data vem do prazo enquanto ninguém assumiu, e do ritmo das etapas depois.</p>
    </div>
  );
}
