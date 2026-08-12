// 012 Esteira 4.0 / wi-esteira4-mapa-grafos — a física do mapa novo (motor A,
// d3-force + SVG próprio, ratificado em `specs/012-esteira-4/mapa-grafos-escolha.md`).
//
// O que se trava aqui:
// - D-M1: viés horizontal por profundidade — o tempo corre da esquerda para a
//   direita; a posição nasce de simulação, nunca de coordenada à mão.
// - Divergência 1 do diagrama (`mapa-grafos-arquitetura.md`): a profundidade é
//   o `column` (BFS) que `nodeGraphView.ts` já entrega — este módulo NÃO
//   recalcula profundidade (o `computeDepth` da bancada não foi portado).
// - D-M3: raios por tipo — fase/gate grande, task média, artefato/verificação
//   pequenos (satélites).
// - Aviso 1 herdado da bancada (StrictMode): a simulação nasce PARADA; quem
//   monta o componente decide quando dar `restart()` dentro do effect — a
//   simulação descartada pelo double-mount nunca roda ticks órfãos.

import { describe, expect, it } from 'vitest';
import {
  COLUMN_WIDTH,
  createNodeGraphSimulation,
  RADIUS_BY_KIND,
} from '../src/renderer/src/DevMode/nodeGraphForce';
import type { GraphEdge, GraphNode } from '../src/renderer/src/DevMode/nodeGraphView';

function node(key: string, column: number, kind: GraphNode['kind'] = 'work_item'): GraphNode {
  return {
    key,
    kind,
    title: `Nó ${key}`,
    badge: 'badge',
    summary: 'resumo',
    tone: 'muted',
    deviation: null,
    column,
    navigateTo: { discoveryId: 'dsc-1', planId: null, itemId: null, nodeKey: key, phase: null },
  };
}

function edge(from: string, to: string): GraphEdge {
  return { key: `originated|${from}|${to}`, kind: 'originated', label: 'originou', from, to };
}

describe('RADIUS_BY_KIND (D-M3)', () => {
  it('fase/gate (discovery, plano) são os nós grandes; task é média; artefato e verificação são satélites pequenos', () => {
    expect(RADIUS_BY_KIND.discovery).toBe(RADIUS_BY_KIND.plan);
    expect(RADIUS_BY_KIND.artifact).toBe(RADIUS_BY_KIND.verification);
    expect(RADIUS_BY_KIND.discovery).toBeGreaterThan(RADIUS_BY_KIND.work_item);
    expect(RADIUS_BY_KIND.work_item).toBeGreaterThan(RADIUS_BY_KIND.artifact);
  });
});

describe('createNodeGraphSimulation', () => {
  it('nasce PARADA: nenhum tick roda sozinho depois da criação (aviso StrictMode da bancada)', async () => {
    const sim = createNodeGraphSimulation([node('a', 0), node('b', 1)], [edge('a', 'b')]);
    const before = sim.nodes.map((n) => [n.x, n.y]);
    // d3-force auto-inicia por timer (~17ms por tick); 80ms parados provam o stop.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sim.nodes.map((n) => [n.x, n.y])).toEqual(before);
  });

  it('D-M1: depois de estabilizar, a profundidade vira ordem horizontal (x cresce com o column)', () => {
    const sim = createNodeGraphSimulation(
      [node('a', 0, 'discovery'), node('b', 1, 'plan'), node('c', 2)],
      [edge('a', 'b'), edge('b', 'c')],
    );
    for (let i = 0; i < 300; i += 1) sim.simulation.tick();
    const x = new Map(sim.nodes.map((n) => [n.node.key, n.x ?? 0]));
    expect(x.get('a')!).toBeLessThan(x.get('b')!);
    expect(x.get('b')!).toBeLessThan(x.get('c')!);
  });

  it('a profundidade vem do column da projeção, não das arestas: nós SEM aresta ainda se separam por coluna', () => {
    const sim = createNodeGraphSimulation([node('perto', 0), node('longe', 4)], []);
    for (let i = 0; i < 300; i += 1) sim.simulation.tick();
    const perto = sim.nodes.find((n) => n.node.key === 'perto')!;
    const longe = sim.nodes.find((n) => n.node.key === 'longe')!;
    // Com força de coluna 0.5 e 300 ticks, cada nó converge para perto do seu
    // alvo — a distância observada fica próxima das 4 colunas de diferença.
    expect((longe.x ?? 0) - (perto.x ?? 0)).toBeGreaterThan(COLUMN_WIDTH * 2);
  });

  it('cada nó carrega o raio do seu tipo (D-M3)', () => {
    const sim = createNodeGraphSimulation(
      [node('d', 0, 'discovery'), node('t', 1, 'work_item'), node('f', 2, 'artifact')],
      [],
    );
    const byKey = new Map(sim.nodes.map((n) => [n.node.key, n]));
    expect(byKey.get('d')!.radius).toBe(RADIUS_BY_KIND.discovery);
    expect(byKey.get('t')!.radius).toBe(RADIUS_BY_KIND.work_item);
    expect(byKey.get('f')!.radius).toBe(RADIUS_BY_KIND.artifact);
  });

  it('aresta apontando para nó que não existe é descartada sem lançar (nunca trava o mapa)', () => {
    const sim = createNodeGraphSimulation([node('a', 0)], [edge('a', 'fantasma')]);
    expect(sim.links).toHaveLength(0);
    expect(() => {
      for (let i = 0; i < 10; i += 1) sim.simulation.tick();
    }).not.toThrow();
  });

  it('entrada vazia: simulação vazia, sem lançar', () => {
    const sim = createNodeGraphSimulation([], []);
    expect(sim.nodes).toHaveLength(0);
    expect(sim.links).toHaveLength(0);
  });

  it('cada link preserva a aresta da projeção (tipo lateral distinguível no render)', () => {
    const lateral: GraphEdge = { key: 'flows_into|a|b', kind: 'flows_into', label: 'deságua em', from: 'a', to: 'b' };
    const sim = createNodeGraphSimulation([node('a', 0), node('b', 1)], [lateral]);
    expect(sim.links).toHaveLength(1);
    expect(sim.links[0].edge.kind).toBe('flows_into');
  });
});
