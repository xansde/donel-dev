import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IsolatedLoginManager,
  isLoginDirPath,
  LOGIN_DIR_PREFIX,
  type AccountHarvestedEvent,
  type IsolatedLoginFsDeps,
  type IsolatedLoginManagerDeps,
} from '../src/main/accounts/isolated-login';
import type { VaultLike, VaultWriteResult } from '../src/main/accounts/vault';
import type { AccountId, LoginStatusDto } from '../src/shared/accounts';

// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 1 — colhedor do login
// isolado (plan-etapa-3.md §4.2). Timers REAIS com ms pequenos (mesmo
// espírito de tests/transcriptWatcher.test.ts, que já usa esperas reais para
// exercitar debounce) — evita reimplementar um fake clock só para isto; os
// valores de configuração (pollIntervalMs etc.) são injetáveis exatamente
// para permitir isso em teste.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VALID_UUID = () => randomUUID();

function credentialsJson(overrides: Partial<{ accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] }> = {}): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: overrides.accessToken ?? 'access-real',
      refreshToken: overrides.refreshToken ?? 'refresh-real',
      expiresAt: overrides.expiresAt ?? 1_800_000_000_000,
      scopes: overrides.scopes ?? ['user:inference'],
    },
  });
}

function claudeJson(accountUuid: string): string {
  return JSON.stringify({ oauthAccount: { accountUuid } });
}

class FakeVault implements VaultLike {
  readonly writes: { id: string; plainText: string }[] = [];
  private readonly entries = new Map<string, string>();
  private failNextWrite = false;

  read(id: string): string | null {
    return this.entries.get(id) ?? null;
  }

  write(id: string, plainText: string): VaultWriteResult {
    this.writes.push({ id, plainText });
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return { kind: 'vault-unavailable' };
    }
    this.entries.set(id, plainText);
    return { kind: 'ok' };
  }

  forceNextWriteToFail(): void {
    this.failNextWrite = true;
  }
}

interface FakeFs extends IsolatedLoginFsDeps {
  readonly files: Map<string, string>;
  readonly mkdirCalls: string[];
  readonly removeDirCalls: string[];
  dirEntries: string[];
  removeDirShouldThrow: boolean;
}

function makeFakeFs(): FakeFs {
  const files = new Map<string, string>();
  const mkdirCalls: string[] = [];
  const removeDirCalls: string[] = [];
  const fakeFs: FakeFs = {
    files,
    mkdirCalls,
    removeDirCalls,
    dirEntries: [],
    removeDirShouldThrow: false,
    mkdir: (path) => {
      mkdirCalls.push(path);
    },
    removeDir: (path) => {
      removeDirCalls.push(path);
      if (fakeFs.removeDirShouldThrow) throw new Error('EPERM (fake)');
    },
    listDir: () => fakeFs.dirEntries,
    readText: (path) => files.get(path) ?? null,
  };
  return fakeFs;
}

interface Harness {
  manager: IsolatedLoginManager;
  fs: FakeFs;
  vault: FakeVault;
  userDataDir: string;
  calls: string[];
  emitStatusCalls: LoginStatusDto[];
  killPtyCalls: string[];
  harvestedCalls: AccountHarvestedEvent[];
  generateAccountIdCallsLog: string[];
  readonly generateAccountIdCalls: number;
  findAccountByFingerprintBox: { impl: (fingerprint: string) => { id: AccountId; label: string } | null };
  isVaultAvailableFlag: { value: boolean };
}

function makeHarness(overrides: Partial<IsolatedLoginManagerDeps> = {}): Harness {
  const userDataDir = 'C:\\fake\\userData';
  const fs = makeFakeFs();
  const vault = new FakeVault();
  const calls: string[] = [];
  const emitStatusCalls: LoginStatusDto[] = [];
  const killPtyCalls: string[] = [];
  const harvestedCalls: AccountHarvestedEvent[] = [];
  const isVaultAvailableFlag = { value: true };
  const generateAccountIdCallsLog: string[] = [];
  const findAccountByFingerprintBox = { impl: (_fp: string): { id: AccountId; label: string } | null => null };

  const trackedVaultWrite = vault.write.bind(vault);
  vault.write = (id: string, plainText: string) => {
    calls.push('vault.write');
    return trackedVaultWrite(id, plainText);
  };
  const trackedRemoveDir = fs.removeDir.bind(fs);
  fs.removeDir = (path: string) => {
    calls.push('removeDir');
    trackedRemoveDir(path);
  };

  const manager = new IsolatedLoginManager({
    userDataDir,
    platform: 'win32',
    fs,
    vault,
    isVaultAvailable: () => isVaultAvailableFlag.value,
    findAccountByFingerprint: (fp) => findAccountByFingerprintBox.impl(fp),
    generateLoginId: () => VALID_UUID(),
    generateAccountId: () => {
      const id = `generated-${generateAccountIdCallsLog.length + 1}`;
      generateAccountIdCallsLog.push(id);
      return id;
    },
    onAccountHarvested: (event) => {
      calls.push('onAccountHarvested');
      harvestedCalls.push(event);
    },
    killPty: (ptyId) => {
      calls.push('killPty');
      killPtyCalls.push(ptyId);
    },
    emitStatus: (status) => {
      calls.push('emitStatus');
      emitStatusCalls.push(status);
    },
    // Defaults generosos (granularidade de timer do Windows não é confiável
    // abaixo de ~15ms) — `attachTimeoutMs` grande de propósito, pra nenhum
    // teste focado em poll/grace/cancel disparar o timeout de anexação por
    // acidente; só o describe dedicado a ele o sobrescreve para um valor
    // pequeno.
    pollIntervalMs: 15,
    fingerprintGraceMs: 60,
    exitWaitMs: 40,
    attachTimeoutMs: 500,
    ...overrides,
  });

  return {
    manager,
    fs,
    vault,
    userDataDir,
    calls,
    emitStatusCalls,
    killPtyCalls,
    harvestedCalls,
    generateAccountIdCallsLog,
    get generateAccountIdCalls(): number {
      return generateAccountIdCallsLog.length;
    },
    findAccountByFingerprintBox,
    isVaultAvailableFlag,
  };
}

function credPathFor(dir: string): string {
  return join(dir, '.credentials.json');
}

function claudePathFor(dir: string): string {
  return join(dir, '.claude.json');
}

// ---------------------------------------------------------------------------
describe('isLoginDirPath (puro)', () => {
  const userDataDir = 'C:\\fake\\userData';
  const validUuid = VALID_UUID();

  it('caminho dentro de userDataDir com nome no padrão -> true', () => {
    expect(isLoginDirPath(userDataDir, join(userDataDir, `${LOGIN_DIR_PREFIX}${validUuid}`), 'win32')).toBe(true);
  });

  it('pai DIFERENTE de userDataDir -> false', () => {
    expect(isLoginDirPath(userDataDir, join('C:\\outra\\pasta', `${LOGIN_DIR_PREFIX}${validUuid}`), 'win32')).toBe(false);
  });

  it('traversal (..) que sai de userDataDir -> false', () => {
    expect(isLoginDirPath(userDataDir, join(userDataDir, '..', `${LOGIN_DIR_PREFIX}${validUuid}`), 'win32')).toBe(false);
  });

  it('nome fora do padrão (sem uuid válido, ou outro arquivo do userData) -> false', () => {
    expect(isLoginDirPath(userDataDir, join(userDataDir, 'accounts-login-nao-e-uuid'), 'win32')).toBe(false);
    expect(isLoginDirPath(userDataDir, join(userDataDir, 'accounts-vault.json'), 'win32')).toBe(false);
    expect(isLoginDirPath(userDataDir, join(userDataDir, 'config.json'), 'win32')).toBe(false);
    expect(isLoginDirPath(userDataDir, join(userDataDir, 'providers'), 'win32')).toBe(false);
  });

  it('maiúsculas no PAI em win32 -> case-insensitive (true); fora do win32 -> case-sensitive (false)', () => {
    const upperUserData = userDataDir.toUpperCase();
    const candidate = join(userDataDir, `${LOGIN_DIR_PREFIX}${validUuid}`);
    expect(isLoginDirPath(upperUserData, candidate, 'win32')).toBe(true);
    expect(isLoginDirPath(upperUserData, candidate, 'linux')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — begin', () => {
  it('rótulo válido -> started, cria o diretório accounts-login-<loginId>', () => {
    const { manager, fs, userDataDir } = makeHarness();
    const result = manager.begin('Conta B');
    expect(result.kind).toBe('started');
    if (result.kind !== 'started') throw new Error('esperava started');
    expect(fs.mkdirCalls).toEqual([join(userDataDir, `${LOGIN_DIR_PREFIX}${result.loginId}`)]);
    expect(manager.getPendingDir(result.loginId)).toBe(join(userDataDir, `${LOGIN_DIR_PREFIX}${result.loginId}`));
  });

  it('rótulo vazio/só espaço -> invalid-input, sem criar diretório', () => {
    const { manager, fs } = makeHarness();
    expect(manager.begin('')).toEqual({ kind: 'failed', reason: 'invalid-input' });
    expect(manager.begin('   ')).toEqual({ kind: 'failed', reason: 'invalid-input' });
    expect(fs.mkdirCalls).toEqual([]);
  });

  it('rótulo de 60 chars é aceito; 61 é invalid-input', () => {
    const { manager } = makeHarness();
    expect(manager.begin('a'.repeat(60)).kind).toBe('started');
    const second = makeHarness();
    expect(second.manager.begin('a'.repeat(61))).toEqual({ kind: 'failed', reason: 'invalid-input' });
  });

  it('cofre indisponível -> vault-unavailable, ANTES de criar diretório', () => {
    const { manager, fs, isVaultAvailableFlag } = makeHarness();
    isVaultAvailableFlag.value = false;
    expect(manager.begin('Conta B')).toEqual({ kind: 'failed', reason: 'vault-unavailable' });
    expect(fs.mkdirCalls).toEqual([]);
  });

  it('cofre indisponível no begin não deixa pendente travado — begin seguinte com cofre disponível funciona', () => {
    const { manager, isVaultAvailableFlag } = makeHarness();
    isVaultAvailableFlag.value = false;
    manager.begin('Conta B');
    isVaultAvailableFlag.value = true;
    expect(manager.begin('Conta B').kind).toBe('started');
  });

  it('segundo begin com um pendente -> login-in-progress (um por vez)', () => {
    const { manager, fs } = makeHarness();
    const first = manager.begin('Conta A');
    expect(first.kind).toBe('started');
    const second = manager.begin('Conta B');
    expect(second).toEqual({ kind: 'failed', reason: 'login-in-progress' });
    expect(fs.mkdirCalls).toHaveLength(1);
  });

  it('mkdir falhando -> failed/io, sem deixar pendente travado', () => {
    const { manager, fs } = makeHarness();
    fs.mkdir = () => {
      throw new Error('disco cheio (fake)');
    };
    expect(manager.begin('Conta A')).toEqual({ kind: 'failed', reason: 'io' });
    // não travou um pendente fantasma: outro begin (agora sem o mkdir quebrado) funciona.
    fs.mkdir = () => undefined;
    expect(manager.begin('Conta A').kind).toBe('started');
  });

  it('getPendingDir com loginId desconhecido -> null', () => {
    const { manager } = makeHarness();
    expect(manager.getPendingDir('nunca-existiu')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — timeout de anexação (sem PTY)', () => {
  it('sem attachPty dentro de attachTimeoutMs -> cancelled/no-terminal, diretório apagado, nada no cofre', async () => {
    const { manager, fs, vault, emitStatusCalls, killPtyCalls } = makeHarness({ attachTimeoutMs: 30 });
    const begun = manager.begin('Conta A');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;

    await sleep(120);

    expect(emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta A', state: 'cancelled', reason: 'no-terminal' }]);
    expect(fs.removeDirCalls).toContain(dir);
    expect(vault.writes).toEqual([]);
    expect(killPtyCalls).toEqual([]);
    expect(manager.getPendingDir(begun.loginId)).toBeNull();
  });

  it('attachPty ANTES do timeout cancela o timeout (login segue aguardando)', async () => {
    const { manager, emitStatusCalls } = makeHarness({ attachTimeoutMs: 30 });
    const begun = manager.begin('Conta A');
    if (begun.kind !== 'started') throw new Error('esperava started');
    manager.attachPty(begun.loginId, 'pty-1');

    await sleep(100);

    expect(emitStatusCalls).toEqual([]); // nunca terminou — ainda aguardando um /login de verdade.
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — poll e conclusão (fingerprint)', () => {
  it('par válido + fingerprint já presente no primeiro poll -> conclui com fingerprint (added, sem conta existente)', async () => {
    const { manager, fs, vault, harvestedCalls, emitStatusCalls, generateAccountIdCallsLog } = makeHarness();
    const begun = manager.begin('Conta Nova');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    const accountUuid = 'uuid-conta-nova';
    fs.files.set(credPathFor(dir), credentialsJson());
    fs.files.set(claudePathFor(dir), claudeJson(accountUuid));

    await sleep(120);

    expect(harvestedCalls).toHaveLength(1);
    expect(harvestedCalls[0].kind).toBe('added');
    expect(harvestedCalls[0].accountId).toBe('generated-1');
    expect(harvestedCalls[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(generateAccountIdCallsLog).toHaveLength(1);
    expect(vault.writes).toEqual([{ id: 'generated-1', plainText: JSON.stringify({ accessToken: 'access-real', refreshToken: 'refresh-real', expiresAt: 1_800_000_000_000, scopes: ['user:inference'] }) }]);
    expect(emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Nova', state: 'added', accountId: 'generated-1' }]);
  });

  it('par válido sem fingerprint durante todo o grace -> conclui sem fingerprint (added)', async () => {
    const { manager, fs, harvestedCalls, emitStatusCalls } = makeHarness();
    const begun = manager.begin('Conta Sem Fingerprint');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    fs.files.set(credPathFor(dir), credentialsJson());
    // .claude.json nunca aparece.

    await sleep(250);

    expect(harvestedCalls).toHaveLength(1);
    expect(harvestedCalls[0]).toEqual({ kind: 'added', accountId: 'generated-1', label: 'Conta Sem Fingerprint', fingerprint: null });
    expect(emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Sem Fingerprint', state: 'added', accountId: 'generated-1' }]);
  });

  it('fingerprint chega DEPOIS do par, ainda dentro do grace -> conclui COM o fingerprint (não descarta)', async () => {
    const { manager, fs, harvestedCalls } = makeHarness();
    const begun = manager.begin('Conta Atrasada');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    fs.files.set(credPathFor(dir), credentialsJson());

    setTimeout(() => {
      fs.files.set(claudePathFor(dir), claudeJson('uuid-atrasado'));
    }, 20);

    await sleep(250);

    expect(harvestedCalls).toHaveLength(1);
    expect(harvestedCalls[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('absent/invalid-format no arquivo de credenciais -> continua esperando (não conclui)', async () => {
    const { manager, fs, harvestedCalls } = makeHarness();
    const begun = manager.begin('Conta Parcial');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    fs.files.set(credPathFor(dir), '{ "claudeAiOauth": '); // escrita parcial

    await sleep(80);

    expect(harvestedCalls).toEqual([]);
    expect(manager.getPendingDir(begun.loginId)).toBe(dir); // ainda pendente
  });

  it('conta repetida (fingerprint bate com findAccountByFingerprint) -> substitui, mantém id e rótulo da existente', async () => {
    const harness = makeHarness();
    harness.findAccountByFingerprintBox.impl = () => ({ id: 'existing-acc-id', label: 'Rótulo Existente' });
    const begun = harness.manager.begin('Rótulo Digitado Agora');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = harness.manager.getPendingDir(begun.loginId)!;
    harness.fs.files.set(credPathFor(dir), credentialsJson());
    harness.fs.files.set(claudePathFor(dir), claudeJson('uuid-repetido'));

    await sleep(120);

    expect(harness.generateAccountIdCallsLog).toHaveLength(0); // reusa o id existente, nunca gera um novo.
    expect(harness.vault.writes).toEqual([{ id: 'existing-acc-id', plainText: expect.any(String) }]);
    expect(harness.harvestedCalls).toEqual([{ kind: 'replaced', accountId: 'existing-acc-id', label: 'Rótulo Existente', fingerprint: expect.any(String) }]);
    expect(harness.emitStatusCalls).toEqual([
      { loginId: begun.loginId, label: 'Rótulo Digitado Agora', state: 'replaced', accountId: 'existing-acc-id', existingLabel: 'Rótulo Existente' },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — ordem obrigatória da conclusão', () => {
  it('ORDEM: cofre (vault.write) -> onAccountHarvested -> killPty -> removeDir -> emitStatus', async () => {
    const harness = makeHarness();
    const begun = harness.manager.begin('Conta Ordem');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = harness.manager.getPendingDir(begun.loginId)!;
    harness.manager.attachPty(begun.loginId, 'pty-ordem');
    harness.fs.files.set(credPathFor(dir), credentialsJson());
    harness.fs.files.set(claudePathFor(dir), claudeJson('uuid-ordem'));

    // Sem simular a saída do PTY: a espera se resolve pelo próprio
    // `exitWaitMs` (default da harness), provando que a cauda roda até o
    // fim mesmo quando o `ptyManager` real demora a avisar a saída.
    await sleep(200);

    expect(harness.calls).toEqual(['vault.write', 'onAccountHarvested', 'killPty', 'removeDir', 'emitStatus']);
  });

  it('cofre fica indisponível bem no momento de concluir -> failed/vault-unavailable, MAS ainda mata o PTY e limpa o diretório', async () => {
    const harness = makeHarness();
    const begun = harness.manager.begin('Conta Falha Cofre');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = harness.manager.getPendingDir(begun.loginId)!;
    harness.manager.attachPty(begun.loginId, 'pty-falha');
    harness.fs.files.set(credPathFor(dir), credentialsJson());
    harness.fs.files.set(claudePathFor(dir), claudeJson('uuid-falha'));
    harness.vault.forceNextWriteToFail();

    await sleep(200);

    expect(harness.emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Falha Cofre', state: 'failed', reason: 'vault-unavailable' }]);
    expect(harness.harvestedCalls).toEqual([]); // nunca avisa a config de uma conta que não foi gravada.
    expect(harness.killPtyCalls).toEqual(['pty-falha']);
    expect(harness.fs.removeDirCalls).toContain(dir);
  });

  it('onAccountHarvested lança -> failed/io, e mesmo assim mata o PTY e limpa o diretório', async () => {
    const harness = makeHarness({
      onAccountHarvested: () => {
        throw new Error('config corrompida (fake)');
      },
    });
    const begun = harness.manager.begin('Conta Falha Harvest');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = harness.manager.getPendingDir(begun.loginId)!;
    harness.manager.attachPty(begun.loginId, 'pty-harvest-falha');
    harness.fs.files.set(credPathFor(dir), credentialsJson());
    harness.fs.files.set(claudePathFor(dir), claudeJson('uuid-harvest-falha')); // fingerprint já presente -> conclui no 1º poll, sem esperar o grace inteiro.

    await sleep(200);

    expect(harness.emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Falha Harvest', state: 'failed', reason: 'io' }]);
    expect(harness.killPtyCalls).toEqual(['pty-harvest-falha']);
    expect(harness.fs.removeDirCalls).toContain(dir);
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — saída do PTY', () => {
  it('PTY sai SEM login válido -> cancelled/exited-without-login, apaga diretório, nada no cofre', async () => {
    const { manager, fs, vault, emitStatusCalls, harvestedCalls } = makeHarness();
    const begun = manager.begin('Conta Sem Login');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    manager.attachPty(begun.loginId, 'pty-sem-login');

    manager.handlePtyExit('pty-sem-login');
    await sleep(10);

    expect(emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Sem Login', state: 'cancelled', reason: 'exited-without-login' }]);
    expect(fs.removeDirCalls).toContain(dir);
    expect(vault.writes).toEqual([]);
    expect(harvestedCalls).toEqual([]);
  });

  it('PTY sai logo depois do login (par já no disco) -> colhido imediatamente, sem esperar poll nem matar de novo', async () => {
    const { manager, fs, killPtyCalls, harvestedCalls, emitStatusCalls } = makeHarness();
    const begun = manager.begin('Conta Rápida');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    manager.attachPty(begun.loginId, 'pty-rapido');
    fs.files.set(credPathFor(dir), credentialsJson());
    // .claude.json ainda não chegou — "fingerprint do jeito que estiver".

    manager.handlePtyExit('pty-rapido');
    await sleep(10);

    expect(harvestedCalls).toEqual([{ kind: 'added', accountId: 'generated-1', label: 'Conta Rápida', fingerprint: null }]);
    expect(emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Rápida', state: 'added', accountId: 'generated-1' }]);
    expect(killPtyCalls).toEqual([]); // já tinha saído sozinho — nunca chama kill de novo.
    expect(fs.removeDirCalls).toContain(dir);
  });

  it('ptyId que não é o do login pendente é ignorado', async () => {
    const { manager, emitStatusCalls } = makeHarness();
    const begun = manager.begin('Conta X');
    if (begun.kind !== 'started') throw new Error('esperava started');
    manager.attachPty(begun.loginId, 'pty-real');

    manager.handlePtyExit('pty-de-outra-aba');
    await sleep(10);

    expect(emitStatusCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — cancel', () => {
  it('cancelar com PTY anexado: mata, espera o exit (via handlePtyExit) e apaga o diretório — nada no cofre', async () => {
    const { manager, fs, vault, emitStatusCalls, killPtyCalls } = makeHarness({ exitWaitMs: 30 });
    const begun = manager.begin('Conta Cancelada');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    manager.attachPty(begun.loginId, 'pty-cancel');

    manager.cancel(begun.loginId);
    expect(killPtyCalls).toEqual(['pty-cancel']); // kill já aconteceu de forma síncrona dentro de cancel().

    manager.handlePtyExit('pty-cancel'); // ptyManager real avisaria a saída pouco depois.
    await sleep(10);

    expect(emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Cancelada', state: 'cancelled', reason: 'user' }]);
    expect(fs.removeDirCalls).toContain(dir);
    expect(vault.writes).toEqual([]);
  });

  it('cancelar sem o PTY nunca sair -> ainda conclui via exitWaitMs (timeout)', async () => {
    const { manager, fs, emitStatusCalls } = makeHarness({ exitWaitMs: 15 });
    const begun = manager.begin('Conta Cancelada Sem Saída');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    manager.attachPty(begun.loginId, 'pty-preso');

    manager.cancel(begun.loginId);
    await sleep(50); // nunca chama handlePtyExit — só o timeout resolve.

    expect(emitStatusCalls).toEqual([{ loginId: begun.loginId, label: 'Conta Cancelada Sem Saída', state: 'cancelled', reason: 'user' }]);
    expect(fs.removeDirCalls).toContain(dir);
  });

  it('cancel com loginId desconhecido ou sem pendente -> no-op silencioso', () => {
    const { manager, emitStatusCalls } = makeHarness();
    expect(() => manager.cancel('nunca-existiu')).not.toThrow();
    expect(emitStatusCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — sweepStaleDirs (boot)', () => {
  it('remove só entradas accounts-login-<uuid> — nunca accounts-vault.json, config.json, providers ou accounts-login-xyz', () => {
    const { manager, fs, userDataDir } = makeHarness();
    const validName = `${LOGIN_DIR_PREFIX}${VALID_UUID()}`;
    fs.dirEntries = ['accounts-vault.json', 'config.json', 'providers', 'accounts-login-xyz', validName];

    const removed = manager.sweepStaleDirs();

    expect(removed).toEqual([validName]);
    expect(fs.removeDirCalls).toEqual([join(userDataDir, validName)]);
  });

  it('nenhuma entrada elegível -> não remove nada, devolve lista vazia', () => {
    const { manager, fs } = makeHarness();
    fs.dirEntries = ['accounts-vault.json', 'config.json'];
    expect(manager.sweepStaleDirs()).toEqual([]);
    expect(fs.removeDirCalls).toEqual([]);
  });

  it('removeDir lançando para uma entrada não derruba a varredura das demais (best-effort)', () => {
    const { manager, fs, userDataDir } = makeHarness();
    const a = `${LOGIN_DIR_PREFIX}${VALID_UUID()}`;
    const b = `${LOGIN_DIR_PREFIX}${VALID_UUID()}`;
    fs.dirEntries = [a, b];
    let calls = 0;
    fs.removeDir = (path) => {
      calls += 1;
      fs.removeDirCalls.push(path);
      if (path === join(userDataDir, a)) throw new Error('EPERM (fake)');
    };

    const removed = manager.sweepStaleDirs();

    expect(calls).toBe(2);
    expect(removed).toEqual([b]); // só a que não lançou entra no resultado.
  });
});

// ---------------------------------------------------------------------------
describe('IsolatedLoginManager — dispose', () => {
  it('com pendente aguardando um PTY anexado: mata o PTY, apaga o diretório best-effort, NUNCA emite status', () => {
    const { manager, fs, killPtyCalls, emitStatusCalls } = makeHarness();
    const begun = manager.begin('Conta Dispose');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;
    manager.attachPty(begun.loginId, 'pty-dispose');

    manager.dispose();

    expect(killPtyCalls).toEqual(['pty-dispose']);
    expect(fs.removeDirCalls).toContain(dir);
    expect(emitStatusCalls).toEqual([]);
  });

  it('sem PTY anexado: não chama killPty, mas ainda tenta apagar o diretório', () => {
    const { manager, fs, killPtyCalls } = makeHarness();
    const begun = manager.begin('Conta Dispose Sem PTY');
    if (begun.kind !== 'started') throw new Error('esperava started');
    const dir = manager.getPendingDir(begun.loginId)!;

    manager.dispose();

    expect(killPtyCalls).toEqual([]);
    expect(fs.removeDirCalls).toContain(dir);
  });

  it('sem pendente nenhum -> no-op seguro', () => {
    const { manager, fs, killPtyCalls } = makeHarness();
    expect(() => manager.dispose()).not.toThrow();
    expect(fs.removeDirCalls).toEqual([]);
    expect(killPtyCalls).toEqual([]);
  });
});
