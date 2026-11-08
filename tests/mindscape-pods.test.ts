import { describe, expect, it } from 'vitest';
import { addPod, movePod, parseMindscapeDoc, removePod, setChairPod, updatePod, MINDSCAPE_SCHEMA_VERSION, type MindscapeDoc } from '../src/shared/mindscape/model';

// Cadeiras, fatia 4 (dono, 07/11: cadeira = papel no quadro; o pod arruma as próprias cadeiras) — pods are stored on
// the board, so `mindscape.json` goes to v6. A v5 file must come up whole; a v6 file must read back the same; a bad pod
// is dropped alone; a role (a chair) sits in one pod at most.

const path = 'C:/projetos/atlas';
const v5 = {
  schemaVersion: 5,
  boards: {
    [path]: {
      projectPath: path,
      pan: { x: 10, y: 20 },
      zoom: 0.8,
      reach: 'all',
      cards: {
        'place:a': { kind: 'session', id: 'place:a', sessionId: 's1', previous: [], roleId: 'dev', x: 1, y: 2 },
        'owner-1': { kind: 'owner', id: 'owner-1', text: 'Regras', color: 'accent', createdAt: 5, x: 3, y: 4 },
      },
      links: [{ id: 'l1', from: 'place:a', to: 'owner-1', arrow: true }],
      drawings: [{ kind: 'rect', id: 'r1', color: 'none', stroke: 'medium', x: 0, y: 0, w: 10, h: 10 }],
    },
  },
};

describe('mindscape.json v6 — pods', () => {
  it('a v5 file comes up as v6 with every card, link, drawing, view and reach, and no pod', () => {
    const doc = parseMindscapeDoc(v5);
    expect(MINDSCAPE_SCHEMA_VERSION).toBe(6);
    expect(doc.schemaVersion).toBe(6);
    const board = doc.boards[path]!;
    expect(Object.keys(board.cards)).toEqual(['place:a', 'owner-1']);
    expect(board.links).toHaveLength(1);
    expect(board.drawings).toHaveLength(1);
    expect(board.pan).toEqual({ x: 10, y: 20 });
    expect(board.reach).toBe('all');
    expect(board.pods).toBeUndefined();
  });

  it('pods made by the owner read back the same after a write', () => {
    let doc = parseMindscapeDoc(v5);
    doc = addPod(doc, path, { id: 'pod-entrega', name: 'Entrega', x: 40, y: 60 });
    doc = updatePod(doc, path, 'pod-entrega', { mission: 'A mudança pedida, do começo ao fim.' });
    doc = setChairPod(doc, path, 'dev', 'pod-entrega');
    doc = setChairPod(doc, path, 'revisor', 'pod-entrega');
    const again = parseMindscapeDoc(JSON.parse(JSON.stringify(doc)));
    expect(again).toEqual(doc);
    expect(again.boards[path]!.pods).toEqual([{ id: 'pod-entrega', name: 'Entrega', mission: 'A mudança pedida, do começo ao fim.', roleIds: ['dev', 'revisor'], x: 40, y: 60 }]);
  });

  it('a bad pod is dropped alone, and a role in two pods stays only in the first', () => {
    const raw = structuredClone(v5) as Record<string, any>;
    raw.schemaVersion = 6;
    raw.boards[path].pods = [
      { id: 'p1', name: 'Comando', roleIds: ['lider', 'dev', 'Not A Role'], x: 0, y: 0 },
      { id: 'p2', name: 'Entrega', roleIds: ['dev', 'revisor'], x: 300, y: 0 },
      { id: 'p1', name: 'Duplicado', roleIds: [], x: 0, y: 0 },
      { id: 'p3', name: '', roleIds: [], x: 0, y: 0 },
      { id: 'p4', name: 'Sem posição', roleIds: [] },
      'lixo',
    ];
    const pods = parseMindscapeDoc(raw).boards[path]!.pods!;
    expect(pods.map((pod) => pod.id)).toEqual(['p1', 'p2']);
    expect(pods[0]!.roleIds).toEqual(['lider', 'dev']);
    expect(pods[1]!.roleIds).toEqual(['revisor']);
  });

  it('a chair moves between pods, leaves when its pod is removed, and nothing changed keeps the same document', () => {
    let doc: MindscapeDoc = parseMindscapeDoc(v5);
    doc = addPod(doc, path, { id: 'p1', name: 'Comando', x: 0, y: 0 });
    doc = addPod(doc, path, { id: 'p2', name: 'Entrega', x: 400, y: 0 });
    doc = setChairPod(doc, path, 'dev', 'p1');
    doc = setChairPod(doc, path, 'dev', 'p2');
    expect(doc.boards[path]!.pods!.map((pod) => pod.roleIds)).toEqual([[], ['dev']]);
    expect(setChairPod(doc, path, 'dev', 'p2')).toBe(doc);
    expect(movePod(doc, path, 'p2', 400, 0)).toBe(doc);
    doc = movePod(doc, path, 'p2', 420.4, 10.04);
    expect(doc.boards[path]!.pods![1]).toMatchObject({ x: 420.4, y: 10 });
    doc = removePod(doc, path, 'p2');
    expect(doc.boards[path]!.pods!.map((pod) => pod.id)).toEqual(['p1']);
    expect(doc.boards[path]!.pods!.some((pod) => pod.roleIds.includes('dev'))).toBe(false);
    expect(Object.keys(doc.boards[path]!.cards)).toEqual(['place:a', 'owner-1']);
  });
});
