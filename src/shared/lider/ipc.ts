// Item 18 (PDA mindscape-openrig) — the conversation with the Jobu as Líder, in its own floating window.
// The Líder is an ordinary session of the app (a tab with the role `lider`) of the selected project. The main
// window knows the tabs, so it REPORTS which one is the Líder; the floating window reads that conversation
// through the chat of the 014 (the hub broadcasts to every window) and SENDS through the main window, which owns
// the hidden terminal and the send machine of the tab. Channel names, payloads, validators and the window prefs.

export const LIDER_CHANNELS = {
  // Main window -> main
  report: 'lider:report',
  /** Answer of the main window to a `lider:deliver` (by request id). */
  delivered: 'lider:delivered',
  // Main -> main window
  deliver: 'lider:deliver',
  // Floating window -> main
  getState: 'lider:get-state',
  send: 'lider:send',
  setOnTop: 'lider:set-on-top',
  showTab: 'lider:show-tab',
  // Main -> main window: activate the tab of the Líder (the window was brought to the front).
  activateTab: 'lider:activate-tab',
  // Main -> floating window
  state: 'lider:state',
} as const;

/** Id of the ready role of the Líder (created with the session tools of the MCP `donel`). */
export const LIDER_ROLE_ID = 'lider';

/** What the main window says about the Líder of the selected project. */
export interface LiderReport {
  /** Selected project; `null` = none (the window asks to pick one). */
  readonly projectPath: string | null;
  readonly projectName: string | null;
  /** The live tab of the Líder in that project, if any. */
  readonly tabId: string | null;
  readonly ptyId: string | null;
  /** The name the tab shows. */
  readonly name: string | null;
  /** The ready role `lider` exists on this machine. */
  readonly roleAvailable: boolean;
}

/** What the floating window shows: the report plus the window's own prefs. */
export interface LiderState extends LiderReport {
  readonly alwaysOnTop: boolean;
}

/** `lider:send` / `lider:deliver`: a message to the Líder. */
export interface LiderSendPayload {
  readonly text: string;
}

export type LiderSendResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const EMPTY_LIDER_REPORT: LiderReport = { projectPath: null, projectName: null, tabId: null, ptyId: null, name: null, roleAvailable: false };

const MAX_TEXT = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 4096);
}

export function isValidLiderReport(value: unknown): value is LiderReport {
  if (!isRecord(value)) return false;
  return (
    isNullableString(value.projectPath) &&
    isNullableString(value.projectName) &&
    isNullableString(value.tabId) &&
    isNullableString(value.ptyId) &&
    isNullableString(value.name) &&
    typeof value.roleAvailable === 'boolean'
  );
}

export function isValidLiderSendPayload(value: unknown): value is LiderSendPayload {
  return isRecord(value) && typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= MAX_TEXT;
}

// ---------------------------------------------------------------------------
// Prefs of the window — config.json, top-level key `liderWindow` (like `pet`: a channel without it keeps it
// in `unknownFields` and writes it back intact; userData is shared between the channels).
// ---------------------------------------------------------------------------

export interface LiderWindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LiderWindowPrefs {
  /** Last place and size; `null` = never opened (born next to the Jobu or centered). */
  readonly bounds: LiderWindowBounds | null;
  readonly alwaysOnTop: boolean;
}

export const LIDER_WINDOW_MIN = { width: 320, height: 280 } as const;
export const LIDER_WINDOW_DEFAULT = { width: 440, height: 600 } as const;

export function defaultLiderWindowPrefs(): LiderWindowPrefs {
  return { bounds: null, alwaysOnTop: false };
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1_000_000;
}

/** Tolerant: whatever is wrong falls back field by field; a size below the minimum grows to it. */
export function sanitizeLiderWindowPrefs(value: unknown, fallback: LiderWindowPrefs = defaultLiderWindowPrefs()): LiderWindowPrefs {
  if (!isRecord(value)) return fallback;
  const alwaysOnTop = typeof value.alwaysOnTop === 'boolean' ? value.alwaysOnTop : fallback.alwaysOnTop;
  const raw = value.bounds;
  let bounds: LiderWindowBounds | null = null;
  if (isRecord(raw) && isFiniteInt(raw.x) && isFiniteInt(raw.y) && isFiniteInt(raw.width) && isFiniteInt(raw.height)) {
    bounds = {
      x: Math.round(raw.x),
      y: Math.round(raw.y),
      width: Math.max(LIDER_WINDOW_MIN.width, Math.round(raw.width)),
      height: Math.max(LIDER_WINDOW_MIN.height, Math.round(raw.height)),
    };
  }
  return { bounds, alwaysOnTop };
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pure — the window back on a screen. Kept as is while enough of it (its title strip) shows on some work area;
 * otherwise moved into the work area it overlaps most (or the first one), shrunk to fit.
 */
export function fitOnScreens(bounds: Rect, workAreas: readonly Rect[]): Rect {
  if (workAreas.length === 0) return bounds;
  const overlap = (area: Rect): number => {
    const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const h = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  // The title strip (top 40 px, at least 120 px wide) must be on a screen, or the owner cannot grab the window.
  const strip: Rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: 40 };
  const stripVisible = workAreas.some((area) => {
    const w = Math.min(strip.x + strip.width, area.x + area.width) - Math.max(strip.x, area.x);
    return w >= Math.min(120, bounds.width) && strip.y >= area.y && strip.y + 20 <= area.y + area.height;
  });
  if (stripVisible) return bounds;
  let best = workAreas[0];
  for (const area of workAreas) if (overlap(area) > overlap(best)) best = area;
  const width = Math.min(bounds.width, best.width);
  const height = Math.min(bounds.height, best.height);
  const x = Math.min(Math.max(bounds.x, best.x), best.x + best.width - width);
  const y = Math.min(Math.max(bounds.y, best.y), best.y + best.height - height);
  return { x, y, width, height };
}

/** `window.donel.lider` — each window uses its half. */
export interface DonelLiderApi {
  // --- main window ---
  report(report: LiderReport): void;
  onDeliver(listener: (payload: LiderSendPayload, reply: (result: LiderSendResult) => void) => void): () => void;
  onActivateTab(listener: (payload: { readonly tabId: string }) => void): () => void;
  // --- floating window ---
  getState(): Promise<LiderState>;
  onState(listener: (state: LiderState) => void): () => void;
  send(payload: LiderSendPayload): Promise<LiderSendResult>;
  setOnTop(onTop: boolean): void;
  /** Brings the Donel to the front on the Líder's tab. */
  showTab(): void;
}
