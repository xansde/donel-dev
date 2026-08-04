import { describe, expect, it, vi } from 'vitest';
import { importProfileCredentials, type CredentialsImportDeps } from '../src/main/accounts/migration/credentials-import';
import type { CredentialPair } from '../src/main/accounts/account-mod';
import type { VaultLike, VaultWriteResult } from '../src/main/accounts/vault';

// T1210 (011-contas-e-provedores, etapa 2) — credentials-import.ts é a única
// função de migração DENTRO da fronteira de credencial (o par sai do arquivo
// e vai direto para o cofre, sem passar por variável de retorno).

const FAKE_PAIR: CredentialPair = {
  accessToken: 'sk-ant-fake-secret-token-123',
  refreshToken: 'sk-ant-fake-refresh-456',
  expiresAt: 9999999999999,
  scopes: ['user:inference'],
};

function makeVault(overrides: Partial<VaultLike> = {}): VaultLike {
  return {
    read: vi.fn(() => null),
    write: vi.fn((): VaultWriteResult => ({ kind: 'ok' })),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CredentialsImportDeps> = {}): CredentialsImportDeps {
  return {
    isVaultAvailable: () => true,
    readCredentialsFile: () => ({ kind: 'ok', pair: FAKE_PAIR }),
    vault: makeVault(),
    generateAccountId: (slug) => `migrated:${slug}`,
    ...overrides,
  };
}

const PROFILE = { slug: 'acc-1', displayName: 'Conta 1', credentialsPath: 'C:\\home\\.claude-profiles\\acc-1\\.credentials.json' };

describe('importProfileCredentials', () => {
  it('importa UM perfil por chamada e grava no cofre', () => {
    const vault = makeVault();
    const result = importProfileCredentials(PROFILE, makeDeps({ vault }));
    expect(result).toEqual({ kind: 'imported', accountId: 'migrated:acc-1', label: 'Conta 1' });
    expect(vault.write).toHaveBeenCalledTimes(1);
    expect(vault.write).toHaveBeenCalledWith('migrated:acc-1', JSON.stringify(FAKE_PAIR));
  });

  it('par NUNCA aparece no retorno (varredura da saída inteira)', () => {
    const result = importProfileCredentials(PROFILE, makeDeps());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FAKE_PAIR.accessToken);
    expect(serialized).not.toContain(FAKE_PAIR.refreshToken);
  });

  it('par nunca aparece em mensagem de erro/log (nenhum console.* chamado com o par)', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    importProfileCredentials(PROFILE, makeDeps());
    for (const call of [...consoleSpy.mock.calls, ...errorSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(FAKE_PAIR.accessToken);
    }
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('cofre indisponível ⇒ recusa ANTES de ler o arquivo', () => {
    const readCredentialsFile = vi.fn(() => ({ kind: 'ok' as const, pair: FAKE_PAIR }));
    const result = importProfileCredentials(PROFILE, makeDeps({ isVaultAvailable: () => false, readCredentialsFile }));
    expect(result).toEqual({ kind: 'failed', reason: 'vault-unavailable' });
    expect(readCredentialsFile).not.toHaveBeenCalled();
  });

  it('arquivo com formato inválido ⇒ failed: invalid-format, sem gravar nada', () => {
    const vault = makeVault();
    const result = importProfileCredentials(PROFILE, makeDeps({ readCredentialsFile: () => ({ kind: 'invalid-format' }), vault }));
    expect(result).toEqual({ kind: 'failed', reason: 'invalid-format' });
    expect(vault.write).not.toHaveBeenCalled();
  });

  it('arquivo ausente ⇒ absent, sem gravar nada', () => {
    const vault = makeVault();
    const result = importProfileCredentials(PROFILE, makeDeps({ readCredentialsFile: () => ({ kind: 'absent' }), vault }));
    expect(result).toEqual({ kind: 'absent' });
    expect(vault.write).not.toHaveBeenCalled();
  });

  it('cofre recusa a escrita ⇒ failed: vault-unavailable', () => {
    const vault = makeVault({ write: vi.fn((): VaultWriteResult => ({ kind: 'vault-unavailable' })) });
    const result = importProfileCredentials(PROFILE, makeDeps({ vault }));
    expect(result).toEqual({ kind: 'failed', reason: 'vault-unavailable' });
  });

  it('conta criada com { id opaco, label } — nunca e-mail (LGPD)', () => {
    const result = importProfileCredentials(PROFILE, makeDeps());
    if (result.kind !== 'imported') throw new Error('expected imported');
    expect(result.label).toBe('Conta 1');
    expect(result.label).not.toContain('@');
    expect(result.accountId).not.toContain('@');
  });
});
