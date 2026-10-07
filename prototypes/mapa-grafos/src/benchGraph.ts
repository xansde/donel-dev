/**
 * Modelo neutro de bancada (shape comum às 3 abas e aos 3 datasets).
 *
 * Diferente de `NeutralNode`/`NeutralGraph` do adapter (que fala o
 * vocabulário do `esteira.grafo`: kind gate|fase|artefato|nota, sem estado),
 * `BenchNode`/`BenchEdge` já carregam ESTADO e TAMANHO — o que a forma
 * fixada (D-M1..D-M8) exige desenhar: círculos coloridos por estado, raios
 * por papel (fase/gate grande, task médio, arquivo pequeno).
 */

export type BenchSize = 'lg' | 'md' | 'sm';

export type BenchState = 'ok' | 'run' | 'wait' | 'block' | 'future';

export interface BenchNode {
  id: string;
  title: string;
  desc: string | null;
  size: BenchSize;
  state: BenchState;
}

export interface BenchEdge {
  from: string;
  to: string;
}

export interface BenchGraph {
  nodes: BenchNode[];
  edges: BenchEdge[];
}

import type { NeutralGraph, NeutralNode } from './adapter';

/**
 * Converte o modelo neutro do `esteira.grafo` (dataset 1 — "Fluxo canônico")
 * para o shape de bancada. O grafo-mesa.json não carrega estado, então todo
 * nó nasce `future`; o raio vem do `kind`: gate/fase → grande, nota → médio,
 * artefato → pequeno.
 */
export function neutralToBench(graph: NeutralGraph): BenchGraph {
  const nodes: BenchNode[] = graph.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    desc: node.note ?? node.handoff ?? null,
    size: sizeForKind(node.kind),
    state: 'future',
  }));

  const edges: BenchEdge[] = graph.edges.map((edge) => ({ from: edge.from, to: edge.to }));

  return { nodes, edges };
}

function sizeForKind(kind: NeutralNode['kind']): BenchSize {
  switch (kind) {
    case 'gate':
    case 'fase':
      return 'lg';
    case 'nota':
      return 'md';
    case 'artefato':
      return 'sm';
    default:
      return 'sm';
  }
}
