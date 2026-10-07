import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planVaultReconciliation, reconcileAccountsVault } from '../src/main/accounts/vault-reconciliation';
import { createSystemVaultIoDeps, decryptVaultEntry, writeVaultEntry, type SafeStorageLike, type VaultIoDeps } from '../src/main/accounts/vault';
import { providerSecretKey } from '../src/main/providers/provider-secrets';
import type { AccountsConfig, LocalAccountMeta } from '../src/shared/accounts';
import { defaultAccountsConfig } from '../src/shared/accounts';

// 011-contas-e-provedores, etapa 3, Fase 1 (plan-etapa-3.md §4.4) — faxina do
// cofre no boot. O cofre é COMPARTILHADO com os providers
// (`provider:<id>:<ENV_KEY>`, provider-secrets.ts) e com o mod seazone
// (`seazone:session`) — o escopo é estritamente entrada de CONTA: id opaco
// (sem ':') não referenciado em `localAccounts` + `seazone:session` (pool
// Seazone fora, decisão do dono). NUNCA `provider:*` nem outro namespace com
// ':' — é o segredo vivo do OpenRouter; apagá-lo quebra o provider sem aviso.

const REFERENCED = ['acc-1', 'acc-2', 'acc-3', 'acc-4'];
const ORPHANS = ['tech-1', 'tech-2', 'tech-3', 'tech-4', 'tech-5', 'tech-6', 'tech-7', 'tech-8'];
const PROVIDER_KEY = providerSecretKey('openrouter', 'OPENROUTER_API_KEY');
const ALL_KEYS = [...REFERENCED, ...ORPHANS, 'seazone:session', PROVIDER_KEY, 'future:x'];

function localAccountsFor(ids: readonly string[]): readonly LocalAccountMeta[] {
  return ids.map((id) => ({ id, label: id, plan: null }));
}

function localModConfig(overrides: Partial<AccountsConfig> = {}): AccountsConfig {
  return { ...defaultAccountsConfig(), mod: 'local', localAccounts: localAccountsFor(REFERENCED), ...overrides };
}

describe('planVaultReconciliation (puro)', () => {
  it('remove exatamente as 8 órfãs + seazone:session — preserva referenciadas, provider:* e namespace desconhecido', () => {
    const result = planVaultReconciliation(ALL_KEYS, localModConfig());
    expect([...result].sort()).toEqual([...ORPHANS, 'seazone:session'].sort());
    expect(result).not.toContain(PROVIDER_KEY);
    expect(result).not.toContain('future:x');
    for (const id of REFERENCED) expect(result).not.toContain(id);
  });

  it('guarda: mod seazone -> nada (mod inerte na UI guarda chaves próprias)', () => {
    expect(planVaultReconciliation(ALL_KEYS, localModConfig({ mod: 'seazone', seazone: { baseUrl: 'https://x.seazone.dev' } }))).toEqual([]);
  });

  it('guarda: mod null -> nada', () => {
    expect(planVaultReconciliation(ALL_KEYS, localModConfig({ mod: null }))).toEqual([]);
  });

  it('guarda: localAccounts vazio -> nada (config corrompida/vazia não apaga as contas boas)', () => {
    expect(planVaultReconciliation(ALL_KEYS, localModConfig({ localAccounts: [] }))).toEqual([]);
  });
});

describe('reconcileAccountsVault — arquivo real + safeStorage falso', () => {
  function makeFakeSafeStorage(): SafeStorageLike {
    return {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`enc:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8'),
      decryptString: (encrypted: Buffer) => {
        const raw = encrypted.toString('utf8');
        if (!raw.startsWith('enc:')) throw new Error('formato inválido');
        return Buffer.from(raw.slice(4), 'base64').toString('utf8');
      },
    };
  }

  it('depois da faxina, o segredo do provider e as 4 contas AINDA decifram', () => {
    const dir = mkdtempSync(join(tmpdir(), 'donel-vault-reconcile-'));
    const vaultPath = join(dir, 'accounts-vault.json');
    const io: VaultIoDeps = createSystemVaultIoDeps();
    const safeStorage = makeFakeSafeStorage();

    try {
      for (const id of REFERENCED) writeVaultEntry(vaultPath, safeStorage, io, id, `pair-${id}`);
      for (const id of ORPHANS) writeVaultEntry(vaultPath, safeStorage, io, id, `pair-${id}`);
      writeVaultEntry(vaultPath, safeStorage, io, 'seazone:session', 'session-token');
      writeVaultEntry(vaultPath, safeStorage, io, PROVIDER_KEY, 'sk-or-live-secret');
      writeVaultEntry(vaultPath, safeStorage, io, 'future:x', 'valor-desconhecido');

      const removed = reconcileAccountsVault(vaultPath, io, localModConfig());

      expect([...removed].sort()).toEqual([...ORPHANS, 'seazone:session'].sort());
      for (const id of REFERENCED) expect(decryptVaultEntry(vaultPath, safeStorage, io, id)).toBe(`pair-${id}`);
      expect(decryptVaultEntry(vaultPath, safeStorage, io, PROVIDER_KEY)).toBe('sk-or-live-secret');
      expect(decryptVaultEntry(vaultPath, safeStorage, io, 'future:x')).toBe('valor-desconhecido');
      for (const id of ORPHANS) expect(decryptVaultEntry(vaultPath, safeStorage, io, id)).toBeNull();
      expect(decryptVaultEntry(vaultPath, safeStorage, io, 'seazone:session')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('nada a remover -> nenhuma entrada perdida (config sem órfãs)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'donel-vault-reconcile-'));
    const vaultPath = join(dir, 'accounts-vault.json');
    const io: VaultIoDeps = createSystemVaultIoDeps();
    const safeStorage = makeFakeSafeStorage();

    try {
      for (const id of REFERENCED) writeVaultEntry(vaultPath, safeStorage, io, id, `pair-${id}`);
      const removed = reconcileAccountsVault(vaultPath, io, localModConfig());
      expect(removed).toEqual([]);
      for (const id of REFERENCED) expect(decryptVaultEntry(vaultPath, safeStorage, io, id)).toBe(`pair-${id}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
