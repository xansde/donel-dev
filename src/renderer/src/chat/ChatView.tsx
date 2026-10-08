// T056/T057 (014-chat) - the chat view of one tab: strips (G4) on top, the
// conversation, and the bottom slot (the composer arrives in a later phase;
// when the session ended, the "Sessão encerrada" bar takes its place - G5).
// The header (Toggle / Chat | Terminal / Kbd) lives in App's `sessionHeader`
// (D-C22); this component draws only the area below it.

import { useMemo, type ReactNode } from 'react';
import { buildImageAssetUrl } from '../../../shared/chat/assetUrl';
import type { ConversationRow } from '../../../shared/chat/rows';
import styles from './ChatView.module.css';
import { ConversationSwitchBanner, ReceptionBanner } from './ReceptionBanner';
import type { RowRenderContext } from './renderRow';
import { SessionEndedBar } from './SessionEndedBar';
import { Timeline } from './Timeline';
import { useChatSession } from './useChatSession';

export interface ChatViewProps {
  /** PTY of the tab (kept after the process exits so the conversation stays readable); `null` before the first spawn. */
  ptyId: string | null;
  /** The tab is the active one AND its view is the chat. */
  active: boolean;
  focusMode: boolean;
  /** The process exited (FR-034). `null` = alive. */
  ended: { readonly exitCode: number | null } | null;
  onOpenTerminal: () => void;
  /** "Retomar": respawns the PTY resuming this same conversation. */
  onResume: () => void;
  onCloseTab: () => void;
  /** "abrir" on the new-conversation notice. */
  onOpenPreviousSessions: () => void;
  /** Bottom slot above which nothing else sits: the composer (later phase). */
  footer?: ReactNode;
}

const isSwitchNotice = (row: ConversationRow): boolean => row.kind === 'notice' && row.notice === 'conversation-switch';

export function ChatView({
  ptyId,
  active,
  focusMode,
  ended,
  onOpenTerminal,
  onResume,
  onCloseTab,
  onOpenPreviousSessions,
  footer,
}: ChatViewProps): React.JSX.Element {
  const session = useChatSession(ptyId);

  const ctx = useMemo<RowRenderContext>(
    () => ({
      onOpenExternal: (url) => void session.openExternal(url),
      onOpenGenerated: (path) => void session.openGenerated(path),
      requestDetail: (rowId, part) => session.rowDetail(rowId, part),
      assetUrl: (ref) => buildImageAssetUrl(ptyId ?? '', ref.ref, ref.blockIndex),
      groupChildren: (groupId) => session.groupChildren(groupId),
      onOpenPreviousSessions,
      live: session.live,
    }),
    [session, ptyId, onOpenPreviousSessions],
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
}
