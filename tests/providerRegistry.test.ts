import { describe, expect, it } from 'vitest';
import type { ProvidersConfigDto } from '../src/shared/providers';
import { defaultProvidersConfig } from '../src/shared/providers';
import { createProviderRegistry, type ProviderRegistryDeps } from '../src/main/providers/provider-registry';
import type { SecretsStatus } from '../src/main/providers/provider-secrets';

// T1312 (011-contas-e-provedores, etapa 3) — as 6 invariantes de
// contracts/provider-registry.md: segredo nunca em retorno; classe B ->
// unsupported-class; env do provider não sequestra CLAUDE_CONFIG_DIR/
// marcadores; missing-secret aborta o lançamento; vault-unavailable em
// escrita e lançamento; remoção apaga segredo e preserva config dir.
// Inclui duas entradas fictícias de formatos diferentes (D1/R2).

interface FakeVault {
  secrets: Map<string, string>;
  available: boolean;
  ensuredDirs: string[];
}

function makeFakeDeps(initial: ProvidersConfigDto = defaultProvidersConfig()): { deps: ProviderRegistryDeps; vault: FakeVault; getConfigSnapshot: () => ProvidersConfigDto } {
  let config = initial;
  const vault: FakeVault = { secrets: new Map(), available: true, ensuredDirs: [] };

  const deps: ProviderRegistryDeps = {
    getConfig: () => config,
    setConfig: (next) => {
      config = next;
    },
    readSecret: (providerId, envKey) => vault.secrets.get(`${providerId}:${envKey}`) ?? null,
    writeSecret: (providerId, envKey, value) => {
      if (!vault.available) return { kind: 'vault-unavailable' };
      vault.secrets.set(`${providerId}:${envKey}`, value);
      return { kind: 'ok' };
    },
    deleteSecrets: (providerId, envKeys) => {
      for (const envKey of envKeys) vault.secrets.delete(`${providerId}:${envKey}`);
    },
    secretsStatus: (providerId, envKeys): SecretsStatus => {
      if (!vault.available) return 'vault-unavailable';
      const allConfigured = envKeys.every((envKey) => vault.secrets.has(`${providerId}:${envKey}`));
      return allConfigured ? 'configured' : 'missing';
    },
    ensureConfigDir: (configDirName) => {
      const path = `/userdata/providers/${configDirName}`;
      vault.ensuredDirs.push(path);
      return path;
    },
  };

  return { deps, vault, getConfigSnapshot: () => config };
}

describe('provider-registry — CRUD e validação', () => {
  it('upsert cria entrada classe A com id derivado do label', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'OpenRouter', class: 'A', env: { ANTHROPIC_BASE_URL: 'https://openrouter.test' }, secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'] });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.id).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
    }
  });

  it('colisão de id na criação usa sufixo numérico, nunca sobrescrita silenciosa', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const first = registry.upsert({ label: 'Meu Provider', class: 'A', env: {}, secretEnvKeys: [] });
    const second = registry.upsert({ label: 'Meu Provider', class: 'A', env: {}, secretEnvKeys: [] });
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    if (first.kind === 'ok' && second.kind === 'ok') {
      expect(first.id).not.toBe(second.id);
    }
    expect(registry.list()).toHaveLength(2);
  });

  it('upsert de atualização (id presente) não duplica entrada', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'Provider X', class: 'A', env: {}, secretEnvKeys: [] });
    expect(created.kind).toBe('ok');
    if (created.kind !== 'ok') return;
    const updated = registry.upsert({ id: created.id, label: 'Provider X renomeado', class: 'A', env: {}, secretEnvKeys: [] });
    expect(updated).toEqual({ kind: 'ok', id: created.id });
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].label).toBe('Provider X renomeado');
  });

  it('classe A com `command` não-nulo é recusado', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'X', class: 'A', command: 'binario', env: {}, secretEnvKeys: [] });
    expect(result.kind).toBe('invalid');
  });

  it('classe B sem `command` é recusada', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'CLI terceiro', class: 'B', command: '', env: {}, secretEnvKeys: [] });
    expect(result.kind).toBe('invalid');
  });

  it('classe B com `command` válido é aceita (estrutura sim, execução não — D5)', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'CLI terceiro', class: 'B', command: 'algum-cli', env: {}, secretEnvKeys: [] });
    expect(result.kind).toBe('ok');
  });

  it('env com CLAUDE_CONFIG_DIR é recusado (invariante 3)', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'X', class: 'A', env: { CLAUDE_CONFIG_DIR: '/hack' }, secretEnvKeys: [] });
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.field).toBe('env');
  });

  it('env com marcador de sessão-filha é recusado (invariante 3)', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'X', class: 'A', env: { CLAUDE_CODE_ENTRYPOINT: 'x' }, secretEnvKeys: [] });
    expect(result.kind).toBe('invalid');
  });

  it('chave em `env` e `secretEnvKeys` ao mesmo tempo é recusada (invariante 2)', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'X', class: 'A', env: { TOKEN: 'plain' }, secretEnvKeys: ['TOKEN'] });
    expect(result.kind).toBe('invalid');
  });

  it('remove apaga a entrada e os segredos dela do cofre, preservando o config dir', () => {
    const { deps, vault } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'X', class: 'A', env: {}, secretEnvKeys: ['TOKEN'] });
    expect(created.kind).toBe('ok');
    if (created.kind !== 'ok') return;
    registry.setSecret(created.id, 'TOKEN', 'valor-secreto');
    expect(vault.secrets.has(`${created.id}:TOKEN`)).toBe(true);

    registry.remove(created.id);

    expect(registry.list()).toHaveLength(0);
    expect(vault.secrets.has(`${created.id}:TOKEN`)).toBe(false);
    // "Não apaga o config dir" — remove() nunca invoca ensureConfigDir/rm.
    expect(vault.ensuredDirs).toHaveLength(0);
  });
});

describe('provider-registry — invariante 1: segredo nunca sai de list/upsert/setSecret', () => {
  function assertNoLeak(payload: unknown, planted: string): void {
    expect(JSON.stringify(payload)).not.toContain(planted);
  }

  it('list() nunca inclui valor de segredo', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'X', class: 'A', env: {}, secretEnvKeys: ['TOKEN'] });
    if (created.kind !== 'ok') throw new Error('setup falhou');
    registry.setSecret(created.id, 'TOKEN', 'PLANTED-SECRET-9x8y7z');
    assertNoLeak(registry.list(), 'PLANTED-SECRET-9x8y7z');
  });

  it('upsert() nunca ecoa segredo (nem em erro de validação)', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const result = registry.upsert({ label: 'X', class: 'A', env: { TOKEN: 'PLANTED-SECRET-abc' }, secretEnvKeys: ['TOKEN'] });
    assertNoLeak(result, 'PLANTED-SECRET-abc');
  });

  it('setSecret() devolve só o status, nunca o valor', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'X', class: 'A', env: {}, secretEnvKeys: ['TOKEN'] });
    if (created.kind !== 'ok') throw new Error('setup falhou');
    const result = registry.setSecret(created.id, 'TOKEN', 'PLANTED-SECRET-def');
    expect(result).toEqual({ kind: 'ok' });
    assertNoLeak(result, 'PLANTED-SECRET-def');
  });
});

describe('provider-registry — invariante 2: classe B nunca spawna (C20/D5)', () => {
  it('resolveLaunch de classe B é sempre unsupported-class', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'CLI terceiro', class: 'B', command: 'algum-cli', env: {}, secretEnvKeys: [] });
    if (created.kind !== 'ok') throw new Error('setup falhou');
    expect(registry.resolveLaunch(created.id)).toEqual({ kind: 'unsupported-class' });
  });
});

describe('provider-registry — invariante 4: falta de segredo aborta o lançamento', () => {
  it('resolveLaunch sem o segredo no cofre devolve missing-secret nomeando a variável', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'X', class: 'A', env: {}, secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'] });
    if (created.kind !== 'ok') throw new Error('setup falhou');
    expect(registry.resolveLaunch(created.id)).toEqual({ kind: 'missing-secret', envKey: 'ANTHROPIC_AUTH_TOKEN' });
  });

  it('resolveLaunch com o segredo presente devolve ok com env + configDir', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'X', class: 'A', env: { ANTHROPIC_BASE_URL: 'https://x.test' }, secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'] });
    if (created.kind !== 'ok') throw new Error('setup falhou');
    registry.setSecret(created.id, 'ANTHROPIC_AUTH_TOKEN', 'token-real');
    const result = registry.resolveLaunch(created.id);
    expect(result).toEqual({ kind: 'ok', env: { ANTHROPIC_BASE_URL: 'https://x.test', ANTHROPIC_AUTH_TOKEN: 'token-real' }, configDir: expect.stringContaining(created.id) });
  });

  it('provider inexistente devolve not-found', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    expect(registry.resolveLaunch('nunca-existiu')).toEqual({ kind: 'not-found' });
  });
});

describe('provider-registry — invariante 5: safeStorage indisponível', () => {
  it('setSecret devolve vault-unavailable, nunca degrada pra texto plano', () => {
    const { deps, vault } = makeFakeDeps();
    vault.available = false;
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'X', class: 'A', env: {}, secretEnvKeys: ['TOKEN'] });
    if (created.kind !== 'ok') throw new Error('setup falhou');
    expect(registry.setSecret(created.id, 'TOKEN', 'valor')).toEqual({ kind: 'vault-unavailable' });
  });

  it('resolveLaunch devolve vault-unavailable quando o cofre está indisponível', () => {
    const { deps, vault } = makeFakeDeps();
    const registry = createProviderRegistry(deps);
    const created = registry.upsert({ label: 'X', class: 'A', env: {}, secretEnvKeys: ['TOKEN'] });
    if (created.kind !== 'ok') throw new Error('setup falhou');
    vault.available = false;
    expect(registry.resolveLaunch(created.id)).toEqual({ kind: 'vault-unavailable' });
  });
});

describe('provider-registry — D1/R2: duas entradas de formatos DIFERENTES rodam a mesma bateria', () => {
  it('provider "openrouter-like" e provider de outro formato convivem sem campo nomeado', () => {
    const { deps } = makeFakeDeps();
    const registry = createProviderRegistry(deps);

    const openrouterLike = registry.upsert({
      label: 'Provider OpenRouter-like',
      class: 'A',
      env: { ANTHROPIC_BASE_URL: 'https://one.test', ANTHROPIC_MODEL: 'modelo-um' },
      secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'],
    });
    const otherShapeLike = registry.upsert({
      label: 'Provider outro formato',
      class: 'A',
      env: { CUSTOM_ENDPOINT: 'https://two.test', CUSTOM_HEADER_X: 'v1' },
      secretEnvKeys: ['CUSTOM_API_KEY'],
    });

    expect(openrouterLike.kind).toBe('ok');
    expect(otherShapeLike.kind).toBe('ok');
    if (openrouterLike.kind !== 'ok' || otherShapeLike.kind !== 'ok') return;

    registry.setSecret(openrouterLike.id, 'ANTHROPIC_AUTH_TOKEN', 'token-1');
    registry.setSecret(otherShapeLike.id, 'CUSTOM_API_KEY', 'token-2');

    const launch1 = registry.resolveLaunch(openrouterLike.id);
    const launch2 = registry.resolveLaunch(otherShapeLike.id);
    expect(launch1).toEqual({ kind: 'ok', env: { ANTHROPIC_BASE_URL: 'https://one.test', ANTHROPIC_MODEL: 'modelo-um', ANTHROPIC_AUTH_TOKEN: 'token-1' }, configDir: expect.any(String) });
    expect(launch2).toEqual({ kind: 'ok', env: { CUSTOM_ENDPOINT: 'https://two.test', CUSTOM_HEADER_X: 'v1', CUSTOM_API_KEY: 'token-2' }, configDir: expect.any(String) });

    expect(registry.list()).toHaveLength(2);
  });
});
