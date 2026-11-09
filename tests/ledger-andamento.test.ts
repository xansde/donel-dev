import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentBridge, type AgentBridgePorts, type BridgeTab, type DeliveryOutcome } from '../src/renderer/src/Mindscape/agentBridge';
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
import { LEADER_OF_ALL } from '../src/shared/mindscape/leader';
import { FAXINEIRO_OPENER } from '../src/shared/faxineiro/triggers';
import * as v4 from './fixtures/ledger/contract-v4';

// Andamento no ledger (dono, 08/11: "Eles devem atualizar diretamente o ledger, né. Em vez de te notificar a cada
// instante"). What breaks without the owner seeing it: a turn that reaches the Líder's chat again (it drowns), a
// record that never lands in the ledger (the Líder loses the session), and a session stuck on the usage limit that
// nobody hears about (it waits forever).

const BOARD = 'C:/proj/atlas';
const LIDER = 'place:lider';
const DEVS = ['place:dev1', 'place:dev2', 'place:dev3'] as const;
/** A Revisor working by request, with no task of its own in the ledger; the Líder único opened it. */
const REV = 'place:rev';
/** The Faxineiro of the board: its rounds have no task. */
const FAX = 'place:fax';

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

/**
 * The board of the owner: a Líder he put there, and three Devs below it; plus the Líder único (Jobu) open. With
 * `liderDoUnico`, the Líder of the board is one the Líder único opened (a place made by a session), as on 09/11.
 */
function boardDoc(liderDoUnico = false, segundoLider = false): MindscapeDoc {
  let doc = addPlace(emptyMindscapeDoc(), BOARD, { id: LIDER, roleId: 'lider', ...(liderDoUnico ? { by: 'session' as const } : {}) });
  doc = setPlaceConversation(doc, BOARD, LIDER, 'conv-lider');
  for (const [i, dev] of DEVS.entries()) {
    doc = addPlace(doc, BOARD, { id: dev, roleId: 'dev', by: 'session' });
    doc = setPlaceConversation(doc, BOARD, dev, `conv-dev${i + 1}`);
    doc = addLink(doc, BOARD, { id: `l${i}`, from: LIDER, to: dev, arrow: true, by: 'session', opened: true });
  }
  doc = addPlace(doc, BOARD, { id: REV, roleId: 'revisor', by: 'session' });
  doc = setPlaceConversation(doc, BOARD, REV, 'conv-rev');
  if (segundoLider) doc = setPlaceConversation(addPlace(doc, BOARD, { id: 'place:lider2', roleId: 'lider', by: 'session' }), BOARD, 'place:lider2', 'conv-lider2');
  doc = addPlace(doc, BOARD, { id: FAX, roleId: 'faxineiro', by: 'session' });
  return setPlaceConversation(doc, BOARD, FAX, 'conv-fax');
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
  /** Remote tabs whose ssh dropped ("sem ligação"). */
  readonly linkLost: Set<string>;
  /** Tabs that sent no hook since the app opened (`unconfirmed`). */
  readonly mute: Set<string>;
  /** The next answers of the destination's CLI (default: it took the line). */
  readonly outcomes: DeliveryOutcome[];
  mode: TurnNotices;
}

/** Lets the ledger writes and the deliveries that follow them run. */
async function settle(t: Team): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.all(t.records.splice(0));
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function progressRecords(t: Team): { owner: string; progress: NonNullable<ReturnType<typeof progressOf>> }[] {
  const doc = parseLedgerDoc(JSON.parse(readFileSync(t.file, 'utf8')));
  return Object.values(doc.tasks).flatMap((task) => task.events.flatMap((event) => {
    const progress = progressOf(event);
    return progress ? [{ owner: task.ownerPlaceId, progress }] : [];
  }));
}

async function team(options: { readonly liderDoUnico?: boolean; readonly segundoLider?: boolean } = {}): Promise<Team> {
  const dir = mkdtempSync(join(tmpdir(), 'andamento-'));
  dirs.push(dir);
  const file = join(dir, 'ledger.json');
  let clock = Date.UTC(2026, 10, 8, 12);
  const service = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 60_000) });
  const doc = boardDoc(options.liderDoUnico, options.segundoLider);
  const tabs: BridgeTab[] = [
    { id: 'tab-unico', name: 'Líder', cwd: 'C:/proj', roleId: 'lider', leaderOfAll: true, sessionType: 'claude' },
    { id: 'tab-lider', name: 'Líder', cwd: BOARD, projectName: 'atlas', roleId: 'lider', claudeSessionId: 'conv-lider', ...(options.liderDoUnico ? { openedBy: LEADER_OF_ALL } : {}), sessionType: 'claude' },
    ...DEVS.map((_dev, i): BridgeTab => ({ id: `tab-dev${i + 1}`, name: `Dev ${i + 1}`, cwd: BOARD, projectName: 'atlas', roleId: 'dev', claudeSessionId: `conv-dev${i + 1}`, openedBy: i === 2 ? 'lider' : LIDER, sessionType: 'claude' })),
    { id: 'tab-rev', name: 'Revisor', cwd: BOARD, projectName: 'atlas', roleId: 'revisor', claudeSessionId: 'conv-rev', openedBy: 'lider', sessionType: 'claude' },
    ...(options.segundoLider ? [{ id: 'tab-lider2', name: 'Líder 2', cwd: BOARD, projectName: 'atlas', roleId: 'lider', claudeSessionId: 'conv-lider2', openedBy: LEADER_OF_ALL, sessionType: 'claude' as const }] : []),
    { id: 'tab-fax', name: 'Faxineiro', cwd: BOARD, projectName: 'atlas', roleId: 'faxineiro', claudeSessionId: 'conv-fax', openedBy: FAXINEIRO_OPENER, sessionType: 'claude' },
  ];
  const sent: { tabId: string; text: string }[] = [];
  const states: Record<string, SemaphoreState> = {};
  const failures: Record<string, string | undefined> = {};
  const records: Promise<unknown>[] = [];
  const closed = new Set<string>();
  const linkLost = new Set<string>();
  const mute = new Set<string>();
  const outcomes: DeliveryOutcome[] = [];
  const state: Team = { bridge: undefined as unknown as AgentBridge, sent, service, file, states, failures, records, closed, linkLost, mute, outcomes, mode: 'ledger' };
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
      const outcome = outcomes.shift() ?? { kind: 'entrou' };
      if (outcome.kind !== 'nao-foi') sent.push({ tabId, text });
      return outcome;
    },
    linkLost: (tabId) => linkLost.has(tabId),
    permissionOnScreen: () => false,
    unconfirmed: (tabId) => mute.has(tabId),
    startTrouble: () => null,
    askOwner: async () => true,
    remoteLabel: (id) => id,
    remotes: () => [],
    projects: () => [{ path: BOARD, name: 'atlas' }],
    turnNotices: () => state.mode,
    recordTurn: (record: LedgerTurnRecord) => {
      const written = recordTurnEnd(service, record);
      records.push(written);
      return written;
    },
    turnFailureOf: (tabId) => failures[tabId],
  };
  const bridge = new AgentBridge(ports);
  if (options.liderDoUnico) bridge.adoptOpened('tab-lider', LEADER_OF_ALL);
  // Each Dev owns a live task, created by the Líder and taken by the Dev.
  const lider = caller(LIDER, 'lider');
  for (const dev of DEVS) {
    const created = await runLedgerTool(service, lider, call('tarefa_criar', { pedido: `parte de ${dev}`, criterio: 'teste verde', prazo: '2026-11-08', dono: dev, risco: 'baixo', titulo: `Parte ${dev.slice(-1)}` }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service, caller(dev, 'dev'), call('tarefa_assumir', { id }));
  }
  return Object.assign(state, { bridge });
}

async function handleAs(t: Team, ptyId: string, call: Parameters<AgentBridge['handle']>[1]): Promise<void> {
  const answer = await t.bridge.handle(ptyId, call);
  if (!answer.ok) throw new Error(answer.text);
}

function caller(placeId: string, roleId: string): LedgerCaller {
  return { projectPath: BOARD, placeId, roleId, boardPlaceIds: [LIDER, ...DEVS, REV] };
}

describe('andamento no ledger, não no chat do Líder', () => {
  it('3 sessões terminam turnos: nenhum aviso no chat, o ledger tem os 3 registros e a leitura resumida os mostra', async () => {
    const t = await team();
    t.bridge.turnEnded('conv-dev1', 'Escrevi o teste do contrato.\nFalta o build.');
    t.bridge.turnEnded('conv-dev2', 'PR aberto, esperando o Revisor.');
    t.bridge.turnEnded('conv-dev3', 'Li o código do quadro.');
    await settle(t);

    expect(t.sent).toEqual([]); // nem o Líder do quadro nem o Líder único

    const records = progressRecords(t);
    expect(records.map((each) => each.owner).sort()).toEqual([...DEVS]);
    expect(records.find((each) => each.owner === 'place:dev1')?.progress).toEqual({ estado: 'turno-encerrado', resumo: 'Escrevi o teste do contrato. Falta o build.' });

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
    await settle(t);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ tabId: 'tab-lider' });
    expect(t.sent[0]!.text).toMatch(/^◆ Dev Dev 2 \(place:dev2\) está travada: limite de uso/);

    // The Dev 3 was opened by the Líder único; its permission still goes to the Líder of its board.
    t.states['tab-dev3'] = 'permission';
    t.bridge.attention('tab-dev3');
    await settle(t);
    expect(t.sent[1]).toMatchObject({ tabId: 'tab-lider', text: expect.stringContaining('precisa do dono') });

    // Cleared and stuck again: told again.
    t.failures['tab-dev2'] = undefined;
    t.states['tab-dev2'] = 'working';
    t.bridge.attention('tab-dev2');
    t.states['tab-dev2'] = 'waiting';
    t.failures['tab-dev2'] = 'authentication_failed';
    t.bridge.attention('tab-dev2');
    await settle(t);
    expect(t.sent[2]).toMatchObject({ tabId: 'tab-lider', text: expect.stringContaining('login expirado') });
  });

  it('o Líder único só ouve o que o Líder do quadro não resolve: o bloqueio do próprio Líder e o término que ele entrega', async () => {
    const t = await team();
    t.states['tab-lider'] = 'permission';
    t.bridge.attention('tab-lider');
    await settle(t);
    expect(t.sent).toEqual([{ tabId: 'tab-unico', text: expect.stringMatching(/^◆ Líder Líder \(place:lider, quadro atlas\) precisa do dono/) }]);
    await t.bridge.handle('pty-tab-lider', { tool: 'aviso_imediato', texto: 'entregou a tarefa t-9 para aceite.' });
    await settle(t);
    expect(t.sent[1]).toEqual({ tabId: 'tab-unico', text: '◆ Líder Líder (place:lider, quadro atlas) entregou a tarefa t-9 para aceite.' });

    // Dono, 09/11: with the board's Líder closed, the Líder único still hears the board's deliveries and locks (its job
    // is "receber término de tasks completas"), never an end of turn nor a round of the Faxineiro.
    t.sent.splice(0);
    t.closed.add('tab-lider');
    t.states['tab-dev1'] = 'waiting';
    t.failures['tab-dev1'] = 'rate_limit';
    t.bridge.attention('tab-dev1');
    t.bridge.turnEnded('conv-rev', 'Revisei o #330.');
    t.bridge.turnEnded('conv-fax', 'Ronda: 2 sessões paradas, nada a fechar.');
    await handleAs(t, 'pty-tab-dev2', { tool: 'aviso_imediato', texto: 'entregou a tarefa t-2 para aceite.' });
    await settle(t);
    expect(t.sent).toEqual([
      { tabId: 'tab-unico', text: expect.stringMatching(/^◆ Dev Dev 1 \(place:dev1, quadro atlas\) está travada/) },
      { tabId: 'tab-unico', text: '◆ Dev Dev 2 (place:dev2, quadro atlas) entregou a tarefa t-2 para aceite.' },
    ]);

    // The end of turn waited for the Líder of the board; the round of the Faxineiro went nowhere.
    t.closed.delete('tab-lider');
    t.bridge.flushUrgent();
    await settle(t);
    expect(t.sent.slice(2)).toEqual([{ tabId: 'tab-lider', text: '◆ Revisor Revisor (place:rev) terminou: Revisei o #330.' }]);
  });

  it('Líder do quadro aberto mas mudo desde que o app abriu: a trava da cadeira vai ao Líder único, o fim de turno espera por ele', async () => {
    const t = await team();
    t.mute.add('tab-lider');
    t.states['tab-dev1'] = 'permission';
    t.bridge.attention('tab-dev1');
    t.bridge.turnEnded('conv-rev', 'Revisei o #330.');
    await settle(t);
    expect(t.sent).toEqual([
      { tabId: 'tab-unico', text: expect.stringMatching(/^◆ Dev Dev 1 \(place:dev1, quadro atlas\) precisa do dono/) },
      { tabId: 'tab-lider', text: '◆ Revisor Revisor (place:rev) terminou: Revisei o #330.' },
    ]);
  });

  it('quadro com o Líder que o Líder único abriu: as cadeiras falam com ele, nunca com o Líder único', async () => {
    const t = await team({ liderDoUnico: true });
    t.states['tab-dev2'] = 'waiting';
    t.failures['tab-dev2'] = 'rate_limit';
    t.bridge.attention('tab-dev2');
    t.bridge.turnEnded('conv-rev', 'Revisei o #330.');
    t.bridge.turnEnded('conv-fax', 'Ronda: nada a fechar.');
    await settle(t);
    expect(t.sent.map((each) => each.tabId)).toEqual(['tab-lider', 'tab-lider']);
    expect(t.sent[0]!.text).toMatch(/^◆ Dev Dev 2 \(place:dev2\) está travada/);
    expect(t.sent[1]!.text).toBe('◆ Revisor Revisor (place:rev) terminou: Revisei o #330.');

    // The Líder's own end of turn (no task) does not go back to the Líder único that opened it.
    t.bridge.turnEnded('conv-lider', 'Repassei ao Dev 1.');
    await settle(t);
    expect(t.sent.filter((each) => each.tabId === 'tab-unico')).toEqual([]);

    // "lider-quadro" finds it.
    const answer = await t.bridge.handle('pty-tab-dev1', { tool: 'sessao_enviar', para: 'lider-quadro', texto: 'preciso do Revisor' });
    expect(answer).toMatchObject({ ok: true });
    expect(t.sent.at(-1)).toMatchObject({ tabId: 'tab-lider', text: expect.stringContaining('preciso do Revisor') });
  });

  it('com Líder do dono no quadro, um lugar Líder feito por sessão é cadeira: o bloqueio e o fim de turno dele vão ao Líder do dono', async () => {
    const t = await team({ segundoLider: true });
    t.states['tab-lider2'] = 'permission';
    t.bridge.attention('tab-lider2');
    t.bridge.turnEnded('conv-lider2', 'Repassei.');
    await settle(t);
    expect(t.sent.map((each) => each.tabId)).toEqual(['tab-lider', 'tab-lider']);
  });

  it('entrega para aceite e andamento "travada" chegam na hora; o resto fica só no ledger', async () => {
    const t = await team();
    expect(urgentLedgerNotice(call('tarefa_entregar', { id: 't-1', provas: [{ tipo: 'texto', texto: 'ok' }] }), JSON.stringify({ entregue: true, id: 't-1' }))).toMatch(/entregou a tarefa t-1 para aceite/);
    expect(urgentLedgerNotice(call('tarefa_andamento', { estado: 'travada', precisa: 'login na conta' }), JSON.stringify({ registrado: true, id: 't-1' }))).toBe('está travada (tarefa t-1): login na conta.');
    expect(urgentLedgerNotice(call('tarefa_andamento', { estado: 'trabalhando' }), JSON.stringify({ registrado: true, id: 't-1' }))).toBeNull();

    const answer = await t.bridge.handle('pty-tab-dev1', { tool: 'aviso_imediato', texto: 'entregou a tarefa t-1 para aceite.' });
    expect(answer.ok).toBe(true);
    await settle(t);
    expect(t.sent).toEqual([{ tabId: 'tab-lider', text: '◆ Dev Dev 1 (place:dev1) entregou a tarefa t-1 para aceite.' }]);
  });

  it('aviso imediato sem nenhum Líder aberto fica no ledger e chega quando um Líder abre, uma vez', async () => {
    const t = await team();
    t.closed.add('tab-lider');
    t.closed.add('tab-unico');
    t.states['tab-dev2'] = 'waiting';
    t.failures['tab-dev2'] = 'rate_limit';
    t.bridge.attention('tab-dev2');
    await settle(t);
    expect(t.sent).toEqual([]);
    expect(progressRecords(t)).toEqual([{ owner: 'place:dev2', progress: { estado: 'travada', precisa: 'está travada: limite de uso (o turno parou e não segue sozinho) (aviso pendente: nenhum Líder aberto)' } }]);

    // The Líder of the board opens: its state shows up, the App calls attention for every tab.
    t.closed.delete('tab-lider');
    t.states['tab-lider'] = 'waiting';
    for (const tabId of ['tab-lider', 'tab-dev2']) t.bridge.attention(tabId);
    await settle(t);
    t.bridge.flushUrgent();
    await settle(t);
    expect(t.sent).toEqual([{ tabId: 'tab-lider', text: expect.stringMatching(/^◆ Dev Dev 2 \(place:dev2\) está travada: limite de uso/) }]);
  });

  it('Líder "sem ligação" ou CLI que não pegou a linha: o aviso espera e vai quando ele volta', async () => {
    const t = await team();
    t.linkLost.add('tab-lider');
    t.linkLost.add('tab-unico');
    t.states['tab-dev1'] = 'permission';
    t.bridge.attention('tab-dev1');
    await settle(t);
    expect(t.sent).toEqual([]);

    t.linkLost.delete('tab-lider'); // religou: nenhum estado mudou, a ronda de meio minuto tenta de novo
    t.outcomes.push({ kind: 'nao-foi', reason: 'a caixa não esvaziou' });
    t.bridge.flushUrgent();
    await settle(t);
    expect(t.sent).toEqual([]); // não entrou: segue pendente
    t.bridge.flushUrgent();
    await settle(t);
    t.bridge.flushUrgent();
    await settle(t);
    expect(t.sent).toEqual([{ tabId: 'tab-lider', text: expect.stringContaining('precisa do dono') }]);
  });

  it('sessão sem tarefa viva mantém o fim de turno no chat do Líder do quadro; com tarefa, só no ledger', async () => {
    const t = await team();
    t.bridge.turnEnded('conv-rev', 'Revisei o #324: devolvido.');
    t.bridge.turnEnded('conv-dev1', 'Corrigi o achado.');
    await settle(t);
    // The Revisor was opened by the Líder único, and still its turn goes to the Líder of its board.
    expect(t.sent).toEqual([{ tabId: 'tab-lider', text: '◆ Revisor Revisor (place:rev) terminou: Revisei o #324: devolvido.' }]);
    expect(progressRecords(t).map((each) => each.owner)).toEqual(['place:dev1']);

    // The Líder of the board has no task either: its turn keeps the old road (here, nobody holds an arrow to it).
    t.bridge.turnEnded('conv-lider', 'Repassei ao Dev.');
    await settle(t);
    expect(t.sent).toHaveLength(1);
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
