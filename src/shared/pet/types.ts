// 015 (Jobu pet) - types of the pure core. Everything here is serializable and free of
// Electron/React, so main, preload, renderer and vitest all import the same shapes.
// Data model: specs/015-jobu-pet/data-model.md. The reducer (petState.ts) and the view projection
// (petView.ts) are here since US1; the bubble rules (bubble.ts) arrive with US2. The shapes they
// work on are fixed in this file.

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

/** The 15 logical poses (FR-010, FR-016, FR-029). `poses.ts` resolves each one to an art file. */
export const POSE_NAMES = [
  'neutral',
  'talking',
  'sleeping',
  'skeptical',
  'waffle',
  'incense',
  'reading',
  'mirror',
  'laughing',
  'sad',
  'angry',
  'surprised',
  'impatient',
  'very-impatient',
  'calling',
] as const;

export type PoseName = (typeof POSE_NAMES)[number];

/** Optional blink frames (FR-028/FR-029): drawn only when the art exists, never substituted. */
export const BLINK_POSE_NAMES = ['blink-neutral', 'blink-impatient'] as const;

export type BlinkPoseName = (typeof BLINK_POSE_NAMES)[number];

// ---------------------------------------------------------------------------
// Geometry (all values in DIP: device-independent pixels, as Electron reports them)
// ---------------------------------------------------------------------------

export interface PetPoint {
  readonly x: number;
  readonly y: number;
}

export interface PetRect extends PetPoint {
  readonly width: number;
  readonly height: number;
}

/** The slice of Electron's `Display` the placement rules use. */
export interface PetDisplay {
  readonly id?: number;
  readonly bounds: PetRect;
  readonly workArea: PetRect;
  /** Informational: every input and output of `placement.ts` is already in DIP. */
  readonly scaleFactor: number;
}

/**
 * Where the speech bubble and the list sit relative to the drawing, like a CSS alignment:
 * `right` = anchored to the drawing's right edge and growing leftwards (used near the right edge
 * of the screen, which is the default position), `left` = the mirror image, `center` = centered.
 */
export type PetAlign = 'left' | 'center' | 'right';

// ---------------------------------------------------------------------------
// Inputs of the core
// ---------------------------------------------------------------------------

/**
 * `idle` = registered but no hook update yet (R2): never counted as working. `error` reaches the
 * core as `done`.
 */
export type PetSemaphore = 'idle' | 'working' | 'waiting' | 'permission' | 'done';

/**
 * What the session semaphore publishes (`PublicSemaphoreState`, src/main/session-semaphore-manager.ts):
 * the five states of the tab icon. `toPetSemaphore` (petState.ts) turns it into a `PetSemaphore`.
 */
export type SemaphorePublicState = 'working' | 'waiting' | 'permission' | 'error' | 'done';

/** The kind of an open pending, when the chat knows it (R3). `null` + `permission` = "quer permissão". */
export type BlockedKind = 'question' | 'permission' | 'plan';

/** One `claude` tab as the core sees it. Plain terminal tabs never enter. */
export interface WatchedSession {
  readonly ptyId: string;
  readonly name: string;
  readonly semaphore: PetSemaphore;
  readonly blockedKind: BlockedKind | null;
}

export interface FocusSignal {
  /** Active tab in the Donel window; `null` = none (or not a `claude` session). */
  readonly activePtyId: string | null;
  /** The Donel window has the system focus. */
  readonly donelFocused: boolean;
}

export interface AccountSwitchedEvent {
  readonly type: 'accountSwitched';
  /** Account label only, never an e-mail. */
  readonly label: string;
  readonly at: number;
}

export interface SessionExitedEvent {
  readonly type: 'sessionExited';
  readonly ptyId: string;
  readonly name: string;
  /** `true` when the owner closed the tab (`pty:kill`), so "encerrou" is not announced (R6). */
  readonly byUser: boolean;
  readonly at: number;
}

export interface PendingOpenedEvent {
  readonly type: 'pendingOpened';
  readonly ptyId: string;
  readonly kind: BlockedKind;
  readonly at: number;
}

/** "Silenciar por 1 hora" / "Retomar avisos"; `null` = not silenced. */
export interface SilenceEvent {
  readonly type: 'silence';
  readonly until: number | null;
}

/** The 1 s clock of the main. The instant itself is the `now` argument of `reducePet`. */
export interface TickEvent {
  readonly type: 'tick';
}

export type PetEvent = AccountSwitchedEvent | SessionExitedEvent | PendingOpenedEvent | SilenceEvent | TickEvent;

/**
 * The tabs the pet watches, as a whole: every call carries ALL of them, so the reducer compares it
 * with what it knows. A tab missing from it was closed (no event, FR-009); a ptyId it has never seen
 * is a new session.
 */
export interface SessionsInput {
  readonly type: 'sessions';
  readonly sessions: readonly WatchedSession[];
}

export interface FocusInput {
  readonly type: 'focus';
  readonly focus: FocusSignal;
}

/**
 * The pet window opened again after a while with no clock (the pet was turned off): what depended on
 * time that kept running without it (laugh, waffle, serene period, bubble) starts from now. What the
 * owner still owes (the waiting sessions, with their real age) is kept.
 */
export interface ResumeInput {
  readonly type: 'resume';
}

/** Everything `reducePet` takes. US2 and US5 give the events of `PetEvent` other than `tick` their effect. */
export type PetInput = SessionsInput | FocusInput | ResumeInput | PetEvent;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

export interface TrackedSession {
  readonly name: string;
  readonly semaphore: PetSemaphore;
  readonly blockedKind: BlockedKind | null;
  /** Moment the session entered `waiting`/`permission`; `null` outside them. */
  readonly waitingSince: number | null;
  /** Seen by the owner since `waitingSince` (active tab with the Donel focused). */
  readonly seen: boolean;
}

/** Where a click on the speech bubble leads (FR-025). */
export type BubbleTarget =
  | { readonly kind: 'session'; readonly ptyId: string }
  | { readonly kind: 'list' }
  | { readonly kind: 'donel' };

export interface Bubble {
  /** Grows with every new bubble; the screen keys the little hop on it. */
  readonly id: number;
  readonly text: string;
  readonly pose: PoseName;
  readonly target: BubbleTarget;
  readonly until: number;
}

export type BubbleEventKind = 'finished' | 'blocked' | 'ended';

/** A session event waiting in the 1 s aggregation window before it becomes a bubble. */
export interface BubbleEvent {
  readonly kind: BubbleEventKind;
  readonly ptyId: string;
  readonly name: string;
  /** Only meaningful for `blocked`; `null` = type unknown (no chat), rendered as "quer permissão". */
  readonly blockedKind: BlockedKind | null;
  readonly at: number;
}

export interface PetState {
  readonly sessions: ReadonlyMap<string, TrackedSession>;
  /**
   * Last focus signal. A pure reducer has to carry it between inputs: "seen now" depends on it
   * (`donelFocused && activePtyId === ptyId`).
   */
  readonly focus: FocusSignal;
  readonly bubble: Bubble | null;
  /** Id of the last bubble born (`Bubble.id` grows from it). */
  readonly lastBubbleId: number;
  readonly pendingBurst: readonly BubbleEvent[];
  readonly laughUntil: number | null;
  readonly sereneSince: number | null;
  readonly waffleShown: boolean;
  readonly waffleUntil: number | null;
  /** In memory only: silence does not survive a restart (Q3). */
  readonly silencedUntil: number | null;
}

// ---------------------------------------------------------------------------
// View delivered to the pet window
// ---------------------------------------------------------------------------

export interface PetViewBubble {
  readonly id: number;
  readonly text: string;
  readonly pose: PoseName;
  readonly target: BubbleTarget;
}

export interface PetViewWaiting {
  readonly ptyId: string;
  readonly name: string;
  /** `agora`, `há 1 min`, `há 12 min`, `há 2 h`. */
  readonly waitingLabel: string;
}

/** What the screen shows and nothing else: no conversation content ever travels here (FR-018). */
export interface PetView {
  readonly pose: PoseName;
  /** `null`, `'1'`...`'9'` or `'9+'`. */
  readonly badge: string | null;
  readonly bubble: PetViewBubble | null;
  /** Sessions waiting for the owner, the oldest first. */
  readonly waiting: readonly PetViewWaiting[];
  /** Sitting on the taskbar edge (the base of the art does not fade). */
  readonly docked: boolean;
  readonly align: PetAlign;
  readonly silenced: boolean;
  /** Height of the drawing in DIP (FR-033). */
  readonly size: number;
}

/** The window-side facts that complete a view: size, docking and alignment come from placement. */
export interface PetUi {
  readonly size: number;
  readonly docked: boolean;
  readonly align: PetAlign;
}
