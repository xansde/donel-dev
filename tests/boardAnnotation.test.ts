import { describe, expect, it } from 'vitest';
import type { DiscoveryTree, PhaseNode, PlanCardNode } from '../src/main/discovery-tree';
import type { BoardFacts } from '../src/main/taskdex-board-client';
import type { EsteiraPhase } from '../src/shared/devMode';
import type { PhaseStatus } from '../src/shared/phaseState';
import { annotateTree, detectPhaseDivergence } from '../src/shared/boardAnnotation';

// T325/T326 (003-modo-dev, Batch C) — anotação dos fatos do CA-12 na árvore
// do discovery + detecção de divergência disco×board (CA-13, parte de
// detecção — a sessão de conciliação é T328/Batch D). Pure mapping: sem I/O,
// sem persistência.
//
// CA-17 (009-modo-dev-v3) — `marco`/`MarcoNode` → `card de plano`/
// `PlanCardNode`. A conferência `[Mx]`/`marcoIdMismatch` saiu (consequência
// FORÇADA: `marco_id` não existe mais em `plan_cards[]`, não há mais nada a
// comparar — ver comentário de topo de boardAnnotation.ts).

const ALL_PHASES: readonly EsteiraPhase[] = ['discovery', 'plano', 'implementar', 'validar', 'documentar', 'cliente', 'concluir'];

function phaseNode(phase: EsteiraPhase, status: PhaseStatus): PhaseNode {
  return {
    phase,
    status,
    artifacts: { ctxPath: '', resultPath: '', ctxExists: false, result: null, resultUnreadable: false, worktreePath: null, branch: null },
    archivedSession: null,
  };
}

function planCard(cardId: string, statuses: Partial<Record<EsteiraPhase, PhaseStatus>> = {}): PlanCardNode {
  const phases = {} as Record<EsteiraPhase, PhaseNode>;
  for (const phase of ALL_PHASES) phases[phase] = phaseNode(phase, statuses[phase] ?? 'not-started');
  return { cardId, track: 'codigo', shadow: false, phases, fases: [], synthetic: false };
}

function tree(planCards: readonly PlanCardNode[]): DiscoveryTree {
  return { discoveryCardId: 'disc-1', planCards, focusedPlanCardId: null, allPlanCardsComplete: false, discoveryStatus: 'done' };
}

function boardFacts(overrides: Partial<BoardFacts> = {}): BoardFacts {
  return {
    column: 'plano',
    title: 'Card qualquer',
    lockedPhase: null,
    attentionLabels: [],
    prUrl: null,
    prApproved: false,
    ...overrides,
  };
}

describe('annotateTree — overlay dos fatos do board (T325/CA-12)', () => {
  it('sobrepõe os fatos do board no card de plano correspondente (por cardId)', () => {
    const t = tree([planCard('card-1')]);
    const facts = boardFacts({ column: 'implementar', lockedPhase: 'implementar', attentionLabels: ['esteira:precisa-atencao'], prUrl: 'https://x/pr/1', prApproved: true });

    const annotated = annotateTree(t, { 'card-1': facts });

    expect(annotated.planCards[0].boardFacts).toEqual(facts);
  });

  it('card de plano sem fato correspondente no board → boardFacts null (nunca lança)', () => {
    const t = tree([planCard('card-1')]);
    const annotated = annotateTree(t, {});
    expect(annotated.planCards[0].boardFacts).toBeNull();
  });

  it('não altera o PhaseNode/PlanCardNode original — imutabilidade', () => {
    const t = tree([planCard('card-1', { plano: 'done' })]);
    const snapshotBefore = JSON.parse(JSON.stringify(t));

    annotateTree(t, { 'card-1': boardFacts() });

    expect(JSON.parse(JSON.stringify(t))).toEqual(snapshotBefore);
  });

  it('card fora do discovery em foco nunca entra na anotação — chaves extras do board são ignoradas (CA-12)', () => {
    const t = tree([planCard('card-1')]);
    const annotated = annotateTree(t, {
      'card-1': boardFacts(),
      'card-fora-do-foco': boardFacts({ column: 'concluir' }),
    });

    expect(annotated.planCards).toHaveLength(1);
    expect(annotated.planCards[0].cardId).toBe('card-1');
  });
});

describe('detectPhaseDivergence — detecção disco×board (T326/CA-13, ajustada ao modelo v3 no CA-19)', () => {
  it('fase done + card ainda na coluna anterior à esperada → marca divergência com os dois fatos', () => {
    const divergence = detectPhaseDivergence('plano', 'done', 'plano');
    expect(divergence).toEqual({ diskStatus: 'done', boardColumn: 'plano' });
  });

  it('CA-19 — implementar done + card ainda na coluna implementar → NÃO marca (D20 do contrato: Implementar não move o card na v3)', () => {
    expect(detectPhaseDivergence('implementar', 'done', 'implementar')).toBeNull();
  });

  it('CA-19 — implementar done + card em QUALQUER coluna → nunca marca (implementar não tem próxima coluna esperada na v3)', () => {
    expect(detectPhaseDivergence('implementar', 'done', 'plano')).toBeNull();
    expect(detectPhaseDivergence('implementar', 'done', 'validar')).toBeNull();
    expect(detectPhaseDivergence('implementar', 'done', 'backlog')).toBeNull();
  });

  it('fase validar done + card ainda na coluna de antes de Validar → NÃO marca (caso esperado pela Esteira)', () => {
    expect(detectPhaseDivergence('validar', 'done', 'implementar')).toBeNull();
  });

  it('fase concluir done → sem coluna seguinte esperada, nunca marca', () => {
    expect(detectPhaseDivergence('concluir', 'done', 'implementar')).toBeNull();
  });

  it('fase não concluída no disco → nunca marca, seja qual for a coluna', () => {
    expect(detectPhaseDivergence('implementar', 'running', 'plano')).toBeNull();
    expect(detectPhaseDivergence('implementar', 'not-started', 'plano')).toBeNull();
    expect(detectPhaseDivergence('implementar', 'failed', 'plano')).toBeNull();
    expect(detectPhaseDivergence('implementar', 'stuck', 'plano')).toBeNull();
  });

  it('card já avançou além da coluna esperada (ou até ela) → sem divergência', () => {
    expect(detectPhaseDivergence('discovery', 'done', 'plano')).toBeNull();
    expect(detectPhaseDivergence('discovery', 'done', 'validar')).toBeNull();
  });

  it('coluna do board fora da esteira conhecida (ex.: "backlog") → sem base de comparação, não alarma à toa', () => {
    expect(detectPhaseDivergence('implementar', 'done', 'backlog')).toBeNull();
  });
});

describe('annotateTree — wiring da divergência por fase (T326, ajustada ao modelo v3 no CA-19)', () => {
  it('CA-19 — fase implementar done + coluna do board ainda em implementar → SEM divergência (a v3 tornou isso normal: o card fica em Implementar até o PR mergear, D20)', () => {
    const t = tree([planCard('card-1', { implementar: 'done' })]);
    const annotated = annotateTree(t, { 'card-1': boardFacts({ column: 'implementar' }) });

    expect(annotated.planCards[0].phases.implementar.divergence).toBeNull();
  });

  it('fase plano done + coluna do board ainda em plano → PhaseNode.divergence com os dois fatos (Plano continua movendo o card, D20)', () => {
    const t = tree([planCard('card-1', { plano: 'done' })]);
    const annotated = annotateTree(t, { 'card-1': boardFacts({ column: 'plano' }) });

    expect(annotated.planCards[0].phases.plano.divergence).toEqual({ diskStatus: 'done', boardColumn: 'plano' });
  });

  it('fase validar done + coluna ainda em implementar → sem divergência (caso esperado, CA-13)', () => {
    const t = tree([planCard('card-1', { implementar: 'done', validar: 'done' })]);
    const annotated = annotateTree(t, { 'card-1': boardFacts({ column: 'implementar' }) });

    expect(annotated.planCards[0].phases.validar.divergence).toBeNull();
  });

  it('sem boardFacts (card de plano fora do board) → nenhuma fase marca divergência', () => {
    const t = tree([planCard('card-1', { implementar: 'done' })]);
    const annotated = annotateTree(t, {});

    for (const phase of ALL_PHASES) {
      expect(annotated.planCards[0].phases[phase].divergence).toBeNull();
    }
  });
});

// Achado do e2e 31/07 — "travada" tinha virado estado IMPOSSÍVEL para
// implementar/validar: `esteira-reader.ts` só crê que a fase rodou quando o
// manifesto daquele `fase_num` existe (fix do #16), e manifesto presente já
// define o status. Resultado: fase que rodou e não arquivou aparecia como
// "não iniciada" e sumia da trilha, sem o botão de liberar. A trava é
// ETIQUETA DO BOARD (D1) — e é o board que devolve esse estado à fase.
describe('annotateTree — trava do board promove a fase a "stuck"', () => {
  function faseNode(implementar: PhaseStatus, validar: PhaseStatus) {
    return {
      faseNum: 1,
      titulo: null,
      garantia: null,
      implementar: phaseNode('implementar', implementar),
      validar: phaseNode('validar', validar),
    };
  }

  it('fase não iniciada no disco + etiqueta de trava no board = travada', () => {
    const card = { ...planCard('card-1'), fases: [faseNode('not-started', 'not-started')] };
    const annotated = annotateTree(tree([card]), { 'card-1': boardFacts({ lockedPhase: 'implementar' }) });

    expect(annotated.planCards[0].fases[0].implementar.status).toBe('stuck');
    expect(annotated.planCards[0].phases.implementar.status).toBe('stuck');
    // A outra sub-fase não é tocada: a etiqueta nomeia UMA fase.
    expect(annotated.planCards[0].fases[0].validar.status).toBe('not-started');
  });

  it('só a PRIMEIRA fase não iniciada é promovida — a etiqueta não diz fase_num', () => {
    const card = {
      ...planCard('card-1'),
      fases: [faseNode('done', 'done'), faseNode('not-started', 'not-started'), faseNode('not-started', 'not-started')],
    };
    const annotated = annotateTree(tree([card]), { 'card-1': boardFacts({ lockedPhase: 'implementar' }) });

    expect(annotated.planCards[0].fases[1].implementar.status).toBe('stuck');
    expect(annotated.planCards[0].fases[2].implementar.status).toBe('not-started');
  });

  it('fase que JÁ tem status do disco não é sobrescrita pela etiqueta', () => {
    const card = { ...planCard('card-1', { implementar: 'done' }), fases: [faseNode('done', 'not-started')] };
    const annotated = annotateTree(tree([card]), { 'card-1': boardFacts({ lockedPhase: 'implementar' }) });

    expect(annotated.planCards[0].fases[0].implementar.status).toBe('done');
    expect(annotated.planCards[0].phases.implementar.status).toBe('done');
  });

  it('sem etiqueta de trava nada muda', () => {
    const card = { ...planCard('card-1'), fases: [faseNode('not-started', 'not-started')] };
    const annotated = annotateTree(tree([card]), { 'card-1': boardFacts() });

    expect(annotated.planCards[0].fases[0].implementar.status).toBe('not-started');
  });
})
