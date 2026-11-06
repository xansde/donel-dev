import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, guardSlackSend, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { ledgerStrip, ownerQueue, type LedgerActor, type LedgerForOwner } from '../src/shared/ledger/contract';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

// Carta de Slack num toque (owner, 06/11): a Slack letter replaces the decision card of the same message. While it
// waits, "esperando você" shows only the letter; deciding it closes the card with it; nothing is deleted.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ledgerFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slack-um-toque-'));
  dirs.push(dir);
  return join(dir, 'ledger.json');
}

function service(filePath = ledgerFile()): ReturnType<typeof createLedgerService> {
  let clock = Date.UTC(2026, 10, 6, 12);
  return createLedgerService({ filePath, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const BOARD = 'C:/BizOps';
const theo: LedgerCaller = { projectPath: BOARD, placeId: 'place:theo', roleId: 'theo-west', boardPlaceIds: ['place:theo'] };
const theoActor: LedgerActor = { kind: 'lugar', placeId: 'place:theo', roleId: 'theo-west' };
const dono: LedgerActor = { kind: 'dono' };

const CARD: LedgerForOwner = {
  question: 'Respondo o Filipe?',
  summary: 'Ele montou o banco de teste e espera a sua resposta.',
  options: [
    { label: 'Mandar o rascunho', effect: 'A resposta sai como está.', closes: 'aceita', recommended: true },
    { label: 'Eu respondo', effect: 'Você escreve a resposta.', closes: 'rejeitada' },
    { label: 'Não responder', effect: 'Ninguém responde.', closes: 'rejeitada' },
  ],
  why: 'Ele está parado esperando.',
  risk: 'Ficar sem resposta atrasa a homologação.',
};

const IN_THREAD = 'https://acme.slack.com/archives/C0CBY1FRERM/p1793229369456279';
const REPLY_IN_THREAD = 'https://acme.slack.com/archives/C0BSGM5K7JA/p1793120714453479?thread_ts=1792617957.824509';
const dm = (n: number): string => `https://acme.slack.com/archives/D08R86FB4PM/p179390512991713${n}`;

/** A decision card ("Mandar o rascunho / Eu respondo / Não responder") delivered to the owner about `link`. */
function decision(ledger: ReturnType<typeof createLedgerService>, link: string): string {
  const created = ledger.apply(theoActor, { op: 'criar', projectPath: BOARD, request: `Filipe, 28/10 — ${link}\n\n«o banco de teste está pronto»`, doneWhen: 'O dono decide.', due: '2026-11-06', ownerPlaceId: 'place:theo', risk: 'alto' });
  if (!created.ok) throw new Error(created.reason);
  const id = created.task.id;
  expect(ledger.apply(theoActor, { op: 'assumir', id }).ok).toBe(true);
  const delivered = ledger.apply(theoActor, { op: 'entregar', id, proofs: [{ kind: 'texto', text: 'Rascunho: «Filipe, valeu!»' }], forOwner: CARD });
  if (!delivered.ok) throw new Error(delivered.reason);
  return id;
}

async function letter(ledger: ReturnType<typeof createLedgerService>, args: Record<string, unknown>): Promise<{ id: string; substitui?: string[] }> {
  const answer = await runLedgerTool(ledger, theo, call('carta_slack', { destino: 'C0CBY1FRERM', destinoNome: '#homologacao', texto: 'Filipe, valeu!', motivo: 'responder o Filipe', ...args }));
  if (!answer.ok) throw new Error(answer.text);
  return JSON.parse(answer.text) as { id: string; substitui?: string[] };
}

const waitingIds = (ledger: ReturnType<typeof createLedgerService>): string[] => ownerQueue(ledger.load().doc, BOARD).map((task) => task.id);

describe('carta de Slack num toque', () => {
  it('links the letter to the decision card by id, by the message link or by its own thread, and refuses a bad link', async () => {
    const ledger = service();
    const byId = decision(ledger, 'sem link');
    expect((await letter(ledger, { substitui: byId })).substitui).toEqual([byId]);

    const byLink = decision(ledger, REPLY_IN_THREAD);
    expect((await letter(ledger, { destino: 'C0BSGM5K7JA', substitui: 'https://acme.slack.com/archives/C0BSGM5K7JA/p1792617957824509' })).substitui).toEqual([byLink]);

    // No "substitui": a reply in the thread of the card's message links by itself.
    const byThread = decision(ledger, IN_THREAD);
    expect((await letter(ledger, { thread: '1793229369.456279' })).substitui).toEqual([byThread]);

    // A direct message outside a thread links only when one card of that conversation waits.
    const one = decision(ledger, dm(1));
    expect((await letter(ledger, { destino: 'D08R86FB4PM' })).substitui).toEqual([one]);
    const ledger2 = service();
    decision(ledger2, dm(2));
    decision(ledger2, dm(3));
    expect((await letter(ledger2, { destino: 'D08R86FB4PM' })).substitui).toBeUndefined();

    for (const bad of ['t-naoexiste', 'qualquer coisa']) {
      const refused = await runLedgerTool(ledger, theo, call('carta_slack', { destino: 'C1', texto: 'oi', motivo: 'x', substitui: bad }));
      expect(refused.ok, bad).toBe(false);
      expect(refused.text).toMatch(/substitui/);
    }
  });

  it('while the letter waits, "esperando você" shows only the letter (not the decision card it replaces)', async () => {
    const ledger = service();
    const card = decision(ledger, IN_THREAD);
    const other = decision(ledger, dm(1));
    expect(waitingIds(ledger)).toEqual([card, other]);
    const { id } = await letter(ledger, { thread: '1793229369.456279' });
    expect(waitingIds(ledger)).toEqual([other, id]);
    expect(ledgerStrip(ledger.load().doc, BOARD).waitingForOwner).toBe(2);
    const seen = JSON.parse((await runLedgerTool(ledger, theo, call('tarefa_ver', { id: card }))).text) as Record<string, unknown>;
    expect(seen.substituidaPor).toBe(id);
    expect(seen.esperandoDono).toBeUndefined();
  });

  it('deciding the letter closes the decision card with it, with an event and nothing deleted', async () => {
    const ledger = service();
    const sent = decision(ledger, IN_THREAD);
    const { id: sendLetter } = await letter(ledger, { thread: '1793229369.456279' });
    expect(ledger.apply(dono, { op: 'aceitar', id: sendLetter, option: 'Enviar' }).ok).toBe(true);
    let doc = ledger.load().doc;
    expect(doc.tasks[sent]!.state).toBe('aceita');
    expect(doc.tasks[sent]!.events.at(-1)).toMatchObject({ kind: 'aceita', by: { kind: 'dono' }, viaLetter: sendLetter });
    expect(doc.tasks[sent]!.events.map((event) => event.kind)).toEqual(['criada', 'assumida', 'entregue', 'aceita']);
    // Accepting is what sends: the one send of exactly this text goes through.
    expect(guardSlackSend(ledger, 'mcp__claude_ai_Slack__slack_send_message', { channel_id: 'C0CBY1FRERM', thread_ts: '1793229369.456279', message: 'Filipe, valeu!' })).toBeNull();

    const refused = decision(ledger, dm(1));
    const { id: refusedLetter } = await letter(ledger, { destino: 'D08R86FB4PM' });
    expect(ledger.apply(dono, { op: 'rejeitar', id: refusedLetter, reason: 'tira o valeu', option: 'Não enviar' }).ok).toBe(true);
    doc = ledger.load().doc;
    expect(doc.tasks[refused]!.state).toBe('rejeitada');
    expect(doc.tasks[refused]!.events.at(-1)).toMatchObject({ kind: 'rejeitada', viaLetter: refusedLetter });
    expect(doc.tasks[refused]!.events.at(-1)?.text).toContain('tira o valeu');
    expect(Object.keys(doc.tasks)).toHaveLength(4);
    expect(waitingIds(ledger)).toEqual([]);
  });

  it('the sweep links the letters written before, on a copy of the ledger with a backup first, and only once', async () => {
    const filePath = ledgerFile();
    const before = service(filePath);
    const card = decision(before, IN_THREAD);
    const untouched = decision(before, dm(1));
    const { id } = await letter(before, { thread: '1793229369.456279' });
    // As a v4 app wrote it: the letter with no link, the decision card still in "esperando você".
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { schemaVersion: number; tasks: Record<string, { slack?: Record<string, unknown> }> };
    delete raw.tasks[id]!.slack!.replaces;
    raw.schemaVersion = 4;
    const v4 = JSON.stringify(raw, null, 2);
    writeFileSync(filePath, v4);
    const ledger = service(filePath);
    expect(waitingIds(ledger)).toEqual([card, untouched, id]);

    const swept = ledger.tidy();
    expect(swept).toMatchObject({ replaced: {}, linked: { [id]: [card] }, waitingBefore: 3, waitingAfter: 2 });
    const backups = readdirSync(join(filePath, '..')).filter((name) => name.startsWith('ledger.antes-juntar-repetidas-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(filePath, '..', backups[0]!), 'utf8')).toBe(v4);
    expect(waitingIds(ledger)).toEqual([untouched, id]);
    expect(Object.keys(ledger.load().doc.tasks).sort()).toEqual(Object.keys(raw.tasks).sort());
    expect(ledger.load().doc.tasks[card]!.state).toBe('entregue');
    expect(ledger.tidy()).toMatchObject({ replaced: {}, linked: {}, backup: null });
  });
});

describe('criar é idempotente (06/11: "Tem muita carta repetida")', () => {
  const create = (caller: LedgerCaller, args: Record<string, unknown>) =>
    runLedgerTool(holder.current!, caller, call('tarefa_criar', { pedido: 'Zoom nas imagens da carta', criterio: 'zoom funciona', prazo: '2026-11-07', risco: 'alto', titulo: 'Zoom nas imagens', ...args }));
  const holder = { current: null as ReturnType<typeof createLedgerService> | null };
  const closedDev: LedgerCaller = { projectPath: BOARD, placeId: 'place:dev-velho', roleId: 'dev', boardPlaceIds: ['place:dev-velho', 'place:dev-novo'], openPlaceIds: ['place:dev-novo'] };
  const newDev: LedgerCaller = { projectPath: BOARD, placeId: 'place:dev-novo', roleId: 'dev', boardPlaceIds: ['place:dev-velho', 'place:dev-novo'], openPlaceIds: ['place:dev-novo'] };

  it('creating twice with the same key returns the card that exists, in any place, and the letter too', async () => {
    const ledger = (holder.current = service());
    const first = JSON.parse((await create(theo, {})).text) as { id: string };
    const again = JSON.parse((await create({ ...theo, placeId: 'place:outro', boardPlaceIds: ['place:outro', 'place:theo'] }, { dono: 'place:outro', pedido: '  Zoom  nas imagens da carta ' })).text) as Record<string, unknown>;
    expect(again).toMatchObject({ criada: false, jaExistia: true, id: first.id });
    // The same Slack message (its link on the first line), and the same explicit key.
    const bySlack = JSON.parse((await create(theo, { pedido: `Filipe — ${IN_THREAD}\n\n«pronto»`, titulo: 'Filipe' })).text) as { id: string };
    expect(JSON.parse((await create(theo, { pedido: `Filipe, de novo — ${IN_THREAD}\n\n«pronto!»`, titulo: 'Filipe 2' })).text)).toMatchObject({ id: bySlack.id, jaExistia: true });
    const byKey = JSON.parse((await create(theo, { chave: 'zoom-1', pedido: 'outra coisa' })).text) as { id: string };
    expect(JSON.parse((await create(theo, { chave: 'zoom-1', pedido: 'outra coisa ainda' })).text)).toMatchObject({ id: byKey.id, jaExistia: true });
    // carta_slack: destination + thread + normalized text.
    const sent = await letter(ledger, { thread: '1793229369.456279' });
    const twice = JSON.parse((await runLedgerTool(ledger, theo, call('carta_slack', { destino: 'C0CBY1FRERM', thread: '1793229369.456279', texto: ' Filipe,  valeu! ', motivo: 'de novo' }))).text) as Record<string, unknown>;
    expect(twice).toMatchObject({ jaExistia: true, id: sent.id });
    expect(Object.keys(ledger.load().doc.tasks)).toHaveLength(4);
  });

  it('a card stuck in a closed place is reused: it passes to whoever creates it again', async () => {
    const ledger = (holder.current = service());
    const stuck = JSON.parse((await create(closedDev, {})).text) as { id: string };
    expect((await runLedgerTool(ledger, closedDev, call('tarefa_assumir', { id: stuck.id }))).ok).toBe(true);
    const reused = JSON.parse((await create(newDev, {})).text) as Record<string, unknown>;
    expect(reused).toMatchObject({ id: stuck.id, jaExistia: true, dono: 'place:dev-novo', estado: 'aberta' });
    const task = ledger.load().doc.tasks[stuck.id]!;
    expect(task.events.at(-1)).toMatchObject({ kind: 'reatribuida', fromPlaceId: 'place:dev-velho', by: { placeId: 'place:dev-novo' } });
    expect((await runLedgerTool(ledger, newDev, call('tarefa_assumir', { id: stuck.id }))).ok).toBe(true);
    expect(Object.keys(ledger.load().doc.tasks)).toHaveLength(1);
  });

  it('the dedup keeps one card per pending matter and loses nothing', async () => {
    const filePath = ledgerFile();
    const build = service(filePath);
    const old = decision(build, IN_THREAD);
    const newer = 't-newer';
    const openOld = build.apply(theoActor, { op: 'criar', projectPath: BOARD, request: `Lucas, DM — ${dm(1)}\n\n«valida?»`, doneWhen: 'o dono decide', due: '2026-11-07', ownerPlaceId: 'place:theo', risk: 'alto' });
    const sendLucas = await letter(build, { destino: 'D08R86FB4PM' });
    // A card the owner already decided, and its open twin left behind in a closed place.
    const decided = decision(build, 'https://acme.slack.com/archives/C0DDDDDDDD/p1793000000000001');
    expect(build.apply(dono, { op: 'aceitar', id: decided, option: 'Mandar o rascunho' }).ok).toBe(true);
    // Repeats as the v4 app let them be born: the same card twice, and the letters' links undone.
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { schemaVersion: number; tasks: Record<string, Record<string, unknown>> };
    raw.tasks['t-dup'] = { ...raw.tasks[old]!, id: 't-dup', createdAt: (raw.tasks[old]!.createdAt as number) - 1 };
    raw.tasks[newer] = { ...raw.tasks[old]!, id: newer, createdAt: (raw.tasks[old]!.createdAt as number) + 1 };
    raw.tasks['t-gemea'] = { ...raw.tasks[decided]!, id: 't-gemea', state: 'aberta', events: (raw.tasks[decided]!.events as unknown[]).slice(0, 1) };
    for (const task of Object.values(raw.tasks)) delete (task.slack as Record<string, unknown> | undefined)?.replaces;
    writeFileSync(filePath, JSON.stringify(raw, null, 2));
    const ledger = service(filePath);
    const before = ledger.load().doc;
    expect(openOld.ok).toBe(true);

    const result = ledger.tidy();
    if ('error' in result) throw new Error(result.error);
    const after = ledger.load().doc;
    // Same message, two delivered cards (+ the copy): the newest stays; the open card of the DM goes to the letter.
    expect(result.replaced).toEqual({ [old]: newer, 't-dup': newer, 't-gemea': decided, [openOld.ok ? openOld.task.id : '']: sendLucas.id });
    expect(after.tasks[decided]!.events).toEqual(before.tasks[decided]!.events);
    expect(Object.keys(after.tasks).sort()).toEqual(Object.keys(before.tasks).sort());
    for (const [id, keep] of Object.entries(result.replaced)) {
      expect(after.tasks[id]!.state).toBe('substituida');
      expect(after.tasks[id]!.events.slice(0, -1)).toEqual(before.tasks[id]!.events);
      expect(after.tasks[id]!.events.at(-1)).toMatchObject({ kind: 'substituida', replacedBy: keep });
      expect(after.tasks[keep]!.state).not.toBe('substituida');
    }
    expect(result.waitingBefore).toBeGreaterThan(result.waitingAfter);
    expect(ledger.tidy()).toMatchObject({ replaced: {}, backup: null });
  });
});
