import { describe, expect, it } from 'vitest';
import { applyBoardOps, type BoardOpsContext } from '../src/shared/mindscape/agent-tools';
import { addOwnerCard, editOwnerCard, emptyMindscapeDoc, parseMindscapeDoc, type MindscapeDoc } from '../src/shared/mindscape/model';

// Quadro por MCP — a session builds the owner's persisted board. What must never happen without the owner
// noticing: a session touching what the owner made, a half-applied batch, or the session's mark lost on disk
// (the next session would then be refused its own items, or the owner's would look like the session's).

const P = 'C:/proj/atlas';

function ctx(): BoardOpsContext {
  let n = 0;
  return { newId: () => `id-${++n}`, now: 1000, roleIds: new Set(['dev']) };
}

function boardWithOwnerPostit(): MindscapeDoc {
  const doc = addOwnerCard(emptyMindscapeDoc(), P, { id: 'owner-1', createdAt: 1 });
  return editOwnerCard(doc, P, 'owner-1', 'do dono');
}

describe('quadro_aplicar — o que é do dono', () => {
  it('refuses moving, editing or removing the owner post-it, and applies nothing of the batch', () => {
    const doc = boardWithOwnerPostit();
    for (const op of [
      { op: 'mover', id: 'owner-1', x: 500, y: 500 },
      { op: 'editar', id: 'owner-1', texto: 'mudei' },
      { op: 'apagar', id: 'owner-1' },
    ] as const) {
      const result = applyBoardOps(doc, P, [{ op: 'postit', texto: 'novo' }, op], ctx());
      expect(result.ok).toBe(false);
    }
    expect(doc.boards[P]!.cards['owner-1']).toMatchObject({ text: 'do dono', x: expect.any(Number) });
    expect(Object.keys(doc.boards[P]!.cards)).toEqual(['owner-1']);
  });

  it('marks what the session made, keeps the mark through the disk guard, and lets the session remove only that', () => {
    const made = applyBoardOps(
      boardWithOwnerPostit(),
      P,
      [
        { op: 'lugar', id: '$dev', papel: 'dev', pedido: 'faça X' },
        { op: 'postit', id: '$nota', texto: 'plano' },
        { op: 'ligacao', de: '$nota', para: 'owner-1' },
        { op: 'retangulo', x: 0, y: 0, w: 100, h: 50 },
      ],
      ctx(),
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const reloaded = parseMindscapeDoc(JSON.parse(JSON.stringify(made.doc)));
    const board = reloaded.boards[P]!;
    expect(board.cards[made.ids.$dev!]).toMatchObject({ kind: 'session', roleId: 'dev', by: 'session' });
    expect(board.cards[made.ids.$nota!]).toMatchObject({ kind: 'owner', text: 'plano', by: 'session' });
    expect('by' in board.cards['owner-1']!).toBe(false);
    expect(board.drawings.every((drawing) => drawing.kind !== 'image' && drawing.by === 'session')).toBe(true);
    expect(board.links.every((link) => link.by === 'session')).toBe(true);

    const removed = applyBoardOps(reloaded, P, [{ op: 'apagar', id: made.ids.$nota! }], ctx());
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.doc.boards[P]!.cards[made.ids.$nota!]).toBeUndefined();
    expect(removed.doc.boards[P]!.cards['owner-1']).toBeDefined();
  });
});
