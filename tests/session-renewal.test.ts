import { describe, expect, it } from 'vitest';
import {
  checkRenewal,
  decideSwap,
  DEFAULT_SESSION_RENEWAL_PREFS,
  parseHandoffHeader,
  renewalHandoffDeliveryNotice,
  renewalHandoffUptakeNotice,
  renewalLaunchArgs,
  RENEWAL_HANDOFF_UPTAKE_WAIT_MS,
  toolTouchesHandoff,
  type RenewalCheckInput,
} from '../src/shared/sessionRenewal';
import { renewalEligible, type RenewalEligibilityFacts } from '../src/shared/sessionRenewal';

// Sessão renovada em voo (B36) — the two decisions that would end a process the
// owner did not mean to end (or never end it). The card that keeps its place on the
// board is in mindscape-place.test.ts. Refinement: docs/refinamentos/sessao-renovada-em-voo.md.

const base: RenewalCheckInput = {
  prefs: DEFAULT_SESSION_RENEWAL_PREFS,
  contextTokens: 260_000,
  turn: 'waiting',
  backgroundAgents: false,
  snoozedUntilTokens: null,
  eligible: true,
};

describe('checkRenewal — renew now?', () => {
  it('past the limit, at the end of a turn, with nothing in the background: renew', () => {
    expect(checkRenewal(base)).toBe('renew');
  });

  it('never mid-turn, with a permission open or with background agents alive', () => {
    expect(checkRenewal({ ...base, turn: 'working' })).toBe('due-wait');
    expect(checkRenewal({ ...base, turn: 'permission' })).toBe('due-wait');
    expect(checkRenewal({ ...base, backgroundAgents: true })).toBe('due-wait');
  });

  it('warns close to the limit, and "Agora não" moves the threshold', () => {
    expect(checkRenewal({ ...base, contextTokens: 240_000 })).toBe('near');
    expect(checkRenewal({ ...base, contextTokens: 100_000 })).toBe('off');
    expect(checkRenewal({ ...base, snoozedUntilTokens: 310_000 })).toBe('off');
    expect(checkRenewal({ ...base, contextTokens: 312_000, snoozedUntilTokens: 310_000 })).toBe('renew');
  });

  it('off when switched off, without a reading, or in a tab that is not eligible', () => {
    expect(checkRenewal({ ...base, prefs: { ...base.prefs, enabled: false } })).toBe('off');
    expect(checkRenewal({ ...base, contextTokens: null })).toBe('off');
    expect(checkRenewal({ ...base, eligible: false })).toBe('off');
  });
});

// t-62f0fa0b — a session opened by `sessao_abrir` on the VPS is born in a worktree and never renewed: it grew without
// limit. The rule against worktrees is for this computer, where the app removes the worktree when the process ends. On a
// remote place the setup script made it and nothing removes it; the renewal keeps `--worktree` and the setup reuses it.
describe('renewalEligible — which tabs may be renewed', () => {
  const plain: RenewalEligibilityFacts = { sessionType: 'claude', loginTab: false, hasSessionId: true, exited: false, worktree: false, remote: false };

  it('a remote session in its worktree renews; a local one in a worktree does not (it would race the cleanup)', () => {
    expect(renewalEligible({ ...plain, worktree: true, remote: true })).toBe(true);
    expect(renewalEligible({ ...plain, worktree: true, remote: false })).toBe(false);
  });

  it('never a terminal, a login tab, a tab without a session or a process that ended', () => {
    expect(renewalEligible(plain)).toBe(true);
    expect(renewalEligible({ ...plain, remote: true, sessionType: 'shell' })).toBe(false);
    expect(renewalEligible({ ...plain, remote: true, loginTab: true })).toBe(false);
    expect(renewalEligible({ ...plain, remote: true, hasSessionId: false })).toBe(false);
    expect(renewalEligible({ ...plain, remote: true, exited: true })).toBe(false);
  });
});

describe('decideSwap — swap or wait?', () => {
  const ready = parseHandoffHeader('---\ndonel-passagem: 1\ntrabalho-vivo: nenhum\n---\n# Passagem');

  it('handoff written, turn over, nothing alive: swap', () => {
    expect(ready).toEqual({ kind: 'ready', liveWork: null });
    expect(decideSwap({ handoff: ready, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('swap');
  });

  it('never ends a process with live work, declared or reported by the CLI', () => {
    const declared = parseHandoffHeader('---\ndonel-passagem: 1\ntrabalho-vivo: agente revisando o PR #12\n---\n');
    expect(decideSwap({ handoff: declared, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('wait-live-work');
    expect(decideSwap({ handoff: ready, turn: 'waiting', backgroundAgents: true, turnEndedSinceAsk: true })).toBe('wait-live-work');
    // a header without the field did not say "nothing": it counts as live work
    const silent = parseHandoffHeader('---\ndonel-passagem: 1\n---\n');
    expect(decideSwap({ handoff: silent, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('wait-live-work');
  });

  it('waits for the request turn to end; gives up when it ended without a handoff', () => {
    expect(decideSwap({ handoff: ready, turn: 'working', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('wait-turn');
    expect(decideSwap({ handoff: ready, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: false })).toBe('wait-turn');
    expect(decideSwap({ handoff: parseHandoffHeader(null), turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('give-up');
    expect(decideSwap({ handoff: parseHandoffHeader('# sem cabeçalho'), turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('give-up');
  });
});

describe('the new session read the handoff? (it went in, but did it open the file?)', () => {
  const path = '/home/atlas/.config/donel-dev/handoffs/2026-11-21-1030-beacon-1a2b3c4d.md';

  it('a Read of the handoff counts, also by the same file name on the place (remote copy) or a shell that prints it', () => {
    expect(toolTouchesHandoff('Read', { file_path: path }, path)).toBe(true);
    expect(toolTouchesHandoff('Read', { file_path: '/home/vega/.donel/handoffs/2026-11-21-1030-beacon-1a2b3c4d.md' }, path)).toBe(true);
    expect(toolTouchesHandoff('Read', { file_path: 'C:\\Users\\atlas\\handoffs\\2026-11-21-1030-beacon-1a2b3c4d.md' }, path)).toBe(true);
    expect(toolTouchesHandoff('Bash', { command: `cat "${path}"` }, path)).toBe(true);
  });

  it('another file, the instructions next to it or a write of the handoff do not count', () => {
    expect(toolTouchesHandoff('Read', { file_path: '/home/atlas/projeto/README.md' }, path)).toBe(false);
    expect(toolTouchesHandoff('Read', { file_path: path.replace('.md', '.instrucoes.md') }, path)).toBe(false);
    expect(toolTouchesHandoff('Write', { file_path: path }, path)).toBe(false);
    expect(toolTouchesHandoff('Read', 'lixo', path)).toBe(false);
  });

  it('quiet while the first turn runs, and once the read shows up', () => {
    expect(renewalHandoffUptakeNotice({ handoffPath: path, read: false, turnEnded: false, elapsedMs: 60_000 })).toBeNull();
    expect(renewalHandoffUptakeNotice({ handoffPath: path, read: true, turnEnded: true, elapsedMs: RENEWAL_HANDOFF_UPTAKE_WAIT_MS })).toBeNull();
  });

  it('at the end of the first turn, or past the wait, without a read: says it does not know, with the path, never "falhou"', () => {
    const atStop = renewalHandoffUptakeNotice({ handoffPath: path, read: false, turnEnded: true, elapsedMs: 60_000 });
    expect(atStop).toContain(path);
    expect(atStop).toContain('não sei se leu');
    expect(atStop).not.toMatch(/falhou/i);
    const late = renewalHandoffUptakeNotice({ handoffPath: path, read: false, turnEnded: false, elapsedMs: RENEWAL_HANDOFF_UPTAKE_WAIT_MS });
    expect(late).toContain(path);
  });
});

describe('renewalHandoffDeliveryNotice — did the new session get the handoff?', () => {
  const path = '/home/atlas/.config/donel-dev/handoffs/beacon.md';

  it('quiet when the first message went in or the CLI queued it', () => {
    expect(renewalHandoffDeliveryNotice({ kind: 'entrou' }, path)).toBeNull();
    expect(renewalHandoffDeliveryNotice({ kind: 'na-fila' }, path)).toBeNull();
  });

  it('says so, with the handoff path, when it did not go in or is still on its way past the wait', () => {
    const failed = renewalHandoffDeliveryNotice({ kind: 'nao-foi', reason: 'a caixa não respondeu' }, path);
    expect(failed).toContain(path);
    expect(failed).toContain('a caixa não respondeu');
    const pending = renewalHandoffDeliveryNotice({ kind: 'enviando' }, path);
    expect(pending).toContain(path);
    expect(pending).not.toBeNull();
  });
});

// t-408339e0 — a tab reattached after an update (or resumed by `-r` alone) has no `-n` nor `--model` in its launch args.
// The renewed process was born `claude --session-id <new>`: nameless on the board and on the CLI's default model.
describe('renewalLaunchArgs — the renewed session keeps the name and the model of the one it replaces', () => {
  it('fills -n and --model from the tab when the launch args do not carry them', () => {
    expect(renewalLaunchArgs(['-r', 'old'], null, { name: 'Dev · Faixa preta', model: 'claude-opus-5-5' })).toEqual([
      '--model',
      'claude-opus-5-5',
      '-n',
      'Dev · Faixa preta',
    ]);
    expect(renewalLaunchArgs(undefined, 'bypassPermissions', { name: 'Revisor', model: 'opus' })).toEqual([
      '--model',
      'opus',
      '-n',
      'Revisor',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  it('never duplicates nor overrides what the launch args already say', () => {
    const launched = ['--model', 'sonnet', '-n', 'Antigo', '--session-id', 'old'];
    expect(renewalLaunchArgs(launched, null, { name: 'Outro', model: 'claude-opus-5-5' })).toEqual(['--model', 'sonnet', '-n', 'Antigo']);
    expect(renewalLaunchArgs(['--model=haiku', '--name=X'], null, { name: 'Y', model: 'opus' })).toEqual(['--model=haiku', '--name=X']);
  });

  it('leaves out what the tab does not know', () => {
    expect(renewalLaunchArgs(['-r', 'old'], null, { name: '  ', model: null })).toEqual([]);
  });
});
