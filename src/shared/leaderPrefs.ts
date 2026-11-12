// Líder único na VPS (owner, 07/11: "Delega tudo pra RAM da VPS", the Líder too) — where the Jobu runs the Líder
// único, and where a Líder place of a board opens: this computer or a remote place (`accounts.remotes`). A move
// carries the conversation (`-r` with the same id), so changing it never starts the Líder over.
// docs/planos/lider-na-vps.md, docs/planos/orquestradora-na-vps.md.
//
// A TOP-LEVEL key of config.json (`leader`), like `pet`: a channel without it keeps it in `unknownFields`.

import type { SemaphoreState } from './index';
import { leaderHome } from './mindscape/leader';

export interface LeaderPrefs {
  /**
   * `'auto'` = the first remote place that holds an account (this computer when there is none) — the default since
   * 08/11 ("a orquestradora na VPS, o PC só com o app"); `'local'` = this computer; otherwise the id of a remote place.
   */
  readonly where: string;
  /** The owner picked `where` in Preferences. Without it a stored `'local'` is the old default, not a choice. */
  readonly chosen?: true;
  /**
   * The folder the Líder único opens in (owner, 11/11: its own project, `…\seazone\_orquestradora`, with a lean
   * settings). Set by hand in config.json; without it, the folder that holds the boards' projects (`leaderHome`).
   */
  readonly home?: string;
}

export const DEFAULT_LEADER_PREFS: LeaderPrefs = { where: 'auto' };

export function sanitizeLeaderPrefs(value: unknown, fallback: LeaderPrefs = DEFAULT_LEADER_PREFS): LeaderPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const { where, chosen, home } = value as Record<string, unknown>;
  const valid = typeof where === 'string' && where.trim() !== '' && where.length <= 200 ? where : fallback.where;
  const keptHome = typeof home === 'string' && home.trim() !== '' && home.length <= 1000 ? { home: home.trim() } : {};
  if (chosen === true) return { where: valid, chosen: true, ...keptHome };
  // The first version (#296) wrote its default, 'local', on the first write of the config: that was never a choice.
  return { where: valid === 'local' ? 'auto' : valid, ...keptHome };
}

/** The orchestrator's own project, inside the folder that holds the boards' projects (owner, 12/11). */
export const LEADER_HOME_FOLDER = '_orquestradora';

function folderKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** The same folder, whatever the case, the slash (`/` or `\`) or a trailing slash. Two absent folders are the same. */
export function sameFolder(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return folderKey(a) === folderKey(b);
}

/**
 * Where the Líder único opens: `leader.home` when the owner set it; else the orchestrator's project
 * (`<boards' parent>/_orquestradora`) when it exists on disk (`existingLeaderHomes`, from the main process); else the
 * folder that holds the boards' projects.
 */
export function leaderCwd(prefs: LeaderPrefs, projectPaths: readonly string[], existingLeaderHomes: readonly string[] = []): string | undefined {
  if (prefs.home) return prefs.home;
  const base = leaderHome(projectPaths);
  if (base === undefined) return undefined;
  const sep = base.includes('\\') ? '\\' : '/';
  const orchestrator = `${base.replace(/[\\/]+$/, '')}${sep}${LEADER_HOME_FOLDER}`;
  return existingLeaderHomes.some((home) => sameFolder(home, orchestrator)) ? orchestrator : base;
}

/** A remote place as the Líder's placement sees it. */
export interface LeaderPlace {
  readonly id: string;
  /** It holds an active account (a session can start there). */
  readonly hasAccount: boolean;
}

/** The remote place the Líder runs on, or `undefined` for this computer (also when the chosen place was removed). */
export function leaderRemoteId(prefs: LeaderPrefs, remotes: readonly LeaderPlace[]): string | undefined {
  if (prefs.where === 'local') return undefined;
  if (prefs.where === 'auto') return remotes.find((place) => place.hasAccount)?.id;
  return remotes.some((place) => place.id === prefs.where) ? prefs.where : undefined;
}

/** The live Líder goes to the chosen place now: it runs elsewhere and is stopped (never in the middle of a turn). */
export function leaderMoves(live: { readonly remoteId: string | undefined; readonly state: SemaphoreState | undefined }, wanted: string | undefined): boolean {
  if (live.remoteId === wanted) return false;
  return leaderStopped(live.state);
}

/** Stopped (waiting, done or failed): never in the middle of a turn nor asking permission. */
export function leaderStopped(state: SemaphoreState | undefined): boolean {
  return state === 'waiting' || state === 'done' || state === 'error';
}
