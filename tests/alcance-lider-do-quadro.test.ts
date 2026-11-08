import { describe, expect, it } from 'vitest';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { addLink, addPlace, emptyMindscapeDoc, parseMindscapeDoc, setPlaceConversation, type MindscapeDoc } from '../src/shared/mindscape/model';
import { FACTORY_ROLES } from '../src/shared/roles';

// 08/11 — the Líder of a board directs every session of its board (close, send), even one the Líder único opened with
// no arrow to it; a common session still only reaches down its arrows. And two places talk both ways: Revisor → Dev
// next to Dev → Revisor, kept by an older channel that reads the file. If any of this breaks, a session is killed out
// of the hierarchy, or the board stalls waiting for the Líder único, and the owner only sees it when nothing moves.

const ATLAS = 'C:/proj/atlas';
const LIDER = 'place:lider';
const AVULSA = 'place:avulsa'; // opened by the Líder único: no arrow points to it
const DEV = 'place:dev';
const REVISOR = 'place:revisor';

function setup(): { bridge: AgentBridge; sent: { tabId: string; text: string }[]; closed: string[]; doc: () => MindscapeDoc } {
  let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: LIDER, roleId: 'lider' });
  doc = addPlace(doc, ATLAS, { id: AVULSA, roleId: 'dev', by: 'session' });
  doc = addPlace(doc, ATLAS, { id: DEV, roleId: 'dev', by: 'session' });
  doc = addPlace(doc, ATLAS, { id: REVISOR, roleId: 'revisor', by: 'session' });
  for (const place of [LIDER, AVULSA, DEV, REVISOR]) doc = setPlaceConversation(doc, ATLAS, place, `conv-${place.slice(6)}`);
  doc = addLink(doc, ATLAS, { id: 'l1', from: LIDER, to: DEV, arrow: true });
  doc = addLink(doc, ATLAS, { id: 'l2', from: DEV, to: REVISOR, arrow: true, by: 'session', opened: true });
  const sent: { tabId: string; text: string }[] = [];
  const closed: string[] = [];
  const tabs: BridgeTab[] = [LIDER, AVULSA, DEV, REVISOR].map((place) => ({
    id: `tab-${place.slice(6)}`,
    name: place.slice(6),
    cwd: ATLAS,
    projectName: 'atlas',
    claudeSessionId: `conv-${place.slice(6)}`,
    sessionType: 'claude' as const,
    ...(place === AVULSA ? { openedBy: 'lider' } : {}),
  }));
  const ports: AgentBridgePorts = {
    loaded: true,
    doc: () => doc,
    applyGesture: (_path, gesture) => {
      doc = gesture(doc);
    },
    tabs: () => tabs.filter((tab) => !closed.includes(tab.id)),
    tabOfPty: (ptyId) => tabs.find((tab) => tab.id === `tab-${ptyId}`),
    stateOf: (tabId) => (closed.includes(tabId) ? undefined : 'waiting'),
    roles: () => FACTORY_ROLES,
    openSession: () => 'tab-new',
    closeTab: (tabId) => closed.push(tabId),
    sendLine: (tabId, text) => sent.push({ tabId, text }),
    deliverLine: async (tabId, text) => {
      sent.push({ tabId, text });
      return { kind: 'entrou' };
    },
    permissionOnScreen: () => false,
    unconfirmed: () => false,
    startTrouble: () => null,
    askOwner: async () => true,
    remoteLabel: (id) => id,
    remotes: () => [],
    projects: () => [{ path: ATLAS, name: 'atlas' }],
  };
  return { bridge: new AgentBridge(ports), sent, closed, doc: () => doc };
}

describe('Líder do quadro alcança o próprio quadro', () => {
  it('sends to and closes a session the Líder único opened, with no arrow to it', async () => {
    const { bridge, sent, closed } = setup();

    expect(await bridge.handle('lider', { tool: 'sessao_enviar', para: AVULSA, texto: 'pare' })).toMatchObject({ ok: true });
    expect(sent.at(-1)).toMatchObject({ tabId: 'tab-avulsa' });

    expect(await bridge.handle('lider', { tool: 'sessao_fechar', quem: AVULSA })).toMatchObject({ ok: true });
    expect(closed).toEqual(['tab-avulsa']);
  });

  it('a common session still closes nothing out of its chain, nor the place above it', async () => {
    const { bridge, closed } = setup();

    expect((await bridge.handle('dev', { tool: 'sessao_fechar', quem: AVULSA })).ok).toBe(false);
    expect((await bridge.handle('revisor', { tool: 'sessao_fechar', quem: DEV })).ok).toBe(false);
    expect((await bridge.handle('dev', { tool: 'sessao_fechar', quem: LIDER })).ok).toBe(false);
    expect(closed).toEqual([]);
  });

  it('any session of the board talks up to its Líder with "lider-quadro", no arrow needed', async () => {
    const { bridge, sent } = setup();

    expect(await bridge.handle('avulsa', { tool: 'sessao_enviar', para: 'lider-quadro', texto: 'travei' })).toMatchObject({ ok: true });
    expect(sent.at(-1)).toMatchObject({ tabId: 'tab-lider' });
    expect(sent.at(-1)!.text).toContain('travei');
  });
});

describe('Ligação de ida e volta', () => {
  it('Revisor → Dev joins Dev → Revisor, both send, and an older channel reading the file keeps both', async () => {
    const { bridge, sent, doc } = setup();

    const linked = await bridge.handle('revisor', { tool: 'quadro_aplicar', ops: [{ op: 'ligacao', de: 'seu', para: DEV }] });
    expect(linked).toMatchObject({ ok: true });
    // The same direction twice is still refused.
    expect((await bridge.handle('revisor', { tool: 'quadro_aplicar', ops: [{ op: 'ligacao', de: 'seu', para: DEV }] })).ok).toBe(false);

    expect(await bridge.handle('dev', { tool: 'sessao_enviar', para: REVISOR, texto: 'pronto para revisar' })).toMatchObject({ ok: true });
    expect(sent.at(-1)).toMatchObject({ tabId: 'tab-revisor' });
    expect(await bridge.handle('revisor', { tool: 'sessao_enviar', para: DEV, texto: 'falta um teste' })).toMatchObject({ ok: true });
    expect(sent.at(-1)).toMatchObject({ tabId: 'tab-dev' });

    // The file format did not change (same link shape, schemaVersion untouched): a channel that reads and writes it back keeps both.
    const reread = parseMindscapeDoc(JSON.parse(JSON.stringify(doc())));
    const pair = reread.boards[ATLAS]!.links.filter((link) => [DEV, REVISOR].includes(link.from) && [DEV, REVISOR].includes(link.to));
    expect(pair.map((link) => `${link.from}>${link.to}`).sort()).toEqual([`${DEV}>${REVISOR}`, `${REVISOR}>${DEV}`]);
  });
});
