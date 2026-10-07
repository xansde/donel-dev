/**
 * Física compartilhada pelas 3 abas (a bancada compara MOTOR DE RENDER, não
 * física — as três abas usam a mesma simulação `d3-force`).
 *
 * Reproduz D-M1 (viés horizontal por profundidade no grafo — "o tempo corre
 * da esquerda para a direita") via `forceX` por coluna, com `forceY` fraco
 * só para não colapsar tudo numa linha.
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { BenchEdge, BenchGraph, BenchNode, BenchSize } from './benchGraph';

export const RADIUS_BY_SIZE: Record<BenchSize, number> = {
  lg: 16,
  md: 10,
  sm: 5,
};

const COLUMN_WIDTH = 150;
const LINK_DISTANCE = 60;
const CHARGE_STRENGTH = -120;
const COLLIDE_LABEL_PADDING = 14;
const COLUMN_STRENGTH = 0.5;
const CENTER_Y_STRENGTH = 0.05;

/**
 * Profundidade BFS: distância mínima até QUALQUER nó sem aresta de entrada
 * (raiz). Grafo com múltiplas raízes → cada uma começa em 0, BFS parte de
 * todas simultaneamente (fila multi-fonte), então convergência (diamante)
 * fica com a MENOR distância entre os caminhos. Nó isolado (sem aresta
 * nenhuma) também não tem aresta de entrada, então também é raiz → 0.
 *
 * Função pura: não muta `nodes`/`edges`, não depende de estado externo.
 */
export function computeDepth(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ from: string; to: string }>,
): Map<string, number> {
  const hasIncoming = new Set<string>();
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    hasIncoming.add(edge.to);
    const list = outgoing.get(edge.from);
    if (list) {
      list.push(edge.to);
    } else {
      outgoing.set(edge.from, [edge.to]);
    }
  }

  const depth = new Map<string, number>();
  const queue: string[] = [];

  for (const node of nodes) {
    if (!hasIncoming.has(node.id)) {
      depth.set(node.id, 0);
      queue.push(node.id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const currentDepth = depth.get(current)!;
    const neighbors = outgoing.get(current) ?? [];
    for (const next of neighbors) {
      const candidate = currentDepth + 1;
      const known = depth.get(next);
      if (known === undefined || candidate < known) {
        depth.set(next, candidate);
        queue.push(next);
      }
    }
  }

  // Nós alcançáveis só por ciclo (sem raiz no caminho) nunca entram na fila
  // acima — fallback defensivo: profundidade 0, não deixamos undefined.
  for (const node of nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, 0);
    }
  }

  return depth;
}

export interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  desc: string | null;
  size: BenchSize;
  state: BenchNode['state'];
  radius: number;
  depth: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  from: string;
  to: string;
}

export interface ForceLayoutResult {
  simulation: Simulation<SimNode, SimLink>;
  nodes: SimNode[];
  links: SimLink[];
}

/**
 * Cria (e já inicia) a simulação de força compartilhada. Quem chama decide
 * se usa o resultado AO VIVO (aba A, tick a tick) ou roda `simulation.stop()`
 * após N ticks e usa só a posição final (abas B e C).
 */
export function createForceLayout(graph: BenchGraph): ForceLayoutResult {
  const depthById = computeDepth(graph.nodes, graph.edges);

  const nodes: SimNode[] = graph.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    desc: node.desc,
    size: node.size,
    state: node.state,
    radius: RADIUS_BY_SIZE[node.size],
    depth: depthById.get(node.id) ?? 0,
  }));

  const links: SimLink[] = graph.edges.map((edge: BenchEdge) => ({
    from: edge.from,
    to: edge.to,
    source: edge.from,
    target: edge.to,
  }));

  const simulation = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((n) => n.id)
        .distance(LINK_DISTANCE),
    )
    .force('charge', forceManyBody<SimNode>().strength(CHARGE_STRENGTH))
    .force(
      'collide',
      forceCollide<SimNode>((n) => n.radius + COLLIDE_LABEL_PADDING),
    )
    .force(
      'x',
      forceX<SimNode>((n) => n.depth * COLUMN_WIDTH).strength(COLUMN_STRENGTH),
    )
    .force('y', forceY<SimNode>(0).strength(CENTER_Y_STRENGTH));

  return { simulation, nodes, links };
}

/**
 * Roda a simulação até estabilizar (sem renderizar tick a tick) e devolve
 * as posições finais. Usado pelas abas que não têm física "ao vivo" (B e C).
 */
export function runToStable(graph: BenchGraph, ticks = 300): ForceLayoutResult {
  const result = createForceLayout(graph);
  result.simulation.stop();
  for (let i = 0; i < ticks; i += 1) {
    result.simulation.tick();
  }
  return result;
}
