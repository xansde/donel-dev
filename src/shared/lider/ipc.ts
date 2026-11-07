// Item 18 (PDA mindscape-openrig) — the conversation with the Jobu as Líder, in a comic bubble that comes out of the
// Jobu on the desktop (the pet window). The Líder is ONE session of the app for every board (ADR 0007): a tab with the
// role `lider` and no project. The main window knows the tabs, so it REPORTS which one is the Líder; the pet window reads that
// conversation through the chat of the 014 (the hub broadcasts to every window) and SENDS through the main window,
// which owns the hidden terminal and the send machine of the tab. Channel names, payloads and validators.

export const LIDER_CHANNELS = {
  // Main window -> main
  report: 'lider:report',
  /** Answer of the main window to a `lider:deliver` (by request id). */
  delivered: 'lider:delivered',
  /** Main window -> main: copy the Líder's conversation to the place it moves to, checked there (Líder na VPS). */
  carry: 'lider:carry',
  // Main -> main window
  deliver: 'lider:deliver',
  // Pet window (the bubble of the Líder) -> main
  getState: 'lider:get-state',
  send: 'lider:send',
  showTab: 'lider:show-tab',
  // Main -> main window: activate the tab of the Líder (the window was brought to the front).
  activateTab: 'lider:activate-tab',
  // Main -> pet window
  state: 'lider:state',
} as const;

/** Id of the ready role of the Líder (the ready role of src/shared/roles.ts). */
export { LEADER_ROLE_ID as LIDER_ROLE_ID } from '../roles';

/** What the main window says about the Líder único. */
export interface LiderReport {
  /** The live tab of the Líder, if any. */
  readonly tabId: string | null;
  readonly ptyId: string | null;
  /** The name the tab shows. */
  readonly name: string | null;
  /** The ready role `lider` exists on this machine. */
  readonly roleAvailable: boolean;
}

/** What the bubble shows: the report as the main window last sent it. */
export type LiderState = LiderReport;

/** `lider:send` / `lider:deliver`: a message to the Líder. */
export interface LiderSendPayload {
  readonly text: string;
}

export type LiderSendResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** `lider:carry` — the conversation `sessionId` of the folder `cwd`, from a place to another (`undefined` = this computer). */
export interface LiderCarryPayload {
  readonly sessionId: string;
  readonly cwd: string;
  readonly from?: string;
  readonly to?: string;
}

export const EMPTY_LIDER_REPORT: LiderReport = { tabId: null, ptyId: null, name: null, roleAvailable: false };

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
    isNullableString(value.tabId) &&
    isNullableString(value.ptyId) &&
    isNullableString(value.name) &&
    typeof value.roleAvailable === 'boolean'
  );
}

export function isValidLiderSendPayload(value: unknown): value is LiderSendPayload {
  return isRecord(value) && typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= MAX_TEXT;
}

export function isValidLiderCarryPayload(value: unknown): value is LiderCarryPayload {
  if (!isRecord(value)) return false;
  const optionalId = (field: unknown): boolean => field === undefined || (typeof field === 'string' && field.length > 0 && field.length <= 200);
  return (
    typeof value.sessionId === 'string' &&
    /^[A-Za-z0-9-]{1,64}$/.test(value.sessionId) &&
    typeof value.cwd === 'string' &&
    value.cwd.length > 0 &&
    value.cwd.length <= 4096 &&
    optionalId(value.from) &&
    optionalId(value.to)
  );
}

/** `window.donel.lider` — each window uses its half. */
export interface DonelLiderApi {
  // --- main window ---
  report(report: LiderReport): void;
  onDeliver(listener: (payload: LiderSendPayload, reply: (result: LiderSendResult) => void) => void): () => void;
  onActivateTab(listener: (payload: { readonly tabId: string }) => void): () => void;
  /** Líder na VPS — copies the conversation to the place the Líder moves to; `ok` only when it checked out there. */
  carry(payload: LiderCarryPayload): Promise<LiderSendResult>;
  // --- pet window (the bubble) ---
  getState(): Promise<LiderState>;
  onState(listener: (state: LiderState) => void): () => void;
  send(payload: LiderSendPayload): Promise<LiderSendResult>;
  /** Brings the Donel to the front on the Líder's tab. */
  showTab(): void;
}
