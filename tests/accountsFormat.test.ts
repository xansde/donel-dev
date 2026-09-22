import { describe, expect, it } from 'vitest';
import {
  consumedToRemainingPercent,
  formatAccountLoad,
  formatAutoSwitchEvent,
  formatBlindWarning,
  formatLoadWindow,
  formatOverallLoad,
  formatSaturatedWarning,
  formatSwitchOverwrittenWarning,
} from '../src/renderer/src/accountsFormat';
import type { AccountLoad, AutoSwitchEvent, AutoSwitchPolicy, SwitchOverwrittenWarning } from '../src/shared/accounts';

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

// 011-contas-e-provedores, etapa 3, Fase 2 (D5/D6; `blind` no adendo D8) —
// `formatAutoSwitchEvent` narra UMA decisão do auto-switch
// (`AccountsViewDto.lastAutoSwitch`); `labelOf` resolve id -> rótulo, mesma
// régua de fallback (id cru) que `AccountsPanel.accountLabel` já usa.
const labelOf = (id: string): string => ({ 'acc-a': 'Conta A', 'acc-b': 'Conta B' })[id] ?? id;
const fixedTime = (): string => '10:32';

describe('formatAutoSwitchEvent', () => {
  it('switched com "from" conhecido: "de «A» para «B»"', () => {
    const event: AutoSwitchEvent = { kind: 'switched', from: 'acc-a', to: 'acc-b', at: '2026-08-04T13:05:00.000Z' };
    expect(formatAutoSwitchEvent(event, labelOf, fixedTime)).toBe('Troca automática às 10:32: de «Conta A» para «Conta B».');
  });

  it('switched sem "from" (from null): só "para «B»"', () => {
    const event: AutoSwitchEvent = { kind: 'switched', from: null, to: 'acc-b', at: '2026-08-04T13:05:00.000Z' };
    expect(formatAutoSwitchEvent(event, labelOf, fixedTime)).toBe('Troca automática às 10:32: para «Conta B».');
  });

  it.each([
    ['offline', 'sem conexão'],
    ['unauthorized', 'o servidor recusou'],
    ['expired-credentials', 'a credencial venceu'],
    ['io', 'erro ao gravar a troca'],
  ] as const)('failed com motivo "%s" -> "%s"', (reason, reasonText) => {
    const event: AutoSwitchEvent = { kind: 'failed', to: 'acc-b', reason, at: '2026-08-04T13:05:00.000Z' };
    expect(formatAutoSwitchEvent(event, labelOf, fixedTime)).toBe(`Troca automática para «Conta B» falhou às 10:32 — ${reasonText}.`);
  });

  it('id sem rótulo conhecido cai no fallback de labelOf (não é responsabilidade desta função)', () => {
    const event: AutoSwitchEvent = { kind: 'switched', from: null, to: 'acc-desconhecida', at: '2026-08-04T13:05:00.000Z' };
    expect(formatAutoSwitchEvent(event, labelOf, fixedTime)).toBe('Troca automática às 10:32: para «acc-desconhecida».');
  });

  it('sem formatTime informado usa o default (HH:MM em pt-BR) — não trava sem a dependência injetada', () => {
    const event: AutoSwitchEvent = { kind: 'switched', from: null, to: 'acc-b', at: '2026-08-04T13:05:00.000Z' };
    const text = formatAutoSwitchEvent(event, labelOf);
    expect(text).toMatch(/^Troca automática às \d{2}:\d{2}: para «Conta B»\.$/);
  });
});

// 22/09 (emenda da D5, item 5) — `formatSwitchOverwrittenWarning` narra a
// corrida detectada depois de um switch (ver `AccountsViewDto.lastSwitchOverwritten`).
describe('formatSwitchOverwrittenWarning', () => {
  it('narra a conta-alvo e a hora, mesma régua de labelOf/formatTime', () => {
    const warning: SwitchOverwrittenWarning = { to: 'acc-b', at: '2026-08-04T13:05:00.000Z' };
    expect(formatSwitchOverwrittenWarning(warning, labelOf, fixedTime)).toBe(
      'A troca para «Conta B» às 10:32 pode ter sido sobrescrita por outro processo — confira a conta ativa.',
    );
  });
});

// D6 — "todas acima do limiar: avisa, não troca" (`saturated`).
describe('formatSaturatedWarning', () => {
  const policy: AutoSwitchPolicy = { enabled: true, switchAtLoad: 90, minAdvantage: 20 };

  it('pluraliza "pontos de folga" no caso comum', () => {
    expect(formatSaturatedWarning(policy)).toBe(
      'A conta ativa passou de 90% e nenhuma outra tem 20 pontos de folga — a troca automática não tem para onde ir.',
    );
  });

  it('minAdvantage 1 -> singular "1 ponto de folga"', () => {
    expect(formatSaturatedWarning({ ...policy, minAdvantage: 1 })).toBe(
      'A conta ativa passou de 90% e nenhuma outra tem 1 ponto de folga — a troca automática não tem para onde ir.',
    );
  });
});

// D8 — "sem leitura" não é "sem folga" (`blind`): não cita pontos de folga —
// o problema é DADO, não limiar.
describe('formatBlindWarning', () => {
  const policy: AutoSwitchPolicy = { enabled: true, switchAtLoad: 90, minAdvantage: 20 };

  it('avisa que falta leitura de carga, sem mencionar pontos de folga', () => {
    const text = formatBlindWarning(policy);
    expect(text).toBe(
      'A conta ativa passou de 90% e falta a leitura de carga de outras contas — a troca automática só escolhe conta com carga conhecida.',
    );
    expect(text).not.toContain('ponto');
  });
});
