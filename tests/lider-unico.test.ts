import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBridge, PASS_ON_GRACE_MS, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import type { LedgerPassOnRequest } from '../src/shared/ledger/channels';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation, type MindscapeDoc } from '../src/shared/mindscape/model';
import { FACTORY_ROLES, leaderOfAllPromptText, LEADER_ROLE_ID, rolePromptText } from '../src/shared/roles';

// Líder único (ADR 0007) — a message from the Líder to another board, and the "terminou" of that board back to the
// Líder, must arrive: if either is lost, the team stalls and the owner only notices when nothing happens.

const HOMOL = 'C:/proj/beacon';
const OLD_LEADER = 'place:old-leader';
const DALTON = 'place:dalton';

/** The Homologação of 04/11: the former Líder of the board (placed by the owner) points to the Dalton. */
function boardWithFormerLeader(): MindscapeDoc {
  let doc = addPlace(emptyMindscapeDoc(), HOMOL, { id: OLD_LEADER, roleId: 'lider' });
  doc = addPlace(doc, HOMOL, { id: DALTON, roleId: 'dev' });
  doc = setPlaceConversation(doc, HOMOL, DALTON, 'conv-dalton');
  return addLink(doc, HOMOL, { id: 'l1', from: OLD_LEADER, to: DALTON, arrow: true });
}

function setup(): { bridge: AgentBridge; sent: { tabId: string; text: string }[] } {
  const sent: { tabId: string; text: string }[] = [];
  const tabs: BridgeTab[] = [
    { id: 'tab-lider', name: 'Líder', cwd: 'C:/proj', roleId: 'lider', leaderOfAll: true, sessionType: 'claude' },
    { id: 'tab-dalton', name: 'Dalton', cwd: HOMOL, projectName: 'beacon', claudeSessionId: 'conv-dalton', sessionType: 'claude' },
  ];
  const doc = boardWithFormerLeader();
  const ports: AgentBridgePorts = {
    loaded: true,
    doc: () => doc,
    applyGesture: () => undefined,
    tabs: () => tabs,
    tabOfPty: (ptyId) => tabs.find((tab) => tab.id === `tab-${ptyId}`),
    stateOf: () => 'waiting',
    roles: () => FACTORY_ROLES,
    openSession: () => 'tab-new',
    closeTab: () => undefined,
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
    projects: () => [{ path: HOMOL, name: 'beacon' }],
    // The old mode (08/11, Preferências): these cases are about the "◆ … terminou" and the passage notice in the chat.
    turnNotices: () => 'chat',
  };
  return { bridge: new AgentBridge(ports), sent };
}

describe('Líder único', () => {
  it('sends to a place below the top of another board and hears when it ends its turn', async () => {
    const { bridge, sent } = setup();

    const answer = await bridge.handle('lider', { tool: 'sessao_enviar', quadro: 'beacon', para: DALTON, texto: 'confere o app' });
    expect(answer).toMatchObject({ ok: true });
    expect(sent).toEqual([{ tabId: 'tab-dalton', text: '◆ De Líder (lider): confere o app' }]);

    bridge.turnEnded('conv-dalton', 'conferi');
    expect(sent[1]).toMatchObject({ tabId: 'tab-lider' });
    expect(sent[1]!.text).toContain('quadro beacon');
    expect(sent[1]!.text).toContain('conferi');

    // Every other session stays on its own board.
    const across = await bridge.handle('dalton', { tool: 'sessao_enviar', quadro: 'outro', para: OLD_LEADER, texto: 'oi' });
    expect(across.ok).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it('only the tab with the Jobu mark reads "Líder único"; a Líder of a board reads the board guidance', () => {
    const lider = FACTORY_ROLES.find((role) => role.id === LEADER_ROLE_ID)!;
    expect(rolePromptText(lider)).not.toContain('Você é o Líder único');
    expect(leaderOfAllPromptText(lider)).toContain('Você é o Líder único');
    expect(leaderOfAllPromptText({ ...lider, guidance: 'Fale curto.' })).toContain('Fale curto.');
  });
});

// t-52b31719 / t-e753b554 — a session the Líder único opened must reach it (or it stalls waiting), and a place that
// closes must pass its tasks on (or they stay orphan). Board: the Líder único opened the Theo; the Theo opened the Dev;
// the Outro was drawn by the owner, out of that chain.
const ATLAS = 'C:/proj/atlas';
const THEO = 'place:theo';
const DEV = 'place:dev';
const OUTRO = 'place:outro';

/** The Líder of the board the Líder único opened (a place made by a session), as on 09/11. */
const LQ = 'place:lq';

function team(options: { readonly boardLeader?: boolean; readonly muteLeader?: boolean } = {}): { bridge: AgentBridge; sent: { tabId: string; text: string }[]; tabs: BridgeTab[]; passOns: LedgerPassOnRequest[][]; exited: Set<string>; permission: Set<string> } {
  let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: THEO, roleId: 'dev', by: 'session' });
  if (options.boardLeader) doc = setPlaceConversation(addPlace(doc, ATLAS, { id: LQ, roleId: 'lider', by: 'session' }), ATLAS, LQ, 'conv-lq');
  doc = addPlace(doc, ATLAS, { id: DEV, roleId: 'dev', by: 'session' });
  doc = addPlace(doc, ATLAS, { id: OUTRO, roleId: 'dev' });
  for (const [place, conv] of [[THEO, 'conv-theo'], [DEV, 'conv-dev'], [OUTRO, 'conv-outro']] as const) doc = setPlaceConversation(doc, ATLAS, place, conv);
  doc = addLink(doc, ATLAS, { id: 'l1', from: THEO, to: DEV, arrow: true, by: 'session', opened: true });
  const sent: { tabId: string; text: string }[] = [];
  const passOns: LedgerPassOnRequest[][] = [];
  /** Tabs whose CLI process exited: still on screen, no state (App's `tabExits`). */
  const exited = new Set<string>();
  /** Tabs with a permission open on their screen. */
  const permission = new Set<string>();
  const tabs: BridgeTab[] = [
    { id: 'tab-lider', name: 'Líder', cwd: 'C:/proj', roleId: 'lider', leaderOfAll: true, sessionType: 'claude' },
    { id: 'tab-theo', name: 'Theo', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-theo', openedBy: 'lider', sessionType: 'claude' },
    { id: 'tab-dev', name: 'Dev', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-dev', openedBy: THEO, sessionType: 'claude' },
    { id: 'tab-outro', name: 'Outro', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-outro', sessionType: 'claude' },
    ...(options.boardLeader ? [{ id: 'tab-lq', name: 'Líder', cwd: ATLAS, projectName: 'atlas', roleId: 'lider', claudeSessionId: 'conv-lq', openedBy: 'lider', sessionType: 'claude' as const }] : []),
  ];
  const ports: AgentBridgePorts = {
    loaded: true,
    doc: () => doc,
    applyGesture: () => undefined,
    tabs: () => tabs,
    tabOfPty: (ptyId) => tabs.find((tab) => tab.id === `tab-${ptyId}`),
    stateOf: (tabId) => (tabs.some((tab) => tab.id === tabId) && !exited.has(tabId) ? (permission.has(tabId) ? 'permission' : 'waiting') : undefined),
    roles: () => FACTORY_ROLES,
    openSession: () => 'tab-new',
    closeTab: () => undefined,
    sendLine: (tabId, text) => sent.push({ tabId, text }),
    deliverLine: async (tabId, text) => {
      sent.push({ tabId, text });
      return { kind: 'entrou' };
    },
    permissionOnScreen: () => false,
    unconfirmed: (tabId) => options.muteLeader === true && tabId === 'tab-lq',
    startTrouble: () => null,
    askOwner: async () => true,
    remoteLabel: (id) => id,
    remotes: () => [],
    projects: () => [{ path: ATLAS, name: 'atlas' }],
    turnNotices: () => 'chat',
    passOn: async (requests) => {
      passOns.push([...requests]);
      return requests.map((request) => ({ ...request, tasks: [{ id: `t-${request.placeId.slice(6)}`, title: 'Corrige o envio' }] }));
    },
  };
  return { bridge: new AgentBridge(ports), sent, tabs, passOns, exited, permission };
}

/** Closes a tab the way the app does: the bridge hears it first, then it leaves the list. */
function close(tabs: BridgeTab[], bridge: AgentBridge, tabId: string): void {
  bridge.placeClosed(tabId);
  tabs.splice(tabs.findIndex((tab) => tab.id === tabId), 1);
}

describe('Líder único recebe e lugar fechado passa adiante', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a session the Líder único opened, or one below it, sends to "lider"; one out of that chain is refused', async () => {
    const { bridge, sent } = team();
    expect(await bridge.handle('theo', { tool: 'sessao_enviar', para: 'lider', texto: 'terminei a parte 1', motivo: 'tarefa-completa' })).toMatchObject({ ok: true });
    expect(await bridge.handle('dev', { tool: 'sessao_enviar', para: 'lider', texto: 'travei no build', motivo: 'bloqueio' })).toMatchObject({ ok: true });
    expect(sent).toEqual([
      { tabId: 'tab-lider', text: `◆ De Dev (${THEO}), quadro atlas, tarefa completa: terminei a parte 1` },
      { tabId: 'tab-lider', text: `◆ De Dev (${DEV}), quadro atlas, bloqueio: travei no build` },
    ]);
    // Dono, 09/11: to the Líder único only a finished task or a lock; progress stays in the ledger. The tool refuses
    // the rest, by "lider" or by "quem-me-abriu" when the Líder único is the opener.
    const chatter = await bridge.handle('theo', { tool: 'sessao_enviar', para: 'lider', texto: 'rodando o verify agora' });
    expect(chatter).toMatchObject({ ok: false, text: expect.stringContaining('tarefa_andamento') });
    const viaOpener = await bridge.handle('theo', { tool: 'sessao_enviar', para: 'quem-me-abriu', texto: 'li o código' });
    expect(viaOpener).toMatchObject({ ok: false, text: expect.stringContaining('tarefa_andamento') });
    expect(sent).toHaveLength(2);
    const refused = await bridge.handle('outro', { tool: 'sessao_enviar', para: 'lider', texto: 'oi', motivo: 'bloqueio' });
    expect(refused).toMatchObject({ ok: false, text: expect.stringContaining('Sem ligação com o Líder único') });
    expect(sent).toHaveLength(2);
  });

  it('a closed place passes its tasks to the first live one above, else to the Líder único, and whoever gets them hears it', async () => {
    vi.useFakeTimers();
    const { bridge, sent, tabs, passOns } = team();
    close(tabs, bridge, 'tab-dev');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    expect(passOns).toEqual([[{ projectPath: ATLAS, placeId: DEV, gone: 'fechada', to: THEO }]]);
    expect(sent).toEqual([{ tabId: 'tab-theo', text: expect.stringContaining('t-dev «Corrige o envio»') }]);
    expect(sent[0]!.text).toContain('fechou');

    close(tabs, bridge, 'tab-theo');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    expect(passOns[1]).toEqual([{ projectPath: ATLAS, placeId: THEO, gone: 'fechada', to: 'lider' }]);
    expect(sent[1]).toEqual({ tabId: 'tab-lider', text: expect.stringContaining('quadro atlas') });
  });

  it('with nobody live above, the tasks go back to the Líder of the board, not to the Líder único (dono, 09/11)', async () => {
    vi.useFakeTimers();
    const { bridge, tabs, passOns } = team({ boardLeader: true });
    close(tabs, bridge, 'tab-theo');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    expect(passOns).toEqual([[{ projectPath: ATLAS, placeId: THEO, gone: 'fechada', to: LQ }]]);

    // The Líder of the board itself closes: nobody is above it, so the Líder único holds its tasks.
    close(tabs, bridge, 'tab-lq');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    expect(passOns[1]).toEqual([{ projectPath: ATLAS, placeId: LQ, gone: 'fechada', to: 'lider' }]);
  });

  it('a Líder of the board mute since the app opened does not take them: they stay with the Líder único', async () => {
    vi.useFakeTimers();
    const { bridge, tabs, passOns } = team({ boardLeader: true, muteLeader: true });
    close(tabs, bridge, 'tab-theo');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    expect(passOns).toEqual([[{ projectPath: ATLAS, placeId: THEO, gone: 'fechada', to: 'lider' }]]);
  });

  it('a chair whose CLI exited (the tab stays on screen) passes its tasks on like a closed one; one that comes back keeps them', async () => {
    vi.useFakeTimers();
    const { bridge, passOns, exited } = team({ boardLeader: true });
    exited.add('tab-outro');
    bridge.placeExited('tab-outro');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    expect(passOns).toEqual([[{ projectPath: ATLAS, placeId: OUTRO, gone: 'fechada', to: LQ }]]);

    // The CLI of the Dev exits and is back (onPtyChange clears the exit) within the grace: its task stays.
    exited.add('tab-dev');
    bridge.placeExited('tab-dev');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS / 2);
    exited.delete('tab-dev');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    expect(passOns).toHaveLength(1);
  });

  it('with the Líder of the board open, a chair does not go over it to the Líder único; closed or mute, it does (dono, 12/11)', async () => {
    const { bridge, sent, tabs } = team({ boardLeader: true });
    const over = await bridge.handle('theo', { tool: 'sessao_enviar', para: 'lider', texto: 'travei no build', motivo: 'bloqueio' });
    expect(over).toMatchObject({ ok: false, text: expect.stringContaining(`Líder aberto (${LQ})`) });
    const viaOpener = await bridge.handle('theo', { tool: 'sessao_enviar', para: 'quem-me-abriu', texto: 'travei no build', motivo: 'bloqueio' });
    expect(viaOpener).toMatchObject({ ok: false, text: expect.stringContaining('"para": "lider-quadro"') });
    expect(sent).toEqual([]);

    // The Líder of the board itself still reaches the Líder único.
    expect(await bridge.handle('lq', { tool: 'sessao_enviar', para: 'lider', texto: 'quadro pronto', motivo: 'tarefa-completa' })).toMatchObject({ ok: true });
    expect(sent).toEqual([{ tabId: 'tab-lider', text: `◆ De Líder (${LQ}), quadro atlas, tarefa completa: quadro pronto` }]);

    // The Líder of the board open but stuck itself (a permission on its screen): the chair's blocker goes.
    const stuck = team({ boardLeader: true });
    stuck.permission.add('tab-lq');
    expect(await stuck.bridge.handle('theo', { tool: 'sessao_enviar', para: 'lider', texto: 'travei no build', motivo: 'bloqueio' })).toMatchObject({ ok: true });

    // The Líder of the board closed: the chair's blocker is one it cannot solve, so it goes.
    tabs.splice(tabs.findIndex((tab) => tab.id === 'tab-lq'), 1);
    expect(await bridge.handle('theo', { tool: 'sessao_enviar', para: 'lider', texto: 'travei no build', motivo: 'bloqueio' })).toMatchObject({ ok: true });
    expect(sent[1]).toMatchObject({ tabId: 'tab-lider' });

    // Mute since the app opened: it goes too.
    const mute = team({ boardLeader: true, muteLeader: true });
    expect(await mute.bridge.handle('theo', { tool: 'sessao_enviar', para: 'quem-me-abriu', texto: 'travei no build', motivo: 'bloqueio' })).toMatchObject({ ok: true });
    expect(mute.sent).toEqual([{ tabId: 'tab-lider', text: expect.stringContaining('bloqueio: travei no build') }]);
  });

  it('with the Líder of the board open, a chair the Líder único opened still hands it the finished task; one below it does not', async () => {
    const { bridge, sent } = team({ boardLeader: true });
    expect(await bridge.handle('theo', { tool: 'sessao_enviar', para: 'lider', texto: 'parte 1 pronta', motivo: 'tarefa-completa' })).toMatchObject({ ok: true });
    expect(await bridge.handle('theo', { tool: 'sessao_enviar', para: 'quem-me-abriu', texto: 'parte 2 pronta', motivo: 'tarefa-completa' })).toMatchObject({ ok: true });
    expect(sent).toEqual([
      { tabId: 'tab-lider', text: `◆ De Dev (${THEO}), quadro atlas, tarefa completa: parte 1 pronta` },
      { tabId: 'tab-lider', text: `◆ De Dev (${THEO}), quadro atlas, tarefa completa: parte 2 pronta` },
    ]);

    // The Dev reaches the Líder único only by being below the Theo (the Theo opened it): it goes to the Líder of the board.
    const below = await bridge.handle('dev', { tool: 'sessao_enviar', para: 'lider', texto: 'parte 3 pronta', motivo: 'tarefa-completa' });
    expect(below).toMatchObject({ ok: false, text: expect.stringContaining(`Líder aberto (${LQ})`) });
    expect(sent).toHaveLength(2);
  });

  it('closing the app before the grace, or a place that comes back, moves nothing', async () => {
    vi.useFakeTimers();
    const { bridge, tabs, passOns } = team();
    // The tab is closed and comes back (reopened) within the grace.
    bridge.placeClosed('tab-outro');
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS);
    // The app closes (the window goes, the bridge is disposed) right after a close.
    close(tabs, bridge, 'tab-dev');
    bridge.dispose();
    await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS * 2);
    expect(passOns).toEqual([]);
  });
});
