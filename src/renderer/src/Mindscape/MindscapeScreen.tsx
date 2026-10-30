import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '@donel-dev/design-system';
import { addDrawing, bringToFront, moveItems, removeItems, sendToBack, setDrawingsStyle, updateDrawing } from '../../../shared/mindscape/drawings';
import { eraseDoc } from '../../../shared/mindscape/eraser';
import type { CardRect, ItemIds } from '../../../shared/mindscape/geometry';
import { sessionHighlight } from '../../../shared/mindscape/highlight';
import { fitImage, imageBoxAt, isPrintInputType, MAX_PRINT_BYTES } from '../../../shared/mindscape/images';
import {
  addLink,
  addOwnerCard,
  archiveCard,
  editOwnerCard,
  removeLink,
  sessionCardId,
  setOwnerColor,
  toggleLinkArrow,
  visibleLinks,
  type MindscapeCard as Card,
  type InkDrawing,
  type MindscapeDoc,
  type MindscapeDrawing,
} from '../../../shared/mindscape/model';
import { mindscapeShortcut, type MindscapeTool } from '../../../shared/mindscape/shortcuts';
import { screenToWorld, type BoardView, type Point } from '../../../shared/mindscape/view';
import type { TabColorToken } from '../../../shared/tabAppearance';
import { EMPTY_ITEMS, ERASER_RADIUS_PX, isDrawTool, MindscapeBoard, sizesOf, type DrawGesture } from './MindscapeBoard';
import { MindscapeDrawingLayer } from './MindscapeDrawingLayer';
import { MindscapeLinkLayer, MindscapeOutlineLayer, useCardSizes } from './MindscapeLinks';
import { MindscapeNoteCard, MindscapeOwnerCard, MindscapeSessionCard, STRIPE_BY_TOKEN } from './MindscapeCard';
import { MindscapeSelectionLayer } from './MindscapeSelectionLayer';
import { MindscapeToolbar, type DrawStyle } from './MindscapeToolbar';
import { preparePrint, useMindscapeImages } from './useMindscapeImage';
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
  /**
   * Fatia 04 — end of a hand drag; desenho, fatia 05 — also the wheel, the
   * pinch and the zoom indicator. Out of the history (moving the view is not an
   * action); `change` gets the view of the board as it is when applied.
   */
  readonly onView: (projectPath: string, change: (view: BoardView) => BoardView) => void;
  /**
   * Desenho, fatias 01–02 — the single door of every owner action on the board
   * (drawings, links, the owner's post-its, "Arquivar", drags of the selection):
   * a pure reducer applied to the document, one entry of the board history each.
   */
  readonly onAction: (projectPath: string, reducer: (doc: MindscapeDoc) => MindscapeDoc) => void;
  /** Desenho, fatia 02 — Ctrl+Z on the board of `projectPath`. */
  readonly onUndo: (projectPath: string) => void;
  /** Desenho, fatia 02 — Ctrl+Shift+Z on the board of `projectPath`. */
  readonly onRedo: (projectPath: string) => void;
}

/** Margin of the new owner post-it from the visible top-left corner of the board. */
const NEW_CARD_MARGIN = 40;

/** Starting style of the drawings: Sem cor, médio (memory only). */
const DEFAULT_DRAW_STYLE: DrawStyle = { color: 'none', stroke: 'medium' };

const SELECT_HINT = 'Clique seleciona, Shift soma, arraste o fundo para o laço (duplo clique na sessão abre o terminal)';

const TOOL_HINT: Readonly<Record<Exclude<MindscapeTool, 'select'>, string>> = {
  hand: 'Mão: arraste para mover a visão',
  arrow: 'Seta: arraste de um post-it a outro para ligar, ou no quadro para desenhar (Esc cancela)',
  line: 'Linha: arraste de um post-it a outro para ligar, ou no quadro para desenhar (Esc cancela)',
  rect: 'Retângulo: arraste no quadro (Esc cancela)',
  ellipse: 'Elipse: arraste no quadro (Esc cancela)',
  pencil: 'Lápis: arraste para rabiscar; segue ativo depois do traço (Esc volta para a seleção)',
  eraser: 'Borracha: passe sobre o desenho para apagar o pedaço tocado; post-it nunca sai (Esc volta para a seleção)',
};

/** Desenho, fatia 06 — the warnings of the print, in the hint strip of the bar. */
const PRINT_TOO_BIG = 'Imagem grande demais (limite de 10 MB)';
const PRINT_FAILED = 'Não foi possível colar a imagem';
/** How long a warning of the print stays in the hint strip (ms). */
const NOTICE_MS = 6000;

/** The drawing a gesture makes with the current style (boxes are normalized by `addDrawing`). */
function drawingOf(gesture: DrawGesture, style: DrawStyle): InkDrawing {
  const { id, start, end } = gesture;
  if (gesture.tool === 'pencil') return { kind: 'pencil', id, ...style, points: gesture.points ?? [start.x, start.y] };
  if (gesture.tool === 'arrow' || gesture.tool === 'line') {
    return { kind: 'line', id, ...style, arrow: gesture.tool === 'arrow', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }
  return { kind: gesture.tool, id, ...style, x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };
}

/** The preview: a box drawn upward or leftward is shown already normalized. */
function draftOf(gesture: DrawGesture, style: DrawStyle): InkDrawing {
  const drawing = drawingOf(gesture, style);
  if (drawing.kind === 'line' || drawing.kind === 'pencil') return drawing;
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

/** The selection, tied to the board it was made on (another board starts empty). */
interface Selection extends ItemIds {
  readonly path?: string;
}

/**
 * Mindscape — one tab per project board, one post-it per live session of that
 * project, the post-its written by the sessions and the owner's own (V1), and
 * the drawing tools of the bar (desenho: V H A L R O, A/L from post-it to
 * post-it make a link; fatia 03: selection of several items, handles, style
 * and layer; fatia 04: P pencil and E eraser; fatia 05: zoom by board; fatia
 * 06: prints pasted or dropped). Covers the middle of the shell like the EsteiraScreen; the
 * terminals stay mounted underneath.
 */
export function MindscapeScreen({
  doc,
  sessions,
  projectNames,
  initialProjectPath,
  seenAt,
  onGoToTerminal,
  onView,
  onAction,
  onUndo,
  onRedo,
}: MindscapeScreenProps): React.JSX.Element {
  const boardPaths = Object.keys(doc.boards);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(initialProjectPath);
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
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const selectedLink = board?.links.find((link) => link.id === selectedLinkId);
  // Desenho, fatia 01 — the active tool and the style of the next drawing (screen state, not saved).
  const [tool, setTool] = useState<MindscapeTool>('select');
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  // Desenho, fatia 03 — the selection (cards and drawings) and space held (moves the view).
  const [selection, setSelection] = useState<Selection>(EMPTY_ITEMS);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [cancelSignal, setCancelSignal] = useState(0);
  /** A gesture is in flight on the board (pointer down): Ctrl+Z and the keys that change the board wait for it to end. */
  const gestureActiveRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const sizes = useCardSizes(sectionRef);
  // The keys only exist with the focus inside the Mindscape: it takes the focus
  // when it opens (a one-letter key must never reach a terminal left focused underneath).
  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);
  // Desenho, fatia 05 — Ctrl+wheel (and the pinch) never zooms the page while
  // the Mindscape is open, not even over the bar or the tabs: React's wheel
  // listener is passive, so this one is native. The board zooms itself.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;
    const guard = (event: WheelEvent): void => {
      if (event.ctrlKey) event.preventDefault();
    };
    section.addEventListener('wheel', guard, { passive: false });
    return () => section.removeEventListener('wheel', guard);
  }, []);
  // Desenho, fatia 06 — the files of the prints of this board (blob: URLs, revoked when the Mindscape unmounts).
  const images = useMindscapeImages(board ? board.drawings.flatMap((drawing) => (drawing.kind === 'image' ? [drawing.imageId] : [])) : []);
  // A warning of the print in the hint strip, for a few seconds.
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);
  const showNotice = (text: string): void => {
    setNotice(text);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(undefined), NOTICE_MS);
  };
  // Space is let go when the window loses the focus (the keyup never comes).
  useEffect(() => {
    const release = (): void => setSpaceHeld(false);
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, []);

  // Cards on screen: a session card only with its tab open (rule 11); notes and the owner's always.
  const liveSessionIds = new Set(boardSessions.map((session) => session.sessionId));
  const visibleCards = board ? Object.values(board.cards).filter((card) => card.kind !== 'session' || liveSessionIds.has(card.sessionId)) : [];
  const visibleIds = new Set(visibleCards.map((card) => card.id));
  /** Measured rects in drawing order (session cards first, then the others) — the hit-test of A/L and the lasso. */
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

  // What is selected and still exists on screen (an undo, an archive or a closed tab drop the rest).
  const drawingIds = new Set(board?.drawings.map((drawing) => drawing.id));
  const live: ItemIds =
    board && selection.path === board.projectPath
      ? { cards: selection.cards.filter((id) => visibleIds.has(id)), drawings: selection.drawings.filter((id) => drawingIds.has(id)) }
      : EMPTY_ITEMS;
  const hasSelection = live.cards.length > 0 || live.drawings.length > 0;
  const select = (next: ItemIds): void => {
    if (!board) return;
    setSelection({ path: board.projectPath, cards: next.cards, drawings: next.drawings });
    if (next.cards.length > 0 || next.drawings.length > 0) setSelectedLinkId(undefined);
  };
  const clearSelection = (): void => setSelection(EMPTY_ITEMS);
  // "Ir ao terminal" and the hint: exactly one session post-it selected, nothing else.
  const onlyCard = live.cards.length === 1 && live.drawings.length === 0 ? board?.cards[live.cards[0]!] : undefined;
  const selectedSession = onlyCard?.kind === 'session' ? boardSessions.find((session) => session.sessionId === onlyCard.sessionId) : undefined;

  const changeTool = (next: MindscapeTool): void => {
    // A drawing tool (and the eraser) starts with nothing selected: the color of the bar must not repaint what was selected.
    if (isDrawTool(next) || next === 'eraser') clearSelection();
    setTool(next);
  };

  const handleDraw = (gesture: DrawGesture): void => {
    if (!board) return;
    const { projectPath } = board;
    if (gesture.tool === 'pencil') {
      // P stays on after a stroke (A, L, R and O go back to V).
      const drawing = drawingOf(gesture, drawStyle);
      onAction(projectPath, (current) => addDrawing(current, projectPath, drawing));
      return;
    }
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

  /**
   * Fatia 04 — end of an eraser pass: `eraseDoc` runs again with the whole
   * path over the board as it is NOW (a post-it written by the session during
   * the pass is not run over), one history entry. E stays on.
   */
  const handleErase = (path: number[]): void => {
    if (!board) return;
    const { projectPath } = board;
    const radius = ERASER_RADIUS_PX / board.zoom;
    const cardSizes = sizesOf(cardRects);
    onAction(projectPath, (current) => eraseDoc(current, projectPath, path, radius, () => crypto.randomUUID(), cardSizes));
  };

  /**
   * Fatia 06 — a pasted or dropped image becomes a print centered on `at`
   * (board units), at most 480 wide with the proportion kept: decoded here (a
   * GIF becomes PNG), stored by the main (which names the file and checks it
   * all again), then added as one history entry. More than 10 MB → the warning.
   */
  const handleImageFile = async (file: File, at: Point): Promise<void> => {
    if (!board || !isPrintInputType(file.type)) return;
    const { projectPath } = board;
    if (file.size > MAX_PRINT_BYTES) {
      showNotice(PRINT_TOO_BIG);
      return;
    }
    const prepared = await preparePrint(file);
    if (!prepared) {
      showNotice(PRINT_FAILED);
      return;
    }
    if (prepared.bytes.byteLength > MAX_PRINT_BYTES) {
      showNotice(PRINT_TOO_BIG);
      return;
    }
    const size = fitImage(prepared.width, prepared.height);
    if (!size) {
      showNotice(PRINT_FAILED);
      return;
    }
    const saved = await window.donel.mindscape.saveImage(prepared.bytes, prepared.mediaType).catch(() => null);
    if (!saved || !saved.ok) {
      showNotice(saved?.reason === 'too-big' ? PRINT_TOO_BIG : PRINT_FAILED);
      return;
    }
    const drawing: MindscapeDrawing = { kind: 'image', id: crypto.randomUUID(), imageId: saved.imageId, ...imageBoxAt(at, size) };
    onAction(projectPath, (current) => addDrawing(current, projectPath, drawing));
  };

  const removeSelected = (): void => {
    if (!board) return;
    const { projectPath } = board;
    if (selectedLink) {
      const linkId = selectedLink.id;
      onAction(projectPath, (current) => removeLink(current, projectPath, linkId));
      setSelectedLinkId(undefined);
      return;
    }
    if (!hasSelection) return;
    const ids = live;
    onAction(projectPath, (current) => removeItems(current, projectPath, ids));
    clearSelection();
  };

  const restack = (toFront: boolean): void => {
    if (!board || live.drawings.length === 0) return;
    const { projectPath } = board;
    const ids = live.drawings;
    onAction(projectPath, (current) => (toFront ? bringToFront(current, projectPath, ids) : sendToBack(current, projectPath, ids)));
  };

  const applyStyle = (change: { readonly color?: DrawStyle['color']; readonly stroke?: DrawStyle['stroke'] }): void => {
    setDrawStyle((current) => ({ ...current, ...change }));
    if (!board || live.drawings.length === 0) return;
    const { projectPath } = board;
    const ids = live.drawings;
    onAction(projectPath, (current) => setDrawingsStyle(current, projectPath, ids, change));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const editable = isEditable(event.target);
    // Space held moves the view with any tool (the keyup lets it go).
    if (event.key === ' ' && !editable && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) setSpaceHeld(true);
      return;
    }
    const shortcut = mindscapeShortcut({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, editable });
    if (!shortcut || !board) return;
    event.preventDefault();
    switch (shortcut.type) {
      case 'undo':
      case 'redo':
        // Ignored while a gesture is in flight (the drag is written on pointerup, as one entry).
        if (gestureActiveRef.current) return;
        if (shortcut.type === 'undo') onUndo(board.projectPath);
        else onRedo(board.projectPath);
        return;
      case 'delete':
        if (!gestureActiveRef.current) removeSelected();
        return;
      case 'select-all':
        if (gestureActiveRef.current) return;
        setTool('select');
        select({ cards: visibleCards.map((card) => card.id), drawings: board.drawings.map((drawing) => drawing.id) });
        return;
      case 'bring-to-front':
      case 'send-to-back':
        if (!gestureActiveRef.current) restack(shortcut.type === 'bring-to-front');
        return;
      case 'escape':
        // Cancels the gesture in flight (also with V, where the tool does not change) and drops the selection.
        setCancelSignal((signal) => signal + 1);
        clearSelection();
        setTool('select');
        return;
      case 'tool':
        changeTool(shortcut.tool);
        return;
    }
  };

  const hint = notice ?? (tool !== 'select' ? TOOL_HINT[tool] : selectedSession ? selectedSession.name : SELECT_HINT);
  const selectedDrawings = board ? board.drawings.filter((drawing) => live.drawings.includes(drawing.id)) : [];

  return (
    <section
      ref={sectionRef}
      className={styles.screen}
      aria-label="Mindscape"
      data-testid="mindscape-screen"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (event.key !== ' ') return;
        if (!isEditable(event.target)) event.preventDefault();
        setSpaceHeld(false);
      }}
      onBlur={(event) => {
        // Focus leaving the Mindscape lets space go (focus moving inside it does not).
        if (!sectionRef.current?.contains(event.relatedTarget as Node | null)) setSpaceHeld(false);
      }}
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
        onTool={changeTool}
        style={drawStyle}
        onColor={(color) => applyStyle({ color })}
        onStroke={(stroke) => applyStyle({ stroke })}
        canRestack={live.drawings.length > 0}
        onBringToFront={() => restack(true)}
        onSendToBack={() => restack(false)}
        selectedLink={selectedLink}
        onToggleLinkArrow={() => {
          if (!board || !selectedLink) return;
          const { projectPath } = board;
          const linkId = selectedLink.id;
          onAction(projectPath, (current) => toggleLinkArrow(current, projectPath, linkId));
        }}
        onRemoveLink={removeSelected}
        onNewCard={() => {
          if (!board) return;
          const { projectPath } = board;
          const id = crypto.randomUUID();
          const origin = screenToWorld({ x: NEW_CARD_MARGIN, y: NEW_CARD_MARGIN }, { pan: board.pan, zoom: board.zoom });
          const createdAt = Date.now();
          setCreatedCardId(id);
          onAction(projectPath, (current) => addOwnerCard(current, projectPath, { id, createdAt, origin }));
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
          panMode={spaceHeld}
          cancelSignal={cancelSignal}
          cardRects={cardRects}
          selection={live}
          onSelect={select}
          onMoveItems={(ids, dx, dy) => {
            const { projectPath } = board;
            onAction(projectPath, (current) => moveItems(current, projectPath, ids, dx, dy));
          }}
          onResize={(drawing) => {
            const { projectPath } = board;
            onAction(projectPath, (current) => updateDrawing(current, projectPath, drawing));
          }}
          onViewChange={(change) => onView(board.projectPath, change)}
          onDraw={handleDraw}
          onErase={handleErase}
          onGestureChange={(active) => {
            gestureActiveRef.current = active;
          }}
          onBackgroundClick={() => {
            clearSelection();
            setSelectedLinkId(undefined);
          }}
          onImageFile={(file, at) => void handleImageFile(file, at)}
        >
          {({ positionOf, drawings, draft, lasso, links }) => {
            const rectOf = (cardId: string) => {
              const card: Card | undefined = board.cards[cardId];
              const size = sizes[cardId];
              if (!card || !size || !visibleIds.has(cardId)) return undefined;
              const position = positionOf(card);
              return { x: position.x, y: position.y, w: size.w, h: size.h };
            };
            // Outline of the selected owner post-its and notes (the session post-it outlines itself).
            const outlinedCards = live.cards.flatMap((id) => {
              const rect = board.cards[id]?.kind === 'session' ? undefined : rectOf(id);
              return rect ? [{ id, ...rect }] : [];
            });
            const shownSelected = drawings.filter((drawing) => live.drawings.includes(drawing.id));
            return (
            <>
              <MindscapeDrawingLayer drawings={drawings} selectedIds={live.drawings} images={images} draft={draft && isDrawTool(tool) ? draftOf(draft, drawStyle) : undefined} />
              <MindscapeLinkLayer
                links={visibleLinks(links, visibleIds)}
                rectOf={rectOf}
                selectedLinkId={selectedLinkId}
                onSelect={(linkId) => {
                  // A link is selected alone (it never enters the lasso nor Ctrl+A).
                  clearSelection();
                  setSelectedLinkId(linkId);
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
                    selected={live.cards.includes(card.id)}
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
                      onEdit={(text) => {
                        // Only the first mount opens in edit: a redo that brings the card back must not.
                        if (card.id === createdCardId) setCreatedCardId(undefined);
                        onAction(board.projectPath, (current) => editOwnerCard(current, board.projectPath, card.id, text));
                      }}
                      onColor={(color) => onAction(board.projectPath, (current) => setOwnerColor(current, board.projectPath, card.id, color))}
                      onArchive={() => onAction(board.projectPath, (current) => archiveCard(current, board.projectPath, card.id))}
                    />
                  );
                }
                if (card.kind !== 'session-note') return null;
                const liveSession = boardSessions.find((session) => session.sessionId === card.sessionId);
                return (
                  <MindscapeNoteCard
                    key={card.id}
                    sessionId={card.sessionId}
                    sessionName={liveSession?.name ?? card.sessionName}
                    text={card.text}
                    writtenAt={card.writtenAt}
                    stripe={liveSession ? (liveSession.cliColorHex ?? STRIPE_BY_TOKEN[liveSession.color]) : undefined}
                    x={position.x}
                    y={position.y}
                    onArchive={() => onAction(board.projectPath, (current) => archiveCard(current, board.projectPath, card.id))}
                  />
                );
              })}
              {boardSessions.length === 0 && !Object.values(board.cards).some((card) => card.kind !== 'session') ? (
                <p className={styles.empty}>Nenhuma sessão aberta neste projeto.</p>
              ) : null}
              <MindscapeOutlineLayer cardIds={visibleCards.map((card) => card.id)} rectOf={rectOf} />
              <MindscapeSelectionLayer
                cards={outlinedCards}
                drawings={shownSelected}
                withHandles={tool === 'select' && live.cards.length === 0 && selectedDrawings.length === 1}
                lasso={lasso}
                zoom={board.zoom}
              />
            </>
            );
          }}
        </MindscapeBoard>
      )}
    </section>
  );
}
