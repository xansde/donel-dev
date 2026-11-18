// Canal do Donel fora do PC (t-e195b35c), PR 5 — the PC app's side of items 5 and 13. What breaks without the owner
// noticing: the tasks of a place that renewed into a new place go up to the Líder instead of the new place; a Revisor's
// verdict that the Dev never hears (the task sits "rejeitada" until someone reads tarefa_novidades); a delivery the
// Revisor of outside the chain never hears of; a verdict heard twice; and a "para" by role that picks the wrong place.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, passOnTasks, RENEWAL_REASON, reviewLedgerNotices, runLedgerTool, type LedgerCaller, type LedgerService } from '../src/main/ledger-store';
import { AgentBridge, PASS_ON_GRACE_MS, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import type { LedgerPassOnRequest } from '../src/shared/ledger/channels';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation, type MindscapeDoc } from '../src/shared/mindscape/model';
import { FACTORY_ROLES } from '../src/shared/roles';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ATLAS = '/home/dono/seazone/atlas';
const LIDER = 'place:lider';
const DEV = 'place:dev';
const DEV2 = 'place:dev2'; // the Dev renewed into a new place: same role, opened by the same Líder
const REV = 'place:rev'; // the owner's Revisor: out of the Dev's chain

function boardDoc(withDev2 = true): MindscapeDoc {
  let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: LIDER, roleId: 'lider' });
  doc = addPlace(doc, ATLAS, { id: DEV, roleId: 'dev', by: 'session' });
  if (withDev2) doc = addPlace(doc, ATLAS, { id: DEV2, roleId: 'dev', by: 'session' });
  doc = addPlace(doc, ATLAS, { id: REV, roleId: 'revisor' });
  for (const place of [LIDER, DEV, ...(withDev2 ? [DEV2] : []), REV]) doc = setPlaceConversation(doc, ATLAS, place, `conv-${place.slice(6)}`);
  doc = addLink(doc, ATLAS, { id: 'l1', from: LIDER, to: DEV, arrow: true, by: 'session', opened: true });
  if (withDev2) doc = addLink(doc, ATLAS, { id: 'l2', from: LIDER, to: DEV2, arrow: true, by: 'session', opened: true });
  return doc;
}

function ledgerService(): LedgerService {
  const dir = mkdtempSync(join(tmpdir(), 'veredito-'));
  dirs.push(dir);
  return createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => Date.UTC(2026, 10, 18, 12) });
}

function callerOf(doc: MindscapeDoc, placeId: string, roleId: string, states: Record<string, string>): LedgerCaller {
  const board = doc.boards[ATLAS]!;
  return { projectPath: ATLAS, placeId, roleId, boardPlaceIds: Object.keys(board.cards), board, placeStates: new Map([[ATLAS, new Map(Object.entries(states))]]) };
}

const LIVE = { [LIDER]: 'trabalhando', [DEV]: 'trabalhando', [DEV2]: 'parada', [REV]: 'parada' };

/** A low-risk task of the Dev, delivered for acceptance (a Revisor of outside its chain is alive). */
async function delivered(service: LedgerService, doc: MindscapeDoc): Promise<{ id: string; answer: string }> {
  const dev = callerOf(doc, DEV, 'dev', LIVE);
  const created = await runLedgerTool(service, dev, { tool: 'tarefa_criar', pedido: 'faz', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
  const id = (JSON.parse(created.text) as { id: string }).id;
  await runLedgerTool(service, dev, { tool: 'tarefa_assumir', id });
  const answer = await runLedgerTool(service, dev, { tool: 'tarefa_entregar', id, provas: [{ tipo: 'texto', texto: 'npm test verde' }] });
  expect(JSON.parse(answer.text)).toMatchObject({ entregue: true, estado: 'entregue' });
  return { id, answer: answer.text };
}

function bridgeSetup(options: { doc?: MindscapeDoc; ledger?: LedgerService } = {}) {
  let doc = options.doc ?? boardDoc();
  const sent: { tabId: string; text: string }[] = [];
  const closed: string[] = [];
  const passOns: LedgerPassOnRequest[][] = [];
  const places = Object.values(doc.boards[ATLAS]!.cards).filter((card) => card.kind === 'session').map((card) => card.id);
  const tabs: BridgeTab[] = places.map((place) => ({
    id: `tab-${place.slice(6)}`,
    name: place.slice(6),
    cwd: ATLAS,
    projectName: 'atlas',
    claudeSessionId: `conv-${place.slice(6)}`,
    sessionType: 'claude' as const,
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
    passOn: async (requests) => {
      passOns.push([...requests]);
      return [];
    },
    ...(options.ledger ? { ledgerDoc: async () => options.ledger!.load().doc } : {}),
  };
  return { bridge: new AgentBridge(ports), sent, closed, passOns };
}

async function closeAndWait(setup: ReturnType<typeof bridgeSetup>, tabId: string): Promise<void> {
  setup.bridge.placeClosed(tabId);
  setup.closed.push(tabId);
  await vi.advanceTimersByTimeAsync(PASS_ON_GRACE_MS + 1);
}

describe('A tarefa segue a renovação (item 13)', () => {
  it('o lugar que fechou passa as tarefas ao sucessor (mesmo papel, aberto pelo mesmo lugar), não ao Líder', async () => {
    vi.useFakeTimers();
    const setup = bridgeSetup();
    await closeAndWait(setup, 'tab-dev');
    expect(setup.passOns).toEqual([[{ projectPath: ATLAS, placeId: DEV, gone: 'fechada', to: DEV2, renewal: true }]]);
  });

  it('sem sucessor único, sobe como antes (quem está acima)', async () => {
    vi.useFakeTimers();
    const setup = bridgeSetup({ doc: boardDoc(false) });
    await closeAndWait(setup, 'tab-dev');
    expect(setup.passOns).toEqual([[{ projectPath: ATLAS, placeId: DEV, gone: 'fechada', to: LIDER }]]);
  });

  it('no registro, a passagem ao sucessor diz "renovação" e o sucessor vira o dono', async () => {
    const service = ledgerService();
    const doc = boardDoc();
    const created = await runLedgerTool(service, callerOf(doc, DEV, 'dev', LIVE), { tool: 'tarefa_criar', pedido: 'faz', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
    const id = (JSON.parse(created.text) as { id: string }).id;
    const passed = await passOnTasks(service, [{ projectPath: ATLAS, placeId: DEV, gone: 'fechada', to: DEV2, renewal: true }]);
    expect(passed).toEqual([expect.objectContaining({ to: DEV2, tasks: [expect.objectContaining({ id })] })]);
    const task = service.load().doc.tasks[id]!;
    expect(task.ownerPlaceId).toBe(DEV2);
    expect(JSON.stringify(task.events.at(-1))).toContain(RENEWAL_REASON);
  });
});

describe('Veredito ao Dev e entrega ao Revisor de fora (item 5)', () => {
  it('a entrega avisa o Revisor de fora da cadeia; o aceite e a devolução avisam o dono da tarefa, uma vez só', async () => {
    const service = ledgerService();
    const doc = boardDoc();
    const { id, answer } = await delivered(service, doc);
    const dev = callerOf(doc, DEV, 'dev', LIVE);
    const deliveryNotices = reviewLedgerNotices(dev, { tool: 'tarefa_entregar', id, provas: [{ tipo: 'texto', texto: 'npm test verde' }] }, answer, service.load().doc, 'Dev (place:dev)');
    expect(deliveryNotices).toEqual([{ placeId: REV, taskId: id, text: expect.stringContaining(`tarefa_ver ${id}`) }]);

    const rev = callerOf(doc, REV, 'revisor', LIVE);
    await runLedgerTool(service, rev, { tool: 'tarefa_ver', id });
    const rejected = await runLedgerTool(service, rev, { tool: 'tarefa_rejeitar', id, motivo: 'falta o teste do caso vazio' });
    expect(rejected.ok).toBe(true);
    const call = { tool: 'tarefa_rejeitar' as const, id, motivo: 'falta o teste do caso vazio' };
    const verdict = reviewLedgerNotices(rev, call, rejected.text, service.load().doc, 'Revisor (place:rev)');
    expect(verdict).toEqual([{ placeId: DEV, taskId: id, text: expect.stringMatching(/Revisor \(place:rev\) devolveu.*falta o teste do caso vazio/) }]);

    // The same verdict again (the CLI retried): the ledger answers "repetida", and nobody hears it twice.
    const again = await runLedgerTool(service, rev, call);
    expect(JSON.parse(again.text)).toMatchObject({ repetida: true });
    expect(reviewLedgerNotices(rev, call, again.text, service.load().doc, 'Revisor (place:rev)')).toEqual([]);
  });

  it('o aviso com destino chega à aba do Dev, mesmo sem seta do Revisor para ele', async () => {
    const setup = bridgeSetup();
    const answer = await setup.bridge.handle('rev', { tool: 'aviso_imediato', texto: 'o Revisor (place:rev) aceitou t-1. Ela está fechada.', para: DEV });
    expect(answer.ok).toBe(true);
    await vi.waitFor(() => expect(setup.sent).toHaveLength(1));
    expect(setup.sent[0]).toMatchObject({ tabId: 'tab-dev', text: expect.stringContaining('aceitou t-1') });
  });
});

describe('Papel como endereço e ligação de revisão', () => {
  it('sessao_enviar com um papel chega ao lugar vivo único dele; vários vivos = erro com os ids', async () => {
    const setup = bridgeSetup();
    expect(await setup.bridge.handle('lider', { tool: 'sessao_enviar', para: 'revisor', texto: 'olha isto' })).toMatchObject({ ok: true });
    expect(setup.sent.at(-1)).toMatchObject({ tabId: 'tab-rev' });
    const many = await setup.bridge.handle('lider', { tool: 'sessao_enviar', para: 'dev', texto: 'oi' });
    expect(many.ok).toBe(false);
    expect(many.text).toContain(DEV2);
    expect(setup.sent).toHaveLength(1);
  });

  it('Revisor de fora e Dev que entregou falam sem seta enquanto a entrega espera veredito; antes disso, não', async () => {
    const service = ledgerService();
    const doc = boardDoc(false);
    const setup = bridgeSetup({ doc, ledger: service });
    expect((await setup.bridge.handle('rev', { tool: 'sessao_enviar', para: DEV, texto: 'cadê o teste?' })).ok).toBe(false);
    await delivered(service, doc);
    expect(await setup.bridge.handle('rev', { tool: 'sessao_enviar', para: DEV, texto: 'cadê o teste?' })).toMatchObject({ ok: true });
    expect(await setup.bridge.handle('dev', { tool: 'sessao_enviar', para: 'revisor', texto: 'está no PR' })).toMatchObject({ ok: true });
    expect(setup.sent.map((line) => line.tabId)).toEqual(['tab-dev', 'tab-rev']);
  });

  it('tarefa_transferir aceita o papel como "para"', async () => {
    const service = ledgerService();
    const doc = boardDoc(false);
    const dev = callerOf(doc, DEV, 'dev', { [LIDER]: 'trabalhando', [DEV]: 'trabalhando', [REV]: 'parada' });
    const created = await runLedgerTool(service, dev, { tool: 'tarefa_criar', pedido: 'faz', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
    const id = (JSON.parse(created.text) as { id: string }).id;
    const moved = await runLedgerTool(service, dev, { tool: 'tarefa_transferir', id, para: 'revisor', motivo: 'é dele' });
    expect(moved.ok).toBe(true);
    expect(service.load().doc.tasks[id]!.ownerPlaceId).toBe(REV);
  });
});
