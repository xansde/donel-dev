// "Isolar em worktree" — o que acontece com a worktree da sessão quando a aba fecha.
// 1) A decisão "pode remover?" é pura: fatos -> decisão, um caso por regra do dono.
// 2) Inspeção + remoção de verdade contra repos git TEMPORÁRIOS (os.tmpdir()), com a worktree montada como o CLI
//    monta (`.claude/worktrees/<nome>`, branch `worktree-<nome>`, trava `claude session <nome> (pid N)`).
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionWorktreeService } from '../src/main/session-worktree-service';
import {
  decideSessionWorktreeRelease,
  inspectSessionWorktree,
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
describe('releaseSessionWorktree contra um repo git real', { timeout: 60_000 }, () => {
  let sandbox: Sandbox;
  let repo: string;
  const alive = new Set<number>();
  const deps = (): SessionWorktreeDeps => ({ git: createGitRunner(), isProcessAlive: (pid) => alive.has(pid), sleep: async () => undefined, lockWaitMs: 500 });

  /** Monta a worktree como o CLI: pasta, branch `worktree-<nome>` a partir de HEAD e a trava com o pid. */
  function cliWorktree(name: string, pid = 999_001): string {
    const path = join(repo, '.claude', 'worktrees', name);
    git(repo, 'worktree', 'add', '-q', '-b', `worktree-${name}`, path, 'HEAD');
    git(repo, 'worktree', 'lock', '--reason', `claude session ${name} (pid ${pid})`, path);
    return path;
  }

  beforeEach(async () => {
    sandbox = await createSandbox();
    repo = await createRepo(sandbox, 'atlas');
    alive.clear();
  }, 60_000);

  afterEach(async () => {
    await sandbox.cleanup();
  }, 60_000);

  it('a raiz do repo sai certa de uma subpasta e de dentro da própria worktree', async () => {
    const path = cliWorktree('raiz');
    await fs.mkdir(join(repo, 'sub'), { recursive: true });
    const expected = (await fs.realpath(repo)).toLowerCase();
    expect((await fs.realpath(resolveMainRepoRootSync(join(repo, 'sub')) ?? '')).toLowerCase()).toBe(expected);
    expect((await fs.realpath(resolveMainRepoRootSync(path) ?? '')).toLowerCase()).toBe(expected);
    expect(resolveMainRepoRootSync(sandbox.root)).toBeNull();
  });

  it('limpa e sem commit novo: destrava, remove a pasta e apaga a branch do CLI', async () => {
    const path = cliWorktree('limpa');
    const outcome = await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'limpa'));
    expect(outcome).toEqual({ kind: 'removed', branchDeleted: true });
    expect(await exists(path)).toBe(false);
    expect(git(repo, 'branch', '--list', 'worktree-limpa')).toBe('');
    expect(git(repo, 'worktree', 'list')).not.toContain('limpa');
  });

  it('arquivo novo não commitado: nada é apagado', async () => {
    const path = cliWorktree('suja');
    await write(join(path, 'rascunho.md'), 'trabalho\n');
    const outcome = await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'suja'));
    expect(outcome).toEqual({ kind: 'kept', reason: 'tem mudança não commitada (rascunho.md)' });
    expect(await exists(join(path, 'rascunho.md'))).toBe(true);
    expect(git(repo, 'branch', '--list', 'worktree-suja')).toContain('worktree-suja');
  });

  it('commit que só existe na worktree: fica, com branch e tudo', async () => {
    const path = cliWorktree('commit');
    await write(join(path, 'novo.txt'), 'x\n');
    commitAll(path, 'feat: só aqui');
    const outcome = await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'commit'));
    expect(outcome).toEqual({ kind: 'kept', reason: 'tem 1 commit que não está em nenhum remoto nem em outra branch' });
    expect(await exists(path)).toBe(true);
  });

  it('commit já enviado ao remoto: sai, e a branch também', async () => {
    const path = cliWorktree('enviada');
    await write(join(path, 'novo.txt'), 'x\n');
    commitAll(path, 'feat: enviado');
    git(path, 'push', '-q', 'origin', 'worktree-enviada');
    const outcome = await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'enviada'));
    expect(outcome).toEqual({ kind: 'removed', branchDeleted: true });
    expect(await exists(path)).toBe(false);
  });

  it('commit já mergeado numa branch local (staging): sai', async () => {
    const path = cliWorktree('mergeada');
    await write(join(path, 'novo.txt'), 'x\n');
    commitAll(path, 'feat: mergeado');
    git(repo, 'merge', '-q', '--ff-only', 'worktree-mergeada');
    expect((await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'mergeada'))).kind).toBe('removed');
  });

  it('a sessão do CLI ainda está viva (pid vivo na trava): fica', async () => {
    alive.add(777);
    const path = cliWorktree('viva', 777);
    const outcome = await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'viva'));
    expect(outcome).toEqual({ kind: 'kept', reason: 'outra sessão do Claude ainda está usando a worktree' });
    expect(await exists(path)).toBe(true);
  });

  it('trava que não é do CLI: fica', async () => {
    const path = join(repo, '.claude', 'worktrees', 'minha');
    git(repo, 'worktree', 'add', '-q', '-b', 'worktree-minha', path, 'HEAD');
    git(repo, 'worktree', 'lock', '--reason', 'não mexa', path);
    expect((await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'minha'))).kind).toBe('kept');
  });

  it('.env (ignorado, não se recria): fica', async () => {
    const path = cliWorktree('env');
    await write(join(path, '.env'), 'SEGREDO=1\n');
    expect(await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'env'))).toEqual({ kind: 'kept', reason: 'tem arquivo ignorado que não se recria (.env)' });
  });

  it('junção de node_modules: desfeita como link antes de remover, e o alvo fica intacto', async () => {
    const path = cliWorktree('juncao');
    const target = join(sandbox.root, 'modulos-reais');
    await write(join(target, 'pacote', 'index.js'), 'module.exports = 1;\n');
    await fs.symlink(target, join(path, 'node_modules'), 'junction');
    const facts = await inspectSessionWorktree(deps(), sessionWorktreeTarget(repo, 'juncao'));
    expect(facts.preciousIgnored).toEqual([]);
    expect((await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'juncao'))).kind).toBe('removed');
    expect(await exists(path)).toBe(false);
    expect(await exists(join(target, 'pacote', 'index.js'))).toBe(true);
  });

  it('a pasta sumiu e só ficou o registro: prune e branch apagada', async () => {
    const path = cliWorktree('sumiu');
    git(repo, 'worktree', 'unlock', path);
    await fs.rm(path, { recursive: true, force: true });
    expect(await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'sumiu'))).toEqual({ kind: 'removed', branchDeleted: true });
    expect(git(repo, 'worktree', 'list')).not.toContain('sumiu');
  });

  it('o CLI já tinha removido: nada a fazer', async () => {
    expect(await releaseSessionWorktree(deps(), sessionWorktreeTarget(repo, 'nunca'))).toEqual({ kind: 'gone' });
  });

  describe('serviço (aba -> worktree)', () => {
    const service = (notify = vi.fn()) =>
      createSessionWorktreeService({ ...deps(), resolveRepoRoot: () => repo, notifyKept: notify, openPath: async () => '' });

    it('só libera quando o dono fechou a aba; com trabalho, avisa com o caminho e libera abrir a pasta', async () => {
      const notify = vi.fn();
      const svc = service(notify);
      const path = cliWorktree('aviso');
      await write(join(path, 'rascunho.md'), 'x\n');
      expect(svc.onSpawn('pty-1', repo, ['--model', 'fable', '--worktree', 'aviso'])?.path).toBe(path);
      expect(await svc.openFolder(path)).toBe(false); // ainda não avisada
      expect((await svc.onExit('pty-1', true))?.kind).toBe('kept');
      expect(notify).toHaveBeenCalledWith({ kind: 'kept', name: 'aviso', path, branch: 'worktree-aviso', reason: 'tem mudança não commitada (rascunho.md)' });
      expect(await svc.openFolder(path)).toBe(true);
      expect(await svc.openFolder(join(repo, 'outra'))).toBe(false);
    });

    it('o processo saiu sozinho (/exit): não mexe', async () => {
      const svc = service();
      const path = cliWorktree('sozinho');
      svc.onSpawn('pty-2', repo, ['--worktree', 'sozinho']);
      expect(await svc.onExit('pty-2', false)).toBeNull();
      expect(await exists(path)).toBe(true);
    });

    it('Reiniciar: outra aba já abriu a mesma worktree, a velha não remove', async () => {
      const svc = service();
      const path = cliWorktree('reinicio');
      svc.onSpawn('pty-velha', repo, ['--worktree', 'reinicio']);
      svc.onSpawn('pty-nova', repo, ['--worktree', 'reinicio']);
      expect(await svc.onExit('pty-velha', true)).toBeNull();
      expect(await exists(path)).toBe(true);
    });

    it('argv sem worktree, ou com nome inseguro: não registra', () => {
      const svc = service();
      expect(svc.onSpawn('pty-3', repo, ['--model', 'fable'])).toBeNull();
      expect(svc.onSpawn('pty-4', repo, ['--worktree', '../fora'])).toBeNull();
    });
  });
});
