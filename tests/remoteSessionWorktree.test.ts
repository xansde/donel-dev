import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHasTranscriptScript, buildRemoteSetupScript, parseHasTranscriptOutput, parseRemoteSetupOutput } from '../src/main/remote-session';
import { agentOpenWorktree } from '../src/shared/sessionWorktree';

// t-58b67066 — sessões abertas na VPS dividiam a pasta do projeto: uma trocou a branch dela embaixo da outra.
// Cada sessão aberta lá nasce numa worktree própria; a pasta principal nunca troca de branch.
// Roda o script de verdade (bash + git), com tmux e claude falsos no PATH: o que importa é onde a sessão cai.

const sidA = 'aaaaaaaa-1111-4111-8111-111111111111';
const sidB = 'bbbbbbbb-2222-4222-8222-222222222222';
const meta = (sid: string) => ({ sid, hookToken: 't', hookPort: 21000, mcpToken: null, mcpPort: null, localCwd: '/p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' });

let home = '';
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

function sandbox(): { env: NodeJS.ProcessEnv; git: (cwd: string, ...args: string[]) => string; repo: string } {
  home = mkdtempSync(join(tmpdir(), 'donel-wt-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  // tmux falso: nenhuma sessão viva; claude falso: diz em que pasta rodou.
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n');
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\npwd\n');
  chmodSync(join(bin, 'tmux'), 0o755);
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }).trim();
  const repo = join(home, 'seazone', 'proj');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'staging');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  return { env, git, repo };
}

function setup(env: NodeJS.ProcessEnv, sid: string, worktree?: string, dir = 'seazone/proj') {
  const script = buildRemoteSetupScript({ sid, homeRelativeDir: dir, repoUrl: null, branch: null, files: [], claudeArgs: ['-n', 'x'], meta: meta(sid), ...(worktree ? { worktree } : {}) });
  const stdout = execFileSync('bash', ['-s'], { input: script, env, encoding: 'utf8' });
  return parseRemoteSetupOutput(stdout, 0);
}

const runClaudeSh = (env: NodeJS.ProcessEnv, sid: string): string =>
  execFileSync('bash', [join(home, '.donel', 's', sid, 'claude.sh')], { env, encoding: 'utf8' }).trim();

describe.skipIf(process.platform === 'win32')('sessão aberta na VPS numa worktree própria', () => {
  it('duas sessões caem em worktrees diferentes; trocar a branch numa não mexe na outra nem na pasta principal', () => {
    const { env, git, repo } = sandbox();
    const a = setup(env, sidA, 'dev-a-1112-1400');
    const b = setup(env, sidB, 'dev-b-1112-1400');
    const wa = join(repo, '.claude', 'worktrees', 'dev-a-1112-1400');
    const wb = join(repo, '.claude', 'worktrees', 'dev-b-1112-1400');
    expect(a).toEqual({ kind: 'new', remoteDir: wa });
    expect(b).toEqual({ kind: 'new', remoteDir: wb });
    // O claude da sessão roda dentro da worktree dela (é por essa pasta que o espelho acha a conversa).
    expect(runClaudeSh(env, sidA)).toBe(wa);
    expect(runClaudeSh(env, sidB)).toBe(wb);
    git(wa, 'switch', '-q', '-c', 'feature/a');
    git(wb, 'switch', '-q', '-c', 'feature/b');
    expect(git(repo, 'branch', '--show-current')).toBe('staging');
    expect(git(wa, 'branch', '--show-current')).toBe('feature/a');
    expect(git(wb, 'branch', '--show-current')).toBe('feature/b');
  });

  it('a mesma worktree reabre (reinício da sessão), sem criar outra nem falhar', () => {
    const { env, repo } = sandbox();
    setup(env, sidA, 'dev-a-1112-1400');
    expect(setup(env, sidA, 'dev-a-1112-1400')).toEqual({ kind: 'new', remoteDir: join(repo, '.claude', 'worktrees', 'dev-a-1112-1400') });
  });

  it('retomar a conversa que nasceu numa worktree volta para ela, e a busca da conversa a acha lá', () => {
    const { env, repo } = sandbox();
    const wa = join(repo, '.claude', 'worktrees', 'dev-a-1112-1400');
    setup(env, sidA, 'dev-a-1112-1400');
    const slug = wa.replace(/[^a-zA-Z0-9]/g, '-');
    mkdirSync(join(home, '.claude', 'projects', slug), { recursive: true });
    writeFileSync(join(home, '.claude', 'projects', slug, `${sidA}.jsonl`), '{}\n');
    // A retomada não traz o nome da worktree: só o id da conversa.
    expect(setup(env, sidA)).toEqual({ kind: 'new', remoteDir: wa });
    expect(runClaudeSh(env, sidA)).toBe(wa);
    const has = execFileSync('bash', ['-s'], { input: buildHasTranscriptScript('seazone/proj', sidA), env, encoding: 'utf8' });
    expect(parseHasTranscriptOutput(has)).toBe('has');
    // Sessão nova sem worktree pedida segue na pasta principal.
    expect(setup(env, sidB)).toEqual({ kind: 'new', remoteDir: repo });
  });

  it('pasta sem git: a sessão abre na pasta, sem worktree e sem erro', () => {
    sandbox();
    const plain = join(home, 'seazone', 'solta');
    mkdirSync(plain, { recursive: true });
    const env = { ...process.env, HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH ?? ''}` };
    expect(setup(env, sidA, 'dev-a-1112-1400', 'seazone/solta')).toEqual({ kind: 'new', remoteDir: plain });
    expect(readFileSync(join(home, '.donel', 's', sidA, 'dir'), 'utf8').trim()).toBe(plain);
  });

  it('o nome que vira pasta e branch só sai do app, nunca do texto livre', () => {
    sandbox();
    expect(() => buildRemoteSetupScript({ sid: sidA, homeRelativeDir: 'p', repoUrl: null, branch: null, files: [], claudeArgs: [], meta: meta(sidA), worktree: '../../x; rm -rf ~' })).toThrow();
  });
});

describe('sessão aberta por outra sessão (sessao_abrir)', () => {
  it('na VPS ganha uma worktree com nome livre; neste computador, não', () => {
    const now = new Date(2026, 10, 12, 14, 0);
    expect(agentOpenWorktree('vps', 'Dev', now, [])).toBe('dev-1112-1400');
    expect(agentOpenWorktree('vps', 'Dev', now, ['dev-1112-1400'])).toBe('dev-1112-1400-2');
    expect(agentOpenWorktree(undefined, 'Dev', now, [])).toBeUndefined();
  });
});
