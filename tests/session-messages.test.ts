import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBridge, NOTICE_CHARS, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { SessionSemaphoreManager } from '../src/main/session-semaphore-manager';
import type { HookBridge } from '../src/main/hook-bridge';
import { addLink, addPlace, emptyMindscapeDoc, writeSessionNote, type MindscapeDoc } from '../src/shared/mindscape/model';
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
    // The old mode (08/11, Preferências): the "◆ … terminou" in the chat.
    turnNotices: () => 'chat',
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

// 07/11 — a session opened with `sessao_abrir` whose terminal never opens (the ssh of a remote place failed):
// whoever opened it hears the literal reason, whether the ssh fails at once or hangs past the 90 s grace notice.
describe('sessão que não abre conta o motivo a quem abriu', () => {
  function opener() {
    let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:lider' });
    const tabs: BridgeTab[] = [{ id: 'tab-lider', name: 'Líder', cwd: ATLAS, placeId: 'place:lider', claudeSessionId: 's-lider', sessionType: 'claude' }];
    const failures: Record<string, string> = {};
    const sent: string[] = [];
    const ports: AgentBridgePorts = {
      loaded: true,
      doc: () => doc,
      applyGesture: (_path, reducer) => {
        doc = reducer(doc);
      },
      tabs: () => tabs,
      tabOfPty: (ptyId) => tabs.find((tab) => `pty-${tab.id}` === ptyId),
      stateOf: () => 'working',
      roles: () => [{ id: 'dev', name: 'Dev', color: 'implementar', guidance: '' }],
      openSession: (request) => {
        tabs.push({ id: 'tab-dev', name: request.name, cwd: ATLAS, placeId: request.placeId, sessionType: 'claude' });
        return 'tab-dev';
      },
      sendLine: (tabId, text) => {
        if (tabId === 'tab-lider') sent.push(text);
      },
      deliverLine: async () => ({ kind: 'entrou' }),
      permissionOnScreen: () => false,
      unconfirmed: (tabId) => tabId === 'tab-dev',
      // As App's: a failure the terminal reported wins over "never opened".
      startTrouble: (tabId) => (failures[tabId] !== undefined ? `o terminal dela não abriu (${failures[tabId]})` : 'o terminal dela não chegou a abrir'),
      closeTab: () => undefined,
      askOwner: async () => false,
      remoteLabel: (id) => id,
      remotes: () => [{ id: 'vps', label: 'VPS' }],
      projects: () => [],
    };
    const bridge = new AgentBridge(ports);
    return {
      bridge,
      sent,
      open: () => bridge.handle('pty-tab-lider', { tool: 'sessao_abrir', papel: 'dev', pedido: 'faz X', onde: 'VPS' }),
      fail: (reason: string) => {
        failures['tab-dev'] = reason;
        bridge.startFailed('tab-dev');
      },
    };
  }

  afterEach(() => vi.useRealTimers());

  it('falha rápida: o motivo chega na hora, uma vez', async () => {
    vi.useFakeTimers();
    const team = opener();
    await team.open();
    vi.advanceTimersByTime(2_000);
    team.fail('VPS: Não consegui entrar no lugar remoto por ssh: Permission denied');
    vi.advanceTimersByTime(200_000);
    expect(team.sent).toEqual([expect.stringContaining('Permission denied')]);
    team.bridge.dispose();
  });

  it('ssh pendurado: o aviso dos 90 s vem antes, e o motivo ainda chega quando o preparo falha aos 180 s', async () => {
    vi.useFakeTimers();
    const team = opener();
    await team.open();
    vi.advanceTimersByTime(90_000);
    expect(team.sent).toEqual([expect.stringContaining('não chegou a abrir')]);
    vi.advanceTimersByTime(90_000);
    team.fail('VPS: O lugar remoto não respondeu em 180 s (o ssh disse: To authenticate, visit: https://login.tailscale.com/a/x)');
    expect(team.sent).toHaveLength(2);
    expect(team.sent[1]).toContain('https://login.tailscale.com/a/x');
    team.fail('de novo');
    expect(team.sent).toHaveLength(2);
    team.bridge.dispose();
  });
});

// 08/11 (BizOps, item 11; Homologação, item 7) — o app ficou ~35 min sem responder e reiniciou. As sessões da VPS
// continuavam vivas e foram religadas, mas as chamadas delas ao quadro, no meio da religação, ouviam "Esta sessão não
// é uma aba do Donel Dev": o Revisor achou que tinha caído e parou. E todas apareciam "aberta, sem nenhum pedido
// ainda", sem o último estado real.
describe('depois de o app reiniciar e religar as sessões', () => {
  function restarted(known: () => boolean) {
    let doc: MindscapeDoc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:lider' });
    doc = addPlace(doc, ATLAS, { id: 'place:dev' });
    doc = addLink(doc, ATLAS, { id: 'l1', from: 'place:lider', to: 'place:dev' });
    const board = doc.boards[ATLAS]!;
    for (const [placeId, sessionId] of [['place:lider', 's-lider'], ['place:dev', 's-dev']] as const) {
      const card = board.cards[placeId]!;
      if (card.kind === 'session') board.cards[placeId] = { ...card, sessionId };
    }
    doc = writeSessionNote(doc, ATLAS, { sessionId: 's-dev', sessionName: 'Dev', text: 'PR aberto, espera revisão', writtenAt: new Date(2026, 10, 8, 14, 37).getTime() });
    const tabs: BridgeTab[] = [
      { id: 'tab-lider', name: 'Líder', cwd: ATLAS, placeId: 'place:lider', claudeSessionId: 's-lider', sessionType: 'claude' },
      { id: 'tab-dev', name: 'Dev', cwd: ATLAS, placeId: 'place:dev', claudeSessionId: 's-dev', sessionType: 'claude' },
    ];
    const ports = {
      loaded: true,
      doc: () => doc,
      applyGesture: () => undefined,
      tabs: () => tabs,
      // The Dev's new PTY is only known to the tab once the reattach comes back to the renderer.
      tabOfPty: (ptyId: string) => (ptyId === 'pty-lider' ? tabs[0] : ptyId === 'pty-dev-novo' && known() ? tabs[1] : undefined),
      stateOf: () => 'working' as const,
      unconfirmed: () => true, // no hook heard since the restart
      roles: () => [],
      startTrouble: () => null,
      permissionOnScreen: () => false,
      remoteLabel: (id: string) => id,
      remotes: () => [],
      projects: () => [],
    } as unknown as AgentBridgePorts;
    return new AgentBridge(ports);
  }

  afterEach(() => vi.useRealTimers());

  it('a chamada de uma sessão ainda sendo religada espera a aba dela aparecer, em vez de dizer que ela não é do Donel', async () => {
    vi.useFakeTimers();
    let known = false;
    const bridge = restarted(() => known);
    const answer = bridge.handle('pty-dev-novo', { tool: 'sessao_quem_sou' });
    await vi.advanceTimersByTimeAsync(4_000);
    known = true;
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await answer;
    expect(result.ok).toBe(true);
    expect(result.text).toContain('place:dev');
  });

  it('se a aba não aparece, a resposta diz que o app está religando e que ela não caiu (nunca "não é uma aba")', async () => {
    vi.useFakeTimers();
    const bridge = restarted(() => false);
    const answer = bridge.handle('pty-dev-novo', { tool: 'sessao_quem_sou' });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await answer;
    expect(result.ok).toBe(false);
    expect(result.text).not.toMatch(/não é uma aba/);
    expect(result.text).toMatch(/religando/);
  });

  it('a sessão religada aparece com o último estado real (parada desde o último fim de turno), não "sem nenhum pedido"', async () => {
    const bridge = restarted(() => true);
    const result = await bridge.handle('pty-lider', { tool: 'sessao_listar' });
    const dev = (JSON.parse(result.text) as { id: string; estado: string }[]).find((place) => place.id === 'place:dev');
    expect(dev?.estado).not.toMatch(/sem nenhum pedido/);
    expect(dev?.estado).toMatch(/^parada desde 14:37/);
  });
});

