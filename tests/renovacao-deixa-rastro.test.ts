// t-028deaf0 — a remote tab resumed by `-r` (9f0fcd8b) went past 256k on 14/11 and was never renewed, and nothing on
// the disk said why: the prepare failure only went to `console.error`, and the renderer's verdict lived in memory. Now
// both leave one line in `main-events.log`: each `renewal:prepare` with its outcome, and the verdict of a tab past the
// limit, only when it changes (not at every turn). Never a key nor the handoff's text.
import { describe, expect, it } from 'vitest';
import { createSessionRenewalService, prepareRenewalForPty, type PrepareRenewalDeps } from '../src/main/session-renewal';
import { DEFAULT_SESSION_RENEWAL_PREFS, renewalTrace, sanitizeRenewalTrace, type RenewalTraceInput } from '../src/shared/sessionRenewal';

function deps(over: Partial<PrepareRenewalDeps> = {}): { deps: PrepareRenewalDeps; lines: [string, Record<string, unknown>][] } {
  const lines: [string, Record<string, unknown>][] = [];
  const service = createSessionRenewalService({
    handoffsDir: '/tmp/donel-rastro-handoffs',
    randomId: () => 'r1',
    fs: { mkdirSync: () => undefined, writeFileSync: () => undefined, readFileText: () => null },
  });
  return {
    lines,
    deps: {
      service,
      activeSessionOf: () => 'sess-1',
      sourceCwdOf: () => '/p',
      transcriptPathOf: () => null,
      sshTargetOf: () => undefined,
      remoteDirOf: () => undefined,
      runRemote: async () => ({ stdout: '' }),
      log: (event, detail) => lines.push([event, detail]),
      ...over,
    },
  };
}

const input = { ptyId: 'pty-1', contextTokens: 256_606, limitTokens: 250_000 };

describe('renewal:prepare deixa uma linha com o resultado', () => {
  it('ok, e cada recusa com o seu motivo', async () => {
    const ok = deps();
    expect(await prepareRenewalForPty(ok.deps, input)).not.toBeNull();
    expect(ok.lines).toEqual([['renewal-prepare', { ptyId: 'pty-1', outcome: 'ok', remote: false, contextTokens: 256_606, limitTokens: 250_000 }]]);

    const noSession = deps({ activeSessionOf: () => undefined });
    expect(await prepareRenewalForPty(noSession.deps, input)).toBeNull();
    expect(noSession.lines[0]![1].outcome).toBe('sem-sessao');

    const noSource = deps({ sourceCwdOf: () => undefined });
    expect(await prepareRenewalForPty(noSource.deps, input)).toBeNull();
    expect(noSource.lines[0]![1].outcome).toBe('sem-fonte');

    const home = deps({ sshTargetOf: () => 'vps', runRemote: async () => ({ stdout: '', code: 255, timedOut: false }) });
    expect(await prepareRenewalForPty(home.deps, input)).toBeNull();
    expect(home.lines[0]![1]).toMatchObject({ outcome: 'ssh-home', remote: true, sshExit: 255, timedOut: false });

    const local = deps({ service: { ...deps().deps.service, prepare: () => { throw Object.assign(new Error('C:/x/y sem espaço'), { code: 'ENOSPC' }); } } });
    expect(await prepareRenewalForPty(local.deps, input)).toBeNull();
    expect(local.lines[0]![1]).toMatchObject({ outcome: 'write', remote: false, errorCode: 'ENOSPC' });
    expect(JSON.stringify(local.lines)).not.toContain('C:/x/y');

    const write = deps({ sshTargetOf: () => 'vps', runRemote: async (_t, script) => ({ stdout: script.includes('DONEL_HOME') ? 'DONEL_HOME=/home/u\n' : 'nada' }) });
    expect(await prepareRenewalForPty(write.deps, input)).toBeNull();
    expect(write.lines[0]![1]).toMatchObject({ outcome: 'write', remote: true });
  });

  it('a linha não leva caminho, instrução nem texto da passagem', async () => {
    const remote = deps({ sshTargetOf: () => 'vps', runRemote: async (_t, script) => ({ stdout: script.includes('DONEL_HOME') ? 'DONEL_HOME=/home/u\n' : 'DONEL_OK\n' }) });
    expect(await prepareRenewalForPty(remote.deps, input)).not.toBeNull();
    expect(Object.keys(remote.lines[0]![1]).sort()).toEqual(['contextTokens', 'limitTokens', 'outcome', 'ptyId', 'remote']);
  });
});

describe('o veredito de uma aba que passou do limite, só na mudança', () => {
  const past: RenewalTraceInput = {
    prefs: DEFAULT_SESSION_RENEWAL_PREFS,
    snoozedUntilTokens: null,
    contextTokens: 256_606,
    turn: 'waiting',
    backgroundAgents: false,
    eligible: true,
    ptyId: 'pty-1',
    sessionId: '9f0fcd8b',
    remote: true,
    phase: 'idle',
  };

  it('abaixo do limite, ou sem leitura, nada', () => {
    expect(renewalTrace({ ...past, contextTokens: 240_000 })).toBeNull();
    expect(renewalTrace({ ...past, contextTokens: null })).toBeNull();
    expect(renewalTrace({ ...past, snoozedUntilTokens: 306_606 })).toBeNull();
  });

  it('passou: diz o veredito com o que o decidiu, também quando a aba não é elegível', () => {
    expect(renewalTrace(past)?.entry).toEqual({
      verdict: 'renew',
      contextTokens: 256_606,
      threshold: 250_000,
      ptyId: 'pty-1',
      claudeSessionId: '9f0fcd8b',
      remote: true,
      eligible: true,
      turn: 'waiting',
      phase: 'idle',
    });
    expect(renewalTrace({ ...past, eligible: false })?.entry).toMatchObject({ verdict: 'off', eligible: false });
  });

  it('o turno indo e voltando não muda a chave; elegibilidade, ptyId e fase mudam', () => {
    const key = renewalTrace(past)!.key;
    expect(renewalTrace({ ...past, turn: 'working', contextTokens: 257_386 })!.key).toBe(key);
    expect(renewalTrace({ ...past, eligible: false })!.key).not.toBe(key);
    expect(renewalTrace({ ...past, ptyId: null })!.key).not.toBe(key);
    expect(renewalTrace({ ...past, phase: 'preparing' })!.key).not.toBe(key);
  });

  it('o main só grava os campos conhecidos, com o tipo certo', () => {
    const entry = renewalTrace(past)!.entry;
    expect(sanitizeRenewalTrace({ ...entry, token: 'segredo', handoff: 'texto' })).toEqual(entry);
    expect(sanitizeRenewalTrace({ ...entry, contextTokens: 'muito' })).toBeNull();
    expect(sanitizeRenewalTrace(null)).toBeNull();
  });
});
