import { describe, expect, it } from 'vitest';
import type { DevModeBoardConfig } from '../src/shared/devMode';
import { listEntryColumnCards, type TaskdexBoardCard, type TaskdexBoardReader } from '../src/main/taskdex-board-client';

// T309 (003-modo-dev, Batch A) — cliente MÍNIMO de leitura do board (CA-1/
// CA-2): escopo estritamente Fatia 1, restrito às colunas Backlog/Discovery/
// Plano de UM board configurado. O `reader` é injetável — a implementação de
// sistema (rede real, token dedicado, CA-11) chega em T324 (Fatia 2), que
// ESTENDE este módulo; aqui só o contrato + o filtro puro, testado com
// resposta mockada (nenhuma chamada de rede nesta task).

const BOARD_CONFIG: DevModeBoardConfig = { workspaceId: 'ws-1', teamId: 'team-1' };

function fakeReader(cards: readonly TaskdexBoardCard[]): TaskdexBoardReader {
  return { fetchBoardCards: async () => cards };
}

describe('listEntryColumnCards', () => {
  it('resposta mockada com cards de 4 colunas → só as 3 permitidas voltam', async () => {
    const cards: TaskdexBoardCard[] = [
      { cardId: 'c-1', column: 'backlog', title: 'Backlog card' },
      { cardId: 'c-2', column: 'discovery', title: 'Discovery card' },
      { cardId: 'c-3', column: 'plano', title: 'Plano card' },
      { cardId: 'c-4', column: 'done', title: 'Done card' },
    ];

    const result = await listEntryColumnCards(BOARD_CONFIG, fakeReader(cards));

    expect(result.map((c) => c.cardId)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(result.map((c) => c.column)).toEqual(['backlog', 'discovery', 'plano']);
  });

  it('card sem coluna reconhecida é ignorado, nunca lança', async () => {
    const cards: TaskdexBoardCard[] = [
      { cardId: 'c-1', column: 'backlog', title: 'ok' },
      { cardId: 'c-2', column: 'coluna-desconhecida', title: 'esquisito' },
    ];

    const result = await listEntryColumnCards(BOARD_CONFIG, fakeReader(cards));
    expect(result.map((c) => c.cardId)).toEqual(['c-1']);
  });

  it('boardConfig ausente (null) → lista vazia, sem chamar o reader (porta de entrada desligada, não erro)', async () => {
    let called = false;
    const reader: TaskdexBoardReader = {
      fetchBoardCards: async () => {
        called = true;
        return [];
      },
    };

    const result = await listEntryColumnCards(null, reader);
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});
