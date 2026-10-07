import { describe, expect, it, vi } from 'vitest';
import { archiveProfiles, type ArchiveIoDeps } from '../src/main/accounts/migration/archive-profiles';

// T1222 — profile-manager.ts morreu; mesma lista duplicada aqui de
// propósito (mesmo espírito dos smokes deste repo).
const PROFILE_LINK_DIRS = ['projects', 'skills', 'commands', 'rules', 'plugins', 'templates'] as const;

// T1212 (011-contas-e-provedores, etapa 2) — archive-profiles.ts: ordem
// invariante (C27/D12): TODO unlink de junction acontece ANTES do rename. O
// dublê de IO nem expõe método de deleção (D13) — nada aqui pode apagar.

function makeDeps(overrides: Partial<ArchiveIoDeps> = {}): ArchiveIoDeps & { paths: { homedir: string } } {
  return {
    unlinkJunction: vi.fn(),
    rename: vi.fn(),
    exists: () => true,
    isJunction: () => true,
    paths: { homedir: 'C:\\fake-home' },
    ...overrides,
  };
}

describe('archiveProfiles — ordem invariante e sem deleção', () => {
  it('todo unlink de junction acontece ANTES do rename (asserção sobre a ordem das chamadas)', () => {
    const calls: string[] = [];
    const deps = makeDeps({
      unlinkJunction: vi.fn((path: string) => calls.push(`unlink:${path}`)),
      rename: vi.fn((from: string, to: string) => calls.push(`rename:${from}->${to}`)),
    });

    const result = archiveProfiles({ ...deps, profileSlugs: ['acc-1', 'acc-2'] }, new Date('2026-08-04'));

    expect(result.kind).toBe('archived');
    const renameIndex = calls.findIndex((c) => c.startsWith('rename:'));
    expect(renameIndex).toBeGreaterThan(-1);
    for (let i = 0; i < renameIndex; i++) {
      expect(calls[i]).toMatch(/^unlink:/);
    }
    // 2 perfis × 6 junctions (PROFILE_LINK_DIRS) = 12 unlinks antes do rename.
    expect(calls.filter((c) => c.startsWith('unlink:'))).toHaveLength(2 * PROFILE_LINK_DIRS.length);
  });

  it('falha de unlink ⇒ aborted nomeando o perfil, SEM rename', () => {
    const rename = vi.fn();
    const deps = makeDeps({
      unlinkJunction: vi.fn((path: string) => {
        if (path.includes('acc-2')) throw new Error('unlink failed');
      }),
      rename,
    });

    const result = archiveProfiles({ ...deps, profileSlugs: ['acc-1', 'acc-2'] }, new Date('2026-08-04'));

    expect(result).toEqual({ kind: 'aborted', reason: 'junction-unlink-failed', profileSlug: 'acc-2' });
    expect(rename).not.toHaveBeenCalled();
  });

  it('.old já existente ⇒ sufixo de data', () => {
    const rename = vi.fn();
    const deps = makeDeps({
      rename,
      exists: (path: string) => path.endsWith('.claude-profiles') || path.endsWith('.claude-profiles.old'),
    });

    const now = new Date(2026, 7, 4); // mês 0-based: agosto (local time, evita off-by-one de fuso)
    const result = archiveProfiles({ ...deps, profileSlugs: ['acc-1'] }, now);

    expect(result.kind).toBe('archived');
    if (result.kind !== 'archived') throw new Error('expected archived');
    expect(result.archivedTo).toContain('.old-20260804');
    expect(rename).toHaveBeenCalledWith(expect.stringContaining('.claude-profiles'), expect.stringContaining('.old-20260804'));
  });

  it('raiz ausente ⇒ nothing-to-archive', () => {
    const rename = vi.fn();
    const unlinkJunction = vi.fn();
    const deps = makeDeps({ rename, unlinkJunction, exists: () => false });

    const result = archiveProfiles({ ...deps, profileSlugs: [] }, new Date('2026-08-04'));

    expect(result).toEqual({ kind: 'nothing-to-archive' });
    expect(rename).not.toHaveBeenCalled();
    expect(unlinkJunction).not.toHaveBeenCalled();
  });

  it('o dublê de IO não expõe método de deleção e nenhum é chamado', () => {
    const deps = makeDeps();
    // Contrato: ArchiveIoDeps não tem `remove`/`rm`/`unlink` genérico — só `unlinkJunction` (que nunca remove o alvo) e `rename`.
    expect((deps as unknown as Record<string, unknown>)['remove']).toBeUndefined();
    expect((deps as unknown as Record<string, unknown>)['rm']).toBeUndefined();
    expect((deps as unknown as Record<string, unknown>)['removeDirRecursive']).toBeUndefined();

    archiveProfiles({ ...deps, profileSlugs: ['acc-1'] }, new Date('2026-08-04'));
    // unlinkJunction é chamado (desfaz o link), mas nada de remoção recursiva existe pra ser chamado.
    expect(deps.unlinkJunction).toHaveBeenCalled();
  });
});
