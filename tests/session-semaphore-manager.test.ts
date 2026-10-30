import { describe, expect, it, vi } from 'vitest';
import { createHookBridge } from '../src/main/hook-bridge';
import { mapHookEventName, SessionSemaphoreManager, type SemaphoreUpdate } from '../src/main/session-semaphore-manager';

// T009 — mapHookEventName é puro (testado direto). O resto da classe tem I/O
// real (servidor HTTP local) — mesmo padrão de tests/pty-manager.test.ts
// (spawna um processo dummy de verdade em vez de mockar node-pty): aqui
// sobe o servidor de verdade numa porta efêmera e faz um POST real, porque é
// exatamente esse fio (hook -> HTTP -> estado) que o addendum T009 do spike
// validou manualmente contra um `claude` real — a suíte automatizada cobre
// a mesma costura sem precisar do CLI.

describe('mapHookEventName', () => {
  it('traduz os 6 eventos da matriz do spike', () => {
    expect(mapHookEventName('UserPromptSubmit')).toBe('userPromptSubmit');
    expect(mapHookEventName('PreToolUse')).toBe('preToolUse');
    expect(mapHookEventName('PostToolUse')).toBe('postToolUse');
    expect(mapHookEventName('Stop')).toBe('stop');
    expect(mapHookEventName('Notification')).toBe('notification');
    expect(mapHookEventName('SessionEnd')).toBe('sessionEnd');
  });

  it('StopFailure (turno encerrado por erro de API, ex. limite da conta) fecha o turno como Stop', () => {
    // O CLI dispara StopFailure NO LUGAR de Stop quando rate limit/overload
    // encerra o turno. Sem isso a sessão fica "trabalhando" para sempre e o
    // auto-switch de contas adia indefinidamente — justo quando a conta estourou.
    expect(mapHookEventName('StopFailure')).toBe('stop');
  });

  it('null para eventos que não são do semáforo (ex.: SubagentStop de hooks globais do usuário)', () => {
    expect(mapHookEventName('SubagentStop')).toBeNull();
    expect(mapHookEventName(undefined)).toBeNull();
    expect(mapHookEventName(123)).toBeNull();
  });
});

async function postHook(port: number, body: unknown): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('SessionSemaphoreManager (servidor HTTP real, porta efêmera)', () => {
  it('registra a sessão, roteia hooks reais via HTTP pro ptyId certo e emite os estados esperados', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();
    expect(port).toBeGreaterThan(0);

    try {
      const updates: SemaphoreUpdate[] = [];
      manager.onUpdate((update) => updates.push(update));

      manager.registerSession('pty-1', 'claude-session-abc');
      expect(updates.at(-1)).toEqual({ ptyId: 'pty-1', state: 'working', stateEnteredAt: expect.any(Number) });

      await postHook(port, { hook_event_name: 'UserPromptSubmit', session_id: 'claude-session-abc' });
      await postHook(port, { hook_event_name: 'Stop', session_id: 'claude-session-abc' });

      expect(updates.at(-1)?.state).toBe('waiting');
      expect(updates.at(-1)?.ptyId).toBe('pty-1');
    } finally {
      manager.dispose();
    }
  });

  it('ignora hooks de session_id não registrado (sessão claude fora deste app)', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();

    try {
      const updates: SemaphoreUpdate[] = [];
      manager.onUpdate((update) => updates.push(update));
      manager.registerSession('pty-1', 'claude-session-abc');
      updates.length = 0; // limpa o update do registerSession pra checar só o efeito do POST

      await postHook(port, { hook_event_name: 'Stop', session_id: 'unrelated-session-id' });

      expect(updates).toEqual([]);
    } finally {
      manager.dispose();
    }
  });

  it('onProcessExit com exit code != 0 emite "error" (FR-010 falha/quota esgotada); código 0 emite "done"', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    await manager.start();

    try {
      const updates: SemaphoreUpdate[] = [];
      manager.onUpdate((update) => updates.push(update));

      manager.registerSession('pty-error', 'session-error');
      manager.onProcessExit('pty-error', 1);
      expect(updates.at(-1)).toEqual({ ptyId: 'pty-error', state: 'error', stateEnteredAt: expect.any(Number) });

      manager.registerSession('pty-ok', 'session-ok');
      manager.onProcessExit('pty-ok', 0);
      expect(updates.at(-1)).toEqual({ ptyId: 'pty-ok', state: 'done', stateEnteredAt: expect.any(Number) });
    } finally {
      manager.dispose();
    }
  });

  it('onProcessExit tem prioridade mesmo após hooks reais via HTTP terem movido o estado (kill forçado do spike)', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();

    try {
      manager.registerSession('pty-1', 'claude-session-abc');
      await postHook(port, { hook_event_name: 'Notification', session_id: 'claude-session-abc' });
      expect(manager.getSnapshot('pty-1')?.state).toBe('permission');

      manager.onProcessExit('pty-1', 1); // kill forçado — spike: SessionEnd não dispara, mas onExit do node-pty sempre é a fonte de verdade
      expect(manager.getSnapshot('pty-1')?.state).toBe('error');
    } finally {
      manager.dispose();
    }
  });

  it('getSnapshot retorna undefined para ptyId nunca registrado', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    await manager.start();
    try {
      expect(manager.getSnapshot('never-registered')).toBeUndefined();
    } finally {
      manager.dispose();
    }
  });

  // Emenda 22/09 (011-contas-e-provedores, etapa 3, Fase 2, item 4) —
  // `onStopFailure` distingue especificamente StopFailure (limite da conta),
  // que `mapHookEventName`/`onUpdate` fundem em `stop` junto com Stop normal.
  it('onStopFailure dispara SÓ em StopFailure, nunca em Stop normal', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();

    try {
      const stopFailurePtyIds: string[] = [];
      manager.onStopFailure((ptyId) => stopFailurePtyIds.push(ptyId));
      manager.registerSession('pty-1', 'claude-session-abc');

      await postHook(port, { hook_event_name: 'Stop', session_id: 'claude-session-abc' });
      expect(stopFailurePtyIds).toEqual([]);

      await postHook(port, { hook_event_name: 'StopFailure', session_id: 'claude-session-abc' });
      expect(stopFailurePtyIds).toEqual(['pty-1']);
    } finally {
      manager.dispose();
    }
  });

  it('onStopFailure também move o semáforo pra "waiting" (StopFailure ainda fecha o turno como Stop)', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();

    try {
      manager.registerSession('pty-1', 'claude-session-abc');
      await postHook(port, { hook_event_name: 'UserPromptSubmit', session_id: 'claude-session-abc' });
      await postHook(port, { hook_event_name: 'StopFailure', session_id: 'claude-session-abc' });

      expect(manager.getSnapshot('pty-1')?.state).toBe('waiting');
    } finally {
      manager.dispose();
    }
  });

  it('unsubscribe de onStopFailure para de notificar', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();

    try {
      const stopFailurePtyIds: string[] = [];
      const unsubscribe = manager.onStopFailure((ptyId) => stopFailurePtyIds.push(ptyId));
      manager.registerSession('pty-1', 'claude-session-abc');
      unsubscribe();

      await postHook(port, { hook_event_name: 'StopFailure', session_id: 'claude-session-abc' });

      expect(stopFailurePtyIds).toEqual([]);
    } finally {
      manager.dispose();
    }
  });
});

// T014 (014-chat) — transporte novo: eventos chegam da ponte por ptyId (sem mapa
// por session_id). HTTP real na ponte, porque o fio token -> ptyId -> estado é o
// que importa.
async function postBridge(port: number, token: string, event: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/h/${event}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Donel-Token': token },
    body: JSON.stringify(body),
  });
}

describe('SessionSemaphoreManager pela ponte de hooks (por ptyId)', () => {
  async function setup() {
    const bridge = createHookBridge();
    const { port } = await bridge.start();
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const detach = manager.attachBridge(bridge);
    const updates: SemaphoreUpdate[] = [];
    manager.onUpdate((update) => updates.push(update));
    const token = bridge.registerSession('pty-1');
    manager.registerSession('pty-1', 'claude-session-a');
    return {
      bridge,
      manager,
      port,
      token,
      updates,
      close: async () => {
        detach();
        manager.dispose();
        await bridge.close();
      },
    };
  }

  it('roteia o hook pelo token da aba, sem depender do session_id', async () => {
    const { port, token, updates, close } = await setup();
    try {
      await postBridge(port, token, 'UserPromptSubmit', { session_id: 'qualquer-outro-id' });
      await postBridge(port, token, 'Stop', { session_id: 'qualquer-outro-id' });
      await vi.waitFor(() => expect(updates.at(-1)).toMatchObject({ ptyId: 'pty-1', state: 'waiting' }));
    } finally {
      await close();
    }
  });

  it('/clear: SessionEnd(clear) + SessionStart(clear) não levam a done e o semáforo segue vivo com o id novo', async () => {
    const { manager, port, token, updates, close } = await setup();
    try {
      await postBridge(port, token, 'Stop', { session_id: 'claude-session-a' });
      await vi.waitFor(() => expect(updates.at(-1)?.state).toBe('waiting'));

      await postBridge(port, token, 'SessionEnd', { session_id: 'claude-session-a', reason: 'clear' });
      await postBridge(port, token, 'SessionStart', { session_id: 'claude-session-b', source: 'clear', transcript_path: 'C:/x/b.jsonl' });
      await postBridge(port, token, 'UserPromptSubmit', { session_id: 'claude-session-b' });
      await vi.waitFor(() => expect(updates.at(-1)?.state).toBe('working'));
      expect(updates.some((u) => u.state === 'done')).toBe(false);
      expect(manager.getSnapshot('pty-1')?.state).toBe('working');
    } finally {
      await close();
    }
  });

  it('/resume: SessionEnd(resume) não leva a done; o hook do id retomado ainda move o estado', async () => {
    const { port, token, updates, close } = await setup();
    try {
      await postBridge(port, token, 'SessionEnd', { session_id: 'claude-session-a', reason: 'resume' });
      await postBridge(port, token, 'SessionStart', { session_id: 'claude-session-old', source: 'resume' });
      await postBridge(port, token, 'Stop', { session_id: 'claude-session-old' });
      await vi.waitFor(() => expect(updates.at(-1)?.state).toBe('waiting'));
      expect(updates.some((u) => u.state === 'done')).toBe(false);
    } finally {
      await close();
    }
  });

  it('SessionEnd com outro motivo leva a done', async () => {
    const { port, token, updates, close } = await setup();
    try {
      await postBridge(port, token, 'SessionEnd', { session_id: 'claude-session-a', reason: 'prompt_input_exit' });
      await vi.waitFor(() => expect(updates.at(-1)?.state).toBe('done'));
    } finally {
      await close();
    }
  });

  it('StopFailure pela ponte avisa onStopFailure e fecha o turno', async () => {
    const { manager, port, token, updates, close } = await setup();
    try {
      const failed: string[] = [];
      manager.onStopFailure((ptyId) => failed.push(ptyId));
      await postBridge(port, token, 'StopFailure', { session_id: 'claude-session-a' });
      await vi.waitFor(() => expect(failed).toEqual(['pty-1']));
      expect(updates.at(-1)?.state).toBe('waiting');
    } finally {
      await close();
    }
  });

  it('#109: Stop com subagente vivo publica waiting marcado como provisório; o Stop que fecha sem subagente publica waiting limpo', async () => {
    const { port, token, updates, close } = await setup();
    try {
      const subagent = { id: 'a1', type: 'subagent', status: 'running', description: 'revisar' };
      await postBridge(port, token, 'Stop', { background_tasks: [subagent] });
      await vi.waitFor(() => expect(updates.at(-1)).toEqual({ ptyId: 'pty-1', state: 'waiting', stateEnteredAt: expect.any(Number), awaitingBackgroundAgents: true }));
      await postBridge(port, token, 'Stop', { background_tasks: [] });
      await vi.waitFor(() => expect(updates.at(-1)).toEqual({ ptyId: 'pty-1', state: 'waiting', stateEnteredAt: expect.any(Number) }));
    } finally {
      await close();
    }
  });

  it('#109: um shell em segundo plano não deixa a espera provisória, e pendência aberta é permission sem marca', async () => {
    const { manager, port, token, updates, close } = await setup();
    try {
      await postBridge(port, token, 'Stop', { background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'npm run dev' }] });
      await vi.waitFor(() => expect(updates.at(-1)?.state).toBe('waiting'));
      expect(updates.at(-1)?.awaitingBackgroundAgents).toBeUndefined();

      await postBridge(port, token, 'Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'x' }] });
      await vi.waitFor(() => expect(updates.at(-1)?.awaitingBackgroundAgents).toBe(true));
      manager.setPendingOpen('pty-1', true);
      expect(updates.at(-1)).toEqual({ ptyId: 'pty-1', state: 'permission', stateEnteredAt: expect.any(Number) });
    } finally {
      await close();
    }
  });

  it('ignora evento de pty não registrado no semáforo e hooks fora do conjunto do semáforo', async () => {
    const { bridge, port, token, updates, close } = await setup();
    try {
      const otherToken = bridge.registerSession('pty-ghost');
      await postBridge(port, otherToken, 'Stop', {});
      await postBridge(port, token, 'SubagentStop', {});
      await postBridge(port, token, 'Stop', {});
      await vi.waitFor(() => expect(updates.at(-1)?.ptyId).toBe('pty-1'));
      expect(updates.some((u) => u.ptyId === 'pty-ghost')).toBe(false);
    } finally {
      await close();
    }
  });
});

describe('legado (DONEL_HOOKS_TRANSPORT=legacy): SessionEnd clear/resume também não leva a done', () => {
  it('SessionEnd(clear) pelo /hook antigo é ignorado', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();
    try {
      const updates: SemaphoreUpdate[] = [];
      manager.onUpdate((update) => updates.push(update));
      manager.registerSession('pty-1', 'claude-session-abc');
      await postHook(port, { hook_event_name: 'Stop', session_id: 'claude-session-abc' });
      await postHook(port, { hook_event_name: 'SessionEnd', session_id: 'claude-session-abc', reason: 'clear' });
      expect(updates.at(-1)?.state).toBe('waiting');
      await postHook(port, { hook_event_name: 'SessionEnd', session_id: 'claude-session-abc', reason: 'logout' });
      expect(updates.at(-1)?.state).toBe('done');
    } finally {
      manager.dispose();
    }
  });
});
