// Spec 010 / batch F25 — o CÁLCULO de posição do mapa de nós, extraído do
// componente. PURO de propósito, igual a `nodeGraphView.ts`: recebe os nós já
// projetados (com `column`, a profundidade da BFS) e devolve coordenadas de
// mundo determinísticas, sem tocar React nem `@xyflow/react`. O motor de
// desenho (React Flow) só consome o resultado — layout em camadas continua
// sendo feito à mão, como já era no overlay SVG anterior; o que mudou é só o
// motor que RENDERIZA o resultado, não quem o calcula.
//
// Ordem de entrada importa: `buildNodeGraph` já devolve os nós ordenados por
// (rootIndex, column, tipo, key) — este módulo não reordena nada, só empilha
// verticalmente cada nó dentro da sua própria coluna, na ordem em que chegou.

import type { GraphNode } from './nodeGraphView';

/** Largura de cada coluna (profundidade da BFS) em unidades de mundo do React Flow. */
export const LAYOUT_COLUMN_WIDTH = 280;
/** Altura de cada linha dentro de uma coluna. */
export const LAYOUT_ROW_HEIGHT = 104;
/** Dimensões do card do nó — usadas pelo componente para desenhar o retângulo. */
export const LAYOUT_NODE_WIDTH = 220;
export const LAYOUT_NODE_HEIGHT = 76;

export interface LayoutPosition {
  readonly x: number;
  readonly y: number;
}

export interface LaidOutNode {
  readonly node: GraphNode;
  readonly position: LayoutPosition;
}

export interface NodeGraphLayout {
  readonly nodes: readonly LaidOutNode[];
  /** Largura total do mundo — só informativo (React Flow usa `fitView`, não isto). */
  readonly width: number;
  readonly height: number;
}

/**
 * Layout em camadas: coluna = `node.column` (BFS a partir dos discoveries,
 * já resolvida por `buildNodeGraph`); linha = ordem de chegada DENTRO da
 * própria coluna (nós de colunas diferentes intercalados na lista de entrada
 * não se atrapalham — cada coluna mantém seu próprio contador de linha).
 */
export function layoutNodeGraph(nodes: readonly GraphNode[]): NodeGraphLayout {
  const rowByColumn = new Map<number, number>();
  let maxColumn = -1;

  const laidOut: LaidOutNode[] = nodes.map((node) => {
    const row = rowByColumn.get(node.column) ?? 0;
    rowByColumn.set(node.column, row + 1);
    if (node.column > maxColumn) maxColumn = node.column;
    return {
      node,
      position: { x: node.column * LAYOUT_COLUMN_WIDTH, y: row * LAYOUT_ROW_HEIGHT },
    };
  });

  const maxRows = rowByColumn.size === 0 ? 0 : Math.max(...rowByColumn.values());
  const width = maxColumn < 0 ? 0 : (maxColumn + 1) * LAYOUT_COLUMN_WIDTH;
  const height = maxRows * LAYOUT_ROW_HEIGHT;

  return { nodes: laidOut, width, height };
}
