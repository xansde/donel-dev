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

  it('allPlanCardsComplete só é true quando TODA fase concluir de TODO card de plano tem status success (CA-23)', () => {
    const files = {
      ...threePlanCardsFanout(),
      [phaseCtxPath('concluir', 'card-p1')]: '---\ncard_id: card-p1\n---\n',
      [phaseResultPath('concluir', 'card-p1')]: successManifest('card-p1', 'concluir'),
      [phaseCtxPath('concluir', 'card-p2')]: '---\ncard_id: card-p2\n---\n',
      [phaseResultPath('concluir', 'card-p2')]: successManifest('card-p2', 'concluir'),
      // card-p3 concluir: sem ctx.md — ainda não chegou lá.
    };
    const io = fakeIo(files);
    const tree = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, io);

    expect(tree.allPlanCardsComplete).toBe(false);

    const filesAllDone = {
      ...files,
      [phaseCtxPath('concluir', 'card-p3')]: '---\ncard_id: card-p3\n---\n',
      [phaseResultPath('concluir', 'card-p3')]: successManifest('card-p3', 'concluir'),
    };
    const treeAllDone = buildDiscoveryTree(ROOT, ROOT_CARD, NO_ARCHIVED, fakeIo(filesAllDone));
    expect(treeAllDone.allPlanCardsComplete).toBe(true);
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
    function planoManifestWithFases(cardId: string, fases: readonly { fase_num: number; titulo?: string }[]): string {
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
