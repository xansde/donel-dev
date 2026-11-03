// Mindscape, lugar principal (docs/refinamentos/mindscape-lugar-principal.md, rules 1–6) — the
// sessions of a board whose tab is closed. They are drawn "dormant" instead of hidden (rule 11 of
// the V1 is revoked for session cards), except the OLD ones: closed for more than 7 days, or with
// no date at all, unless the owner made them a favorite (pinned in the 007 registry).
//
// Pure on purpose: no React, no Electron.

import type { SessionRegistry } from '../sessionRegistry';
import type { MindscapeBoard } from './model';

/** A closed session older than this is "antiga" and folded away (rule 3). */
export const OLD_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export interface DormantSession {
  readonly sessionId: string;
  /** Newest of the note it wrote and the registry's last activity (rule 2); `null` = unknown. */
  readonly lastActivityAt: number | null;
  /** Favorite of the owner (rule 6): `pinned` in the registry. */
  readonly pinned: boolean;
}

export interface BoardSessionsInput {
  readonly board: MindscapeBoard;
  /** Sessions with an open tab: they are live, never dormant nor old. */
  readonly liveSessionIds: ReadonlySet<string>;
  readonly registry: SessionRegistry;
  readonly now: number;
}

export interface BoardSessionsView {
  /** Closed sessions with a session card that are drawn, newest first (unknown date last). */
  readonly dormant: readonly DormantSession[];
  /** Closed sessions folded away with their note (rule 3). */
  readonly oldSessionIds: ReadonlySet<string>;
  /** The old ones that have a session card, newest first: drawn only when the owner unfolds them. */
  readonly old: readonly DormantSession[];
}

function newest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

export function classifyBoardSessions({ board, liveSessionIds, registry, now }: BoardSessionsInput): BoardSessionsView {
  const sessionIds = new Set<string>();
  const withCard = new Set<string>();
  const noteAt = new Map<string, number>();
  for (const card of Object.values(board.cards)) {
    if (card.kind === 'session') {
      sessionIds.add(card.sessionId);
      withCard.add(card.sessionId);
    } else if (card.kind === 'session-note') {
      sessionIds.add(card.sessionId);
      noteAt.set(card.sessionId, card.writtenAt);
    }
  }
  const dormant: DormantSession[] = [];
  const oldSessionIds = new Set<string>();
  const old: DormantSession[] = [];
  for (const sessionId of sessionIds) {
    if (liveSessionIds.has(sessionId)) continue;
    const entry = registry[sessionId];
    const lastActivityAt = newest(noteAt.get(sessionId) ?? null, entry ? entry.lastActivityAt : null);
    const pinned = entry?.pinned === true;
    const isOld = !pinned && (lastActivityAt === null || now - lastActivityAt > OLD_SESSION_MS);
    if (isOld) {
      oldSessionIds.add(sessionId);
      if (withCard.has(sessionId)) old.push({ sessionId, lastActivityAt, pinned });
    } else if (withCard.has(sessionId)) dormant.push({ sessionId, lastActivityAt, pinned });
  }
  const newestFirst = (a: DormantSession, b: DormantSession): number => (b.lastActivityAt ?? -Infinity) - (a.lastActivityAt ?? -Infinity);
  dormant.sort(newestFirst);
  old.sort(newestFirst);
  return { dormant, oldSessionIds, old };
}

export interface DormantNameInput {
  /** The name the tab had (`sessionNames` of the config). */
  readonly stored: string | null | undefined;
  /** The name the note kept when it was written. */
  readonly noteName: string | undefined;
  /** The cached label of the 007 registry. */
  readonly registryLabel: string | undefined;
}

/** Rule 4: tab name, else the note's, else the registry label, else "Sessão". */
export function dormantSessionName({ stored, noteName, registryLabel }: DormantNameInput): string {
  for (const candidate of [stored, noteName, registryLabel]) {
    const name = candidate?.trim();
    if (name) return name;
  }
  return 'Sessão';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Rule 4 — state line of a dormant card: "Fechada · 31/10 13:06" (local time), or "Fechada". */
export function closedLabel(lastActivityAt: number | null): string {
  if (lastActivityAt === null) return 'Fechada';
  const date = new Date(lastActivityAt);
  return `Fechada · ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
