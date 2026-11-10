// Achados da revisão do BizOps (08/11) nas ferramentas do Oráculo: um motivo longo virava "motivo é obrigatório", um
// pedido longo era recusado sem o tamanho. E (09/11) o risco declarado vale: tarefa própria provada fecha sem carta.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { ledgerStrip, MAX_REQUEST_CHARS, ownerQueue } from '../src/shared/ledger/contract';
import { serviceActor, serviceOpRefusal } from '../src/oraculo/servicos';
import { ownerInbox, STALE_DELIVERY_MS } from '../src/shared/ledger/inbox';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';
import type { MindscapeBoard } from '../src/shared/mindscape/model';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function service(): ReturnType<typeof createLedgerService> {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-risco-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 8, 12);
  return createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 60_000) });
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const places = ['place:lider', 'place:dev', 'place:revisor', 'place:rev-do-dev'];
const opened = (from: string, to: string) => ({ id: `${from}>${to}`, from, to, arrow: true, by: 'session' as const, opened: true as const });
const board: MindscapeBoard = {
  projectPath: 'C:/p',
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: {
    'place:revisor': { kind: 'session', id: 'place:revisor', previous: [], roleId: 'revisor', x: 0, y: 0 },
    'place:rev-do-dev': { kind: 'session', id: 'place:rev-do-dev', previous: [], roleId: 'revisor', x: 0, y: 0 },
  },
  links: [opened('place:lider', 'place:dev'), opened('place:lider', 'place:revisor'), opened('place:dev', 'place:rev-do-dev')],
  drawings: [],
};
const at = (placeId: string, roleId: string, withBoard = true): LedgerCaller => ({ projectPath: 'C:/p', placeId, roleId, boardPlaceIds: places, ...(withBoard ? { board } : {}) });
const task = (owner: string, risco: 'baixo' | 'alto') => call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-09', dono: owner, risco });
const created = (text: string) => JSON.parse(text) as { id: string; risco?: string; aviso?: string };

describe('limites com o tamanho', () => {
  it('a reason over the limit says the size and the limit, never "obrigatório"', () => {
    const long = 'a'.repeat(MAX_REQUEST_CHARS + 120);
    for (const tool of ['tarefa_rejeitar', 'tarefa_cancelar']) {
      const parsed = parseLedgerToolCall(tool, { id: 't-1', motivo: long });
      expect(parsed).toMatchObject({ ok: false });
      if (!parsed.ok) {
        expect(parsed.reason).not.toContain('obrigatório');
        expect(parsed.reason).toContain(`${MAX_REQUEST_CHARS + 120}`);
        expect(parsed.reason).toContain(`${MAX_REQUEST_CHARS}`);
      }
    }
    const transfer = parseLedgerToolCall('tarefa_transferir', { id: 't-1', para: 'place:dev', motivo: long });
    expect(transfer.ok ? '' : transfer.reason).toContain(`${MAX_REQUEST_CHARS + 120}`);
  });

  it('a request over the limit says how long it was', () => {
    const parsed = parseLedgerToolCall('tarefa_criar', { pedido: 'é'.repeat(MAX_REQUEST_CHARS + 1), criterio: 'y', prazo: '2026-11-09', risco: 'alto' });
    expect(parsed.ok ? '' : parsed.reason).toMatch(new RegExp(`${MAX_REQUEST_CHARS + 1}.*${MAX_REQUEST_CHARS}`));
  });
});

// 09/11 (dono: "o que a sessão fez e provou fecha com um Revisor ou sozinho, sem passar por você. Carta só quando há
// uma decisão sua de verdade") — quem cria não decide mais o risco: vale o declarado.
describe('risco declarado: o que a sessão fez e provou fecha sem carta', () => {
  const states = (revisor: string): LedgerCaller['placeStates'] =>
    new Map([['C:/p', new Map([['place:lider', 'trabalhando'], ['place:dev', 'trabalhando'], ['place:revisor', revisor], ['place:rev-do-dev', 'trabalhando']])]]);
  const live = (placeId: string, roleId: string, revisor: string): LedgerCaller => ({ ...at(placeId, roleId), placeStates: states(revisor) });
  const proof = { provas: [{ tipo: 'texto', texto: 'npm run verify: 0 falhas' }] };

  async function ownTask(ledger: ReturnType<typeof service>, dev: LedgerCaller, risco: 'baixo' | 'alto'): Promise<string> {
    const answer = created((await runLedgerTool(ledger, dev, task('place:dev', risco))).text);
    expect(answer.aviso).toBeUndefined();
    await runLedgerTool(ledger, dev, call('tarefa_assumir', { id: answer.id }));
    return answer.id;
  }

  it('a low task a session created for itself, delivered with proof and no live Revisor out of its chain, closes alone, never a card', async () => {
    const ledger = service();
    // The only live Revisor was opened by the Dev (its own chain); the other one is closed.
    const dev = live('place:dev', 'dev', 'fechada');
    const id = await ownTask(ledger, dev, 'baixo');
    expect(ledger.load().doc.tasks[id]!.risk).toBe('baixo');
    const delivered = await runLedgerTool(ledger, dev, call('tarefa_entregar', { id, ...proof }));
    expect(delivered.ok).toBe(true);
    const doc = ledger.load().doc;
    const closed = doc.tasks[id]!;
    expect(closed.state).toBe('aceita');
    expect(closed.events.at(-1)).toMatchObject({ kind: 'aceita', by: { kind: 'lugar', placeId: 'place:dev' } });
    expect(closed.events.at(-1)!.text).toContain('sem Revisor');
    expect(ownerQueue(doc, null)).toEqual([]);
    expect(ownerInbox(doc, null, ledger.now() + 2 * STALE_DELIVERY_MS, states('fechada'))).toEqual([]);
    // Auditable: the delivery and its proof stay, and the owner can still reopen it.
    expect(closed.events.some((event) => event.kind === 'entregue' && event.proofs?.length === 1)).toBe(true);
    expect((await ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: 'refazer' })).ok).toBe(true);
  });

  it('with a live Revisor out of the chain, the low delivery waits for it, not for the owner', async () => {
    const ledger = service();
    const dev = live('place:dev', 'dev', 'trabalhando');
    const id = await ownTask(ledger, dev, 'baixo');
    await runLedgerTool(ledger, dev, call('tarefa_entregar', { id, ...proof }));
    expect(ledger.load().doc.tasks[id]!.state).toBe('entregue');
    expect(ownerQueue(ledger.load().doc, null)).toEqual([]);
    const revisor = live('place:revisor', 'revisor', 'trabalhando');
    await runLedgerTool(ledger, revisor, call('tarefa_ver', { id }));
    expect((await runLedgerTool(ledger, revisor, call('tarefa_aceitar', { id }))).ok).toBe(true);
  });

  it('a high task still goes to the owner: card required, no Revisor accepts, nothing closes alone', async () => {
    const ledger = service();
    const dev = live('place:dev', 'dev', 'fechada');
    const id = await ownTask(ledger, dev, 'alto');
    expect((await runLedgerTool(ledger, dev, call('tarefa_entregar', { id, ...proof }))).ok).toBe(false);
    const card = {
      pergunta: 'Publico a versão no repositório público?',
      resumo: 'A versão está pronta e testada.',
      opcoes: [
        { rotulo: 'Publicar', efeito: 'Sai para todos.', fecha: 'aceita', recomendada: true },
        { rotulo: 'Esperar', efeito: 'Fica para amanhã.', fecha: 'rejeitada' },
      ],
      porque: 'Os testes passaram.',
      risco: 'Difícil de desfazer.',
    };
    expect((await runLedgerTool(ledger, dev, call('tarefa_entregar', { id, ...proof, paraODono: card }))).ok).toBe(true);
    expect(ledger.load().doc.tasks[id]!.state).toBe('entregue');
    expect(ownerQueue(ledger.load().doc, null).map((t) => t.id)).toEqual([id]);
    const revisor = live('place:revisor', 'revisor', 'trabalhando');
    await runLedgerTool(ledger, revisor, call('tarefa_ver', { id }));
    expect((await runLedgerTool(ledger, revisor, call('tarefa_aceitar', { id }))).ok).toBe(false);
  });

  it('a transfer keeps the declared risk; a low once forced high by the old rule gets its low back', async () => {
    const ledger = service();
    const lider = at('place:lider', 'lider');
    const low = created((await runLedgerTool(ledger, lider, task('place:dev', 'baixo'))).text).id;
    expect((await runLedgerTool(ledger, lider, call('tarefa_transferir', { id: low, para: 'place:lider', motivo: 'eu faço' }))).ok).toBe(true);
    expect(ledger.load().doc.tasks[low]!.risk).toBe('baixo');
    const forced = await ledger.apply({ kind: 'lugar', placeId: 'place:dev', roleId: 'dev' }, { op: 'criar', projectPath: 'C:/p', request: 'x', doneWhen: 'y', due: '2026-11-09', ownerPlaceId: 'place:dev', risk: 'alto', lowAsked: true });
    if (!forced.ok) throw new Error(forced.reason);
    await runLedgerTool(ledger, lider, call('tarefa_transferir', { id: forced.task.id, para: 'place:revisor', motivo: 'outro faz' }));
    expect(ledger.load().doc.tasks[forced.task.id]!.risk).toBe('baixo');
    const high = created((await runLedgerTool(ledger, lider, task('place:dev', 'alto'))).text).id;
    await runLedgerTool(ledger, lider, call('tarefa_transferir', { id: high, para: 'place:revisor', motivo: 'outro faz' }));
    expect(ledger.load().doc.tasks[high]!.risk).toBe('alto');
  });

  // Revisão do #383 (achados 1 a 4): nada tira da mesa do dono uma decisão alta, e o fechamento sozinho deixa rastro.
  it('a delivery done by another place (feitoPor) never closes alone: it waits for the live Revisor', async () => {
    const ledger = service();
    const dev = live('place:dev', 'dev', 'trabalhando');
    const id = await ownTask(ledger, dev, 'baixo');
    await runLedgerTool(ledger, dev, call('tarefa_entregar', { id, ...proof, feitoPor: 'place:lider' }));
    expect(ledger.load().doc.tasks[id]!.state).toBe('entregue');
  });

  it('a service credential cannot close its own task alone', async () => {
    const op = { op: 'entregar', id: 't-x', proofs: [{ kind: 'texto', text: 'x' }], closeAlone: true };
    expect(serviceOpRefusal(op)).not.toBeNull();
    const ledger = service();
    const n8n = serviceActor('n8n');
    const made = await ledger.apply(n8n, { op: 'criar', projectPath: 'C:/p', request: 'x', doneWhen: 'y', due: '2026-11-09', ownerPlaceId: n8n.kind === 'lugar' ? n8n.placeId : '', risk: 'baixo' });
    if (!made.ok) throw new Error(made.reason);
    await ledger.apply(n8n, { op: 'assumir', id: made.task.id });
    const closed = await ledger.apply(n8n, { op: 'entregar', id: made.task.id, proofs: [{ kind: 'texto', text: 'x' }], closeAlone: true });
    expect(closed.ok).toBe(false);
    expect(ledger.load().doc.tasks[made.task.id]!.state).toBe('em-execucao');
  });

  it('a task that replaces a high one is born high, and what closed alone shows in the owner\'s strip', async () => {
    const ledger = service();
    const high = created((await runLedgerTool(ledger, at('place:lider', 'lider'), task('place:dev', 'alto'))).text).id;
    const dev = live('place:dev', 'dev', 'fechada');
    const again = created((await runLedgerTool(ledger, dev, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-09', risco: 'baixo', substitui: high }))).text).id;
    expect(ledger.load().doc.tasks[again]!.risk).toBe('alto');
    const id = await ownTask(ledger, dev, 'baixo');
    await runLedgerTool(ledger, dev, call('tarefa_entregar', { id, ...proof }));
    expect(ledgerStrip(ledger.load().doc, 'C:/p').closedAlone).toBe(1);
  });

  it('a card already on the owner\'s table keeps its risk when the task is passed on', async () => {
    const ledger = service();
    const dev = { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' } as const;
    const forced = await ledger.apply(dev, { op: 'criar', projectPath: 'C:/p', request: 'x', doneWhen: 'y', due: '2026-11-09', ownerPlaceId: 'place:dev', risk: 'alto', lowAsked: true });
    if (!forced.ok) throw new Error(forced.reason);
    const id = forced.task.id;
    await ledger.apply(dev, { op: 'assumir', id });
    const card = { question: 'Publico?', summary: 'Pronto.', options: [{ label: 'Sim', effect: 'Sai.', closes: 'aceita' as const, recommended: true as const }, { label: 'Não', effect: 'Fica.', closes: 'rejeitada' as const }], why: 'Testado.', risk: 'Baixo.' };
    expect((await ledger.apply(dev, { op: 'entregar', id, proofs: [{ kind: 'texto', text: 'ok' }], forOwner: card })).ok).toBe(true);
    await runLedgerTool(ledger, at('place:lider', 'lider'), call('tarefa_transferir', { id, para: 'place:revisor', motivo: 'outro olha' }));
    expect(ledger.load().doc.tasks[id]!.risk).toBe('alto');
    expect(ownerQueue(ledger.load().doc, null).map((t) => t.id)).toEqual([id]);
  });
});
