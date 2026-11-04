// Item 18 (PDA mindscape-openrig) — the conversation with the Jobu as Líder, in a comic bubble that comes out of the
// Jobu on the desktop (the pet window). The Líder is an ordinary session of the app (a tab with the role `lider`) of
// the current project. The main window knows the tabs, so it REPORTS which one is the Líder; the pet window reads that
// conversation through the chat of the 014 (the hub broadcasts to every window) and SENDS through the main window,
// which owns the hidden terminal and the send machine of the tab. Channel names, payloads and validators.

export const LIDER_CHANNELS = {
  // Main window -> main
  report: 'lider:report',
  /** Answer of the main window to a `lider:deliver` (by request id). */
  delivered: 'lider:delivered',
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

/** What the main window says about the Líder of the current project. */
export interface LiderReport {
  /** The project of the Líder: the selected one, else the one of the active tab, else the last one used; `null` = none. */
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

/** What the bubble shows: the report as the main window last sent it. */
export type LiderState = LiderReport;

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

/** `window.donel.lider` — each window uses its half. */
export interface DonelLiderApi {
  // --- main window ---
  report(report: LiderReport): void;
  onDeliver(listener: (payload: LiderSendPayload, reply: (result: LiderSendResult) => void) => void): () => void;
  onActivateTab(listener: (payload: { readonly tabId: string }) => void): () => void;
  // --- pet window (the bubble) ---
  getState(): Promise<LiderState>;
  onState(listener: (state: LiderState) => void): () => void;
  send(payload: LiderSendPayload): Promise<LiderSendResult>;
  /** Brings the Donel to the front on the Líder's tab. */
  showTab(): void;
}
