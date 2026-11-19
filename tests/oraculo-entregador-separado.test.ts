// Passo 9 da correção da estrutura (t-5358d400), PR 1: o donel-oraculo dividido em registro (o ledger) e entregador
// (portão das sessões, recados, retrato). Sem a marca `<dir>/entregador.separado` os dois rodam no mesmo processo, como
// hoje. Com ela, cada um é um processo e cada arquivo tem um escritor só: o registro nunca grava recados.json nem
// retrato.json (dois escritores = recado duplicado ou perdido), e o entregador nunca abre o ledger.sqlite (um segundo
// escritor do registro).
import { createHash, createHmac } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import type { OracleApiHandler } from '../src/oraculo/api';
import { runEntregador } from '../src/oraculo/entregador';
import { parseLedgerToolCall } from '../src/shared/ledger/tools';
import type { PictureSession } from '../src/oraculo/portao';
import { createSatelliteLedger, type SatellitePost } from '../src/oraculo/satelite';
import { openSqliteLedgerStore, seedSqliteLedger } from '../src/oraculo/ledger-sqlite';
import { ENTREGADOR_SEPARADO_FILE, oracleMode, RETRATO_PC_FILE } from '../src/oraculo/modo';
import { runRegistro } from '../src/oraculo/registro';
import { createCelularAuth } from '../src/main/celular/auth';
import { createMobileHandler, mobileRequestListener } from '../src/main/celular/server';
import { CELULAR_LOCAL_FILE, createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { createPhoneFront, createPhoneSignatures } from '../src/oraculo/celular-frente';
import { CHAT_LOCAL_FILE, createEntregadorChat, juntarChat, separarChat } from '../src/oraculo/chat-entregador';
import { createGlossarioStore } from '../src/oraculo/glossario';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'oraculo-entregador-'));
  dirs.push(dir);
  return dir;
};

const TOKEN = 'pc-token-de-teste';
const SID = '11111111-2222-4333-8444-555555555555';
const RECADOS = '{"versao":1,"itens":[{"id":"r1","texto":"oi"}]}';
const RETRATO = '{"at":5,"sessoes":{}}';
const GATE_TOKEN = 'portao-homologacoes-de-teste';
/** The Homologações's picture as its satellite sends it (t-d461e003). */
const RETRATO_HOMOLOGACAO = { at: 2_000, quadros: { '/h': { listar: [] } }, sessoes: { '99999999-2222-4333-8444-555555555555': { quemSou: { pasta: '/h', lugar: 'place:dalton' } } } };
const FILA_HOMOLOGACAO = '{"versao":1,"itens":[]}';
const noTmux = { liveSessions: async () => new Set<string>(), liveNow: () => new Set<string>() };

/** An Oráculo dir with a seeded SQLite ledger, the PC's token hash, and a home with the session folder `SID`. */
async function place(options: { separado: boolean }) {
  const dir = tmp();
  const home = tmp();
  mkdirSync(join(home, '.donel', 's', SID), { recursive: true });
  const empty = createLedgerService({ filePath: join(dir, 'nada.json'), io, proofFs: nodeLedgerProofFs }).load().doc;
  await seedSqliteLedger(join(dir, 'ledger.sqlite'), empty);
  writeFileSync(join(dir, 'pc.token.sha256'), createHash('sha256').update(TOKEN).digest('hex'));
  if (options.separado) writeFileSync(join(dir, ENTREGADOR_SEPARADO_FILE), '');
  mkdirSync(join(dir, 'portoes'));
  writeFileSync(join(dir, 'portoes', 'homologacoes.sha256'), createHash('sha256').update(GATE_TOKEN).digest('hex'));
  return { dir, home };
}

/** The registro with a stand-in for the Tailscale listener: the test calls its handler as the PC would. */
async function registro(dir: string, home: string, entregador: 'junto' | 'separado') {
  let handler: OracleApiHandler | null = null;
  const daemon = await runRegistro({
    dir,
    home,
    host: '100.64.0.1',
    port: 47816,
    gatePort: 0,
    entregador,
    ...noTmux,
    listen: async (options) => {
      handler = options.handler;
      return { url: 'http://100.64.0.1:47816', notify: () => undefined, close: async () => undefined };
    },
  });
  const call = async (path: string, body: unknown, token = TOKEN) => {
    const answer = await handler!({ method: 'POST', url: path, authorization: `Bearer ${token}`, body: JSON.stringify(body) });
    return { status: answer.status, body: JSON.parse(String(answer.body)) as Record<string, unknown> };
  };
  /** A satellite-shaped POST (`postJson`) straight into the handler: the entregador's way to the registro. */
  const post = async (url: string, token: string, body: string): Promise<SatellitePost> => {
    const answer = await handler!({ method: 'POST', url: new URL(url).pathname, authorization: `Bearer ${token}`, body });
    return { status: answer.status, body: String(answer.body) };
  };
  return { daemon, call, post };
}

const push = { at: 1_000, sessoes: { [SID]: { quemSou: { nome: 'Dev · atlas', pasta: '/p', lugar: 'place:dev', papel: 'dev' }, listar: [] } } };
const criar = { op: 'criar', projectPath: '/p', request: 'pedido', doneWhen: 'feito', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' };

function tasksIn(dir: string): number {
  const store = openSqliteLedgerStore(join(dir, 'ledger.sqlite'));
  try {
    return Object.keys(createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, store }).load().doc.tasks).length;
  } finally {
    store.close();
  }
}

describe('donel-oraculo dividido em registro e entregador', () => {
  it('sem a marca, o modo é o de hoje; o entregador sozinho só sobe com a marca', () => {
    const dir = tmp();
    expect(oracleMode({}, dir)).toBe('junto');
    expect(() => oracleMode({ DONEL_ORACULO_MODO: 'entregador' }, dir)).toThrow(ENTREGADOR_SEPARADO_FILE);
    expect(() => oracleMode({ DONEL_ORACULO_MODO: 'entregadr' }, dir)).toThrow();
    writeFileSync(join(dir, ENTREGADOR_SEPARADO_FILE), '');
    expect(oracleMode({}, dir)).toBe('registro');
    expect(oracleMode({ DONEL_ORACULO_MODO: 'entregador' }, dir)).toBe('entregador');
    expect(oracleMode({ DONEL_PORTAO_SATELITE: 'http://100.64.0.1:47816' }, dir)).toBe('satelite');
  });

  it('separado: o registro grava a tarefa e o retrato do PC à parte, sem tocar recados.json nem retrato.json', async () => {
    const { dir, home } = await place({ separado: true });
    writeFileSync(join(dir, 'recados.json'), RECADOS);
    writeFileSync(join(dir, 'retrato.json'), RETRATO);
    const { daemon, call } = await registro(dir, home, 'separado');
    expect((await call('/v1/retrato', push)).status).toBe(200);
    expect((await call('/v1/apply', { actor: { kind: 'dono' }, op: criar, leve: true })).body.ok).toBe(true);
    // t-d461e003 — apart, the registro alone keeps the other machines' pictures (one writer of portoes-retrato/).
    expect((await call('/v1/portao/retrato', { retrato: RETRATO_HOMOLOGACAO }, GATE_TOKEN)).body).toMatchObject({ guardado: true });
    await daemon.stop();
    expect(existsSync(join(dir, 'portoes-retrato', 'homologacoes.json'))).toBe(true);
    expect(readFileSync(join(dir, 'recados.json'), 'utf8')).toBe(RECADOS);
    expect(readFileSync(join(dir, 'retrato.json'), 'utf8')).toBe(RETRATO);
    expect(JSON.parse(readFileSync(join(dir, RETRATO_PC_FILE), 'utf8'))).toMatchObject({ at: 1_000, sessoes: { [SID]: {} } });
    expect(existsSync(join(dir, 'portao'))).toBe(false);
    expect(tasksIn(dir)).toBe(1);
  });

  it('separado: o entregador junta o retrato do PC e sobe o portão sem abrir o ledger.sqlite', async () => {
    const { dir, home } = await place({ separado: true });
    writeFileSync(join(dir, 'url'), 'http://127.0.0.1:9\n');
    writeFileSync(join(dir, RETRATO_PC_FILE), JSON.stringify(push));
    mkdirSync(join(dir, 'portoes-recados'));
    writeFileSync(join(dir, 'portoes-recados', 'homologacoes.json'), FILA_HOMOLOGACAO);
    const before = readFileSync(join(dir, 'ledger.sqlite'));
    const daemon = await runEntregador({ dir, home, gatePort: 0, ...noTmux });
    await daemon.stop();
    // The other machines' queues are the registro's (its `/v1/portao/recados` acks them): never written here.
    expect(readFileSync(join(dir, 'portoes-recados', 'homologacoes.json'), 'utf8')).toBe(FILA_HOMOLOGACAO);
    expect(existsSync(join(dir, 'portoes-retrato'))).toBe(false);
    expect(readFileSync(join(dir, 'ledger.sqlite')).equals(before)).toBe(true);
    expect(existsSync(join(dir, 'ledger.sqlite-wal'))).toBe(false);
    expect(existsSync(join(dir, 'ledger.sqlite-shm'))).toBe(false);
    expect(existsSync(join(dir, 'portao'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'retrato.json'), 'utf8'))).toMatchObject({ at: 1_000, sessoes: { [SID]: { pcAt: 1_000 } } });
  });

  it('sem a marca: um processo só, e o retrato do PC vai direto para o retrato.json, como hoje', async () => {
    const { dir, home } = await place({ separado: false });
    const { daemon, call } = await registro(dir, home, 'junto');
    expect((await call('/v1/retrato', push)).status).toBe(200);
    expect((await call('/v1/apply', { actor: { kind: 'dono' }, op: criar, leve: true })).body.ok).toBe(true);
    // t-d461e003 — the Homologações's picture and queue still reach this process (the Líder único with the PC off).
    expect((await call('/v1/portao/retrato', { retrato: RETRATO_HOMOLOGACAO }, GATE_TOKEN)).body).toMatchObject({ guardado: true });
    expect((await call('/v1/portao/recados', {}, GATE_TOKEN)).body).toEqual({ recados: [] });
    await daemon.stop();
    expect(JSON.parse(readFileSync(join(dir, 'retrato.json'), 'utf8'))).toMatchObject({ at: 1_000, sessoes: { [SID]: { pcAt: 1_000 } } });
    expect(existsSync(join(dir, RETRATO_PC_FILE))).toBe(false);
    expect(existsSync(join(dir, 'portao'))).toBe(true);
    expect(tasksIn(dir)).toBe(1);
  });
});

// Passo 9, PR 2: com a marca, o portão do entregador grava pelo registro (como o satélite), o Líder único só pela
// credencial marcada como local, e o que o registro entregava na fila local de recados vai pelo 127.0.0.1 do entregador.
describe('entregador à parte: portão local por HTTP e entrega de volta', () => {
  const LOCAL_TOKEN = 'portao-vps-pessoal-de-teste';
  const LIDER: PictureSession = { quemSou: { nome: 'Líder', papel: 'lider', liderUnico: true, lugar: null }, listar: [] };
  const DEV: PictureSession = { quemSou: { nome: 'Dev · atlas', pasta: '/p', lugar: 'place:dev', papel: 'dev' }, listar: [{ id: 'place:dev', papel: 'dev', estado: 'trabalhando' }] };
  const pedido = { titulo: 'Separado', pedido: 'gravar pelo registro', criterio: 'a tarefa existe', prazo: '2026-11-20', risco: 'baixo' };
  /** The board picture the entregador keeps (`retrato.json`): the Dev of `/p` alive in session `SID`. */
  const RETRATO_DEV = JSON.stringify({ at: 1_000, sessoes: { [SID]: { ...DEV, at: 1_000 } } });

  async function separado() {
    const { dir, home } = await place({ separado: true });
    writeFileSync(join(dir, 'portoes', 'vps-pessoal.sha256'), createHash('sha256').update(LOCAL_TOKEN).digest('hex'));
    writeFileSync(join(dir, 'portoes', 'vps-pessoal.local'), '');
    writeFileSync(join(dir, 'retrato.json'), RETRATO_DEV);
    return { dir, home };
  }

  it('o Líder único grava só pelo portão local; o da Homologação continua recusando', async () => {
    const { dir, home } = await separado();
    const { daemon, call } = await registro(dir, home, 'separado');
    const lider = { sessao: LIDER, call: { name: 'tarefa_criar', arguments: { ...pedido, quadro: 'p', dono: 'place:dev' } } };
    expect((await call('/v1/portao/ferramenta', lider, GATE_TOKEN)).body).toMatchObject({ ok: false });
    expect(tasksIn(dir)).toBe(0);
    const local = await call('/v1/portao/ferramenta', lider, LOCAL_TOKEN);
    expect(local.body).toMatchObject({ ok: true, tarefa: { ownerPlaceId: 'place:dev', projectPath: '/p' } });
    await daemon.stop();
    expect(tasksIn(dir)).toBe(1);
  });

  it('a mesma tarefa_criar repetida depois de um corte grava uma vez', async () => {
    const { dir, home } = await separado();
    const { daemon, post } = await registro(dir, home, 'separado');
    // The registro writes, and the answer is lost twice (the cut): the session hears it may have been written.
    let cut = true;
    const run = createSatelliteLedger({
      url: 'http://100.64.0.1:47816',
      token: () => LOCAL_TOKEN,
      post: async (url, token, body) => {
        const answer = await post(url, token, body);
        return cut ? 'caiu' : answer;
      },
    });
    const parsed = parseLedgerToolCall('tarefa_criar', pedido);
    if (!parsed.ok) throw new Error(parsed.reason);
    const caller = { projectPath: '/p', placeId: 'place:dev', boardPlaceIds: ['place:dev'] };
    expect((await run(caller, parsed.call, { mine: DEV, args: pedido })).ok).toBe(false);
    cut = false;
    const again = await run(caller, parsed.call, { mine: DEV, args: pedido });
    expect(again.ok).toBe(true);
    await daemon.stop();
    expect(tasksIn(dir)).toBe(1);
  });

  it('com o entregador fora, o recado vai ao relay com a mesma chave e não chega duas vezes quando ele volta', async () => {
    const { dir, home } = await separado();
    const { daemon, call } = await registro(dir, home, 'separado');
    const aviso = (key: string) => ({ aviso: { projectPath: '/p', placeId: 'place:dev', text: `◆ ${key}`, leaderText: `◆ ${key}`, key } });
    // The entregador is down: nothing listens where it said its gate was.
    writeFileSync(join(dir, 'portao'), '9\n');
    expect((await call('/v1/portao/aviso', aviso('decisao:1'), GATE_TOKEN)).body).toEqual({ ok: true });
    const live = { liveSessions: async () => new Set([SID]), liveNow: () => new Set([SID]) };
    const entregador = await runEntregador({ dir, home, gatePort: 0, ...live });
    try {
      expect((await call('/v1/portao/aviso', aviso('decisao:1'), GATE_TOKEN)).body).toEqual({ ok: true });
      expect((await call('/v1/portao/aviso', aviso('decisao:2'), GATE_TOKEN)).body).toEqual({ ok: true });
    } finally {
      await entregador.stop();
      await daemon.stop();
    }
    const relayed = (JSON.parse(readFileSync(join(dir, 'fila.json'), 'utf8')) as { items: Array<{ key: string }> }).items.map((item) => item.key);
    expect(relayed).toEqual(['decisao:1']);
    const queued = (JSON.parse(readFileSync(join(dir, 'recados.json'), 'utf8')) as { items: Array<{ texto: string }> }).items.map((item) => item.texto);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toContain('decisao:2');
  });
});

// Passo 9, PR 3: com a marca, o chat do celular mora no entregador (chat-local.json) e a porta 47815 dele repassa o resto
// ao servidor do celular do registro. Nenhuma mensagem do dono some ou dobra na virada, e o que vai pelo repasse chega
// com a assinatura do aparelho conferindo do outro lado.
describe('entregador à parte: o chat do celular', () => {
  const X = 'aaaaaaaa-1111-4222-8333-444444444444';
  const Y = 'bbbbbbbb-1111-4222-8333-444444444444';
  const PEDIDO = 'cccccccc-1111-4222-8333-444444444444';
  const DECISAO = 'dddddddd-1111-4222-8333-444444444444';
  const TAILNET = { 'x-forwarded-for': '100.64.0.9', 'tailscale-user-login': 'dono@exemplo' };

  /** A paired phone in the registro's celular.json, and its signature (`Donel-HMAC`, contract v1). */
  function pairedPhone(dir: string) {
    const auth = createCelularAuth({ filePath: join(dir, 'celular.json'), io });
    auth.setEnabled(true);
    const paired = auth.pair(auth.createPairingCode().code, 'Edge');
    if (!paired) throw new Error('não pareou');
    const key = createHash('sha256').update(paired.token, 'utf8').digest();
    const sign = (method: string, url: string, body: string): string => {
      const ts = String(Date.now());
      return `Donel-HMAC ${ts}.${createHmac('sha256', key).update(signedMessage(method, url, ts, body), 'utf8').digest('hex')}`;
    };
    return { auth, sign };
  }

  function entregadorChat(dir: string) {
    return createEntregadorChat({
      dir,
      home: dir,
      recados: { deliverLocal: async () => null, stateOf: () => undefined, transcriptOf: async () => undefined },
      relay: { send: async () => 'pendente', pending: () => [], byKey: () => undefined },
      verify: createPhoneSignatures(join(dir, 'celular.json'), io).verify,
      glossario: createGlossarioStore(join(dir, 'glossario.json'), () => undefined),
    });
  }

  async function listen(listener: Parameters<typeof createServer>[1]): Promise<{ port: number; close(): Promise<void> }> {
    const server = createServer(listener);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return { port: (server.address() as { port: number }).port, close: () => new Promise((done) => server.close(() => done())) };
  }

  function send(port: number, method: string, path: string, body: string, authorization: string): Promise<{ status: number; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const out = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...TAILNET, authorization, 'content-type': 'application/json' } }, (answer) => {
        let text = '';
        answer.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
        answer.on('end', () => resolve({ status: answer.statusCode ?? 0, body: JSON.parse(text) as Record<string, unknown> }));
      });
      out.once('error', reject);
      out.end(body);
    });
  }

  it('o mesmo id de mensagem antes e depois da separação não some nem dobra', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'decisoes.json'), JSON.stringify({ fila: 'local' }));
    const { sign } = pairedPhone(dir);
    const before = createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE));
    expect(before.addChat(X, 'oi')).toEqual({ ok: true, nova: true });
    before.addPedida({ pedido: PEDIDO, titulo: 'Um pedido', texto: 'faça', criterio: null, prazo: null, frente: null });
    const celularJson = readFileSync(join(dir, 'celular.json'));

    expect(separarChat(dir)).toMatchObject({ mensagens: 1 });
    expect(() => separarChat(dir)).toThrow(CHAT_LOCAL_FILE);
    const chat = entregadorChat(dir);
    const post = (id: string, texto: string) => {
      const body = JSON.stringify({ id, texto });
      return chat.handler({ method: 'POST', url: '/api/v2/chat', authorization: sign('POST', '/api/v2/chat', body), body });
    };
    // The phone's queue retried X after the switch: the same line, never a second one.
    expect(JSON.parse(String((await post(X, 'oi')).body))).toMatchObject({ ok: true, nova: false });
    expect(JSON.parse(String((await post(Y, 'tudo bem?')).body))).toMatchObject({ ok: true, nova: true });
    const conversa = await chat.handler({ method: 'GET', url: '/api/v2/chat', authorization: sign('GET', '/api/v2/chat', ''), body: '' });
    expect((JSON.parse(String(conversa.body)) as { mensagens: Array<{ id: string }> }).mensagens.map((line) => line.id)).toEqual([X, Y]);
    // The registro's file keeps the tasks he asked for and no chat (no second consumer of X); celular.json untouched.
    const registroSide = createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE));
    expect(registroSide.conversa(10)).toEqual([]);
    expect(registroSide.pedidasView(10).map((row) => row.pedido)).toEqual([PEDIDO]);
    expect(readFileSync(join(dir, 'celular.json')).equals(celularJson)).toBe(true);

    expect(juntarChat(dir)).toMatchObject({ mensagens: 2 });
    expect(existsSync(join(dir, CHAT_LOCAL_FILE))).toBe(false);
    const after = createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE));
    expect(after.conversa(10).map((line) => line.id)).toEqual([X, Y]);
    expect(after.addChat(X, 'oi')).toEqual({ ok: true, nova: false });
    expect(after.addChat(Y, 'tudo bem?')).toEqual({ ok: true, nova: false });
    expect(after.pedidasView(10).map((row) => row.pedido)).toEqual([PEDIDO]);
  });

  it('a correção de transcrição que espera o Líder vai e volta com o chat, uma vez', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'decisoes.json'), JSON.stringify({ fila: 'local' }));
    const { sign } = pairedPhone(dir);
    const C1 = 'eeeeeeee-1111-4222-8333-444444444444';
    const C2 = 'ffffffff-1111-4222-8333-444444444444';
    // A transcribed voice line of the owner, and his correction still waiting for the Líder.
    writeFileSync(
      join(dir, CELULAR_LOCAL_FILE),
      JSON.stringify({
        versao: 1,
        decisoes: [],
        pedidas: [],
        chat: [{ id: X, autor: 'dono', texto: 'ola', em_resposta_a: null, criada_em: '2026-11-19T10:00:00.000Z', entregue_em: '2026-11-19T10:00:05.000Z', resultado: 'lider', audio: { estado: 'transcrito', duracao_ms: 900, mime: 'audio/webm', sha256: 'x' } }],
      }),
    );
    expect(createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE)).corrigirAudio(C1, X, 'olá')).toMatchObject({ ok: true, nova: true });

    separarChat(dir);
    const chat = entregadorChat(dir);
    const corrigir = (id: string, texto: string) => {
      const body = JSON.stringify({ id, audio: X, texto });
      return chat.handler({ method: 'POST', url: '/api/v2/chat/correcao', authorization: sign('POST', '/api/v2/chat/correcao', body), body });
    };
    // The phone retries C1 after the switch: the same correction. A new one is answered here and the glossary learns.
    expect(JSON.parse(String((await corrigir(C1, 'olá')).body))).toMatchObject({ ok: true, nova: false });
    expect(JSON.parse(String((await corrigir(C2, 'olá, Líder')).body))).toMatchObject({ ok: true, nova: true, correcoes: 1 });
    // No consumer of the registro's file finds a correction (no second delivery).
    expect(await createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE)).chat.tomar(10)).toEqual([]);
    const correcoes = (file: string): Array<{ id: string }> => (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { correcoes?: Array<{ id: string }> }).correcoes ?? [];
    const separadas = correcoes(CHAT_LOCAL_FILE);
    expect(separadas.map((row) => row.id)).toEqual([C1, C2]);

    // Back together: each correction once, as the entregador left it (delivered or waiting).
    juntarChat(dir);
    expect(correcoes(CELULAR_LOCAL_FILE)).toEqual(separadas);
  });

  it('decidir pelo repasse chega com corpo e assinatura iguais, e o chat fica no entregador', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'decisoes.json'), JSON.stringify({ fila: 'local' }));
    const { auth, sign } = pairedPhone(dir);
    separarChat(dir);
    // The registro's phone server (47818 in production): its own v2 over celular-local.json, checking the signature.
    const registroStore = createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE));
    const v2 = createCelularV2Handler({
      verify: (message, signature) => {
        const device = auth.verifySignature(message, signature);
        return device ? { name: device.name } : null;
      },
      doc: () => null,
      store: registroStore,
      readProof: async () => ({ kind: 'sumiu' }),
      arvoreFile: join(dir, 'arvore.json'),
    });
    const upstream = await listen(mobileRequestListener(createMobileHandler({ auth, v2: () => v2, ledger: () => ({}) as never, assets: {}, provasRoot: null })));
    const chat = entregadorChat(dir);
    const front = await listen(createPhoneFront({ chat: chat.handler, upstream: () => ({ host: '127.0.0.1', port: upstream.port }), log: () => undefined }));
    try {
      const decisao = JSON.stringify({ pedido: DECISAO, tarefa: 't-1', lado: 'sim', opcao: null, comentario: null, assinatura: null });
      expect(await send(front.port, 'POST', '/api/v2/decidir', decisao, sign('POST', '/api/v2/decidir', decisao))).toEqual({ status: 200, body: { ok: true, nova: true } });
      expect(registroStore.pendingDecision('t-1')).toMatchObject({ lado: 'sim' });
      // A signature for another body does not pass the registro.
      const outra = decisao.replace('"sim"', '"nao"');
      expect((await send(front.port, 'POST', '/api/v2/decidir', outra, sign('POST', '/api/v2/decidir', decisao))).status).toBe(401);
      // The chat is answered by the entregador: its line is in chat-local.json, never in the registro's file.
      const linha = JSON.stringify({ id: X, texto: 'oi' });
      expect((await send(front.port, 'POST', '/api/v2/chat', linha, sign('POST', '/api/v2/chat', linha))).body).toMatchObject({ ok: true, nova: true });
      expect(createCelularLocalStore(join(dir, CHAT_LOCAL_FILE)).conversa(10).map((line) => line.id)).toEqual([X]);
      expect(createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE)).conversa(10)).toEqual([]);
    } finally {
      await front.close();
      await upstream.close();
    }
  });
});
