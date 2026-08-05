// T1218 (011-contas-e-provedores, etapa 2) — troca de fonte: a entrada vira
// `account: { id, label }` (motor, `shared/accounts.ts`), imutável pela vida
// da aba (mesma regra "por valor na criação" de sempre). A cota passa a vir
// do motor (`AccountLoad`, C25 — uma unidade só, `%` consumido); a conversão
// pro texto acontece aqui, num formatador único.
import { describe, expect, it } from 'vitest';
import type { AccountLoad } from '../src/shared/accounts';
import { computeSessionAccountLabel, formatArchivedAccountLabel } from '../src/shared/sessionAccountLabel';

const loadWithFiveHour = (fiveHour: number): AccountLoad => ({ fiveHour, sevenDay: null, sonnet: null, readAt: '2026-08-04T00:00:00.000Z' });

describe('computeSessionAccountLabel', () => {
  it('aba claude com conta resolvida mostra o rótulo da conta + cota (uma unidade, % consumido)', () => {
    const label = computeSessionAccountLabel(
      { sessionType: 'claude', account: { id: 'acc-1', label: 'Conta 1' } },
      'FALLBACK_NAO_USADO',
      loadWithFiveHour(62),
    );
    expect(label).toBe('Sessão: Conta 1 · 62% usado');
  });

  it('cota desconhecida (todas as janelas null) cai em "—"', () => {
    const label = computeSessionAccountLabel(
      { sessionType: 'claude', account: { id: 'acc-1', label: 'Conta 1' } },
      'FALLBACK_NAO_USADO',
      { fiveHour: null, sevenDay: null, sonnet: null, readAt: '2026-08-04T00:00:00.000Z' },
    );
    expect(label).toBe('Sessão: Conta 1 · —');
  });

  it('cota omitida (default null) cai em "—" — nunca omite o slot inteiro', () => {
    const label = computeSessionAccountLabel({ sessionType: 'claude', account: { id: 'acc-1', label: 'Conta 1' } }, 'FALLBACK_NAO_USADO');
    expect(label).toBe('Sessão: Conta 1 · —');
  });

  it('aba claude AINDA sem conta resolvida (janela curta até pty:create responder) cai no fallback global', () => {
    const label = computeSessionAccountLabel({ sessionType: 'claude', account: undefined }, 'Conta 1 · 62%', loadWithFiveHour(99));
    expect(label).toBe('Conta 1 · 62%');
  });

  it('aba shell (terminal livre) sempre mostra o rótulo neutro, mesmo com conta e cota presentes', () => {
    const label = computeSessionAccountLabel(
      { sessionType: 'shell', account: { id: 'acc-1', label: 'Conta 1' } },
      'FALLBACK_NAO_USADO',
      loadWithFiveHour(62),
    );
    expect(label).toBe('Terminal (sem conta)');
  });

  it('aba shell sem conta também mostra o rótulo neutro', () => {
    const label = computeSessionAccountLabel({ sessionType: 'shell', account: undefined }, 'FALLBACK_NAO_USADO');
    expect(label).toBe('Terminal (sem conta)');
  });
});

// CA-25 (009-modo-dev-v3, lote 8), adaptado pela troca de vocabulário
// (C24): `formatArchivedAccountLabel` opera sobre `accountId` — o slug de
// perfil legado nunca chega aqui diretamente, quem o resolve pra `accountId`
// é o sanitize de `devMode.ts`/`config-store.ts` (T1220, leitura tolerante).
// Esta suíte prova que a função em si é agnóstica à origem do valor.
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
