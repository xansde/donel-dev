// T1218 (011-contas-e-provedores, etapa 2) — troca de fonte: a entrada vira
// `account: { id, label }` (motor, `shared/accounts.ts`), imutável pela vida
// da aba (mesma regra "por valor na criação" de sempre).
//
// 011-contas-e-provedores, etapa 3, Fase 2 (D1/D2, ajuste ao desenho) —
// reescrita completa do contrato: a aba passa a mostrar a conta VIGENTE
// (`current.active`/`current.load`), não mais a de nascimento; `account`
// (nascimento) só alimenta o sufixo "trocou em voo". `credentialSource`
// decide o ramo (provider/login/account) antes de qualquer conta entrar em
// jogo. `current.autoSwitchState` substitui o booleano `saturated` do
// desenho original — cobre também `blind` (D8).
import { describe, expect, it } from 'vitest';
import type { AccountLoad } from '../src/shared/accounts';
import { computeSessionAccountLabel, formatArchivedAccountLabel, type CurrentAccountContext } from '../src/shared/sessionAccountLabel';

const loadWithFiveHour = (fiveHour: number): AccountLoad => ({ fiveHour, sevenDay: null, sonnet: null, readAt: '2026-08-04T00:00:00.000Z' });

/** Motor sem conta ativa (inerte, ou ainda sem leitura) — reutilizado pelos ramos que nem chegam a olhar `current`. */
const NO_ACTIVE: CurrentAccountContext = { active: null, load: null, autoSwitchState: 'idle' };

const activeContext = (overrides: Partial<CurrentAccountContext> = {}): CurrentAccountContext => ({
  active: { id: 'acc-active', label: 'Conta Ativa' },
  load: null,
  autoSwitchState: 'idle',
  ...overrides,
});

describe('computeSessionAccountLabel', () => {
  describe('aba shell — sempre neutra, current nunca é olhado', () => {
    it('sem conta de nascimento', () => {
      const label = computeSessionAccountLabel({ sessionType: 'shell', account: undefined }, 'FALLBACK_NAO_USADO', activeContext());
      expect(label).toBe('Terminal (sem conta)');
    });

    it('com conta de nascimento presente (ignorada mesmo assim)', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'shell', account: { id: 'acc-1', label: 'Conta 1' } },
        'FALLBACK_NAO_USADO',
        activeContext(),
      );
      expect(label).toBe('Terminal (sem conta)');
    });
  });

  describe("credentialSource: 'login' — a própria aba de login isolado", () => {
    it('rótulo neutro, ignora account/current', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-1', label: 'Conta 1' }, credentialSource: 'login' },
        'FALLBACK_NAO_USADO',
        activeContext(),
      );
      expect(label).toBe('Login de conta (sem sessão)');
    });
  });

  describe("credentialSource: 'provider' — sem cota, sem conta", () => {
    it('com providerLabel', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: undefined, credentialSource: 'provider', providerLabel: 'Provedor X' },
        'FALLBACK_NAO_USADO',
        NO_ACTIVE,
      );
      expect(label).toBe('Sessão: Provedor X · provedor');
    });

    it('sem providerLabel cai no genérico "provedor"', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: undefined, credentialSource: 'provider' },
        'FALLBACK_NAO_USADO',
        NO_ACTIVE,
      );
      expect(label).toBe('Sessão: provedor · provedor');
    });
  });

  describe("credentialSource: 'account' (default) com current.active — a virada do D1", () => {
    it('credentialSource omitido cai em account', () => {
      const label = computeSessionAccountLabel({ sessionType: 'claude', account: undefined }, 'FALLBACK_NAO_USADO', activeContext());
      expect(label).toBe('Sessão: Conta Ativa · —');
    });

    it('cota vem de current.load (da conta ATIVA), não da de nascimento', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-active', label: 'Conta Ativa' } },
        'FALLBACK_NAO_USADO',
        activeContext({ load: loadWithFiveHour(62) }),
      );
      expect(label).toBe('Sessão: Conta Ativa · 62% usado');
    });

    it('cota desconhecida (todas as janelas null) cai em "—"', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-active', label: 'Conta Ativa' } },
        'FALLBACK_NAO_USADO',
        activeContext({ load: { fiveHour: null, sevenDay: null, sonnet: null, readAt: '2026-08-04T00:00:00.000Z' } }),
      );
      expect(label).toBe('Sessão: Conta Ativa · —');
    });

    it('load ausente (null) cai em "—" — nunca omite o slot inteiro', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-active', label: 'Conta Ativa' } },
        'FALLBACK_NAO_USADO',
        activeContext({ load: null }),
      );
      expect(label).toBe('Sessão: Conta Ativa · —');
    });

    it('nascimento === ativa agora: sem sufixo "trocou em voo"', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-active', label: 'Conta Ativa' } },
        'FALLBACK_NAO_USADO',
        activeContext(),
      );
      expect(label).not.toContain('trocou em voo');
    });

    it('nascimento diverge da ativa agora: ganha "trocou em voo (era <nascimento>)"', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-1', label: 'Conta 1' } },
        'FALLBACK_NAO_USADO',
        activeContext(),
      );
      expect(label).toBe('Sessão: Conta Ativa · — · trocou em voo (era Conta 1)');
    });

    it('nascimento ainda não resolvido (undefined): sem sufixo, mesmo com conta ativa presente', () => {
      const label = computeSessionAccountLabel({ sessionType: 'claude', account: undefined }, 'FALLBACK_NAO_USADO', activeContext());
      expect(label).not.toContain('trocou em voo');
    });

    it('autoSwitchState "saturated" acrescenta "sem conta com folga" (D6)', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-active', label: 'Conta Ativa' } },
        'FALLBACK_NAO_USADO',
        activeContext({ autoSwitchState: 'saturated' }),
      );
      expect(label).toBe('Sessão: Conta Ativa · — · sem conta com folga');
    });

    it('autoSwitchState "blind" acrescenta "sem leitura das outras contas" (D8)', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-active', label: 'Conta Ativa' } },
        'FALLBACK_NAO_USADO',
        activeContext({ autoSwitchState: 'blind' }),
      );
      expect(label).toBe('Sessão: Conta Ativa · — · sem leitura das outras contas');
    });

    it.each(['off', 'idle', 'armed'] as const)('autoSwitchState "%s" não acrescenta sufixo nenhum', (autoSwitchState) => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-active', label: 'Conta Ativa' } },
        'FALLBACK_NAO_USADO',
        activeContext({ autoSwitchState }),
      );
      expect(label).toBe('Sessão: Conta Ativa · —');
    });

    it('combina "trocou em voo" com "sem conta com folga" quando os dois se aplicam', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-1', label: 'Conta 1' } },
        'FALLBACK_NAO_USADO',
        activeContext({ autoSwitchState: 'saturated' }),
      );
      expect(label).toBe('Sessão: Conta Ativa · — · trocou em voo (era Conta 1) · sem conta com folga');
    });
  });

  describe('account sem current.active — motor inerte ou sem leitura ainda', () => {
    it('com account (nascimento) resolvido -> rótulo da conta de nascimento, cota "—"', () => {
      const label = computeSessionAccountLabel(
        { sessionType: 'claude', account: { id: 'acc-1', label: 'Conta 1' } },
        'FALLBACK_NAO_USADO',
        NO_ACTIVE,
      );
      expect(label).toBe('Sessão: Conta 1 · —');
    });

    it('sem account (janela curta até pty:create responder) cai no fallback global', () => {
      const label = computeSessionAccountLabel({ sessionType: 'claude', account: undefined }, 'Conta 1 · 62%', NO_ACTIVE);
      expect(label).toBe('Conta 1 · 62%');
    });
  });
});

// CA-25 (009-modo-dev-v3, lote 8), adaptado pela troca de vocabulário
// (C24): `formatArchivedAccountLabel` opera sobre `accountId` — o slug de
// perfil legado nunca chega aqui diretamente, quem o resolve pra `accountId`
// é o sanitize de `devMode.ts`/`config-store.ts` (T1220, leitura tolerante).
// Esta suíte prova que a função em si é agnóstica à origem do valor. Não
// mudou na Fase 2 — segue coberta aqui pra manter o arquivo de teste único.
// Ponte da statusline — a cota que o CLI da aba leu (rate_limits) entra na
// frente da leitura de 5 em 5 min do motor, janela a janela.
describe('computeSessionAccountLabel + liveLoad (statusline)', () => {
  const claude = { sessionType: 'claude' as const, account: undefined };

  it('conta ativa: a janela viva vence a do motor; sonnet segue do motor', () => {
    const load: AccountLoad = { fiveHour: 10, sevenDay: 20, sonnet: 30, readAt: '2026-10-30T00:00:00.000Z' };
    expect(computeSessionAccountLabel(claude, 'F', activeContext({ load, liveLoad: { fiveHour: 55, sevenDay: null } }))).toBe('Sessão: Conta Ativa · 55% usado');
    expect(computeSessionAccountLabel(claude, 'F', activeContext({ load, liveLoad: { fiveHour: 5, sevenDay: 6 } }))).toBe('Sessão: Conta Ativa · 30% usado');
  });

  it('conta ativa sem leitura do motor: a viva basta', () => {
    expect(computeSessionAccountLabel(claude, 'F', activeContext({ liveLoad: { fiveHour: 12, sevenDay: 40 } }))).toBe('Sessão: Conta Ativa · 40% usado');
  });

  it('sem liveLoad: exatamente como antes', () => {
    expect(computeSessionAccountLabel(claude, 'F', activeContext({ load: loadWithFiveHour(7), liveLoad: null }))).toBe('Sessão: Conta Ativa · 7% usado');
    expect(computeSessionAccountLabel(claude, 'F', NO_ACTIVE)).toBe('F');
  });

  it('motor inerte: a cota do CLI aparece em vez do rótulo global', () => {
    expect(computeSessionAccountLabel(claude, 'Motor inerte', { ...NO_ACTIVE, liveLoad: { fiveHour: 23, sevenDay: 41 } })).toBe('Sessão: conta do CLI · 41% usado');
  });

  it('sem conta ativa mas com a de nascimento: a cota viva no lugar do —', () => {
    expect(
      computeSessionAccountLabel({ sessionType: 'claude', account: { id: 'a', label: 'Conta A' } }, 'F', { ...NO_ACTIVE, liveLoad: { fiveHour: 9, sevenDay: null } }),
    ).toBe('Sessão: Conta A · 9% usado');
  });

  it('provider: segue sem cota mesmo com leitura viva', () => {
    expect(
      computeSessionAccountLabel({ ...claude, credentialSource: 'provider', providerLabel: 'GLM' }, 'F', activeContext({ liveLoad: { fiveHour: 1, sevenDay: 1 } })),
    ).toBe('Sessão: GLM · provedor');
  });
});

describe('formatArchivedAccountLabel', () => {
  it('conta arquivada igual à ativa agora → rótulo com o id, mismatch false', () => {
    expect(formatArchivedAccountLabel('tech-2', 'tech-2')).toEqual({ label: 'conta: tech-2', mismatch: false });
  });

  it('conta arquivada diferente da ativa agora → mismatch true (mesmo rótulo, tom de aviso é decisão da UI)', () => {
    expect(formatArchivedAccountLabel('tech-1', 'tech-2')).toEqual({ label: 'conta: tech-1', mismatch: true });
  });

  it('caso legado: um accountId resolvido a partir de um profileSlug antigo (mesmo formato de string) rotula normalmente', () => {
    // Simula o que `sanitizeArchivedPhaseSessions` (config-store.ts) faz:
    // lê `profileSlug` legado como `accountId` quando o campo novo não existe.
    const legacyProfileSlugAsAccountId = 'tecnologia-claude-2';
    expect(formatArchivedAccountLabel(legacyProfileSlugAsAccountId, 'tecnologia-claude-2')).toEqual({
      label: 'conta: tecnologia-claude-2',
      mismatch: false,
    });
  });
});
