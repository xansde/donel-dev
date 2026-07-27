import { describe, expect, it, vi } from 'vitest';
import type { DevModeBoardConfig } from '../src/shared/devMode';
import {
  createFixtureTaskdexBoardReader,
  createSystemBoardFactsReader,
  listEntryColumnCards,
  loadTaskdexServiceCredential,
  resolveBoardReader,
  taskdexCredentialPath,
  type BoardReadTool,
  type CallBoardReadTool,
  type TaskdexBoardCard,
  type TaskdexBoardReader,
  type TaskdexCredentialIoDeps,
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

// ---------------------------------------------------------------------------
// T324 (003-modo-dev, Batch C) — cliente de leitura REAL do board (CA-11):
// lista fechada de tools (tipo restrito, não allowlist em runtime) + credencial
// de serviço dedicada, fora do repo, nunca logada.
// ---------------------------------------------------------------------------

describe('BoardReadTool — lista fechada em tempo de compilação (CA-11)', () => {
  it('o único jeito de chamar é com uma tool da união — tool fora da lista fecha o typecheck do lote (npm run typecheck), não em runtime', async () => {
    const validTool: BoardReadTool = 'get_task_details';
    const fakeCall: CallBoardReadTool = async (tool) => ({ tool });

    expect(await fakeCall(validTool, { cardId: 'c-1' })).toEqual({ tool: 'get_task_details' });

    // Linha de verificação de tipo, nunca executada: qualquer string fora da
    // união faz o TS recusar a compilação aqui. Se compilar sem o
    // `@ts-expect-error`, é regressão do tipo restrito — o gate do lote
    // (`npm run typecheck`) falha com "Unused '@ts-expect-error' directive".
    function neverCalled(): void {
      // @ts-expect-error tool fora da lista fechada não é um `BoardReadTool` válido
      void fakeCall('delete_task', { cardId: 'c-1' });
    }
    expect(neverCalled).toBeTypeOf('function');
  });
});

describe('createSystemBoardFactsReader', () => {
  function mockCallTool(response: unknown): CallBoardReadTool {
    return vi.fn(async () => response);
  }

  it('resposta mockada mapeia coluna/labels/PR corretamente (CA-12)', async () => {
    const callTool = mockCallTool({
      column: 'implementar',
      title: '[M2] Ajusta o cliente do board',
      labels: ['esteira:em-andamento:implementar', 'esteira:precisa-atencao'],
      pullRequest: { url: 'https://github.com/x/y/pull/9', approved: true },
    });
    const reader = createSystemBoardFactsReader(callTool);

    const facts = await reader.fetchBoardFacts('card-m2');

    expect(facts).toEqual({
      column: 'implementar',
      title: '[M2] Ajusta o cliente do board',
      lockedPhase: 'implementar',
      attentionLabels: ['esteira:precisa-atencao'],
      prUrl: 'https://github.com/x/y/pull/9',
      prApproved: true,
    });
    expect(callTool).toHaveBeenCalledWith('get_task_details', { cardId: 'card-m2' });
  });

  it('sem trava e sem PR → lockedPhase/prUrl null, prApproved false, attentionLabels vazio', async () => {
    const callTool = mockCallTool({ column: 'plano', title: 'Card qualquer', labels: [], pullRequest: null });
    const reader = createSystemBoardFactsReader(callTool);

    expect(await reader.fetchBoardFacts('card-x')).toEqual({
      column: 'plano',
      title: 'Card qualquer',
      lockedPhase: null,
      attentionLabels: [],
      prUrl: null,
      prApproved: false,
    });
  });

  it('resposta sem coluna reconhecível vira null — nunca lança', async () => {
    const reader = createSystemBoardFactsReader(mockCallTool({ garbage: true }));
    expect(await reader.fetchBoardFacts('card-x')).toBeNull();
  });

  it('cardId vazio não chama a tool (mesma degradação de porta desligada, não erro)', async () => {
    const callTool = mockCallTool({ column: 'plano', title: '', labels: [], pullRequest: null });
    const reader = createSystemBoardFactsReader(callTool);

    expect(await reader.fetchBoardFacts('')).toBeNull();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('token nunca aparece em log — o cliente não loga nada, nem em falha da tool', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secretToken = 'srv-token-super-secreto-000';
    const callTool: CallBoardReadTool = async () => {
      // simula uma implementação real que usaria o token pra autenticar —
      // o ponto do teste é que NADA disso deveria ir pro console.
      void secretToken;
      throw new Error('rede fora do ar');
    };
    const reader = createSystemBoardFactsReader(callTool);

    await expect(reader.fetchBoardFacts('card-x')).rejects.toThrow('rede fora do ar');

    const allLoggedText = [...consoleSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(allLoggedText).not.toContain(secretToken);

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('loadTaskdexServiceCredential', () => {
  function fakeIo(files: Record<string, string>): TaskdexCredentialIoDeps {
    return {
      homedir: () => 'C:/Users/fake',
      readFileText: (path) => files[path] ?? null,
    };
  }

  it('lê token/baseUrl do arquivo dedicado fora do repo (mesmo padrão de ~/.claude/esteira-config/)', () => {
    const path = taskdexCredentialPath(() => 'C:/Users/fake');
    expect(path).toContain('.claude');
    expect(path).toContain('esteira-config');
    expect(path).toContain('donel-board-credential.json');

    const io = fakeIo({ [path]: JSON.stringify({ token: 'tok-1', baseUrl: 'https://taskdex.internal' }) });
    expect(loadTaskdexServiceCredential(io)).toEqual({ token: 'tok-1', baseUrl: 'https://taskdex.internal' });
  });

  it('arquivo ausente, JSON corrompido ou campo faltando → null, nunca lança', () => {
    expect(loadTaskdexServiceCredential(fakeIo({}))).toBeNull();

    const path = taskdexCredentialPath(() => 'C:/Users/fake');
    expect(loadTaskdexServiceCredential(fakeIo({ [path]: '{{{' }))).toBeNull();
    expect(loadTaskdexServiceCredential(fakeIo({ [path]: JSON.stringify({ token: 'tok-1' }) }))).toBeNull();
  });

  it('nunca loga o conteúdo do arquivo de credencial', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const path = taskdexCredentialPath(() => 'C:/Users/fake');
    const io = fakeIo({ [path]: JSON.stringify({ token: 'segredo-xyz', baseUrl: 'https://taskdex.internal' }) });

    loadTaskdexServiceCredential(io);

    const allLoggedText = consoleSpy.mock.calls.flat().join(' ');
    expect(allLoggedText).not.toContain('segredo-xyz');
    consoleSpy.mockRestore();
  });
});
