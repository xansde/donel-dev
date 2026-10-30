// T056/T057 (014-chat) - the chat view of one tab: strips (G4) on top, the
// conversation, and the bottom slot (the composer arrives in a later phase;
// when the session ended, the "Sessão encerrada" bar takes its place - G5).
// The header (Toggle / Chat | Terminal / Kbd) lives in App's `sessionHeader`
// (D-C22); this component draws only the area below it.

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildImageAssetUrl } from '../../../shared/chat/assetUrl';
import type { PendingAnswer } from '../../../shared/chat/ipc';
import { pendingQueueView } from '../../../shared/chat/pendingQueue';
import type { ConversationRow } from '../../../shared/chat/rows';
import type { TerminalPaneHandle } from '../TerminalPane';
import styles from './ChatView.module.css';
import { ChatComposer } from './composer/ChatComposer';
import { mergeOptimistic } from './composer/optimistic';
import { getDraft, rewireTab, sendDriverFor, setDraft } from './composer/tabSend';
import { PendingPanel } from './pending/PendingPanel';
import { ConversationSwitchBanner, ReceptionBanner } from './ReceptionBanner';
import { joinAnswerMarkdown } from './markdown';
import type { AnswerInfo, RowRenderContext } from './renderRow';
import { SessionEndedBar } from './SessionEndedBar';
import { Timeline } from './Timeline';
import { WorkingFooter } from './WorkingFooter';
import { escapeAction, stopWorking } from './stopWorking';
import { expiredStopRequest, isExpiredStop } from './workingFooterModel';
import { isReadyForInput, isWorking, readInputText } from '../../../shared/chat/screen';
import { restoreDraft } from '../../../shared/chat/returnedPrompt';
import { planReturned } from './composer/returnedReclaim';
import { openStopWindow, stepStopWindow, type StopWindow } from './stopWindow';
import { useTerminalNeededReporter } from './useTerminalNeededReporter';
import { useChatSession } from './useChatSession';

/**
 * What the view asks of the App, by tab id. The object must be STABLE (App
 * builds it once, behind a ref) so `ChatView` can be memoised: the App
 * re-renders on every semaphore tick and a 10k-row timeline must not follow.
 */
export interface ChatViewActions {
  openTerminal(tabId: string): void;
  /** "Retomar": respawns the PTY resuming this same conversation. */
  resume(tabId: string): void;
  closeTab(tabId: string): void;
  /** "abrir" on the new-conversation notice. */
  openPreviousSessions(tabId: string): void;
  /** Hidden terminal of the tab: the send driver writes to it and reads its screen (T065); screen detectors and Parar use it too (T068/T070). `null` before it mounts. */
  terminal(tabId: string): TerminalPaneHandle | null;
}

export interface ChatViewProps {
  tabId: string;
  actions: ChatViewActions;
  /** PTY of the tab (kept after the process exits so the conversation stays readable); `null` before the first spawn. */
  ptyId: string | null;
  /** The tab is the active one AND its view is the chat. */
  active: boolean;
  focusMode: boolean;
  /** The process exited (FR-034). `null` = alive. */
  ended: { readonly exitCode: number | null } | null;
  /** Slot right above the composer (live footer, terminal-needed strip). The composer itself is always drawn. */
  footer?: ReactNode;
  /** Folder of the tab (a file picked inside it is mentioned as `@relative`). */
  cwd?: string;
}

/**
 * One answer = a run of consecutive `assistant` rows of the same turn (one per
 * text block). Its first block carries the header; "copiar resposta" copies
 * the markdown source of all of them (D-C9).
 */
function buildAnswerInfo(rows: readonly ConversationRow[]): ReadonlyMap<string, AnswerInfo> {
  const info = new Map<string, AnswerInfo>();
  let run: Extract<ConversationRow, { kind: 'assistant' }>[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const copyMarkdown = joinAnswerMarkdown(run.map((r) => r.markdown));
    run.forEach((r, i) => info.set(r.id, { showHeader: i === 0, copyMarkdown }));
    run = [];
  };
  for (const row of rows) {
    if (row.kind === 'assistant' && (run.length === 0 || run[0]!.turnId === row.turnId)) run.push(row);
    else {
      flush();
      if (row.kind === 'assistant') run.push(row);
    }
  }
  flush();
  return info;
}

const isSwitchNotice = (row: ConversationRow): boolean => row.kind === 'notice' && row.notice === 'conversation-switch';

export const ChatView = memo(function ChatView({
  tabId,
  actions,
  ptyId,
  active,
  focusMode,
  ended,
  footer,
  cwd,
}: ChatViewProps): React.JSX.Element {
  const session = useChatSession(ptyId);
  const onOpenTerminal = useCallback(() => actions.openTerminal(tabId), [actions, tabId]);
  const onResume = useCallback(() => actions.resume(tabId), [actions, tabId]);
  // Ctrl+O in the box toggles every fold of the timeline.
  const [foldToggleTick, setFoldToggleTick] = useState(0);
  const onToggleFolds = useCallback(() => setFoldToggleTick((tick) => tick + 1), []);
  const onCloseTab = useCallback(() => actions.closeTab(tabId), [actions, tabId]);
  const onOpenPreviousSessions = useCallback(() => actions.openPreviousSessions(tabId), [actions, tabId]);

  // T065/T067: one send driver per tab; the messages it is sending show up as optimistic rows.
  const source = useMemo(() => ({ terminal: () => actions.terminal(tabId) }), [actions, tabId]);
  const driver = useMemo(() => sendDriverFor(tabId, source), [tabId, source]);
  const items = useSyncExternalStore(
    useCallback((onChange) => driver.subscribe(onChange), [driver]),
    () => driver.getItems(),
  );
  const merged = useMemo(() => mergeOptimistic(session.rows, items), [session.rows, items]);
  const allRows = merged.rows;

  const effectiveEnded = ended ?? (session.live?.status === 'ended' ? { exitCode: null } : null);
  const alive = effectiveEnded === null;
  const pendingOpen = (session.live?.pendings.length ?? 0) > 0;
  const terminalNeeded = session.live?.terminalNeeded != null;
  // "not-receiving" only happens mid-turn (activity newer than the transcript).
  const working = session.live?.status === 'working' || session.live?.status === 'not-receiving';
  const pendings = session.live?.pendings;
  const head = useMemo(() => pendingQueueView(pendings ?? []).head, [pendings]);
  const headId = head?.id ?? null;
  // T078: the plan whose adjustment field is open in the chat box. Closes when that plan is no longer the head.
  const [adjustingPlanId, setAdjustingPlanId] = useState<string | null>(null);
  useEffect(() => {
    setAdjustingPlanId((current) => (current !== null && current !== headId ? null : current));
  }, [headId]);
  // "not-open" (someone answered first) is not an error: the live update removes the pending.
  const onAnswer = useCallback(
    (pendingId: string, answer: PendingAnswer) => {
      void session.answer(pendingId, answer).catch(() => undefined);
    },
    [session.answer],
  );
  const onAdjustSubmit = useCallback(
    (text: string) => {
      if (adjustingPlanId === null) return;
      onAnswer(adjustingPlanId, { kind: 'plan-adjust', text });
      setAdjustingPlanId(null);
    },
    [adjustingPlanId, onAnswer],
  );
  const onAdjustCancel = useCallback(() => setAdjustingPlanId(null), []);
  const adjustMode = useMemo(
    () => (adjustingPlanId === null ? null : { onSubmit: onAdjustSubmit, onCancel: onAdjustCancel }),
    [adjustingPlanId, onAdjustSubmit, onAdjustCancel],
  );
  const onInterruptPending = useMemo(
    () => (headId === null ? undefined : () => onAnswer(headId, { kind: 'interrupt' })),
    [headId, onAnswer],
  );
  // A respawn (resume) gives the tab a new PTY: re-attach the screen and signal subscriptions.
  useEffect(() => {
    rewireTab(tabId);
  }, [tabId, ptyId]);
  useEffect(() => {
    driver.setEnv({ alive, pendingOpen, terminalNeeded, working });
  }, [driver, alive, pendingOpen, terminalNeeded, working]);

  // Parar / Esc feedback ("parando…" until the round ends or a short timeout); both entry points stamp it.
  const [stopRequestedAt, setStopRequestedAt] = useState<number | null>(null);
  // No Stop hook comes after an Esc: inside the window of a stop that reached the terminal, the screen ends the round.
  const [stopWindow, setStopWindow] = useState<StopWindow | null>(null);
  const windowRef = useRef<StopWindow | null>(null);
  const onStopRequestedAt = useCallback((at: number | null) => {
    setStopRequestedAt(at);
    if (at !== null && !isExpiredStop(at, Date.now())) {
      windowRef.current = openStopWindow(at);
      setStopWindow(windowRef.current);
    }
  }, []);
  const terminal = actions.terminal(tabId);
  const latest = useRef({ rows: allRows, items });
  latest.current = { rows: allRows, items };
  const windowOpen = stopWindow !== null;
  useEffect(() => {
    if (!windowOpen || terminal === null) return undefined;
    const read = (): void => {
      const lines = terminal.readScreen().lines;
      const step = stepStopWindow(windowRef.current, { working: isWorking(lines), ready: isReadyForInput(lines), boxText: readInputText(lines) }, Date.now());
      if (step.box !== null) {
        // The CLI gave the message back to its box (Esc before the first answer): same treatment as the leftover seen
        // by a waiting message - clear the box (idle, so Esc Esc is safe), text to the chat box, card "interrompida".
        const plan = planReturned(step.box, latest.current.rows, latest.current.items);
        if (plan !== null) {
          terminal.write('\x1b\x1b');
          setDraft(tabId, restoreDraft(getDraft(tabId), plan.text));
          if (plan.sourceId !== null) driver.markReturned(plan.sourceId);
        }
      }
      windowRef.current = step.window;
      setStopWindow(step.window);
    };
    read();
    return terminal.onScreenUpdate(read);
  }, [windowOpen, terminal, tabId, driver]);
  // The live round is over for real (a Stop hook came, or the process ended): the window means nothing any more.
  useEffect(() => {
    if (session.live?.status !== 'working') {
      windowRef.current = null;
      setStopWindow(null);
    }
  }, [session.live?.status]);
  const endedByScreen = stopWindow?.confirmed === true;
  useTerminalNeededReporter(terminal, ptyId, session.live);
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Escape' || !active) return;
      const live = session.live;
      // D-C24: menus, fields and the side panel already took their Esc (defaultPrevented); then the head
      // pending is denied without reason; Parar is the last case.
      const action = escapeAction({
        defaultPrevented: event.defaultPrevented,
        working: live?.status === 'working',
        openPendings: live?.pendings.length ?? 0,
      });
      if (action === 'deny-head' && headId !== null) {
        event.preventDefault();
        onAnswer(headId, { kind: 'deny' });
      } else if (action === 'stop') {
        const reached = stopWorking(actions.terminal(tabId));
        if (reached) event.preventDefault();
        onStopRequestedAt(reached ? Date.now() : expiredStopRequest(Date.now()));
      }
    },
    [actions, tabId, active, session.live, headId, onAnswer, onStopRequestedAt],
  );


  const answers = useMemo(() => buildAnswerInfo(allRows), [allRows]);
  const ctx = useMemo<RowRenderContext>(
    () => ({
      onOpenExternal: (url) => void session.openExternal(url),
      onOpenGenerated: (path) => void session.openGenerated(path),
      requestDetail: (rowId, part) => session.rowDetail(rowId, part),
      assetUrl: (ref) => buildImageAssetUrl(ptyId ?? '', ref.ref, ref.blockIndex),
      groupChildren: (groupId) => session.groupChildren(groupId),
      answerInfo: (rowId) => answers.get(rowId),
      onOpenPreviousSessions,
      live: session.live,
      sendOverlay: (rowId) => merged.overlays.get(rowId),
      retrySend: (sendId) => driver.retry(sendId),
      discardSend: (sendId) => driver.dismiss(sendId),
    }),
    [session, ptyId, onOpenPreviousSessions, answers, merged.overlays, driver],
  );

  // G4: while the new conversation is empty the notice stays pinned on top; once
  // there is content it becomes the first row (Timeline renders it via renderRow).
  const pinnedSwitch = allRows.length > 0 && allRows.every(isSwitchNotice) ? allRows[0]! : null;
  const rows = pinnedSwitch ? [] : allRows;

  const reception =
    effectiveEnded === null ? (
      <ReceptionBanner
        reception={session.reception}
        terminalNeeded={session.live?.terminalNeeded ?? null}
        onOpenTerminal={onOpenTerminal}
      />
    ) : null;

  return (
    <div className={styles.root} data-testid="chat-view" tabIndex={-1} onKeyDown={onKeyDown}>
      {pinnedSwitch !== null || reception !== null ? (
        <div className={styles.strips}>
          {reception}
          {pinnedSwitch !== null ? (
            <ConversationSwitchBanner
              source={pinnedSwitch.kind === 'notice' ? pinnedSwitch.params.source : undefined}
              onOpen={onOpenPreviousSessions}
            />
          ) : null}
        </div>
      ) : null}
      <Timeline rows={rows} session={session} focusMode={focusMode} active={active} ctx={ctx} foldToggleTick={foldToggleTick} />
      {effectiveEnded !== null ? (
        <SessionEndedBar exitCode={effectiveEnded.exitCode} onResume={onResume} onCloseTab={onCloseTab} />
      ) : (
        <>
          <PendingPanel
            ptyId={ptyId}
            pendings={session.live?.pendings ?? []}
            adjustingPlanId={adjustingPlanId}
            onAnswer={onAnswer}
            onAdjustStart={setAdjustingPlanId}
            onOpenExternal={ctx.onOpenExternal}
          />
          <WorkingFooter live={session.live} rows={session.rows} terminal={terminal}
            onInterruptPending={onInterruptPending}
            stopRequestedAt={stopRequestedAt}
            onStopRequestedAt={onStopRequestedAt}
            endedByScreen={endedByScreen}
          />
          {footer ?? null}
          <ChatComposer
            tabId={tabId}
            ptyId={ptyId}
            cwd={cwd}
            terminal={terminal}
            driver={driver}
            rows={allRows}
            items={items}
            working={session.live?.status === 'working' && !endedByScreen}
            active={active}
            onOpenTerminal={onOpenTerminal}
            adjust={adjustMode}
            onToggleFolds={onToggleFolds}
          />
        </>
      )}
    </div>
  );
});
