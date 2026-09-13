import { describe, expect, it, vi } from 'vitest';
import { AccountEngineHost } from '../src/main/accounts/account-engine-host';
import { AccountEngine } from '../src/main/accounts/account-engine';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import type { AccountMod, CredentialPair } from '../src/main/accounts/account-mod';
import type { VaultLike } from '../src/main/accounts/vault';
import type { HttpFetchLike, HttpResponseLike } from '../src/main/accounts/usage-client';
import type { AccountId, AccountsConfig, LocalAccountMeta } from '../src/shared/accounts';
import { defaultAccountsConfig } from '../src/shared/accounts';

// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — AccountEngineHost decide
// construir/reconstruir/atualizar via `needsEngineRebuild` (account-pool.ts).
// Mod local REAL (createLocalMod) sobre um cofre em memória + HTTP falso
// (mesmos padrões de tests/accountEngine.test.ts e
// tests/accountModContract.test.ts) — só o motor concreto prova o F6
// (add -> list sem reiniciar); um AccountMod fake não passaria pelo mesmo
// caminho que index.ts usa de verdade.

class FakeVault implements VaultLike {
  private readonly entries = new Map<string, string>();
  read(id: string): string | null {
    return this.entries.get(id) ?? null;
  }
  write(id: string, plainText: string) {
    this.entries.set(id, plainText);
    return { kind: 'ok' as const };
  }
}

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { status, json: async () => body };
}

function seedPair(vault: FakeVault, id: string): void {
  const pair: CredentialPair = { accessToken: `${id}-access`, refreshToken: `${id}-refresh`, expiresAt: Date.now() + 3600_000, scopes: [] };
  vault.write(id, JSON.stringify(pair));
}

function makeConfig(localAccounts: readonly LocalAccountMeta[], overrides: Partial<AccountsConfig> = {}): AccountsConfig {
  return { ...defaultAccountsConfig(), mod: 'local', localAccounts, activeAccountId: localAccounts[0]?.id ?? null, ...overrides };
}

function accountOf(id: string): LocalAccountMeta {
  return { id, label: `Conta ${id.toUpperCase()}`, plan: null };
}

function makeHost(
  vault: FakeVault,
  options: { fetchImpl?: HttpFetchLike; onActiveAccountChanged?: (id: AccountId | null) => void } = {},
) {
  const created: { engine: AccountEngine; disposeSpy: ReturnType<typeof vi.spyOn> }[] = [];
  const fetchImpl = options.fetchImpl ?? (async () => jsonResponse(200, { five_hour: { utilization: 1 }, seven_day: { utilization: 1 } }));
  const createEngine = vi.fn((config: AccountsConfig) => {
    const engine = new AccountEngine({
      config,
      resolveMod: (): AccountMod => createLocalMod({ accounts: config.localAccounts, vault, fetchImpl }),
      applySwitch: async (_pair, onRotatedPairCaptured) => {
        await onRotatedPairCaptured(null);
      },
      isSessionBusy: () => false,
    });
    created.push({ engine, disposeSpy: vi.spyOn(engine, 'dispose') });
    return engine;
  });
  const host = new AccountEngineHost({ createEngine, onActiveAccountChanged: options.onActiveAccountChanged });
  return { host, createEngine, created };
}

describe('AccountEngineHost — apply', () => {
  it('primeiro apply constrói o motor (built)', () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    const { host } = makeHost(vault);

    const result = host.apply(makeConfig([accountOf('a')]));

    expect(result).toBe('built');
    expect(host.current()).not.toBeNull();
  });

  it('F6 — adicionar conta e aplicar de novo no MESMO host faz listAccounts mostrar a nova, sem reiniciar', async () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    seedPair(vault, 'b');
    const { host } = makeHost(vault);

    host.apply(makeConfig([accountOf('a')]));
    const firstView = await host.current()!.listAccounts();
    expect(firstView.accounts).toHaveLength(1);

    host.apply(makeConfig([accountOf('a'), accountOf('b')]));
    const secondView = await host.current()!.listAccounts();
    expect(secondView.accounts).toHaveLength(2);
  });

  it('mudar só autoSwitch -> updated, mesma instância de engine', () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    const { host } = makeHost(vault);
    host.apply(makeConfig([accountOf('a')]));
    const engineBefore = host.current();

    const result = host.apply(makeConfig([accountOf('a')], { autoSwitch: { enabled: true, switchAtLoad: 50, minAdvantage: 10 } }));

    expect(result).toBe('updated');
    expect(host.current()).toBe(engineBefore);
  });

  it('rebuild chama dispose do motor anterior', () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    seedPair(vault, 'b');
    const { host, created } = makeHost(vault);
    host.apply(makeConfig([accountOf('a')]));
    const engineBefore = host.current();

    const result = host.apply(makeConfig([accountOf('a'), accountOf('b')]));

    expect(result).toBe('rebuilt');
    expect(host.current()).not.toBe(engineBefore);
    const beforeEntry = created.find((c) => c.engine === engineBefore);
    expect(beforeEntry?.disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose() derruba o motor atual', () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    const { host, created } = makeHost(vault);
    host.apply(makeConfig([accountOf('a')]));
    const engine = host.current();

    host.dispose();

    expect(host.current()).toBeNull();
    const entry = created.find((c) => c.engine === engine);
    expect(entry?.disposeSpy).toHaveBeenCalledTimes(1);
  });
});

// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 0 — a conta ativa trocada
// PELO MOTOR (`evaluateAutoSwitch` -> `switchTo`, ou um `switchTo` manual
// direto no engine) precisa ser observável por fora de `apply()`: sem isso,
// `appConfig.accounts.activeAccountId` (index.ts) fica desatualizado e uma
// reconstrução subsequente (add/remove conta) renasce o motor com a ativa
// VELHA.
describe('AccountEngineHost — onActiveAccountChanged', () => {
  it('switchTo(\'b\') direto no engine (troca manual) chama a dep com o id novo', async () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    seedPair(vault, 'b');
    const onActiveAccountChanged = vi.fn();
    const { host } = makeHost(vault, { onActiveAccountChanged });

    host.apply(makeConfig([accountOf('a'), accountOf('b')], { activeAccountId: 'a' }));
    const result = await host.current()!.switchTo('b');

    expect(result).toEqual({ kind: 'switched', from: 'a', to: 'b' });
    expect(onActiveAccountChanged).toHaveBeenCalledTimes(1);
    expect(onActiveAccountChanged).toHaveBeenCalledWith('b');
  });

  it('evaluateAutoSwitch que efetivamente troca também chama a dep', async () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    seedPair(vault, 'b');
    const onActiveAccountChanged = vi.fn();
    // 'a' carregada (95%), 'b' com folga (10%) — diferenciado pelo access
    // token no header Authorization (seedPair grava `${id}-access`).
    const fetchImpl: HttpFetchLike = async (_url, init) => {
      const auth = init?.headers?.Authorization ?? '';
      const utilization = auth.includes('a-access') ? 95 : 10;
      return jsonResponse(200, { five_hour: { utilization }, seven_day: { utilization } });
    };
    const { host } = makeHost(vault, { fetchImpl, onActiveAccountChanged });

    host.apply(
      makeConfig([accountOf('a'), accountOf('b')], {
        activeAccountId: 'a',
        autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 },
      }),
    );
    await host.current()!.listAccounts();
    const result = await host.current()!.evaluateAutoSwitch();

    expect(result).toEqual({ kind: 'switched', from: 'a', to: 'b' });
    expect(onActiveAccountChanged).toHaveBeenCalledTimes(1);
    expect(onActiveAccountChanged).toHaveBeenCalledWith('b');
  });

  it('listAccounts sem mudança de conta ativa NÃO chama a dep', async () => {
    const vault = new FakeVault();
    seedPair(vault, 'a');
    const onActiveAccountChanged = vi.fn();
    const { host } = makeHost(vault, { onActiveAccountChanged });

    host.apply(makeConfig([accountOf('a')], { activeAccountId: 'a' }));
    await host.current()!.listAccounts();

    expect(onActiveAccountChanged).not.toHaveBeenCalled();
  });
});
