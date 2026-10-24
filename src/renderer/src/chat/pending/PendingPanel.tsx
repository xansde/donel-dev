// 014-chat (T078) - the pending panel, docked right above the live footer / the chat box. One pending at a
// time, in order of arrival, with "mais N esperando" (FR-035); answering shows the next one at once - no
// intermediate state (D-C15). A polite live region announces a new head without taking the focus.

import { useEffect, useMemo, useRef } from 'react';
import type { PendingAnswer } from '../../../../shared/chat/ipc';
import { pendingQueueView } from '../../../../shared/chat/pendingQueue';
import type { Pending } from '../../../../shared/chat/rows';
import { PermissionCard } from './PermissionCard';
import styles from './PendingPanel.module.css';
import { PlanCard } from './PlanCard';
import { QuestionCard } from './QuestionCard';

export interface PendingPanelProps {
  /** PTY of the tab: filters the `donel:chat-focus-pending` event (notification click). */
  ptyId: string | null;
  pendings: readonly Pending[];
  /** The plan whose adjustment field is open in the chat box, if any. */
  adjustingPlanId: string | null;
  onAnswer: (pendingId: string, answer: PendingAnswer) => void;
  onAdjustStart: (pendingId: string) => void;
  onOpenExternal: (url: string) => void;
  /** Opens the side panel of a subagent (wired when the panel exists - phase 6). */
  onOpenSubagent?: (agentId: string) => void;
}

function announcement(head: Pending | null): string {
  if (head === null) return '';
  const who = head.scope === 'main' ? 'O Claude' : `Subagente ${head.scope.description}`;
  if (head.kind === 'question') return `${who} fez uma pergunta e espera por você.`;
  if (head.kind === 'plan') return `${who} propôs um plano e espera a sua aprovação.`;
  return `${who} pediu permissão e espera por você.`;
}

export function PendingPanel({
  ptyId,
  pendings,
  adjustingPlanId,
  onAnswer,
  onAdjustStart,
  onOpenExternal,
  onOpenSubagent,
}: PendingPanelProps): React.JSX.Element {
  const { head, waiting } = useMemo(() => pendingQueueView(pendings), [pendings]);
  const openOrigin =
    head !== null && head.scope !== 'main' && onOpenSubagent !== undefined
      ? () => onOpenSubagent((head.scope as { agentId: string }).agentId)
      : undefined;
  const wrapRef = useRef<HTMLDivElement>(null);
  // Notification click (T079): the App sends this DOM event; focus goes to the first control of the head pending.
  useEffect(() => {
    const onFocusPending = (event: Event): void => {
      const detail = (event as CustomEvent<{ ptyId?: string }>).detail;
      if (ptyId === null || detail?.ptyId !== ptyId) return;
      wrapRef.current?.querySelector<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled])')?.focus();
    };
    window.addEventListener('donel:chat-focus-pending', onFocusPending);
    return () => window.removeEventListener('donel:chat-focus-pending', onFocusPending);
  }, [ptyId]);
  const answer = (a: PendingAnswer): void => {
    if (head !== null) onAnswer(head.id, a);
  };

  return (
    <>
      <div className={styles.live} role="status" aria-live="polite" aria-atomic="true">
        {announcement(head)}
      </div>
      {head !== null ? (
        <div ref={wrapRef} className={styles.wrap} data-testid="pending-panel" data-kind={head.kind}>
          {head.kind === 'question' ? (
            <QuestionCard key={head.id} pending={head} waiting={waiting} onAnswer={answer} onOpenOrigin={openOrigin} />
          ) : head.kind === 'permission' ? (
            <PermissionCard key={head.id} pending={head} waiting={waiting} onAnswer={answer} onOpenOrigin={openOrigin} />
          ) : (
            <PlanCard
              key={head.id}
              pending={head}
              waiting={waiting}
              adjusting={adjustingPlanId === head.id}
              onAnswer={answer}
              onAdjust={() => onAdjustStart(head.id)}
              onOpenExternal={onOpenExternal}
              onOpenOrigin={openOrigin}
            />
          )}
        </div>
      ) : null}
    </>
  );
}
