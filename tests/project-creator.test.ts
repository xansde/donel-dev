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
}

function fakeDeps(overrides: Partial<CreateProjectDeps> = {}): CreateProjectDeps {
  return {
    existsSync: () => false,
    mkdirSync: vi.fn(),
    writeClaudeMdSeed: vi.fn(),
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
