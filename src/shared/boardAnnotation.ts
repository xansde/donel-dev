import type { DiscoveryTree, PhaseNode, PlanCardNode } from '../main/discovery-tree';
import type { BoardFacts } from '../main/taskdex-board-client';
import type { EsteiraPhase } from './devMode';
import type { PhaseStatus } from './phaseState';

// T325/T326 (003-modo-dev, Batch C) — o espelho anota a árvore (CA-12) e
// detecta divergência disco×board (CA-13, parte de detecção — a sessão de
// conciliação é T328/Batch D). 100% puro: nenhuma função aqui faz I/O nem
// persiste nada.
//
// CA-17 (009-modo-dev-v3) — `marco`/`MarcoNode` morreram: renomeado para
// `card de plano`/`PlanCardNode` (discovery-tree.ts). Consequência FORÇADA
// pelo rename (não uma correção de comportamento — essa é CA-19, lote 8, fora
// do escopo deste lote): `titleMarcoId`/`marcoIdMismatch` comparavam o `[Mx]`
// do título do card no board com `marco.marcoId`; como `marco_id` não existe
// mais em `plan_cards[]` (morto no disco pela v3), `PlanCardNode` não carrega
// mais esse campo — não há mais NADA para comparar, então a conferência sai
// junto. O resto do comportamento (inclusive `NEXT_PHASE.implementar` — que
// CA-19 aponta como mentiroso na v3, D20 do contrato: Implementar não move o
// card) fica EXATAMENTE como estava; só o vocabulário mudou.
//
// `DiscoveryTree`/`PlanCardNode`/`PhaseNode` (`../main/discovery-tree.ts`) e
// `BoardFacts` (`../main/taskdex-board-client.ts`) são importados só como
// TIPO — mesmo padrão de `shared/index.ts`: `import type` erasa no build,
// este módulo shared nunca passa a depender de `node:fs`/rede em runtime.

const ALL_PHASES: readonly EsteiraPhase[] = ['discovery', 'plano', 'implementar', 'validar', 'documentar', 'cliente', 'concluir'];

/** Fase → próxima fase esperada quando a atual termina `done`. `validar` fica de fora de propósito: por invariante da Esteira ela nunca move o card de coluna (CA-13), então não há coluna esperada a checar. `concluir` também fica de fora — é o fim da esteira, fora do escopo desta detecção. */
const NEXT_PHASE: Readonly<Partial<Record<EsteiraPhase, EsteiraPhase>>> = {
  discovery: 'plano',
  plano: 'implementar',
  implementar: 'validar',
};

function phaseIndex(value: string): number {
  return ALL_PHASES.indexOf(value as EsteiraPhase);
}

/** Os dois fatos exibidos lado a lado quando disco e board discordam (CA-13). */
export interface PhaseDivergence {
  readonly diskStatus: PhaseStatus;
  readonly boardColumn: string;
}

/**
 * CA-13 (detecção)/CA-19 — fase concluída no disco, mas o board ainda não
 * chegou (ou passou) na coluna esperada. `implementar` NÃO move o card na v3
 * (D20 do contrato: fica em Implementar até o PR da fase mergear) — está fora
 * de `NEXT_PHASE`, então nunca acusa divergência por conta própria; mesma
 * regra que já valia para `validar`.
 */
export function detectPhaseDivergence(phase: EsteiraPhase, diskStatus: PhaseStatus, boardColumn: string): PhaseDivergence | null {
  if (diskStatus !== 'done') return null;

  const expectedPhase = NEXT_PHASE[phase];
  if (!expectedPhase) return null;

  const actualIndex = phaseIndex(boardColumn);
  if (actualIndex < 0) return null; // coluna fora da esteira conhecida (ex.: "backlog") — sem base de comparação, não alarma à toa

  if (actualIndex >= phaseIndex(expectedPhase)) return null; // já chegou lá (ou foi além) — progresso normal, não divergência

  return { diskStatus, boardColumn };
}

export interface AnnotatedPhaseNode extends PhaseNode {
  /** CA-13 — `null` quando disco e board concordam (ou não há fato de board pra comparar). */
  readonly divergence: PhaseDivergence | null;
}

export interface AnnotatedPlanCardNode extends Omit<PlanCardNode, 'phases'> {
  readonly phases: Readonly<Record<EsteiraPhase, AnnotatedPhaseNode>>;
  /** Os 4 fatos do CA-12 para este card de plano; `null` = card fora do board (ou board indisponível) — nunca erro. */
  readonly boardFacts: BoardFacts | null;
}

export interface AnnotatedDiscoveryTree extends Omit<DiscoveryTree, 'planCards'> {
  readonly planCards: readonly AnnotatedPlanCardNode[];
}

function annotatePhase(phase: EsteiraPhase, node: PhaseNode, boardColumn: string | null): AnnotatedPhaseNode {
  const divergence = boardColumn === null ? null : detectPhaseDivergence(phase, node.status, boardColumn);
  return { ...node, divergence };
}

function annotatePlanCard(planCard: PlanCardNode, facts: BoardFacts | null): AnnotatedPlanCardNode {
  const phases = {} as Record<EsteiraPhase, AnnotatedPhaseNode>;
  for (const phase of ALL_PHASES) {
    phases[phase] = annotatePhase(phase, planCard.phases[phase], facts?.column ?? null);
  }

  return { ...planCard, phases, boardFacts: facts };
}

/**
 * CA-12/CA-17 — sobrepõe a cada card de plano da árvore (já montada 100% de
 * disco pelo Batch A, `discovery-tree.ts`) os fatos que o disco não sabe:
 * coluna real, trava ativa (via `lockedPhase` de `BoardFacts`), etiquetas de
 * atenção. `boardFacts` é indexado por `cardId` — **só os cards do discovery
 * em foco entram aqui**: qualquer chave extra no mapa que não corresponda a
 * um card de plano desta árvore é simplesmente ignorada. Nunca muta `tree`
 * (imutabilidade) nem persiste nada.
 */
export function annotateTree(tree: DiscoveryTree, boardFacts: Readonly<Record<string, BoardFacts>>): AnnotatedDiscoveryTree {
  return {
    ...tree,
    planCards: tree.planCards.map((planCard) => annotatePlanCard(planCard, boardFacts[planCard.cardId] ?? null)),
  };
}
