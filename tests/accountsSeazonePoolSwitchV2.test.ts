import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AccountEngine } from '../src/main/accounts/account-engine';
import type { CredentialPair } from '../src/main/accounts/account-mod';
import { applyAccountSwitch, type ClaudeStateIoDeps } from '../src/main/accounts/claude-state';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import { createLocalWithPoolMod } from '../src/main/accounts/mods/local-with-pool-mod';
import { CLAUDE_CODE_DEFAULT_SCOPES, createSeazoneMod } from '../src/main/accounts/mods/seazone-mod';
import type { HttpFetchLike, HttpRequestInit } from '../src/main/accounts/usage-client';
import type { VaultLike, VaultWriteResult } from '../src/main/accounts/vault';
import { formatAutoSwitchEvent, formatSwitchFailure } from '../src/renderer/src/accountsFormat';
import type { AccountsConfig } from '../src/shared/accounts';
import { defaultAccountsConfig } from '../src/shared/accounts';

// Pool Seazone ao lado das locais — v2 do patch local.
// D1: a resposta de `/session/switch` nunca traz `scopes`; sem
// `user:inference` no `.credentials.json` o Claude Code não reconhece o login
// claude.ai e a primeira mensagem dá erro de API.
// D2: pedir a conta do pool por NOME esbarra em 409 quando outra pessoa está
// nela; a troca automática passa a pedir `auto` (a API escolhe uma livre) e o
// motor adota a conta que a API entregou. 409 deixa de virar "sem conexão".

const BASE_URL = 'https://switcher.example.test';
const FAR_FUTURE = Date.parse('2099-01-01T00:00:00.000Z');
const CLAUDE_HOME = 'C:\\fake\\.claude';
const CREDENTIALS_PATH = join(CLAUDE_HOME, '.credentials.json');
const CLAUDE_JSON_PATH = 'C:\\fake\\.claude.json';

function pair(tag: string, scopes: readonly string[] = ['user:inference']): CredentialPair {
  return { accessToken: `access-${tag}`, refreshToken: `refresh-${tag}`, expiresAt: FAR_FUTURE, scopes };
}

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

interface SwitcherOptions {
  readonly accounts?: unknown[];
  /** Status de `/session/switch` (default 200). */
  readonly switchStatus?: number;
  readonly switchDetail?: string;
  /** Label que a API devolve no switch (default: o label pedido; `auto` -> `deliverOnAuto`). */
  readonly deliverOnAuto?: string;
  /** Campos extras/omitidos na resposta do switch. */
  readonly switchExtra?: Record<string, unknown>;
}

/** Switcher falso que imita o contrato real (`SwitchResponse`: label, accessToken, refreshToken, expiresAt, plan, load, previousLoad, warning — SEM scopes). */
function makeSwitcher(options: SwitcherOptions = {}) {
  const calls: SwitcherCall[] = [];
  const fetchImpl: HttpFetchLike = async (url: string, init?: HttpRequestInit) => {
    const path = url.slice(BASE_URL.length);
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path, body });
    if (path === '/auth/refresh') return { status: 200, json: async () => ({ accessJwt: 'jwt' }) };
    if (path === '/accounts') return { status: 200, json: async () => options.accounts ?? [] };
    if (path === '/session/switch') {
      if (options.switchStatus && options.switchStatus !== 200) {
        return { status: options.switchStatus, json: async () => ({ detail: options.switchDetail ?? 'recusado' }) };
      }
      const asked = String(body?.account ?? '');
      const label = asked === 'auto' ? (options.deliverOnAuto ?? 'auto-delivered') : asked;
      const p = pair(`pool-${label}`);
      return {
        status: 200,
        json: async () => ({
          label,
          accessToken: p.accessToken,
          refreshToken: p.refreshToken,
          expiresAt: new Date(p.expiresAt).toISOString(),
          plan: 'max',
          load: 10,
          previousLoad: null,
          warning: null,
          ...options.switchExtra,
        }),
      };
    }
    if (path === '/session/heartbeat') return { status: 200, json: async () => ({}) };
    return { status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

function switchBodies(calls: readonly SwitcherCall[]): Record<string, unknown>[] {
  return calls.filter((call) => call.path === '/session/switch').map((call) => call.body ?? {});
}

function heartbeatLabels(calls: readonly SwitcherCall[]): unknown[] {
  return calls.filter((call) => call.path === '/session/heartbeat').map((call) => call.body?.label);
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

/** Uso da Anthropic falso para o mod local: carga baixa ou alta por access token. */
function usageFetchFor(loadByAccess: Record<string, number>): HttpFetchLike {
  return async (_url: string, init?: HttpRequestInit) => {
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
    const token = auth.replace(/^Bearer\s+/i, '');
    const load = loadByAccess[token] ?? 0;
    return { status: 200, json: async () => ({ five_hour: { utilization: load }, seven_day: { utilization: load } }) };
  };
}

function setup(options: {
  activeAccountId: string | null;
  switcher: ReturnType<typeof makeSwitcher>;
  localScopes?: readonly string[];
  localLoad?: number;
  realDisk?: boolean;
  onAutoSwitchLogged?: ConstructorParameters<typeof AccountEngine>[0]['onAutoSwitchLogged'];
}) {
  const vault = new MemoryVault();
  const localPair = pair('L1-vault', options.localScopes ?? ['user:inference', 'user:profile']);
  vault.entries.set('L1', JSON.stringify(localPair));
  vault.entries.set('seazone:session', 'session-token');
  const config: AccountsConfig = {
    ...defaultAccountsConfig(),
    mod: 'local',
    seazone: { baseUrl: BASE_URL },
    localAccounts: [{ id: 'L1', label: 'L1', plan: null }],
    activeAccountId: options.activeAccountId,
  };
  const files: Record<string, string> = {
    [CREDENTIALS_PATH]: JSON.stringify({ claudeAiOauth: pair('on-disk', ['user:inference', 'user:profile']) }),
    [CLAUDE_JSON_PATH]: JSON.stringify({ oauthAccount: { accountUuid: 'x' } }),
  };
  const io = makeMemoryIo(files);
  let fakeDisk: CredentialPair = pair('on-disk');
  const applySwitch = options.realDisk
    ? (next: CredentialPair, onRotated: (p: CredentialPair | null) => void | Promise<void>) =>
        applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: onRotated }, next)
    : async (next: CredentialPair, onRotated: (p: CredentialPair | null) => void | Promise<void>) => {
        await onRotated(fakeDisk);
        fakeDisk = next;
      };
  const applySpy = vi.fn(applySwitch);
  const engine = new AccountEngine({
    config,
    resolveMod: () =>
      createLocalWithPoolMod({
        local: createLocalMod({
          accounts: config.localAccounts,
          vault,
          fetchImpl: usageFetchFor({ 'access-L1-vault': options.localLoad ?? 0, 'access-on-disk': options.localLoad ?? 0 }),
        }),
        pool: createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: options.switcher.fetchImpl }),
      }),
    applySwitch: applySpy,
    isSessionBusy: () => false,
    onAutoSwitchLogged: options.onAutoSwitchLogged,
  });
  const writtenOauth = (): Record<string, unknown> => (JSON.parse(files[CREDENTIALS_PATH]) as { claudeAiOauth: Record<string, unknown> }).claudeAiOauth;
  return { engine, vault, applySpy, writtenOauth, getFakeDisk: () => fakeDisk };
}

describe('D1 — credencial do pool entra no .credentials.json com scopes válidos', () => {
  it('os scopes padrão são os do Claude Code e incluem user:inference', () => {
    expect([...CLAUDE_CODE_DEFAULT_SCOPES].sort()).toEqual([
      'user:file_upload',
      'user:inference',
      'user:mcp_servers',
      'user:plugins',
      'user:profile',
      'user:sessions:claude_code',
    ]);
  });

  it('seazone-mod: resposta sem scopes (contrato real da API) devolve o par com os scopes padrão', async () => {
    const vault = new MemoryVault();
    vault.entries.set('seazone:session', 'session-token');
    const switcher = makeSwitcher();
    const mod = createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl });
    const result = await mod.switchTo('alfa');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.pair.scopes).toEqual(CLAUDE_CODE_DEFAULT_SCOPES);
    expect(result.pair.scopes).toContain('user:inference');
  });

  it('seazone-mod: se a API um dia mandar scopes, eles são respeitados', async () => {
    const vault = new MemoryVault();
    vault.entries.set('seazone:session', 'session-token');
    const switcher = makeSwitcher({ switchExtra: { scopes: ['user:inference', 'user:profile'] } });
    const mod = createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: switcher.fetchImpl });
    const result = await mod.switchTo('alfa');
    expect(result.kind === 'ok' && result.pair.scopes).toEqual(['user:inference', 'user:profile']);
  });

  it('local -> pool com a escrita real: .credentials.json fica com user:inference', async () => {
    const switcher = makeSwitcher();
    const { engine, writtenOauth } = setup({ activeAccountId: 'L1', switcher, realDisk: true });
    expect(await engine.switchTo('seazone:alfa')).toEqual({ kind: 'switched', from: 'L1', to: 'seazone:alfa' });
    const oauth = writtenOauth();
    expect(oauth.accessToken).toBe('access-pool-alfa');
    expect(oauth.scopes).toEqual(CLAUDE_CODE_DEFAULT_SCOPES);
    expect(typeof oauth.expiresAt).toBe('number');
  });

  it('conta local inalterada: pool -> local grava o par do cofre com os scopes dele', async () => {
    const switcher = makeSwitcher();
    const { engine, writtenOauth } = setup({ activeAccountId: 'seazone:alfa', switcher, realDisk: true, localScopes: ['user:inference', 'user:profile'] });
    expect(await engine.switchTo('L1')).toEqual({ kind: 'switched', from: 'seazone:alfa', to: 'L1' });
    expect(writtenOauth()).toEqual({ ...pair('L1-vault', ['user:inference', 'user:profile']) });
  });
});

describe('D2 — troca automática para o pool pede `auto` e adota a conta entregue', () => {
  const saturatedLocalPool = [
    { label: 'alfa', fiveHourUtil: 5, sevenDayUtil: 5, sonnetUtil: null, available: true },
    { label: 'gama', fiveHourUtil: 30, sevenDayUtil: 30, sonnetUtil: null, available: true },
  ];

  it('local saturada -> pool: pede `auto` sem currentAccount e fica com o id real devolvido', async () => {
    const switcher = makeSwitcher({ accounts: saturatedLocalPool, deliverOnAuto: 'gama' });
    const logged: unknown[] = [];
    const { engine } = setup({ activeAccountId: 'L1', switcher, localLoad: 95, onAutoSwitchLogged: (entry) => logged.push(entry) });
    await engine.listAccounts();
    const outcome = await engine.evaluateAutoSwitch();
    expect(switchBodies(switcher.calls)).toEqual([{ account: 'auto' }]);
    expect(outcome).toEqual({ kind: 'switched', from: 'L1', to: 'seazone:gama' });
    expect(engine.getActiveAccountId()).toBe('seazone:gama');
    expect(engine.getSnapshot().activeAccountId).toBe('seazone:gama');
    expect(engine.getSnapshot().lastAutoSwitch).toMatchObject({ kind: 'switched', from: 'L1', to: 'seazone:gama' });
    expect(logged).toEqual([expect.objectContaining({ outcome: 'switched', from: 'L1', to: 'seazone:gama' })]);
  });

  it('a captura seguinte vai para o label REAL (gama), não para o pedido', async () => {
    const switcher = makeSwitcher({ accounts: saturatedLocalPool, deliverOnAuto: 'gama' });
    const { engine, vault } = setup({ activeAccountId: 'L1', switcher, localLoad: 95 });
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();
    const vaultWritesAfterAuto = vault.writes.length;
    expect(await engine.switchTo('L1')).toEqual({ kind: 'switched', from: 'seazone:gama', to: 'L1' });
    expect(heartbeatLabels(switcher.calls)).toEqual(['gama']);
    expect(vault.writes.length).toBe(vaultWritesAfterAuto);
  });

  it('pool -> pool automático: pede `auto` com currentAccount = label da conta que sai', async () => {
    const switcher = makeSwitcher({
      accounts: [
        { label: 'alfa', fiveHourUtil: 95, sevenDayUtil: 95, sonnetUtil: null, available: true },
        { label: 'beta', fiveHourUtil: 10, sevenDayUtil: 10, sonnetUtil: null, available: true },
      ],
      deliverOnAuto: 'delta',
    });
    const { engine } = setup({ activeAccountId: 'seazone:alfa', switcher, localLoad: 95 });
    await engine.listAccounts();
    const outcome = await engine.evaluateAutoSwitch();
    expect(switchBodies(switcher.calls)).toEqual([{ account: 'auto', currentAccount: 'alfa' }]);
    expect(outcome).toEqual({ kind: 'switched', from: 'seazone:alfa', to: 'seazone:delta' });
    expect(heartbeatLabels(switcher.calls)).toEqual(['alfa']);
  });

  it('API devolve a própria conta atual: não escreve nada e não finge que trocou', async () => {
    const switcher = makeSwitcher({
      accounts: [
        { label: 'alfa', fiveHourUtil: 95, sevenDayUtil: 95, sonnetUtil: null, available: true },
        { label: 'beta', fiveHourUtil: 10, sevenDayUtil: 10, sonnetUtil: null, available: true },
      ],
      deliverOnAuto: 'alfa',
    });
    const { engine, applySpy } = setup({ activeAccountId: 'seazone:alfa', switcher, localLoad: 95 });
    await engine.listAccounts();
    const outcome = await engine.evaluateAutoSwitch();
    expect(outcome).toEqual({ kind: 'failed', reason: 'account-unavailable' });
    expect(applySpy).not.toHaveBeenCalled();
    expect(engine.getActiveAccountId()).toBe('seazone:alfa');
  });

  it('409 no automático vira motivo próprio no lastAutoSwitch', async () => {
    const switcher = makeSwitcher({ accounts: saturatedLocalPool, switchStatus: 409 });
    const { engine, applySpy } = setup({ activeAccountId: 'L1', switcher, localLoad: 95 });
    await engine.listAccounts();
    expect(await engine.evaluateAutoSwitch()).toEqual({ kind: 'failed', reason: 'account-unavailable' });
    expect(engine.getSnapshot().lastAutoSwitch).toMatchObject({ kind: 'failed', reason: 'account-unavailable' });
    expect(applySpy).not.toHaveBeenCalled();
  });
});

describe('D2 — troca manual continua por nome; 409 vira motivo próprio', () => {
  it('manual local -> pool pede pelo nome, sem currentAccount', async () => {
    const switcher = makeSwitcher();
    const { engine } = setup({ activeAccountId: 'L1', switcher });
    expect(await engine.switchTo('seazone:alfa')).toEqual({ kind: 'switched', from: 'L1', to: 'seazone:alfa' });
    expect(switchBodies(switcher.calls)).toEqual([{ account: 'alfa' }]);
  });

  it('manual pool -> pool pede pelo nome e informa a conta que sai (como o cliente oficial)', async () => {
    const switcher = makeSwitcher();
    const { engine } = setup({ activeAccountId: 'seazone:alfa', switcher });
    expect(await engine.switchTo('seazone:beta')).toEqual({ kind: 'switched', from: 'seazone:alfa', to: 'seazone:beta' });
    expect(switchBodies(switcher.calls)).toEqual([{ account: 'beta', currentAccount: 'alfa' }]);
  });

  it('409 (conta em posse de outra pessoa) devolve account-unavailable, não offline, e não escreve nada', async () => {
    const switcher = makeSwitcher({ switchStatus: 409, switchDetail: "'alfa' esta em uso por outra pessoa agora" });
    const { engine, applySpy } = setup({ activeAccountId: 'L1', switcher });
    const outcome = await engine.switchTo('seazone:alfa');
    expect(outcome).toEqual({ kind: 'failed', reason: 'account-unavailable' });
    expect(applySpy).not.toHaveBeenCalled();
    expect(engine.getActiveAccountId()).toBe('L1');
  });

  it('seazone-mod: 409 -> account-unavailable; 5xx continua offline', async () => {
    const vault = new MemoryVault();
    vault.entries.set('seazone:session', 'session-token');
    const busy = createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: makeSwitcher({ switchStatus: 409 }).fetchImpl });
    expect(await busy.switchTo('alfa')).toEqual({ kind: 'failed', reason: 'account-unavailable' });
    const down = createSeazoneMod({ baseUrl: BASE_URL, vault, fetchImpl: makeSwitcher({ switchStatus: 503 }).fetchImpl });
    expect(await down.switchTo('alfa')).toEqual({ kind: 'failed', reason: 'offline' });
  });
});

describe('D2 — texto do painel', () => {
  it('account-unavailable: em uso ou indisponível, com saída sugerida; nunca "Sem conexão"', () => {
    const message = formatSwitchFailure('account-unavailable', 'Seazone · alfa');
    expect(message).toBe('«Seazone · alfa» está em uso ou indisponível agora — escolha outra ou deixe a troca automática pegar uma livre.');
    expect(message).not.toMatch(/conex/i);
  });

  it('os textos de antes continuam iguais', () => {
    expect(formatSwitchFailure('offline', 'X')).toBe('Sem conexão para renovar a credencial de «X» — tente de novo.');
    expect(formatSwitchFailure('unauthorized', 'X')).toBe('O servidor recusou a troca para «X» — tente de novo.');
    expect(formatSwitchFailure('io', 'X')).toBe('Não foi possível trocar para «X» — tente de novo.');
  });

  it('narração do auto-switch com account-unavailable', () => {
    const text = formatAutoSwitchEvent({ kind: 'failed', to: 'seazone:alfa', reason: 'account-unavailable', at: '2026-10-28T15:00:00.000Z' }, () => 'Seazone · alfa', () => '15:00');
    expect(text).toContain('nenhuma conta livre no pool agora');
  });
});
