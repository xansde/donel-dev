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
import { deriveFooter, formatElapsed, type FooterAction } from './workingFooterModel';

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
export function WorkingFooter({ live, rows, terminal, onInterruptPending }: WorkingFooterProps): React.JSX.Element | null {
  const lastAction = useRef<LiveAction | null>(null);
  if (live?.currentAction) lastAction.current = live.currentAction;
  const screenWorking = useScreenWorking(terminal);
  const model = deriveFooter({ live, rows, lastAction: lastAction.current, screenWorking });
  const onStop = (): void => {
    if (onInterruptPending) onInterruptPending();
    else void stopWorking(terminal);
  };

  // Elapsed time of the round: counted from when this view first saw it working.
  const workingSince = useRef<number | null>(null);
  const working = model?.kind === 'working';
  if (working && workingSince.current === null) workingSince.current = Date.now();
  if (!working) workingSince.current = null;
  const [, setTick] = useState(0);
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

  const elapsed = formatElapsed(Date.now() - (workingSince.current ?? Date.now()));
  return (
    <div className={styles.wrap}>
      <Banner
        tone="muted"
        variant="live"
        icon={<StateDot state="working" />}
        title={
          <span data-testid="working-footer" data-state="working" className={styles.line}>
            <span>trabalhando —</span>
            {model.verb !== undefined ? (
              <ActionText action={{ verb: model.verb, ...(model.target !== undefined ? { target: model.target } : {}) }} />
            ) : model.waitingSubagents > 0 ? (
              <span className={styles.verb}>
                Aguardando {model.waitingSubagents} {model.waitingSubagents === 1 ? 'subagente' : 'subagentes'}
              </span>
            ) : null}
            <span className={styles.elapsed}>{elapsed}</span>
          </span>
        }
        actions={
          <>
            <Kbd>Esc</Kbd>
            <Button variant="secondary" onClick={onStop} iconLeft={<Square size={12} fill="currentColor" strokeWidth={1.75} />}>
              Parar
            </Button>
          </>
        }
      />
    </div>
  );
}
