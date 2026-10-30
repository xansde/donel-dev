// T068 (014-chat) - the live footer above the input box (G2): StateDot, "trabalhando - <acao>", elapsed time,
// Kbd Esc and Parar; after Parar it says "Interrompido - o Claude parou depois de <acao>" until the next send.
// The order of the bottom slot is: pending -> live footer -> input box.

import { Banner, Button, Kbd, StateDot } from '@donel-dev/design-system';
import { Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ConversationRow, LiveAction, LiveState } from '../../../shared/chat/rows';
import { isWorking } from '../../../shared/chat/screen';
import type { LineInput } from '../../../shared/chat/screen';
import { stopWorking, type StoppableTerminal } from './stopWorking';
import styles from './WorkingFooter.module.css';
import { deriveFooter, expiredStopRequest, formatElapsed, STOP_STUCK_HINT, stopFeedback, WAITING_FOR_LABEL, type FooterAction } from './workingFooterModel';

/** The slice of `TerminalPaneHandle` the footer reads (screen) and writes (Parar). */
export interface FooterTerminal extends StoppableTerminal {
  readScreen(): { readonly lines: readonly LineInput[] };
  onScreenUpdate(listener: () => void): () => void;
}

export interface WorkingFooterProps {
  live: LiveState | null;
  rows: readonly ConversationRow[];
  /** The tab's terminal: its screen proves "esc to interrupt" and Parar writes Esc to it. `null` before it mounts. */
  terminal: FooterTerminal | null;
  /** A pending is open: Parar answers it with `interrupt` instead of writing Esc to the terminal (T078). */
  onInterruptPending?: () => void;
  /** `Date.now()` of the last Parar / Esc press (or an already expired stamp when it reached nothing); `null` = none. */
  stopRequestedAt?: number | null;
  /** Parar was pressed (stamp) or the round ended (`null`). The view owns the stamp because Esc also sets it. */
  onStopRequestedAt?: (at: number | null) => void;
  /** The screen proved the round over after a stop: the footer leaves "trabalhando" without waiting for a Stop hook. */
  endedByScreen?: boolean;
}

/** `true` while the screen footer says "esc to interrupt"; `null` without a terminal. Re-renders only on change. */
function useScreenWorking(terminal: FooterTerminal | null): boolean | null {
  const [working, setWorking] = useState<boolean | null>(null);
  useEffect(() => {
    if (terminal === null) {
      setWorking(null);
      return undefined;
    }
    const read = (): void => setWorking(isWorking(terminal.readScreen().lines));
    read();
    return terminal.onScreenUpdate(read);
  }, [terminal]);
  return working;
}

function ActionText({ action }: { action: FooterAction }): React.JSX.Element {
  return (
    <>
      <span className={styles.verb}>{action.verb}</span>
      {action.target !== undefined ? <span className={styles.target}>{action.target}</span> : null}
    </>
  );
}

/** Renders nothing unless the round is running or was just interrupted. */
export function WorkingFooter({ live, rows, terminal, onInterruptPending, stopRequestedAt = null, onStopRequestedAt, endedByScreen = false }: WorkingFooterProps): React.JSX.Element | null {
  const lastAction = useRef<LiveAction | null>(null);
  if (live?.currentAction) lastAction.current = live.currentAction;
  const screenWorking = useScreenWorking(terminal);
  const model = deriveFooter({ live, rows, lastAction: lastAction.current, screenWorking, endedByScreen });
  const onStop = (): void => {
    let reached = true;
    if (onInterruptPending) onInterruptPending();
    else reached = stopWorking(terminal);
    onStopRequestedAt?.(reached ? Date.now() : expiredStopRequest(Date.now()));
  };

  // Elapsed time of the round: counted from when this view first saw it working.
  const workingSince = useRef<number | null>(null);
  const working = model?.kind === 'working';
  if (working && workingSince.current === null) workingSince.current = Date.now();
  if (!working) workingSince.current = null;
  const [, setTick] = useState(0);
  // The round ended (or never was): a stop stamp from before means nothing for the next one.
  useEffect(() => {
    if (!working && stopRequestedAt !== null) onStopRequestedAt?.(null);
  }, [working, stopRequestedAt, onStopRequestedAt]);
  useEffect(() => {
    if (!working) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [working]);

  if (model === null) return null;

  if (model.kind === 'interrupted') {
    return (
      <div className={styles.wrap}>
        <Banner
          tone="waiting"
          variant="live"
          icon={<StateDot state="waiting" />}
          title={
            <span data-testid="working-footer" data-state="interrupted" className={styles.line}>
              <span>Interrompido — o Claude parou{model.after ? ' depois de' : ''}</span>
              {model.after ? <ActionText action={model.after} /> : null}
            </span>
          }
          actions={<span className={styles.hint}>escreva para continuar</span>}
        />
      </div>
    );
  }

  const feedback = stopFeedback(stopRequestedAt, Date.now());
  const elapsed = formatElapsed(Date.now() - (workingSince.current ?? Date.now()));
  return (
    <div className={styles.wrap}>
      <Banner
        tone="muted"
        variant="live"
        icon={<StateDot state="working" />}
        title={
          <span data-testid="working-footer" data-state="working" className={styles.line}>
            <span>{model.waitingFor !== undefined ? 'esperando você —' : 'trabalhando —'}</span>
            {model.waitingFor !== undefined ? (
              <span className={styles.verb}>{WAITING_FOR_LABEL[model.waitingFor]}</span>
            ) : model.verb !== undefined ? (
              <>
                <ActionText action={{ verb: model.verb, ...(model.target !== undefined ? { target: model.target } : {}) }} />
                {model.actionStartedAt !== undefined ? (
                  <span className={styles.hint}>há {formatElapsed(Date.now() - Date.parse(model.actionStartedAt))}</span>
                ) : null}
                {model.alsoSubagents !== undefined ? (
                  <span className={styles.hint}>
                    + {model.alsoSubagents} {model.alsoSubagents === 1 ? 'subagente' : 'subagentes'}
                  </span>
                ) : null}
              </>
            ) : model.waitingSubagents > 0 ? (
              <span className={styles.verb}>
                Aguardando {model.waitingSubagents} {model.waitingSubagents === 1 ? 'subagente' : 'subagentes'}
              </span>
            ) : model.thinking ? (
              <span className={styles.verb}>pensando</span>
            ) : null}
            <span className={styles.elapsed}>{elapsed}</span>
          </span>
        }
        actions={
          <>
            {feedback === 'stuck' ? (
              <span className={styles.hint} data-testid="working-footer-stuck">
                {STOP_STUCK_HINT}
              </span>
            ) : null}
            <Kbd>Esc</Kbd>
            <Button
              variant="secondary"
              onClick={onStop}
              disabled={feedback === 'stopping'}
              iconLeft={<Square size={12} fill="currentColor" strokeWidth={1.75} />}
            >
              {feedback === 'stopping' ? 'parando…' : 'Parar'}
            </Button>
          </>
        }
      />
    </div>
  );
}
