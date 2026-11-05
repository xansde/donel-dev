// "Isolar em worktree" — o que acontece com a worktree da sessão quando a aba fecha.
// 1) A decisão "pode remover?" é pura: fatos -> decisão, um caso por regra do dono.
// 2) Inspeção + remoção de verdade contra repos git TEMPORÁRIOS (os.tmpdir()), com a worktree montada como o CLI
//    monta (`.claude/worktrees/<nome>`, branch `worktree-<nome>`, trava `claude session <nome> (pid N)`).
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decideSessionWorktreeRelease,
  isDisposableIgnored,
  releaseSessionWorktree,
  resolveMainRepoRootSync,
  sessionWorktreeTarget,
  type SessionWorktreeDeps,
  type SessionWorktreeFacts,
} from '../src/main/session-worktree';
import { createGitRunner } from '../src/main/sweep/git';
import { commitAll, createRepo, createSandbox, git, write, type Sandbox } from './helpers/sweep-fixture';

const exists = async (path: string): Promise<boolean> => fs.lstat(path).then(() => true, () => false);

function facts(patch: Partial<SessionWorktreeFacts> = {}): SessionWorktreeFacts {
  return {
    exists: true,
    registered: true,
    lock: { kind: 'claude-session', pid: 4242, alive: false },
    statusRead: true,
    dirty: [],
    preciousIgnored: [],
    hasSubmodules: false,
    uniqueCommits: 0,
    ownBranch: { name: 'worktree-radar', sha: 'abc', uniqueCommits: 0 },
    ...patch,
  };
}

describe('decideSessionWorktreeRelease (pura)', () => {
  it('limpa, sem commit só dela e com a trava velha do CLI: remove, destrava e apaga a branch do CLI', () => {
    expect(decideSessionWorktreeRelease(facts())).toEqual({ action: 'remove', unlock: true, deleteBranch: { name: 'worktree-radar', sha: 'abc' } });
  });

  it('sem trava: remove sem destravar', () => {
    expect(decideSessionWorktreeRelease(facts({ lock: { kind: 'none' } }))).toMatchObject({ action: 'remove', unlock: false });
  });

  it('mudança não commitada ou arquivo novo: fica, e diz quais', () => {
    expect(decideSessionWorktreeRelease(facts({ dirty: ['a.txt', 'b.txt', 'c.txt', 'd.txt'] }))).toEqual({
      action: 'keep',
      reason: 'tem mudança não commitada (a.txt, b.txt, c.txt e mais 1)',
    });
  });

  it('commit que não está em nenhum remoto nem em outra branch: fica', () => {
    expect(decideSessionWorktreeRelease(facts({ uniqueCommits: 2 }))).toEqual({
      action: 'keep',
      reason: 'tem 2 commits que não estão em nenhum remoto nem em outra branch',
    });
    expect(decideSessionWorktreeRelease(facts({ uniqueCommits: 1 })).action).toBe('keep');
  });

  it('não deu para contar os commits ou ler o status: na dúvida, fica', () => {
    expect(decideSessionWorktreeRelease(facts({ uniqueCommits: null })).action).toBe('keep');
    expect(decideSessionWorktreeRelease(facts({ statusRead: false })).action).toBe('keep');
  });

  it('arquivo ignorado que não se recria: fica', () => {
    expect(decideSessionWorktreeRelease(facts({ preciousIgnored: ['.env'] }))).toEqual({ action: 'keep', reason: 'tem arquivo ignorado que não se recria (.env)' });
  });

  it('a sessão do CLI ainda vive, ou a trava é de outro: fica', () => {
    expect(decideSessionWorktreeRelease(facts({ lock: { kind: 'claude-session', pid: 1, alive: true } })).action).toBe('keep');
    expect(decideSessionWorktreeRelease(facts({ lock: { kind: 'other', reason: 'meu' } })).action).toBe('keep');
  });

  it('submódulo: fica (o git recusaria)', () => {
    expect(decideSessionWorktreeRelease(facts({ hasSubmodules: true })).action).toBe('keep');
  });

  it('a branch do CLI com commit só dela não é apagada, mesmo removendo a worktree (HEAD em outra branch)', () => {
    expect(decideSessionWorktreeRelease(facts({ ownBranch: { name: 'worktree-radar', sha: 'abc', uniqueCommits: 1 } }))).toMatchObject({
      action: 'remove',
      deleteBranch: null,
    });
  });

  it('já não existe: nada; só o registro: prune', () => {
    expect(decideSessionWorktreeRelease(facts({ exists: false, registered: false }))).toEqual({ action: 'nothing' });
    expect(decideSessionWorktreeRelease(facts({ exists: false }))).toMatchObject({ action: 'prune' });
    expect(decideSessionWorktreeRelease(facts({ registered: false })).action).toBe('keep');
  });
});

describe('isDisposableIgnored', () => {
  it('saída regenerável e as permissões locais do CLI não são trabalho; o resto é', () => {
    expect(isDisposableIgnored('node_modules')).toBe(true);
    expect(isDisposableIgnored('out/')).toBe(true);
    expect(isDisposableIgnored('.claude/settings.local.json')).toBe(true);
    expect(isDisposableIgnored('.env')).toBe(false);
    expect(isDisposableIgnored('dados.sqlite')).toBe(false);
  });
});

describe('resolveMainRepoRootSync', () => {
  it('pai do git dir comum; fora de repo ou layout estranho: null', () => {
    expect(resolveMainRepoRootSync('C:\\w\\atlas\\sub', () => 'C:/w/atlas/.git')).toMatch(/[\\/]w[\\/]atlas$/);
    expect(resolveMainRepoRootSync('C:\\w', () => null)).toBeNull();
    expect(resolveMainRepoRootSync('C:\\w\\bare', () => 'C:/w/bare.git')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Repos de verdade
// ---------------------------------------------------------------------------

// git de verdade no Windows: cada caso leva segundos sob carga.
// Um único teste contra git real (decisão do dono, 03/11: testes enxutos). As regras de decisão estão
// cobertas acima, puras; aqui só se prova que a remoção de verdade nunca apaga trabalho.
describe('releaseSessionWorktree contra um repo git real', () => {
  it('remove a limpa; nunca apaga mudança, commit só dela nem o alvo da junção de node_modules', async () => {
    const sandbox: Sandbox = await createSandbox();
    try {
      const repo = await createRepo(sandbox, 'atlas');
      const deps: SessionWorktreeDeps = { git: createGitRunner(), isProcessAlive: () => false, sleep: async () => undefined, lockWaitMs: 500 };
      const cliWorktree = (name: string): string => {
        const path = join(repo, '.claude', 'worktrees', name);
        git(repo, 'worktree', 'add', '-q', '-b', `worktree-${name}`, path, 'HEAD');
        git(repo, 'worktree', 'lock', '--reason', `claude session ${name} (pid 999001)`, path);
        return path;
      };

      const limpa = cliWorktree('limpa');
      expect(await releaseSessionWorktree(deps, sessionWorktreeTarget(repo, 'limpa'))).toEqual({ kind: 'removed', branchDeleted: true });
      expect(await exists(limpa)).toBe(false);

      const suja = cliWorktree('suja');
      await write(join(suja, 'rascunho.md'), 'trabalho\n');
      expect((await releaseSessionWorktree(deps, sessionWorktreeTarget(repo, 'suja'))).kind).toBe('kept');
      expect(await exists(join(suja, 'rascunho.md'))).toBe(true);

      const commit = cliWorktree('commit');
      await write(join(commit, 'novo.txt'), 'x\n');
      commitAll(commit, 'feat: só aqui');
      expect((await releaseSessionWorktree(deps, sessionWorktreeTarget(repo, 'commit'))).kind).toBe('kept');
      expect(await exists(commit)).toBe(true);

      const juncao = cliWorktree('juncao');
      const target = join(sandbox.root, 'modulos-reais');
      await write(join(target, 'pacote', 'index.js'), 'module.exports = 1;\n');
      await fs.symlink(target, join(juncao, 'node_modules'), 'junction');
      expect((await releaseSessionWorktree(deps, sessionWorktreeTarget(repo, 'juncao'))).kind).toBe('removed');
      expect(await exists(join(target, 'pacote', 'index.js'))).toBe(true);
    } finally {
      await sandbox.cleanup();
    }
  }, 60_000);
});
