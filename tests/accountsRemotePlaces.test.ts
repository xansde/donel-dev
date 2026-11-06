import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountEngine } from '../src/main/accounts/account-engine';
import type { AccountMod, CredentialPair, ListAccountsResult } from '../src/main/accounts/account-mod';
import { buildRemoteProgram, type RemoteClaudeState, type RemoteReadResult, type RemoteWriteResult } from '../src/main/accounts/remote-claude-state';
import { defaultAccountsConfig, type AccountsConfig, type RemotePlace } from '../src/shared/accounts';

// Lugares remotos (VPS): o que quebraria sem o dono perceber — uma conta
// renovada em dois CLIs, o par vivo do lugar perdido numa troca, ou o arquivo
// de credencial de lá corrompido.

function pair(tag: string): CredentialPair {
  return { accessToken: `at-${tag}`, refreshToken: `rt-${tag}`, expiresAt: 4_102_444_800_000, scopes: ['user:inference'] };
}

describe('programa remoto (roda no node do lugar)', () => {
  let home: string | null = null;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
  });

  function run(program: string): Record<string, unknown> {
    const result = spawnSync(process.execPath, ['-'], { input: program, env: { ...process.env, HOME: home!, USERPROFILE: home! }, encoding: 'utf8' });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
  }

  it('grava por merge, só se o par de lá não mudou, e apaga oauthAccount', () => {
    home = mkdtempSync(join(tmpdir(), 'donel-remote-'));
    mkdirSync(join(home, '.claude'));
    const credPath = join(home, '.claude', '.credentials.json');
    writeFileSync(credPath, JSON.stringify({ claudeAiOauth: { ...pair('old'), subscriptionType: 'max' }, other: 1 }));
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'uuid-1' }, projects: { a: 1 } }));

    const read = run(buildRemoteProgram({ op: 'read' }));
    expect(read).toEqual({ kind: 'ok', pair: pair('old'), fingerprint: createHash('sha256').update('uuid-1', 'utf8').digest('hex') });

    // O CLI de lá renovou depois da leitura: a escrita recusa e nada muda.
    expect(run(buildRemoteProgram({ op: 'write', expectedRefreshToken: 'rt-stale', next: pair('new') }))).toEqual({ kind: 'changed' });
    expect(JSON.parse(readFileSync(credPath, 'utf8')).claudeAiOauth.refreshToken).toBe('rt-old');

    expect(run(buildRemoteProgram({ op: 'write', expectedRefreshToken: 'rt-old', next: pair('new') }))).toEqual({ kind: 'written' });
    const written = JSON.parse(readFileSync(credPath, 'utf8'));
    expect(written.other).toBe(1);
    expect(written.claudeAiOauth).toEqual({ ...pair('new'), subscriptionType: 'max' });
    expect(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))).toEqual({ projects: { a: 1 } });

    // Liberar o lugar tira só o bloco da credencial.
    expect(run(buildRemoteProgram({ op: 'write', expectedRefreshToken: 'rt-new', next: null }))).toEqual({ kind: 'written' });
    expect(JSON.parse(readFileSync(credPath, 'utf8'))).toEqual({ other: 1 });
  });
});

class FakeRemote implements RemoteClaudeState {
  current: CredentialPair | null;
  fingerprint: string | null;
  writes: (CredentialPair | null)[] = [];
  /** Simula o CLI de lá renovando entre a leitura e a escrita, uma vez. */
  rotateBeforeNextWrite: CredentialPair | null = null;
  constructor(current: CredentialPair | null, fingerprint: string | null) {
    this.current = current;
    this.fingerprint = fingerprint;
  }
  async read(): Promise<RemoteReadResult> {
    return { kind: 'ok', pair: this.current, fingerprint: this.fingerprint };
  }
  async write(_target: string, expected: string | null, next: CredentialPair | null): Promise<RemoteWriteResult> {
    if (this.rotateBeforeNextWrite) {
      this.current = this.rotateBeforeNextWrite;
      this.rotateBeforeNextWrite = null;
    }
    if ((this.current?.refreshToken ?? null) !== expected) return { kind: 'changed' };
    this.current = next;
    this.fingerprint = null;
    this.writes.push(next);
    return { kind: 'written' };
  }
}

class FakeLocalMod implements AccountMod {
  readonly id = 'local' as const;
  vault = new Map<string, CredentialPair>([
    ['a', pair('a')],
    ['b', pair('b')],
    ['c', pair('c')],
  ]);
  captures: { id: string; pair: CredentialPair }[] = [];
  /** `null` = carga desconhecida (o par copiado do lugar venceu). */
  loads: Record<string, number | null> = { a: 0, b: 0, c: 0 };
  async listAccounts(): Promise<ListAccountsResult> {
    return {
      kind: 'ok',
      accounts: [...this.vault.keys()].map((id) => ({
        id,
        label: id.toUpperCase(),
        plan: null,
        active: false,
        available: true,
        load: this.loads[id] === null ? null : { fiveHour: this.loads[id] ?? 0, sevenDay: 0, sonnet: 0, readAt: '2026-11-04T00:00:00.000Z' },
      })),
    };
  }
  async switchTo(id: string) {
    const found = this.vault.get(id);
    return found ? { kind: 'ok' as const, pair: found } : { kind: 'failed' as const, reason: 'unknown-account' as const };
  }
  async captureRotatedPair(id: string, captured: CredentialPair): Promise<void> {
    this.captures.push({ id, pair: captured });
    this.vault.set(id, captured);
  }
}

function makeEngine(
  remote: FakeRemote,
  place: Partial<RemotePlace> = {},
  overrides: Partial<AccountsConfig> = {},
  engineOptions: { now?: () => number } = {},
) {
  const mod = new FakeLocalMod();
  const savedRemotes: (readonly RemotePlace[])[] = [];
  const config: AccountsConfig = {
    ...defaultAccountsConfig(),
    mod: 'local',
    activeAccountId: 'a',
    localAccounts: [
      { id: 'a', label: 'A', plan: null, fingerprint: 'fp-a' },
      { id: 'b', label: 'B', plan: null, fingerprint: 'fp-b' },
      { id: 'c', label: 'C', plan: null, fingerprint: 'fp-c' },
    ],
    remotes: [{ id: 'vps', label: 'VPS', sshTarget: 'dev@vps-atlas', activeAccountId: null, ...place }],
    ...overrides,
  };
  const engine = new AccountEngine({
    config,
    resolveMod: () => mod,
    applySwitch: async (_pair, onRotated) => {
      await onRotated(null);
    },
    isSessionBusy: () => false,
    remoteState: remote,
    onRemotesChanged: (remotes) => savedRemotes.push(remotes),
    ...engineOptions,
  });
  return { engine, mod, savedRemotes };
}

describe('motor com lugar remoto', () => {
  it('guarda o par vivo da conta que sai do lugar antes de gravar a que entra', async () => {
    const remote = new FakeRemote(pair('b-rotated'), 'fp-b');
    const { engine, mod, savedRemotes } = makeEngine(remote, { activeAccountId: 'b' });

    const outcome = await engine.switchRemote('vps', 'c');

    expect(outcome).toEqual({ kind: 'switched', from: 'b', to: 'c' });
    expect(mod.captures).toEqual([{ id: 'b', pair: pair('b-rotated') }]);
    expect(remote.writes).toEqual([pair('c')]);
    expect(savedRemotes.at(-1)?.[0].activeAccountId).toBe('c');
  });

  it('se o CLI de lá renovou no meio, captura o par novo dele e só então grava', async () => {
    const remote = new FakeRemote(pair('b-1'), 'fp-b');
    remote.rotateBeforeNextWrite = pair('b-2');
    const { engine, mod } = makeEngine(remote, { activeAccountId: 'b' });

    expect((await engine.switchRemote('vps', 'c')).kind).toBe('switched');
    expect(mod.vault.get('b')).toEqual(pair('b-2'));
    expect(remote.writes).toEqual([pair('c')]);
  });

  it('uma conta nunca fica ativa aqui e no lugar ao mesmo tempo', async () => {
    const remote = new FakeRemote(null, null);
    const { engine } = makeEngine(remote, { activeAccountId: 'b' });

    expect(await engine.switchRemote('vps', 'a')).toEqual({ kind: 'failed', reason: 'in-use' });
    expect(await engine.switchTo('b')).toEqual({ kind: 'failed', reason: 'account-unavailable' });
    expect(remote.writes).toEqual([]);
  });

  it('a troca automática desta máquina não leva para a conta que está no lugar', async () => {
    const remote = new FakeRemote(pair('b'), 'fp-b');
    const { engine, mod } = makeEngine(remote, { activeAccountId: 'b' });
    mod.loads = { a: 95, b: 0, c: 40 };
    await engine.listAccounts();

    const outcome = await engine.evaluateAutoSwitch();

    expect(outcome).toEqual({ kind: 'switched', from: 'a', to: 'c' });
  });

  it('com uma só conta livre, o PC escolhe antes do lugar (preferência do dono, 05/11)', async () => {
    const remote = new FakeRemote(pair('b'), 'fp-b');
    const { engine, mod } = makeEngine(remote, { activeAccountId: 'b' });
    mod.loads = { a: 95, b: 98, c: 0 };
    await engine.listAccounts();

    expect(await engine.evaluateAutoSwitch()).toEqual({ kind: 'switched', from: 'a', to: 'c' });
    expect(remote.writes).toEqual([]);
  });

  it('a conta do lugar com carga desconhecida por 10 min conta como cheia e sai', async () => {
    let clock = 1_000_000;
    const remote = new FakeRemote(pair('b'), 'fp-b');
    const { engine, mod } = makeEngine(remote, { activeAccountId: 'b' }, {}, { now: () => clock });
    mod.loads = { a: 10, b: null, c: 0 };
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();
    expect(remote.writes).toEqual([]);

    clock += 9 * 60 * 1000;
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();
    expect(remote.writes).toEqual([]);

    clock += 2 * 60 * 1000;
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();
    expect(remote.writes).toEqual([pair('c')]);
  });
});
