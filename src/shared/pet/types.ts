// 015 (Jobu pet) - types of the pure core. Everything here is serializable and free of
// Electron/React, so main, preload, renderer and vitest all import the same shapes.
// Data model: specs/015-jobu-pet/data-model.md. The reducer (petState.ts) and the view projection
// (petView.ts) are here since US1; the bubble texts and aggregation (bubble.ts) since US2. The shapes
// they work on are fixed in this file.

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

/** The 16 logical poses (FR-010, FR-016, FR-029; `sweeping` from 016-jobu-faxina). `poses.ts` resolves each one to an art file. */
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
  'sweeping',
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
  /**
   * notificacoes-completas: the short reason of a turn that ended in an API error (`StopFailure`), while the session
   * waits after it; absent/`null` = a normal end. A wait born with it is a `failed` event instead of `finished`.
   */
  readonly failure?: string | null;
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

/**
 * An app took the whole screen, or gave it back (the watcher of US5, T050). No bubble is born while it
 * lasts, and the one that is up goes (Q9): the Jobu is hidden then, and a bubble must not be waiting for
 * him when he comes back.
 */
export interface FullscreenEvent {
  readonly type: 'fullscreen';
  readonly active: boolean;
}

/** The owner clicked the bubble (or the Jobu, or an item of the list): the bubble has served and goes away at once. */
export interface BubbleDismissedEvent {
  readonly type: 'bubbleDismissed';
}

/** The 1 s clock of the main. The instant itself is the `now` argument of `reducePet`. */
export interface TickEvent {
  readonly type: 'tick';
}

/**
 * What the bubble of the sweep (016-jobu-faxina) is made of: the totals, never a name or a path of a file.
 * `folder` is the folder of the sweep when it was created (something was set aside or a branch was deleted).
 */
export interface SweepBubbleSummary {
  readonly failed: boolean;
  readonly freedBytes: number;
  readonly separatedItems: number;
  readonly branchesDeleted: number;
  readonly worktreesRemoved: number;
  readonly folder: string | null;
}

/** The sweep the owner asked for (menu "Fazer faxina") ended: its result is a bubble of its own, even when the notices are silenced. */
export interface SweepFinishedEvent {
  readonly type: 'sweepFinished';
  readonly summary: SweepBubbleSummary;
  readonly at: number;
}

/** The sweep the owner asked for (menu "Fazer faxina") began: the Jobu shows the `sweeping` pose until `sweepFinished`. */
export interface SweepStartedEvent {
  readonly type: 'sweepStarted';
  readonly at: number;
}

export type PetEvent =
  | SweepStartedEvent
  | AccountSwitchedEvent
  | SweepFinishedEvent
  | SessionExitedEvent
  | PendingOpenedEvent
  | SilenceEvent
  | FullscreenEvent
  | BubbleDismissedEvent
  | TickEvent;

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

/** Everything `reducePet` takes. */
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
  | { readonly kind: 'donel' }
  /** 016: the folder of a sweep, opened in the Explorer. The main opens the one of ITS bubble, never a path the window sends. */
  | { readonly kind: 'folder'; readonly path: string };

export interface Bubble {
  /** Grows with every new bubble; the screen keys the little hop on it. */
  readonly id: number;
  readonly text: string;
  readonly pose: PoseName;
  readonly target: BubbleTarget;
  readonly until: number;
}

/** `failed` (notificacoes-completas): the turn ended in an API error (`StopFailure`: usage limit, overload, login). */
export type BubbleEventKind = 'finished' | 'blocked' | 'failed' | 'ended';

/** A session event waiting in the 1 s aggregation window before it becomes a bubble. */
export interface BubbleEvent {
  readonly kind: BubbleEventKind;
  readonly ptyId: string;
  readonly name: string;
  /** Only meaningful for `blocked`; `null` = type unknown (no chat), rendered as "quer permissão". */
  readonly blockedKind: BlockedKind | null;
  /** Only meaningful for `failed`: the short reason (`failureReasonText`, src/shared/attention/rule.ts). */
  readonly reason?: string | null;
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
  /**
   * The session events behind the bubble in view, one per session (the latest wins). Events that arrive
   * within the first second of the bubble join it, and this is what its aggregate text is made from; it is
   * also what tells that the bubble stopped making sense. Empty when there is no bubble, and for a bubble
   * that is not about sessions (the account one, US4).
   */
  readonly pendingBurst: readonly BubbleEvent[];
  readonly laughUntil: number | null;
  /** A sweep is running (016): drives the `sweeping` pose. Set by `sweepStarted`, cleared by `sweepFinished`. */
  readonly sweeping: boolean;
  readonly sereneSince: number | null;
  readonly waffleShown: boolean;
  readonly waffleUntil: number | null;
  /** In memory only: silence does not survive a restart (Q3). */
  readonly silencedUntil: number | null;
  /** An app has the whole screen: no bubble is born (Q9). Set by the full-screen watcher; `resume` forgets it. */
  readonly fullscreen: boolean;
  /**
   * notificacoes-completas: grows every time an input gives session news, whether or not a bubble could say it
   * (silence and full screen only hold the bubble back). `notices` are the events of that input. The service
   * compares the number before and after a reduction to hand the news to the other channels (toast, flash).
   */
  readonly noticeSeq: number;
  readonly notices: readonly BubbleEvent[];
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
  /** Item 18: how tall the bubble of the conversation with the Líder is, in DIP; `0` = closed. */
  readonly talk: number;
  /** t-29e1327b: how wide that bubble is, in DIP. */
  readonly talkWidth: number;
  /** t-29e1327b: the bubble is at the largest the screen allows (the expand button then shrinks it back). */
  readonly talkExpanded: boolean;
}

/** The window-side facts that complete a view: size, docking and alignment come from placement. */
export interface PetUi {
  readonly size: number;
  readonly docked: boolean;
  readonly align: PetAlign;
  /** Item 18: the height of the open bubble of the Líder; `0` (or absent) = closed. */
  readonly talk?: number;
  /** t-29e1327b: its width; absent = the default. */
  readonly talkWidth?: number;
  readonly talkExpanded?: boolean;
}
