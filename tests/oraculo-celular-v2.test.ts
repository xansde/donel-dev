import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../src/main/ledger-store';
import { maskSecrets } from '../src/shared/ledger/mirror';
import { createMobileHandler } from '../src/main/celular/server';
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

function world(now = () => T0, opts: { flags?: Set<string>; proofs?: Map<string, Buffer> } = {}) {
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
      readProof: async (name) => {
        const bytes = opts.proofs?.get(name);
        return bytes ? { kind: 'ok', bytes } : { kind: 'sumiu' };
      },
      flagOn: (name) => opts.flags?.has(name) ?? false,
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

  it('desligado (sem "fila":"local"), o /api/v2 não existe: 404, nunca o 401 de despareado da PWA', async () => {
    const off = createMobileHandler({ auth: { verify: () => null } as never, ledger: () => ({}) as never, assets: {}, provasRoot: null, v2: () => null });
    const response = await off({ method: 'GET', url: '/api/v2/ping', body: '' });
    expect(response.status).toBe(404);
    expect(parse(response).erro).toBe('nao-encontrada');
  });

  // t-c62538a7 — o resultado de cada pedido do dono (contrato v1.7): o print de um pedido já aceito não pode sumir
  // (antes, /prova dava 404 fora das cartas), um link com segredo não pode sair cru, e a rota só lê.
  it('/resultados traz o pedido aceito do dono com o sha do print, e /prova serve os bytes; flag desligada = 404', async () => {
    const png = Buffer.from('print do pedido aceito');
    const file = '2026-11-20-abcdef012345.png';
    const flags = new Set<string>();
    const w = world(() => T0, { flags, proofs: new Map([[file, png]]) });
    mkdirSync(ledgerProofsDir(join(w.dir, 'ledger.json')), { recursive: true });
    writeFileSync(join(ledgerProofsDir(join(w.dir, 'ledger.json')), file), png);
    const dev = { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' } as const;
    const mine = await w.ledger.apply({ kind: 'dono' }, { op: 'criar', projectPath: '/home/dono/seazone/atlas', request: 'caixa de credencial no app', doneWhen: 'print', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' });
    const other = await w.ledger.apply(dev, { op: 'criar', projectPath: '/home/dono/seazone/atlas', request: 'faxina interna do Dev', doneWhen: 'x', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' });
    if (!mine.ok || !other.ok) throw new Error('criar');
    const id = mine.task.id;
    const secretLink = 'https://example.com/callback?token=ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(maskSecrets(secretLink).text).not.toBe(secretLink);
    await w.ledger.apply(dev, { op: 'assumir', id });
    const delivered = await w.ledger.apply(dev, {
      op: 'entregar',
      id,
      proofs: [{ kind: 'arquivo', file, mediaType: 'image/png' }, { kind: 'link', url: 'https://github.com/xansde/donel-dev/pull/43' }, { kind: 'link', url: secretLink }, { kind: 'texto', text: 'feito, 3 prints' }],
    });
    expect(delivered.ok).toBe(true);
    expect((await w.ledger.apply({ kind: 'dono' }, { op: 'aceitar', id })).ok).toBe(true);

    expect((await w.call('GET', '/api/v2/resultados')).status).toBe(404);
    expect((await w.call('GET', `/api/v2/prova?tarefa=${id}&ordem=0`)).status).toBe(404);

    flags.add('celular-resultados');
    const before = JSON.stringify(w.ledger.load().doc);
    const response = await w.call('GET', '/api/v2/resultados');
    expect(response.status).toBe(200);
    const { resultados } = parse(response);
    expect(resultados.map((r: { id: string }) => r.id)).toEqual([id]);
    const [r] = resultados;
    expect(r).toMatchObject({ estado: 'aceita', esperando_dono: false, pedido: 'caixa de credencial no app' });
    expect(r.entrega.provas).toEqual([expect.objectContaining({ ordem: 0, tipo: 'imagem', sha256: createHash('sha256').update(png).digest('hex'), pronta: true })]);
    expect(r.entrega.links.map((l: { url: string }) => l.url)).toEqual(['https://github.com/xansde/donel-dev/pull/43', maskSecrets(secretLink).text]);
    expect(String(response.body)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    const bytes = await w.call('GET', `/api/v2/prova?tarefa=${id}&ordem=0`);
    expect(bytes.status).toBe(200);
    expect(Buffer.from(bytes.body as Uint8Array).equals(png)).toBe(true);
    expect(bytes.headers['X-Sha256']).toBe(r.entrega.provas[0].sha256);
    expect(JSON.stringify(w.ledger.load().doc)).toBe(before);
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
