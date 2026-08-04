import { describe, expect, it } from 'vitest';
import { moveLevelFocus } from '../src/shared/mapLevels';

// Spec 010 / B6 — o resto de `mapLevels.test.ts` testava o carrossel do modelo
// antigo (níveis por `plan_cards[]`, trilha sintética da issue #35, etiquetas
// do board, relógio de homologação). Saiu com o código que testava; o
// inventário de paridade registra cada linha.

describe('moveLevelFocus', () => {
  const LEVELS = ['discovery', 'planos', 'implementacao', 'validacao'] as const;

  it('desce um nível (mesma direção que já funcionava)', () => {
    expect(moveLevelFocus(LEVELS, 'planos', 1)).toBe('implementacao');
  });

  it('sobe um nível — o eixo que estava travado só descendo (F1)', () => {
    expect(moveLevelFocus(LEVELS, 'planos', -1)).toBe('discovery');
    expect(moveLevelFocus(LEVELS, 'implementacao', -1)).toBe('planos');
  });

  it('clampa nas pontas, nunca dá a volta', () => {
    expect(moveLevelFocus(LEVELS, 'discovery', -1)).toBe('discovery');
    expect(moveLevelFocus(LEVELS, 'validacao', 1)).toBe('validacao');
  });

  it('nível atual fora da lista (ex.: card sem fase ainda) devolve ele mesmo, sem lançar', () => {
    expect(moveLevelFocus(['discovery', 'planos'], 'validacao', -1)).toBe('validacao');
  });
});
