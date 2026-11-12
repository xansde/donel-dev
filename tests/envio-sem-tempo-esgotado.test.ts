import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createBoardBridge } from '../src/main/board-bridge';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { MINDSCAPE_CHANNELS, type MindscapeBoardRequest } from '../src/shared/mindscape/channels';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation } from '../src/shared/mindscape/model';
import { FACTORY_ROLES } from '../src/shared/roles';

// 12/11 (t-58d7c191) — sessao_enviar voltava "The operation timed out.": o CLI corta a chamada MCP aos 60 s quando o
// config não traz "timeout" (toda sessão aberta por um app anterior ao #386 e toda sessão viva desde então), e o app
// esperava até 90 s pela entrega (+20 s pela aba de quem chama; o main só desistia aos 180 s). Na Homologações, 150
// envios assim desde 09/11, mediana 60,8 s. Quem ouve "timed out" manda de novo, e a mensagem sai duas vezes.

/** The CLI's own cut on an MCP call when its config brings no `timeout` (claude 2.1.3xx). */
const CLI_CUT_MS = 60_000;

afterEach(() => vi.useRealTimers());

function bridgeWith(answer: (request: MindscapeBoardRequest, respond: (text: string, ok?: boolean) => void) => void) {
  const ipcMain = new EventEmitter();
  const sender = {};
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, request: MindscapeBoardRequest) => {
        if (channel !== MINDSCAPE_CHANNELS.boardRequest) return;
        answer(request, (text, ok = true) => ipcMain.emit(MINDSCAPE_CHANNELS.boardRespond, { sender }, { requestId: request.requestId, ok, text }));
      },
    },
  };
  return createBoardBridge({ ipcMain: ipcMain as never, getWindow: () => window as never, isMainSender: (candidate) => candidate === sender });
}

/** A Dev with an arrow to a Revisor whose CLI never takes the message (mid-turn, a loaded place): `deliverLine` waits it all. */
function agentBridge(): AgentBridge {
  const atlas = 'C:/proj/atlas';
  let doc = addPlace(emptyMindscapeDoc(), atlas, { id: 'place:dev', roleId: 'dev' });
  doc = addPlace(doc, atlas, { id: 'place:revisor', roleId: 'revisor', by: 'session' });
  doc = setPlaceConversation(doc, atlas, 'place:dev', 'conv-dev');
  doc = setPlaceConversation(doc, atlas, 'place:revisor', 'conv-revisor');
  doc = addLink(doc, atlas, { id: 'l1', from: 'place:dev', to: 'place:revisor', arrow: true });
  const tabs: BridgeTab[] = ['dev', 'revisor'].map((name) => ({ id: `tab-${name}`, name, cwd: atlas, projectName: 'atlas', claudeSessionId: `conv-${name}`, sessionType: 'claude' as const }));
  const ports: AgentBridgePorts = {
    loaded: true,
    doc: () => doc,
    applyGesture: () => {},
    tabs: () => tabs,
    tabOfPty: (ptyId) => tabs.find((tab) => tab.id === `tab-${ptyId}`),
    stateOf: () => 'working',
    roles: () => FACTORY_ROLES,
    openSession: () => 'tab-new',
    closeTab: () => {},
    sendLine: () => {},
    deliverLine: (_tabId, _text, waitMs) => new Promise((resolve) => setTimeout(() => resolve({ kind: 'enviando' }), waitMs)),
    permissionOnScreen: () => false,
    unconfirmed: () => false,
    startTrouble: () => null,
    askOwner: async () => true,
    remoteLabel: (id) => id,
    remotes: () => [],
    projects: () => [{ path: atlas, name: 'atlas' }],
  };
  return new AgentBridge(ports);
}

it('o envio que ainda não entrou responde antes do corte de 60 s do CLI, mesmo com o PC lento para passar o pedido à tela', async () => {
  vi.useFakeTimers();
  const renderer = agentBridge();
  const lagMs = 15_000; // a loaded PC: the request reaches the renderer late
  const bridge = bridgeWith((request, respond) => {
    setTimeout(() => void renderer.handle(request.ptyId, request.call, request.answerBy).then((answer) => respond(answer.text, answer.ok)), lagMs);
  });
  let answered: { kind: string; text: string } | undefined;
  void bridge.execute('dev', { tool: 'sessao_enviar', para: 'place:revisor', texto: 'revisa o PR' }).then((outcome) => {
    answered = outcome as { kind: string; text: string };
  });
  await vi.advanceTimersByTimeAsync(CLI_CUT_MS - 10_000);
  expect(answered).toMatchObject({ kind: 'text' });
  expect(answered!.text).toMatch(/Ainda não entrou/);
  expect(answered!.text).toMatch(/NÃO mande de novo/);
});

it('com a tela travada de verdade, o main ainda responde antes do corte de 60 s, com o aviso de conferir antes de repetir', async () => {
  vi.useFakeTimers();
  const bridge = bridgeWith(() => {});
  let answered: { kind: string; text: string } | undefined;
  void bridge.execute('pty-1', { tool: 'sessao_enviar', para: 'place:dev', texto: 'roda o verify' }).then((outcome) => {
    answered = outcome as { kind: string; text: string };
  });
  await vi.advanceTimersByTimeAsync(CLI_CUT_MS - 5_000);
  expect(answered?.kind).toBe('error');
  expect(answered?.text).toMatch(/pode ter entrado/);
});

it('a resposta da tela que chega a tempo vai a quem enviou como veio', async () => {
  vi.useFakeTimers();
  const bridge = bridgeWith((_request, respond) => setTimeout(() => respond('Entregue: entrou no Claude de lá.'), 30_000));
  const outcome = bridge.execute('pty-1', { tool: 'sessao_enviar', para: 'place:dev', texto: 'roda o verify' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await outcome).toEqual({ kind: 'text', text: 'Entregue: entrou no Claude de lá.' });
});
