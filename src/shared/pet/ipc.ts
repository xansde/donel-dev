// T005 (015-jobu-pet) - the IPC contract of the pet (specs/015-jobu-pet/contracts/ipc-pet.md):
// channel names, payload types, the validators the main runs before it trusts a payload, and the
// `window.donel.pet` API. Same `'<domain>:<action>'` pattern and `isValid...` guards as the other
// domains. The main also checks WHO sent: `pet:tabs` only from the main window, the gestures only
// from the pet window (src/main/pet/pet-ipc.ts).

import type { PetPrefsInput } from '../config';
import type { PetView } from './types';

export const PET_CHANNELS = {
  // Main window -> main
  tabs: 'pet:tabs',
  // Main -> main window
  activateSession: 'app:activate-session',
  prefsChanged: 'pet:prefs-changed',
  // Main -> pet window
  view: 'pet:view',
  /** The window lost the focus while the list was open: the screen closes it (the page itself never hears about it). */
  closeList: 'pet:close-list',
  // Pet window -> main
  ready: 'pet:ready',
  interactive: 'pet:interactive',
  click: 'pet:click',
  open: 'pet:open',
  listOpen: 'pet:list-open',
  /** Item 18: the bubble of the conversation with the Líder opens or closes. */
  talk: 'pet:talk',
  /** t-29e1327b: the owner resizes the bubble of the Líder (dragging its corner) or toggles it to the largest size. */
  talkResize: 'pet:talk-resize',
  contextMenu: 'pet:context-menu',
  dragStart: 'pet:drag-start',
  dragMove: 'pet:drag-move',
  dragEnd: 'pet:drag-end',
  resizeStep: 'pet:resize-step',
} as const;

export type PetChannel = (typeof PET_CHANNELS)[keyof typeof PET_CHANNELS];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** One `claude` tab with a PTY, as the renderer reports it. Only ptyId and name: nothing of the conversation (FR-018). */
export interface PetTabSession {
  readonly ptyId: string;
  readonly name: string;
}

/** `pet:tabs`: the sessions the pet watches and which one is in front. */
export interface PetTabsPayload {
  readonly activePtyId: string | null;
  readonly sessions: readonly PetTabSession[];
}

/** `pet:interactive`: the pet window asks to receive (or ignore) mouse events. */
export interface PetInteractivePayload {
  readonly interactive: boolean;
}

/** `pet:list-open`: the list opened or closed (the window is focusable only while it is open). */
export interface PetListOpenPayload {
  readonly open: boolean;
}

/** `pet:drag-*`: pointer position in screen coordinates. */
export interface PetDragPayload {
  readonly screenX: number;
  readonly screenY: number;
}

/**
 * `pet:context-menu`: where the owner right-clicked, in screen coordinates, so the menu opens right there
 * (the pointer of the OS is not always where the page thinks it is). Optional: with no payload the menu
 * opens at the pointer.
 */
export type PetContextMenuPayload = PetDragPayload | undefined;

export type PetOpenTarget =
  | { readonly kind: 'session'; readonly ptyId: string }
  | { readonly kind: 'donel' }
  /** 016: the path travels because the type is the bubble's, but the main ignores it and opens the folder of its own bubble. */
  | { readonly kind: 'folder'; readonly path: string };

/** `pet:open`: bring the Donel to the front, on a session when there is one. */
export interface PetOpenPayload {
  readonly target: PetOpenTarget;
}

/** `pet:resize-step`: one notch of Ctrl + wheel. */
export interface PetResizeStepPayload {
  readonly direction: 1 | -1;
}

/** `app:activate-session`: the main window activates the tab whose PTY is `ptyId`. */
export interface PetActivateSessionPayload {
  readonly ptyId: string;
}

/** `pet:prefs-changed`: `pet.enabled` changed in the main (Preferences toggle or "Esconder"). */
export interface PetPrefsChangedPayload {
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Validators (the payload comes from a renderer: never trusted)
// ---------------------------------------------------------------------------

/** A renderer cannot make the main hold an unbounded list. */
export const PET_MAX_SESSIONS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export function isValidPetTabsPayload(input: unknown): input is PetTabsPayload {
  if (!isRecord(input)) return false;
  if (input.activePtyId !== null && !isNonEmptyString(input.activePtyId)) return false;
  const sessions = input.sessions;
  if (!Array.isArray(sessions) || sessions.length > PET_MAX_SESSIONS) return false;
  return sessions.every((session) => isRecord(session) && isNonEmptyString(session.ptyId) && typeof session.name === 'string');
}

export function isValidPetInteractivePayload(input: unknown): input is PetInteractivePayload {
  return isRecord(input) && typeof input.interactive === 'boolean';
}

export function isValidPetListOpenPayload(input: unknown): input is PetListOpenPayload {
  return isRecord(input) && typeof input.open === 'boolean';
}

/** `pet:talk`: the bubble of the Líder opened (`true`) or closed. */
export interface PetTalkPayload {
  readonly open: boolean;
}

export function isValidPetTalkPayload(input: unknown): input is PetTalkPayload {
  return isRecord(input) && typeof input.open === 'boolean';
}

/**
 * t-29e1327b — `set`: the size the corner is dragged to, in DIP (`commit` on the release: then it is saved). `expand`: the
 * button, which takes the bubble to the largest the screen allows, or back to the automatic size when it already is.
 */
export type PetTalkResizePayload =
  | { readonly kind: 'set'; readonly width: number; readonly height: number; readonly commit: boolean }
  | { readonly kind: 'expand' };

export function isValidPetTalkResizePayload(input: unknown): input is PetTalkResizePayload {
  if (!isRecord(input)) return false;
  if (input.kind === 'expand') return true;
  return input.kind === 'set' && Number.isFinite(input.width) && Number.isFinite(input.height) && typeof input.commit === 'boolean';
}

export function isValidPetDragPayload(input: unknown): input is PetDragPayload {
  return isRecord(input) && Number.isFinite(input.screenX) && Number.isFinite(input.screenY);
}

/** No payload at all is valid (the menu opens at the pointer); otherwise it must be finite screen coordinates. */
export function isValidPetContextMenuPayload(input: unknown): input is PetContextMenuPayload {
  return input === undefined || isValidPetDragPayload(input);
}

export function isValidPetOpenPayload(input: unknown): input is PetOpenPayload {
  if (!isRecord(input) || !isRecord(input.target)) return false;
  const target = input.target;
  if (target.kind === 'donel') return true;
  if (target.kind === 'folder') return typeof target.path === 'string' && target.path !== '';
  return target.kind === 'session' && isNonEmptyString(target.ptyId);
}

export function isValidPetResizeStepPayload(input: unknown): input is PetResizeStepPayload {
  return isRecord(input) && (input.direction === 1 || input.direction === -1);
}

/**
 * `config:setPetPrefs`: only `enabled` can come from the renderer. Placement and size are written
 * by the main from the gestures; keys other than `enabled` are never read by the handler.
 */
export function isValidPetPrefsInput(input: unknown): input is PetPrefsInput {
  return isRecord(input) && (input.enabled === undefined || typeof input.enabled === 'boolean');
}

// ---------------------------------------------------------------------------
// window.donel.pet
// ---------------------------------------------------------------------------

/**
 * API exposed by the preload in `window.donel.pet`, in both windows (R18): each one uses only its
 * own half. The `on...` functions return the unsubscribe function.
 */
export interface DonelPetApi {
  // --- Main window side ---
  /** `pet:tabs` (the renderer dedupes by JSON before sending). */
  sendTabs(payload: PetTabsPayload): void;
  onActivateSession(listener: (payload: PetActivateSessionPayload) => void): () => void;
  onPrefsChanged(listener: (payload: PetPrefsChangedPayload) => void): () => void;

  // --- Pet window side ---
  /** The pet screen is subscribed to the view: the main answers with the current one and shows the window. */
  ready(): void;
  onView(listener: (view: PetView) => void): () => void;
  /** The main says the window lost the focus: a list that is open must close (FR-023, a click anywhere else). */
  onCloseList(listener: () => void): () => void;
  /** Only when the value changes: the hit test of the pet screen decides it from the mouse position. */
  setInteractive(interactive: boolean): void;
  click(): void;
  open(target: PetOpenTarget): void;
  setListOpen(open: boolean): void;
  /** Item 18: opens (`true`) or closes the bubble of the conversation with the Líder; the main resizes the window. */
  setTalk(open: boolean): void;
  /** t-29e1327b: resize the bubble of the Líder (see `PetTalkResizePayload`). */
  talkResize(payload: PetTalkResizePayload): void;
  /** The right button: `point` is the click in screen coordinates, so the menu opens there; without it, at the pointer. */
  openContextMenu(point?: PetDragPayload): void;
  /** The pointer went down on the Jobu at (screenX, screenY). The three drag calls carry screen coordinates, in DIP. */
  dragStart(screenX: number, screenY: number): void;
  dragMove(screenX: number, screenY: number): void;
  dragEnd(screenX: number, screenY: number): void;
  resizeStep(direction: 1 | -1): void;
}
