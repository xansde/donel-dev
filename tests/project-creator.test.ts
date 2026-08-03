import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNewProject, type CreateProjectDeps } from '../src/main/project-creator';

// CA-30 (009-modo-dev-v3, lote 9) — TDD do encanamento de disco: mkdir do
// diretório novo + marcador CLAUDE.md (garante o projeto na lista mesmo sem
// git) + `git init` best-effort (mesmo padrão de I/O de github-reader.ts:
// spawn mockado via vi.mock('node:child_process'), nunca lança). Deps
// injetadas em memória, mesmo espírito de tests/project-scanner.test.ts —
// nenhum mkdir/spawn real neste arquivo.

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

class FakeChildProcess extends EventEmitter {
  readonly kill = vi.fn();
  readonly stderr = new EventEmitter();
}

function fakeDeps(overrides: Partial<CreateProjectDeps> = {}): CreateProjectDeps {
  return {
    existsSync: () => false,
    mkdirSync: vi.fn(),
    writeClaudeMdSeed: vi.fn(),
    rmdirRecursive: vi.fn(),
    ...overrides,
  };
}

const ROOT = 'C:\\roots\\seazone';
const ALLOWED_ROOTS = [ROOT, 'C:\\roots\\pessoal'];

describe('createNewProject — validação (sem spawn)', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('rejeita nome vazio sem tocar disco', async () => {
    const deps = fakeDeps();
    const result = await createNewProject({ name: '   ', root: ROOT }, ALLOWED_ROOTS, deps);
    expect(result).toEqual({ ok: false, reason: 'empty' });
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('rejeita nome com caractere inválido sem tocar disco', async () => {
    const deps = fakeDeps();
    const result = await createNewProject({ name: 'a/b', root: ROOT }, ALLOWED_ROOTS, deps);
    expect(result).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('rejeita root fora da allowlist — nunca cria fora de um root configurado (segurança)', async () => {
    const deps = fakeDeps();
    const result = await createNewProject({ name: 'projeto-novo', root: 'C:\\qualquer\\lugar' }, ALLOWED_ROOTS, deps);
    expect(result).toEqual({ ok: false, reason: 'invalid-root' });
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('rejeita quando a pasta já existe — nunca sobrescreve', async () => {
    const target = join(ROOT, 'ja-existe');
    const deps = fakeDeps({ existsSync: (p) => p === target });
    const result = await createNewProject({ name: 'ja-existe', root: ROOT }, ALLOWED_ROOTS, deps);
    expect(result).toEqual({ ok: false, reason: 'already-exists' });
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('devolve mkdir-failed quando o mkdirSync lança (ex.: permissão negada)', async () => {
    const deps = fakeDeps({
      mkdirSync: () => {
        throw new Error('EPERM');
      },
    });
    const result = await createNewProject({ name: 'sem-permissao', root: ROOT }, ALLOWED_ROOTS, deps);
    expect(result).toEqual({ ok: false, reason: 'mkdir-failed' });
  });
});

describe('createNewProject — sucesso + git init best-effort (spawn mockado)', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('cria a pasta DENTRO do root (join), escreve o marcador CLAUDE.md e roda `git init` — sucesso', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const deps = fakeDeps();

    const promise = createNewProject({ name: 'projeto-novo', root: ROOT }, ALLOWED_ROOTS, deps);
    fake.emit('close', 0);
    const result = await promise;

    const expectedPath = join(ROOT, 'projeto-novo');
    expect(result).toEqual({ ok: true, path: expectedPath, name: 'projeto-novo', gitInitialized: true });
    expect(deps.mkdirSync).toHaveBeenCalledWith(expectedPath);
    expect(deps.writeClaudeMdSeed).toHaveBeenCalledWith(expectedPath, 'projeto-novo');

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe('git');
    expect(call[1]).toEqual(['init']);
    expect((call[2] as { cwd?: string }).cwd).toBe(expectedPath);
  });

  it('trima o nome antes de compor o path (o `join` usa o nome JÁ trimado)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const deps = fakeDeps();

    const promise = createNewProject({ name: '  projeto-novo  ', root: ROOT }, ALLOWED_ROOTS, deps);
    fake.emit('close', 0);
    const result = await promise;

    expect(result).toEqual({ ok: true, path: join(ROOT, 'projeto-novo'), name: 'projeto-novo', gitInitialized: true });
  });

  it('degrada por omissão quando `git` não está instalado — criação continua ok, gitInitialized: false', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const deps = fakeDeps();

    const result = await createNewProject({ name: 'sem-git', root: ROOT }, ALLOWED_ROOTS, deps);

    expect(result).toEqual({ ok: true, path: join(ROOT, 'sem-git'), name: 'sem-git', gitInitialized: false });
    // O marcador precisa ter sido escrito MESMO sem git — é ele que garante
    // que o projeto aparece na lista (scanProjects exige .git OU CLAUDE.md).
    expect(deps.writeClaudeMdSeed).toHaveBeenCalledWith(join(ROOT, 'sem-git'), 'sem-git');
  });

  it('degrada por omissão quando `git init` sai com código != 0', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const deps = fakeDeps();

    const promise = createNewProject({ name: 'git-falhou', root: ROOT }, ALLOWED_ROOTS, deps);
    fake.emit('close', 1);
    const result = await promise;

    expect(result).toEqual({ ok: true, path: join(ROOT, 'git-falhou'), name: 'git-falhou', gitInitialized: false });
  });

  it('degrada por omissão em timeout do `git init` (nunca trava o main process)', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValue(fake as never);
      const deps = fakeDeps();

      const promise = createNewProject({ name: 'git-trava', root: ROOT }, ALLOWED_ROOTS, deps);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result).toEqual({ ok: true, path: join(ROOT, 'git-trava'), name: 'git-trava', gitInitialized: false });
      expect(fake.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// FIX (#31) — "Clonar do GitHub" não clonava de verdade: era só um Select
// desabilitado com a nota "Ainda não implementado". TDD do modo `source:
// 'clone'`: ao contrário do `git init` do modo 'vazio' (best-effort, nunca
// derruba a criação), o `git clone` aqui É o encanamento principal — falhar
// precisa aparecer (mensagem legível, nunca degradar em silêncio) e nunca
// deixar a pasta pela metade (limpa o mkdir feito nesta operação se o clone
// falhar). Modo clone também NUNCA escreve o marcador CLAUDE.md nem roda
// `git init` — o clone já traz o `.git`.
describe('createNewProject — modo clone (spawn mockado)', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('rejeita source "clone" sem cloneUrl, sem tocar disco', async () => {
    const deps = fakeDeps();
    const result = await createNewProject({ name: 'projeto-clone', root: ROOT, source: 'clone' }, ALLOWED_ROOTS, deps);
    expect(result).toEqual({ ok: false, reason: 'clone-url-empty' });
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('rejeita cloneUrl só com espaços — mesmo tratamento de vazio', async () => {
    const deps = fakeDeps();
    const result = await createNewProject(
      { name: 'projeto-clone', root: ROOT, source: 'clone', cloneUrl: '   ' },
      ALLOWED_ROOTS,
      deps,
    );
    expect(result).toEqual({ ok: false, reason: 'clone-url-empty' });
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('clone com sucesso: mkdir + `git clone <url> .` na pasta, SEM marcador CLAUDE.md nem `git init`', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const deps = fakeDeps();

    const promise = createNewProject(
      { name: 'projeto-clone', root: ROOT, source: 'clone', cloneUrl: 'https://github.com/org/repo.git' },
      ALLOWED_ROOTS,
      deps,
    );
    fake.emit('close', 0);
    const result = await promise;

    const expectedPath = join(ROOT, 'projeto-clone');
    expect(result).toEqual({ ok: true, path: expectedPath, name: 'projeto-clone', gitInitialized: true });
    expect(deps.mkdirSync).toHaveBeenCalledWith(expectedPath);
    expect(deps.writeClaudeMdSeed).not.toHaveBeenCalled();

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe('git');
    expect(call[1]).toEqual(['clone', 'https://github.com/org/repo.git', '.']);
    expect((call[2] as { cwd?: string }).cwd).toBe(expectedPath);
    // só 1 chamada de spawn — nunca roda `git init` depois do clone.
    expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
  });

  it('clone falha (código != 0): devolve clone-failed com o stderr do git, e LIMPA a pasta criada', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const deps = fakeDeps();

    const promise = createNewProject(
      { name: 'projeto-clone', root: ROOT, source: 'clone', cloneUrl: 'https://github.com/org/nao-existe.git' },
      ALLOWED_ROOTS,
      deps,
    );
    fake.stderr.emit('data', Buffer.from('fatal: repository not found\n'));
    fake.emit('close', 128);
    const result = await promise;

    expect(result).toEqual({ ok: false, reason: 'clone-failed', message: 'fatal: repository not found' });
    expect(deps.rmdirRecursive).toHaveBeenCalledWith(join(ROOT, 'projeto-clone'));
  });

  it('clone falha E a limpeza também falha: a mensagem avisa que a pasta pode ter sobrado', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const deps = fakeDeps({
      rmdirRecursive: () => {
        throw new Error('EBUSY');
      },
    });

    const promise = createNewProject(
      { name: 'projeto-clone', root: ROOT, source: 'clone', cloneUrl: 'https://github.com/org/nao-existe.git' },
      ALLOWED_ROOTS,
      deps,
    );
    fake.stderr.emit('data', Buffer.from('fatal: authentication failed\n'));
    fake.emit('close', 128);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'clone-failed') {
      expect(result.message).toContain('fatal: authentication failed');
      expect(result.message).toContain(join(ROOT, 'projeto-clone'));
    } else {
      throw new Error('esperava clone-failed');
    }
  });

  it('`git` não instalado no modo clone: clone-failed com mensagem legível (nunca degrada em silêncio como o git init)', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    });
    const deps = fakeDeps();

    const result = await createNewProject(
      { name: 'projeto-clone', root: ROOT, source: 'clone', cloneUrl: 'https://github.com/org/repo.git' },
      ALLOWED_ROOTS,
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'clone-failed') {
      expect(result.message).toContain('git não está instalado');
    } else {
      throw new Error('esperava clone-failed');
    }
    expect(deps.rmdirRecursive).toHaveBeenCalledWith(join(ROOT, 'projeto-clone'));
  });

  it('timeout do clone (mais de 120s): mata o processo e devolve clone-failed', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValue(fake as never);
      const deps = fakeDeps();

      const promise = createNewProject(
        { name: 'projeto-clone', root: ROOT, source: 'clone', cloneUrl: 'https://github.com/org/repo-gigante.git' },
        ALLOWED_ROOTS,
        deps,
      );
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === 'clone-failed') {
        expect(result.message).toMatch(/demorou|timeout|120/i);
      } else {
        throw new Error('esperava clone-failed');
      }
      expect(fake.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('nome ainda é validado e o root ainda precisa estar na allowlist antes do clone', async () => {
    const deps = fakeDeps();
    const invalidName = await createNewProject(
      { name: 'a/b', root: ROOT, source: 'clone', cloneUrl: 'org/repo' },
      ALLOWED_ROOTS,
      deps,
    );
    expect(invalidName).toEqual({ ok: false, reason: 'invalid-chars' });

    const invalidRoot = await createNewProject(
      { name: 'projeto-clone', root: 'C:\\fora', source: 'clone', cloneUrl: 'org/repo' },
      ALLOWED_ROOTS,
      deps,
    );
    expect(invalidRoot).toEqual({ ok: false, reason: 'invalid-root' });
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });
});
