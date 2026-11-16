import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileReconnectStore, createReconnectRegistry } from '../src/main/accounts/reconnect-registry';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import type { HttpFetchLike } from '../src/main/accounts/usage-client';
import type { VaultLike } from '../src/main/accounts/vault';

// t-205b44c8 (incident t-fe46929a, 16/11) — the "Reconectar" mark lived only in memory, so every app start tried
// again to refresh an account already known dead: one rejected refresh (a single-use token spent for nothing) and
// one `account-pair-refresh-failed` line per account. The mark now survives a restart in a file with ids only.

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-reconnect-'));
  file = join(dir, 'accounts-reconnect.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function expiredVault(ids: readonly string[]): VaultLike {
  const entries = new Map(ids.map((id) => [id, JSON.stringify({ accessToken: `a-${id}`, refreshToken: `r-${id}`, expiresAt: 1, scopes: [] })]));
  return { read: (id) => entries.get(id) ?? null, write: () => ({ kind: 'ok' }) };
}

const usageFetch: HttpFetchLike = async () => ({ status: 200, json: async () => ({}) });

describe('reconnect registry persisted', () => {
  it('a mark survives into a new registry over the same file', () => {
    createReconnectRegistry({ store: createFileReconnectStore(() => file) }).mark('a');

    const reopened = createReconnectRegistry({ store: createFileReconnectStore(() => file) });

    expect(reopened.has('a')).toBe(true);
    expect(reopened.has('b')).toBe(false);
  });

  it('after a restart, listAccounts does not refresh a marked account again nor log a refresh failure', async () => {
    const accounts = [{ id: 'a', label: 'A', plan: null }];
    const firstRefresh = vi.fn(async () => ({ kind: 'failed' as const, reason: 'rejected' as const }));
    const firstMod = createLocalMod({
      accounts,
      vault: expiredVault(['a']),
      fetchImpl: usageFetch,
      refreshImpl: firstRefresh,
      reconnectRegistry: createReconnectRegistry({ store: createFileReconnectStore(() => file) }),
      now: () => 1000,
    });
    await firstMod.listAccounts();
    expect(firstRefresh).toHaveBeenCalledTimes(1);

    const refreshImpl = vi.fn(async () => ({ kind: 'failed' as const, reason: 'rejected' as const }));
    const onPairRefreshFailed = vi.fn();
    const mod = createLocalMod({
      accounts,
      vault: expiredVault(['a']),
      fetchImpl: usageFetch,
      refreshImpl,
      onPairRefreshFailed,
      reconnectRegistry: createReconnectRegistry({ store: createFileReconnectStore(() => file) }),
      now: () => 1000,
    });

    const result = await mod.listAccounts();

    expect(result.kind).toBe('ok');
    expect(refreshImpl).not.toHaveBeenCalled();
    expect(onPairRefreshFailed).not.toHaveBeenCalled();
  });

  it('clear removes the id from the file', () => {
    const registry = createReconnectRegistry({ store: createFileReconnectStore(() => file) });
    registry.mark('a');
    registry.mark('b');

    registry.clear('a');

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['b']);
    expect(createReconnectRegistry({ store: createFileReconnectStore(() => file) }).has('a')).toBe(false);
  });

  it('the file holds only the account ids, as a JSON array', () => {
    const registry = createReconnectRegistry({ store: createFileReconnectStore(() => file) });
    registry.mark('a');
    registry.mark('b');

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['a', 'b']);
  });

  it('an unreadable file is an empty registry and never throws', () => {
    writeFileSync(file, '{not json', 'utf8');
    const registry = createReconnectRegistry({ store: createFileReconnectStore(() => file) });

    expect(registry.has('a')).toBe(false);
    expect(() => registry.mark('a')).not.toThrow();
    expect(createReconnectRegistry({ store: createFileReconnectStore(() => join(dir, 'missing', 'x.json')) }).has('a')).toBe(false);
  });
});
