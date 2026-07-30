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
  return { cardId, track: 'codigo', shadow: false, phases };
}

function tree(planCards: readonly PlanCardNode[]): DiscoveryTree {
  return { discoveryCardId: 'disc-1', planCards, focusedPlanCardId: null, allPlanCardsComplete: false };
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

describe('detectPhaseDivergence — detecção disco×board (T326/CA-13)', () => {
  it('fase done + card ainda na coluna anterior à esperada → marca divergência com os dois fatos', () => {
    const divergence = detectPhaseDivergence('implementar', 'done', 'implementar');
    expect(divergence).toEqual({ diskStatus: 'done', boardColumn: 'implementar' });
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

describe('annotateTree — wiring da divergência por fase (T326)', () => {
  it('fase implementar done + coluna do board ainda em implementar → PhaseNode.divergence com os dois fatos', () => {
    const t = tree([planCard('card-1', { implementar: 'done' })]);
    const annotated = annotateTree(t, { 'card-1': boardFacts({ column: 'implementar' }) });

    expect(annotated.planCards[0].phases.implementar.divergence).toEqual({ diskStatus: 'done', boardColumn: 'implementar' });
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
