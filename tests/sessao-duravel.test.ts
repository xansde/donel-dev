// Sessão durável (t-fb11c6cd, dono 12/11): Atualizar não espera para sempre, e o time volta na mesma conversa com o
// Líder sabendo quem voltou. O que quebraria sem o dono perceber: a atualização presa atrás de uma sessão que nunca
// para, uma conversa que volta com outro id (o lugar do Mindscape perde o fio) e um time que some sem ninguém saber.

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdater } from 'electron-updater';
import { createAppUpdateService } from '../src/main/app-update';
import { resolveClaudeCorrelation } from '../src/main/session-correlation';
import { respawnArgsFor, sessionsToWarn, updateGo, type ResumeRemote, type ResumeTab } from '../src/shared/appUpdate';
import { returnVerdict } from '../src/shared/sessionReturn';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation } from '../src/shared/mindscape/model';
import { FACTORY_ROLES, LEADER_ROLE_ID } from '../src/shared/roles';
import type { SemaphoreState } from '../src/shared';

describe('Atualizar com sessão trabalhando', () => {
  it('avisa só quem está no meio de um turno e, no fim do prazo, reinicia mesmo assim', () => {
    const sessions = [
      { id: 'a', alive: true, state: 'working' as const },
      { id: 'b', alive: true, state: 'waiting' as const, awaitingBackgroundAgents: true },
      { id: 'c', alive: true, state: 'permission' as const },
      { id: 'd', alive: true, state: 'working' as const, unconfirmed: true },
      { id: 'e', alive: false, state: 'working' as const },
      { id: 'f', alive: true, state: 'waiting' as const },
    ];
    expect(sessionsToWarn(sessions)).toEqual(['a', 'b']);

    const busy = { ready: false, working: 2, waitingOnYou: 1 };
    const timing = { requestedAt: 1_000, forceAfterMs: 300_000, readyForMs: 0 };
    expect(updateGo(busy, { ...timing, now: 1_000 + 299_000 })).toEqual({ go: false, forced: false, remainingMs: 1_000 });
    expect(updateGo(busy, { ...timing, now: 1_000 + 300_000 })).toEqual({ go: true, forced: true, remainingMs: 0 });
    // Free for an instant is the gap between the end of a turn and the one the notice opens: it holds a few seconds.
    const free = { ready: true, working: 0, waitingOnYou: 0 };
    expect(updateGo(free, { ...timing, now: 2_000, readyForMs: 1_000 })).toMatchObject({ go: false });
    expect(updateGo(free, { ...timing, now: 7_000, readyForMs: 5_000 })).toMatchObject({ go: true, forced: false });
  });
});

describe('registro das sessões antes de sair e retomada pelo mesmo id', () => {
  let dir: string | null = null;
  afterEach(() => {
    vi.useRealTimers();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function fakeUpdater(): AppUpdater & { installs: number } {
    const emitter = new EventEmitter() as unknown as AppUpdater & { installs: number };
    emitter.installs = 0;
    Object.assign(emitter, {
      checkForUpdates: async () => null,
      quitAndInstall: () => {
        emitter.installs += 1;
      },
    });
    return emitter;
  }

  it('grava as sessões ao Atualizar e, ao subir, cada uma volta na mesma conversa, até a que ainda não tinha mensagem', async () => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'sessao-duravel-'));
    const updater = fakeUpdater();
    const options = { enabled: true, currentVersion: '1.0.0', stateDir: dir, channel: 'alfa', onChanged: () => undefined, now: () => 10_000, ghToken: async () => 'token-de-teste' };
    const before = createAppUpdateService({ ...options, updater: () => updater });
    const token = process.env.GH_TOKEN;
    await before.check();
    if (token === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = token;
    (updater as unknown as EventEmitter).emit('update-downloaded', { version: '1.0.1' });

    const tabs: ResumeTab[] = [
      { sessionType: 'claude', name: 'Dev', cwd: '/proj/atlas', sessionId: 'conv-a', launchArgs: ['--model', 'opus', '-r', 'conv-a'], roleId: 'dev' },
      { sessionType: 'claude', name: 'Revisor', cwd: '/proj/atlas', sessionId: 'conv-b', launchArgs: ['--model', 'sonnet', '-r', 'conv-b'], roleId: 'revisor' },
    ];
    const remotes: ResumeRemote[] = [{ remoteId: 'vps', sessionId: 'conv-r', name: 'Pesquisa', cwd: '/proj/atlas' }];
    expect(before.apply(tabs, remotes)).toEqual({ ok: true });
    vi.advanceTimersByTime(1_000);
    expect(updater.installs).toBe(1);

    const after = createAppUpdateService({ ...options, updater: () => fakeUpdater(), transcriptExists: (sessionId) => sessionId === 'conv-a' });
    const boot = after.takeBoot();
    expect(boot.tabs.map((tab) => tab.launchArgs)).toEqual([
      ['--model', 'opus', '-r', 'conv-a'],
      // No transcript yet (opened, never written to): `-r` would fail; it starts again under the same id.
      ['--model', 'sonnet', '--session-id', 'conv-b'],
    ]);
    expect(boot.tabs.map((tab) => tab.sessionId)).toEqual(['conv-a', 'conv-b']);
    expect(boot.remotes).toEqual(remotes);
    expect(after.takeBoot()).toEqual({ tabs: [], remotes: [], failure: null });

    // The spawn keeps the id the argv asks for, `-r` or `--session-id`: never a second, new one.
    expect(resolveClaudeCorrelation(['--model', 'opus', '-r', 'conv-a'], () => 'novo')).toEqual({ correlationId: 'conv-a', extraArgs: [] });
    expect(resolveClaudeCorrelation(['--model', 'sonnet', '--session-id', 'conv-b'], () => 'novo')).toEqual({ correlationId: 'conv-b', extraArgs: [] });
    expect(resolveClaudeCorrelation(['--model', 'sonnet'], () => 'novo')).toEqual({ correlationId: 'novo', extraArgs: ['--session-id', 'novo'] });
    // Alive on its id is back: a start with no message leaves no resume sign to wait for.
    expect(returnVerdict('conv-b', { remote: false, tabFound: true, exited: false, sessionId: 'conv-b', confirmed: false, fresh: true, elapsedMs: 1_000 })).toEqual({ kind: 'voltou' });
    // Once it has a transcript, a respawn of that tab (Reabrir) resumes it: the CLI refuses a `--session-id` in use.
    expect(respawnArgsFor(['--model', 'sonnet', '--session-id', 'conv-b'], () => true)).toEqual(['--model', 'sonnet', '-r', 'conv-b']);
    expect(respawnArgsFor(['--model', 'sonnet', '--session-id', 'conv-b'], () => false)).toEqual(['--model', 'sonnet', '--session-id', 'conv-b']);
  });
});

describe('o Líder sabe quem voltou depois de Atualizar', () => {
  afterEach(() => vi.useRealTimers());

  const ATLAS = '/proj/atlas';
  function setup(options: { readonly leaderOnBoard: boolean }) {
    let doc = emptyMindscapeDoc();
    if (options.leaderOnBoard) doc = setPlaceConversation(addPlace(doc, ATLAS, { id: 'place:lider', roleId: LEADER_ROLE_ID }), ATLAS, 'place:lider', 'conv-l');
    doc = setPlaceConversation(addPlace(doc, ATLAS, { id: 'place:dev', roleId: 'dev' }), ATLAS, 'place:dev', 'conv-d');
    doc = setPlaceConversation(addPlace(doc, ATLAS, { id: 'place:rev', roleId: 'revisor' }), ATLAS, 'place:rev', 'conv-r');
    if (options.leaderOnBoard) doc = addLink(doc, ATLAS, { id: 'l1', from: 'place:lider', to: 'place:dev', arrow: true });
    const tabs: BridgeTab[] = [
      ...(options.leaderOnBoard ? [{ id: 't-lider', name: 'Líder', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-l', sessionType: 'claude' as const }] : []),
      { id: 't-dev', name: 'Dev', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-d', sessionType: 'claude' },
      { id: 't-rev', name: 'Revisor', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-r', sessionType: 'claude' },
      { id: 't-unico', name: 'Líder único', cwd: '/proj', roleId: LEADER_ROLE_ID, leaderOfAll: true, sessionType: 'claude' },
    ];
    const state: Record<string, SemaphoreState | undefined> = { 't-lider': 'waiting', 't-dev': 'waiting', 't-rev': 'waiting', 't-unico': 'waiting' };
    const confirmed = new Set<string>(['t-unico']);
    const sent: { tabId: string; text: string }[] = [];
    const ports: AgentBridgePorts = {
      loaded: true,
      doc: () => doc,
      applyGesture: () => undefined,
      tabs: () => tabs,
      tabOfPty: () => undefined,
      stateOf: (tabId) => (tabs.some((tab) => tab.id === tabId) ? state[tabId] : undefined),
      roles: () => FACTORY_ROLES,
      openSession: () => 'x',
      closeTab: () => undefined,
      sendLine: () => undefined,
      deliverLine: async (tabId, text) => {
        sent.push({ tabId, text });
        return { kind: 'entrou' };
      },
      permissionOnScreen: () => false,
      unconfirmed: (tabId) => !confirmed.has(tabId),
      startTrouble: () => null,
      askOwner: async () => true,
      remoteLabel: (id) => id,
      remotes: () => [],
      projects: () => [{ path: ATLAS, name: 'atlas' }],
    };
    const bridge = new AgentBridge(ports);
    const expected = tabs
      .filter((tab) => !tab.leaderOfAll)
      .map((tab) => ({ tabId: tab.id, sessionId: tab.claudeSessionId!, projectPath: ATLAS, name: tab.name }));
    return { bridge, sent, state, confirmed, expected };
  }

  it('o Líder do quadro recebe, uma vez, quem voltou e quem não, depois de ele mesmo voltar', async () => {
    vi.useFakeTimers();
    const { bridge, sent, state, confirmed, expected } = setup({ leaderOnBoard: true });
    bridge.expectReturn(expected);
    confirmed.add('t-dev');
    state['t-rev'] = undefined; // the CLI left: `-r` did not find the conversation
    bridge.flushUrgent();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]); // the Líder has not come back yet: nobody to tell

    confirmed.add('t-lider');
    bridge.flushUrgent();
    await vi.advanceTimersByTimeAsync(0);
    bridge.flushUrgent();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].tabId).toBe('t-lider');
    expect(sent[0].text).toContain('Voltaram na mesma conversa (2): Líder (place:lider), Dev (place:dev)');
    expect(sent[0].text).toContain('Não voltaram (1): Revisor (place:rev): o Claude saiu antes de retomar a conversa');
  });

  it('sem Líder no quadro vai ao Líder único, e quem não dá sinal no prazo conta como não voltou', async () => {
    vi.useFakeTimers();
    const { bridge, sent, confirmed, expected } = setup({ leaderOnBoard: false });
    bridge.expectReturn(expected);
    confirmed.add('t-dev');
    bridge.flushUrgent();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]); // the Revisor may still be coming back

    vi.advanceTimersByTime(3 * 60_000);
    bridge.flushUrgent();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].tabId).toBe('t-unico');
    expect(sent[0].text).toContain('quadro atlas');
    expect(sent[0].text).toContain('Voltaram na mesma conversa (1): Dev (place:dev)');
    expect(sent[0].text).toContain('Revisor (place:rev): não deu sinal em 3 min');
  });
});
