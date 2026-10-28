import { describe, expect, it, vi } from 'vitest';
import { AccountEngine } from '../src/main/accounts/account-engine';
import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToResult } from '../src/main/accounts/account-mod';
import { needsEngineRebuild, planConnectSeazonePool } from '../src/main/accounts/account-pool';
import { selectAutoSwitchTarget, selectSwitchTarget, type PickTwo } from '../src/main/accounts/auto-switch';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import { createLocalWithPoolMod } from '../src/main/accounts/mods/local-with-pool-mod';
import { createSeazoneMod } from '../src/main/accounts/mods/seazone-mod';
import { isPoolAccountId, poolLabelFromId, toPoolAccountId } from '../src/main/accounts/pool-account-id';
import { planVaultReconciliation } from '../src/main/accounts/vault-reconciliation';
import type { HttpFetchLike, HttpRequestInit } from '../src/main/accounts/usage-client';
import type { VaultLike, VaultWriteResult } from '../src/main/accounts/vault';
import type { AccountsConfig, AccountSummary, AutoSwitchPolicy } from '../src/shared/accounts';
import { defaultAccountsConfig, defaultAutoSwitchPolicy } from '../src/shared/accounts';

// Pool Seazone (switcher) AO LADO das contas locais, sem trocar o mod: com
// `accounts.mod = 'local'` e `accounts.seazone` configurado, o motor usa um mod
// composto — contas locais primeiro, contas do pool depois (id
// `seazone:<label>`). O ponto crítico é o roteamento por dono do id: o par
// rotacionado de uma conta LOCAL que sai vai para o cofre local; o de uma
// conta do POOL que sai vai para o heartbeat do switcher. Nunca o contrário.

const BASE_URL = 'https://switcher.example.test';
const FAR_FUTURE = Date.parse('2099-01-01T00:00:00.000Z');

function pair(tag: string): CredentialPair {
  return { accessToken: `access-${tag}`, refreshToken: `refresh-${tag}`, expiresAt: FAR_FUTURE, scopes: ['user:inference'] };
}

function summary(id: string, load: number | null, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    label: id,
    plan: null,
    active: false,
    available: true,
    load: load === null ? { fiveHour: null, sevenDay: null, sonnet: null, readAt: '2026-10-28T00:00:00.000Z' } : { fiveHour: load, sevenDay: null, sonnet: null, readAt: '2026-10-28T00:00:00.000Z' },
    ...overrides,
  };
}

/** Escolha determinística: as duas primeiras candidatas, na ordem da lista. */
const firstTwo: PickTwo = (candidates) => candidates.slice(0, 2);
const POLICY: AutoSwitchPolicy = { enabled: true, switchAtLoad: 90, minAdvantage: 20 };

class MemoryVault implements VaultLike {
  readonly entries = new Map<string, string>();
  readonly writes: { id: string; plainText: string }[] = [];
  read(id: string): string | null {
    return this.entries.get(id) ?? null;
  }
  write(id: string, plainText: string): VaultWriteResult {
    this.writes.push({ id, plainText });
    this.entries.set(id, plainText);
    return { kind: 'ok' };
  }
}

interface SwitcherCall {
  readonly path: string;
  readonly body: Record<string, unknown> | null;
}

/** Switcher falso: `/auth/refresh`, `/accounts`, `/session/switch`, `/session/heartbeat`. Registra cada chamada. */
function makeSwitcher(options: { accounts?: unknown[]; status?: number; down?: boolean } = {}) {
  const calls: SwitcherCall[] = [];
  const fetchImpl: HttpFetchLike = async (url: string, init?: HttpRequestInit) => {
    const path = url.slice(BASE_URL.length);
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path, body });
    if (options.down) throw new Error('ECONNREFUSED');
    if (path === '/auth/refresh') return { status: options.status ?? 200, json: async () => ({ accessJwt: 'jwt' }) };
    if (options.status && options.status !== 200) return { status: options.status, json: async () => ({}) };
    if (path === '/accounts') return { status: 200, json: async () => options.accounts ?? [] };
    if (path === '/session/switch') {
      const label = String(body?.account ?? '');
      const p = pair(`pool-${label}`);
      return { status: 200, json: async () => ({ ...p, expiresAt: new Date(p.expiresAt).toISOString() }) };
    }
    if (path === '/session/heartbeat') return { status: 200, json: async () => ({}) };
    return { status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

function heartbeats(calls: readonly SwitcherCall[]): Record<string, unknown>[] {
  return calls.filter((call) => call.path === '/session/heartbeat').map((call) => call.body ?? {});
}

class FakeMod implements AccountMod {
  readonly switchCalls: string[] = [];
  readonly captureCalls: { id: string; pair: CredentialPair }[] = [];
  keepAliveCalls = 0;
  constructor(
    readonly id: 'local' | 'seazone',
    public listResult: ListAccountsResult | (() => Promise<ListAccountsResult>),
  ) {}
  async listAccounts(): Promise<ListAccountsResult> {
    return typeof this.listResult === 'function' ? this.listResult() : this.listResult;
  }
  async switchTo(id: string): Promise<SwitchToResult> {
    this.switchCalls.push(id);
    return { kind: 'ok', pair: pair(id) };
  }
  async captureRotatedPair(id: string, p: CredentialPair): Promise<void> {
    this.captureCalls.push({ id, pair: p });
  }
  async keepAlive(): Promise<void> {
    this.keepAliveCalls += 1;
  }
}

describe('id de conta do pool', () => {
  it('prefixa com seazone: e devolve o label sem prefixo', () => {
    expect(toPoolAccountId('time-a')).toBe('seazone:time-a');
    expect(isPoolAccountId('seazone:time-a')).toBe(true);
    expect(poolLabelFromId('seazone:time-a')).toBe('time-a');
  });

  it('id local (uuid) e a chave da sessão não são conta do pool', () => {
    expect(isPoolAccountId('4f0c1c9e-0000-4000-8000-000000000000')).toBe(false);
    expect(poolLabelFromId('4f0c1c9e-0000-4000-8000-000000000000')).toBeNull();
    expect(isPoolAccountId('seazone:')).toBe(false);
  });
});

describe('mod composto — lista', () => {
  const locals: ListAccountsResult = { kind: 'ok', accounts: [summary('L1', 10), summary('L2', 20)] };

  it('locais primeiro, pool depois, com id seazone:<label> e rótulo que diz Seazone', async () => {
    const mod = createLocalWithPoolMod({
      local: new FakeMod('local', locals),
      pool: new FakeMod('seazone', { kind: 'ok', accounts: [summary('alfa', 5), summary('beta', 50, { available: false })] }),
    });
    const result = await mod.listAccounts();
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.accounts.map((a) => a.id)).toEqual(['L1', 'L2', 'seazone:alfa', 'seazone:beta']);
    expect(result.accounts.map((a) => a.label)).toEqual(['L1', 'L2', 'Seazone · alfa', 'Seazone · beta']);
    expect(result.accounts[3].available).toBe(false);
    expect(mod.id).toBe('local');
  });

  it('conta do pool sem label é descartada (sem identidade não dá para trocar)', async () => {
    const mod = createLocalWithPoolMod({
      local: new FakeMod('local', locals),
      pool: new FakeMod('seazone', { kind: 'ok', accounts: [summary('', 5), summary('alfa', 5)] }),
    });
    const result = await mod.listAccounts();
    expect(result.kind === 'ok' && result.accounts.map((a) => a.id)).toEqual(['L1', 'L2', 'seazone:alfa']);
  });

  it('switcher indisponível (unavailable): devolve só as locais, sem derrubar a lista', async () => {
    const mod = createLocalWithPoolMod({ local: new FakeMod('local', locals), pool: new FakeMod('seazone', { kind: 'unavailable', reason: 'unauthorized' }) });
    const result = await mod.listAccounts();
    expect(result).toEqual(locals);
  });

  it('switcher que lança: devolve só as locais', async () => {
    const mod = createLocalWithPoolMod({
      local: new FakeMod('local', locals),
      pool: new FakeMod('seazone', async () => {
        throw new Error('boom');
      }),
    });
    expect(await mod.listAccounts()).toEqual(locals);
  });

  it('com o seazone-mod real: switcher fora do ar, 401 e sem token no cofre -> só as locais', async () => {
    for (const scenario of ['down', '401', 'no-session'] as const) {
      const vault = new MemoryVault();
      if (scenario !== 'no-session') vault.entries.set('seazone:session', 'session-token');
      const switcher = makeSwitcher({ down: scenario === 'down', status: scenario === '401' ? 401 : undefined });
      const mod = createLocalWithPoolMod({
        local: new FakeMod('local', locals),
        pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl }),
      });
      expect(await mod.listAccounts()).toEqual(locals);
    }
  });
});

describe('mod composto — roteamento por dono do id', () => {
  it('switchTo: seazone:* vai ao pool com o label sem prefixo; o resto vai ao local', async () => {
    const local = new FakeMod('local', { kind: 'ok', accounts: [] });
    const pool = new FakeMod('seazone', { kind: 'ok', accounts: [] });
    const mod = createLocalWithPoolMod({ local, pool });
    await mod.switchTo('seazone:alfa');
    await mod.switchTo('L1');
    expect(pool.switchCalls).toEqual(['alfa']);
    expect(local.switchCalls).toEqual(['L1']);
  });

  it('captureRotatedPair: par do pool vai ao pool, par local vai ao local — nunca o contrário', async () => {
    const local = new FakeMod('local', { kind: 'ok', accounts: [] });
    const pool = new FakeMod('seazone', { kind: 'ok', accounts: [] });
    const mod = createLocalWithPoolMod({ local, pool });
    await mod.captureRotatedPair('seazone:alfa', pair('pool'));
    await mod.captureRotatedPair('L1', pair('local'));
    expect(pool.captureCalls).toEqual([{ id: 'alfa', pair: pair('pool') }]);
    expect(local.captureCalls).toEqual([{ id: 'L1', pair: pair('local') }]);
  });

  it('keepAlive mantém viva a sessão do switcher; falha dele não lança', async () => {
    const pool = new FakeMod('seazone', { kind: 'ok', accounts: [] });
    const mod = createLocalWithPoolMod({ local: new FakeMod('local', { kind: 'ok', accounts: [] }), pool });
    await mod.keepAlive?.();
    expect(pool.keepAliveCalls).toBe(1);

    pool.keepAlive = async () => {
      throw new Error('offline');
    };
    await expect(mod.keepAlive?.()).resolves.toBeUndefined();
  });
});

describe('motor + mod composto (mods reais) — captura do par rotacionado nos 4 sentidos', () => {
  function setup(activeAccountId: string) {
    const vault = new MemoryVault();
    vault.entries.set('L1', JSON.stringify(pair('L1-vault')));
    vault.entries.set('L2', JSON.stringify(pair('L2-vault')));
    vault.entries.set('seazone:session', 'session-token');
    const switcher = makeSwitcher();
    const localFetch: HttpFetchLike = vi.fn(async () => ({ status: 500, json: async () => ({}) }));

    const config: AccountsConfig = {
      ...defaultAccountsConfig(),
      mod: 'local',
      seazone: { baseUrl: BASE_URL },
      localAccounts: [
        { id: 'L1', label: 'L1', plan: null },
        { id: 'L2', label: 'L2', plan: null },
      ],
      activeAccountId,
    };

    let disk: CredentialPair = pair('on-disk');
    const applySwitch = async (next: CredentialPair, onRotated: (p: CredentialPair | null) => void | Promise<void>): Promise<void> => {
      await onRotated(disk);
      disk = next;
    };

    const engine = new AccountEngine({
      config,
      resolveMod: () =>
        createLocalWithPoolMod({
          local: createLocalMod({ accounts: config.localAccounts, vault, fetchImpl: localFetch }),
          pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl }),
        }),
      applySwitch,
      isSessionBusy: () => false,
    });
    const vaultWritesBefore = vault.writes.length;
    return { engine, vault, switcher, vaultWritesBefore, getDisk: () => disk };
  }

  it('local -> pool: o par da local vai para o cofre local; nada vai ao heartbeat', async () => {
    const { engine, vault, switcher, getDisk } = setup('L1');
    const outcome = await engine.switchTo('seazone:alfa');
    expect(outcome).toEqual({ kind: 'switched', from: 'L1', to: 'seazone:alfa' });
    expect(vault.writes).toEqual([{ id: 'L1', plainText: JSON.stringify(pair('on-disk')) }]);
    expect(heartbeats(switcher.calls)).toEqual([]);
    expect(switcher.calls.find((c) => c.path === '/session/switch')?.body).toEqual({ account: 'alfa' });
    expect(getDisk().accessToken).toBe('access-pool-alfa');
  });

  it('pool -> local: o par do pool vai ao heartbeat (label sem prefixo); o cofre local não recebe nada', async () => {
    const { engine, vault, switcher } = setup('seazone:alfa');
    const outcome = await engine.switchTo('L1');
    expect(outcome).toEqual({ kind: 'switched', from: 'seazone:alfa', to: 'L1' });
    expect(vault.writes).toEqual([]);
    expect(heartbeats(switcher.calls)).toEqual([
      { accessToken: 'access-on-disk', refreshToken: 'refresh-on-disk', expiresAt: new Date(FAR_FUTURE).toISOString(), label: 'alfa' },
    ]);
    expect(switcher.calls.some((c) => c.path === '/session/switch')).toBe(false);
  });

  it('pool -> pool: o par do pool que sai vai ao heartbeat com o label dele', async () => {
    const { engine, vault, switcher } = setup('seazone:alfa');
    const outcome = await engine.switchTo('seazone:beta');
    expect(outcome.kind).toBe('switched');
    expect(vault.writes).toEqual([]);
    expect(heartbeats(switcher.calls).map((h) => h.label)).toEqual(['alfa']);
    // v2: a conta do pool que sai vai em `currentAccount`, como no cliente oficial.
    expect(switcher.calls.find((c) => c.path === '/session/switch')?.body).toEqual({ account: 'beta', currentAccount: 'alfa' });
  });

  it('local -> local: o par vai para o cofre local; o switcher nem é chamado', async () => {
    const { engine, vault, switcher } = setup('L1');
    const outcome = await engine.switchTo('L2');
    expect(outcome.kind).toBe('switched');
    expect(vault.writes).toEqual([{ id: 'L1', plainText: JSON.stringify(pair('on-disk')) }]);
    expect(switcher.calls).toEqual([]);
  });

  it('pool -> local com identidade em disco de fora do pool local: continua indo ao heartbeat, nunca ao cofre', async () => {
    const vault = new MemoryVault();
    vault.entries.set('L1', JSON.stringify(pair('L1-vault')));
    vault.entries.set('seazone:session', 'session-token');
    const switcher = makeSwitcher();
    const config: AccountsConfig = {
      ...defaultAccountsConfig(),
      mod: 'local',
      seazone: { baseUrl: BASE_URL },
      localAccounts: [{ id: 'L1', label: 'L1', plan: null, fingerprint: 'fp-L1' }],
      activeAccountId: 'seazone:alfa',
    };
    const engine = new AccountEngine({
      config,
      resolveMod: () =>
        createLocalWithPoolMod({
          local: createLocalMod({ accounts: config.localAccounts, vault }),
          pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl }),
        }),
      applySwitch: async (_next, onRotated) => {
        await onRotated(pair('pool-live'));
      },
      isSessionBusy: () => false,
      readCurrentAccountFingerprint: () => 'fp-of-a-pool-account',
    });
    const outcome = await engine.switchTo('L1');
    expect(outcome.kind).toBe('switched');
    expect(vault.writes).toEqual([]);
    expect(heartbeats(switcher.calls).map((h) => h.label)).toEqual(['alfa']);
  });

  it('sincronização periódica com conta do pool ativa nunca grava o par vivo no cofre local', async () => {
    const vault = new MemoryVault();
    vault.entries.set('L1', JSON.stringify(pair('L1-vault')));
    vault.entries.set('seazone:session', 'session-token');
    const switcher = makeSwitcher({ accounts: [] });
    const config: AccountsConfig = {
      ...defaultAccountsConfig(),
      mod: 'local',
      seazone: { baseUrl: BASE_URL },
      localAccounts: [{ id: 'L1', label: 'L1', plan: null, fingerprint: 'fp-L1' }],
      activeAccountId: 'seazone:alfa',
    };
    const engine = new AccountEngine({
      config,
      resolveMod: () =>
        createLocalWithPoolMod({
          local: createLocalMod({ accounts: config.localAccounts, vault, fetchImpl: async () => ({ status: 500, json: async () => ({}) }) }),
          pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl }),
        }),
      applySwitch: async () => undefined,
      isSessionBusy: () => false,
      readCurrentPair: () => pair('pool-live'),
      readCurrentAccountFingerprint: () => 'fp-of-a-pool-account',
    });
    await engine.listAccounts();
    await engine.captureLivePairNow('quit');
    expect(vault.writes).toEqual([]);
  });
});

describe('selectAutoSwitchTarget — pool é sempre a última opção', () => {
  it('local saturada com local candidata e pool mais vazio: escolhe a LOCAL', () => {
    const accounts = [summary('L1', 95), summary('L2', 50), summary('seazone:alfa', 0)];
    expect(selectAutoSwitchTarget(accounts, 'L1', POLICY, firstTwo)).toBe('L2');
  });

  it('local saturada e nenhuma local passa na regra: cai para o pool', () => {
    const accounts = [summary('L1', 95), summary('L2', 80), summary('seazone:alfa', 10), summary('seazone:beta', 30)];
    expect(selectAutoSwitchTarget(accounts, 'L1', POLICY, firstTwo)).toBe('seazone:alfa');
  });

  it('pool indisponível, com carga desconhecida ou sem folga nunca é destino', () => {
    const accounts = [
      summary('L1', 95),
      summary('L2', 90),
      summary('seazone:alfa', 0, { available: false }),
      summary('seazone:beta', null),
      summary('seazone:gama', 80),
    ];
    expect(selectAutoSwitchTarget(accounts, 'L1', POLICY, firstTwo)).toBeNull();
  });

  it('local abaixo do limiar: não troca, nem para pool vazio', () => {
    const accounts = [summary('L1', 89), summary('seazone:alfa', 0)];
    expect(selectAutoSwitchTarget(accounts, 'L1', POLICY, firstTwo)).toBeNull();
  });

  it('desligado: nunca troca', () => {
    const accounts = [summary('seazone:alfa', 10), summary('L1', 0)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', { ...POLICY, enabled: false }, firstTwo)).toBeNull();
  });

  it('sem conta do pool na lista, decide igual ao selectSwitchTarget de antes', () => {
    const accounts = [summary('a', 95), summary('b', 40), summary('c', 60), summary('d', 99)];
    expect(selectAutoSwitchTarget(accounts, 'a', POLICY, firstTwo)).toBe(selectSwitchTarget(accounts, 'a', POLICY, firstTwo));
    expect(selectAutoSwitchTarget(accounts, 'b', POLICY, firstTwo)).toBe(selectSwitchTarget(accounts, 'b', POLICY, firstTwo));
  });
});

describe('selectAutoSwitchTarget — volta automática para local', () => {
  it('no pool (mesmo com carga baixa), local com carga <= limiar - folga: volta para ela', () => {
    const accounts = [summary('L1', 70), summary('seazone:alfa', 5)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBe('L1');
  });

  it('carga do pool desconhecida não impede a volta', () => {
    const accounts = [summary('L1', 10), summary('seazone:alfa', null)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBe('L1');
  });

  it('local acima de limiar - folga: fica no pool', () => {
    const accounts = [summary('L1', 71), summary('seazone:alfa', 5)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBeNull();
  });

  it('usa os valores do config (switchAtLoad/minAdvantage)', () => {
    const accounts = [summary('L1', 55), summary('seazone:alfa', 5)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', { enabled: true, switchAtLoad: 80, minAdvantage: 30 }, firstTwo)).toBeNull();
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', { enabled: true, switchAtLoad: 85, minAdvantage: 30 }, firstTwo)).toBe('L1');
  });

  it('local indisponível, marcada para reconectar ou com carga desconhecida não é destino da volta', () => {
    const accounts = [
      summary('L1', 0, { available: false }),
      summary('L2', 0, { needsReconnect: true }),
      summary('L3', null),
      summary('seazone:alfa', 5),
    ];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBeNull();
  });

  it('entre locais candidatas à volta, mesma regra de escolha (melhor de duas)', () => {
    const accounts = [summary('L1', 60), summary('L2', 30), summary('L3', 0), summary('seazone:alfa', 5)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBe('L2');
  });

  it('pool saturado e local com folga mas acima de limiar - folga: troca para a local pela regra normal', () => {
    const accounts = [summary('L1', 74), summary('seazone:alfa', 95), summary('seazone:beta', 0)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBe('L1');
  });

  it('pool saturado e nenhuma local serve: troca para outra conta do pool pela regra normal', () => {
    const accounts = [summary('L1', 80), summary('seazone:alfa', 95), summary('seazone:beta', 10)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBe('seazone:beta');
  });

  it('conta do pool ativa fora da lista (switcher caiu): não decide nada', () => {
    const accounts = [summary('L1', 0)];
    expect(selectAutoSwitchTarget(accounts, 'seazone:alfa', POLICY, firstTwo)).toBeNull();
  });
});

describe('motor + mod composto — volta automática no ciclo de avaliação', () => {
  it('estando no pool, evaluateAutoSwitch troca para a local livre e manda o par do pool ao heartbeat', async () => {
    const vault = new MemoryVault();
    vault.entries.set('L1', JSON.stringify(pair('L1-vault')));
    vault.entries.set('seazone:session', 'session-token');
    const switcher = makeSwitcher({ accounts: [{ label: 'alfa', fiveHourUtil: 5, sevenDayUtil: 5, sonnetUtil: null, available: true }] });
    const usageFetch: HttpFetchLike = async () => ({
      status: 200,
      json: async () => ({ five_hour: { utilization: 10 }, seven_day: { utilization: 10 } }),
    });
    const config: AccountsConfig = {
      ...defaultAccountsConfig(),
      mod: 'local',
      seazone: { baseUrl: BASE_URL },
      localAccounts: [{ id: 'L1', label: 'L1', plan: null }],
      activeAccountId: 'seazone:alfa',
    };
    const engine = new AccountEngine({
      config,
      resolveMod: () =>
        createLocalWithPoolMod({
          local: createLocalMod({ accounts: config.localAccounts, vault, fetchImpl: usageFetch }),
          pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl }),
        }),
      applySwitch: async (_next, onRotated) => {
        await onRotated(pair('pool-live'));
      },
      isSessionBusy: () => true,
    });

    const view = await engine.listAccounts();
    expect(view.accounts.map((a) => a.id)).toEqual(['L1', 'seazone:alfa']);
    const outcome = await engine.evaluateAutoSwitch();
    expect(outcome).toEqual({ kind: 'switched', from: 'seazone:alfa', to: 'L1' });
    expect(heartbeats(switcher.calls).map((h) => h.label)).toEqual(['alfa']);
    expect(vault.writes).toEqual([]);
  });

  it('troca manual para conta do pool é permitida mesmo com locais livres', async () => {
    const local = new FakeMod('local', { kind: 'ok', accounts: [summary('L1', 0)] });
    const pool = new FakeMod('seazone', { kind: 'ok', accounts: [summary('alfa', 50)] });
    const engine = new AccountEngine({
      config: { ...defaultAccountsConfig(), mod: 'local', seazone: { baseUrl: BASE_URL }, localAccounts: [{ id: 'L1', label: 'L1', plan: null }], activeAccountId: 'L1' },
      resolveMod: () => createLocalWithPoolMod({ local, pool }),
      applySwitch: async (_next, onRotated) => {
        await onRotated(pair('L1-live'));
      },
      isSessionBusy: () => false,
    });
    await engine.listAccounts();
    expect(await engine.switchTo('seazone:alfa')).toEqual({ kind: 'switched', from: 'L1', to: 'seazone:alfa' });
    expect(pool.switchCalls).toEqual(['alfa']);
    expect(local.captureCalls.map((c) => c.id)).toEqual(['L1']);
    expect(pool.captureCalls).toEqual([]);
  });

  it('switcher fora do ar: o motor segue ready com as locais', async () => {
    const vault = new MemoryVault();
    vault.entries.set('L1', JSON.stringify(pair('L1-vault')));
    vault.entries.set('seazone:session', 'session-token');
    const switcher = makeSwitcher({ down: true });
    const config: AccountsConfig = {
      ...defaultAccountsConfig(),
      mod: 'local',
      seazone: { baseUrl: BASE_URL },
      localAccounts: [{ id: 'L1', label: 'L1', plan: null }],
      activeAccountId: 'L1',
    };
    const engine = new AccountEngine({
      config,
      resolveMod: () =>
        createLocalWithPoolMod({
          local: createLocalMod({ accounts: config.localAccounts, vault, fetchImpl: async () => ({ status: 500, json: async () => ({}) }) }),
          pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl }),
        }),
      applySwitch: async () => undefined,
      isSessionBusy: () => false,
    });
    const view = await engine.listAccounts();
    expect(view.state).toBe('ready');
    expect(view.accounts.map((a) => a.id)).toEqual(['L1']);
  });
});

describe('faxina do cofre com o pool ao lado das locais', () => {
  const keys = ['L1', 'orphan', 'seazone:session', 'provider:openrouter:OPENROUTER_API_KEY'];
  const base: AccountsConfig = { ...defaultAccountsConfig(), mod: 'local', localAccounts: [{ id: 'L1', label: 'L1', plan: null }] };

  it('accounts.seazone configurado: preserva seazone:session (e continua apagando a órfã)', () => {
    expect(planVaultReconciliation(keys, { ...base, seazone: { baseUrl: BASE_URL } })).toEqual(['orphan']);
  });

  it('accounts.seazone nulo: comportamento de antes (apaga seazone:session)', () => {
    expect([...planVaultReconciliation(keys, base)].sort()).toEqual(['orphan', 'seazone:session']);
  });
});

describe('planConnectSeazonePool — conectar o pool não troca o mod', () => {
  const current: AccountsConfig = {
    ...defaultAccountsConfig(),
    mod: 'local',
    localAccounts: [{ id: 'L1', label: 'L1', plan: null, fingerprint: 'fp' }],
    activeAccountId: 'L1',
    autoSwitch: defaultAutoSwitchPolicy(),
  };

  it('grava só accounts.seazone (baseUrl aparada); mod, localAccounts e activeAccountId intactos', () => {
    const next = planConnectSeazonePool(current, '  https://switcher.example.test  ');
    expect(next).toEqual({ ...current, seazone: { baseUrl: 'https://switcher.example.test' } });
    expect(next.mod).toBe('local');
    expect(next.localAccounts).toBe(current.localAccounts);
    expect(next.activeAccountId).toBe('L1');
  });

  it('a mudança reconstrói o motor (F6), para o mod composto nascer', () => {
    expect(needsEngineRebuild(current, planConnectSeazonePool(current, BASE_URL))).toBe(true);
  });
});
