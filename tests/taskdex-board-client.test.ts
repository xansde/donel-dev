import { describe, expect, it } from 'vitest';
import type { DevModeBoardConfig } from '../src/shared/devMode';
import {
  createFixtureTaskdexBoardReader,
  listEntryColumnCards,
  resolveBoardReader,
  type TaskdexBoardCard,
  type TaskdexBoardReader,
} from '../src/main/taskdex-board-client';

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

// T311 (Batch B) — leitor de FIXTURE da porta de entrada. A implementação de
// sistema real (rede + token dedicado) é T324/Fatia 2; enquanto ela não
// existe, a porta de entrada nasce DESLIGADA em produção (lista vazia) e o
// smoke da Fatia 1 injeta um board mockado por arquivo, sem tocar em rede.
describe('createFixtureTaskdexBoardReader', () => {
  it('lê os cards do arquivo de fixture (array cru)', async () => {
    const reader = createFixtureTaskdexBoardReader('C:/fix.json', () =>
      JSON.stringify([{ cardId: 'c-1', column: 'backlog', title: 'Um' }]),
    );
    expect(await reader.fetchBoardCards(BOARD_CONFIG)).toEqual([{ cardId: 'c-1', column: 'backlog', title: 'Um' }]);
  });

  it('aceita também o envelope { cards: [...] }', async () => {
    const reader = createFixtureTaskdexBoardReader('C:/fix.json', () =>
      JSON.stringify({ cards: [{ cardId: 'c-2', column: 'plano', title: 'Dois' }] }),
    );
    expect(await reader.fetchBoardCards(BOARD_CONFIG)).toEqual([{ cardId: 'c-2', column: 'plano', title: 'Dois' }]);
  });

  it('arquivo ausente ou JSON corrompido vira lista vazia — nunca lança', async () => {
    expect(await createFixtureTaskdexBoardReader('C:/nada.json', () => null).fetchBoardCards(BOARD_CONFIG)).toEqual([]);
    expect(await createFixtureTaskdexBoardReader('C:/ruim.json', () => '{{{').fetchBoardCards(BOARD_CONFIG)).toEqual([]);
  });

  it('descarta entrada malformada (sem cardId/column) em vez de propagar lixo', async () => {
    const reader = createFixtureTaskdexBoardReader('C:/fix.json', () =>
      JSON.stringify([{ cardId: '', column: 'backlog', title: 'x' }, { cardId: 'c-3', column: 'discovery' }]),
    );
    expect(await reader.fetchBoardCards(BOARD_CONFIG)).toEqual([{ cardId: 'c-3', column: 'discovery', title: '' }]);
  });
});

describe('resolveBoardReader', () => {
  it('sem variável de fixture devolve um leitor VAZIO — porta de entrada desligada na Fatia 1 (o cliente real é T324)', async () => {
    const reader = resolveBoardReader({}, () => null);
    expect(await reader.fetchBoardCards(BOARD_CONFIG)).toEqual([]);
  });

  it('com a variável apontando pra um fixture, lê dali', async () => {
    const reader = resolveBoardReader({ DONEL_DEVMODE_BOARD_FIXTURE: 'C:/fix.json' }, () =>
      JSON.stringify([{ cardId: 'c-9', column: 'plano', title: 'Nove' }]),
    );
    expect((await reader.fetchBoardCards(BOARD_CONFIG)).map((card) => card.cardId)).toEqual(['c-9']);
  });
});
