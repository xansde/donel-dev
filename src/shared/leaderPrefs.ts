// Líder único na VPS (owner, 07/11: "Delega tudo pra RAM da VPS", the Líder too) — where the Jobu runs the Líder
// único, and where a Líder place of a board opens: this computer or a remote place (`accounts.remotes`). A move
// carries the conversation (`-r` with the same id), so changing it never starts the Líder over.
// docs/planos/lider-na-vps.md, docs/planos/orquestradora-na-vps.md.
//
// A TOP-LEVEL key of config.json (`leader`), like `pet`: a channel without it keeps it in `unknownFields`.

import type { SemaphoreState } from './index';

export interface LeaderPrefs {
  /**
   * `'auto'` = the first remote place that holds an account (this computer when there is none) — the default since
   * 08/11 ("a orquestradora na VPS, o PC só com o app"); `'local'` = this computer; otherwise the id of a remote place.
   */
  readonly where: string;
  /** The owner picked `where` in Preferences. Without it a stored `'local'` is the old default, not a choice. */
  readonly chosen?: true;
}

export const DEFAULT_LEADER_PREFS: LeaderPrefs = { where: 'auto' };

export function sanitizeLeaderPrefs(value: unknown, fallback: LeaderPrefs = DEFAULT_LEADER_PREFS): LeaderPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const { where, chosen } = value as Record<string, unknown>;
  const valid = typeof where === 'string' && where.trim() !== '' && where.length <= 200 ? where : fallback.where;
  if (chosen === true) return { where: valid, chosen: true };
  // The first version (#296) wrote its default, 'local', on the first write of the config: that was never a choice.
  return { where: valid === 'local' ? 'auto' : valid };
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
  return live.state === 'waiting' || live.state === 'done' || live.state === 'error';
}
