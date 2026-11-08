import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionState } from '@donel-dev/design-system';
import { addDrawing, bringToFront, moveItems, removeItems, sendToBack, setDrawingsStyle, updateDrawing } from '../../../shared/mindscape/drawings';
import { eraseDoc } from '../../../shared/mindscape/eraser';
import type { CardRect, ItemIds } from '../../../shared/mindscape/geometry';
import { sessionHighlight } from '../../../shared/mindscape/highlight';
import { boardContentOrigin, deriveChairs, guardBoardAction, layoutChairs, lensLocksBoard, NO_ROLE_CHAIR, shortcutInLens, type Chair, type ChairHealth } from '../../../shared/mindscape/chairs';
import { isClosed, viewState } from '../../../shared/ledger/contract';
import { classifyBoardSessions, closedLabel, dormantSessionName, type DormantSession } from '../../../shared/mindscape/dormant';
import { organizeBoard, organizeColumnOf, type OrganizeEntry } from '../../../shared/mindscape/organize';
import { deriveSessionAxes, type SessionAxes } from '../../../shared/mindscape/sessionAxes';
import type { RendererGesture } from '../../../shared/learning/gestures';
import type { SessionRegistry } from '../../../shared/sessionRegistry';
import { fitImage, imageBoxAt, isPrintInputType, MAX_PRINT_BYTES } from '../../../shared/mindscape/images';
import { roleColorVar, type SessionRole } from '../../../shared/roles';
import {
  addPod,
  movePod,
  removePod,
  setChairPod,
  updatePod,
  addLink,
  addOwnerCard,
  addPlace,
  archiveCard,
  editOwnerCard,
  placeCardId,
  setBoardReach,
  placeOfSession,
  removeLink,
  setOwnerColor,
  setPlaceRole,
  toggleLinkArrow,
  visibleLinks,
  type MindscapeCard as Card,
  type SessionPlaceCard,
  type InkDrawing,
  type MindscapeDoc,
  type MindscapeDrawing,
} from '../../../shared/mindscape/model';
import type { MindscapeAlert } from '../../../shared/mindscape/persistence';
import { mindscapeShortcut, type MindscapeTool } from '../../../shared/mindscape/shortcuts';
import { screenToWorld, type BoardView, type Point } from '../../../shared/mindscape/view';
import type { TabColorToken } from '../../../shared/tabAppearance';
import { EMPTY_ITEMS, ERASER_RADIUS_PX, isDrawTool, MindscapeBoard, sizesOf, type DrawGesture } from './MindscapeBoard';
import { MindscapeDrawingLayer } from './MindscapeDrawingLayer';
import { MindscapeLinkLayer, MindscapeOutlineLayer, useCardSizes } from './MindscapeLinks';
import { MindscapeNoteCard, MindscapeOwnerCard, MindscapeSessionCard, STRIPE_BY_TOKEN, type PlaceRoleSeal } from './MindscapeCard';
import { RoleMenu } from './RoleMenu';
import { MindscapeSelectionLayer } from './MindscapeSelectionLayer';
import { LedgerStrip } from './LedgerStrip';
import type { PlaceStates } from '../../../shared/ledger/inbox';
import { MindscapeToolbar, type DrawStyle } from './MindscapeToolbar';
import { ShadowRoutines } from './ShadowRoutines';
import { ChairDrawer, ChairsBand, ChairsLayer, podSelection, RIG_SELECTION, type ChairDetails, type ChairFace, type OwnerLayerMode, type PodChoice, type PodDetails, type RigDetails } from './MindscapeChairs';
import { useLedgerSnapshot } from './useLedgerSnapshot';
import { FactoryNumbersButton, FactoryNumbersPanel, useFactoryMetrics } from './FactoryNumbers';
import { sameBoardName } from '../../../shared/homologacao/config';
import chairStyles from './Chairs.module.css';
// Mindscape de homologação — the factory's rigs, drawn from its own `rigs.json` on the factory's board.
import { RigsLayer, RigsNotice } from './MindscapeRigs';
import { useFactoryRigs } from './useFactoryRigs';
import type { FactoryRigsView } from '../../../shared/homologacao/ipc';
import { RIGS_STALE_MS, type RigsShape } from '../../../shared/homologacao/rigs';
import { layoutRigs } from '../../../shared/homologacao/rigsLayout';
import { deriveRigsView } from '../../../shared/homologacao/rigsView';
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
  /** Segundo plano visível — tasks running in the background (0 = none). */
  readonly background?: number;
  /** Item 12a — role the tab was launched with (gives the role to a place born from this conversation). */
  readonly roleId?: string;
  /** Item 04 — no hook heard yet (the `working` of the birth is a guess). */
  readonly unconfirmed?: boolean;
  /** Item 04 — kinds of the open pendings (`question`, `permission`, `plan`). */
  readonly pendingKinds?: readonly string[];
  /** Item 04 — `StopFailure` code of the last turn. */
  readonly turnFailure?: string;
  /** Sessões remotas — the ssh dropped while the process lives on the place: "sem ligação" (the app relinks). */
  readonly linkLost?: boolean;
  /** Item 04 — engine seal: the short model label read from the session (and the provider); absent = no reading. */
  readonly engine?: string;
  /** Item 04 — the context, same reading as the footer of the chat; absent = no reading (never a made-up 0%). */
  readonly meter?: { readonly usedTokens: number; readonly maxTokens: number };
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
  /** The board file could not be read or written (`useMindscapeDoc`); shown above the tabs, never blocking. */
  readonly alert?: MindscapeAlert | null;
  /** "Tentar de novo" of the alert. */
  readonly onRetry?: () => void;
  /** Lugar principal — the 007 registry: last activity and favorites (`pinned`). */
  readonly registry?: SessionRegistry;
  /** The name a session's tab had (`sessionNames` of the config), for a dormant card. */
  readonly storedNameOf?: (sessionId: string) => string | null;
  /** Rule 5 — resume a dormant session (`-r <id>`), or focus its tab when one is already open. */
  readonly onResume?: (sessionId: string, projectPath: string, name: string) => void;
  /** Diário de gestos — what the owner does on the board (kept only on this machine). */
  readonly onGesture?: (gesture: RendererGesture) => void;
  /** Item 12a — the roles of `<userData>/papeis/` (seal of the places, "＋ Sessão com papel…"). */
  readonly roles?: readonly SessionRole[];
  /** Item 12a — double click on a place that has not started: open its session with its role. */
  readonly onStartPlace?: (placeId: string, projectPath: string) => void;
  /** Item 12b — "Papéis…": the screen to create and edit roles. */
  readonly onManageRoles?: () => void;
  /** Cadeiras, fatia 2 — "Definir cadeira ▸" in the drawer: the chair screen (B1) of that role. */
  readonly onDefineChair?: (roleId: string) => void;
  /** Ledger v5, fatia 1 — the places of these boards, for the orphans of the box "Esperando você". */
  readonly ledgerPlaceStatesOf?: (projectPaths: readonly string[]) => PlaceStates;
  /** Clock of the "antigas" rule (tests pin it). */
  readonly now?: () => number;
}

const NO_REGISTRY: SessionRegistry = {};
const NO_ROLES: readonly SessionRole[] = [];

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

/** Cadeiras, fatia 1 — the lens of the board: the places of today or the chairs (F2a). Remembered on this machine. */
type BoardLens = 'places' | 'chairs';
const LENS_KEY = 'donel.mindscape.lens';

function readLens(): BoardLens {
  try {
    return window.localStorage.getItem(LENS_KEY) === 'chairs' ? 'chairs' : 'places';
  } catch {
    return 'places';
  }
}

function writeLens(lens: BoardLens): void {
  try {
    window.localStorage.setItem(LENS_KEY, lens);
  } catch {
    // No storage (private window): the lens lasts only this visit.
  }
}

/** Where the rig lands on screen when the lens opens (px from the top-left of the board). */
const RIG_SCREEN_MARGIN = 40;

/** The band's line on the factory's board: where the drawing comes from. */
function rigsDetail(shape: { readonly rigs: readonly unknown[]; readonly geradoEmMs: number }, chairCount: number): string {
  return `${shape.rigs.length} rig${shape.rigs.length === 1 ? '' : 's'} → ${chairCount} cadeira${chairCount === 1 ? '' : 's'}, como a factory se descreve no rigs.json (gerado às ${clockOf(shape.geradoEmMs)}). Para mudar o desenho, peça à factory.`;
}

/** Room above the rigs for the arrows' legend (board units). */
const RIGS_LEGEND_ROOM = 56;

function clockOf(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The shape to draw: the last good read, unless the place says the file is gone (then today's lens comes back). */
function rigsShapeOf(view: FactoryRigsView): RigsShape | null {
  if (view.file.status === 'missing' || !view.file.value?.ok) return null;
  return view.file.value.shape;
}

/** What the factory's board says above the lens about its `rigs.json`; `null` when the drawing is fresh. */
function rigsNoticeText(view: FactoryRigsView, now = Date.now()): string | null {
  const fallback = 'mostrando as cadeiras deste quadro, uma por papel.';
  const { file } = view;
  const shape = rigsShapeOf(view);
  if (!view.placeFound) return `Sem a forma dos rigs: o lugar "${view.place}" não está nos lugares remotos; ${fallback}`;
  if (file.status === 'missing') return `Sem a forma dos rigs: o rigs.json não está no lugar ${view.place}; ${fallback}`;
  if (file.value && !file.value.ok) return `Sem a forma dos rigs: ${file.value.message}; ${fallback}`;
  if (file.status === 'pending' || file.status === 'off') return shape ? null : 'Lendo a forma dos rigs na VPS…';
  if (file.status === 'unreachable') {
    return shape && file.lastOkAt
      ? `Sem sinal de ${view.place} desde ${clockOf(file.lastOkAt)}: o desenho é o da última leitura.`
      : `Sem a forma dos rigs: ${view.place} não respondeu; ${fallback}`;
  }
  const parts: string[] = [];
  if (shape && now - shape.geradoEmMs > RIGS_STALE_MS) parts.push(`Forma dos rigs parada desde ${clockOf(shape.geradoEmMs)}.`);
  if (shape && shape.foraDoContrato.length > 0) parts.push(`Item fora do contrato: ${shape.foraDoContrato.join(', ')}.`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** `Donel Dev` → `donel-dev`: the board's part of a chair address (`papel@rig`). */
function addressSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'quadro'
  );
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
  onView: applyView,
  onAction: applyAction,
  onUndo,
  onRedo,
  alert,
  onRetry,
  registry = NO_REGISTRY,
  storedNameOf,
  onResume,
  onGesture,
  now = Date.now,
  roles = NO_ROLES,
  onStartPlace,
  onManageRoles,
  onDefineChair,
  ledgerPlaceStatesOf,
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
  // Cadeiras, fatia 1 — the lens, the owner's layer in it, the arrows, the highlighted health and the open drawer.
  const [lens, setLensState] = useState<BoardLens>(readLens);
  const chairsOn = lens === 'chairs';
  const [ownerMode, setOwnerMode] = useState<OwnerLayerMode>('over');
  const [showArrows, setShowArrows] = useState(true);
  const [highlight, setHighlight] = useState<ChairHealth | null>(null);
  /** The chair (its id) or the rig (`RIG_SELECTION`) whose drawer is open. */
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const setLens = (next: BoardLens): void => {
    setLensState(next);
    writeLens(next);
    setOpenDetail(null);
    setHighlight(null);
  };
  const ledger = useLedgerSnapshot(chairsOn);
  // Mindscape de homologação V1, fatia 1 — the factory's numbers (`homologacao` key), on its board, in the lens.
  const factoryMetrics = useFactoryMetrics();
  const [factoryNumbersOpen, setFactoryNumbersOpen] = useState(false);
  // Fatia 2 — the shape of the factory's rigs (`rigs.json`), drawn in the lens of its board.
  const factoryRigs = useFactoryRigs(chairsOn);
  /** "Seu desenho: Oculto" — the board only moves: no key, paste or button may change what the owner cannot see. */
  const boardLocked = lensLocksBoard(chairsOn, ownerMode);
  const onAction = (projectPath: string, reducer: (doc: MindscapeDoc) => MindscapeDoc): void => {
    const guarded = guardBoardAction(boardLocked, reducer);
    if (guarded) applyAction(projectPath, guarded);
  };
  /**
   * The lens has its own view (pan and zoom), in memory only: moving or zooming in the lens never writes the board's
   * view, so the places come back exactly where they were, even after the app closes with the lens open.
   */
  const [lensViews, setLensViews] = useState<Readonly<Record<string, BoardView>>>({});
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

  // Lugar principal (rules 1–3) — every session of the board is drawn: live with its tab open,
  // dormant with it closed. The ones closed for more than 7 days fold away with their note,
  // until the owner unfolds them ("N antigas"). Favorites (pinned) never fold.
  const [showOld, setShowOld] = useState(false);
  const liveSessionIds = new Set(boardSessions.map((session) => session.sessionId));
  const sessionsView = board ? classifyBoardSessions({ board, liveSessionIds, registry, now: now() }) : undefined;
  const dormantDrawn: readonly DormantSession[] = sessionsView ? (showOld ? [...sessionsView.dormant, ...sessionsView.old] : sessionsView.dormant) : [];
  const dormantIds = new Set(dormantDrawn.map((entry) => entry.sessionId));
  const foldedIds: ReadonlySet<string> = showOld || !sessionsView ? new Set() : sessionsView.oldSessionIds;
  // Item 04 — retomabilidade: the conversations found in the project folder (where `-r <id>` looks),
  // read when the board has a session whose process is gone. Not read yet → "desconhecido".
  const [transcripts, setTranscripts] = useState<{ readonly path: string; readonly ids: ReadonlySet<string> } | undefined>(undefined);
  const transcriptsPath = board?.projectPath;
  const needsTranscripts = dormantDrawn.length > 0 || boardSessions.some((session) => session.state === 'done' || session.state === 'error');
  useEffect(() => {
    if (!transcriptsPath || !needsTranscripts) return undefined;
    let cancelled = false;
    void window.donel.sessions
      .list(transcriptsPath)
      .then((list) => {
        if (!cancelled) setTranscripts({ path: transcriptsPath, ids: new Set(list.map((summary) => summary.id)) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [transcriptsPath, needsTranscripts, dormantDrawn.length]);
  const transcriptFound = (sessionId: string): boolean | undefined =>
    transcripts && transcripts.path === transcriptsPath ? transcripts.ids.has(sessionId) : undefined;
  const axesOfLive = (session: MindscapeLiveSession): SessionAxes =>
    deriveSessionAxes({
      tabOpen: true,
      state: session.state,
      unconfirmed: session.unconfirmed,
      pendingKinds: session.pendingKinds,
      turnFailure: session.turnFailure,
      linkLost: session.linkLost,
      transcriptFound: transcriptFound(session.sessionId),
    });
  const isFavorite = (sessionId: string): boolean => registry[sessionId]?.pinned === true;
  const dormantName = (sessionId: string): string => {
    const note = board?.cards[`note:${sessionId}`];
    return dormantSessionName({
      stored: storedNameOf?.(sessionId),
      noteName: note?.kind === 'session-note' ? note.sessionName : undefined,
      registryLabel: registry[sessionId]?.label,
    });
  };
  const resume = (sessionId: string): void => {
    if (board) onResume?.(sessionId, board.projectPath, dormantName(sessionId));
  };
  /** A place by its name on the board (the shadow routines, the Oráculo's cards); never its id. */
  const [boardArea, setBoardArea] = useState<HTMLDivElement | null>(null);
  const placeName = (projectPath: string, placeId: string): string | undefined => {
    if (!board || board.projectPath !== projectPath) return undefined;
    const card = board.cards[placeId];
    if (card?.kind !== 'session' || !card.sessionId) return undefined;
    const sessionId = card.sessionId;
    return boardSessions.find((session) => session.sessionId === sessionId)?.name ?? dormantName(sessionId);
  };
  // Item 12a — places that have not started yet: always drawn, a double click opens their session.
  const pendingPlaces: readonly SessionPlaceCard[] = board
    ? Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session' && card.sessionId === undefined)
    : [];
  const startPlace = (placeId: string): void => {
    if (board) onStartPlace?.(placeId, board.projectPath);
  };
  const roleSealOf = (roleId: string | undefined): PlaceRoleSeal | undefined => {
    if (!roleId) return undefined;
    const role = roles.find((candidate) => candidate.id === roleId);
    // A role whose file is gone still shows on its place, by its id, in a neutral color.
    return role ? { name: role.name, color: roleColorVar(role.color) } : { name: roleId, color: 'var(--text-muted)' };
  };
  /** Item 12a — the place whose seal menu is open (only a place that has not started). */
  const [roleMenuPlaceId, setRoleMenuPlaceId] = useState<string | undefined>(undefined);
  const closeRoleMenu = (): void => setRoleMenuPlaceId(undefined);
  const visibleCards = board
    ? Object.values(board.cards).filter((card) => {
        // The chairs lens: the places and their notes live inside the chairs; only the owner's post-its stay.
        if (chairsOn) return card.kind === 'owner' && ownerMode !== 'hidden';
        if (card.kind === 'session') return card.sessionId === undefined || liveSessionIds.has(card.sessionId) || dormantIds.has(card.sessionId);
        if (card.kind === 'session-note') return !foldedIds.has(card.sessionId);
        return true;
      })
    : [];
  const visibleIds = new Set(visibleCards.map((card) => card.id));
  /** Measured rects in drawing order (session cards first, then the others) — the hit-test of A/L and the lasso. */
  const cardRects: CardRect[] = [];
  if (board) {
    const ordered = [
      ...boardSessions.map((session) => placeOfSession(board, session.sessionId)).filter((card): card is SessionPlaceCard => card !== undefined),
      ...dormantDrawn.map((entry) => board.cards[entry.cardId]).filter((card): card is Card => card !== undefined),
      ...pendingPlaces,
      ...Object.values(board.cards).filter((card) => card.kind !== 'session' && visibleIds.has(card.id)),
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
  const onlySessionId = onlyCard?.kind === 'session' ? onlyCard.sessionId : undefined;
  const selectedSession = onlySessionId ? boardSessions.find((session) => session.sessionId === onlySessionId) : undefined;
  const selectedDormantId = onlySessionId && dormantIds.has(onlySessionId) ? onlySessionId : undefined;
  const selectedPendingId = onlyCard?.kind === 'session' && onlyCard.sessionId === undefined ? onlyCard.id : undefined;

  // Cadeiras, fatia 1 — the chairs of the board (one per role), read from its places; nothing is written.
  const boardName = board ? (projectNames[board.projectPath] ?? folderName(board.projectPath)) : '';
  const factoryHere =
    chairsOn && board && factoryMetrics && (sameBoardName(factoryMetrics.board, boardName) || sameBoardName(factoryMetrics.board, folderName(board.projectPath)))
      ? factoryMetrics
      : null;
  const allPlaces: readonly SessionPlaceCard[] = board ? Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session') : [];
  const liveByPlace = new Map<string, MindscapeLiveSession>();
  if (board) {
    for (const session of boardSessions) {
      const place = placeOfSession(board, session.sessionId);
      if (place) liveByPlace.set(place.id, session);
    }
  }
  const chairsView = useMemo(() => {
    if (!chairsOn || !board) return undefined;
    const liveAxes = new Map([...liveByPlace].map(([placeId, session]) => [placeId, axesOfLive(session)] as const));
    const view = deriveChairs({ places: allPlaces, links: board.links, liveAxes, roleOrder: roles.map((role) => role.id) });
    // Cadeiras, fatia 4 — the owner's pods (v6): each one lays out its own chairs, at the corner he dragged it to.
    const pods = (board.pods ?? []).map((pod) => ({ id: pod.id, name: pod.name, ...(pod.mission ? { mission: pod.mission } : {}), chairIds: pod.roleIds, at: { x: pod.x, y: pod.y } }));
    return { ...view, pods, layout: layoutChairs(view, boardContentOrigin(board), pods) };
    // The live sessions and the board change identity on every update; the chairs follow them.
  }, [chairsOn, board, sessions, roles, transcripts]);
  // Mindscape de homologação — on the factory's board (`homologacao.quadro`), the lens draws the factory's rigs from
  // its `rigs.json`; without a readable file it keeps today's lens, with a notice saying why.
  const rigsHere =
    chairsOn && board && factoryRigs && (sameBoardName(factoryRigs.board, boardName) || sameBoardName(factoryRigs.board, folderName(board.projectPath)))
      ? factoryRigs
      : null;
  const rigsBoard = useMemo(() => {
    const shape = rigsHere ? rigsShapeOf(rigsHere) : null;
    if (!shape || !board) return undefined;
    return { shape, view: deriveRigsView(shape), layout: layoutRigs(shape, boardContentOrigin(board)) };
    // The board changes identity on every update; the rigs follow the file and where the owner's drawing starts.
  }, [rigsHere, board]);
  const rigsNotice = rigsHere ? rigsNoticeText(rigsHere) : null;
  const faceOf = (chair: Chair): ChairFace => {
    if (chair.id === NO_ROLE_CHAIR) return { name: 'Sem papel', color: 'var(--text-muted)' };
    const seal = roleSealOf(chair.roleId)!;
    return { name: seal.name, color: seal.color };
  };
  // The lens opens with the rig at the top-left of the board, at the board's zoom.
  const lensOrigin = rigsBoard ? { x: rigsBoard.layout.bounds.x, y: rigsBoard.layout.bounds.y - RIGS_LEGEND_ROOM } : chairsView?.layout.rig;
  const lensView: BoardView | undefined =
    board && chairsView && lensOrigin
      ? (lensViews[board.projectPath] ?? {
          zoom: board.zoom,
          pan: { x: RIG_SCREEN_MARGIN - lensOrigin.x * board.zoom, y: RIG_SCREEN_MARGIN - lensOrigin.y * board.zoom },
        })
      : undefined;
  /** The board as shown: in the lens, with the lens's own view. */
  const shownBoard = board && lensView ? { ...board, pan: lensView.pan, zoom: lensView.zoom } : board;
  const onView = (projectPath: string, change: (view: BoardView) => BoardView): void => {
    if (chairsOn && lensView && board?.projectPath === projectPath) {
      const current = lensView;
      setLensViews((views) => ({ ...views, [projectPath]: change(views[projectPath] ?? current) }));
      return;
    }
    applyView(projectPath, change);
  };

  const podOfChair = (chairId: string): string | null => board?.pods?.find((pod) => pod.roleIds.includes(chairId))?.id ?? null;
  const podChoiceOf = (chairId: string | null): PodChoice | undefined => {
    if (!board || !chairId || chairId === NO_ROLE_CHAIR || boardLocked || !(board.pods?.length ?? 0)) return undefined;
    const { projectPath } = board;
    return {
      current: podOfChair(chairId),
      pods: (board.pods ?? []).map((pod) => ({ id: pod.id, name: pod.name })),
      onPick: (podId) => onAction(projectPath, (current) => setChairPod(current, projectPath, chairId, podId)),
    };
  };
  const addNewPod = (): void => {
    if (!board || !chairsView) return;
    const { projectPath } = board;
    const { rig, pods: boxes } = chairsView.layout;
    const id = `pod:${crypto.randomUUID()}`;
    // The first pod takes the rig's corner; the next ones go below the lowest (never right, toward the owner's drawing).
    const at = boxes.length === 0 ? { x: rig.x + 24, y: rig.y + 64 } : { x: Math.min(...boxes.map((box) => box.x)), y: Math.max(...boxes.map((box) => box.y + box.h)) + 40 };
    const name = `Pod ${(board.pods?.length ?? 0) + 1}`;
    onAction(projectPath, (current) => addPod(current, projectPath, { id, name, ...at }));
    setOpenDetail(podSelection(id));
  };
  const chairDetails = (chairId: string): ChairDetails | RigDetails | PodDetails | null => {
    if (!board || !chairsView) return null;
    // The factory's chairs get their own drawer with the live state (fatia 3 of the homologation board).
    if (rigsBoard) return null;
    const pod = board.pods?.find((candidate) => podSelection(candidate.id) === chairId);
    if (pod) {
      const { projectPath } = board;
      const entry = (chair: Chair) => ({ chair, face: faceOf(chair) });
      return {
        podId: pod.id,
        name: pod.name,
        ...(pod.mission ? { mission: pod.mission } : {}),
        boardName,
        chairs: pod.roleIds.flatMap((roleId) => chairsView.chairs.filter((chair) => chair.id === roleId)).map(entry),
        others: chairsView.chairs.filter((chair) => chair.roleId && !pod.roleIds.includes(chair.id)).map(entry),
        ...(boardLocked
          ? {}
          : {
              edit: {
                onRename: (name: string) => onAction(projectPath, (current) => updatePod(current, projectPath, pod.id, { name })),
                onMission: (mission: string) => onAction(projectPath, (current) => updatePod(current, projectPath, pod.id, { mission })),
                onAddChair: (id: string) => onAction(projectPath, (current) => setChairPod(current, projectPath, id, pod.id)),
                onRemoveChair: (id: string) => onAction(projectPath, (current) => setChairPod(current, projectPath, id, null)),
                onDelete: () => {
                  onAction(projectPath, (current) => removePod(current, projectPath, pod.id));
                  setOpenDetail(RIG_SELECTION);
                },
              },
            }),
      };
    }
    if (chairId === RIG_SELECTION) {
      return { boardName, projectPath: board.projectPath, placeCount: allPlaces.length, chairs: chairsView.chairs.map((chair) => ({ chair, face: faceOf(chair) })) };
    }
    const chair = chairsView.chairs.find((candidate) => candidate.id === chairId);
    if (!chair) return null;
    const role = roles.find((candidate) => candidate.id === chair.roleId);
    const places = chair.placeIds.map((id) => board.cards[id]).filter((card): card is SessionPlaceCard => card?.kind === 'session');
    const sessionIds = new Set(places.flatMap((place) => [...(place.sessionId ? [place.sessionId] : []), ...place.previous]));
    const notes = Object.values(board.cards).filter((card): card is Extract<Card, { kind: 'session-note' }> => card.kind === 'session-note' && sessionIds.has(card.sessionId));
    const lastNote = notes.reduce<(typeof notes)[number] | undefined>((newest, note) => (!newest || note.writtenAt > newest.writtenAt ? note : newest), undefined);
    const noteAt = new Map(notes.map((note) => [note.sessionId, note.writtenAt]));
    const seated = chair.seated.flatMap((placeId) => {
      const session = liveByPlace.get(placeId);
      if (!session) return [];
      const axes = axesOfLive(session);
      const label = axes.needs.length > 0 ? `precisa de você · ${axes.needs.join(', ')}` : axes.activity;
      return [{ placeId, name: session.name, state: session.state, label, since: session.stateEnteredAt, onOpen: () => onGoToTerminal(session.tabId) }];
    });
    const past = chair.closed
      .flatMap((placeId) => {
        const sessionId = (board.cards[placeId] as SessionPlaceCard | undefined)?.sessionId;
        if (!sessionId) return [];
        const registered = registry[sessionId]?.lastActivityAt ?? null;
        const noted = noteAt.get(sessionId) ?? null;
        const at = registered === null ? noted : noted === null ? registered : Math.max(registered, noted);
        return [{ placeId, name: dormantName(sessionId), at, when: closedLabel(at), onOpen: onResume ? () => resume(sessionId) : undefined }];
      })
      .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
    const placeIds = new Set(chair.placeIds);
    const tasks = ledger ? Object.values(ledger.doc.tasks).filter((task) => task.projectPath === board.projectPath && placeIds.has(task.ownerPlaceId)) : [];
    const liveTasks = tasks
      .filter((task) => !isClosed(task))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((task) => ({ id: task.id, title: task.title ?? (task.request.length > 60 ? `${task.request.slice(0, 59)}…` : task.request), state: viewState(task) }));
    const engines = [...new Set(seated.flatMap((row) => liveByPlace.get(row.placeId)?.engine ?? []))];
    return {
      chair,
      face: faceOf(chair),
      address: `${chair.roleId ?? 'sem-papel'}@${addressSlug(boardName)}`,
      boardName,
      seated,
      past,
      notes: notes.length,
      ...(lastNote ? { lastNote: { text: lastNote.text, by: liveByPlace.get(places.find((place) => place.sessionId === lastNote.sessionId)?.id ?? '')?.name ?? lastNote.sessionName, at: lastNote.writtenAt } } : {}),
      ...(role?.model ? { configuredModel: role.model } : {}),
      ...(role?.effort ? { configuredEffort: role.effort } : {}),
      observedEngines: engines,
      liveTasks,
      closedTasks: tasks.length - liveTasks.length,
    };
  };

  /** Rule 7 — one undoable gesture; favorites (and their notes) stay where they are. */
  const organize = (): void => {
    if (!board) return;
    const { projectPath } = board;
    const entries: OrganizeEntry[] = [
      ...boardSessions
        .filter((session) => !isFavorite(session.sessionId))
        .flatMap((session) => {
          const place = placeOfSession(board, session.sessionId);
          if (!place) return [];
          return [
            {
              cardId: place.id,
              sessionId: session.sessionId,
              column: organizeColumnOf(axesOfLive(session), sessionHighlight(session.state, session.stateEnteredAt, seenAt[session.sessionId])),
            },
          ];
        }),
      // A place that has not started waits for the owner's double click.
      ...pendingPlaces.map((place) => ({ cardId: place.id, column: 'waiting' as const })),
      ...dormantDrawn.filter((entry) => !entry.pinned).map((entry) => ({ cardId: entry.cardId, sessionId: entry.sessionId, column: 'closed' as const })),
    ];
    if (entries.length === 0) return;
    const measured = { ...sizes };
    onAction(projectPath, (current) => organizeBoard(current, projectPath, entries, measured));
    onGesture?.({ type: 'mindscape', acao: 'organizar', projectPath });
  };

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
    const radius = ERASER_RADIUS_PX / (shownBoard ?? board).zoom;
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
    if (!board || boardLocked || !isPrintInputType(file.type)) return;
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
    const shortcut = shortcutInLens(mindscapeShortcut({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, editable }), boardLocked);
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
        setOpenDetail(null);
        setTool('select');
        return;
      case 'tool':
        changeTool(shortcut.tool);
        return;
    }
  };

  const hint =
    notice ??
    (tool !== 'select'
      ? TOOL_HINT[tool]
      : selectedSession
        ? selectedSession.name
        : selectedDormantId
          ? `${dormantName(selectedDormantId)}: fechada. "Ir ao terminal" ou duplo clique retoma`
          : selectedPendingId
            ? 'Ainda não começou. "Ir ao terminal" ou duplo clique abre a sessão com o papel; Delete tira o lugar'
            : SELECT_HINT);
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
      {alert ? (
        <div className={styles.alert} role="alert" data-testid="mindscape-alert" data-kind={alert.kind}>
          <span>{alert.text}</span>
          {alert.retry && onRetry ? (
            <button type="button" className={styles.alertRetry} onClick={onRetry}>
              Tentar de novo
            </button>
          ) : null}
        </div>
      ) : null}
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
        {board ? (
          <span className={chairStyles.lens} role="group" aria-label="Ver o quadro como">
            <button type="button" aria-pressed={!chairsOn} onClick={() => setLens('places')} data-testid="mindscape-lens-places">
              Lugares
            </button>
            <button type="button" aria-pressed={chairsOn} onClick={() => setLens('chairs')} data-testid="mindscape-lens-chairs">
              Cadeiras
            </button>
          </span>
        ) : null}
        {factoryHere ? <FactoryNumbersButton open={factoryNumbersOpen} onToggle={() => setFactoryNumbersOpen((open) => !open)} /> : null}
      </div>
      <LedgerStrip projectPath={activePath} placeName={placeName} cardsHost={boardArea} placeStatesOf={ledgerPlaceStatesOf} />
      <MindscapeToolbar
        enabled={Boolean(board) && !boardLocked}
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
          const origin = screenToWorld({ x: NEW_CARD_MARGIN, y: NEW_CARD_MARGIN }, { pan: (shownBoard ?? board).pan, zoom: (shownBoard ?? board).zoom });
          const createdAt = Date.now();
          setCreatedCardId(id);
          onAction(projectPath, (current) => addOwnerCard(current, projectPath, { id, createdAt, origin }));
        }}
        shadow={
          <ShadowRoutines
            projectPath={board?.projectPath}
            placeName={(placeId) => placeName(board?.projectPath ?? '', placeId)}
          />
        }
        reach={board?.reach ?? 'own'}
        onToggleReach={() => {
          if (!board) return;
          const { projectPath } = board;
          const next = board.reach === 'all' ? 'own' : 'all';
          onAction(projectPath, (current) => setBoardReach(current, projectPath, next));
        }}
        roles={roles}
        onNewPlace={(roleId) => {
          if (!board) return;
          const { projectPath } = board;
          const id = placeCardId(crypto.randomUUID());
          const origin = screenToWorld({ x: NEW_CARD_MARGIN, y: NEW_CARD_MARGIN }, { pan: (shownBoard ?? board).pan, zoom: (shownBoard ?? board).zoom });
          onAction(projectPath, (current) => addPlace(current, projectPath, { id, origin, ...(roleId ? { roleId } : {}) }));
          setTool('select');
          select({ cards: [id], drawings: [] });
        }}
        onManageRoles={onManageRoles}
        canGoToTerminal={Boolean(selectedSession) || (Boolean(selectedDormantId) && Boolean(onResume)) || (Boolean(selectedPendingId) && Boolean(onStartPlace))}
        onGoToTerminal={() => {
          if (selectedSession) onGoToTerminal(selectedSession.tabId);
          else if (selectedDormantId) resume(selectedDormantId);
          else if (selectedPendingId) startPlace(selectedPendingId);
        }}
        canOrganize={!chairsOn && boardSessions.length + dormantDrawn.length + pendingPlaces.length > 0}
        onOrganize={organize}
        oldCount={sessionsView?.oldSessionIds.size ?? 0}
        showOld={showOld}
        onToggleOld={() => {
          if (!showOld && board) onGesture?.({ type: 'mindscape', acao: 'mostrar-antigas', projectPath: board.projectPath });
          setShowOld((current) => !current);
        }}
        hint={
          boardLocked
            ? 'Seu desenho está oculto: o quadro só se move. Volte a "Por cima" para editar.'
            : chairsOn && tool === 'select' && !notice
              ? 'Clique numa cadeira ou no nome do rig para ver os detalhes; Esc fecha. Seu desenho segue editável.'
              : hint
        }
      />
      {chairsOn && chairsView ? (
        <ChairsBand
          placeCount={allPlaces.length}
          chairCount={rigsBoard ? rigsBoard.view.chairs.length : chairsView.chairs.length}
          counts={rigsBoard ? rigsBoard.view.counts : chairsView.counts}
          detail={rigsBoard ? rigsDetail(rigsBoard.shape, rigsBoard.view.chairs.length) : undefined}
          highlight={highlight}
          onHighlight={setHighlight}
          ownerMode={ownerMode}
          onOwnerMode={(mode) => {
            setOwnerMode(mode);
            if (mode === 'hidden') clearSelection();
          }}
          showArrows={showArrows}
          onShowArrows={setShowArrows}
          {...(boardLocked || rigsBoard ? {} : { onAddPod: addNewPod })}
        />
      ) : null}
      {chairsOn && rigsNotice ? <RigsNotice text={rigsNotice} /> : null}
      {/* Cartas forma A — the Oráculo's cards open over the board only (LedgerStrip portals them here). */}
      <div ref={setBoardArea} className={styles.boardArea}>
      {!board ? (
        <div className={styles.view} data-testid="mindscape-board">
          <p className={styles.empty}>Abra uma sessão claude num projeto: o quadro dele aparece aqui.</p>
        </div>
      ) : (
        <MindscapeBoard
          board={shownBoard ?? board}
          tool={chairsOn && ownerMode === 'hidden' ? 'hand' : tool}
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
            setOpenDetail(null);
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
            const ownerInk = (
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
              </>
            );
            const ownerCards = (
              <>
              {Object.values(board.cards).map((card) => {
                if (!visibleIds.has(card.id)) return null;
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
                      onArchive={() => {
                        onAction(board.projectPath, (current) => archiveCard(current, board.projectPath, card.id));
                        onGesture?.({ type: 'mindscape', acao: 'arquivar', projectPath: board.projectPath, cardKind: 'owner' });
                      }}
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
                    onArchive={() => {
                      onAction(board.projectPath, (current) => archiveCard(current, board.projectPath, card.id));
                      onGesture?.({ type: 'mindscape', acao: 'arquivar', projectPath: board.projectPath, cardKind: 'session-note', sessionId: card.sessionId });
                    }}
                  />
                );
              })}
              </>
            );
            const outlines = (
              <>
              <MindscapeOutlineLayer cardIds={visibleCards.map((card) => card.id)} rectOf={rectOf} />
              <MindscapeSelectionLayer
                cards={outlinedCards}
                drawings={shownSelected}
                withHandles={tool === 'select' && live.cards.length === 0 && selectedDrawings.length === 1}
                lasso={lasso}
                zoom={(shownBoard ?? board).zoom}
              />
              </>
            );
            if (chairsOn && chairsView) {
              const ownerClass = [chairStyles.ownerLayer, ownerMode === 'dim' ? chairStyles.ownerDim : '', ownerMode === 'hidden' ? chairStyles.ownerHidden : ''].filter(Boolean).join(' ');
              return (
                <>
                  {rigsBoard ? (
                    <RigsLayer
                      shape={rigsBoard.shape}
                      chairs={rigsBoard.view.chairs}
                      layout={rigsBoard.layout}
                      showArrows={showArrows}
                      highlight={highlight}
                      selected={openDetail}
                      onOpenChair={(chairId) => {
                        clearSelection();
                        setOpenDetail((open) => (open === chairId ? null : chairId));
                      }}
                    />
                  ) : (
                  <ChairsLayer
                    boardName={boardName}
                    chairs={chairsView.chairs}
                    edges={chairsView.edges}
                    layout={chairsView.layout}
                    faceOf={faceOf}
                    seatState={(placeId) => liveByPlace.get(placeId)?.state}
                    showArrows={showArrows}
                    highlight={highlight}
                    selected={openDetail}
                    onOpenChair={(chairId) => {
                      clearSelection();
                      setOpenDetail((open) => (open === chairId ? null : chairId));
                    }}
                    onOpenRig={() => {
                      clearSelection();
                      setOpenDetail((open) => (open === RIG_SELECTION ? null : RIG_SELECTION));
                    }}
                    pods={chairsView.pods}
                    zoom={(shownBoard ?? board).zoom}
                    onOpenPod={(podId) => {
                      clearSelection();
                      setOpenDetail((open) => (open === podSelection(podId) ? null : podSelection(podId)));
                    }}
                    {...(boardLocked
                      ? {}
                      : {
                          onMovePod: (podId: string, x: number, y: number) => {
                            const { projectPath } = board;
                            onAction(projectPath, (current) => movePod(current, projectPath, podId, x, y));
                          },
                        })}
                  />
                  )}
                  {/* The owner's drawing stays free and on top (por cima · esmaecido · oculto); the layout never moves it. */}
                  <div className={ownerClass} data-testid="mindscape-owner-layer" data-mode={ownerMode}>
                    {ownerInk}
                    {ownerCards}
                    {outlines}
                  </div>
                  {!rigsBoard && chairsView.chairs.length === 0 ? <p className={styles.empty}>Nenhum lugar neste quadro ainda: as cadeiras aparecem quando houver sessões.</p> : null}
                </>
              );
            }
            return (
            <>
              {ownerInk}
              {boardSessions.map((session) => {
                const card = placeOfSession(board, session.sessionId);
                if (!card) return null;
                const position = positionOf(card);
                return (
                  <MindscapeSessionCard
                    key={session.tabId}
                    cardId={card.id}
                    sessionId={session.sessionId}
                    role={roleSealOf(card.roleId)}
                    name={session.name}
                    state={session.state}
                    color={session.color}
                    cliColorHex={session.cliColorHex}
                    x={position.x}
                    y={position.y}
                    highlight={sessionHighlight(session.state, session.stateEnteredAt, seenAt[session.sessionId])}
                    selected={live.cards.includes(card.id)}
                    onOpen={() => onGoToTerminal(session.tabId)}
                    favorite={isFavorite(session.sessionId)}
                    background={session.background}
                    engine={session.engine}
                    meter={session.meter}
                    axes={axesOfLive(session)}
                  />
                );
              })}
              {dormantDrawn.map((entry) => {
                const card = board.cards[entry.cardId];
                if (card?.kind !== 'session') return null;
                const position = positionOf(card);
                return (
                  <MindscapeSessionCard
                    key={card.id}
                    cardId={card.id}
                    sessionId={entry.sessionId}
                    role={roleSealOf(card.roleId)}
                    name={dormantName(entry.sessionId)}
                    state="done"
                    color="none"
                    x={position.x}
                    y={position.y}
                    highlight="dimmed"
                    selected={live.cards.includes(card.id)}
                    onOpen={() => resume(entry.sessionId)}
                    closedLabel={closedLabel(entry.lastActivityAt)}
                    favorite={entry.pinned}
                    axes={deriveSessionAxes({ tabOpen: false, transcriptFound: transcriptFound(entry.sessionId) })}
                  />
                );
              })}
              {pendingPlaces.map((card) => {
                const position = positionOf(card);
                const role = roles.find((candidate) => candidate.id === card.roleId);
                return (
                  <MindscapeSessionCard
                    key={card.id}
                    cardId={card.id}
                    name={role?.name ?? 'Sessão nova'}
                    state="done"
                    color="none"
                    x={position.x}
                    y={position.y}
                    highlight="dimmed"
                    selected={live.cards.includes(card.id)}
                    onOpen={() => startPlace(card.id)}
                    notStarted
                    role={roleSealOf(card.roleId)}
                    onRoleClick={() => setRoleMenuPlaceId((open) => (open === card.id ? undefined : card.id))}
                  />
                );
              })}
              {(() => {
                // Item 12a — the seal menu of a place that has not started: another role, only now.
                const place = roleMenuPlaceId ? board.cards[roleMenuPlaceId] : undefined;
                if (place?.kind !== 'session' || place.sessionId !== undefined) return null;
                const position = positionOf(place);
                return (
                  <div className={styles.placeRoleMenu} style={{ left: position.x + 110, top: position.y + 6 }}>
                    <RoleMenu
                      label="Papel deste lugar"
                      roles={roles}
                      current={place.roleId}
                      onClose={closeRoleMenu}
                      onManage={onManageRoles}
                      onPick={(roleId) => {
                        closeRoleMenu();
                        const { projectPath } = board;
                        onAction(projectPath, (current) => setPlaceRole(current, projectPath, place.id, roleId));
                      }}
                    />
                  </div>
                );
              })()}
              {ownerCards}
              {visibleCards.length === 0 ? (
                <p className={styles.empty}>Nenhuma sessão aberta neste projeto.</p>
              ) : null}
              {outlines}
            </>
            );
          }}
        </MindscapeBoard>
      )}
      {chairsOn ? (
        <ChairDrawer
          details={openDetail ? chairDetails(openDetail) : null}
          onClose={() => setOpenDetail(null)}
          onOpenChair={(chairId) => setOpenDetail(chairId)}
          onDefine={onDefineChair ?? (onManageRoles ? () => onManageRoles() : undefined)}
          podChoice={podChoiceOf(openDetail)}
        />
      ) : null}
      {factoryHere && factoryNumbersOpen ? <FactoryNumbersPanel view={factoryHere} onClose={() => setFactoryNumbersOpen(false)} /> : null}
      </div>
    </section>
  );
}
