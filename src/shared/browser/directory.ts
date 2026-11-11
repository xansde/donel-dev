// Navegador do Líder (t-31e2b949) — the list of every session's browser that the Líder's tab shows, so the owner
// reaches any of them from there (see, type, click), and the routing of a help request (`navegador_pedir_humano`)
// to the Líder's tab. Pure: the renderer feeds it with its tabs and the browser states the main broadcasts.
//
// Why: a session opened by another one (`sessao_abrir`) stays out of the tab bar, so its browser panel opens in a
// tab the owner never sees. On 10/11 the Dev G5 asked twice for the GitHub login and nobody found the page.

import type { BrowserControlState, BrowserPanelState } from './ipc';

/** What the renderer knows about the session of one PTY. */
export interface BrowserDirectorySession {
  readonly ptyId: string;
  readonly name: string;
  /** The board (project) of the session. */
  readonly board: string | null;
  /** Where its CLI runs: this computer or a remote place. */
  readonly place: string | null;
}

export interface BrowserDirectoryEntry {
  readonly ptyId: string;
  readonly name: string;
  readonly board: string | null;
  readonly place: string | null;
  readonly url: string;
  readonly title: string;
  /** The agent's reason while it waits for the owner's hand; `null` otherwise. */
  readonly help: string | null;
  /** The owner holds the browser now (after an Assumir or a help request). */
  readonly ownerDriving: boolean;
}

export interface BrowserDirectoryInput {
  /** The Líder's own browser stays out of the list: it is the panel's "Meu navegador". */
  readonly leaderPtyId: string | null;
  readonly sessions: readonly BrowserDirectorySession[];
  /** Pages of the browsers that exist (one per PTY). */
  readonly states: readonly BrowserPanelState[];
  readonly controls: readonly BrowserControlState[];
}

/** Every browser except the Líder's own: those waiting for the owner first, then by session name. */
export function buildBrowserDirectory(input: BrowserDirectoryInput): BrowserDirectoryEntry[] {
  const sessions = new Map(input.sessions.map((session) => [session.ptyId, session]));
  const states = new Map(input.states.map((state) => [state.ptyId, state]));
  const controls = new Map(input.controls.map((control) => [control.ptyId, control]));
  const ptyIds = new Set<string>([...states.keys()]);
  for (const control of input.controls) if (helpOf(control) !== null) ptyIds.add(control.ptyId);
  if (input.leaderPtyId) ptyIds.delete(input.leaderPtyId);

  const entries = [...ptyIds].map((ptyId): BrowserDirectoryEntry => {
    const session = sessions.get(ptyId);
    const state = states.get(ptyId);
    const control = controls.get(ptyId);
    const url = state && state.url !== 'about:blank' ? state.url : '';
    return {
      ptyId,
      name: session?.name ?? 'Sessão sem aba',
      board: session?.board ?? null,
      place: session?.place ?? null,
      url,
      title: state?.title ?? '',
      help: control ? helpOf(control) : null,
      ownerDriving: control?.owner === 'human',
    };
  });
  return entries.sort((a, b) => Number(b.help !== null) - Number(a.help !== null) || a.name.localeCompare(b.name, 'pt-BR'));
}

function helpOf(control: BrowserControlState): string | null {
  return control.owner === 'human' && control.requestedByAgent ? (control.reason ?? 'sem motivo') : null;
}

/** A help request from another session puts its browser on the Líder's panel; the Líder's own needs nothing. */
export function leaderTargetForRequest(leaderPtyId: string | null, requestPtyId: string): string | null {
  return leaderPtyId !== null && requestPtyId !== leaderPtyId ? requestPtyId : null;
}
