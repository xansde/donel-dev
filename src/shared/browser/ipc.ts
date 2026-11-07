// Navegador interno — IPC contract between the main (owner of the `WebContentsView`s) and the renderer
// (owner of the panel's layout). Same `'<domain>:<action>'` naming as the other domains.
//
// One browser per PTY: the key everywhere is the `ptyId` of the session tab, the same id that names the MCP
// token of that session (docs/design/navegador-interno.md).

import type { DomainMode } from './guardrails';

export const BROWSER_CHANNELS = {
  /** invoke(ptyId) -> `BrowserPanelState`. Creates the view if there is none yet. */
  open: 'browser:open',
  /** invoke(ptyId) -> `BrowserPanelState | null` (null = no view for this PTY). */
  get: 'browser:get',
  /** send(ptyId, rect | null). `null` hides the view (tab hidden, panel closed or covered by a menu). */
  setBounds: 'browser:setBounds',
  /** invoke(ptyId, typed) -> `BrowserNavigateResult`. */
  navigate: 'browser:navigate',
  /** send(ptyId, action). */
  history: 'browser:history',
  /** invoke(ptyId) -> data URL (JPEG) of the page, or null. Shown in place of the view while it is covered. */
  snapshot: 'browser:snapshot',
  /** main -> renderer: `BrowserPanelState` every time the page changes. */
  state: 'browser:state',
  /** main -> renderer: the browser of this PTY wants to be seen (`BrowserOpenRequest`). */
  openRequest: 'browser:openRequest',
  /** invoke(ptyId) -> generation (number) or null. The owner's "Assumir" (D11). */
  takeOver: 'browser:takeOver',
  /** send(ptyId, generation). The owner's "Devolver"; ignored unless `generation` is the current one. */
  handBack: 'browser:handBack',
  /** invoke(ptyId) -> `BrowserControlState | null`. */
  getControl: 'browser:getControl',
  /** main -> renderer: `BrowserControlState` every time the owner changes. */
  control: 'browser:control',
  /** main -> renderer: one `BrowserLogEntry` (D13). */
  log: 'browser:log',
  /** send(ptyId, action, tabId). The panel's tab strip (V2). */
  tab: 'browser:tab',
  /** invoke(ptyId) -> `BrowserAgentRules | null`. */
  getRules: 'browser:getRules',
  /** invoke(ptyId) -> `BrowserRulesResult`. Native folder picker: the owner adds an upload folder (V2). */
  chooseUploadDir: 'browser:chooseUploadDir',
  /** send(ptyId, folder). The owner takes one upload folder back (his list and every board that had it liberated). */
  removeUploadDir: 'browser:removeUploadDir',
  /** invoke(ptyId, mode, typedDomains) -> `BrowserRulesResult`. The vigia de domínio of this session (V2). */
  setDomains: 'browser:setDomains',
  /** main -> renderer: `BrowserAgentRules` every time they change. */
  rules: 'browser:rules',
  /** main -> renderer: `BrowserOpenRequest` — F11 pressed with the focus on the page (navegador em tela cheia). */
  fullscreenKey: 'browser:fullscreenKey',
} as const;

export interface BrowserRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type BrowserHistoryAction = 'back' | 'forward' | 'reload' | 'stop';

export interface BrowserTabInfo {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

export type BrowserTabAction = 'switch' | 'close';

/**
 * What the owner allows the agent in the browser of one session. The upload folders are the app's (every session,
 * saved in the config); the domains die with the session.
 */
export interface BrowserAgentRules {
  readonly ptyId: string;
  /** The folders the owner authorized himself (every session). The chat attachments always go, without being here. */
  readonly uploadDirs: readonly string[];
  /** The folders the orchestrators liberated, per board, with who and when (`navegador_liberar_pasta`). */
  readonly uploadGrants: readonly { readonly folder: string; readonly board: string; readonly by: string; readonly at: string }[];
  /** Where the agent may navigate. */
  readonly domainMode: DomainMode;
  readonly domains: readonly string[];
}

/** `reason: null` = the owner cancelled the picker. */
export type BrowserRulesResult = { readonly ok: true; readonly rules: BrowserAgentRules } | { readonly ok: false; readonly reason: string | null };

export interface BrowserPanelState {
  readonly ptyId: string;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly tabs: readonly BrowserTabInfo[];
}

export type BrowserNavigateResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

export interface BrowserOpenRequest {
  readonly ptyId: string;
}

/** Who drives the browser of a PTY (shared/browser/control.ts), as the panel shows it. */
export interface BrowserControlState {
  readonly ptyId: string;
  readonly owner: 'agent' | 'human';
  readonly generation: number;
  /** Why the agent asked for the owner; `null` when the owner took over himself. */
  readonly reason: string | null;
  readonly requestedByAgent: boolean;
}

/** One line of the panel's footer (D13): what the agent did in the browser. */
export interface BrowserLogEntry {
  readonly ptyId: string;
  readonly at: number;
  readonly text: string;
}

/** Footer line of a page the agent opened. The app's UI names "the agent", never one AI (LLM agnóstico). */
export function agentOpenedLine(url: string): string {
  return `Agente abriu: ${url}`;
}

/** Footer line (and panel banner) of `navegador_pedir_humano`. */
export function agentAskedHelpLine(reason: string): string {
  return `O agente pediu sua ajuda: ${reason}`;
}

/** API exposed by the preload in `window.donel.browser`. Each `onX` has ONE subscriber (the renderer's browser store). */
export interface DonelBrowserApi {
  open(ptyId: string): Promise<BrowserPanelState>;
  get(ptyId: string): Promise<BrowserPanelState | null>;
  setBounds(ptyId: string, rect: BrowserRect | null): void;
  navigate(ptyId: string, typed: string): Promise<BrowserNavigateResult>;
  history(ptyId: string, action: BrowserHistoryAction): void;
  snapshot(ptyId: string): Promise<string | null>;
  onState(listener: (state: BrowserPanelState) => void): () => void;
  onOpenRequest(listener: (request: BrowserOpenRequest) => void): () => void;
  /** "Assumir": the owner drives; returns the generation his "Devolver" must carry (null = no browser). */
  takeOver(ptyId: string): Promise<number | null>;
  /** "Devolver ao agente". */
  handBack(ptyId: string, generation: number): void;
  getControl(ptyId: string): Promise<BrowserControlState | null>;
  onControl(listener: (state: BrowserControlState) => void): () => void;
  onLog(listener: (entry: BrowserLogEntry) => void): () => void;
  tab(ptyId: string, action: BrowserTabAction, tabId: number): void;
  getRules(ptyId: string): Promise<BrowserAgentRules | null>;
  chooseUploadDir(ptyId: string): Promise<BrowserRulesResult>;
  removeUploadDir(ptyId: string, folder: string): void;
  setDomains(ptyId: string, mode: DomainMode, typed: string): Promise<BrowserRulesResult>;
  onRules(listener: (rules: BrowserAgentRules) => void): () => void;
  /** F11 pressed on the page of this PTY's browser (shared/browser/fullscreen.ts). */
  onFullscreenKey(listener: (request: BrowserOpenRequest) => void): () => void;
}

/** Validates a rect that came over IPC (finite, non-negative size). */
export function parseBrowserRect(value: unknown): BrowserRect | null {
  if (value === null || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const nums = [x, y, width, height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}
