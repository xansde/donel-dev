// Líder único na VPS (owner, 07/11: "Delega tudo pra RAM da VPS", the Líder too) — where the Jobu runs the Líder
// único: this computer or a remote place (`accounts.remotes`). A move carries the conversation (`-r` with the same id),
// so changing it never starts the Líder over. docs/planos/lider-na-vps.md.
//
// A TOP-LEVEL key of config.json (`leader`), like `pet`: a channel without it keeps it in `unknownFields`.

import type { SemaphoreState } from './index';

export interface LeaderPrefs {
  /** `'local'` = this computer; otherwise the id of a remote place. */
  readonly where: string;
}

export const DEFAULT_LEADER_PREFS: LeaderPrefs = { where: 'local' };

export function sanitizeLeaderPrefs(value: unknown, fallback: LeaderPrefs = DEFAULT_LEADER_PREFS): LeaderPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const { where } = value as Record<string, unknown>;
  return { where: typeof where === 'string' && where.trim() !== '' && where.length <= 200 ? where : fallback.where };
}

/** The remote place the Líder runs on, or `undefined` for this computer (also when the chosen place was removed). */
export function leaderRemoteId(prefs: LeaderPrefs, remoteIds: readonly string[]): string | undefined {
  return prefs.where !== 'local' && remoteIds.includes(prefs.where) ? prefs.where : undefined;
}

/** The live Líder goes to the chosen place now: it runs elsewhere and is stopped (never in the middle of a turn). */
export function leaderMoves(live: { readonly remoteId: string | undefined; readonly state: SemaphoreState | undefined }, wanted: string | undefined): boolean {
  if (live.remoteId === wanted) return false;
  return live.state === 'waiting' || live.state === 'done' || live.state === 'error';
}
