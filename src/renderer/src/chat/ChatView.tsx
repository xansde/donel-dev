// T056/T057 (014-chat) - the chat view of one tab: strips (G4) on top, the
// conversation, and the bottom slot (the composer arrives in a later phase;
// when the session ended, the "Sessão encerrada" bar takes its place - G5).
// The header (Toggle / Chat | Terminal / Kbd) lives in App's `sessionHeader`
// (D-C22); this component draws only the area below it.

import { memo, useCallback, useMemo, type ReactNode } from 'react';
import { buildImageAssetUrl } from '../../../shared/chat/assetUrl';
import type { ConversationRow } from '../../../shared/chat/rows';
import styles from './ChatView.module.css';
import { ConversationSwitchBanner, ReceptionBanner } from './ReceptionBanner';
import { joinAnswerMarkdown } from './markdown';
import type { AnswerInfo, RowRenderContext } from './renderRow';
import { SessionEndedBar } from './SessionEndedBar';
import { Timeline } from './Timeline';
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
  /** Bottom slot above which nothing else sits: the composer (later phase). */
  footer?: ReactNode;
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
}: ChatViewProps): React.JSX.Element {
  const session = useChatSession(ptyId);
  const onOpenTerminal = useCallback(() => actions.openTerminal(tabId), [actions, tabId]);
  const onResume = useCallback(() => actions.resume(tabId), [actions, tabId]);
  const onCloseTab = useCallback(() => actions.closeTab(tabId), [actions, tabId]);
  const onOpenPreviousSessions = useCallback(() => actions.openPreviousSessions(tabId), [actions, tabId]);

  const answers = useMemo(() => buildAnswerInfo(session.rows), [session.rows]);
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
    }),
    [session, ptyId, onOpenPreviousSessions, answers],
  );

  // G4: while the new conversation is empty the notice stays pinned on top; once
  // there is content it becomes the first row (Timeline renders it via renderRow).
  const pinnedSwitch = session.rows.length > 0 && session.rows.every(isSwitchNotice) ? session.rows[0]! : null;
  const rows = pinnedSwitch ? [] : session.rows;

  const effectiveEnded = ended ?? (session.live?.status === 'ended' ? { exitCode: null } : null);
  const reception =
    effectiveEnded === null ? (
      <ReceptionBanner
        reception={session.reception}
        terminalNeeded={session.live?.terminalNeeded ?? null}
        onOpenTerminal={onOpenTerminal}
      />
    ) : null;

  return (
    <div className={styles.root} data-testid="chat-view">
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
      <Timeline rows={rows} session={session} focusMode={focusMode} active={active} ctx={ctx} />
      {effectiveEnded !== null ? (
        <SessionEndedBar exitCode={effectiveEnded.exitCode} onResume={onResume} onCloseTab={onCloseTab} />
      ) : (
        footer ?? null
      )}
    </div>
  );
});
