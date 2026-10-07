import { describe, expect, it } from 'vitest';
import type { ProviderEntry } from '../src/shared/providers';
import { buildProviderEnv } from '../src/main/providers/provider-env';

// T1306 (011-contas-e-provedores, etapa 3) — `buildProviderEnv` (data-model.md
// §5): puro, monta `entry.env` + segredos do cofre; chave secreta ausente no
// cofre -> `missing-secret` NOMEANDO a variável (nunca o valor); nunca
// inclui CLAUDE_CONFIG_DIR/marcadores, mesmo que a entrada os carregasse por
// algum motivo; nunca loga.

function makeEntry(overrides: Partial<ProviderEntry> = {}): ProviderEntry {
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

describe('buildProviderEnv (puro)', () => {
  it('monta env de `entry.env` + segredos lidos do cofre', () => {
    const secrets = new Map([['ANTHROPIC_AUTH_TOKEN', 'segredo-de-verdade']]);
    const result = buildProviderEnv(makeEntry(), (key) => secrets.get(key) ?? null);
    expect(result).toEqual({ kind: 'ok', env: { ANTHROPIC_BASE_URL: 'https://example.test', ANTHROPIC_AUTH_TOKEN: 'segredo-de-verdade' } });
  });

  it('chave secreta ausente no cofre devolve `missing-secret` nomeando a variável', () => {
    const result = buildProviderEnv(makeEntry(), () => null);
    expect(result).toEqual({ kind: 'missing-secret', envKey: 'ANTHROPIC_AUTH_TOKEN' });
  });

  it('erro nunca carrega o valor — só o nome da variável (não há valor pra vazar no teste)', () => {
    const result = buildProviderEnv(makeEntry({ secretEnvKeys: ['OUTRA_CHAVE'] }), () => null);
    expect(result).toEqual({ kind: 'missing-secret', envKey: 'OUTRA_CHAVE' });
    expect(JSON.stringify(result)).not.toContain('segredo');
  });

  it('sem `secretEnvKeys`, devolve só o env não sensível', () => {
    const result = buildProviderEnv(makeEntry({ secretEnvKeys: [] }), () => {
      throw new Error('não deveria ler o cofre sem secretEnvKeys');
    });
    expect(result).toEqual({ kind: 'ok', env: { ANTHROPIC_BASE_URL: 'https://example.test' } });
  });

  it('múltiplos segredos: todos resolvidos monta o env completo', () => {
    const secrets = new Map([
      ['ANTHROPIC_AUTH_TOKEN', 'token-1'],
      ['OUTRA_CHAVE', 'token-2'],
    ]);
    const entry = makeEntry({ secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN', 'OUTRA_CHAVE'] });
    const result = buildProviderEnv(entry, (key) => secrets.get(key) ?? null);
    expect(result).toEqual({
      kind: 'ok',
      env: { ANTHROPIC_BASE_URL: 'https://example.test', ANTHROPIC_AUTH_TOKEN: 'token-1', OUTRA_CHAVE: 'token-2' },
    });
  });

  it('primeira chave secreta ausente vence (falha rápida, sessão nunca nasce meio-autenticada)', () => {
    const secrets = new Map([['ANTHROPIC_AUTH_TOKEN', 'token-1']]);
    const entry = makeEntry({ secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN', 'FALTANDO'] });
    const result = buildProviderEnv(entry, (key) => secrets.get(key) ?? null);
    expect(result).toEqual({ kind: 'missing-secret', envKey: 'FALTANDO' });
  });

  it('CLAUDE_CONFIG_DIR e marcadores de sessão-filha nunca entram, mesmo presentes na entrada (defesa em profundidade)', () => {
    // Entrada corrompida à mão (bypassando o sanitize) — provider-env.ts precisa
    // ser a última barreira, não confiar cegamente que quem chamou já filtrou.
    const entry = makeEntry({ env: { ANTHROPIC_BASE_URL: 'https://example.test', CLAUDE_CONFIG_DIR: '/tmp/sequestro', CLAUDECODE: '1' }, secretEnvKeys: [] });
    const result = buildProviderEnv(entry, () => null);
    expect(result).toEqual({ kind: 'ok', env: { ANTHROPIC_BASE_URL: 'https://example.test' } });
  });

  it('a função nunca loga (sem side effect de console)', () => {
    const spy = { called: false };
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {
      spy.called = true;
    };
    console.error = () => {
      spy.called = true;
    };
    try {
      buildProviderEnv(makeEntry(), () => null);
      buildProviderEnv(makeEntry(), (key) => `valor-de-${key}`);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    expect(spy.called).toBe(false);
  });
});
