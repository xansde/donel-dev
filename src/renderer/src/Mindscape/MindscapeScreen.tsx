import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '@donel-dev/design-system';
import { sessionHighlight } from '../../../shared/mindscape/highlight';
import { sessionCardId, visibleLinks, type MindscapeCard as Card, type MindscapeDoc, type OwnerCardColor } from '../../../shared/mindscape/model';
import type { TabColorToken } from '../../../shared/tabAppearance';
import { MindscapeBoard } from './MindscapeBoard';
import { MindscapeLinkLayer, MindscapeOutlineLayer, useCardSizes } from './MindscapeLinks';
import { MindscapeNoteCard, MindscapeOwnerCard, MindscapeSessionCard, STRIPE_BY_TOKEN } from './MindscapeCard';
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
  /** "Arquivar" a post-it (written by the session or by the owner) — removes it from the board. */
  readonly onArchive: (projectPath: string, cardId: string) => void;
  /** Fatia 04 — end of a card drag. */
  readonly onMoveCard: (projectPath: string, cardId: string, x: number, y: number) => void;
  /** Fatia 04 — end of a background drag. */
  readonly onPan: (projectPath: string, pan: { x: number; y: number }) => void;
  /** Fatia 04 — "Novo post-it": the owner card `id`, placed from `origin` (the visible corner). */
  readonly onAddOwnerCard: (projectPath: string, id: string, origin: { x: number; y: number }) => void;
  readonly onEditOwnerCard: (projectPath: string, cardId: string, text: string) => void;
  readonly onSetOwnerColor: (projectPath: string, cardId: string, color: OwnerCardColor) => void;
  /** Fatia 05 — "Ligar": link `from` → `to` (the link `id` is made here). */
  readonly onAddLink: (projectPath: string, id: string, from: string, to: string) => void;
  readonly onToggleLinkArrow: (projectPath: string, linkId: string) => void;
  readonly onRemoveLink: (projectPath: string, linkId: string) => void;
}

/** Margin of the new owner post-it from the visible top-left corner of the board. */
const NEW_CARD_MARGIN = 40;

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Mindscape V1 — one tab per project board, one post-it per live session of
 * that project, the post-its written by the sessions and the owner's own
 * (fatia 04: free canvas — drag cards, drag the background to move the view). Covers the middle of the
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
  onMoveCard,
  onPan,
  onAddOwnerCard,
  onEditOwnerCard,
  onSetOwnerColor,
  onAddLink,
  onToggleLinkArrow,
  onRemoveLink,
}: MindscapeScreenProps): React.JSX.Element {
  const boardPaths = Object.keys(doc.boards);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(initialProjectPath);
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  /** The owner card created in this visit — it opens in edit mode. */
  const [createdCardId, setCreatedCardId] = useState<string | undefined>(undefined);
  const activePath =
    selectedPath && doc.boards[selectedPath]
      ? selectedPath
      : initialProjectPath && doc.boards[initialProjectPath]
        ? initialProjectPath
        : boardPaths[0];
  const board = activePath ? doc.boards[activePath] : undefined;
  const boardSessions = board ? sessions.filter((session) => session.projectPath === board.projectPath) : [];
  const selectedSession = boardSessions.find((session) => session.tabId === selectedTabId);
  // Fatia 05 — links: "Ligar" mode (origin, then destination) and the selected link.
  const [linking, setLinking] = useState(false);
  const [linkOrigin, setLinkOrigin] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const selectedLink = board?.links.find((link) => link.id === selectedLinkId);
  const sectionRef = useRef<HTMLElement>(null);
  const sizes = useCardSizes(sectionRef);
  const stopLinking = (): void => {
    setLinking(false);
    setLinkOrigin(undefined);
  };
  useEffect(() => {
    if (!linking) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setLinking(false);
        setLinkOrigin(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linking]);
  /** In "Ligar" mode a click on a card picks it (origin, then destination) instead of its own action. */
  const pickForLink = (event: React.MouseEvent): void => {
    if (!linking || !board) return;
    const cardId = (event.target as HTMLElement).closest<HTMLElement>('[data-card-id]')?.dataset.cardId;
    if (!cardId || !board.cards[cardId]) return;
    event.stopPropagation();
    event.preventDefault();
    if (!linkOrigin) {
      setLinkOrigin(cardId);
      return;
    }
    if (cardId === linkOrigin) return;
    onAddLink(board.projectPath, crypto.randomUUID(), linkOrigin, cardId);
    stopLinking();
  };
  const linkHint = linking ? (linkOrigin ? 'Clique no post-it de destino (Esc cancela)' : 'Clique no post-it de origem (Esc cancela)') : undefined;

  return (
    <section
      ref={sectionRef}
      className={styles.screen}
      aria-label="Mindscape"
      data-testid="mindscape-screen"
      data-linking={linking ? (linkOrigin ? 'destination' : 'origin') : undefined}
      onClickCapture={pickForLink}
      onDoubleClickCapture={(event) => {
        if (linking) event.stopPropagation();
      }}
    >
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
          disabled={!board}
          onClick={() => {
            if (!board) return;
            const id = crypto.randomUUID();
            setCreatedCardId(id);
            onAddOwnerCard(board.projectPath, id, { x: NEW_CARD_MARGIN - board.pan.x, y: NEW_CARD_MARGIN - board.pan.y });
          }}
        >
          Novo post-it
        </button>
        <button
          type="button"
          className={styles.toolButton}
          disabled={!board}
          aria-pressed={linking}
          onClick={() => {
            if (linking) stopLinking();
            else {
              setLinking(true);
              setSelectedLinkId(undefined);
            }
          }}
        >
          Ligar
        </button>
        {selectedLink && board ? (
          <>
            <button type="button" className={styles.toolButton} aria-pressed={selectedLink.arrow} onClick={() => onToggleLinkArrow(board.projectPath, selectedLink.id)}>
              Seta
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => {
                onRemoveLink(board.projectPath, selectedLink.id);
                setSelectedLinkId(undefined);
              }}
            >
              Remover ligação
            </button>
          </>
        ) : null}
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
        <span className={styles.toolHint}>{linkHint ?? (selectedSession ? selectedSession.name : 'Selecione uma sessão (duplo clique abre o terminal)')}</span>
      </div>
      {!board ? (
        <div className={styles.view} data-testid="mindscape-board">
          <p className={styles.empty}>Abra uma sessão claude num projeto: o quadro dele aparece aqui.</p>
        </div>
      ) : (
        <MindscapeBoard
          board={board}
          onMoveCard={(cardId, x, y) => onMoveCard(board.projectPath, cardId, x, y)}
          onPan={(pan) => onPan(board.projectPath, pan)}
          onBackgroundClick={() => {
            setSelectedTabId(undefined);
            setSelectedLinkId(undefined);
          }}
        >
          {(positionOf) => {
            // Cards on screen: a session card only with its tab open (rule 11); notes and the owner's always.
            const liveSessionIds = new Set(boardSessions.map((session) => session.sessionId));
            const visibleCards = Object.values(board.cards).filter((card) => card.kind !== 'session' || liveSessionIds.has(card.sessionId));
            const visibleIds = new Set(visibleCards.map((card) => card.id));
            const rectOf = (cardId: string) => {
              const card: Card | undefined = board.cards[cardId];
              const size = sizes[cardId];
              if (!card || !size || !visibleIds.has(cardId)) return undefined;
              const position = positionOf(card);
              return { x: position.x, y: position.y, w: size.w, h: size.h };
            };
            return (
            <>
              <MindscapeLinkLayer
                links={visibleLinks(board.links, visibleIds)}
                rectOf={rectOf}
                selectedLinkId={selectedLinkId}
                onSelect={(linkId) => {
                  if (!linking) setSelectedLinkId(linkId);
                }}
              />
              {boardSessions.map((session) => {
                const card = board.cards[sessionCardId(session.sessionId)];
                if (!card) return null;
                const position = positionOf(card);
                return (
                  <MindscapeSessionCard
                    key={session.tabId}
                    sessionId={session.sessionId}
                    name={session.name}
                    state={session.state}
                    color={session.color}
                    cliColorHex={session.cliColorHex}
                    x={position.x}
                    y={position.y}
                    highlight={sessionHighlight(session.state, session.stateEnteredAt, seenAt[session.sessionId])}
                    selected={session.tabId === selectedTabId}
                    onSelect={() => setSelectedTabId(session.tabId)}
                    onOpen={() => onGoToTerminal(session.tabId)}
                  />
                );
              })}
              {Object.values(board.cards).map((card) => {
                const position = positionOf(card);
                if (card.kind === 'owner') {
                  return (
                    <MindscapeOwnerCard
                      key={card.id}
                      id={card.id}
                      text={card.text}
                      color={card.color}
                      createdAt={card.createdAt}
                      x={position.x}
                      y={position.y}
                      startEditing={card.id === createdCardId}
                      onEdit={(text) => onEditOwnerCard(board.projectPath, card.id, text)}
                      onColor={(color) => onSetOwnerColor(board.projectPath, card.id, color)}
                      onArchive={() => onArchive(board.projectPath, card.id)}
                    />
                  );
                }
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
                    x={position.x}
                    y={position.y}
                    onArchive={() => onArchive(board.projectPath, card.id)}
                  />
                );
              })}
              {boardSessions.length === 0 && !Object.values(board.cards).some((card) => card.kind !== 'session') ? (
                <p className={styles.empty}>Nenhuma sessão aberta neste projeto.</p>
              ) : null}
              <MindscapeOutlineLayer cardIds={visibleCards.map((card) => card.id)} rectOf={rectOf} />
            </>
            );
          }}
        </MindscapeBoard>
      )}
    </section>
  );
}
