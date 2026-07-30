import { describe, expect, it } from 'vitest';
import type { ArchivedPhaseSessions } from '../src/shared/devMode';
import { buildDiscoveryTree, resolveArtifactPool } from '../src/main/discovery-tree';
import type { EsteiraReaderIoDeps, EsteiraStateRoot } from '../src/main/esteira-reader';

// T305 (003-modo-dev, Batch A) — montagem da árvore do discovery (CA-7/CA-9/
// CA-10/CA-23), atualizado para a raiz v3 (CA-4/CA-17, 009-modo-dev-v3):
// `plan_cards[]` no lugar de `fanout_cards[]`, sem `marco_id`. Disco puro:
// `sessionAlive` é sempre `false` aqui — quem sabe qual sessão está viva é o
// processo main (PTYs em memória), não o disco; a Zona 3 (Batch B) sobrepõe
// "running" por cima com o que já sabe.

const ROOT: EsteiraStateRoot = { esteiraStateRoot: 'C:\\Users\\fake\\.claude\\esteira-state', repoSlug: 'donel-dev' };
const ROOT_CARD = 'card-root';

function discoveryResultPath(cardId: string): string {
  return `C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\${cardId}\\discovery\\handoffs\\discovery-result.json`;
}

function phaseResultPath(fase: string, cardId: string): string {
  return `C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\${cardId}\\${fase}\\handoffs\\${fase}-result.json`;
}

function phaseResultPathByFaseNum(fase: string, cardId: string, faseNum: number): string {
  return `C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\${cardId}\\${fase}\\handoffs\\fase-${faseNum}\\${fase}-result.json`;
}

function phaseCtxPath(fase: string, cardId: string): string {
  return `C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\${cardId}\\${fase}\\${cardId}-ctx.md`;
}

function planoResultPath(cardId: string): string {
  return `C:\\Users\\fake\\.claude\\esteira-state\\donel-dev\\${cardId}\\plano\\handoffs\\plano-result.json`;
}

function successManifest(cardId: string, fase: string): string {
  return JSON.stringify({
    card_id: cardId,
    fase,
    status: 'success',
    started_at: 'x',
    finished_at: 'x',
    executor: 'claude',
    model: 'opus',
    effort: 'high',
    outputs: {},
  });
}

function fakeIo(files: Record<string, string>): EsteiraReaderIoDeps {
  return {
    existsSync: (path) => path in files,
    readFileText: (path) => files[path] ?? null,
  };
}

function threePlanCardsFanout(): Record<string, string> {
  return {
    [discoveryResultPath(ROOT_CARD)]: JSON.stringify({
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
          { card_id: 'card-p2', track: 'codigo', shadow: false },
          { card_id: 'card-p3', track: 'documental', shadow: true },
        ],
      },
    }),
  };
}

const NO_ARCHIVED: ArchivedPhaseSessions = {};
const ALL_PHASES = ['discovery', 'plano', 'implementar', 'validar', 'documentar', 'cliente', 'concluir'];

describe('buildDiscoveryTree', () => {
  it('árvore com 3 cards de plano monta 3 ramos × 7 fases cada, com track/shadow de plan_cards', () => {
    const io = fakeIo(threePlanCardsFanout());
    const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

    expect(tree.discoveryCardId).toBe(ROOT_CARD);
    expect(tree.planCards).toHaveLength(3);
    for (const planCard of tree.planCards) {
      expect(Object.keys(planCard.phases).sort()).toEqual([...ALL_PHASES].sort());
    }
    expect(tree.planCards.map((pc) => pc.cardId)).toEqual(['card-p1', 'card-p2', 'card-p3']);
    expect(tree.planCards.map((pc) => pc.track)).toEqual(['codigo', 'codigo', 'documental']);
    expect(tree.planCards.map((pc) => pc.shadow)).toEqual([false, false, true]);
  });

  it('sem plan_cards (discovery-result.json ausente/sem o campo) → planCards vazio, allPlanCardsComplete false', () => {
    const io = fakeIo({});
    const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

    expect(tree.planCards).toEqual([]);
    expect(tree.allPlanCardsComplete).toBe(false);
  });

  // CA-21 — a v3 não grava `concluir-result.json` (esteira-concluir é gate
  // mecânico, §D.7 do contrato: "não grava result.json"), então
  // `phases.concluir.status === 'done'` nunca fica verdadeiro (problema 3 da
  // spec). `allPlanCardsComplete` passa a ler, por track: código — QUALQUER
  // fase declarada com `validar-result.json.outputs.plano_completo === true`
  // (contrato §D.5: "todas as fases deste plano estão homologadas", o mesmo
  // fato pro plano inteiro, por isso QUALQUER fase basta); documental — a
  // fase `documentar` (terminal do track, §B) com status `done`.
  describe('allPlanCardsComplete (CA-21 — sem depender de concluir-result.json)', () => {
    function planoManifestWithGarantiaFases(cardId: string, faseNums: readonly number[]): string {
      return JSON.stringify({
        card_id: cardId,
        fase: 'plano',
        status: 'success',
        started_at: 'x',
        finished_at: 'x',
        executor: 'claude',
        model: 'opus',
        effort: 'high',
        outputs: { fases: faseNums.map((n) => ({ fase_num: n })) },
      });
    }

    function validarManifest(cardId: string, planoCompleto: boolean): string {
      return JSON.stringify({
        card_id: cardId,
        fase: 'validar',
        status: 'success',
        started_at: 'x',
        finished_at: 'x',
        executor: 'claude',
        model: 'sonnet',
        effort: 'low',
        outputs: { fase_num: 1, plano_completo: planoCompleto },
      });
    }

    it('track código: nenhuma fase homologada (plano_completo ausente/false) → aquele card de plano não está completo', () => {
      const files = {
        ...threePlanCardsFanout(),
        [planoResultPath('card-p1')]: planoManifestWithGarantiaFases('card-p1', [1]),
        [phaseCtxPath('validar', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
        [phaseResultPathByFaseNum('validar', 'card-p1', 1)]: validarManifest('card-p1', false),
      };
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, fakeIo(files));
      expect(tree.allPlanCardsComplete).toBe(false);
    });

    it('track código: fase homologada (plano_completo true) + track documental com documentar done → true', () => {
      const files = {
        ...threePlanCardsFanout(),
        [planoResultPath('card-p1')]: planoManifestWithGarantiaFases('card-p1', [1]),
        [phaseCtxPath('validar', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
        [phaseResultPathByFaseNum('validar', 'card-p1', 1)]: validarManifest('card-p1', true),
        [planoResultPath('card-p2')]: planoManifestWithGarantiaFases('card-p2', [1]),
        [phaseCtxPath('validar', 'card-p2')]: '---\ncard_id: card-p2\n---\n',
        [phaseResultPathByFaseNum('validar', 'card-p2', 1)]: validarManifest('card-p2', true),
        [phaseCtxPath('documentar', 'card-p3')]: '---\ncard_id: card-p3\n---\n',
        [phaseResultPath('documentar', 'card-p3')]: successManifest('card-p3', 'documentar'),
      };
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, fakeIo(files));
      expect(tree.allPlanCardsComplete).toBe(true);
    });

    it('track código sem fases declaradas ainda (fases: []) → nunca completo, mesmo que outros cards estejam', () => {
      const files = {
        ...threePlanCardsFanout(),
        // card-p1: sem plano-result.json → fases: [].
        [planoResultPath('card-p2')]: planoManifestWithGarantiaFases('card-p2', [1]),
        [phaseCtxPath('validar', 'card-p2')]: '---\ncard_id: card-p2\n---\n',
        [phaseResultPathByFaseNum('validar', 'card-p2', 1)]: validarManifest('card-p2', true),
        [phaseCtxPath('documentar', 'card-p3')]: '---\ncard_id: card-p3\n---\n',
        [phaseResultPath('documentar', 'card-p3')]: successManifest('card-p3', 'documentar'),
      };
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, fakeIo(files));
      expect(tree.allPlanCardsComplete).toBe(false);
    });

    it('track documental: documentar sem sucesso ainda → não completo', () => {
      const files = {
        ...threePlanCardsFanout(),
        [planoResultPath('card-p1')]: planoManifestWithGarantiaFases('card-p1', [1]),
        [phaseCtxPath('validar', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
        [phaseResultPathByFaseNum('validar', 'card-p1', 1)]: validarManifest('card-p1', true),
        [planoResultPath('card-p2')]: planoManifestWithGarantiaFases('card-p2', [1]),
        [phaseCtxPath('validar', 'card-p2')]: '---\ncard_id: card-p2\n---\n',
        [phaseResultPathByFaseNum('validar', 'card-p2', 1)]: validarManifest('card-p2', true),
        // card-p3 (documental): sem ctx.md — ainda não chegou em Documentar.
      };
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, fakeIo(files));
      expect(tree.allPlanCardsComplete).toBe(false);
    });
  });

  it('liga archivedPhaseSessions ao nó certo, pela chave v3 cardId:fase (CA-9/CA-31)', () => {
    const archived: ArchivedPhaseSessions = {
      'card-p1:plano': { sessionId: 'sess-1', profileSlug: 'principal', archivedAt: 100 },
    };
    const io = fakeIo(threePlanCardsFanout());
    const tree = buildDiscoveryTree(ROOT, ROOT_CARD, archived, io);

    const p1 = tree.planCards.find((pc) => pc.cardId === 'card-p1')!;
    expect(p1.phases.plano.archivedSession).toEqual({ sessionId: 'sess-1', profileSlug: 'principal', archivedAt: 100 });
    expect(p1.phases.discovery.archivedSession).toBeNull();
  });

  it('discovery antigo sem session-id arquivado (C4) monta igual — archivedSession null em toda fase', () => {
    const io = fakeIo(threePlanCardsFanout());
    const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

    for (const planCard of tree.planCards) {
      for (const phase of Object.values(planCard.phases)) {
        expect(phase.archivedSession).toBeNull();
      }
    }
  });

  // CA-4/D.0-bis — implementar/validar arquivam sob handoffs/fase-<n>/. Este
  // lote lê sempre fase-1 (decisão documentada no topo de discovery-tree.ts,
  // até o carrossel do lote 7 saber ler fases[] do plano).
  it('implementar/validar leem handoffs/fase-1/ (ponto de partida do lote 2, documentado)', () => {
    const files = {
      ...threePlanCardsFanout(),
      [phaseCtxPath('implementar', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
      [phaseResultPathByFaseNum('implementar', 'card-p1', 1)]: successManifest('card-p1', 'implementar'),
      // fase-2 existe mas não deve ser lida por este lote.
      [phaseResultPathByFaseNum('implementar', 'card-p1', 2)]: JSON.stringify({
        card_id: 'card-p1',
        fase: 'implementar',
        status: 'failed',
        outputs: {},
      }),
    };
    const io = fakeIo(files);
    const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

    const p1 = tree.planCards.find((pc) => pc.cardId === 'card-p1')!;
    expect(p1.phases.implementar.status).toBe('done'); // leu fase-1 (success), não fase-2 (failed)
  });

  // Lote 7 (CA-11) — `PlanCardNode.fases[]`: as fases (unidade de PR) que o
  // PLANO propôs, cada uma com implementar/validar do disco de VERDADE
  // (`handoffs/fase-<n>/…`), não mais hardcoded em `fase-1`.
  describe('PlanCardNode.fases (CA-11)', () => {
    function planoManifestWithFases(
      cardId: string,
      fases: readonly { fase_num: number; titulo?: string; garantia?: { tipo?: string; descricao?: string; roteiro_path?: string | null } }[],
    ): string {
      return JSON.stringify({
        card_id: cardId,
        fase: 'plano',
        status: 'success',
        started_at: 'x',
        finished_at: 'x',
        executor: 'claude',
        model: 'opus',
        effort: 'high',
        outputs: { fases },
      });
    }

    it('plano sem outputs.fases → fases: [] (nível de Implementação/Validação não nasce, CA-14)', () => {
      const io = fakeIo(threePlanCardsFanout());
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

      for (const planCard of tree.planCards) {
        expect(planCard.fases).toEqual([]);
      }
    });

    // CA-20 (lote 8) — a garantia declarada pelo plano (contrato §D.3) chega
    // em `PlanCardFaseNode.garantia`, a mesma para implementar/validar da
    // mesma fase (D13: "1 garantia : 1 fase do plano").
    it('fase com garantia declarada → PlanCardFaseNode.garantia com tipo/descricao/roteiroPath; sem declaração → null (C4)', () => {
      const files = {
        ...threePlanCardsFanout(),
        [planoResultPath('card-p1')]: planoManifestWithFases('card-p1', [
          { fase_num: 1, garantia: { tipo: 'roteiro_e2e', descricao: 'Cobre o parcelamento', roteiro_path: 'specs/x/e2e-fase-1.md' } },
          { fase_num: 2 }, // sem garantia declarada
        ]),
      };
      const io = fakeIo(files);
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

      const p1 = tree.planCards.find((pc) => pc.cardId === 'card-p1')!;
      expect(p1.fases[0].garantia).toEqual({ tipo: 'roteiro_e2e', descricao: 'Cobre o parcelamento', roteiroPath: 'specs/x/e2e-fase-1.md' });
      expect(p1.fases[1].garantia).toBeNull();
    });

    it('plano com 2 fases declaradas → 2 entradas em fases[], cada uma com implementar/validar DO DISCO daquele fase_num', () => {
      const files = {
        ...threePlanCardsFanout(),
        [planoResultPath('card-p1')]: planoManifestWithFases('card-p1', [
          { fase_num: 1, titulo: 'Tabela de coeficientes' },
          { fase_num: 2, titulo: 'Serviço de parcelas' },
        ]),
        [phaseCtxPath('implementar', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
        [phaseCtxPath('validar', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
        [phaseResultPathByFaseNum('implementar', 'card-p1', 1)]: successManifest('card-p1', 'implementar'),
        [phaseResultPathByFaseNum('validar', 'card-p1', 1)]: successManifest('card-p1', 'validar'),
        // fase 2 sem result.json — ainda não rodou.
      };
      const io = fakeIo(files);
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

      const p1 = tree.planCards.find((pc) => pc.cardId === 'card-p1')!;
      expect(p1.fases).toHaveLength(2);
      expect(p1.fases.map((f) => f.faseNum)).toEqual([1, 2]);
      expect(p1.fases.map((f) => f.titulo)).toEqual(['Tabela de coeficientes', 'Serviço de parcelas']);
      expect(p1.fases[0].implementar.status).toBe('done');
      expect(p1.fases[0].validar.status).toBe('done');
      // `ctx.md` NÃO é por fase_num (`phaseDir`/`esteiraCtxPath` ignoram
      // `faseNum` — layout do lote 2): o ctx.md de `implementar`/`validar`
      // escrito acima é COMPARTILHADO entre fase 1 e fase 2. Por isso a fase
      // 2 (sem result.json) deriva `stuck` (ctx existe, result não), nunca
      // `not-started` — quirk pré-existente do lote 2, fora do escopo deste
      // lote (nomeado no report como divergência conhecida).
      expect(p1.fases[1].implementar.status).toBe('stuck');
      expect(p1.fases[1].validar.status).toBe('stuck');
    });

    it('fases[] NÃO some com o legado phases.implementar/phases.validar (fase 1 hardcoded, preservado)', () => {
      const files = {
        ...threePlanCardsFanout(),
        [planoResultPath('card-p1')]: planoManifestWithFases('card-p1', [{ fase_num: 1 }]),
        [phaseCtxPath('implementar', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
        [phaseResultPathByFaseNum('implementar', 'card-p1', 1)]: successManifest('card-p1', 'implementar'),
      };
      const io = fakeIo(files);
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

      const p1 = tree.planCards.find((pc) => pc.cardId === 'card-p1')!;
      expect(p1.phases.implementar.status).toBe('done');
      expect(p1.fases[0].implementar.status).toBe('done');
    });

    it('cards de plano SEM outputs.fases (ex.: card-p2/p3 do fixture) não quebram os outros', () => {
      const files = {
        ...threePlanCardsFanout(),
        [planoResultPath('card-p1')]: planoManifestWithFases('card-p1', [{ fase_num: 1 }]),
      };
      const io = fakeIo(files);
      const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

      expect(tree.planCards.find((pc) => pc.cardId === 'card-p1')!.fases).toHaveLength(1);
      expect(tree.planCards.find((pc) => pc.cardId === 'card-p2')!.fases).toEqual([]);
      expect(tree.planCards.find((pc) => pc.cardId === 'card-p3')!.fases).toEqual([]);
    });
  });
});

describe('resolveArtifactPool', () => {
  it('nunca lista um path fora da constante fixa', () => {
    const io: EsteiraReaderIoDeps = { existsSync: () => true, readFileText: () => null };
    const pool = resolveArtifactPool('C:\\repo', '003-modo-dev', io);

    const allowedSuffixes = [
      'specs\\003-modo-dev\\spec.md',
      'specs\\003-modo-dev\\plan.md',
      'specs\\003-modo-dev\\tasks.md',
      'specs\\003-modo-dev\\research.md',
      'specs\\003-modo-dev\\data-model.md',
      'specs\\003-modo-dev\\contracts',
      'specs\\003-modo-dev\\e2e.md',
      'lessons.md',
      'docs\\processos',
    ];

    expect(pool.length).toBeGreaterThan(0);
    for (const candidate of pool) {
      expect(allowedSuffixes.some((suffix) => candidate.path.endsWith(suffix))).toBe(true);
    }
  });

  it('só lista os candidatos que EXISTEM (io.existsSync)', () => {
    const io: EsteiraReaderIoDeps = { existsSync: () => false, readFileText: () => null };
    const pool = resolveArtifactPool('C:\\repo', '003-modo-dev', io);
    expect(pool).toEqual([]);
  });
});
