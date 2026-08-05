import { describe, expect, it } from 'vitest';
import {
  LAYOUT_COLUMN_WIDTH,
  LAYOUT_ROW_HEIGHT,
  layoutNodeGraph,
} from '../src/renderer/src/DevMode/nodeGraphLayout';
import type { GraphNode } from '../src/renderer/src/DevMode/nodeGraphView';

// Spec 010 / batch F25 (D1) — cobre só o CÁLCULO de posição (coluna → x,
// ordem-na-coluna → y), extraído do overlay para virar função pura testável.
// A forma de tela (React Flow, ícone, cor) mora no componente e não tem teste
// aqui de propósito — mesma separação de `nodeGraphView.test.ts`.

function node(overrides: Partial<GraphNode> & Pick<GraphNode, 'key' | 'column'>): GraphNode {
  return {
    kind: 'discovery',
    title: 'Nó de teste',
    badge: 'badge',
    summary: 'resumo',
    tone: 'muted',
    deviation: null,
    navigateTo: { discoveryId: null, planId: null, itemId: null, nodeKey: null, phase: null },
    ...overrides,
  };
}

describe('layoutNodeGraph — vazio', () => {
  it('devolve nada e dimensões zero para lista vazia', () => {
    const layout = layoutNodeGraph([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});

describe('layoutNodeGraph — colunas', () => {
  it('coloca a coluna N em x = N * LAYOUT_COLUMN_WIDTH', () => {
    const nodes = [node({ key: 'a', column: 0 }), node({ key: 'b', column: 1 }), node({ key: 'c', column: 2 })];
    const layout = layoutNodeGraph(nodes);
    expect(layout.nodes.map((entry) => entry.position.x)).toEqual([0, LAYOUT_COLUMN_WIDTH, 2 * LAYOUT_COLUMN_WIDTH]);
    expect(layout.width).toBe(3 * LAYOUT_COLUMN_WIDTH);
  });

  it('todo nó nasce em y=0 dentro de uma coluna com um único nó', () => {
    const nodes = [node({ key: 'a', column: 0 }), node({ key: 'b', column: 1 })];
    const layout = layoutNodeGraph(nodes);
    expect(layout.nodes.map((entry) => entry.position.y)).toEqual([0, 0]);
  });
});

describe('layoutNodeGraph — linhas dentro da mesma coluna', () => {
  it('empilha nós da mesma coluna em ordem de chegada, cada um em uma linha', () => {
    const nodes = [node({ key: 'a', column: 0 }), node({ key: 'b', column: 0 }), node({ key: 'c', column: 0 })];
    const layout = layoutNodeGraph(nodes);
    expect(layout.nodes.map((entry) => entry.position.y)).toEqual([0, LAYOUT_ROW_HEIGHT, 2 * LAYOUT_ROW_HEIGHT]);
    expect(layout.height).toBe(3 * LAYOUT_ROW_HEIGHT);
  });

  it('colunas intercaladas na lista de entrada mantêm contadores de linha independentes', () => {
    // a,b na coluna 0; c na coluna 1 — a ordem de entrada intercala as colunas
    // (o que acontece de verdade: `buildNodeGraph` ordena por rootIndex antes
    // de coluna), e cada coluna precisa contar suas próprias linhas.
    const nodes = [
      node({ key: 'a', column: 0 }),
      node({ key: 'c', column: 1 }),
      node({ key: 'b', column: 0 }),
      node({ key: 'd', column: 1 }),
    ];
    const layout = layoutNodeGraph(nodes);
    const byKey = new Map(layout.nodes.map((entry) => [entry.node.key, entry.position]));
    expect(byKey.get('a')).toEqual({ x: 0, y: 0 });
    expect(byKey.get('b')).toEqual({ x: 0, y: LAYOUT_ROW_HEIGHT });
    expect(byKey.get('c')).toEqual({ x: LAYOUT_COLUMN_WIDTH, y: 0 });
    expect(byKey.get('d')).toEqual({ x: LAYOUT_COLUMN_WIDTH, y: LAYOUT_ROW_HEIGHT });
  });
});

describe('layoutNodeGraph — preserva o nó original', () => {
  it('cada posição carrega o GraphNode inteiro, não só a chave', () => {
    const original = node({ key: 'a', column: 0, title: 'Título original' });
    const layout = layoutNodeGraph([original]);
    expect(layout.nodes[0]?.node).toBe(original);
  });
});
