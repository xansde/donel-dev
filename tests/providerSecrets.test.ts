import { describe, expect, it } from 'vitest';
import type { SafeStorageLike, VaultIoDeps } from '../src/main/accounts/vault';
import {
  deleteProviderSecrets,
  providerSecretKey,
  providerSecretsStatus,
  readProviderSecret,
  writeProviderSecret,
} from '../src/main/providers/provider-secrets';

// T1308 (011-contas-e-provedores, etapa 3) — adaptador do cofre da ETAPA 1
// (vault.ts) no namespace `provider:<id>:<ENV_KEY>` (C19/data-model.md §4):
// round-trip com `safeStorage` falso; `safeStorage` indisponível ->
// `vault-unavailable` (nunca texto plano); `secretsStatus` devolve
// boolean/enum, nunca valor; remover provider apaga as chaves dele.

function makeFakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => Buffer.from(`enc:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const raw = encrypted.toString('utf8');
      if (!raw.startsWith('enc:')) throw new Error('formato inválido');
      return Buffer.from(raw.slice(4), 'base64').toString('utf8');
    },
  };
}

function makeMockIo(): VaultIoDeps {
  const files: Record<string, string> = {};
  return {
    existsSync: (path: string) => path in files,
    readFileText: (path: string) => (path in files ? files[path] : null),
    writeFileText: (path: string, content: string) => {
      files[path] = content;
    },
    renameFile: (from: string, to: string) => {
      files[to] = files[from];
      delete files[from];
    },
    mkdirSync: () => undefined,
    unlinkFile: (path: string) => {
      delete files[path];
    },
  };
}

const VAULT_PATH = 'C:\\fake\\userData\\accounts-vault.json';

describe('providerSecretKey', () => {
  it('monta o namespace `provider:<id>:<ENV_KEY>`', () => {
    expect(providerSecretKey('openrouter-a1', 'ANTHROPIC_AUTH_TOKEN')).toBe('provider:openrouter-a1:ANTHROPIC_AUTH_TOKEN');
  });
});

describe('writeProviderSecret / readProviderSecret (round-trip)', () => {
  it('escreve e lê de volta com safeStorage fake', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    const writeResult = writeProviderSecret(VAULT_PATH, safeStorage, io, 'meu-provider', 'ANTHROPIC_AUTH_TOKEN', 'valor-secreto');
    expect(writeResult).toEqual({ kind: 'ok' });

    const readBack = readProviderSecret(VAULT_PATH, safeStorage, io, 'meu-provider', 'ANTHROPIC_AUTH_TOKEN');
    expect(readBack).toBe('valor-secreto');
  });

  it('chave ausente devolve null', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    expect(readProviderSecret(VAULT_PATH, safeStorage, io, 'sem-nada', 'X')).toBeNull();
  });

  it('não vaza o arquivo cru cifrado como texto plano', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    writeProviderSecret(VAULT_PATH, safeStorage, io, 'meu-provider', 'ANTHROPIC_AUTH_TOKEN', 'PLANTED-SECRET-abc123');
    const raw = io.readFileText(VAULT_PATH) ?? '';
    expect(raw).not.toContain('PLANTED-SECRET-abc123');
  });
});

describe('safeStorage indisponível', () => {
  it('escrita recusa com `vault-unavailable`, nunca degrada pra texto plano', () => {
    const safeStorage = makeFakeSafeStorage(false);
    const io = makeMockIo();
    const result = writeProviderSecret(VAULT_PATH, safeStorage, io, 'meu-provider', 'ANTHROPIC_AUTH_TOKEN', 'valor');
    expect(result).toEqual({ kind: 'vault-unavailable' });
    expect(io.readFileText(VAULT_PATH)).toBeNull();
  });
});

describe('providerSecretsStatus', () => {
  it('devolve `vault-unavailable` quando o safeStorage está indisponível', () => {
    const safeStorage = makeFakeSafeStorage(false);
    const io = makeMockIo();
    expect(providerSecretsStatus(VAULT_PATH, safeStorage, io, 'meu-provider', ['ANTHROPIC_AUTH_TOKEN'])).toBe('vault-unavailable');
  });

  it('devolve `missing` quando alguma secretEnvKey não está no cofre', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    expect(providerSecretsStatus(VAULT_PATH, safeStorage, io, 'meu-provider', ['ANTHROPIC_AUTH_TOKEN'])).toBe('missing');
  });

  it('devolve `configured` quando todas as secretEnvKeys estão no cofre', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    writeProviderSecret(VAULT_PATH, safeStorage, io, 'meu-provider', 'ANTHROPIC_AUTH_TOKEN', 'valor');
    expect(providerSecretsStatus(VAULT_PATH, safeStorage, io, 'meu-provider', ['ANTHROPIC_AUTH_TOKEN'])).toBe('configured');
  });

  it('sem secretEnvKeys nenhuma, devolve `configured` (nada a configurar)', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    expect(providerSecretsStatus(VAULT_PATH, safeStorage, io, 'meu-provider', [])).toBe('configured');
  });

  it('nunca devolve o valor — só o enum/boolean derivado', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    writeProviderSecret(VAULT_PATH, safeStorage, io, 'meu-provider', 'ANTHROPIC_AUTH_TOKEN', 'PLANTED-SECRET-xyz');
    const status = providerSecretsStatus(VAULT_PATH, safeStorage, io, 'meu-provider', ['ANTHROPIC_AUTH_TOKEN']);
    expect(JSON.stringify(status)).not.toContain('PLANTED-SECRET-xyz');
  });
});

describe('deleteProviderSecrets', () => {
  it('remove só as chaves do provider indicado, preserva as de outro provider', () => {
    const safeStorage = makeFakeSafeStorage();
    const io = makeMockIo();
    writeProviderSecret(VAULT_PATH, safeStorage, io, 'provider-a', 'CHAVE_1', 'valor-a1');
    writeProviderSecret(VAULT_PATH, safeStorage, io, 'provider-b', 'CHAVE_1', 'valor-b1');

    deleteProviderSecrets(VAULT_PATH, io, 'provider-a', ['CHAVE_1']);

    expect(readProviderSecret(VAULT_PATH, safeStorage, io, 'provider-a', 'CHAVE_1')).toBeNull();
    expect(readProviderSecret(VAULT_PATH, safeStorage, io, 'provider-b', 'CHAVE_1')).toBe('valor-b1');
  });

  it('no-op silencioso se as chaves não existirem', () => {
    const io = makeMockIo();
    expect(() => deleteProviderSecrets(VAULT_PATH, io, 'nunca-existiu', ['X', 'Y'])).not.toThrow();
  });
});
