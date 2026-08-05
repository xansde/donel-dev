import { describe, expect, it } from 'vitest';
import { median } from './statistics';

// G4 (batch n3) — prova da estatística usada pela cerca de regressão do
// CA-7 (ca7-measurement.spec.ts). O spec Playwright em si não roda aqui
// (regra 1 do batch: nunca test:smoke/test:smoke:dev neste worktree) — mas a
// função que decide "qual número representa as N medições" é pura e testável
// isoladamente, e é essa prova que este arquivo entrega.

describe('median (puro)', () => {
  it('contagem ímpar: devolve o valor central após ordenar', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('contagem par: devolve a média dos dois valores centrais', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('não depende da ordem de entrada', () => {
    expect(median([274, 168, 200, 190, 210])).toBe(200);
  });

  it('amostra única: devolve o próprio valor', () => {
    expect(median([42])).toBe(42);
  });

  it('não muta o array recebido', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it('lança para amostra vazia — mediana de zero medições não tem significado', () => {
    expect(() => median([])).toThrow(/amostra nenhuma/i);
  });

  // Caso real do achado do batch (issue registrada em descobertas/task):
  // 5 amostras oscilando 168–274 ms, 3 delas abaixo da cerca de 250 — a
  // MEDIANA das 5 fica bem abaixo da cerca (o comportamento que corrige a
  // flakiness sem abrir mão de detectar regressão de verdade).
  it('caso real: 5 amostras 168–274ms (3 de 5 abaixo da cerca de 250) — a mediana fica longe da cerca, não oscila em cima dela', () => {
    const samples = [168, 190, 200, 245, 274];
    expect(median(samples)).toBe(200);
    expect(median(samples)).toBeLessThan(250);
  });

  it('regressão de verdade (toda a distribuição desloca pra cima) ainda é pega: mediana também estoura a cerca', () => {
    const regressedSamples = [260, 270, 280, 290, 300]; // mesma forma de dispersão, só deslocada pra cima
    expect(median(regressedSamples)).toBeGreaterThan(250);
  });
});
