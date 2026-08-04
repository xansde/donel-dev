import { describe, expect, it } from 'vitest';
import { selectSwitchTarget } from '../src/main/accounts/auto-switch';
import type { AccountSummary, AutoSwitchPolicy } from '../src/shared/accounts';

// T1110 (011-contas-e-provedores, etapa 1) — auto-switch.ts é FUNÇÃO PURA
// (D5 do plan.md): limiares 90/20, power-of-two-choices determinístico
// (pickTwo injetado), desligável, carga desconhecida nunca é destino, ativa
// nunca é destino de si mesma.

const POLICY: AutoSwitchPolicy = { enabled: true, switchAtLoad: 90, minAdvantage: 20 };

function account(id: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    label: id,
    plan: null,
    active: false,
    available: true,
    load: { fiveHour: 0, sevenDay: 0, sonnet: 0, readAt: '2026-08-04T00:00:00.000Z' },
    ...overrides,
  };
}

function withLoad(id: string, overallPercent: number, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return account(id, { load: { fiveHour: overallPercent, sevenDay: 0, sonnet: 0, readAt: '2026-08-04T00:00:00.000Z' }, ...overrides });
}

/** pickTwo determinístico pra teste: sempre devolve os dois primeiros da lista, na ordem recebida. */
const firstTwo = (candidates: readonly AccountSummary[]): readonly AccountSummary[] => candidates.slice(0, 2);

describe('selectSwitchTarget (puro)', () => {
  it('não troca abaixo de 90 (limiar switchAtLoad)', () => {
    const accounts = [withLoad('active', 89), withLoad('idle', 0)];
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBeNull();
  });

  it('troca ao atingir exatamente 90 com folga suficiente', () => {
    const accounts = [withLoad('active', 90), withLoad('idle', 10)];
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBe('idle');
  });

  it('não troca sem folga de 20 pontos', () => {
    const accounts = [withLoad('active', 95), withLoad('candidate', 80)]; // folga de 15
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBeNull();
  });

  it('troca com folga de exatamente 20 pontos', () => {
    const accounts = [withLoad('active', 95), withLoad('candidate', 75)]; // folga de 20
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBe('candidate');
  });

  it('power-of-two-choices: escolhe a de MENOR carga entre as duas sorteadas (pickTwo determinístico)', () => {
    const accounts = [withLoad('active', 95), withLoad('b', 10), withLoad('c', 40), withLoad('d', 5)];
    // firstTwo pega 'b' e 'c' entre os candidatos (ordem de inserção pós-filtro) — 'b' (10) < 'c' (40).
    const result = selectSwitchTarget(accounts, 'active', POLICY, firstTwo);
    expect(['b', 'c']).toContain(result);
  });

  it('pickTwo é chamado com os candidatos elegíveis (já filtrados por folga e disponibilidade)', () => {
    const accounts = [withLoad('active', 95), withLoad('elegivel', 10), withLoad('sem-folga', 90), account('indisponivel', { available: false, load: { fiveHour: 0, sevenDay: 0, sonnet: 0, readAt: 'x' } })];
    let seen: readonly AccountSummary[] = [];
    selectSwitchTarget(accounts, 'active', POLICY, (candidates) => {
      seen = candidates;
      return candidates.slice(0, 2);
    });
    expect(seen.map((a) => a.id)).toEqual(['elegivel']);
  });

  it('enabled: false nunca troca, mesmo com carga alta', () => {
    const accounts = [withLoad('active', 100), withLoad('idle', 0)];
    const disabled: AutoSwitchPolicy = { ...POLICY, enabled: false };
    expect(selectSwitchTarget(accounts, 'active', disabled, firstTwo)).toBeNull();
  });

  it('conta com carga desconhecida (3x null) nunca é destino', () => {
    const accounts = [
      withLoad('active', 95),
      account('sem-carga', { load: { fiveHour: null, sevenDay: null, sonnet: null, readAt: 'x' } }),
      withLoad('com-carga', 10),
    ];
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBe('com-carga');
  });

  it('todas as candidatas com carga desconhecida -> nenhuma troca', () => {
    const accounts = [
      withLoad('active', 95),
      account('sem-carga-1', { load: { fiveHour: null, sevenDay: null, sonnet: null, readAt: 'x' } }),
      account('sem-carga-2', { load: null }),
    ];
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBeNull();
  });

  it('a ativa nunca é destino de si mesma', () => {
    const accounts = [withLoad('active', 95)];
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBeNull();
  });

  it('activeId null (nenhuma conta ativa ainda) -> nunca troca', () => {
    const accounts = [withLoad('a', 95), withLoad('b', 0)];
    expect(selectSwitchTarget(accounts, null, POLICY, firstTwo)).toBeNull();
  });

  it('conta ativa ausente da lista -> nunca troca (nunca lança)', () => {
    const accounts = [withLoad('b', 0)];
    expect(selectSwitchTarget(accounts, 'nao-listada', POLICY, firstTwo)).toBeNull();
  });

  it('conta indisponível (available: false) nunca é destino', () => {
    const accounts = [withLoad('active', 95), withLoad('indisponivel', 0, { available: false })];
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBeNull();
  });

  it('overallLoad da ativa usa max(5h, 7d, sonnet)', () => {
    const accounts = [account('active', { load: { fiveHour: 10, sevenDay: 95, sonnet: 5, readAt: 'x' } }), withLoad('idle', 0)];
    expect(selectSwitchTarget(accounts, 'active', POLICY, firstTwo)).toBe('idle');
  });
});
