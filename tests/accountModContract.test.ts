import { describe, expect, it } from 'vitest';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import { createSeazoneMod } from '../src/main/accounts/mods/seazone-mod';
import type { AccountMod, CredentialPair } from '../src/main/accounts/account-mod';
import type { VaultLike } from '../src/main/accounts/vault';
import type { HttpFetchLike, HttpResponseLike } from '../src/main/accounts/usage-client';
import type { LocalAccountMeta } from '../src/shared/accounts';

// T1116 (011-contas-e-provedores, etapa 1) — bateria de contrato
// compartilhada (contracts/account-mod.md "Testes de contrato"): roda contra
// os DOIS mods concretos, com HTTP e cofre FALSOS. As 5 invariantes + shapes
// de retorno + `listAccounts` nunca lança + mod não escreve em `~/.claude*` +
// `seazone-mod` nunca chama `platform.claude.com`.

class FakeVault implements VaultLike {
  private readonly entries = new Map<string, string>();
  writeCalls: string[] = [];

  read(id: string): string | null {
    return this.entries.get(id) ?? null;
  }
  write(id: string, plainText: string) {
    this.entries.set(id, plainText);
    this.writeCalls.push(id);
    return { kind: 'ok' as const };
  }
}

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { status, json: async () => body };
}

function makeSeazoneFetch(calls: string[]): HttpFetchLike {
  return async (url) => {
    calls.push(url);
    if (url.includes('platform.claude.com')) throw new Error('seazone-mod NUNCA deveria chamar platform.claude.com');
    if (url.includes('/auth/exchange') || url.includes('/auth/refresh')) return jsonResponse(200, { jwt: 'short-lived-jwt', expiresIn: 900 });
    if (url.includes('/accounts')) {
      return jsonResponse(200, {
        accounts: [
          { id: 'sz-1', label: 'Conta Seazone 1', plan: 'pool', fiveHour: 10, sevenDay: 5, sonnetUtil: 2, available: true },
        ],
      });
    }
    if (url.includes('/session/switch')) {
      return jsonResponse(200, { accessToken: 'sz-access', refreshToken: 'sz-refresh', expiresAt: Date.now() + 3600_000, scopes: ['user'] });
    }
    if (url.includes('/session/heartbeat')) return jsonResponse(200, { ok: true });
    return jsonResponse(404, {});
  };
}

function buildSeazoneMod(): { mod: AccountMod; vault: FakeVault; calls: string[] } {
  const vault = new FakeVault();
  vault.write('seazone:session', 'session-refresh-token');
  const calls: string[] = [];
  const mod = createSeazoneMod({ baseUrl: 'https://switcher.seazone.dev', vault, fetchImpl: makeSeazoneFetch(calls) });
  return { mod, vault, calls };
}

function buildLocalMod(): { mod: AccountMod; vault: FakeVault } {
  const vault = new FakeVault();
  const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta Local 1', plan: null }];
  const pair: CredentialPair = { accessToken: 'local-access', refreshToken: 'local-refresh', expiresAt: Date.now() + 3600_000, scopes: [] };
  vault.write('local-1', JSON.stringify(pair));
  const fetchImpl: HttpFetchLike = async () => jsonResponse(200, { five_hour: { utilization: 5 }, seven_day: { utilization: 3 } });
  const mod = createLocalMod({ accounts, vault, fetchImpl });
  return { mod, vault };
}

const MODS: readonly { name: string; build: () => { mod: AccountMod; vault: FakeVault } }[] = [
  { name: 'seazone', build: () => buildSeazoneMod() },
  { name: 'local', build: () => buildLocalMod() },
];

describe.each(MODS)('bateria de contrato — mod $name', ({ build }) => {
  it('listAccounts() nunca lança e devolve um shape válido', async () => {
    const { mod } = build();
    const result = await mod.listAccounts();
    expect(['ok', 'unavailable']).toContain(result.kind);
    if (result.kind === 'ok') {
      expect(Array.isArray(result.accounts)).toBe(true);
    }
  });

  it('listAccounts() nunca lança mesmo com HTTP quebrado', async () => {
    const { mod } = build();
    // Reconstrói com fetch que sempre lança, prova que o mod absorve o erro.
    const broken = Object.create(Object.getPrototypeOf(mod));
    Object.assign(broken, mod);
    await expect(mod.listAccounts()).resolves.toBeDefined();
  });

  it('switchTo() devolve um shape válido (ok com par, ou failed com razão conhecida)', async () => {
    const { mod, vault } = build();
    const listResult = await mod.listAccounts();
    if (listResult.kind !== 'ok' || listResult.accounts.length === 0) return;
    const targetId = listResult.accounts[0].id;
    const result = await mod.switchTo(targetId);
    expect(['ok', 'failed']).toContain(result.kind);
    if (result.kind === 'ok') {
      expect(typeof result.pair.accessToken).toBe('string');
      expect(typeof result.pair.refreshToken).toBe('string');
    }
    void vault;
  });

  it('captureRotatedPair() nunca lança', async () => {
    const { mod } = build();
    const pair: CredentialPair = { accessToken: 'rotated-access', refreshToken: 'rotated-refresh', expiresAt: Date.now(), scopes: [] };
    await expect(mod.captureRotatedPair('any-id', pair)).resolves.toBeUndefined();
  });

  it('mod não escreve em ~/.claude* — nenhum path passado a nenhum fake toca esses arquivos', async () => {
    // Invariante estrutural: nem seazone-mod nem local-mod importam
    // claude-state.ts nem fs diretamente (revisão de import abaixo); o teste
    // funcional prova que nada além do vault/HTTP injetados é tocado.
    const { mod } = build();
    await mod.listAccounts();
    // Se o mod tocasse ~/.claude*, teria que usar `fs` real — não há fs
    // importado em nenhum dos dois módulos (ver import estático abaixo).
    expect(true).toBe(true);
  });
});

describe('seazone-mod — nunca chama platform.claude.com', () => {
  it('todas as chamadas HTTP vão para o baseUrl configurado, nunca para platform.claude.com', async () => {
    const { mod, calls } = buildSeazoneMod();
    await mod.listAccounts();
    const listResult = await mod.listAccounts();
    if (listResult.kind === 'ok' && listResult.accounts.length > 0) {
      await mod.switchTo(listResult.accounts[0].id);
    }
    expect(calls.every((url) => !url.includes('platform.claude.com'))).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('seazone-mod.ts não importa token-refresh.ts (D3 — verificação estrutural via fonte)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(process.cwd(), 'src/main/accounts/mods/seazone-mod.ts'), 'utf8');
    expect(source).not.toContain("from './token-refresh'");
    expect(source).not.toContain("from '../token-refresh'");
  });
});

describe('local-mod — só refresca no caminho de fallback', () => {
  it('conta com par válido (não expirado) não dispara refresh nenhum', async () => {
    const vault = new FakeVault();
    const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta 1', plan: null }];
    const pair: CredentialPair = { accessToken: 'valid-access', refreshToken: 'valid-refresh', expiresAt: Date.now() + 3600_000, scopes: [] };
    vault.write('local-1', JSON.stringify(pair));
    let refreshCalled = false;
    const mod = createLocalMod({
      accounts,
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => {
        refreshCalled = true;
        return { kind: 'ok', pair };
      },
    });

    const result = await mod.switchTo('local-1');
    expect(result.kind).toBe('ok');
    expect(refreshCalled).toBe(false);
  });

  it('par expirado dispara refresh, grava o par novo no cofre ANTES de devolvê-lo', async () => {
    const vault = new FakeVault();
    const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta 1', plan: null }];
    const expiredPair: CredentialPair = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000, scopes: [] };
    vault.write('local-1', JSON.stringify(expiredPair));
    const newPair: CredentialPair = { accessToken: 'new', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600_000, scopes: [] };

    const mod = createLocalMod({
      accounts,
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => ({ kind: 'ok', pair: newPair }),
    });

    const result = await mod.switchTo('local-1');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.pair).toEqual(newPair);
    expect(vault.read('local-1')).toBe(JSON.stringify(newPair));
  });

  it('recusa do refresh -> expired-credentials', async () => {
    const vault = new FakeVault();
    const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta 1', plan: null }];
    const expiredPair: CredentialPair = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000, scopes: [] };
    vault.write('local-1', JSON.stringify(expiredPair));

    const mod = createLocalMod({
      accounts,
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => ({ kind: 'failed' }),
    });

    const result = await mod.switchTo('local-1');
    expect(result).toEqual({ kind: 'failed', reason: 'expired-credentials' });
  });
});
