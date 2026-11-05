import { describe, expect, it } from 'vitest';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
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
    expect(rolePromptText(lider)).not.toContain('Líder único');
    expect(leaderOfAllPromptText(lider)).toContain('Você é o Líder único');
    expect(leaderOfAllPromptText({ ...lider, guidance: 'Fale curto.' })).toContain('Fale curto.');
  });
});
