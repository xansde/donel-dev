import { describe, expect, it } from 'vitest';
import grafoMesa from '../../../.esteira/plano/pln-esteira4-catalogo-e-grafo/grafo-mesa.json';
import { GrafoParseError, parseEsteiraGrafo } from './adapter';

function baseGrafo() {
  return {
    kind: 'esteira.grafo',
    version: 1,
    nodes: [
      { id: 'n1', kind: 'gate', title: 'Discovery', handoff: null, note: null, x: 0, y: 0 },
      { id: 'n2', kind: 'fase', title: 'Plano', handoff: 'algo', note: 'nota', x: 10, y: 10 },
    ],
    edges: [{ from: 'n1', to: 'n2' }],
  };
}

describe('parseEsteiraGrafo', () => {
  it('parseia o grafo-mesa.json real com 12 nós e 12 arestas', () => {
    const graph = parseEsteiraGrafo(grafoMesa);

    expect(graph.nodes).toHaveLength(12);
    expect(graph.edges).toHaveLength(12);

    const kinds = new Set(graph.nodes.map((n) => n.kind));
    expect(kinds.has('gate')).toBe(true);
    expect(kinds.has('fase')).toBe(true);
    expect(kinds.has('nota')).toBe(true);

    for (const node of graph.nodes) {
      expect(['gate', 'fase', 'artefato', 'nota']).toContain(node.kind);
    }
  });

  it('recusa version desconhecida com erro nomeado', () => {
    const grafo = { ...baseGrafo(), version: 2 };

    expect(() => parseEsteiraGrafo(grafo)).toThrow(GrafoParseError);
    expect(() => parseEsteiraGrafo(grafo)).toThrow(/versão 2 desconhecida/);
  });

  it('recusa aresta com "from" órfão', () => {
    const grafo = baseGrafo();
    grafo.edges = [{ from: 'n-inexistente', to: 'n2' }];

    expect(() => parseEsteiraGrafo(grafo)).toThrow(GrafoParseError);
    expect(() => parseEsteiraGrafo(grafo)).toThrow(/nó de origem "n-inexistente" não existe/);
  });

  it('recusa id de nó duplicado', () => {
    const grafo = baseGrafo();
    grafo.nodes[1] = { ...grafo.nodes[1], id: 'n1' };

    expect(() => parseEsteiraGrafo(grafo)).toThrow(GrafoParseError);
    expect(() => parseEsteiraGrafo(grafo)).toThrow(/id de nó duplicado: "n1"/);
  });

  it('recusa kind fora do enum (ex.: "card")', () => {
    const grafo = baseGrafo();
    grafo.nodes[0] = { ...grafo.nodes[0], kind: 'card' };

    expect(() => parseEsteiraGrafo(grafo)).toThrow(GrafoParseError);
    expect(() => parseEsteiraGrafo(grafo)).toThrow(/fora do enum esperado/);
  });

  it('tolera campo desconhecido no nó e não o propaga ao modelo', () => {
    const grafo = baseGrafo();
    (grafo.nodes[0] as Record<string, unknown>).campoDesconhecido = 'valor qualquer';

    const graph = parseEsteiraGrafo(grafo);

    expect(graph.nodes[0]).not.toHaveProperty('campoDesconhecido');
    expect(Object.keys(graph.nodes[0]).sort()).toEqual(
      ['handoff', 'id', 'kind', 'note', 'title', 'x', 'y'].sort(),
    );
  });

  it('recusa title vazio', () => {
    const grafo = baseGrafo();
    grafo.nodes[0] = { ...grafo.nodes[0], title: '' };

    expect(() => parseEsteiraGrafo(grafo)).toThrow(GrafoParseError);
    expect(() => parseEsteiraGrafo(grafo)).toThrow(/"title" precisa ser uma string não vazia/);
  });
});
