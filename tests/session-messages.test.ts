import { describe, expect, it } from 'vitest';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { SessionSemaphoreManager } from '../src/main/session-semaphore-manager';
import type { HookBridge } from '../src/main/hook-bridge';
import { addLink, addPlace, emptyMindscapeDoc } from '../src/shared/mindscape/model';
import type { SemaphoreState } from '../src/shared';

// B40 (owner, 04/11) — a message between sessions goes at once into the destination's CLI, working or stopped,
// and an end-of-turn notice arrives once. Breaking this stops the whole team without the owner seeing why.

const ATLAS = 'C:/atlas';

function team(state: SemaphoreState) {
  let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:lider' });
  doc = addPlace(doc, ATLAS, { id: 'place:dev' });
  doc = addLink(doc, ATLAS, { id: 'l1', from: 'place:lider', to: 'place:dev' });
  const tabs: BridgeTab[] = [
    { id: 'tab-lider', name: 'Líder', cwd: ATLAS, placeId: 'place:lider', claudeSessionId: 's-lider', sessionType: 'claude' },
    { id: 'tab-dev', name: 'Dev', cwd: ATLAS, placeId: 'place:dev', claudeSessionId: 's-dev', sessionType: 'claude' },
  ];
  const sent: { tabId: string; text: string }[] = [];
  const ports: AgentBridgePorts = {
    loaded: true,
    doc: () => doc,
    applyGesture: () => undefined,
    tabs: () => tabs,
    tabOfPty: (ptyId) => tabs.find((tab) => `pty-${tab.id}` === ptyId),
    stateOf: () => state,
    roles: () => [],
    openSession: () => 'unused',
    sendLine: (tabId, text) => sent.push({ tabId, text }),
    permissionOnScreen: () => false,
    closeTab: () => undefined,
    askOwner: async () => false,
    remoteLabel: (id) => id,
    remotes: () => [],
  };
  return { bridge: new AgentBridge(ports), sent };
}

describe('mensagem entre sessões vai na hora para o CLI', () => {
  it.each<SemaphoreState>(['working', 'waiting', 'permission'])('destino %s: entregue na hora, nunca retida', async (state) => {
    const { bridge, sent } = team(state);
    const answer = await bridge.handle('pty-tab-lider', { tool: 'sessao_enviar', para: 'place:dev', texto: 'roda os testes' });
    expect(answer.ok).toBe(true);
    expect(answer.text).not.toMatch(/Retida/);
    expect(sent).toEqual([{ tabId: 'tab-dev', text: expect.stringContaining('roda os testes') }]);
  });

  it('o aviso "terminou" chega uma vez só, na ordem dos turnos', () => {
    const { bridge, sent } = team('waiting');
    bridge.turnEnded('s-dev', 'turno 1');
    bridge.turnEnded('s-dev', 'turno 1'); // the same end of turn again
    bridge.turnEnded('s-dev', 'turno 2');
    expect(sent.map((item) => item.tabId)).toEqual(['tab-lider', 'tab-lider']);
    expect(sent[0]!.text).toMatch(/terminou: turno 1$/);
    expect(sent[1]!.text).toMatch(/terminou: turno 2$/);
  });

  it('sessão parada depois de um Stop limpo não vira "precisa do dono" com o aviso de ociosidade', () => {
    let emit: ((event: unknown) => void) | null = null;
    const hookBridge = { onAny: (listener: (event: unknown) => void) => ((emit = listener), () => undefined) } as unknown as HookBridge;
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [], tickIntervalMs: 60_000 });
    manager.attachBridge(hookBridge);
    manager.registerSession('pty-1', 's-1');
    const hook = (event: string, payload: Record<string, unknown> = {}) => emit!({ type: 'hook', ptyId: 'pty-1', event, payload });
    hook('UserPromptSubmit');
    hook('Stop');
    hook('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
    expect(manager.getSnapshot('pty-1')?.state).toBe('waiting');
    hook('UserPromptSubmit');
    hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    expect(manager.getSnapshot('pty-1')?.state).toBe('permission');
    manager.dispose();
  });
});
