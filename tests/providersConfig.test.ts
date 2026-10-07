import { describe, expect, it } from 'vitest';
import { defaultProvidersConfig } from '../src/shared/providers';
import { sanitizeProvidersConfig } from '../src/main/providers/providers-config';

// T1303 (011-contas-e-provedores, etapa 3) — `sanitizeProvidersConfig`
// resiliente no mesmo espírito de `sanitizeAppConfig`/`sanitizeAccountsConfig`:
// chave ausente/JSON corrompido/`entries` não array -> registry vazio (C14);
// entrada inválida é DESCARTADA isolada, sem derrubar as boas (invariante 5,
// data-model.md §1).

function validEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'meu-provider',
    label: 'Meu provider',
    class: 'A',
    command: null,
    env: { ANTHROPIC_BASE_URL: 'https://example.test' },
    secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'],
    configDirName: 'meu-provider',
    ...overrides,
  };
}

describe('sanitizeProvidersConfig (puro)', () => {
  const defaults = defaultProvidersConfig();

  it('chave ausente cai no registry vazio (C14)', () => {
    expect(sanitizeProvidersConfig(undefined)).toEqual(defaults);
    expect(sanitizeProvidersConfig(null)).toEqual(defaults);
  });

  it('JSON corrompido (não-objeto) cai no registry vazio', () => {
    expect(sanitizeProvidersConfig('not-an-object')).toEqual(defaults);
    expect(sanitizeProvidersConfig(42)).toEqual(defaults);
    expect(sanitizeProvidersConfig([1, 2, 3])).toEqual(defaults);
  });

  it('`entries` ausente ou não-array cai em registry vazio', () => {
    expect(sanitizeProvidersConfig({ version: 1 })).toEqual(defaults);
    expect(sanitizeProvidersConfig({ version: 1, entries: 'nope' })).toEqual(defaults);
  });

  it('entrada válida sobrevive', () => {
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry()] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual(validEntry());
  });

  it('entrada inválida é descartada, as válidas sobrevivem (invariante 5)', () => {
    const result = sanitizeProvidersConfig({
      version: 1,
      entries: [validEntry(), { id: 'quebrada' }, 'not-an-object', validEntry({ id: 'outro-provider', configDirName: 'outro-provider' })],
    });
    expect(result.entries.map((e) => e.id)).toEqual(['meu-provider', 'outro-provider']);
  });

  it('id fora do padrão `^[a-z0-9][a-z0-9-]{0,31}$` é recusado', () => {
    const invalidIds = ['Maiuscula', '-comeca-com-traço', 'tem espaço', '', 'a'.repeat(33), 'com_underscore'];
    for (const id of invalidIds) {
      const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ id, configDirName: 'x' })] });
      expect(result.entries).toHaveLength(0);
    }
  });

  it('id válido no limite (32 chars) é aceito', () => {
    const id = 'a'.repeat(32);
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ id })] });
    expect(result.entries).toHaveLength(1);
  });

  it('`class` desconhecida é recusada', () => {
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ class: 'C' })] });
    expect(result.entries).toHaveLength(0);
  });

  it('classe A com `command` não-nulo é recusada (invariante 4)', () => {
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ command: 'algum-binario' })] });
    expect(result.entries).toHaveLength(0);
  });

  it('classe B com `command` vazio/nulo é recusada (invariante 4)', () => {
    const resultNull = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ class: 'B', command: null, secretEnvKeys: [] })] });
    expect(resultNull.entries).toHaveLength(0);
    const resultEmpty = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ class: 'B', command: '', secretEnvKeys: [] })] });
    expect(resultEmpty.entries).toHaveLength(0);
  });

  it('classe B com `command` válido é aceita', () => {
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ class: 'B', command: 'algum-cli', secretEnvKeys: [] })] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].command).toBe('algum-cli');
  });

  it('chave de `env` que também está em `secretEnvKeys` é recusada (invariante 2)', () => {
    const result = sanitizeProvidersConfig({
      version: 1,
      entries: [validEntry({ env: { ANTHROPIC_AUTH_TOKEN: 'plain-text-leak' }, secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'] })],
    });
    expect(result.entries).toHaveLength(0);
  });

  it('`CLAUDE_CONFIG_DIR` em `env` é recusado (invariante 3)', () => {
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ env: { CLAUDE_CONFIG_DIR: '/tmp/x' } })] });
    expect(result.entries).toHaveLength(0);
  });

  it('marcador de sessão-filha (`CLAUDECODE`/`CLAUDE_CODE_*`) em `env` é recusado (invariante 3)', () => {
    const result1 = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ env: { CLAUDECODE: '1' } })] });
    expect(result1.entries).toHaveLength(0);
    const result2 = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ env: { CLAUDE_CODE_ENTRYPOINT: 'x' } })] });
    expect(result2.entries).toHaveLength(0);
  });

  it('marcador de sessão-filha em `secretEnvKeys` também é recusado', () => {
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR'] })] });
    expect(result.entries).toHaveLength(0);
  });

  it('label vazia é recusada', () => {
    const result = sanitizeProvidersConfig({ version: 1, entries: [validEntry({ label: '  ' })] });
    expect(result.entries).toHaveLength(0);
  });

  it('duas entradas de FORMATOS DIFERENTES sobrevivem juntas (D1/R2 — sem campo nomeado de provider)', () => {
    const openrouterLike = validEntry({
      id: 'provider-um',
      configDirName: 'provider-um',
      env: { ANTHROPIC_BASE_URL: 'https://one.test', ANTHROPIC_MODEL: 'modelo-um' },
      secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'],
    });
    const otherShapeLike = validEntry({
      id: 'provider-dois',
      configDirName: 'provider-dois',
      env: { CUSTOM_ENDPOINT: 'https://two.test', CUSTOM_HEADER_X: 'v1' },
      secretEnvKeys: ['CUSTOM_API_KEY'],
    });
    const result = sanitizeProvidersConfig({ version: 1, entries: [openrouterLike, otherShapeLike] });
    expect(result.entries.map((e) => e.id)).toEqual(['provider-um', 'provider-dois']);
  });

  it('nunca lança para qualquer entrada maluca', () => {
    expect(() =>
      sanitizeProvidersConfig({ version: 1, entries: [null, undefined, 42, [], { id: {} }, { env: 'nope' }] }),
    ).not.toThrow();
  });
});
