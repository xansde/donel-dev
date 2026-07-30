import { describe, expect, it, vi } from 'vitest';
import {
  boardConfigFromCredential,
  createSystemBoardFactsReader,
  createSystemTaskdexBoardReader,
  listEntryColumnCards,
  resolveBoardFactsReader,
  resolveBoardReader,
  type CallBoardReadTool,
  type TaskdexServiceCredential,
} from '../src/main/taskdex-board-client';
import type { DevModeBoardConfig } from '../src/shared/devMode';

// Mapeamento contra o shape REAL da API do TaskDex, medido no servidor em
// 2026-07-28 — não contra o shape imaginado quando T324 foi escrita. Foi
// exatamente essa diferença (tipo suposto × payload real) que derrubou a
// árvore no bug da tela preta; aqui ela vira teste.
//
// Diferenças reais que o mapeamento precisa absorver:
//   • `column` é OBJETO (`{name: "Backlog"}`), não string;
//   • nomes de coluna vêm capitalizados e acentuados ("Concluído");
//   • PR vem em `prLinks: [{prUrl, prStatus}]`, não em `pullRequest`;
//   • `labels` não é exposto por nenhuma tool de leitura hoje.

const BOARD: DevModeBoardConfig = { workspaceId: 'ws-1', teamId: 'team-1' };

/** Trecho real (abreviado) de `list_tasks_by_team`. */
const REAL_LIST_PAYLOAD = {
  tasks: [
    { id: 'c-backlog', title: 'Evals de validação', column: { name: 'Backlog' }, teamId: 'team-1' },
    { id: 'c-discovery', title: 'Loop de aprendizado', column: { name: 'Discovery' }, teamId: 'team-1' },
    { id: 'c-plano', title: 'Sheets write_cell', column: { name: 'Plano' }, teamId: 'team-1' },
    { id: 'c-validar', title: 'F3 braço de escrita', column: { name: 'Validar' }, teamId: 'team-1' },
    { id: 'c-done', title: 'Card fechado', column: { name: 'Concluído' }, teamId: 'team-1' },
  ],
  total: 5,
  limit: 100,
};

describe('createSystemTaskdexBoardReader (porta de entrada com fonte real)', () => {
  it('lê `list_tasks_by_team` e normaliza a coluna capitalizada/acentuada', async () => {
    const callTool = vi.fn<CallBoardReadTool>(async () => REAL_LIST_PAYLOAD);
    const reader = createSystemTaskdexBoardReader(callTool);

    const cards = await reader.fetchBoardCards(BOARD);

    expect(callTool).toHaveBeenCalledWith('list_tasks_by_team', { teamId: 'team-1', workspaceId: 'ws-1' });
    expect(cards).toEqual([
      { cardId: 'c-backlog', column: 'backlog', title: 'Evals de validação' },
      { cardId: 'c-discovery', column: 'discovery', title: 'Loop de aprendizado' },
      { cardId: 'c-plano', column: 'plano', title: 'Sheets write_cell' },
      { cardId: 'c-validar', column: 'validar', title: 'F3 braço de escrita' },
      { cardId: 'c-done', column: 'concluido', title: 'Card fechado' },
    ]);
  });

  it('o filtro das colunas de entrada (CA-1/CA-2, v3) continua valendo sobre o payload real — Validar entra, Concluído não', async () => {
    const reader = createSystemTaskdexBoardReader(async () => REAL_LIST_PAYLOAD);

    const entry = await listEntryColumnCards(BOARD, reader);

    expect(entry.map((card) => card.cardId)).toEqual(['c-backlog', 'c-discovery', 'c-plano', 'c-validar']);
  });

  it('board indisponível (tool lança) devolve lista vazia — a porta de entrada nunca derruba a tela', async () => {
    const reader = createSystemTaskdexBoardReader(async () => {
      throw new Error('taskdex: resposta HTTP 500');
    });

    await expect(reader.fetchBoardCards(BOARD)).resolves.toEqual([]);
  });

  it('payload de formato inesperado degrada para vazio, nunca lança', async () => {
    const reader = createSystemTaskdexBoardReader(async () => ({ inesperado: true }));

    await expect(reader.fetchBoardCards(BOARD)).resolves.toEqual([]);
  });
});

describe('createSystemBoardFactsReader com o payload real de get_task_details', () => {
  const REAL_DETAILS = {
    id: 'c-1',
    title: 'Loop de aprendizado autônomo do Dalton',
    column: { name: 'Validar', type: 'REVIEW' },
    prLinks: [
      {
        prUrl: 'https://github.com/seazone-tech/dalton/pull/116',
        prNumber: 116,
        prStatus: 'merged',
      },
    ],
  };

  it('coluna como objeto e PR em `prLinks` viram os fatos do espelho (CA-12)', async () => {
    const reader = createSystemBoardFactsReader(async () => REAL_DETAILS, BOARD);

    expect(await reader.fetchBoardFacts('c-1')).toEqual({
      column: 'validar',
      title: 'Loop de aprendizado autônomo do Dalton',
      lockedPhase: null,
      attentionLabels: [],
      prUrl: 'https://github.com/seazone-tech/dalton/pull/116',
      prApproved: false,
    });
  });

  it('passa o workspaceId do board configurado junto do cardId', async () => {
    const callTool = vi.fn<CallBoardReadTool>(async () => REAL_DETAILS);
    const reader = createSystemBoardFactsReader(callTool, BOARD);

    await reader.fetchBoardFacts('c-1');

    expect(callTool).toHaveBeenCalledWith('get_task_details', { cardId: 'c-1', workspaceId: 'ws-1' });
  });

  it('PR aprovado no board vira `prApproved` — status merged sozinho NÃO conta como aprovação', async () => {
    const aprovado = { ...REAL_DETAILS, prLinks: [{ prUrl: 'https://x/pull/1', prStatus: 'approved' }] };
    const reader = createSystemBoardFactsReader(async () => aprovado, BOARD);

    expect((await reader.fetchBoardFacts('c-1'))?.prApproved).toBe(true);
  });

  it('formato antigo (coluna string + `pullRequest`) continua lido — a fixture não quebra', async () => {
    const reader = createSystemBoardFactsReader(async () => ({
      column: 'implementar',
      title: '[M2] Card',
      labels: ['esteira:em-andamento:implementar', 'esteira:escalado'],
      pullRequest: { url: 'https://github.com/x/y/pull/9', approved: true },
    }));

    expect(await reader.fetchBoardFacts('c-1')).toEqual({
      column: 'implementar',
      title: '[M2] Card',
      lockedPhase: 'implementar',
      attentionLabels: ['esteira:escalado'],
      prUrl: 'https://github.com/x/y/pull/9',
      prApproved: true,
    });
  });
});

describe('configuração por usuário (cada pessoa com o seu board e o seu token)', () => {
  const CREDENTIAL: TaskdexServiceCredential = {
    token: 'sk_fake',
    baseUrl: 'https://taskdex.example/api/mcp',
    workspaceId: 'ws-do-usuario',
    teamId: 'team-do-usuario',
  };

  it('o board sai da credencial do usuário quando o app ainda não tem um configurado', () => {
    expect(boardConfigFromCredential(CREDENTIAL)).toEqual({
      workspaceId: 'ws-do-usuario',
      teamId: 'team-do-usuario',
    });
  });

  it('credencial só com token/baseUrl não vira board (falta dizer QUAL board)', () => {
    expect(boardConfigFromCredential({ token: 'sk', baseUrl: 'https://x' })).toBeNull();
    expect(boardConfigFromCredential(null)).toBeNull();
  });

  it('sem fixture e sem callTool a porta continua desligada (nada muda para quem não configurou)', async () => {
    const reader = resolveBoardReader({}, () => null, null);
    await expect(reader.fetchBoardCards(BOARD)).resolves.toEqual([]);

    const factsReader = resolveBoardFactsReader({}, () => null, null);
    await expect(factsReader.fetchBoardFacts('c-1')).resolves.toBeNull();
  });

  it('a fixture tem precedência sobre a fonte real — roteiro de teste manual não fala com o board de verdade', async () => {
    const fixture = JSON.stringify({ cards: [{ cardId: 'fix-1', column: 'plano', title: 'Da fixture' }] });
    const callTool = vi.fn<CallBoardReadTool>(async () => REAL_LIST_PAYLOAD);

    const reader = resolveBoardReader({ DONEL_DEVMODE_BOARD_FIXTURE: 'C:/fixture.json' }, () => fixture, callTool);

    await expect(reader.fetchBoardCards(BOARD)).resolves.toEqual([
      { cardId: 'fix-1', column: 'plano', title: 'Da fixture' },
    ]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('com callTool e sem fixture, a fonte é o board real', async () => {
    const reader = resolveBoardReader({}, () => null, async () => REAL_LIST_PAYLOAD);

    const cards = await reader.fetchBoardCards(BOARD);

    expect(cards.map((card) => card.cardId)).toContain('c-plano');
  });
});
