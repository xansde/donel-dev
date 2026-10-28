import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AccountEngine, type PoolHeartbeatLogEvent } from '../src/main/accounts/account-engine';
import type { CredentialPair } from '../src/main/accounts/account-mod';
import { adoptRefreshedActivePair, applyAccountSwitch, readCurrentCredentialPair, type ClaudeStateIoDeps } from '../src/main/accounts/claude-state';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import { createLocalWithPoolMod } from '../src/main/accounts/mods/local-with-pool-mod';
import { createSeazoneMod } from '../src/main/accounts/mods/seazone-mod';
import type { HttpFetchLike, HttpRequestInit } from '../src/main/accounts/usage-client';
import type { VaultLike, VaultWriteResult } from '../src/main/accounts/vault';
import type { AccountsConfig } from '../src/shared/accounts';
import { defaultAccountsConfig } from '../src/shared/accounts';

// Pool Seazone ao lado das locais — v3 do patch local.
// A posse de uma conta no switcher dura 20 min (HINT_GRACE_SECONDS) e só o
// switch e o `/session/heartbeat` a renovam. Enquanto a ativa for do pool, o
// motor manda heartbeat periódico com o par VIVO (o que o CLI renova em
// `.credentials.json`) e o label real, como o cliente oficial; adota o par que
// o servidor devolve quando ele é mais novo; sai da conta quando a API diz que
// ela não é mais nossa (403).

const BASE_URL = 'https://switcher.example.test';
const FAR_FUTURE = Date.parse('2099-01-01T00:00:00.000Z');
const CLAUDE_HOME = 'C:\\fake\\.claude';
const CREDENTIALS_PATH = join(CLAUDE_HOME, '.credentials.json');
const CLAUDE_JSON_PATH = 'C:\\fake\\.claude.json';
const DEFAULT_SCOPES = ['user:inference', 'user:profile'];
const TWENTY_MINUTES_MS = 20 * 60 * 1000;

function pair(tag: string, scopes: readonly string[] = DEFAULT_SCOPES, expiresAt = FAR_FUTURE): CredentialPair {
  return { accessToken: `access-${tag}`, refreshToken: `refresh-${tag}`, expiresAt, scopes };
}

class MemoryVault implements VaultLike {
  readonly entries = new Map<string, string>();
  read(id: string): string | null {
    return this.entries.get(id) ?? null;
  }
  write(id: string, plainText: string): VaultWriteResult {
    this.entries.set(id, plainText);
    return { kind: 'ok' };
  }
}

interface SwitcherCall {
  readonly path: string;
  readonly body: Record<string, unknown> | null;
}

interface SwitcherOptions {
  readonly accounts?: unknown[];
  /** Status de `/session/heartbeat` (default 200); `'throw'` = falha de rede. */
  readonly heartbeatStatus?: number | 'throw';
  /** Par que o servidor devolve no heartbeat (default: o enviado, como quando ele sincroniza o do cliente). */
  readonly heartbeatReturns?: { accessToken: string; refreshToken: string; expiresAt: string };
  readonly switchStatus?: number;
  readonly deliverOnAuto?: string;
}

/** Switcher falso com o contrato real (`HeartbeatResponse`: accessToken, refreshToken, expiresAt ISO). */
function makeSwitcher(options: SwitcherOptions = {}) {
  const calls: SwitcherCall[] = [];
  const fetchImpl: HttpFetchLike = async (url: string, init?: HttpRequestInit) => {
    const path = url.slice(BASE_URL.length);
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path, body });
    if (path === '/auth/refresh') return { status: 200, json: async () => ({ accessJwt: 'jwt' }) };
    if (path === '/accounts') return { status: 200, json: async () => options.accounts ?? [] };
    if (path === '/session/heartbeat') {
      if (options.heartbeatStatus === 'throw') throw new Error('network down');
      if (options.heartbeatStatus && options.heartbeatStatus !== 200) {
        return { status: options.heartbeatStatus, json: async () => ({ detail: "'alfa' nao foi entregue a voce" }) };
      }
      const returned = options.heartbeatReturns ?? { accessToken: body?.accessToken, refreshToken: body?.refreshToken, expiresAt: body?.expiresAt };
      return { status: 200, json: async () => returned };
    }
    if (path === '/session/switch') {
      if (options.switchStatus && options.switchStatus !== 200) return { status: options.switchStatus, json: async () => ({ detail: 'recusado' }) };
      const asked = String(body?.account ?? '');
      const label = asked === 'auto' ? (options.deliverOnAuto ?? 'gama') : asked;
      const p = pair(`pool-${label}`);
      return {
        status: 200,
        json: async () => ({ label, accessToken: p.accessToken, refreshToken: p.refreshToken, expiresAt: new Date(p.expiresAt).toISOString(), plan: 'max', load: 10, previousLoad: null, warning: null }),
      };
    }
    return { status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

function heartbeats(calls: readonly SwitcherCall[]): Record<string, unknown>[] {
  return calls.filter((call) => call.path === '/session/heartbeat').map((call) => call.body ?? {});
}

function switchBodies(calls: readonly SwitcherCall[]): Record<string, unknown>[] {
  return calls.filter((call) => call.path === '/session/switch').map((call) => call.body ?? {});
}

function makeMemoryIo(files: Record<string, string>): ClaudeStateIoDeps {
  return {
    existsSync: () => true,
    readFileText: (path) => (path in files ? files[path] : null),
    writeFileText: (path, content) => {
      files[path] = content;
    },
    renameFile: (from, to) => {
      files[to] = files[from];
      delete files[from];
    },
    mkdirSync: () => undefined,
    unlinkFile: (path) => {
      delete files[path];
    },
  };
}

function usageFetchFor(loadByAccess: Record<string, number>): HttpFetchLike {
  return async (_url: string, init?: HttpRequestInit) => {
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
    const load = loadByAccess[auth.replace(/^Bearer\s+/i, '')] ?? 0;
    return { status: 200, json: async () => ({ five_hour: { utilization: load }, seven_day: { utilization: load } }) };
  };
}

interface ScheduledTimer {
  readonly fn: () => unknown;
  readonly delay: number;
}

function setup(options: {
  activeAccountId: string | null;
  switcher: ReturnType<typeof makeSwitcher>;
  localLoad?: number;
  /** Par em disco (default: o par vivo da conta do pool `alfa`, já rotacionado pelo CLI). */
  diskPair?: CredentialPair;
  /** Fingerprint do `oauthAccount` em `.claude.json` (default `null`, ilegível). */
  fingerprint?: string | null;
  localFingerprint?: string;
  autoSwitchEnabled?: boolean;
}) {
  const vault = new MemoryVault();
  vault.entries.set('L1', JSON.stringify(pair('L1-vault')));
  vault.entries.set('seazone:session', 'session-token');
  const config: AccountsConfig = {
    ...defaultAccountsConfig(),
    mod: 'local',
    seazone: { baseUrl: BASE_URL },
    localAccounts: [{ id: 'L1', label: 'L1', plan: null, ...(options.localFingerprint ? { fingerprint: options.localFingerprint } : {}) }],
    activeAccountId: options.activeAccountId,
    autoSwitch: { enabled: options.autoSwitchEnabled ?? true, switchAtLoad: 90, minAdvantage: 20 },
  };
  const diskPair = options.diskPair ?? pair('alfa-live', DEFAULT_SCOPES, Date.parse('2099-06-01T00:00:00.000Z'));
  const files: Record<string, string> = {
    [CREDENTIALS_PATH]: JSON.stringify({ claudeAiOauth: { ...diskPair, subscriptionType: 'max' }, mcpOAuth: { srv: { token: 'mcp' } } }),
    [CLAUDE_JSON_PATH]: JSON.stringify({ oauthAccount: { accountUuid: 'x' }, other: 1 }),
  };
  const io = makeMemoryIo(files);
  const scheduled: ScheduledTimer[] = [];
  const setTimeoutFn = vi.fn((fn: () => unknown, delay?: number) => {
    scheduled.push({ fn, delay: delay ?? 0 });
    return scheduled.length as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const setIntervalFn = vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval;
  const events: PoolHeartbeatLogEvent[] = [];
  const writeSpy = vi.fn((expected: CredentialPair, next: CredentialPair) => adoptRefreshedActivePair({ io, claudeHome: CLAUDE_HOME }, expected, next));
  const engine = new AccountEngine({
    config,
    resolveMod: () =>
      createLocalWithPoolMod({
        local: createLocalMod({ accounts: config.localAccounts, vault, fetchImpl: usageFetchFor({ 'access-L1-vault': options.localLoad ?? 0 }) }),
        pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: options.switcher.fetchImpl }),
      }),
    applySwitch: (next, onRotated) => applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: onRotated }, next),
    isSessionBusy: () => false,
    readCurrentPair: () => readCurrentCredentialPair({ io, claudeHome: CLAUDE_HOME }),
    readCurrentAccountFingerprint: () => options.fingerprint ?? null,
    writeRefreshedActivePair: writeSpy,
    onPoolHeartbeatEvent: (event) => events.push(event),
    setTimeoutFn,
    setIntervalFn,
  });
  const oauthOnDisk = (): Record<string, unknown> => (JSON.parse(files[CREDENTIALS_PATH]) as { claudeAiOauth: Record<string, unknown> }).claudeAiOauth;
  const credentialsOnDisk = (): Record<string, unknown> => JSON.parse(files[CREDENTIALS_PATH]) as Record<string, unknown>;
  return { engine, files, scheduled, setTimeoutFn, events, writeSpy, oauthOnDisk, credentialsOnDisk, diskPair };
}

describe('seazone-mod.syncActivePair — o heartbeat do cliente oficial', () => {
  function mod(switcher: ReturnType<typeof makeSwitcher>) {
    const vault = new MemoryVault();
    vault.entries.set('seazone:session', 'session-token');
    return createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl });
  }

  it('manda o par e o label reais, expiresAt em ISO, e devolve o par do servidor', async () => {
    const switcher = makeSwitcher();
    const live = pair('live', DEFAULT_SCOPES, Date.parse('2099-06-01T00:00:00.000Z'));
    const result = await mod(switcher).syncActivePair?.('alfa', live);
    expect(heartbeats(switcher.calls)).toEqual([
      { accessToken: 'access-live', refreshToken: 'refresh-live', expiresAt: '2099-06-01T00:00:00.000Z', label: 'alfa' },
    ]);
    expect(result).toEqual({ kind: 'ok', pair: live });
  });

  it('par diferente na resposta (o monitor renovou) volta com expiresAt em epoch ms e os scopes do enviado', async () => {
    const switcher = makeSwitcher({ heartbeatReturns: { accessToken: 'access-row', refreshToken: 'refresh-row', expiresAt: '2099-07-01T00:00:00+00:00' } });
    const result = await mod(switcher).syncActivePair?.('alfa', pair('live'));
    expect(result).toEqual({
      kind: 'ok',
      pair: { accessToken: 'access-row', refreshToken: 'refresh-row', expiresAt: Date.parse('2099-07-01T00:00:00Z'), scopes: DEFAULT_SCOPES },
    });
  });

  it('expiresAt vazio na resposta (servidor sem validade conhecida) mantém a do par enviado', async () => {
    const switcher = makeSwitcher({ heartbeatReturns: { accessToken: 'access-row', refreshToken: 'refresh-row', expiresAt: '' } });
    const result = await mod(switcher).syncActivePair?.('alfa', pair('live'));
    expect(result).toMatchObject({ kind: 'ok', pair: { accessToken: 'access-row', expiresAt: FAR_FUTURE } });
  });

  it('403 = a conta não é mais nossa (entregue a outra pessoa, ou inutilizável)', async () => {
    expect(await mod(makeSwitcher({ heartbeatStatus: 403 })).syncActivePair?.('alfa', pair('live'))).toEqual({ kind: 'lost' });
  });

  it('409 = conflito transitório (o oficial só registra e tenta no próximo ciclo)', async () => {
    expect(await mod(makeSwitcher({ heartbeatStatus: 409 })).syncActivePair?.('alfa', pair('live'))).toEqual({ kind: 'failed', reason: 'conflict' });
  });

  it('falha de rede e 5xx não lançam', async () => {
    expect(await mod(makeSwitcher({ heartbeatStatus: 'throw' })).syncActivePair?.('alfa', pair('live'))).toEqual({ kind: 'failed', reason: 'offline' });
    expect(await mod(makeSwitcher({ heartbeatStatus: 503 })).syncActivePair?.('alfa', pair('live'))).toEqual({ kind: 'failed', reason: 'offline' });
    expect(await mod(makeSwitcher({ heartbeatStatus: 401 })).syncActivePair?.('alfa', pair('live'))).toEqual({ kind: 'failed', reason: 'unauthorized' });
  });
});

describe('mod composto — heartbeat só para conta do pool', () => {
  it('conta local: nenhuma chamada ao switcher', async () => {
    const switcher = makeSwitcher();
    const vault = new MemoryVault();
    vault.entries.set('seazone:session', 'session-token');
    const composite = createLocalWithPoolMod({
      local: createLocalMod({ accounts: [{ id: 'L1', label: 'L1', plan: null }], vault }),
      pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl }),
    });
    expect(await composite.syncActivePair?.('L1', pair('live'))).toEqual({ kind: 'skipped' });
    expect(await composite.syncActivePair?.('seazone:alfa', pair('live'))).toMatchObject({ kind: 'ok' });
    expect(heartbeats(switcher.calls).map((body) => body.label)).toEqual(['alfa']);
  });
});

describe('claude-state.adoptRefreshedActivePair — única escrita nova, só da mesma conta', () => {
  function disk(oauth: Record<string, unknown>) {
    const files: Record<string, string> = {
      [CREDENTIALS_PATH]: JSON.stringify({ claudeAiOauth: oauth, mcpOAuth: { srv: { token: 'mcp' } } }),
      [CLAUDE_JSON_PATH]: JSON.stringify({ oauthAccount: { accountUuid: 'x' } }),
    };
    return { files, io: makeMemoryIo(files) };
  }

  it('disco ainda com o par enviado: grava o par novo por merge, preservando scopes e chaves desconhecidas', () => {
    const sent = pair('sent', ['user:inference', 'user:profile', 'user:sessions:claude_code']);
    const { files, io } = disk({ ...sent, subscriptionType: 'max', rateLimitTier: 'tier' });
    const before = files[CLAUDE_JSON_PATH];
    const result = adoptRefreshedActivePair({ io, claudeHome: CLAUDE_HOME }, sent, pair('row', [], Date.parse('2099-07-01T00:00:00Z')));
    expect(result).toBe('written');
    const written = JSON.parse(files[CREDENTIALS_PATH]) as Record<string, unknown>;
    expect(written).toEqual({
      claudeAiOauth: {
        accessToken: 'access-row',
        refreshToken: 'refresh-row',
        expiresAt: Date.parse('2099-07-01T00:00:00Z'),
        scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        subscriptionType: 'max',
        rateLimitTier: 'tier',
      },
      mcpOAuth: { srv: { token: 'mcp' } },
    });
    // A conta é a mesma: o `oauthAccount` de `.claude.json` não é tocado.
    expect(files[CLAUDE_JSON_PATH]).toBe(before);
  });

  it('disco mudou desde a leitura (o CLI rotacionou): não escreve', () => {
    const { files, io } = disk({ ...pair('cli-rotated') });
    const before = files[CREDENTIALS_PATH];
    expect(adoptRefreshedActivePair({ io, claudeHome: CLAUDE_HOME }, pair('sent'), pair('row'))).toBe('disk-changed');
    expect(files[CREDENTIALS_PATH]).toBe(before);
  });

  it('sem arquivo: não escreve', () => {
    const files: Record<string, string> = {};
    expect(adoptRefreshedActivePair({ io: makeMemoryIo(files), claudeHome: CLAUDE_HOME }, pair('sent'), pair('row'))).toBe('disk-changed');
    expect(files).toEqual({});
  });
});

describe('motor — heartbeat periódico enquanto a ativa é do pool', () => {
  it('start() arma o heartbeat por timer do processo; primeiro ciclo logo, depois intervalo bem abaixo de 20 min', async () => {
    const switcher = makeSwitcher();
    const { engine, scheduled, diskPair } = setup({ activeAccountId: 'seazone:alfa', switcher });
    engine.start();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBeLessThanOrEqual(60 * 1000);
    await scheduled[0].fn();
    expect(heartbeats(switcher.calls)).toEqual([
      { accessToken: diskPair.accessToken, refreshToken: diskPair.refreshToken, expiresAt: new Date(diskPair.expiresAt).toISOString(), label: 'alfa' },
    ]);
    // Reagenda depois de cada ciclo, com folga para perder um ciclo inteiro dentro da posse de 20 min.
    expect(scheduled).toHaveLength(2);
    expect(scheduled[1].delay).toBeGreaterThan(0);
    expect(scheduled[1].delay * 2).toBeLessThan(TWENTY_MINUTES_MS);
    await scheduled[1].fn();
    expect(heartbeats(switcher.calls)).toHaveLength(2);
    expect(scheduled).toHaveLength(3);
  });

  it('conta local ativa: o ciclo roda e não manda nada ao switcher', async () => {
    const switcher = makeSwitcher();
    const { engine, scheduled } = setup({ activeAccountId: 'L1', switcher });
    engine.start();
    await scheduled[0].fn();
    expect(heartbeats(switcher.calls)).toEqual([]);
    expect(scheduled).toHaveLength(2); // segue armado: a ativa pode virar do pool depois.
  });

  it('não manda heartbeat logo depois de trocar para o pool (o próprio switch renova a posse, como no oficial)', async () => {
    const switcher = makeSwitcher();
    const { engine } = setup({ activeAccountId: 'L1', switcher });
    await engine.switchTo('seazone:alfa');
    expect(heartbeats(switcher.calls)).toEqual([]);
  });

  it('resposta com o mesmo par: nada é escrito', async () => {
    const switcher = makeSwitcher();
    const { engine, writeSpy, files } = setup({ activeAccountId: 'seazone:alfa', switcher });
    const before = files[CREDENTIALS_PATH];
    await engine.runPoolHeartbeat();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(files[CREDENTIALS_PATH]).toBe(before);
  });

  it('resposta com par mais novo (o servidor renovou): adota em disco, por merge, com os scopes de antes', async () => {
    const switcher = makeSwitcher({ heartbeatReturns: { accessToken: 'access-row', refreshToken: 'refresh-row', expiresAt: '2099-08-01T00:00:00+00:00' } });
    const { engine, oauthOnDisk, credentialsOnDisk, events } = setup({ activeAccountId: 'seazone:alfa', switcher });
    await engine.runPoolHeartbeat();
    expect(oauthOnDisk()).toEqual({
      accessToken: 'access-row',
      refreshToken: 'refresh-row',
      expiresAt: Date.parse('2099-08-01T00:00:00Z'),
      scopes: DEFAULT_SCOPES,
      subscriptionType: 'max',
    });
    expect(credentialsOnDisk().mcpOAuth).toEqual({ srv: { token: 'mcp' } });
    expect(events).toEqual([{ event: 'pool-pair-adopted', account: 'seazone:alfa' }]);
    expect(JSON.stringify(events)).not.toContain('access-');
    expect(JSON.stringify(events)).not.toContain('refresh-');
  });

  it('falha de rede: nada muda, nada lança, o próximo ciclo tenta de novo', async () => {
    const switcher = makeSwitcher({ heartbeatStatus: 'throw' });
    const { engine, scheduled, events, files } = setup({ activeAccountId: 'seazone:alfa', switcher });
    const before = files[CREDENTIALS_PATH];
    engine.start();
    await scheduled[0].fn();
    expect(engine.getActiveAccountId()).toBe('seazone:alfa');
    expect(files[CREDENTIALS_PATH]).toBe(before);
    expect(switchBodies(switcher.calls)).toEqual([]);
    expect(events).toEqual([{ event: 'pool-heartbeat-failed', account: 'seazone:alfa', reason: 'offline' }]);
    expect(scheduled).toHaveLength(2);
    await scheduled[1].fn();
    expect(heartbeats(switcher.calls)).toHaveLength(2);
    // Mesma falha repetida não enche o log.
    expect(events).toHaveLength(1);
  });

  it('409 (conflito transitório): não sai da conta', async () => {
    const switcher = makeSwitcher({ heartbeatStatus: 409 });
    const { engine } = setup({ activeAccountId: 'seazone:alfa', switcher });
    await engine.runPoolHeartbeat();
    expect(engine.getActiveAccountId()).toBe('seazone:alfa');
    expect(switchBodies(switcher.calls)).toEqual([]);
  });

  it('par em disco é de uma conta LOCAL (identidade prova): não manda o token pessoal ao switcher', async () => {
    const switcher = makeSwitcher();
    const { engine } = setup({ activeAccountId: 'seazone:alfa', switcher, fingerprint: 'fp-L1', localFingerprint: 'fp-L1' });
    await engine.runPoolHeartbeat();
    expect(heartbeats(switcher.calls)).toEqual([]);
  });

  it('motor descartado: nenhum heartbeat', async () => {
    const switcher = makeSwitcher();
    const { engine } = setup({ activeAccountId: 'seazone:alfa', switcher });
    engine.dispose();
    await engine.runPoolHeartbeat();
    expect(heartbeats(switcher.calls)).toEqual([]);
  });
});

describe('motor — perda de posse (403) tira a sessão da conta na hora', () => {
  const pool = [
    { label: 'alfa', fiveHourUtil: 10, sevenDayUtil: 10, sonnetUtil: null, available: true },
    { label: 'gama', fiveHourUtil: 20, sevenDayUtil: 20, sonnetUtil: null, available: true },
  ];

  it('com local com folga: volta para a local e registra o evento', async () => {
    const switcher = makeSwitcher({ heartbeatStatus: 403, accounts: pool });
    const { engine, events, oauthOnDisk } = setup({ activeAccountId: 'seazone:alfa', switcher, localLoad: 10 });
    await engine.runPoolHeartbeat();
    expect(engine.getActiveAccountId()).toBe('L1');
    expect(oauthOnDisk().accessToken).toBe('access-L1-vault');
    expect(switchBodies(switcher.calls)).toEqual([]);
    expect(events).toEqual([{ event: 'pool-account-lost', account: 'seazone:alfa', outcome: 'switched', to: 'L1' }]);
  });

  it('vale mesmo com a troca automática desligada (não é troca por carga: a conta é de outra pessoa)', async () => {
    const switcher = makeSwitcher({ heartbeatStatus: 403, accounts: pool });
    const { engine } = setup({ activeAccountId: 'seazone:alfa', switcher, localLoad: 10, autoSwitchEnabled: false });
    await engine.runPoolHeartbeat();
    expect(engine.getActiveAccountId()).toBe('L1');
  });

  it('local sem folga: pede `auto` ao switcher informando a conta perdida, e adota a entregue', async () => {
    const switcher = makeSwitcher({ heartbeatStatus: 403, accounts: pool, deliverOnAuto: 'gama' });
    const { engine, events, oauthOnDisk } = setup({ activeAccountId: 'seazone:alfa', switcher, localLoad: 95 });
    await engine.runPoolHeartbeat();
    expect(switchBodies(switcher.calls)).toEqual([{ account: 'auto', currentAccount: 'alfa' }]);
    expect(engine.getActiveAccountId()).toBe('seazone:gama');
    expect(oauthOnDisk().accessToken).toBe('access-pool-gama');
    expect(events).toEqual([{ event: 'pool-account-lost', account: 'seazone:alfa', outcome: 'switched', to: 'seazone:gama' }]);
  });

  it('pool sem conta livre (409 no switch): cai na local mesmo cheia — não fica no token de outra pessoa', async () => {
    const switcher = makeSwitcher({ heartbeatStatus: 403, accounts: pool, switchStatus: 409 });
    const { engine, events } = setup({ activeAccountId: 'seazone:alfa', switcher, localLoad: 95 });
    await engine.runPoolHeartbeat();
    expect(engine.getActiveAccountId()).toBe('L1');
    expect(events).toEqual([{ event: 'pool-account-lost', account: 'seazone:alfa', outcome: 'switched', to: 'L1' }]);
  });
});
