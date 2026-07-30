import { describe, expect, it } from 'vitest';
import { readDiscoveryPlanCards, readPhaseArtifacts, readPlanoFases, type EsteiraReaderIoDeps } from '../src/main/esteira-reader';

// T303 (003-modo-dev, Batch A) — leitura dos artefatos de fase no disco.
// Atualizado para a raiz v3 (CA-4, 009-modo-dev-v3):
// `~/.claude/esteira-state/<repo_slug>/<card_id>/<fase>/` (fora do repo) com
// `handoffs/<fase>-result.json`, e — só implementar/validar —
// `handoffs/fase-<n>/<fase>-result.json` (D.0-bis do contrato). Nunca lança —
// degrada para "não sei" (C4). I/O 100% injetável, sem tocar disco real.

function fakeIo(files: Record<string, string>): EsteiraReaderIoDeps {
  return {
    existsSync: (path) => path in files,
    readFileText: (path) => files[path] ?? null,
  };
}

const ROOT = { esteiraStateRoot: 'C:\\Users\\fake\\.claude\\esteira-state', repoSlug: 'donel-dev' };
const CTX_PATH = 'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-1\\plano\\card-1-ctx.md';
const RESULT_PATH = 'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-1\\plano\\handoffs\\plano-result.json';

describe('readPhaseArtifacts', () => {
  it('ctx.md presente + result.json ausente → ctxExists true, result null, resultUnreadable false', () => {
    const io = fakeIo({ [CTX_PATH]: '---\ncard_id: card-1\n---\n' });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.ctxExists).toBe(true);
    expect(artifacts.result).toBeNull();
    expect(artifacts.resultUnreadable).toBe(false);
  });

  it('ctx.md ausente → ctxExists false', () => {
    const io = fakeIo({});
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);
    expect(artifacts.ctxExists).toBe(false);
  });

  it('result.json com JSON corrompido → resultUnreadable true, nunca lança', () => {
    const io = fakeIo({
      [CTX_PATH]: '---\ncard_id: card-1\n---\n',
      [RESULT_PATH]: '{ isso não é json valido',
    });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.result).toBeNull();
    expect(artifacts.resultUnreadable).toBe(true);
  });

  it('result.json bem formado devolve os campos outputs tal como estão, sem transformação', () => {
    const manifest = {
      card_id: 'card-1',
      fase: 'plano',
      status: 'success',
      started_at: '2026-07-27T10:00:00Z',
      finished_at: '2026-07-27T10:30:00Z',
      executor: 'claude',
      model: 'opus',
      effort: 'high',
      outputs: {
        summary: 'resumo',
        artifact_paths: ['specs/009-modo-dev-v3/spec.md'],
        garantia: { tipo: 'roteiro_e2e', roteiro_path: 'specs/009-modo-dev-v3/e2e-fase-1.md' },
        documents: ['doc1.md'],
      },
    };
    const io = fakeIo({
      [CTX_PATH]: '---\ncard_id: card-1\n---\n',
      [RESULT_PATH]: JSON.stringify(manifest),
    });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.resultUnreadable).toBe(false);
    expect(artifacts.result).toEqual(manifest);
  });

  // Bug do 1º teste com manifesto REAL (28/07): a skill da Esteira grava
  // `artifact_paths` como OBJETO nomeado ({spec: "...", plan: "..."}), não
  // como array — o cast cru derrubava o renderer (spread de não-iterável na
  // tela preta). O reader normaliza os DOIS formatos para lista de paths;
  // valores não-string são descartados, nunca lançam. Agnóstico ao nome das
  // chaves internas: `e2e` → `garantia` (CA-17) não muda esse comportamento.
  it('artifact_paths/documents como objeto nomeado (formato real da skill) → normalizados para lista de paths', () => {
    const manifest = {
      card_id: 'card-1',
      fase: 'plano',
      status: 'success',
      started_at: '2026-07-27T10:00:00Z',
      finished_at: '2026-07-27T10:30:00Z',
      executor: 'claude',
      model: 'opus',
      effort: 'high',
      outputs: {
        summary: 'resumo',
        artifact_paths: {
          spec: 'specs/014/spec.md',
          plan: 'specs/014/plan.md',
          nested: { nao: 'string' },
        },
        documents: { lessons: 'docs/lessons.md' },
        garantia: { tipo: 'roteiro_e2e', roteiro_path: 'specs/014/e2e.md' },
      },
    };
    const io = fakeIo({
      [CTX_PATH]: '---\ncard_id: card-1\n---\n',
      [RESULT_PATH]: JSON.stringify(manifest),
    });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.resultUnreadable).toBe(false);
    expect(artifacts.result?.outputs.artifact_paths).toEqual(['specs/014/spec.md', 'specs/014/plan.md']);
    expect(artifacts.result?.outputs.documents).toEqual(['docs/lessons.md']);
  });

  it('artifact_paths escalar (string/número — formato inventado) → vira lista vazia, nunca lança', () => {
    const io = fakeIo({
      [CTX_PATH]: '---\ncard_id: card-1\n---\n',
      [RESULT_PATH]: JSON.stringify({
        card_id: 'card-1',
        fase: 'plano',
        status: 'success',
        outputs: { artifact_paths: 'specs/spec.md', documents: 42 },
      }),
    });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.resultUnreadable).toBe(false);
    expect(artifacts.result?.outputs.artifact_paths).toEqual([]);
    expect(artifacts.result?.outputs.documents).toEqual([]);
  });

  it('frontmatter do ctx.md com worktree_path/branch → devolve os dois valores (D3)', () => {
    const io = fakeIo({
      [CTX_PATH]: '---\ncard_id: card-1\nbranch: feature/card-1\nworktree_path: C:\\worktrees\\card-1\n---\n\nconteudo\n',
    });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.branch).toBe('feature/card-1');
    expect(artifacts.worktreePath).toBe('C:\\worktrees\\card-1');
  });

  it('frontmatter sem worktree_path/branch (ctx.md antigo) → null, nunca lança (D3)', () => {
    const io = fakeIo({ [CTX_PATH]: '---\ncard_id: card-1\n---\n' });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.branch).toBeNull();
    expect(artifacts.worktreePath).toBeNull();
  });

  it('worktree_path explicitamente null no frontmatter vira null, não a string "null"', () => {
    const io = fakeIo({ [CTX_PATH]: '---\ncard_id: card-1\nbranch: main\nworktree_path: null\n---\n' });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.worktreePath).toBeNull();
    expect(artifacts.branch).toBe('main');
  });

  it('ctx.md sem nenhum frontmatter (arquivo vazio/sem marcadores) → branch/worktreePath null, nunca lança', () => {
    const io = fakeIo({ [CTX_PATH]: 'sem frontmatter nenhum' });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'plano' }, io);

    expect(artifacts.branch).toBeNull();
    expect(artifacts.worktreePath).toBeNull();
  });

  // CA-4/D.0-bis — implementar/validar arquivam POR FASE DO PLANO
  // (`handoffs/fase-<n>/…`). Sem `faseNum`, não há caminho a resolver — a
  // degradação é "sem resultado", nunca chutar `fase-1` (C4/CA-6).
  describe('implementar/validar — arquivamento por fase do plano (D.0-bis)', () => {
    const IMPL_CTX = 'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-1\\implementar\\card-1-ctx.md';
    const IMPL_RESULT_FASE_1 =
      'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-1\\implementar\\handoffs\\fase-1\\implementar-result.json';
    const IMPL_RESULT_FASE_2 =
      'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-1\\implementar\\handoffs\\fase-2\\implementar-result.json';

    function implementarManifest(faseNum: number): string {
      return JSON.stringify({
        card_id: 'card-1',
        fase: 'implementar',
        status: 'success',
        started_at: 'x',
        finished_at: 'x',
        executor: 'claude',
        model: 'opus',
        effort: 'high',
        outputs: { fase_num: faseNum },
      });
    }

    it('sem faseNum → resultPath null, result null, nunca lança', () => {
      const io = fakeIo({
        [IMPL_CTX]: '---\ncard_id: card-1\n---\n',
        [IMPL_RESULT_FASE_1]: implementarManifest(1),
      });
      const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'implementar' }, io);

      expect(artifacts.ctxExists).toBe(true); // ctx.md não é por fase-num
      expect(artifacts.resultPath).toBeNull();
      expect(artifacts.result).toBeNull();
      expect(artifacts.resultUnreadable).toBe(false);
    });

    it('com faseNum → lê handoffs/fase-<n>/implementar-result.json, não a raiz nem outra fase', () => {
      const io = fakeIo({
        [IMPL_CTX]: '---\ncard_id: card-1\n---\n',
        [IMPL_RESULT_FASE_1]: implementarManifest(1),
        [IMPL_RESULT_FASE_2]: implementarManifest(2),
      });

      const fase1 = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'implementar', faseNum: 1 }, io);
      expect(fase1.resultPath).toBe(IMPL_RESULT_FASE_1);
      expect(fase1.result?.outputs.fase_num).toBe(1);

      const fase2 = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'implementar', faseNum: 2 }, io);
      expect(fase2.resultPath).toBe(IMPL_RESULT_FASE_2);
      expect(fase2.result?.outputs.fase_num).toBe(2);
    });

    it('faseNum null explícito é tratado igual a ausente (sem resultado)', () => {
      const io = fakeIo({
        [IMPL_CTX]: '---\ncard_id: card-1\n---\n',
        [IMPL_RESULT_FASE_1]: implementarManifest(1),
      });
      const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'implementar', faseNum: null }, io);
      expect(artifacts.resultPath).toBeNull();
      expect(artifacts.result).toBeNull();
    });
  });

  // CA-18 — documentar/cliente lêem direto de handoffs/<fase>-result.json,
  // sem fase-num (mesmo padrão de discovery/plano).
  it('documentar/cliente não usam fase-num — mesmo padrão de discovery/plano', () => {
    const ctxPath = 'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-1\\documentar\\card-1-ctx.md';
    const resultPath = 'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-1\\documentar\\handoffs\\documentar-result.json';
    const io = fakeIo({
      [ctxPath]: '---\ncard_id: card-1\n---\n',
      [resultPath]: JSON.stringify({
        card_id: 'card-1',
        fase: 'documentar',
        status: 'success',
        started_at: 'x',
        finished_at: 'x',
        executor: 'claude',
        model: 'opus',
        effort: 'high',
        outputs: {},
      }),
    });
    const artifacts = readPhaseArtifacts({ ...ROOT, cardId: 'card-1', fase: 'documentar' }, io);
    expect(artifacts.resultPath).toBe(resultPath);
    expect(artifacts.result?.status).toBe('success');
  });
});

describe('readDiscoveryPlanCards', () => {
  const ROOT_CARD = 'card-root';
  const DISCOVERY_RESULT_PATH =
    'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-root\\discovery\\handoffs\\discovery-result.json';

  it('plan_cards ausente (fase que não é discovery, ou discovery sem o campo) → []', () => {
    const io = fakeIo({
      [DISCOVERY_RESULT_PATH]: JSON.stringify({
        card_id: ROOT_CARD,
        fase: 'discovery',
        status: 'success',
        started_at: 'x',
        finished_at: 'x',
        executor: 'claude',
        model: 'fable',
        effort: 'high',
        outputs: {},
      }),
    });
    expect(readDiscoveryPlanCards(ROOT, ROOT_CARD, io)).toEqual([]);
  });

  // CA-17 — substitui fanout_cards[]/marco_id: agora {card_id, track, shadow}.
  it('devolve os cards de plano de outputs.plan_cards, sem marco_id', () => {
    const io = fakeIo({
      [DISCOVERY_RESULT_PATH]: JSON.stringify({
        card_id: ROOT_CARD,
        fase: 'discovery',
        status: 'success',
        started_at: 'x',
        finished_at: 'x',
        executor: 'claude',
        model: 'fable',
        effort: 'high',
        outputs: {
          plan_cards: [
            { card_id: 'card-p1', track: 'codigo', shadow: false },
            { card_id: 'card-p2', track: 'documental', shadow: true },
          ],
        },
      }),
    });

    expect(readDiscoveryPlanCards(ROOT, ROOT_CARD, io)).toEqual([
      { cardId: 'card-p1', track: 'codigo', shadow: false },
      { cardId: 'card-p2', track: 'documental', shadow: true },
    ]);
  });

  it('track/shadow ausentes ou de tipo errado degradam para código/false, nunca lançam', () => {
    const io = fakeIo({
      [DISCOVERY_RESULT_PATH]: JSON.stringify({
        card_id: ROOT_CARD,
        fase: 'discovery',
        status: 'success',
        outputs: { plan_cards: [{ card_id: 'card-p1' }] },
      }),
    });
    expect(readDiscoveryPlanCards(ROOT, ROOT_CARD, io)).toEqual([{ cardId: 'card-p1', track: 'codigo', shadow: false }]);
  });

  it('discovery-result.json ausente → []', () => {
    const io = fakeIo({});
    expect(readDiscoveryPlanCards(ROOT, ROOT_CARD, io)).toEqual([]);
  });

  it('discovery-result.json ilegível → [], nunca lança', () => {
    const io = fakeIo({ [DISCOVERY_RESULT_PATH]: '{ corrompido' });
    expect(readDiscoveryPlanCards(ROOT, ROOT_CARD, io)).toEqual([]);
  });
});

// Lote 7 (009-modo-dev-v3, CA-11) — as fases (`fase_num`, unidade de PR) que
// o PLANO declarou em `outputs.fases[]` de `plano-result.json`. Sem o campo
// (plano ainda não fatiou, ou manifesto antigo sem ele) → `[]`: o nível de
// Implementação/Validação simplesmente não nasce (CA-14) — nunca um `fase 1`
// fabricado por suposição.
describe('readPlanoFases', () => {
  const CARD_ID = 'card-p1';
  const PLANO_RESULT_PATH = 'C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\card-p1\\plano\\handoffs\\plano-result.json';

  function planoManifest(outputs: Record<string, unknown>): string {
    return JSON.stringify({
      card_id: CARD_ID,
      fase: 'plano',
      status: 'success',
      started_at: 'x',
      finished_at: 'x',
      executor: 'claude',
      model: 'opus',
      effort: 'high',
      outputs,
    });
  }

  it('outputs.fases ausente → []', () => {
    const io = fakeIo({ [PLANO_RESULT_PATH]: planoManifest({}) });
    expect(readPlanoFases(ROOT, CARD_ID, io)).toEqual([]);
  });

  it('plano-result.json ausente → []', () => {
    const io = fakeIo({});
    expect(readPlanoFases(ROOT, CARD_ID, io)).toEqual([]);
  });

  it('plano-result.json ilegível → [], nunca lança', () => {
    const io = fakeIo({ [PLANO_RESULT_PATH]: '{ corrompido' });
    expect(readPlanoFases(ROOT, CARD_ID, io)).toEqual([]);
  });

  it('devolve as fases declaradas, ordenadas por fase_num, com titulo opcional', () => {
    const io = fakeIo({
      [PLANO_RESULT_PATH]: planoManifest({
        fases: [
          { fase_num: 2, titulo: 'Serviço de parcelas' },
          { fase_num: 1, titulo: 'Tabela de coeficientes' },
        ],
      }),
    });
    expect(readPlanoFases(ROOT, CARD_ID, io)).toEqual([
      { faseNum: 1, titulo: 'Tabela de coeficientes' },
      { faseNum: 2, titulo: 'Serviço de parcelas' },
    ]);
  });

  it('titulo ausente/tipo errado degrada para null, nunca lança', () => {
    const io = fakeIo({
      [PLANO_RESULT_PATH]: planoManifest({ fases: [{ fase_num: 1 }, { fase_num: 2, titulo: 42 }] }),
    });
    expect(readPlanoFases(ROOT, CARD_ID, io)).toEqual([
      { faseNum: 1, titulo: null },
      { faseNum: 2, titulo: null },
    ]);
  });

  it('entrada sem fase_num numérico é descartada, vizinhas válidas sobrevivem', () => {
    const io = fakeIo({
      [PLANO_RESULT_PATH]: planoManifest({ fases: [{ fase_num: 1 }, { titulo: 'sem fase_num' }, { fase_num: 'x' }] }),
    });
    expect(readPlanoFases(ROOT, CARD_ID, io)).toEqual([{ faseNum: 1, titulo: null }]);
  });
});
