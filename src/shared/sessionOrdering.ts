import type { SessionState } from '@donel-dev/design-system';

// T007 — ordenação da lista de SESSÕES na sidebar (ui-spec §2/§3, título da
// task "sessões fixadas"). Módulo puro e testável: o estado do semáforo
// sempre vence (permissão > falha/quota > aguardando > trabalhando >
// encerrada); pin só desempata DENTRO do mesmo estado. T009 (semáforo real)
// passa a alimentar `state` com valores de verdade — até lá o chamador usa um
// placeholder ('working') pra toda sessão viva.

const STATE_RANK: Record<SessionState, number> = {
  permission: 0,
  error: 1,
  waiting: 2,
  working: 3,
  done: 4,
};

export interface OrderableSession {
  readonly id: string;
  readonly state: SessionState;
  readonly pinned: boolean;
}

/** Ordena sessões pelo semáforo primeiro; pin desempata dentro do mesmo estado. */
export function sortSessions<T extends OrderableSession>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => {
    const rankDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rankDiff !== 0) return rankDiff;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return 0;
  });
}
