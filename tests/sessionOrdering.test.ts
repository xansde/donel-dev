import { describe, expect, it } from 'vitest';
import { sortSessions, type OrderableSession } from '../src/shared/sessionOrdering';

// T007 — ordenação da lista de SESSÕES (ui-spec §2/§3, título da task
// "sessões fixadas"): o estado do semáforo sempre vence; pin só desempata
// dentro do mesmo estado. `state` é placeholder até o T009 alimentar valores
// reais — a regra de ordenação em si já é a definitiva.

describe('sortSessions', () => {
  it('estado do semáforo vence: permissão > falha/quota > aguardando > trabalhando > encerrada', () => {
    const sessions: OrderableSession[] = [
      { id: 'done', state: 'done', pinned: false },
      { id: 'working', state: 'working', pinned: false },
      { id: 'waiting', state: 'waiting', pinned: false },
      { id: 'error', state: 'error', pinned: false },
      { id: 'permission', state: 'permission', pinned: false },
    ];

    expect(sortSessions(sessions).map((s) => s.id)).toEqual(['permission', 'error', 'waiting', 'working', 'done']);
  });

  it('pin não sobe uma sessão acima de um estado mais urgente', () => {
    const sessions: OrderableSession[] = [
      { id: 'working-pinned', state: 'working', pinned: true },
      { id: 'waiting-unpinned', state: 'waiting', pinned: false },
    ];

    expect(sortSessions(sessions).map((s) => s.id)).toEqual(['waiting-unpinned', 'working-pinned']);
  });

  it('dentro do mesmo estado, a sessão fixada fica acima', () => {
    const sessions: OrderableSession[] = [
      { id: 'a-unpinned', state: 'working', pinned: false },
      { id: 'b-pinned', state: 'working', pinned: true },
      { id: 'c-unpinned', state: 'working', pinned: false },
    ];

    expect(sortSessions(sessions).map((s) => s.id)).toEqual(['b-pinned', 'a-unpinned', 'c-unpinned']);
  });

  it('não muta o array recebido', () => {
    const sessions: OrderableSession[] = [
      { id: 'a', state: 'done', pinned: false },
      { id: 'b', state: 'permission', pinned: false },
    ];
    const originalOrder = sessions.map((s) => s.id);

    sortSessions(sessions);

    expect(sessions.map((s) => s.id)).toEqual(originalOrder);
  });
});
