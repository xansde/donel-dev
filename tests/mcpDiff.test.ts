import { describe, expect, it } from 'vitest';
import { computeMcpDiff } from '../src/main/accounts/migration/mcp-diff';

// T1204 (011-contas-e-provedores, etapa 2) — mcp-diff.ts é PURO, saída só de
// nomes (D14/C29). Nenhum valor de configuração pode atravessar.

describe('computeMcpDiff (puro)', () => {
  it('onlyInProfile / onlyInGlobal por nome', () => {
    const diff = computeMcpDiff(
      'acc-1',
      { mcpServers: { 'servidor-a': {}, 'servidor-b': {} } },
      { mcpServers: { 'servidor-b': {}, 'servidor-c': {} } },
    );
    expect(diff.profileSlug).toBe('acc-1');
    expect(diff.onlyInProfile).toEqual(['servidor-a']);
    expect(diff.onlyInGlobal).toEqual(['servidor-c']);
  });

  it('arquivo ausente (null) ⇒ diff vazio sem lançar', () => {
    const diff = computeMcpDiff('acc-1', null, null);
    expect(diff.onlyInProfile).toEqual([]);
    expect(diff.onlyInGlobal).toEqual([]);
  });

  it('arquivo corrompido (mcpServers não é objeto) ⇒ diff vazio', () => {
    const diff = computeMcpDiff('acc-1', { mcpServers: 'nao-e-objeto' }, { mcpServers: [] });
    expect(diff.onlyInProfile).toEqual([]);
    expect(diff.onlyInGlobal).toEqual([]);
  });

  it('nenhum valor de configuração aparece na saída (fixture com token plantado)', () => {
    const diff = computeMcpDiff(
      'acc-1',
      { mcpServers: { 'servidor-secreto': { args: ['--token', 'sk-ant-super-secreto-123'] } } },
      {},
    );
    const serialized = JSON.stringify(diff);
    expect(serialized).not.toContain('sk-ant-super-secreto-123');
    expect(diff.onlyInProfile).toEqual(['servidor-secreto']);
  });

  it('nomes iguais nos dois lados ⇒ nenhuma diferença', () => {
    const diff = computeMcpDiff('acc-1', { mcpServers: { a: {} } }, { mcpServers: { a: {} } });
    expect(diff.onlyInProfile).toEqual([]);
    expect(diff.onlyInGlobal).toEqual([]);
  });
});
