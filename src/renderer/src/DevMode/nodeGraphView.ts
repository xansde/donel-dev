// Spec 010 / batch N7 (D1) — o mapa de nós: OUTRA projeção do mesmo
// `StoreSnapshot` que já alimenta `esteiraMapView.ts` (o carrossel) e
// `esteiraView.ts` (o painel do store). Nenhum modelo novo: o snapshot já é um
// grafo (`relations[]`, `artifacts[]`, `verifications[]`) — este módulo só
// escolhe outra forma de olhar para ele, de ponta a ponta, em vez de um card
// por vez.
//
// PURO de propósito (sem React, sem SVG, sem pixel): devolve nós e arestas com
// profundidade (`column`, de uma BFS a partir de cada discovery) — quem
// converte profundidade em coordenada de tela é o componente
// (`NodeGraphOverlay.tsx`). Textos de estado são IMPORTADOS de `esteiraView.ts`
// sempre que já existem lá (`itemMeta`, `stageView`, `verificationLines`,
// `isItemClosed`, `signalViews`) — reescrever frase aqui foi o defeito que
// reapareceu três vezes neste repo (ver `esteiraMapView.ts`, regra 1).
//
// O que este módulo escreve por conta própria é só o que NENHUM outro export
// já resolve: o resumo de um card sem problema declarado, o rótulo de um
// artefato/verificação e o desvio "item sem plano" — versões locais mínimas,
// deliberadamente pequenas, registradas para unificação na integração (ver
// handoff do batch).

import {
  cardView,
  isItemClosed,
  itemMeta,
  signalViews,
  stageView,
  verificationLines,
  WORK_ITEM_STATE_LABEL,
  type CardView,
} from '../Esteira/esteiraView';
import { LIFECYCLE_BY_ITEM_TYPE } from '../../../shared/esteira/store/storeFormat';
import type {
  ArtifactPointer,
  DiscoverySnapshot,
  EntityId,
  LifecycleKind,
  LockRecord,
  PlanSnapshot,
  StoreSnapshot,
  VerificationKind,
  VerificationSnapshot,
  VerificationState,
  WorkItemSnapshot,
} from '../../../shared/esteira/store/storeFormat';
import type { MapSelection } from './esteiraMapView';

export type GraphNodeKind = 'discovery' | 'plan' | 'work_item' | 'artifact' | 'verification';

/**
 * As três relações do contrato (`originou`/`desagua-em`/`entra-junto`) MAIS
 * duas que este mapa precisa para desenhar os nós-folha: a aresta até um
 * artefato e até uma verificação não são "relação" no sentido do contrato
 * (não têm `relation.recorded` próprio — nascem de `owner`/`subject`), mas
 * são aresta no grafo igual às outras.
 */
export type GraphEdgeKind = 'originated' | 'flows_into' | 'ships_with' | 'artifact' | 'verification';

export type GraphTone = 'muted' | 'accent' | 'ok' | 'warn' | 'error' | 'lock';

export interface GraphDeviation {
  readonly label: string;
  readonly title: string;
}

export interface GraphNode {
  readonly key: string;
  readonly kind: GraphNodeKind;
  /** F5 — nunca o id cru (`dsc-...`/`pln-...`/`wi-...`); sempre o nome humano. */
  readonly title: string;
  /** Linha curta sempre visível: tipo/ciclo/estado do item, etapa do card, etc. */
  readonly badge: string;
  /** O resumo de UMA frase que o hover mostra. */
  readonly summary: string;
  readonly tone: GraphTone;
  /** Desvio sinalizado (ex.: item sem plano). `null` = nada fora do esperado. */
  readonly deviation: GraphDeviation | null;
  /** Profundidade da BFS a partir do(s) discovery(s) — a COLUNA do layout em camadas. */
  readonly column: number;
  /** Para onde o clique leva o carrossel/esteira — o mesmo alvo de seleção que ele já usa. */
  readonly navigateTo: MapSelection;
}

export interface GraphEdge {
  readonly key: string;
  readonly kind: GraphEdgeKind;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export interface NodeGraphView {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** `maior coluna + 1` — quantas colunas o layout precisa. 0 quando vazio. */
  readonly columns: number;
  /** O vazio é honesto, mesmo vocabulário do carrossel (D-2): nada sumiu. */
  readonly empty: string | null;
}

export const NODE_GRAPH_EMPTY = 'Nenhum card ainda. O mapa de nós nasce vazio — nada foi importado do modelo antigo.';

const EDGE_LABEL: Readonly<Record<GraphEdgeKind, string>> = {
  originated: 'originou',
  flows_into: 'deságua em',
  ships_with: 'entra junto',
  artifact: 'gerou o artefato',
  verification: 'fecha com',
};

/** Rótulo curto do ciclo de vida (D-4) — versão LOCAL mínima; `LIFECYCLE_CLOSURE` de `esteiraView.ts` não é exportado e é frase longa, não rótulo de nó. */
const LIFECYCLE_LABEL: Readonly<Record<LifecycleKind, string>> = {
  'code-delivery': 'entrega de código',
  'reviewed-artifact': 'artefato revisado',
  'answered-question': 'pergunta respondida',
};

// `WORK_ITEM_STATE_LABEL` NÃO tem versão local: já é exportada por
// `esteiraView.ts` (import acima) — reescrevê-la aqui seria a MESMA frase
// nascendo de duas fontes, o defeito que este arquivo existe para evitar.

const VERIFICATION_KIND_LABEL: Readonly<Record<VerificationKind, string>> = {
  'pull-request': 'Pull request',
  check: 'Verificação',
  review: 'Revisão',
  conclusion: 'Conclusão',
  // A16 — o roteiro rodado A MÃO por gente, distinto do `check` que a máquina
  // roda. Rótulo curto de nó; a frase inteira (que diz se foi rodado ou só
  // escrito) é de `esteiraView.ts`, e o nó a mostra no resumo do rodapé.
  'e2e-manual': 'Roteiro e2e',
};

const VERIFICATION_STATE_BADGE: Readonly<Record<VerificationState, string>> = {
  pending: 'pendente',
  passed: 'passou',
  failed: 'falhou',
};

const ORPHAN_ITEM_DEVIATION: GraphDeviation = {
  label: 'sem plano',
  title: 'Este item não pertence a nenhum plano deste card.',
};

function entityKeyOf(subject: EntityId): string {
  return `${subject.entity}:${subject.id}`;
}

function lockOf(card: CardView, subject: EntityId): LockRecord | null {
  return card.locks.find((lock) => lock.subject.entity === subject.entity && lock.subject.id === subject.id) ?? null;
}

/** O que o clique leva ao carrossel/esteira — o MESMO alvo de seleção que ele já usa (nunca um segundo modelo de navegação). */
function navigateToFor(card: CardView, subject: EntityId): MapSelection {
  if (subject.entity === 'discovery') {
    return { discoveryId: card.discovery.id, planId: null, itemId: null, nodeKey: entityKeyOf(subject), phase: null };
  }
  if (subject.entity === 'plan') {
    return { discoveryId: card.discovery.id, planId: subject.id, itemId: null, nodeKey: entityKeyOf(subject), phase: null };
  }
  const item = card.items.find((entry) => entry.id === subject.id);
  return { discoveryId: card.discovery.id, planId: item?.planId ?? null, itemId: subject.id, nodeKey: entityKeyOf(subject), phase: null };
}

interface RawNode {
  readonly key: string;
  readonly kind: GraphNodeKind;
  readonly title: string;
  readonly badge: string;
  readonly summary: string;
  readonly tone: GraphTone;
  readonly deviation: GraphDeviation | null;
  readonly navigateTo: MapSelection;
  /** Índice do discovery-raiz deste nó em `snapshot.discoveries` — só para agrupar visualmente por card, nunca para decidir profundidade. */
  readonly rootIndex: number;
}

interface RawEdge {
  readonly key: string;
  readonly kind: GraphEdgeKind;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

function discoveryTitle(discovery: DiscoverySnapshot): string {
  // F5 — mesmo com o contrato exigindo `title` não-vazio, a defesa nunca cai
  // para o id cru: um card corrompido mostra uma frase humana, não `dsc-...`.
  return discovery.title.trim().length > 0 ? discovery.title : 'Discovery sem título';
}

function planTitle(plan: PlanSnapshot): string {
  return plan.title.trim().length > 0 ? plan.title : 'Plano sem título';
}

function itemTitle(item: WorkItemSnapshot): string {
  return item.title.trim().length > 0 ? item.title : 'Item sem título';
}

function discoveryNode(card: CardView, rootIndex: number): RawNode {
  const subject: EntityId = { entity: 'discovery', id: card.discovery.id };
  const signals = signalViews(card.discovery);
  // O pior sinal vence — mesmo critério de tom que o resto do app usa
  // (erro > atenção). Reaproveita `signalViews` (exportado): nenhuma frase de
  // desvio nasce de novo aqui.
  const deviation = signals.find((signal) => signal.tone === 'error') ?? signals.find((signal) => signal.tone === 'attention');
  const lock = lockOf(card, subject);
  const tone: GraphTone =
    deviation !== undefined
      ? deviation.tone === 'error'
        ? 'error'
        : 'warn'
      : lock !== null
        ? 'lock'
        : card.discovery.derivedStage === 'done'
          ? 'ok'
          : card.discovery.derivedStage === 'execution'
            ? 'accent'
            : 'muted';

  return {
    key: entityKeyOf(subject),
    kind: 'discovery',
    title: discoveryTitle(card.discovery),
    badge: stageView(card.discovery).shown,
    // Local mínima de propósito (ver cabeçalho do arquivo): `detailFor` de
    // `esteiraMapView.ts` tem a mesma ideia, mas não é exportada.
    summary: card.discovery.problem ?? 'Sem problema declarado.',
    tone,
    deviation: deviation === undefined ? null : { label: deviation.label, title: deviation.title },
    navigateTo: navigateToFor(card, subject),
    rootIndex,
  };
}

function planNode(card: CardView, plan: PlanSnapshot, rootIndex: number): RawNode {
  const subject: EntityId = { entity: 'plan', id: plan.id };
  const lock = lockOf(card, subject);
  const itens = card.items.filter((item) => item.planId === plan.id);
  const fechados = itens.filter((item) => isItemClosed(item)).length;
  const tone: GraphTone = lock !== null ? 'lock' : itens.length > 0 && fechados === itens.length ? 'ok' : 'muted';

  return {
    key: entityKeyOf(subject),
    kind: 'plan',
    title: planTitle(plan),
    badge: itens.length === 1 ? '1 item' : `${itens.length} itens`,
    summary: plan.summary ?? 'Sem resumo declarado.',
    tone,
    deviation: null,
    navigateTo: navigateToFor(card, subject),
    rootIndex,
  };
}

function itemNode(card: CardView, item: WorkItemSnapshot, rootIndex: number): RawNode {
  const subject: EntityId = { entity: 'work_item', id: item.id };
  const lock = lockOf(card, subject);
  const orphan = item.planId === null;
  const tone: GraphTone = orphan
    ? 'warn'
    : isItemClosed(item)
      ? 'ok'
      : lock !== null
        ? 'lock'
        : item.state === 'in-progress'
          ? 'accent'
          : 'muted';

  return {
    key: entityKeyOf(subject),
    kind: 'work_item',
    title: itemTitle(item),
    // (a) — tipo/ciclo/estado, os três juntos: é o que distingue um item no mapa.
    badge: `${item.itemType} · ${LIFECYCLE_LABEL[LIFECYCLE_BY_ITEM_TYPE[item.itemType]]} · ${WORK_ITEM_STATE_LABEL[item.state]}`,
    // Reaproveita `itemMeta` (exportado) — a MESMA frase que o card e o
    // carrossel já usam para este item, não uma segunda redação.
    summary: itemMeta(item, card.discovery, lock),
    tone,
    deviation: orphan ? ORPHAN_ITEM_DEVIATION : null,
    navigateTo: navigateToFor(card, subject),
    rootIndex,
  };
}

function artifactNode(card: CardView, artifact: ArtifactPointer, rootIndex: number): RawNode {
  const ownerKey = entityKeyOf(artifact.owner);
  const key = `artifact:${ownerKey}:${artifact.artifactKind}:${artifact.path}`;
  const local = artifact.location === 'repo' ? `no repo ${artifact.repo ?? '—'}` : 'só no disco';

  return {
    key,
    kind: 'artifact',
    title: artifact.artifactKind,
    badge: local,
    summary: `${artifact.artifactKind} · ${local} · ${artifact.path}`,
    tone: 'muted',
    deviation: null,
    navigateTo: navigateToFor(card, artifact.owner),
    rootIndex,
  };
}

/** `verificationLines` já resolve texto+estado; aqui só se monta o NÓ em cima do que ela devolve, na mesma ordem de `card.verifications`. */
function verificationNode(card: CardView, verification: VerificationSnapshot, line: { text: string; failed: boolean }, rootIndex: number): RawNode {
  const subjectKey = entityKeyOf(verification.subject);
  const key = `verification:${subjectKey}:${verification.verificationKind}:${verification.ref ?? ''}`;
  const deviation: GraphDeviation | null = verification.state === 'failed' ? { label: 'falhou', title: line.text } : null;

  return {
    key,
    kind: 'verification',
    title: VERIFICATION_KIND_LABEL[verification.verificationKind],
    badge: VERIFICATION_STATE_BADGE[verification.state],
    summary: line.text,
    tone: verification.state === 'failed' ? 'error' : verification.state === 'passed' ? 'ok' : 'muted',
    deviation,
    navigateTo: navigateToFor(card, verification.subject),
    rootIndex,
  };
}

/** BFS multi-fonte: todo discovery nasce na coluna 0; profundidade é o caminho mais curto por QUALQUER aresta (estrutural ou relação explícita) — o mesmo grafo, uma métrica só. */
function bfsColumns(nodeKeys: readonly string[], discoveryKeys: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const key of discoveryKeys) {
    depth.set(key, 0);
    queue.push(key);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const currentDepth = depth.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, currentDepth + 1);
      queue.push(next);
    }
  }
  // Rede de segurança: nó nunca alcançado pela BFS (não deveria existir, dado
  // que todo nó nasce de uma aresta estrutural do seu próprio dono) cai na
  // coluna 0 em vez de travar o layout.
  for (const key of nodeKeys) {
    if (!depth.has(key)) depth.set(key, 0);
  }
  return depth;
}

/**
 * O grafo inteiro, a partir do snapshot — TODOS os discoveries, não um card
 * por vez (é para "acompanhar o trabalho" de ponta a ponta que o mapa existe).
 * Layout por camadas feito à mão: BFS a partir de cada discovery, coluna =
 * profundidade. Nenhuma biblioteca de grafo — a função devolve nó e aresta
 * com profundidade; pixel é do componente.
 */
export function buildNodeGraph(snapshot: StoreSnapshot | null): NodeGraphView {
  if (snapshot === null || snapshot.discoveries.length === 0) {
    return { nodes: [], edges: [], columns: 0, empty: NODE_GRAPH_EMPTY };
  }

  const rawNodes = new Map<string, RawNode>();
  const rawEdges = new Map<string, RawEdge>();

  function addEdge(kind: GraphEdgeKind, from: string, to: string): void {
    if (!rawNodes.has(from) || !rawNodes.has(to)) return; // nunca aponta para um nó que não existe
    const key = `${kind}|${from}|${to}`;
    if (rawEdges.has(key)) return;
    rawEdges.set(key, { key, kind, label: EDGE_LABEL[kind], from, to });
  }

  const cards = snapshot.discoveries
    .map((discovery, index) => ({ card: cardView(snapshot, discovery.id), index }))
    .filter((entry): entry is { card: CardView; index: number } => entry.card !== null);

  // Passo 1 — todo nó "de domínio" (discovery/plano/item), que é quem os
  // artefatos/verificações apontam como dono.
  for (const { card, index } of cards) {
    const discovery = discoveryNode(card, index);
    rawNodes.set(discovery.key, discovery);

    for (const plan of card.plans) {
      rawNodes.set(entityKeyOf({ entity: 'plan', id: plan.id }), planNode(card, plan, index));
    }
    for (const item of card.items) {
      rawNodes.set(entityKeyOf({ entity: 'work_item', id: item.id }), itemNode(card, item, index));
    }
  }

  // Passo 2 — as arestas estruturais (a hierarquia já existe nas FKs do
  // snapshot: discoveryId/planId) MAIS os nós-folha (artefato/verificação),
  // que pendem de quem os declarou.
  for (const { card, index } of cards) {
    const discoveryKey = entityKeyOf({ entity: 'discovery', id: card.discovery.id });

    for (const plan of card.plans) {
      addEdge('originated', discoveryKey, entityKeyOf({ entity: 'plan', id: plan.id }));
    }
    for (const item of card.items) {
      const parentKey = item.planId === null ? discoveryKey : entityKeyOf({ entity: 'plan', id: item.planId });
      addEdge('originated', parentKey, entityKeyOf({ entity: 'work_item', id: item.id }));
    }
    for (const artifact of card.artifacts) {
      const node = artifactNode(card, artifact, index);
      rawNodes.set(node.key, node);
      addEdge('artifact', entityKeyOf(artifact.owner), node.key);
    }

    const lines = verificationLines(card);
    card.verifications.forEach((verification, lineIndex) => {
      const line = lines[lineIndex];
      const node = verificationNode(card, verification, { text: line?.text ?? '', failed: line?.failed ?? false }, index);
      rawNodes.set(node.key, node);
      addEdge('verification', entityKeyOf(verification.subject), node.key);
    });
  }

  // Passo 3 — as relações EXPLÍCITAS do contrato (originou/deságua em/entra
  // junto). Deduplicadas contra o passo 2 pela MESMA chave (kind|from|to): uma
  // "originated" declarada por igual à estrutural não vira duas arestas.
  for (const relation of snapshot.relations) {
    addEdge(relation.relation, entityKeyOf(relation.from), entityKeyOf(relation.to));
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of rawEdges.values()) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const discoveryKeys = cards.map(({ card }) => entityKeyOf({ entity: 'discovery', id: card.discovery.id }));
  const columnByKey = bfsColumns([...rawNodes.keys()], discoveryKeys, adjacency);

  const KIND_RANK: Readonly<Record<GraphNodeKind, number>> = { discovery: 0, plan: 1, work_item: 2, artifact: 3, verification: 4 };
  const nodes: GraphNode[] = [...rawNodes.values()]
    .map((node) => ({ ...node, column: columnByKey.get(node.key) ?? 0 }))
    .sort((a, b) => a.rootIndex - b.rootIndex || a.column - b.column || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.key.localeCompare(b.key))
    .map(({ rootIndex: _rootIndex, ...node }) => node);

  const columns = nodes.reduce((max, node) => Math.max(max, node.column + 1), 0);

  return { nodes, edges: [...rawEdges.values()], columns, empty: null };
}
