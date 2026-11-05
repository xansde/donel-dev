// Item 20 — the first routine: "sessão parada e ninguém vê" (problem nº 1 of the brown belt, training of 03/11).
// Generator only: reads the live sessions and the boards, returns findings. Never writes.
//
// A finding is a PLACE of a board whose open session is:
// - stopped or without signal for more than N hours (`parada:<placeId>`), or
// - "precisa de você" (permission, question, plan, usage limit, error) for more than M minutes (`dono:<placeId>`).
// The owner place is the Líder of the board. The Líder's own place is never a finding (it would wake itself).

import { LEADER_ROLE_ID } from '../roles';
import type { SemaphoreState } from '../index';
import { placeOfSession, type MindscapeDoc } from '../mindscape/model';
import { deriveSessionAxes } from '../mindscape/sessionAxes';
import type { Finding } from './contract';

export const STALLED_SESSIONS_ROUTINE_ID = 'sessao-parada';

export interface StalledSessionsConfig {
  /** Stopped or without signal for more than this → finding. Default 8. */
  readonly stalledHours: number;
  /** "Precisa de você" for more than this → finding. Default 30. */
  readonly needsOwnerMinutes: number;
}

export const DEFAULT_STALLED_SESSIONS_CONFIG: StalledSessionsConfig = { stalledHours: 8, needsOwnerMinutes: 30 };

/** One open session tab, as the semaphore sees it. */
export interface LiveSessionSignal {
  readonly sessionId: string;
  readonly state: SemaphoreState;
  readonly stateEnteredAt: number;
  readonly unconfirmed?: boolean;
  readonly pendingKinds?: readonly string[];
  readonly turnFailure?: string;
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 120 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`;
}

export function findStalledSessions(doc: MindscapeDoc, live: readonly LiveSessionSignal[], now: number, config: StalledSessionsConfig): Finding[] {
  const findings: Finding[] = [];
  for (const session of live) {
    const board = Object.values(doc.boards).find((candidate) => placeOfSession(candidate, session.sessionId));
    const place = board ? placeOfSession(board, session.sessionId) : undefined;
    if (!board || !place || place.roleId === LEADER_ROLE_ID) continue;
    const axes = deriveSessionAxes({
      tabOpen: true,
      state: session.state,
      unconfirmed: session.unconfirmed,
      pendingKinds: session.pendingKinds,
      turnFailure: session.turnFailure,
    });
    if (axes.process !== 'aberta' && axes.needs.length === 0) continue;
    const age = now - session.stateEnteredAt;
    const base = { projectPath: board.projectPath, placeId: place.id, wake: { roleId: LEADER_ROLE_ID, projectPath: board.projectPath } };
    if (axes.needs.length > 0) {
      if (age > config.needsOwnerMinutes * 60_000) {
        findings.push({ ...base, key: `dono:${place.id}`, summary: `precisa do dono (${axes.needs.join(', ')}) há ${ago(age)}` });
      }
      continue;
    }
    if (axes.activity === 'trabalhando') continue;
    if (age > config.stalledHours * 3_600_000) {
      findings.push({ ...base, key: `parada:${place.id}`, summary: `${axes.activity === 'desconhecido' ? 'sem sinal' : 'parada'} há ${ago(age)}` });
    }
  }
  return findings;
}
