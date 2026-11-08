import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, recordTurnEnd, resetNewsCursors, runLedgerTool, urgentLedgerNotice, type LedgerCaller, type LedgerService } from '../src/main/ledger-store';
import { parseLedgerDoc } from '../src/shared/ledger/contract';
import { progressOf } from '../src/shared/ledger/andamento';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';
import type { LedgerTurnRecord } from '../src/shared/ledger/channels';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation, type MindscapeDoc } from '../src/shared/mindscape/model';
import { FACTORY_ROLES } from '../src/shared/roles';
import type { SemaphoreState } from '../src/shared';
import type { TurnNotices } from '../src/shared/teamPrefs';
import * as v4 from './fixtures/ledger/contract-v4';

// Andamento no ledger (dono, 08/11: "Eles devem atualizar diretamente o ledger, né. Em vez de te notificar a cada
// instante"). What breaks without the owner seeing it: a turn that reaches the Líder's chat again (it drowns), a
// record that never lands in the ledger (the Líder loses the session), and a session stuck on the usage limit that
// nobody hears about (it waits forever).

const BOARD = 'C:/proj/atlas';
const LIDER = 'place:lider';
const DEVS = ['place:dev1', 'place:dev2', 'place:dev3'] as const;

const dirs: string[] = [];
beforeEach(() => resetNewsCursors());
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

/** The board of the owner: a Líder he put there, and three Devs below it; plus the Líder único (Jobu) open. */
function boardDoc(): MindscapeDoc {
  let doc = addPlace(emptyMindscapeDoc(), BOARD, { id: LIDER, roleId: 'lider' });
  doc = setPlaceConversation(doc, BOARD, LIDER, 'conv-lider');
  for (const [i, dev] of DEVS.entries()) {
    doc = addPlace(doc, BOARD, { id: dev, roleId: 'dev', by: 'session' });
    doc = setPlaceConversation(doc, BOARD, dev, `conv-dev${i + 1}`);
    doc = addLink(doc, BOARD, { id: `l${i}`, from: LIDER, to: dev, arrow: true, by: 'session', opened: true });
  }
  return doc;
}

interface Team {
  readonly bridge: AgentBridge;
  readonly sent: { tabId: string; text: string }[];
  readonly service: LedgerService;
  readonly file: string;
  readonly states: Record<string, SemaphoreState>;
  readonly failures: Record<string, string | undefined>;
  readonly records: Promise<unknown>[];
  /** Tabs whose process left. */
  readonly closed: Set<string>;
  mode: TurnNotices;
}

async function team(): Promise<Team> {
  const dir = mkdtempSync(join(tmpdir(), 'andamento-'));
  dirs.push(dir);
  const file = join(dir, 'ledger.json');
  let clock = Date.UTC(2026, 10, 8, 12);
  const service = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 60_000) });
  const doc = boardDoc();
  const tabs: BridgeTab[] = [
    { id: 'tab-unico', name: 'Líder', cwd: 'C:/proj', roleId: 'lider', leaderOfAll: true, sessionType: 'claude' },
    { id: 'tab-lider', name: 'Líder', cwd: BOARD, projectName: 'atlas', roleId: 'lider', claudeSessionId: 'conv-lider', sessionType: 'claude' },
    ...DEVS.map((_dev, i): BridgeTab => ({ id: `tab-dev${i + 1}`, name: `Dev ${i + 1}`, cwd: BOARD, projectName: 'atlas', roleId: 'dev', claudeSessionId: `conv-dev${i + 1}`, openedBy: i === 2 ? 'lider' : LIDER, sessionType: 'claude' })),
  ];
  const sent: { tabId: string; text: string }[] = [];
  const states: Record<string, SemaphoreState> = {};
  const failures: Record<string, string | undefined> = {};
  const records: Promise<unknown>[] = [];
  const closed = new Set<string>();
  const state: Team = { bridge: undefined as unknown as AgentBridge, sent, service, file, states, failures, records, closed, mode: 'ledger' };
  const ports: AgentBridgePorts = {
    loaded: true,
    doc: () => doc,
    applyGesture: () => undefined,
    tabs: () => tabs,
    tabOfPty: (ptyId) => tabs.find((tab) => `pty-${tab.id}` === ptyId),
    stateOf: (tabId) => (closed.has(tabId) ? undefined : (states[tabId] ?? 'working')),
    roles: () => FACTORY_ROLES,
    openSession: () => 'unused',
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
    projects: () => [{ path: BOARD, name: 'atlas' }],
    turnNotices: () => state.mode,
    recordTurn: (record: LedgerTurnRecord) => void records.push(recordTurnEnd(service, record)),
    turnFailureOf: (tabId) => failures[tabId],
  };
  const bridge = new AgentBridge(ports);
  // Each Dev owns a live task, created by the Líder and taken by the Dev.
  const lider = caller(LIDER, 'lider');
  for (const dev of DEVS) {
    const created = await runLedgerTool(service, lider, call('tarefa_criar', { pedido: `parte de ${dev}`, criterio: 'teste verde', prazo: '2026-11-08', dono: dev, risco: 'baixo', titulo: `Parte ${dev.slice(-1)}` }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service, caller(dev, 'dev'), call('tarefa_assumir', { id }));
  }
  return Object.assign(state, { bridge });
}

function caller(placeId: string, roleId: string): LedgerCaller {
  return { projectPath: BOARD, placeId, roleId, boardPlaceIds: [LIDER, ...DEVS] };
}

describe('andamento no ledger, não no chat do Líder', () => {
  it('3 sessões terminam turnos: nenhum aviso no chat, o ledger tem os 3 registros e a leitura resumida os mostra', async () => {
    const t = await team();
    t.bridge.turnEnded('conv-dev1', 'Escrevi o teste do contrato.\nFalta o build.');
    t.bridge.turnEnded('conv-dev2', 'PR aberto, esperando o Revisor.');
    t.bridge.turnEnded('conv-dev3', 'Li o código do quadro.');
    await Promise.all(t.records);

    expect(t.sent).toEqual([]); // nem o Líder do quadro nem o Líder único

    const doc = parseLedgerDoc(JSON.parse(readFileSync(t.file, 'utf8')));
    const records = Object.values(doc.tasks).flatMap((task) => task.events.map((event) => ({ owner: task.ownerPlaceId, progress: progressOf(event) }))).filter((each) => each.progress);
    expect(records.map((each) => each.owner).sort()).toEqual([...DEVS]);
    expect(records.find((each) => each.owner === 'place:dev1')!.progress).toEqual({ estado: 'turno-encerrado', resumo: 'Escrevi o teste do contrato. Falta o build.' });

    const read = await runLedgerTool(t.service, caller(LIDER, 'lider'), call('tarefa_novidades', {}));
    expect(read.ok).toBe(true);
    const news = JSON.parse(read.text) as { grupos: { lugar: string; agora?: string; itens: string[] }[] };
    expect(news.grupos.map((group) => group.lugar).sort()).toEqual([...DEVS]);
    expect(news.grupos.find((group) => group.lugar === 'place:dev2')!.agora).toBe('turno-encerrado; PR aberto, esperando o Revisor.');

    // The cursor moved: a second read has nothing new; a new record shows up alone.
    expect(JSON.parse((await runLedgerTool(t.service, caller(LIDER, 'lider'), call('tarefa_novidades', {}))).text)).toMatchObject({ nada: expect.any(String) });
    await runLedgerTool(t.service, caller('place:dev3', 'dev'), call('tarefa_andamento', { estado: 'esperando', precisa: 'revisão do PR', prova: 'npm run verify verde', proximo: 'mesclar' }));
    const again = JSON.parse((await runLedgerTool(t.service, caller(LIDER, 'lider'), call('tarefa_novidades', {}))).text) as { grupos: { lugar: string; agora?: string }[] };
    expect(again.grupos).toEqual([expect.objectContaining({ lugar: 'place:dev3', agora: 'esperando; precisa: revisão do PR; prova: npm run verify verde; próximo: mesclar' })]);
  });

  it('sessão travada por limite de conta avisa o Líder do quadro na hora, uma vez — mesmo a aberta pelo Líder único', async () => {
    const t = await team();
    t.states['tab-dev2'] = 'waiting';
    t.failures['tab-dev2'] = 'rate_limit';
    t.bridge.attention('tab-dev2');
    t.bridge.attention('tab-dev2'); // the same situation again: told once
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ tabId: 'tab-lider' });
    expect(t.sent[0]!.text).toMatch(/^◆ Dev Dev 2 \(place:dev2\) está travada: limite de uso/);

    // The Dev 3 was opened by the Líder único; its permission still goes to the Líder of its board.
    t.states['tab-dev3'] = 'permission';
    t.bridge.attention('tab-dev3');
    expect(t.sent[1]).toMatchObject({ tabId: 'tab-lider', text: expect.stringContaining('precisa do dono') });

    // Cleared and stuck again: told again.
    t.failures['tab-dev2'] = undefined;
    t.states['tab-dev2'] = 'working';
    t.bridge.attention('tab-dev2');
    t.states['tab-dev2'] = 'waiting';
    t.failures['tab-dev2'] = 'authentication_failed';
    t.bridge.attention('tab-dev2');
    expect(t.sent[2]).toMatchObject({ tabId: 'tab-lider', text: expect.stringContaining('login expirado') });
  });

  it('o Líder único só ouve o Líder do quadro (ou um quadro sem Líder aberto)', async () => {
    const t = await team();
    t.states['tab-lider'] = 'permission';
    t.bridge.attention('tab-lider');
    expect(t.sent).toEqual([{ tabId: 'tab-unico', text: expect.stringMatching(/^◆ Líder Líder \(place:lider, quadro atlas\) precisa do dono/) }]);

    // With the board's Líder closed, a stuck Dev reaches the Líder único, saying the board.
    t.closed.add('tab-lider');
    t.states['tab-dev1'] = 'waiting';
    t.failures['tab-dev1'] = 'rate_limit';
    t.bridge.attention('tab-dev1');
    expect(t.sent[1]).toMatchObject({ tabId: 'tab-unico', text: expect.stringContaining('quadro atlas') });
  });

  it('entrega para aceite e andamento "travada" chegam na hora; o resto fica só no ledger', async () => {
    const t = await team();
    expect(urgentLedgerNotice(call('tarefa_entregar', { id: 't-1', provas: [{ tipo: 'texto', texto: 'ok' }] }), JSON.stringify({ entregue: true, id: 't-1' }))).toMatch(/entregou a tarefa t-1 para aceite/);
    expect(urgentLedgerNotice(call('tarefa_andamento', { estado: 'travada', precisa: 'login na conta' }), JSON.stringify({ registrado: true, id: 't-1' }))).toBe('está travada (tarefa t-1): login na conta.');
    expect(urgentLedgerNotice(call('tarefa_andamento', { estado: 'trabalhando' }), JSON.stringify({ registrado: true, id: 't-1' }))).toBeNull();

    const answer = await t.bridge.handle('pty-tab-dev1', { tool: 'aviso_imediato', texto: 'entregou a tarefa t-1 para aceite.' });
    expect(answer.ok).toBe(true);
    expect(t.sent).toEqual([{ tabId: 'tab-lider', text: '◆ Dev Dev 1 (place:dev1) entregou a tarefa t-1 para aceite.' }]);
  });

  it('o registro do fim do turno não repete o que a sessão registrou no mesmo turno', async () => {
    const t = await team();
    t.bridge.turnEnded('conv-dev1', 'turno 1');
    await Promise.all(t.records.splice(0));
    await runLedgerTool(t.service, caller('place:dev1', 'dev'), call('tarefa_andamento', { estado: 'pronta', prova: 'PR #1' }));
    t.bridge.turnEnded('conv-dev1', 'turno 2');
    expect(await Promise.all(t.records.splice(0))).toEqual(['ja-registrado']);
    t.bridge.turnEnded('conv-dev1', 'turno 3');
    expect(await Promise.all(t.records.splice(0))).toEqual(['registrado']);
  });

  it('só o lugar dono registra, e um Alfa v4 aberto ao lado lê e regrava o registro sem perdê-lo', async () => {
    const t = await team();
    const other = await runLedgerTool(t.service, caller('place:dev2', 'dev'), call('tarefa_andamento', { estado: 'trabalhando', id: Object.values(parseLedgerDoc(JSON.parse(readFileSync(t.file, 'utf8'))).tasks).find((task) => task.ownerPlaceId === 'place:dev1')!.id }));
    expect(other.ok).toBe(false);
    await runLedgerTool(t.service, caller('place:dev1', 'dev'), call('tarefa_andamento', { estado: 'precisa-do-dono', precisa: 'decidir ⟦a cor⟧' }));
    const raw = JSON.parse(readFileSync(t.file, 'utf8')) as unknown;
    const rewritten = JSON.parse(JSON.stringify(v4.parseLedgerDoc(raw))) as unknown; // what the Alfa 0.4.0 writes back
    const events = Object.values(parseLedgerDoc(rewritten).tasks).flatMap((task) => task.events);
    expect(events.map(progressOf).filter(Boolean)).toEqual([{ estado: 'precisa-do-dono', precisa: 'decidir a cor' }]);
  });

  it('modo antigo (Preferências): o "◆ … terminou" volta ao chat e nada vai ao ledger', async () => {
    const t = await team();
    t.mode = 'chat';
    t.bridge.turnEnded('conv-dev1', 'turno no modo antigo');
    expect(t.records).toEqual([]);
    expect(t.sent).toEqual([{ tabId: 'tab-lider', text: '◆ Dev Dev 1 (place:dev1) terminou: turno no modo antigo' }]);
  });
});
