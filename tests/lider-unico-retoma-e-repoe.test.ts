import { describe, expect, it } from 'vitest';
import { AgentBridge, type AgentBridgePorts, type BridgeTab, type ResumePlaceOutcome, type ResumePlaceRequest } from '../src/renderer/src/Mindscape/agentBridge';
import { decideWhereLives } from '../src/main/remote-session';
import { parseBoardToolCall } from '../src/shared/mindscape/agent-tools';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation, type MindscapeDoc } from '../src/shared/mindscape/model';
import { isBoardOrchestrator } from '../src/shared/mindscape/reach';
import { FACTORY_ROLES, LEADER_ROLE_ID } from '../src/shared/roles';

// t-1293c818 (dono, 09/11: "não posso ter que precisar acessar sessões que não são a orquestradora") — the Líder único
// does by tool what only the owner's two clicks did: (1) resume a closed place, a Líder of a board included; (2) open or
// put back the Líder of a board without the owner drawing it, and that Líder counts as the board's. Nobody else makes a
// Líder: if a Dev could, it would liberate folders and reach other boards (PR #305), and the owner would not notice.

const ATLAS = '/proj/atlas';
const LIDER = 'place:lider'; // the owner's Líder of the board, closed
const DEV = 'place:dev'; // below the Líder, open
const NETO = 'place:neto'; // below the Dev, closed
const NOVO = 'place:novo'; // drawn, never started

function setup(resume?: (request: ResumePlaceRequest) => Promise<ResumePlaceOutcome>): { bridge: AgentBridge; doc: () => MindscapeDoc; renew: (place: string, conv: string) => void; tabs: BridgeTab[]; resumed: ResumePlaceRequest[]; opened: string[] } {
  let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: LIDER, roleId: LEADER_ROLE_ID });
  doc = addPlace(doc, ATLAS, { id: DEV, roleId: 'dev' });
  doc = addPlace(doc, ATLAS, { id: NETO, roleId: 'revisor', by: 'session' });
  doc = addPlace(doc, ATLAS, { id: NOVO, roleId: 'dev', by: 'session' });
  for (const [place, conv] of [[LIDER, 'conv-lider'], [DEV, 'conv-dev'], [NETO, 'conv-neto']] as const) doc = setPlaceConversation(doc, ATLAS, place, conv);
  doc = addLink(doc, ATLAS, { id: 'l1', from: LIDER, to: DEV, arrow: true });
  doc = addLink(doc, ATLAS, { id: 'l2', from: DEV, to: NETO, arrow: true, by: 'session', opened: true });
  const tabs: BridgeTab[] = [
    { id: 'tab-unico', name: 'Líder', cwd: '/proj', roleId: LEADER_ROLE_ID, leaderOfAll: true, sessionType: 'claude' },
    { id: 'tab-dev', name: 'Dev', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-dev', sessionType: 'claude' },
  ];
  const resumed: ResumePlaceRequest[] = [];
  const opened: string[] = [];
  const ports: AgentBridgePorts = {
    loaded: true,
    doc: () => doc,
    applyGesture: (_path, gesture) => {
      doc = gesture(doc);
    },
    tabs: () => tabs,
    tabOfPty: (ptyId) => tabs.find((tab) => tab.id === `tab-${ptyId}`),
    stateOf: (tabId) => (tabs.some((tab) => tab.id === tabId) ? 'waiting' : undefined),
    roles: () => FACTORY_ROLES,
    openSession: (request) => {
      opened.push(request.placeId);
      const id = `tab-${request.placeId.slice(6)}`;
      tabs.push({ id, name: request.name, cwd: request.projectPath, projectName: 'atlas', placeId: request.placeId, roleId: request.role.id, openedBy: request.openedBy, sessionType: 'claude' });
      return id;
    },
    // Like the app: the place's machine is known only after locating the conversation, then the guard; the tab shows
    // up in the list only on a later render.
    resumePlace: async (request) => {
      if (resume) return resume(request);
      const full = request.mayOpenOn(undefined);
      if (full) return { ok: false, reason: full };
      resumed.push(request);
      return { ok: true, tabId: `tab-resumed-${resumed.length}` };
    },
    closeTab: () => undefined,
    sendLine: () => undefined,
    deliverLine: async () => ({ kind: 'entrou' }),
    permissionOnScreen: () => false,
    unconfirmed: () => false,
    startTrouble: () => null,
    askOwner: async () => true,
    remoteLabel: (id) => id,
    remotes: () => [],
    projects: () => [{ path: ATLAS, name: 'atlas' }],
  };
  return { bridge: new AgentBridge(ports), doc: () => doc, renew: (place, conv) => (doc = setPlaceConversation(doc, ATLAS, place, conv)), tabs, resumed, opened };
}

describe('Líder único retoma uma sessão fechada (t-1293c818, item 1)', () => {
  it('the MCP server knows sessao_retomar', () => {
    expect(parseBoardToolCall('sessao_retomar', { quem: LIDER, quadro: 'atlas' })).toEqual({ ok: true, call: { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' } });
    expect(parseBoardToolCall('sessao_retomar', {})).toMatchObject({ ok: false });
  });

  it('resumes the closed Líder of a board and a closed place below it, with their conversation; starts one never started', async () => {
    const { bridge, resumed } = setup();
    expect(await bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' })).toMatchObject({ ok: true });
    expect(await bridge.handle('unico', { tool: 'sessao_retomar', quem: NETO, quadro: 'atlas' })).toMatchObject({ ok: true });
    expect(await bridge.handle('unico', { tool: 'sessao_retomar', quem: NOVO, quadro: 'atlas' })).toMatchObject({ ok: true });
    expect(resumed.map((request) => [request.placeId, request.sessionId])).toEqual([
      [LIDER, 'conv-lider'],
      [NETO, 'conv-neto'],
      [NOVO, undefined],
    ]);
    expect(resumed.every((request) => request.projectPath === ATLAS)).toBe(true);
  });

  it('an open place is not opened twice, and a session out of the hierarchy does not resume anyone', async () => {
    const { bridge, resumed } = setup();
    expect(await bridge.handle('unico', { tool: 'sessao_retomar', quem: DEV, quadro: 'atlas' })).toMatchObject({ ok: true, text: expect.stringContaining('já está aberta') });
    // The Dev reaches the Neto (its arrow) but not the Líder above it.
    expect(await bridge.handle('dev', { tool: 'sessao_retomar', quem: LIDER })).toMatchObject({ ok: false });
    expect(await bridge.handle('dev', { tool: 'sessao_retomar', quem: NETO })).toMatchObject({ ok: true });
    expect(resumed.map((request) => request.placeId)).toEqual([NETO]);
  });
});

describe('sessao_retomar de um lugar da VPS não abre no PC (t-e72ca49e)', () => {
  it('a conversation found nowhere never resolves to this computer; the bridge falls back to `previous`, else says why', async () => {
    // whereLives: not on this disk and the place answered "hasn't" → nowhere (before: `local`, an empty `claude -r` on the PC).
    const vps = [{ id: 'vps', label: 'VPS' }];
    expect(decideWhereLives(false, [{ id: 'vps', answer: 'hasnt' }], vps)).toEqual({ kind: 'nowhere', labels: ['VPS'] });
    expect(decideWhereLives(false, [{ id: 'vps', answer: 'has' }], vps)).toEqual({ kind: 'remote', remoteId: 'vps' });
    expect(decideWhereLives(true, [], [])).toEqual({ kind: 'local' });
    // The bridge: the Líder was renewed on the VPS; its current conversation is missing everywhere, the previous one
    // lives on the VPS → resumed there, with that conversation.
    const tried: Array<string | undefined> = [];
    const missing: ResumePlaceOutcome = { ok: false, reason: 'a conversa não está em lugar nenhum', missing: true };
    const found = setup(async (request) => {
      tried.push(request.sessionId);
      return request.sessionId === 'conv-lider' ? { ok: true, tabId: 'tab-x', remoteId: 'vps' } : missing;
    });
    found.renew(LIDER, 'conv-lider-nova');
    const answer = await found.bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' });
    expect(tried).toEqual(['conv-lider-nova', 'conv-lider']);
    expect(answer).toMatchObject({ ok: true, text: expect.stringContaining('"roda": "vps"') });
    // Nothing anywhere: a clear refusal, never "roda: este computador".
    const none = setup(async () => missing);
    none.renew(LIDER, 'conv-lider-nova');
    const refused = await none.bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' });
    expect(refused).toMatchObject({ ok: false, text: expect.stringContaining('não está em lugar nenhum') });
    expect(JSON.stringify(refused)).not.toContain('roda');
  });
});

describe('sessao_retomar sem rajada nem retomada dupla (Revisor do #376)', () => {
  it('a place just resumed counts as open before its tab shows up: no second `claude -r` on the same conversation', async () => {
    const { bridge, resumed } = setup();
    const [first, second] = await Promise.all([
      bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' }),
      bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' }),
    ]);
    const third = await bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' });
    expect([first.ok, second.ok, third.ok]).toEqual([true, true, true]);
    expect(resumed).toHaveLength(1);
  });

  it('respects the RAM brake of sessao_abrir: a full machine refuses, and a resume counts as an opening', async () => {
    const full = setup();
    full.bridge.setFullMachines({ pc: ['este computador: 300 MB livres'] });
    const refused = await full.bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' });
    expect(refused).toMatchObject({ ok: false, text: expect.stringContaining('300 MB livres') });
    expect(full.resumed).toHaveLength(0);

    const room = setup();
    room.bridge.setFullMachines({}, { pc: { sessions: 1, checkedAt: Date.now() } });
    expect(await room.bridge.handle('unico', { tool: 'sessao_retomar', quem: LIDER, quadro: 'atlas' })).toMatchObject({ ok: true });
    // The one room of the last read went to the resume: the next opening on this machine waits.
    expect(await room.bridge.handle('unico', { tool: 'sessao_retomar', quem: NETO, quadro: 'atlas' })).toMatchObject({ ok: false });
    expect(room.resumed).toHaveLength(1);
  });
});

describe('Líder único abre ou repõe o Líder de um quadro (t-1293c818, item 2)', () => {
  it('sessao_abrir with the Líder role, by the Líder único, makes the Líder of the board', async () => {
    const { bridge, doc, opened } = setup();
    const answer = await bridge.handle('unico', { tool: 'sessao_abrir', quadro: 'atlas', papel: LEADER_ROLE_ID, pedido: 'assuma o quadro' });
    expect(answer.ok, answer.text).toBe(true);
    const placeId = opened[0]!;
    expect(isBoardOrchestrator(doc().boards[ATLAS], placeId)).toBe(true);
    const whoAmI = await bridge.handle(placeId.slice(6), { tool: 'sessao_quem_sou' });
    expect(JSON.parse(whoAmI.text)).toMatchObject({ lugar: placeId, papel: LEADER_ROLE_ID, orquestrador: true });
  });

  it('a Líder place drawn by the Líder único with quadro_aplicar is the Líder of the board too', async () => {
    const { bridge, doc } = setup();
    const answer = await bridge.handle('unico', { tool: 'quadro_aplicar', quadro: 'atlas', ops: [{ op: 'lugar', id: '$lq', papel: LEADER_ROLE_ID }] });
    expect(answer.ok, answer.text).toBe(true);
    const placeId = (JSON.parse(answer.text) as { ids: Record<string, string> }).ids.$lq!;
    expect(isBoardOrchestrator(doc().boards[ATLAS], placeId)).toBe(true);
  });

  it('a Dev and the Líder of a board still cannot make a Líder, by either tool', async () => {
    const { bridge, doc, tabs } = setup();
    tabs.push({ id: 'tab-lider', name: 'Líder', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-lider', sessionType: 'claude' });
    const before = Object.keys(doc().boards[ATLAS]!.cards).length;
    for (const ptyId of ['dev', 'lider']) {
      expect((await bridge.handle(ptyId, { tool: 'sessao_abrir', papel: LEADER_ROLE_ID, pedido: 'seja Líder' })).ok, ptyId).toBe(false);
      expect((await bridge.handle(ptyId, { tool: 'quadro_aplicar', ops: [{ op: 'lugar', papel: LEADER_ROLE_ID }] })).ok, ptyId).toBe(false);
    }
    expect(Object.keys(doc().boards[ATLAS]!.cards)).toHaveLength(before);
  });
});
