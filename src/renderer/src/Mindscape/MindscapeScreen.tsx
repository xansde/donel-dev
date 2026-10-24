import { useState } from 'react';
import type { SessionState } from '@donel-dev/design-system';
import { sessionHighlight } from '../../../shared/mindscape/highlight';
import { sessionCardId, type MindscapeDoc } from '../../../shared/mindscape/model';
import type { TabColorToken } from '../../../shared/tabAppearance';
import { MindscapeNoteCard, MindscapeSessionCard, STRIPE_BY_TOKEN } from './MindscapeCard';
import styles from './Mindscape.module.css';

/** A `claude` tab that is open in a project — what feeds the session post-its. */
export interface MindscapeLiveSession {
  readonly tabId: string;
  readonly sessionId: string;
  readonly name: string;
  readonly projectPath: string;
  readonly color: TabColorToken;
  readonly cliColorHex?: string | null;
  readonly state: SessionState;
  /** When the session entered `state` (semaphore clock, epoch ms; 0 before the first hook). */
  readonly stateEnteredAt: number;
}

export interface MindscapeScreenProps {
  readonly doc: MindscapeDoc;
  readonly sessions: readonly MindscapeLiveSession[];
  /** Display name per project path (from the project list); falls back to the folder name. */
  readonly projectNames: Readonly<Record<string, string>>;
  /** Board opened first: the project of the tab in focus, when it has one. */
  readonly initialProjectPath?: string;
  /** Last visit of the owner to each session (`claudeSessionId` → epoch ms), in memory only. */
  readonly seenAt: Readonly<Record<string, number>>;
  /** "Ir ao terminal" — Uso geral with the tab of the session in focus. */
  readonly onGoToTerminal: (tabId: string) => void;
  /** "Arquivar" a post-it (fatia 03: the one written by the session) — removes it from the board. */
  readonly onArchive: (projectPath: string, cardId: string) => void;
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Mindscape V1 (fatia 01) — one tab per project board, one post-it per live
 * session of that project, in the automatic grid. Covers the middle of the
 * shell like the EsteiraScreen; the terminals stay mounted underneath.
 */
export function MindscapeScreen({
  doc,
  sessions,
  projectNames,
  initialProjectPath,
  seenAt,
  onGoToTerminal,
  onArchive,
}: MindscapeScreenProps): React.JSX.Element {
  const boardPaths = Object.keys(doc.boards);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(initialProjectPath);
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  const activePath =
    selectedPath && doc.boards[selectedPath]
      ? selectedPath
      : initialProjectPath && doc.boards[initialProjectPath]
        ? initialProjectPath
        : boardPaths[0];
  const board = activePath ? doc.boards[activePath] : undefined;
  const boardSessions = board ? sessions.filter((session) => session.projectPath === board.projectPath) : [];
  const selectedSession = boardSessions.find((session) => session.tabId === selectedTabId);

  return (
    <section className={styles.screen} aria-label="Mindscape" data-testid="mindscape-screen">
      <div className={styles.tabs} role="tablist" aria-label="Mindscapes">
        {boardPaths.map((path) => (
          <button
            key={path}
            type="button"
            role="tab"
            aria-selected={path === activePath}
            className={path === activePath ? `${styles.tab} ${styles.tabOn}` : styles.tab}
            onClick={() => setSelectedPath(path)}
            title={path}
            data-testid="mindscape-tab"
          >
            <span className={styles.tabKind}>Projeto</span>
            <span>{projectNames[path] ?? folderName(path)}</span>
          </button>
        ))}
      </div>
      <div className={styles.tools} role="toolbar" aria-label="Quadro">
        <button
          type="button"
          className={styles.toolButton}
          disabled={!selectedSession}
          onClick={() => {
            if (selectedSession) onGoToTerminal(selectedSession.tabId);
          }}
        >
          Ir ao terminal
        </button>
        <span className={styles.toolHint}>{selectedSession ? selectedSession.name : 'Selecione uma sessão (duplo clique abre o terminal)'}</span>
      </div>
      <div
        className={styles.view}
        data-testid="mindscape-board"
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelectedTabId(undefined);
        }}
      >
        {!board ? (
          <p className={styles.empty}>Abra uma sessão claude num projeto: o quadro dele aparece aqui.</p>
        ) : (
          <>
            <div className={styles.world} style={{ transform: `translate(${board.pan.x}px, ${board.pan.y}px)` }}>
              {boardSessions.map((session) => {
                const card = board.cards[sessionCardId(session.sessionId)];
                if (!card) return null;
                return (
                  <MindscapeSessionCard
                    key={session.tabId}
                    sessionId={session.sessionId}
                    name={session.name}
                    state={session.state}
                    color={session.color}
                    cliColorHex={session.cliColorHex}
                    x={card.x}
                    y={card.y}
                    highlight={sessionHighlight(session.state, session.stateEnteredAt, seenAt[session.sessionId])}
                    selected={session.tabId === selectedTabId}
                    onSelect={() => setSelectedTabId(session.tabId)}
                    onOpen={() => onGoToTerminal(session.tabId)}
                  />
                );
              })}
              {Object.values(board.cards).map((card) => {
                if (card.kind !== 'session-note') return null;
                const live = boardSessions.find((session) => session.sessionId === card.sessionId);
                return (
                  <MindscapeNoteCard
                    key={card.id}
                    sessionId={card.sessionId}
                    sessionName={live?.name ?? card.sessionName}
                    text={card.text}
                    writtenAt={card.writtenAt}
                    stripe={live ? (live.cliColorHex ?? STRIPE_BY_TOKEN[live.color]) : undefined}
                    x={card.x}
                    y={card.y}
                    onArchive={() => onArchive(board.projectPath, card.id)}
                  />
                );
              })}
            </div>
            {boardSessions.length === 0 && !Object.values(board.cards).some((card) => card.kind === 'session-note') ? <p className={styles.empty}>Nenhuma sessão aberta neste projeto.</p> : null}
          </>
        )}
      </div>
    </section>
  );
}
