// 012 Esteira 4.0 / wi-esteira4-mapa-grafos — a FÍSICA do mapa de nós (motor
// A, d3-force + SVG próprio, ratificado em `specs/012-esteira-4/
// mapa-grafos-escolha.md`). Portada da bancada (`prototypes/mapa-grafos/src/
// forceLayout.ts`) com as divergências que o diagrama de arquitetura nomeia:
//
// - A profundidade É o `column` (BFS) que `nodeGraphView.ts` já entrega — o
//   `computeDepth` da bancada NÃO foi portado. Um cálculo de profundidade só,
//   no módulo que já tem teste (divergência 1 do diagrama).
// - A simulação nasce PARADA (`.stop()` na criação): sob StrictMode o
//   double-mount cria e descarta uma instância — se ela nascesse rodando, os
//   ~300 ticks órfãos rodariam em paralelo com a boa (aviso 1 herdado da
//   bancada). Quem monta o componente dá `alpha(1).restart()` DENTRO do
//   effect, e `stop()` no cleanup.
//
// PURO de React e de pixel de tela: devolve nós/links mutáveis pela simulação
// (x/y são do d3) — desenhar é do componente (`NodeGraphOverlay.tsx`).

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
import type { GraphEdge, GraphNode, GraphNodeKind, GraphTone } from './nodeGraphView';

/**
 * D-M3 — fases/gates (discovery, plano) são os nós grandes; cada task/item é
 * um nó médio; artefato e verificação são os satélites pequenos. Mesmos raios
 * lg/md/sm da bancada ratificada.
 */
export const RADIUS_BY_KIND: Readonly<Record<GraphNodeKind, number>> = {
  discovery: 16,
  plan: 16,
  work_item: 10,
  artifact: 5,
  verification: 5,
};

/**
 * D-M2 — o estado é lido pela cor. A FONTE do estado segue sendo o `tone` da
 * projeção (nenhuma frase ou cor de estado nasce no componente); aqui só se
 * nomeia a classe CSS que pinta cada tom. Os seis tons cobrem os cinco
 * estados de D-M2: ok=concluído · accent=rodando · warn=esperando o dono ·
 * error/lock=travado (falha e trava, dois vermelhos distintos do app) ·
 * muted=ainda não começou (cinza vazado). O contrato classe×CSS é travado por
 * teste (`tests/nodeGraphStateClasses.test.ts`) — regressão real da bancada.
 */
export const TONE_CLASS: Readonly<Record<GraphTone, string>> = {
  muted: 'toneMuted',
  accent: 'toneAccent',
  ok: 'toneOk',
  warn: 'toneWarn',
  error: 'toneError',
  lock: 'toneLock',
};

/** D-M1 — largura de cada coluna de profundidade em unidades de mundo do SVG. */
export const COLUMN_WIDTH = 150;
const LINK_DISTANCE = 60;
const CHARGE_STRENGTH = -120;
const COLLIDE_LABEL_PADDING = 14;
const COLUMN_STRENGTH = 0.5;
const CENTER_Y_STRENGTH = 0.05;

export interface ForceNode extends SimulationNodeDatum {
  /** O nó da projeção, inteiro — título, tom, resumo e alvo de navegação vêm dele. */
  readonly node: GraphNode;
  readonly radius: number;
}

export interface ForceLink extends SimulationLinkDatum<ForceNode> {
  /** A aresta da projeção — o render distingue as laterais (`flows_into`/`ships_with`) pelo kind. */
  readonly edge: GraphEdge;
}

export interface NodeGraphSimulation {
  readonly simulation: Simulation<ForceNode, ForceLink>;
  readonly nodes: readonly ForceNode[];
  readonly links: readonly ForceLink[];
}

/**
 * Cria a simulação de força do mapa — PARADA (ver cabeçalho). Arestas cujo
 * endpoint não existe entre os nós são descartadas em silêncio: a projeção já
 * garante que não as emite (`addEdge` só aceita nós existentes), então isto é
 * rede de segurança para o mapa nunca travar por um dado inesperado.
 */
export function createNodeGraphSimulation(
  graphNodes: readonly GraphNode[],
  graphEdges: readonly GraphEdge[],
): NodeGraphSimulation {
  const nodes: ForceNode[] = graphNodes.map((node) => ({
    node,
    radius: RADIUS_BY_KIND[node.kind],
  }));

  const byKey = new Set(graphNodes.map((node) => node.key));
  const links: ForceLink[] = graphEdges
    .filter((edge) => byKey.has(edge.from) && byKey.has(edge.to))
    .map((edge) => ({ edge, source: edge.from, target: edge.to }));

  const simulation = forceSimulation<ForceNode, ForceLink>(nodes)
    .force(
      'link',
      forceLink<ForceNode, ForceLink>(links)
        .id((n) => n.node.key)
        .distance(LINK_DISTANCE),
    )
    .force('charge', forceManyBody<ForceNode>().strength(CHARGE_STRENGTH))
    .force(
      'collide',
      forceCollide<ForceNode>((n) => n.radius + COLLIDE_LABEL_PADDING),
    )
    .force(
      'x',
      forceX<ForceNode>((n) => n.node.column * COLUMN_WIDTH).strength(COLUMN_STRENGTH),
    )
    .force('y', forceY<ForceNode>(0).strength(CENTER_Y_STRENGTH));

  simulation.stop();

  return { simulation, nodes, links };
}
