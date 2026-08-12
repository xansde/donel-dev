import { describe, expect, it } from 'vitest';
import { computeDepth } from './forceLayout';

describe('computeDepth', () => {
  it('grafo linear: profundidades 0..n em sequência', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ];

    const depth = computeDepth(nodes, edges);

    expect(depth.get('a')).toBe(0);
    expect(depth.get('b')).toBe(1);
    expect(depth.get('c')).toBe(2);
    expect(depth.get('d')).toBe(3);
  });

  it('diamante: convergência fica com o MENOR caminho até a raiz', () => {
    // a -> b -> d (comprimento 2)
    // a -> c -> x -> d (comprimento 3)
    // depth(d) deve ser 2, não 3.
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'x' }, { id: 'd' }];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'x' },
      { from: 'x', to: 'd' },
    ];

    const depth = computeDepth(nodes, edges);

    expect(depth.get('a')).toBe(0);
    expect(depth.get('b')).toBe(1);
    expect(depth.get('c')).toBe(1);
    expect(depth.get('x')).toBe(2);
    expect(depth.get('d')).toBe(2);
  });

  it('múltiplas raízes: cada uma começa em 0, BFS multi-fonte', () => {
    const nodes = [{ id: 'r1' }, { id: 'r2' }, { id: 'm' }, { id: 'far' }];
    const edges = [
      { from: 'r1', to: 'm' },
      { from: 'r2', to: 'm' },
      { from: 'm', to: 'far' },
    ];

    const depth = computeDepth(nodes, edges);

    expect(depth.get('r1')).toBe(0);
    expect(depth.get('r2')).toBe(0);
    expect(depth.get('m')).toBe(1);
    expect(depth.get('far')).toBe(2);
  });

  it('nó isolado (sem aresta nenhuma): profundidade 0', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'isolado' }];
    const edges = [{ from: 'a', to: 'b' }];

    const depth = computeDepth(nodes, edges);

    expect(depth.get('isolado')).toBe(0);
  });

  it('grafo vazio: mapa vazio, sem lançar', () => {
    const depth = computeDepth([], []);
    expect(depth.size).toBe(0);
  });
});
