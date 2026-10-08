import type { CredentialPair } from '../../src/main/accounts/account-mod';
import type { VaultLike, VaultWriteResult } from '../../src/main/accounts/vault';
import type { HttpResponseLike } from '../../src/main/accounts/usage-client';
import type { AccountId, LocalAccountMeta } from '../../src/shared/accounts';

// Shared fixtures for the local-mod / vault test files (localModFreshness,
// accountModContract, refreshCoordinator): in-memory vault, fake HTTP
// response, credential pair and account meta builders.

export class FakeVault implements VaultLike {
  private readonly entries = new Map<string, string>();
  readonly writeCalls: string[] = [];
  readonly failWriteFor = new Set<string>();
  /** Ids whose write THROWS instead of returning `vault-unavailable`: simulates the real I/O error `writeVaultFile` rethrows. */
  readonly throwWriteFor = new Set<string>();
  /** Optional hook to track ORDER between vault writes and other calls (e.g. usage reads). */
  onWrite: ((id: string) => void) | null = null;

  read(id: string): string | null {
    return this.entries.get(id) ?? null;
  }
  write(id: string, plainText: string): VaultWriteResult {
    this.writeCalls.push(id);
    this.onWrite?.(id);
    if (this.throwWriteFor.has(id)) throw new Error('EIO (fake) — falha de I/O real do cofre');
    if (this.failWriteFor.has(id)) return { kind: 'vault-unavailable' };
    this.entries.set(id, plainText);
    return { kind: 'ok' };
  }
}

export function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { status, json: async () => body };
}

export function buildPair(overrides: Partial<CredentialPair> = {}): CredentialPair {
  return { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600_000, scopes: [], ...overrides };
}

export function accountOf(id: AccountId, label = `Conta ${id}`): LocalAccountMeta {
  return { id, label, plan: null };
}
