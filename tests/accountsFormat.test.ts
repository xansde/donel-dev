import { describe, expect, it } from 'vitest';
import { consumedToRemainingPercent, formatAccountLoad, formatLoadWindow, formatOverallLoad } from '../src/renderer/src/accountsFormat';
import type { AccountLoad } from '../src/shared/accounts';

// T1123 (011-contas-e-provedores, etapa 1) — teste de unidade do formatador
// de carga, cobrindo a CONVERSÃO entre `AccountLoad` (% consumido) e o
// inverso (% livre, mesma unidade de `ProfileQuota`/spec 002). Achado A3 do
// `analyze`: os dois nunca podem ser comparados/somados sem essa conversão.

describe('consumedToRemainingPercent — conversão de unidade', () => {
  it('inverte % consumido para % livre', () => {
    expect(consumedToRemainingPercent(42)).toBe(58);
    expect(consumedToRemainingPercent(0)).toBe(100);
    expect(consumedToRemainingPercent(100)).toBe(0);
  });

  it('carga desconhecida (null) permanece null — nunca vira 100 por acidente', () => {
    expect(consumedToRemainingPercent(null)).toBeNull();
  });

  it('satura em [0, 100] mesmo com entrada fora de faixa', () => {
    expect(consumedToRemainingPercent(150)).toBe(0);
    expect(consumedToRemainingPercent(-10)).toBe(100);
  });
});

describe('formatLoadWindow', () => {
  it('formata percentual consumido com o label', () => {
    expect(formatLoadWindow('5h', 42)).toBe('5h 42% usado');
  });

  it('null vira "sem dado", nunca "—" (consistência com a régua de clareza da UI)', () => {
    expect(formatLoadWindow('semana', null)).toBe('semana sem dado');
  });
});

describe('formatAccountLoad', () => {
  const load: AccountLoad = { fiveHour: 42, sevenDay: 18, sonnet: 5, readAt: '2026-08-04T00:00:00.000Z' };

  it('junta as duas janelas explícitas (5h e semana)', () => {
    expect(formatAccountLoad(load)).toBe('5h 42% usado · semana 18% usado');
  });

  it('load null devolve as duas janelas "sem dado"', () => {
    expect(formatAccountLoad(null)).toBe('5h sem dado · semana sem dado');
  });
});

describe('formatOverallLoad', () => {
  it('usa max(5h, 7d, sonnet)', () => {
    expect(formatOverallLoad({ fiveHour: 10, sevenDay: 95, sonnet: 5, readAt: 'x' })).toBe('95% usado');
  });

  it('carga totalmente desconhecida devolve "sem dado"', () => {
    expect(formatOverallLoad({ fiveHour: null, sevenDay: null, sonnet: null, readAt: 'x' })).toBe('sem dado');
    expect(formatOverallLoad(null)).toBe('sem dado');
  });
});
