import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '@donel-dev/design-system';
import { addDrawing } from '../../../shared/mindscape/drawings';
import type { CardRect } from '../../../shared/mindscape/geometry';
import { sessionHighlight } from '../../../shared/mindscape/highlight';
import {
  addLink,
  sessionCardId,
  visibleLinks,
  type MindscapeCard as Card,
  type MindscapeDoc,
  type MindscapeDrawing,
  type OwnerCardColor,
} from '../../../shared/mindscape/model';
import { mindscapeShortcut, type MindscapeTool } from '../../../shared/mindscape/shortcuts';
import { screenToWorld } from '../../../shared/mindscape/view';
import type { TabColorToken } from '../../../shared/tabAppearance';
import { isDrawTool, MindscapeBoard, type DrawGesture } from './MindscapeBoard';
import { MindscapeDrawingLayer } from './MindscapeDrawingLayer';
import { MindscapeLinkLayer, MindscapeOutlineLayer, useCardSizes } from './MindscapeLinks';
import { MindscapeNoteCard, MindscapeOwnerCard, MindscapeSessionCard, STRIPE_BY_TOKEN } from './MindscapeCard';
import { MindscapeToolbar, type DrawStyle } from './MindscapeToolbar';
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
  /**
   * Desenho, fatia 01 — the single door of the new owner actions (drawings,
   * links drawn with A/L): a pure reducer applied to the document. The V1
   * callbacks join it in fatia 02 (Ctrl+Z).
   */
  readonly onAction: (projectPath: string, reducer: (doc: MindscapeDoc) => MindscapeDoc) => void;
  readonly onToggleLinkArrow: (projectPath: string, linkId: string) => void;
  readonly onRemoveLink: (projectPath: string, linkId: string) => void;
}

/** Margin of the new owner post-it from the visible top-left corner of the board. */
const NEW_CARD_MARGIN = 40;

/** Starting style of the drawings: Sem cor, médio (memory only). */
const DEFAULT_DRAW_STYLE: DrawStyle = { color: 'none', stroke: 'medium' };

const TOOL_HINT: Readonly<Record<Exclude<MindscapeTool, 'select'>, string>> = {
  hand: 'Mão: arraste para mover a visão',
  arrow: 'Seta: arraste de um post-it a outro para ligar, ou no quadro para desenhar (Esc cancela)',
  line: 'Linha: arraste de um post-it a outro para ligar, ou no quadro para desenhar (Esc cancela)',
  rect: 'Retângulo: arraste no quadro (Esc cancela)',
  ellipse: 'Elipse: arraste no quadro (Esc cancela)',
};

/** The drawing a gesture makes with the current style (boxes are normalized by `addDrawing`). */
function drawingOf(gesture: DrawGesture, style: DrawStyle): MindscapeDrawing {
  const { id, start, end } = gesture;
  if (gesture.tool === 'arrow' || gesture.tool === 'line') {
    return { kind: 'line', id, ...style, arrow: gesture.tool === 'arrow', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }
  return { kind: gesture.tool, id, ...style, x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };
}

/** The preview: a box drawn upward or leftward is shown already normalized. */
function draftOf(gesture: DrawGesture, style: DrawStyle): MindscapeDrawing {
  const drawing = drawingOf(gesture, style);
  if (drawing.kind === 'line') return drawing;
  const { x, y, w, h } = drawing;
  return { ...drawing, x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Mindscape — one tab per project board, one post-it per live session of that
 * project, the post-its written by the sessions and the owner's own (V1), and
 * the drawing tools of the bar (desenho, fatia 01: V H A L R O, A/L from
 * post-it to post-it make a link). Covers the middle of the shell like the
 * EsteiraScreen; the terminals stay mounted underneath.
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
  onAction,
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
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const selectedLink = board?.links.find((link) => link.id === selectedLinkId);
  // Desenho, fatia 01 — the active tool and the style of the next drawing (screen state, not saved).
  const [tool, setTool] = useState<MindscapeTool>('select');
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const sectionRef = useRef<HTMLElement>(null);
  const sizes = useCardSizes(sectionRef);
  // The keys only exist with the focus inside the Mindscape: it takes the focus
  // when it opens (a one-letter key must never reach a terminal left focused underneath).
  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);

  // Cards on screen: a session card only with its tab open (rule 11); notes and the owner's always.
  const liveSessionIds = new Set(boardSessions.map((session) => session.sessionId));
  const visibleCards = board ? Object.values(board.cards).filter((card) => card.kind !== 'session' || liveSessionIds.has(card.sessionId)) : [];
  const visibleIds = new Set(visibleCards.map((card) => card.id));
  /** Measured rects in drawing order (session cards first, then the others) — the hit-test of A/L. */
  const cardRects: CardRect[] = [];
  if (board) {
    const ordered = [
      ...boardSessions.map((session) => board.cards[sessionCardId(session.sessionId)]).filter((card): card is Card => card !== undefined),
      ...Object.values(board.cards).filter((card) => card.kind !== 'session'),
    ];
    for (const card of ordered) {
      const size = sizes[card.id];
      if (size) cardRects.push({ id: card.id, x: card.x, y: card.y, w: size.w, h: size.h });
    }
  }

  const handleDraw = (gesture: DrawGesture): void => {
    if (!board) return;
    const { projectPath } = board;
    // A, L, R and O go back to V after a drawing.
    setTool('select');
    if ((gesture.tool === 'arrow' || gesture.tool === 'line') && gesture.fromCard && gesture.toCard) {
      // Both ends on post-its: a link (an already linked pair is a no-op); both on the same post-it make nothing.
      const { fromCard, toCard } = gesture;
      if (fromCard !== toCard) onAction(projectPath, (current) => addLink(current, projectPath, { id: gesture.id, from: fromCard, to: toCard, arrow: gesture.tool === 'arrow' }));
      return;
    }
    const drawing = drawingOf(gesture, drawStyle);
    onAction(projectPath, (current) => addDrawing(current, projectPath, drawing));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const shortcut = mindscapeShortcut({
      key: event.key,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
      editable: isEditable(event.target),
    });
    if (!shortcut || !board) return;
    event.preventDefault();
    // A tool change (Esc included) cancels the gesture in flight — the board ends it.
    setTool(shortcut.type === 'tool' ? shortcut.tool : 'select');
  };

  const hint = tool !== 'select' ? TOOL_HINT[tool] : selectedSession ? selectedSession.name : 'Selecione uma sessão (duplo clique abre o terminal)';

  return (
    <section
      ref={sectionRef}
      className={styles.screen}
      aria-label="Mindscape"
      data-testid="mindscape-screen"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerDown={() => {
        // Focus left outside (a terminal underneath): bring it in. Focus already inside stays where it is.
        const section = sectionRef.current;
        if (section && !section.contains(document.activeElement)) section.focus({ preventScroll: true });
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
      <MindscapeToolbar
        enabled={Boolean(board)}
        tool={tool}
        onTool={setTool}
        style={drawStyle}
        onStyle={setDrawStyle}
        selectedLink={selectedLink}
        onToggleLinkArrow={() => {
          if (board && selectedLink) onToggleLinkArrow(board.projectPath, selectedLink.id);
        }}
        onRemoveLink={() => {
          if (!board || !selectedLink) return;
          onRemoveLink(board.projectPath, selectedLink.id);
          setSelectedLinkId(undefined);
        }}
        onNewCard={() => {
          if (!board) return;
          const id = crypto.randomUUID();
          setCreatedCardId(id);
          onAddOwnerCard(board.projectPath, id, screenToWorld({ x: NEW_CARD_MARGIN, y: NEW_CARD_MARGIN }, { pan: board.pan, zoom: board.zoom }));
        }}
        canGoToTerminal={Boolean(selectedSession)}
        onGoToTerminal={() => {
          if (selectedSession) onGoToTerminal(selectedSession.tabId);
        }}
        hint={hint}
      />
      {!board ? (
        <div className={styles.view} data-testid="mindscape-board">
          <p className={styles.empty}>Abra uma sessão claude num projeto: o quadro dele aparece aqui.</p>
        </div>
      ) : (
        <MindscapeBoard
          board={board}
          tool={tool}
          cardRects={cardRects}
          onMoveCard={(cardId, x, y) => onMoveCard(board.projectPath, cardId, x, y)}
          onPan={(pan) => onPan(board.projectPath, pan)}
          onDraw={handleDraw}
          onBackgroundClick={() => {
            setSelectedTabId(undefined);
            setSelectedLinkId(undefined);
          }}
        >
          {(positionOf, draft) => {
            const rectOf = (cardId: string) => {
              const card: Card | undefined = board.cards[cardId];
              const size = sizes[cardId];
              if (!card || !size || !visibleIds.has(cardId)) return undefined;
              const position = positionOf(card);
              return { x: position.x, y: position.y, w: size.w, h: size.h };
            };
            return (
            <>
              <MindscapeDrawingLayer drawings={board.drawings} draft={draft && isDrawTool(tool) ? draftOf(draft, drawStyle) : undefined} />
              <MindscapeLinkLayer links={visibleLinks(board.links, visibleIds)} rectOf={rectOf} selectedLinkId={selectedLinkId} onSelect={setSelectedLinkId} />
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
