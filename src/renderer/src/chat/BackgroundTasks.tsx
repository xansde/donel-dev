// Segundo plano visível (refinamento de 03/11, docs/refinamentos/segundo-plano-visivel.md) — what a session left
// running in the background, without opening the terminal:
// - `BackgroundStrip`: in the chat, right above the input box, while something runs (it outlives the turn);
//   it opens the list, and an item scrolls the conversation to the launch.
// - `BackgroundIndicator`: in the status bar, the total over every session, with a list per session that leads
//   to the tab.
// The data is `LiveState.background` (derived in the main, `src/shared/chat/backgroundTasks.ts`); this only draws.

import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  BACKGROUND_KIND_LABEL,
  BACKGROUND_STATE_LABEL,
  backgroundCountLabel,
  runningCount,
  sinceLabel,
} from '../../../shared/chat/backgroundTasks';
import type { BackgroundState, BackgroundTask } from '../../../shared/chat/rows';
import styles from './BackgroundTasks.module.css';

const STATE_GLYPH: Record<Exclude<BackgroundState, 'running'>, string> = {
  completed: '✓',
  failed: '✕',
  stopped: '■',
  unknown: '?',
};

/** How long "terminou" stays after the last running task ends. */
const ENDED_FLASH_MS = 8_000;

function useClock(enabled: boolean, everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [enabled, everyMs]);
  return now;
}

function StateMark({ state }: { state: BackgroundState }): React.JSX.Element {
  if (state === 'running') return <LoaderCircle className={styles.spin} size={12} strokeWidth={2} aria-hidden="true" />;
  return (
    <span className={[styles.glyph, styles[`st-${state}`]].join(' ')} aria-hidden="true">
      {STATE_GLYPH[state]}
    </span>
  );
}

/** The tasks of one session: running ones, then the last that ended. A click picks the task. */
export function BackgroundTaskList({
  tasks,
  onPick,
  now,
}: {
  tasks: readonly BackgroundTask[];
  onPick: (task: BackgroundTask) => void;
  now: number;
}): React.JSX.Element {
  return (
    <ul className={styles.list}>
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            className={styles.item}
            onClick={() => onPick(task)}
            title="Mostrar na conversa"
            data-testid="background-task"
            data-state={task.state}
          >
            <StateMark state={task.state} />
            <span className={styles.kind}>{BACKGROUND_KIND_LABEL[task.kind]}</span>
            <span className={styles.label}>{task.label}</span>
            <span className={styles.meta}>
              {task.state === 'running'
                ? `rodando ${sinceLabel(task.startedAt, now)}`
                : `${BACKGROUND_STATE_LABEL[task.state]}${task.endedAt !== undefined ? ` ${sinceLabel(task.endedAt, now)}` : ''}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Chat of the tab: "⟳ 2 em segundo plano" while anything runs; "terminou" for a moment after the last one. */
export function BackgroundStrip({
  tasks,
  onReveal,
}: {
  tasks: readonly BackgroundTask[];
  onReveal: (rowId: string) => void;
}): React.JSX.Element | null {
  const running = runningCount(tasks);
  const [open, setOpen] = useState(false);
  const [endedFlash, setEndedFlash] = useState<BackgroundState | null>(null);
  const previous = useRef(running);
  useEffect(() => {
    const before = previous.current;
    previous.current = running;
    if (running > 0) {
      setEndedFlash(null);
      return undefined;
    }
    if (before === 0) return undefined;
    // the last one just ended: say how (the newest ended task is the first after the running ones)
    setOpen(false);
    setEndedFlash(tasks[0]?.state ?? 'completed');
    const id = setTimeout(() => setEndedFlash(null), ENDED_FLASH_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const now = useClock(open);

  if (running === 0 && endedFlash === null) return null;
  if (running === 0) {
    return (
      <div className={styles.strip} data-testid="background-strip" data-state="ended">
        <span className={styles.summary}>
          <StateMark state={endedFlash ?? 'completed'} />
          {endedFlash === 'completed' ? 'segundo plano terminou' : `segundo plano: ${BACKGROUND_STATE_LABEL[endedFlash ?? 'unknown']}`}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.strip} data-testid="background-strip" data-state="running">
      {open ? (
        <div className={styles.panel}>
          <BackgroundTaskList
            tasks={tasks}
            now={now}
            onPick={(task) => {
              setOpen(false);
              onReveal(task.rowId);
            }}
          />
        </div>
      ) : null}
      <button type="button" className={styles.summaryButton} onClick={() => setOpen((v) => !v)} aria-expanded={open} title="O que está rodando em segundo plano nesta sessão">
        <StateMark state="running" />
        {backgroundCountLabel(running)}
        <span className={styles.caret} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
    </div>
  );
}

export interface BackgroundSession {
  readonly tabId: string;
  readonly ptyId: string;
  readonly name: string;
  readonly tasks: readonly BackgroundTask[];
}

/** Status bar: "⟳ 3 em segundo plano · 2 sessões", and the list per session. Nothing when nothing runs. */
export function BackgroundIndicator({
  sessions,
  onOpen,
}: {
  sessions: readonly BackgroundSession[];
  onOpen: (session: BackgroundSession, task: BackgroundTask | null) => void;
}): React.JSX.Element | null {
  const live = sessions
    .map((s) => ({ ...s, tasks: s.tasks.filter((t) => t.state === 'running') }))
    .filter((s) => s.tasks.length > 0);
  const total = live.reduce((n, s) => n + s.tasks.length, 0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const now = useClock(open);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (total === 0) setOpen(false);
  }, [total]);

  if (total === 0) return null;
  return (
    <div className={styles.indicatorRoot} ref={rootRef}>
      {open ? (
        <div className={styles.popover} data-testid="background-overview">
          {live.map((session) => (
            <section key={session.ptyId} className={styles.session}>
              <button type="button" className={styles.sessionName} onClick={() => { setOpen(false); onOpen(session, null); }} title="Ir para a aba">
                {session.name}
              </button>
              <BackgroundTaskList
                tasks={session.tasks}
                now={now}
                onPick={(task) => {
                  setOpen(false);
                  onOpen(session, task);
                }}
              />
            </section>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={styles.indicator}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="background-indicator"
        title="Tarefas em segundo plano nas sessões abertas"
      >
        <StateMark state="running" />
        {backgroundCountLabel(total)}
        {live.length > 1 ? ` · ${live.length} sessões` : ''}
      </button>
    </div>
  );
}
