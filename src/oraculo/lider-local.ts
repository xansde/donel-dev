// Etapa 2 do pivô para o celular (t-c3fbe852) — the Líder único alive in this machine's tmux, known without the PC.
// The app marks its session folder when it opens the Líder on a remote place (`~/.donel/s/<sid>/meta.json`,
// `leaderOfAll: true`, src/main/index.ts), and the PC's picture says `liderUnico` in its `sessao_quem_sou`; either one
// counts, but only for a session whose tmux (`tmux -L donel`, `donel-<sid>`) is alive. One function, used by the chat
// of the phone, the recados and notices to the Líder, the phone's requests and the gate.
//
// The session folder holds keys: only the two fields this needs are kept from its meta, nothing else leaves here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardPicture } from './portao';

export interface LocalLeader {
  /** The session folder's id (its tmux is `donel-<sid>`). */
  readonly sid: string;
}

/** The two fields of a session's meta this needs. */
export interface LeaderMeta {
  readonly leaderOfAll?: boolean;
  readonly createdAt?: string;
}

const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The Líder único among `live` (this machine's tmux): marked by the app in its meta, or `liderUnico` in the picture.
 * Two at once (a move half done): the one the picture names, then the newest. `null` = none alive here.
 */
export function pickLocalLeader(live: ReadonlySet<string>, picture: BoardPicture | null, metaOf: (sid: string) => LeaderMeta | null): LocalLeader | null {
  const candidates: Array<{ sid: string; pictured: boolean; at: string }> = [];
  for (const sid of live) {
    const pictured = picture?.sessoes[sid]?.quemSou.liderUnico === true;
    const meta = metaOf(sid);
    if (!pictured && meta?.leaderOfAll !== true) continue;
    candidates.push({ sid, pictured, at: meta?.createdAt ?? '' });
  }
  candidates.sort((a, b) => Number(b.pictured) - Number(a.pictured) || b.at.localeCompare(a.at));
  return candidates[0] ? { sid: candidates[0].sid } : null;
}

/** The mark of a session folder (read by code, never shown): `null` = no folder or unreadable. */
export function readLeaderMeta(sessionsDir: string, sid: string): LeaderMeta | null {
  if (!SID_PATTERN.test(sid)) return null;
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as Record<string, unknown>;
    return { ...(raw.leaderOfAll === true ? { leaderOfAll: true } : {}), ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}) };
  } catch {
    return null;
  }
}

/**
 * The conversation the session's tmux carries now (`current`, written by its SessionStart hook; a `/clear` or a resume
 * moves it on): the Líder that came over with `-r` keeps its old conversation id, not the folder's.
 */
export function currentConversation(sessionsDir: string, sid: string): string | undefined {
  if (!SID_PATTERN.test(sid)) return undefined;
  try {
    const id = readFileSync(join(sessionsDir, sid, 'current'), 'utf8').trim();
    return SID_PATTERN.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function createLocalLeaderFinder(deps: {
  readonly sessionsDir: string;
  readonly liveSessions: () => Promise<ReadonlySet<string>>;
  readonly picture: () => BoardPicture | null;
}): () => Promise<LocalLeader | null> {
  return async () => pickLocalLeader(await deps.liveSessions(), deps.picture(), (sid) => readLeaderMeta(deps.sessionsDir, sid));
}
