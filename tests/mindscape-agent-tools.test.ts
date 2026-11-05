import { describe, expect, it } from 'vitest';
import { applyBoardOps, boardTools, type BoardOpsContext } from '../src/shared/mindscape/agent-tools';
import { addLink, addOwnerCard, addPlace, editOwnerCard, emptyMindscapeDoc, parseMindscapeDoc, setBoardReach, type MindscapeDoc } from '../src/shared/mindscape/model';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';

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

  it('a seta de abertura (sessao_abrir) só sai pela mãe: outra sessão não tira o alcance dela', () => {
    let doc = addPlace(addPlace(addPlace(emptyMindscapeDoc(), P, { id: 'place:mae' }), P, { id: 'place:filha' }), P, { id: 'place:outra' });
    doc = addLink(doc, P, { id: 'aberta', from: 'place:mae', to: 'place:filha', by: 'session', opened: true });
    for (const self of ['place:outra', 'place:filha', undefined]) {
      const result = applyBoardOps(doc, P, [{ op: 'apagar', id: 'aberta' }], { ...ctx(), ...(self ? { selfPlaceId: self } : {}) });
      expect(result.ok, String(self)).toBe(false);
    }
    const byMother = applyBoardOps(doc, P, [{ op: 'apagar', id: 'aberta' }], { ...ctx(), selfPlaceId: 'place:mae' });
    expect(byMother.ok && byMother.doc.boards[P]!.links).toEqual([]);
  });
});

describe('sessao_fechar — a hierarquia', () => {
  // Kills a process: only a session below the caller (arrows on its board) or, across boards, only the
  // Líder of a board with reach "all". Never the caller itself.
  const Q = 'C:/proj/beacon';
  function setup(opts: { arrows: boolean; reach?: 'own' | 'all' }) {
    let doc = addPlace(addPlace(addPlace(emptyMindscapeDoc(), P, { id: 'place:lider', roleId: 'lider' }), P, { id: 'place:dev' }), P, { id: 'place:neto' });
    doc = addPlace(doc, Q, { id: 'place:outro' });
    if (opts.arrows) {
      doc = addLink(doc, P, { id: 'l1', from: 'place:lider', to: 'place:dev' });
      doc = addLink(doc, P, { id: 'l2', from: 'place:dev', to: 'place:neto' });
    }
    if (opts.reach) doc = setBoardReach(doc, P, opts.reach);
    const tabs: BridgeTab[] = [
      { id: 'tab-lider', name: 'Líder', cwd: P, placeId: 'place:lider', sessionType: 'claude' },
      { id: 'tab-dev', name: 'Dev', cwd: P, placeId: 'place:dev', sessionType: 'claude' },
      { id: 'tab-neto', name: 'Neto', cwd: P, placeId: 'place:neto', sessionType: 'claude' },
      { id: 'tab-outro', name: 'Outro', cwd: Q, placeId: 'place:outro', sessionType: 'claude' },
    ];
    const closed: string[] = [];
    const ports = {
      loaded: true,
      doc: () => doc,
      applyGesture: () => undefined,
      tabs: () => tabs,
      tabOfPty: (ptyId: string) => tabs.find((tab) => tab.id === ptyId),
      stateOf: (tabId: string) => (closed.includes(tabId) ? undefined : 'waiting'),
      roles: () => [],
      openSession: () => '',
      closeTab: (tabId: string) => closed.push(tabId),
      sendLine: () => undefined,
      permissionOnScreen: () => false,
      deliverLine: async () => ({ kind: 'entrou' as const }),
      unconfirmed: () => false,
      startTrouble: () => null,
      askOwner: async () => false,
      remoteLabel: (id: string) => id,
      remotes: () => [],
      projects: () => [],
    } as AgentBridgePorts;
    const bridge = new AgentBridge(ports);
    return {
      closed,
      doc: () => doc,
      setDoc: (next: MindscapeDoc) => { doc = next; },
      addTab: (tab: BridgeTab) => tabs.push(tab),
      close: (from: string, quem: string, quadro?: string) => bridge.handle(from, { tool: 'sessao_fechar', quem, ...(quadro ? { quadro } : {}) }),
    };
  }

  it('without hierarchy closes nothing, and never the own session', async () => {
    const flat = setup({ arrows: false });
    expect(await flat.close('tab-lider', 'place:dev')).toMatchObject({ ok: false });
    const tree = setup({ arrows: true });
    expect(await tree.close('tab-lider', 'place:lider')).toMatchObject({ ok: false });
    expect(await tree.close('tab-neto', 'place:dev')).toMatchObject({ ok: false }); // up the arrows
    expect([...flat.closed, ...tree.closed]).toEqual([]);
  });

  it('closes down the arrows, even down a chain', async () => {
    const tree = setup({ arrows: true });
    expect(await tree.close('tab-lider', 'place:neto')).toEqual({ ok: true, text: 'Fechada.' });
    expect(tree.closed).toEqual(['tab-neto']);
  });

  it('across boards: reach "own" refuses, reach "all" closes', async () => {
    const own = setup({ arrows: true, reach: 'own' });
    expect(await own.close('tab-lider', 'place:outro')).toMatchObject({ ok: false });
    expect(own.closed).toEqual([]);
    const all = setup({ arrows: true, reach: 'all' });
    expect(await all.close('tab-dev', 'place:outro')).toMatchObject({ ok: false }); // not the Líder
    expect(await all.close('tab-lider', 'place:outro')).toEqual({ ok: true, text: 'Fechada.' });
    expect(all.closed).toEqual(['tab-outro']);
  });

  it('an arrow a session draws itself never puts it above anyone; nor does a Líder a session made cross boards', async () => {
    const tree = setup({ arrows: true, reach: 'all' });
    const drawn = applyBoardOps(tree.doc(), P, [{ op: 'ligacao', de: 'place:neto', para: 'place:lider' }], { newId: () => 'l-up', now: 0, roleIds: new Set(), selfPlaceId: 'place:neto' });
    if (!drawn.ok) throw new Error(drawn.reason);
    const doc = drawn.doc;
    expect(doc.boards[P]!.links.some((link) => link.id === 'l-up')).toBe(true);
    tree.setDoc(addPlace(doc, P, { id: 'place:lider2', roleId: 'lider', by: 'session' }));
    tree.addTab({ id: 'tab-lider2', name: 'Líder 2', cwd: P, placeId: 'place:lider2', sessionType: 'claude' });
    expect(await tree.close('tab-neto', 'place:lider')).toMatchObject({ ok: false });
    expect(await tree.close('tab-lider2', 'place:outro')).toMatchObject({ ok: false });
    expect(tree.closed).toEqual([]);
    expect(parseMindscapeDoc(JSON.parse(JSON.stringify(addLink(tree.doc(), P, { id: 'l-open', from: 'place:lider', to: 'place:lider2', by: 'session', opened: true })))).boards[P]!.links.find((link) => link.id === 'l-open')?.opened).toBe(true);
  });

  // Líder único (ADR 0007) — owner: "o do Donel Dev deve ser capaz de fechar sessões em qualquer mindscape, mas o
  // Dalton, apenas dentro do seu próprio". Only the tab the Jobu marked is it; never a Líder by its role alone.
  it('the Líder único closes on any board without the "Alcance" mark; a Líder without the Jobu mark does not', async () => {
    const tree = setup({ arrows: true }); // no reach: 'all' anywhere
    tree.addTab({ id: 'tab-unico', name: 'Líder', cwd: 'C:/proj', roleId: 'lider', leaderOfAll: true, sessionType: 'claude' });
    tree.addTab({ id: 'tab-vps', name: 'Líder', cwd: 'C:/proj', roleId: 'lider', remoteId: 'vps', sessionType: 'claude' });
    expect(await tree.close('tab-vps', 'place:outro', 'beacon')).toMatchObject({ ok: false });
    expect(await tree.close('tab-unico', 'place:outro', 'beacon')).toEqual({ ok: true, text: 'Fechada.' }); // the top of another board
    expect(await tree.close('tab-unico', 'place:neto', 'atlas')).toEqual({ ok: true, text: 'Fechada.' }); // below the top, down a chain
    expect(tree.closed).toEqual(['tab-outro', 'tab-neto']);
  });

  it('an arrow a session draws neither hides a place from the Líder único nor puts anyone above it', async () => {
    const tree = setup({ arrows: false });
    tree.addTab({ id: 'tab-unico', name: 'Líder', cwd: 'C:/proj', roleId: 'lider', leaderOfAll: true, sessionType: 'claude' });
    // The dev draws an arrow to the neto: the neto stays at the top (reached), and the dev is not above it.
    const drawn = applyBoardOps(tree.doc(), P, [{ op: 'ligacao', de: 'place:dev', para: 'place:neto' }], { newId: () => 'l-drawn', now: 0, roleIds: new Set(), selfPlaceId: 'place:dev' });
    if (!drawn.ok) throw new Error(drawn.reason);
    tree.setDoc(drawn.doc);
    expect(await tree.close('tab-dev', 'place:neto')).toMatchObject({ ok: false });
    expect(await tree.close('tab-unico', 'place:neto', 'atlas')).toEqual({ ok: true, text: 'Fechada.' });
    expect(tree.closed).toEqual(['tab-neto']);
  });

  it('keeps the reach of a board through the disk guard', () => {
    const doc = setBoardReach(addPlace(emptyMindscapeDoc(), P, { id: 'place:lider' }), P, 'all');
    expect(parseMindscapeDoc(JSON.parse(JSON.stringify(doc))).boards[P]!.reach).toBe('all');
  });
});

// Limite de sessões abertas por um Líder (dono, 05/11: "Quero tirar o limite") — Preferências, padrão sem limite.
describe('limite de sessões abertas por um Líder', () => {
  function leader(openCap: number | null) {
    let doc = addPlace(emptyMindscapeDoc(), P, { id: 'place:lider' });
    const tabs: BridgeTab[] = [{ id: 'tab-lider', name: 'Líder', cwd: P, placeId: 'place:lider', sessionType: 'claude' }];
    let asked = 0;
    let opened = 0;
    const ports = {
      loaded: true,
      doc: () => doc,
      applyGesture: (_path: string, reducer: (current: MindscapeDoc) => MindscapeDoc) => {
        doc = reducer(doc);
      },
      tabs: () => tabs,
      tabOfPty: (ptyId: string) => tabs.find((tab) => tab.id === ptyId),
      stateOf: () => 'working' as const,
      roles: () => [{ id: 'dev', name: 'Dev', color: 'accent', guidance: '' }],
      openSession: () => `tab-aberta-${(opened += 1)}`,
      closeTab: () => undefined,
      sendLine: () => undefined,
      permissionOnScreen: () => false,
      deliverLine: async () => ({ kind: 'entrou' as const }),
      unconfirmed: () => false,
      startTrouble: () => null,
      openCap: () => openCap,
      askOwner: async () => {
        asked += 1;
        return true;
      },
      remoteLabel: (id: string) => id,
      remotes: () => [],
      projects: () => [],
    } as unknown as AgentBridgePorts;
    const bridge = new AgentBridge(ports);
    return {
      open: () => bridge.handle('tab-lider', { tool: 'sessao_abrir', papel: 'dev', pedido: 'faz a parte X' }),
      asked: () => asked,
      dispose: () => bridge.dispose(),
    };
  }

  it('sem limite, a 5ª abre sem pedir; com limite 2, a 3ª pede ao dono', async () => {
    const free = leader(null);
    for (let i = 0; i < 5; i += 1) expect(await free.open()).toMatchObject({ ok: true });
    expect(free.asked()).toBe(0);
    free.dispose();

    const two = leader(2);
    await two.open();
    await two.open();
    expect(two.asked()).toBe(0);
    expect(await two.open()).toMatchObject({ ok: true }); // the owner allowed it
    expect(two.asked()).toBe(1);
    two.dispose();

    // The tool tells the agent the cap the owner set.
    const text = (cap: number | null) => boardTools(cap).find((tool) => tool.name === 'sessao_abrir')!.description;
    expect(text(null)).toContain('Sem limite');
    expect(text(2)).toContain('Até 2 abertas');
    expect(text(2)).toContain('a partir da 3ª');
  });
});
