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
//
// CA-19 (009-modo-dev-v3, lote 8) — a detecção parava de acusar "[Mx]"
// (conferência já morta desde o lote 2, nada sobrou pra remover aqui) mas
// ainda mentia sobre Implementar: `NEXT_PHASE.implementar = 'validar'`
// assumia que a fase Implementar move o card, ficção da v2. No contrato v3
// (`006-esteira-v3/contracts/handoff-v3.md` §B/§C — "Quem move o quê"):
// Implementar NÃO move o card ("esteira-implementar NÃO move... o card fica
// em Implementar até o PR da fase ser mergeado em staging", D20); quem move
// Implementar → Validar é `esteira-validar`, ao confirmar o merge por `gh`.
// Todo card com a fase implementar concluída no disco acendia "divergência
// disco×board" mesmo com o card corretamente parado em Implementar — o card
// orquestrador de lote (`esteira:orquestrador`) tem o mesmo "fica onde está,
// de propósito" no §B, mas nunca precisou de tratamento aqui: ele é o
// `discoveryCardId` da árvore, nunca um dos `planCards` que este módulo
// percorre (`readDiscoveryPlanCards`, esteira-reader.ts, só lê `plan_cards[]`
// — a capa do lote não entra nessa lista).

const ALL_PHASES: readonly EsteiraPhase[] = ['discovery', 'plano', 'implementar', 'validar', 'documentar', 'cliente', 'concluir'];

/**
 * Fase → próxima COLUNA esperada quando a fase termina `done` no disco
 * (contrato §B, "Quem move o quê"). Só entram fases que a Esteira MOVE
 * sozinha para uma coluna seguinte determinística:
 * - `discovery` → `plano` (`esteira-discovery` move; track documental vai pra
 *   `documentar`, mas "chegou pelo menos em `plano`" — índice ≥ — não acusa
 *   esse ramo, CA-14/C4: sem base de comparação não alarma à toa).
 * - `plano` → `implementar` (`esteira-plano` move, sempre).
 * `implementar` fica de fora (CA-19/D20 — não move: fica na coluna
 * Implementar até o PR mergear, e é `esteira-validar` quem move, com três
 * transições condicionais que não têm "a próxima coluna" única). `validar`
 * fica de fora pelo mesmo motivo que já valia antes (três destinos possíveis:
 * Implementar de volta, Validação com Cliente, ou Concluído — nenhum
 * determinístico o bastante pra virar uma linha desta tabela). `concluir`
 * fica de fora — é o fim da esteira, fora do escopo desta detecção.
 */
const NEXT_PHASE: Readonly<Partial<Record<EsteiraPhase, EsteiraPhase>>> = {
  discovery: 'plano',
  plano: 'implementar',
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
 * CA-13 (detecção)/CA-19 (regra v3) — fase concluída no disco, mas o board
 * ainda não chegou (ou passou) na coluna esperada por `NEXT_PHASE`. `implementar`
 * NÃO move o card na v3 (D20 do contrato: fica em Implementar até o PR da
 * fase mergear) — está fora de `NEXT_PHASE`, então nunca acusa divergência
 * por conta própria; mesma regra que já valia para `validar`.
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

/**
 * Achado do e2e 31/07 — a trava do board é o que devolve o estado
 * **travada** a implementar/validar. O disco sozinho não consegue mais
 * expressá-lo: desde o fix do #16, `esteira-reader.ts` só crê que a fase
 * rodou quando existe o manifesto daquele `fase_num` — e manifesto presente
 * já define o status. Sem esta promoção, a fase que rodou e não arquivou
 * aparece como "não iniciada", some da trilha e leva junto o botão de
 * liberar.
 *
 * Só promove quem está `not-started`: status vindo do disco é fato mais forte
 * que a etiqueta e nunca é sobrescrito. E só a PRIMEIRA fase não iniciada
 * daquele tipo — a etiqueta nomeia a fase (`implementar`), não o `fase_num`,
 * então a que está em andamento é a próxima da fila, nunca todas.
 */
function promoteLockedToStuck<T extends { readonly status: PhaseStatus }>(node: T, locked: boolean): T {
  return locked && node.status === 'not-started' ? { ...node, status: 'stuck' as PhaseStatus } : node;
}

function annotatePlanCard(planCard: PlanCardNode, facts: BoardFacts | null): AnnotatedPlanCardNode {
  const lockedPhase = facts?.lockedPhase ?? null;

  const phases = {} as Record<EsteiraPhase, AnnotatedPhaseNode>;
  for (const phase of ALL_PHASES) {
    const node = promoteLockedToStuck(planCard.phases[phase], phase === lockedPhase);
    phases[phase] = annotatePhase(phase, node, facts?.column ?? null);
  }

  let alreadyPromoted = false;
  const fases = planCard.fases.map((fase) => {
    if (!lockedPhase || alreadyPromoted) return fase;
    if (lockedPhase !== 'implementar' && lockedPhase !== 'validar') return fase;

    const promoted = promoteLockedToStuck(fase[lockedPhase], true);
    if (promoted === fase[lockedPhase]) return fase;
    alreadyPromoted = true;
    return { ...fase, [lockedPhase]: promoted };
  });

  return { ...planCard, phases, fases, boardFacts: facts };
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
