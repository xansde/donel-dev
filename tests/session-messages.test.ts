import { describe, expect, it } from 'vitest';
import { AgentBridge, NOTICE_CHARS, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
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
    deliverLine: async (tabId, text) => {
      sent.push({ tabId, text });
      return { kind: 'entrou' };
    },
    permissionOnScreen: () => false,
    unconfirmed: () => false,
    startTrouble: () => null,
    closeTab: () => undefined,
    askOwner: async () => false,
    remoteLabel: (id) => id,
    remotes: () => [],
    projects: () => [],
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

  it('o aviso "terminou" leva o turno inteiro, com as linhas, e só corta acima do teto dizendo quanto', () => {
    const { bridge, sent } = team('waiting');
    const lines = Array.from({ length: 60 }, (_, i) => `- item ${i + 1}: o script de instalação ficou pronto e a tarefa foi registrada`);
    const long = `Resumo do turno:\n\n${lines.join('\n')}\n\nFim.`;
    expect(long.length).toBeGreaterThan(4_000);
    expect(long.length).toBeLessThan(NOTICE_CHARS);
    bridge.turnEnded('s-dev', long);
    expect(sent[0]!.text).toBe(`◆ Dev (place:dev) terminou: ${long}`);

    const huge = 'x'.repeat(NOTICE_CHARS + 500);
    bridge.turnEnded('s-dev', huge);
    expect(sent[1]!.text).toBe(`◆ Dev (place:dev) terminou: ${'x'.repeat(NOTICE_CHARS)}\n[cortado: ${NOTICE_CHARS} de ${NOTICE_CHARS + 500} letras; o resto em sessao_ver_tela]`);
    expect(sent[1]!.text).not.toContain('…');
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

  it('o que o dono escreve na carta vai à sessão dona; fechada, ao Líder único; sem ninguém, a nenhum lugar', async () => {
    const message = { projectPath: ATLAS, placeId: 'place:dev', text: 'para o dev', leaderText: 'para o líder' };
    const open = team('waiting');
    expect(await open.bridge.deliverOwnerMessage(message)).toEqual({ placeId: 'place:dev' });
    expect(open.sent).toEqual([{ tabId: 'tab-dev', text: 'para o dev' }]);

    // The Dev's tab is gone; the Jobu's Líder único is open.
    let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:dev' });
    const tabs: BridgeTab[] = [{ id: 'tab-unico', name: 'Líder', cwd: 'C:/home', roleId: 'lider', leaderOfAll: true, claudeSessionId: 's-u', sessionType: 'claude' }];
    const sent: { tabId: string; text: string }[] = [];
    const ports = {
      loaded: true,
      doc: () => doc,
      tabs: () => tabs,
      stateOf: () => 'waiting' as const,
      unconfirmed: () => false,
      deliverLine: async (tabId: string, text: string) => {
        sent.push({ tabId, text });
        return { kind: 'entrou' as const };
      },
    } as unknown as AgentBridgePorts;
    expect(await new AgentBridge(ports).deliverOwnerMessage(message)).toBe('lider');
    expect(sent).toEqual([{ tabId: 'tab-unico', text: 'para o líder' }]);

    tabs.length = 0;
    doc = addPlace(doc, ATLAS, { id: 'place:outro' });
    expect(await new AgentBridge(ports).deliverOwnerMessage(message)).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
