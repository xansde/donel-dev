import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { createTarefasPedidasConsumer } from '../src/oraculo/tarefas-pedidas';

// Saída iii (18/11): o app do celular fala com o daemon pela tailnet, sem o Supabase. O que não pode acontecer sem o
// dono ver: uma decisão, um pedido ou uma mensagem que o app reenvia (a rede caiu) entrar duas vezes; uma linha que o
// app ouviu "ok" sumir num reinício; um pedido sem a chave do aparelho passar.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cel-v2-'));
  dirs.push(dir);
  return dir;
};

const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
const T0 = Date.parse('2026-11-18T23:00:00Z');
const UUID = (n: number): string => `${String(n).padStart(8, '0')}-1111-4222-8333-444455556666`;

function world(now = () => T0) {
  const dir = tmp();
  const file = join(dir, 'celular-local.json');
  let store = createCelularLocalStore(file, now);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now });
  const kicks: string[] = [];
  const handler = () =>
    createCelularV2Handler({
      verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
      doc: () => ledger.load().doc,
      store,
      readProof: async () => ({ kind: 'sumiu' }),
      arvoreFile: join(dir, 'arvore.json'),
      kick: (fila) => kicks.push(fila),
      now,
    });
  let h = handler();
  return {
    dir,
    ledger,
    kicks,
    get store() {
      return store;
    },
    reopen() {
      store = createCelularLocalStore(file, now);
      h = handler();
    },
    call(method: string, url: string, body = '', opts: { key?: Buffer; ts?: number } = {}) {
      const ts = String(opts.ts ?? now());
      const sig = createHmac('sha256', opts.key ?? KEY).update(signedMessage(method, url, ts, body), 'utf8').digest('hex');
      return h({ method, url, body, authorization: `Donel-HMAC ${ts}.${sig}` });
    },
    raw: (method: string, url: string, authorization?: string) => h({ method, url, body: '', ...(authorization ? { authorization } : {}) }),
  };
}

const parse = (response: { body: unknown }): any => JSON.parse(String(response.body));

describe('celular pela tailnet (/api/v2)', () => {
  it('só passa o pedido assinado com a chave do aparelho, dentro da hora', async () => {
    const w = world();
    expect((await w.raw('GET', '/api/v2/ping')).status).toBe(401);
    expect((await w.raw('GET', '/api/v2/ping', 'Bearer qualquer')).status).toBe(401);
    expect((await w.call('GET', '/api/v2/ping', '', { key: createHash('sha256').update('outro').digest() })).status).toBe(401);
    const late = await w.call('GET', '/api/v2/ping', '', { ts: T0 - 6 * 60_000 });
    expect(late.status).toBe(401);
    expect(parse(late).erro).toBe('relogio');
    expect((await w.call('GET', '/api/v2/ping')).status).toBe(200);
    // A assinatura cobre o corpo: o mesmo cabeçalho com outro corpo não passa.
    const ts = String(T0);
    const sig = createHmac('sha256', KEY).update(signedMessage('POST', '/api/v2/chat', ts, '{"a":1}'), 'utf8').digest('hex');
    expect((await createCelularV2HandlerCall(w, 'POST', '/api/v2/chat', '{"a":2}', `Donel-HMAC ${ts}.${sig}`)).status).toBe(401);
  });

  it('a mesma mensagem reenviada entra uma vez, sobrevive ao reinício e segue o estado até a resposta', async () => {
    const w = world();
    const body = JSON.stringify({ id: UUID(1), texto: 'oi, Líder' });
    expect(parse(await w.call('POST', '/api/v2/chat', body))).toMatchObject({ ok: true, nova: true, estado: 'na-fila' });
    expect(parse(await w.call('POST', '/api/v2/chat', body))).toMatchObject({ ok: true, nova: false });
    expect((await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(1), texto: 'outro texto' }))).status).toBe(409);
    expect(w.kicks).toContain('chat');
    w.reopen();
    let conversa = parse(await w.call('GET', '/api/v2/chat?limite=50')).mensagens;
    expect(conversa).toHaveLength(1);
    // O consumidor de hoje leva ao Líder pela fila local e marca; a resposta dele entra uma vez.
    const [row] = await w.store.chat.tomar(10);
    expect(row!.id).toBe(UUID(1));
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
    expect(await w.store.chat.entregue(UUID(1), 'entregue ao Líder único pela VPS')).toBe(true);
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens[0].estado).toBe('com-o-lider');
    await w.store.chat.responder(UUID(2), UUID(1), 'oi, dono');
    await w.store.chat.responder(UUID(2), UUID(1), 'oi, dono');
    conversa = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(conversa.map((m: { autor: string; estado: string | null }) => [m.autor, m.estado])).toEqual([
      ['dono', 'respondida'],
      ['lider', null],
    ]);
  });

  it('uma linha tomada e não marcada volta depois da reserva; a marcada não volta', async () => {
    let now = T0;
    const w = world(() => now);
    await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(3), texto: 'perdida?' }));
    expect(await w.store.chat.tomar(10)).toHaveLength(1);
    now += 11 * 60_000;
    expect(await w.store.chat.tomar(10)).toHaveLength(1);
    await w.store.chat.entregue(UUID(3), 'ok');
    now += 11 * 60_000;
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
  });

  it('o pedido de tarefa reenviado vira uma tarefa só, pelo consumidor de hoje sobre a fila local', async () => {
    const w = world();
    const body = JSON.stringify({ pedido: UUID(4), titulo: 'Testar o celular', texto: 'pelo celular, sem o PC' });
    expect(parse(await w.call('POST', '/api/v2/tarefas-pedidas', body)).nova).toBe(true);
    expect(parse(await w.call('POST', '/api/v2/tarefas-pedidas', body)).nova).toBe(false);
    const consumer = createTarefasPedidasConsumer({ queue: () => w.store.pedidas, ledger: () => w.ledger, returned: () => false, quadro: () => '/home/dono/seazone/atlas' });
    await consumer.round();
    expect(parse(await w.call('POST', '/api/v2/tarefas-pedidas', body)).nova).toBe(false);
    await consumer.round();
    expect(Object.keys(w.ledger.load().doc.tasks)).toHaveLength(1);
    const [pedida] = parse(await w.call('GET', '/api/v2/tarefas-pedidas')).pedidas;
    expect(pedida.tarefa).toBe(Object.keys(w.ledger.load().doc.tasks)[0]);
    const tarefas = parse(await w.call('GET', '/api/v2/tarefas')).tarefas;
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0]).toMatchObject({ titulo: 'Testar o celular', esperando_dono: false });
  });

  it('a decisão reenviada entra uma vez na fila; o mesmo pedido com outro lado é recusado', async () => {
    const w = world();
    const created = await w.ledger.apply({ kind: 'dono' }, { op: 'criar', projectPath: '/p', request: 'x', doneWhen: 'y', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' });
    if (!created.ok) throw new Error('criar');
    const body = JSON.stringify({ pedido: UUID(5), tarefa: created.task.id, lado: 'nao', opcao: 'Rejeitar, é teste' });
    expect(parse(await w.call('POST', '/api/v2/decidir', body)).nova).toBe(true);
    expect(parse(await w.call('POST', '/api/v2/decidir', body)).nova).toBe(false);
    expect((await w.call('POST', '/api/v2/decidir', JSON.stringify({ pedido: UUID(5), tarefa: created.task.id, lado: 'sim' }))).status).toBe(409);
    expect((await w.call('POST', '/api/v2/decidir', JSON.stringify({ pedido: UUID(6), tarefa: 't-naoexiste', lado: 'sim' }))).status).toBe(404);
    expect(await w.store.decisoes.tomar(10)).toHaveLength(1);
    expect(w.store.pendingDecision(created.task.id)).toMatchObject({ lado: 'nao' });
    expect(await w.store.decisoes.marcar(UUID(5), 'aplicada')).toBe(true);
    expect(await w.store.decisoes.marcar(UUID(5), 'de novo')).toBe(false);
    expect(w.store.pendingDecision(created.task.id)).toBeNull();
  });

  it('a árvore vem do arquivo local; sem ele, vazia', async () => {
    const w = world();
    expect(parse(await w.call('GET', '/api/v2/arvore'))).toEqual({ nos: [], rodada: null });
    writeFileSync(join(w.dir, 'arvore.json'), JSON.stringify({ nos: [{ id: 'a' }], rodada: { cadeiras_vivas: 3 } }));
    expect(parse(await w.call('GET', '/api/v2/arvore')).nos).toHaveLength(1);
  });
});

/** A request with a hand-made authorization (the body swapped after signing). */
function createCelularV2HandlerCall(w: ReturnType<typeof world>, method: string, url: string, body: string, authorization: string) {
  return createCelularV2Handler({
    verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'x' } : null),
    doc: () => w.ledger.load().doc,
    store: w.store,
    readProof: async () => ({ kind: 'sumiu' }),
    arvoreFile: join(w.dir, 'arvore.json'),
    now: () => T0,
  })({ method, url, body, authorization });
}
