import { describe, expect, it } from 'vitest';
import { findResourceLock, resourceConflicts } from '../src/shared/esteira/store/lockChain';
import type { LockRecord, LockResource } from '../src/shared/esteira/store/storeFormat';

// A8/A20 — a trava por RECURSO DE ESCRITA. Alcance diferente de
// `findBlockingLock`/`lockChainOf` (que olham o assunto): aqui o que importa
// é o repo + o caminho FÍSICO que o run toca, atravessando assuntos irmãos —
// P32: "worker rodou na árvore principal enquanto outra sessão comitava nela".

function lock(overrides: Partial<LockRecord> = {}): LockRecord {
  return {
    subject: { entity: 'work_item', id: 'wi-1' },
    phase: 'implementar',
    holderKind: 'app',
    acquiredAt: '2026-08-05T10:00:00.000Z',
    cliSessionId: null,
    mirroredLabel: null,
    resource: { targetRepo: 'atlas', branch: null, treePath: null },
    ...overrides,
  };
}

describe('resourceConflicts', () => {
  it('repos diferentes nunca conflitam', () => {
    const a: LockResource = { targetRepo: 'atlas', branch: null, treePath: null };
    const b: LockResource = { targetRepo: 'beacon', branch: null, treePath: null };
    expect(resourceConflicts(a, b)).toBe(false);
  });

  it('mesmo repo, os DOIS lados sem caminho conhecido: conflita — a árvore principal é o default mais arriscado (A20)', () => {
    const a: LockResource = { targetRepo: 'atlas', branch: null, treePath: null };
    const b: LockResource = { targetRepo: 'atlas', branch: null, treePath: null };
    expect(resourceConflicts(a, b)).toBe(true);
  });

  it('mesmo repo, só UM lado com caminho conhecido: ainda conflita — caminho desconhecido não prova isolamento', () => {
    const a: LockResource = { targetRepo: 'atlas', branch: null, treePath: 'C:/dev/atlas-wt/wi-1' };
    const b: LockResource = { targetRepo: 'atlas', branch: null, treePath: null };
    expect(resourceConflicts(a, b)).toBe(true);
    expect(resourceConflicts(b, a)).toBe(true);
  });

  it('mesmo repo, DOIS caminhos conhecidos e DIFERENTES: não conflita — worktrees isoladas provam paralelismo seguro (D-5/D-7)', () => {
    const a: LockResource = { targetRepo: 'atlas', branch: 'feat/wi-1', treePath: 'C:/dev/atlas-wt/wi-1' };
    const b: LockResource = { targetRepo: 'atlas', branch: 'feat/wi-2', treePath: 'C:/dev/atlas-wt/wi-2' };
    expect(resourceConflicts(a, b)).toBe(false);
  });

  it('mesmo repo, MESMO caminho conhecido: conflita, mesmo com branches "diferentes" — é o mesmo diretório físico', () => {
    const a: LockResource = { targetRepo: 'atlas', branch: 'feat/x', treePath: 'C:/dev/atlas' };
    const b: LockResource = { targetRepo: 'atlas', branch: 'feat/y', treePath: 'C:/dev/atlas' };
    expect(resourceConflicts(a, b)).toBe(true);
  });

  it('branch por si só NUNCA decide: dois caminhos iguais com branch null conflitam do mesmo jeito', () => {
    const a: LockResource = { targetRepo: 'atlas', branch: null, treePath: 'C:/dev/atlas' };
    const b: LockResource = { targetRepo: 'atlas', branch: null, treePath: 'C:/dev/atlas' };
    expect(resourceConflicts(a, b)).toBe(true);
  });
});

describe('findResourceLock', () => {
  it('nenhuma trava de recurso: devolve null', () => {
    expect(findResourceLock([], { targetRepo: 'atlas', branch: null, treePath: null })).toBeNull();
  });

  it('trava sem `resource` (fase sem workspace) nunca bloqueia por recurso', () => {
    const locks = [lock({ resource: null })];
    expect(findResourceLock(locks, { targetRepo: 'atlas', branch: null, treePath: null })).toBeNull();
  });

  it('acha a trava que conflita, atravessando assuntos IRMÃOS — o item que pede é diferente do que segura', () => {
    const holder = lock({ subject: { entity: 'work_item', id: 'wi-1' }, resource: { targetRepo: 'atlas', branch: null, treePath: null } });
    const found = findResourceLock([holder], { targetRepo: 'atlas', branch: null, treePath: null });
    expect(found).toBe(holder);
  });

  it('não acha nada quando o pedido declara uma worktree isolada e distinta', () => {
    const holder = lock({ resource: { targetRepo: 'atlas', branch: 'feat/wi-1', treePath: 'C:/dev/atlas-wt/wi-1' } });
    const found = findResourceLock([holder], { targetRepo: 'atlas', branch: 'feat/wi-2', treePath: 'C:/dev/atlas-wt/wi-2' });
    expect(found).toBeNull();
  });
});
