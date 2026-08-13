import { describe, expect, it } from 'vitest';
import { neutralToBench } from './benchGraph';
import type { NeutralGraph } from './adapter';

function graph(): NeutralGraph {
  return {
    nodes: [
      { id: 'g1', kind: 'gate', title: 'Gate', handoff: null, note: null },
      { id: 'f1', kind: 'fase', title: 'Fase', handoff: null, note: null },
      { id: 'n1', kind: 'nota', title: 'Nota', handoff: null, note: 'algo' },
      { id: 'a1', kind: 'artefato', title: 'Artefato', handoff: 'algo', note: null },
    ],
    edges: [
      { from: 'g1', to: 'f1' },
      { from: 'f1', to: 'n1' },
      { from: 'f1', to: 'a1' },
    ],
  };
}

describe('neutralToBench', () => {
  it('mapeia kind -> size: gate/fase -> lg, nota -> md, artefato -> sm', () => {
    const bench = neutralToBench(graph());
    const sizeById = Object.fromEntries(bench.nodes.map((n) => [n.id, n.size]));

    expect(sizeById.g1).toBe('lg');
    expect(sizeById.f1).toBe('lg');
    expect(sizeById.n1).toBe('md');
    expect(sizeById.a1).toBe('sm');
  });

  it('sem estado no dado neutro -> todo nó nasce future', () => {
    const bench = neutralToBench(graph());
    expect(bench.nodes.every((n) => n.state === 'future')).toBe(true);
  });

  it('preserva as arestas (mesma quantidade e mesmos pares from/to)', () => {
    const bench = neutralToBench(graph());
    expect(bench.edges).toHaveLength(3);
    expect(bench.edges).toEqual([
      { from: 'g1', to: 'f1' },
      { from: 'f1', to: 'n1' },
      { from: 'f1', to: 'a1' },
    ]);
  });

  it('usa note, ou handoff se note for null, como desc', () => {
    const bench = neutralToBench(graph());
    const descById = Object.fromEntries(bench.nodes.map((n) => [n.id, n.desc]));

    expect(descById.n1).toBe('algo');
    expect(descById.a1).toBe('algo');
    expect(descById.g1).toBeNull();
  });
});
