import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { chatKey, chatText, createChatCelularConsumer } from '../src/oraculo/chat-celular';
import { createGlossarioStore } from '../src/oraculo/glossario';
import type { RecadoState } from '../src/oraculo/recados';

// t-753e8199 — o dono corrige a transcrição de um áudio no chat do celular (contrato v1.3) e o transcritor aprende. O que
// não pode acontecer sem o dono ver: a correção reenviada (a rede caiu) entrar duas vezes ou trocar de texto em silêncio;
// o Líder receber a mesma correção duas vezes, ou nenhuma; a resposta do Líder à correção roubar a do áudio, sumir ou
// voltar duas vezes ao celular; o glossário aprender errado ou não abrir; o arquivo de antes da correção deixar de abrir.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
const T0 = Date.parse('2026-11-19T10:00:00Z');
const UUID = (n: number): string => `${String(n).padStart(8, '0')}-1111-4222-8333-444455556666`;
const AUDIO = UUID(1);
const TRANSCRITO = 'Abre o do nel e manda o PR pra staging.';

function world(options: { transcrito?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-correcao-'));
  dirs.push(dir);
  const file = join(dir, 'celular-local.json');
  const glossarioFile = join(dir, 'transcricao', 'glossario.json');
  const clock = { now: T0 };
  const now = () => clock.now;
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
      glossario: createGlossarioStore(glossarioFile, () => undefined),
      now,
    });
  let h = handler();
  const w = {
    dir,
    file,
    glossarioFile,
    clock,
    kicks,
    get store() {
      return store;
    },
    reopen() {
      store = createCelularLocalStore(file, now);
      h = handler();
    },
    call(method: string, url: string, body = '') {
      const ts = String(now());
      const sig = createHmac('sha256', KEY).update(signedMessage(method, url, ts, body), 'utf8').digest('hex');
      return h({ method, url, body, authorization: `Donel-HMAC ${ts}.${sig}` });
    },
    /** An audio of the owner, already transcribed by the daemon. */
    audioTranscrito(id = AUDIO, texto = options.transcrito ?? TRANSCRITO) {
      expect(store.addChatAudio(id, { mime: 'audio/ogg', duracao_ms: 12_000 }, Buffer.from(`OggS ${id}`))).toEqual({ ok: true, nova: true });
      expect(store.concluirAudio(id, { texto })).toBe(true);
    },
    corrigir(id: string, texto: string, audio = AUDIO) {
      clock.now += 1000;
      return w.call('POST', '/api/v2/chat/correcao', JSON.stringify({ id, audio, texto }));
    },
  };
  return w;
}

const parse = (response: { body: unknown }): any => JSON.parse(String(response.body));
const corrigida = (id: string, texto: string): string => `✏️ O dono corrigiu a transcrição do áudio [celular #${id.slice(0, 8)}]: ${texto}`;

describe('correção da transcrição de um áudio (/api/v2/chat/correcao)', () => {
  it('a correção reenviada entra uma vez; o mesmo id com outro texto dá 409; a linha vira o texto corrigido', async () => {
    const w = world();
    w.audioTranscrito();
    const first = await w.corrigir(UUID(2), 'Abre o Donel e manda o PR pra staging.');
    expect(first.status).toBe(200);
    expect(parse(first)).toEqual({ ok: true, nova: true, correcoes: 1 });
    expect(parse(await w.corrigir(UUID(2), 'Abre o Donel e manda o PR pra staging.'))).toEqual({ ok: true, nova: false, correcoes: 1 });
    const conflito = await w.corrigir(UUID(2), 'outro texto');
    expect(conflito.status).toBe(409);
    expect(parse(conflito).erro).toBe('conflito');
    expect(w.kicks).toEqual(['chat']);

    const body = parse(await w.call('GET', '/api/v2/chat'));
    expect(body.mensagens).toHaveLength(1);
    expect(body.mensagens[0]).toMatchObject({ id: AUDIO, texto: 'Abre o Donel e manda o PR pra staging.', audio: { estado: 'transcrito', corrigida: true } });
    // Sobrevive ao reinício do daemon, e o reenvio depois dele segue sem duplicar.
    w.reopen();
    expect(parse(await w.corrigir(UUID(2), 'Abre o Donel e manda o PR pra staging.')).nova).toBe(false);
    const taken = await w.store.chat.tomar(10);
    expect(taken.filter((row) => row.id === UUID(2))).toHaveLength(1);
  });

  it('linha que não é áudio transcrito dá 409 nao-e-audio; mensagem inexistente dá 404', async () => {
    const w = world();
    await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(3), texto: 'oi' }));
    const texto = await w.corrigir(UUID(4), 'olá', UUID(3));
    expect(texto.status).toBe(409);
    expect(parse(texto).erro).toBe('nao-e-audio');
    // Áudio ainda transcrevendo, e áudio que falhou: também não.
    w.store.addChatAudio(UUID(5), { mime: 'audio/ogg', duracao_ms: 1000 }, Buffer.from('OggS 5'));
    expect(parse(await w.corrigir(UUID(6), 'x', UUID(5))).erro).toBe('nao-e-audio');
    w.store.concluirAudio(UUID(5), { motivo: 'o transcritor não respondeu' });
    expect(parse(await w.corrigir(UUID(6), 'x', UUID(5))).erro).toBe('nao-e-audio');
    const nenhuma = await w.corrigir(UUID(7), 'x', UUID(99));
    expect(nenhuma.status).toBe(404);
    expect(parse(nenhuma).erro).toBe('nao-encontrada');
    // O id de uma mensagem não serve de id de correção, e o id de uma correção não serve de mensagem.
    w.audioTranscrito();
    expect(parse(await w.corrigir(UUID(3), 'Abre o Donel')).erro).toBe('conflito');
    expect((await w.corrigir(UUID(8), 'Abre o Donel')).status).toBe(200);
    expect((await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(8), texto: 'oi' }))).status).toBe(409);
    expect(w.kicks.filter((fila) => fila === 'chat')).toHaveLength(2);
  });

  it('cada correção é uma entrega ao Líder, com o texto do contrato; duas correções da mesma linha: vale a última', async () => {
    const w = world();
    w.audioTranscrito();
    // O áudio já foi entregue ao Líder antes da correção.
    const [audio] = await w.store.chat.tomar(10);
    await w.store.chat.entregue(audio!.id, 'entregue');

    await w.corrigir(UUID(2), 'Abre o Donel e manda o PR pra staging.');
    await w.corrigir(UUID(3), 'Abre o Donel Dev e manda o PR pra staging.');
    await w.corrigir(UUID(2), 'Abre o Donel e manda o PR pra staging.'); // reenvio da primeira, depois da segunda

    const taken = await w.store.chat.tomar(10);
    expect(taken.map((row) => chatText(row))).toEqual([corrigida(UUID(2), 'Abre o Donel e manda o PR pra staging.'), corrigida(UUID(3), 'Abre o Donel Dev e manda o PR pra staging.')]);
    for (const row of taken) {
      expect(await w.store.chat.estacionar(row.id, 'parada')).toBe(true);
      expect((await w.store.chat.estacionadas('parada', 10)).map((parked) => parked.id)).toContain(row.id);
      expect(await w.store.chat.entregue(row.id, 'entregue')).toBe(true);
      expect(await w.store.chat.entregue(row.id, 'entregue')).toBe(false);
    }
    // Nada volta à fila: nem depois da reserva, nem depois do reinício.
    w.clock.now += 60 * 60_000;
    w.reopen();
    expect(await w.store.chat.tomar(10)).toEqual([]);
    expect(await w.store.chat.estacionadas('parada', 10)).toEqual([]);
    const [linha] = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(linha.texto).toBe('Abre o Donel Dev e manda o PR pra staging.');
  });

  it('o glossário aprende a troca e o termo (sem caixa, acento nem pontuação na comparação) e só o daemon grava, 600', async () => {
    const w = world();
    w.audioTranscrito(UUID(1), 'Abre o do nel, e mande ao revizor.');
    w.audioTranscrito(UUID(2), 'O DO NEL caiu? Fala com o Revizor!');
    expect(parse(await w.corrigir(UUID(11), 'Abre o Donel, e mande ao Revisor.', UUID(1))).correcoes).toBe(1);
    const resposta = parse(await w.corrigir(UUID(12), 'O Donel caiu? Fala com o revisor!', UUID(2)));
    expect(resposta).toEqual({ ok: true, nova: true, correcoes: 2 });

    const glossario = JSON.parse(readFileSync(w.glossarioFile, 'utf8'));
    expect(glossario).toMatchObject({ versao: 1, termos: { Donel: 2, Revisor: 2 }, trocas: { 'do nel': { certo: 'Donel', n: 2 }, revizor: { certo: 'Revisor', n: 2 } } });
    expect(Object.keys(glossario.termos)).toEqual(['Donel', 'Revisor']);
    expect(statSync(w.glossarioFile).mode & 0o777).toBe(0o600);
    expect(parse(await w.call('GET', '/api/v2/chat')).glossario).toEqual({ correcoes: 2, trocas: 2 });

    // A mesma correção reenviada não aprende de novo; uma troca vista uma vez ainda não está ativa.
    await w.corrigir(UUID(12), 'O Donel caiu? Fala com o revisor!', UUID(2));
    w.audioTranscrito(UUID(3), 'Chama o oraclo.');
    await w.corrigir(UUID(13), 'Chama o Oráculo.', UUID(3));
    const depois = JSON.parse(readFileSync(w.glossarioFile, 'utf8'));
    expect(depois.trocas['do nel'].n).toBe(2);
    expect(depois.trocas.oraclo).toEqual({ certo: 'Oráculo', n: 1 });
    expect(parse(await w.call('GET', '/api/v2/chat')).glossario).toEqual({ correcoes: 3, trocas: 2 });
    // Só mudar caixa, acento ou pontuação não é troca.
    w.audioTranscrito(UUID(4), 'abre o oraculo');
    await w.corrigir(UUID(14), 'Abre o Oráculo!', UUID(4));
    expect(Object.keys(JSON.parse(readFileSync(w.glossarioFile, 'utf8')).trocas).sort()).toEqual(['do nel', 'oraclo', 'revizor']);
  });

  it('o arquivo de antes da correção, e o glossário ausente ou sem contagem, abrem', async () => {
    const w = world();
    writeFileSync(
      w.file,
      JSON.stringify({
        versao: 1,
        decisoes: [],
        pedidas: [],
        chat: [
          { id: UUID(9), autor: 'dono', texto: 'o do nel', em_resposta_a: null, criada_em: '2026-11-18T20:00:00.000Z', audio: { estado: 'transcrito', duracao_ms: 3000, mime: 'audio/ogg', sha256: 'x' } },
        ],
      }),
    );
    w.reopen();
    const antes = parse(await w.call('GET', '/api/v2/chat'));
    expect(antes.glossario).toEqual({ correcoes: 0, trocas: 0 });
    expect(antes.mensagens[0].audio).toEqual({ estado: 'transcrito', duracao_ms: 3000, motivo: null });
    expect(parse(await w.corrigir(UUID(10), 'o Donel', UUID(9)))).toEqual({ ok: true, nova: true, correcoes: 1 });
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens[0]).toMatchObject({ texto: 'o Donel', audio: { corrigida: true } });

    // Um glossário escrito por outro (sem a contagem de correções): lido e somado, nunca zerado.
    writeFileSync(w.glossarioFile, JSON.stringify({ versao: 1, termos: { Donel: 3 }, trocas: { 'do nel': { certo: 'Donel', n: 3 } } }));
    expect(parse(await w.call('GET', '/api/v2/chat')).glossario).toEqual({ correcoes: 0, trocas: 1 });
    w.audioTranscrito(UUID(11), 'o do nel');
    await w.corrigir(UUID(12), 'o Donel', UUID(11));
    expect(JSON.parse(readFileSync(w.glossarioFile, 'utf8'))).toMatchObject({ correcoes: 1, termos: { Donel: 4 }, trocas: { 'do nel': { certo: 'Donel', n: 4 } } });
    // Quebrado: o GET segue de pé, e a próxima correção recomeça o glossário sem derrubar a rota.
    writeFileSync(w.glossarioFile, '{ quebrado');
    expect(parse(await w.call('GET', '/api/v2/chat')).glossario).toEqual({ correcoes: 0, trocas: 0 });
    w.audioTranscrito(UUID(13), 'o do nel');
    expect((await w.corrigir(UUID(14), 'o Donel', UUID(13))).status).toBe(200);
    expect(JSON.parse(readFileSync(w.glossarioFile, 'utf8')).trocas['do nel']).toEqual({ certo: 'Donel', n: 1 });
  });
});

describe('a resposta do Líder à correção volta ao celular', () => {
  /** The Líder único alive here: his queue delivers at once; his transcript is what the test writes. */
  function lider(w: ReturnType<typeof world>) {
    const states = new Map<string, { estado: RecadoState; sid: string }>();
    const lidas: string[] = [];
    let tail = '';
    const consumer = createChatCelularConsumer({
      queue: () => w.store.chat,
      relay: { send: async () => 'pendente', pending: () => [] },
      waitMs: 0,
      local: {
        deliver: async (message, localText) => {
          if (!states.has(message.key!)) lidas.push(localText);
          states.set(message.key!, { estado: 'entregue', sid: 'sid-lider' });
          return 'lider';
        },
        state: (key) => states.get(key),
        tail: async () => tail,
      },
      log: () => undefined,
    });
    const read = (text: string): string => JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: `Stop hook feedback:\n${text}` } });
    const said = (text: string): string => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
    return {
      consumer,
      lidas,
      /** The Líder reads each message he got and answers it, in order. */
      conversa(turnos: Array<[number, string]>) {
        tail = turnos.map(([index, answer]) => `${read(lidas[index]!)}\n${said(answer)}`).join('\n');
      },
    };
  }
  const respostas = (w: ReturnType<typeof world>) => w.store.conversa(100).filter((linha) => linha.autor === 'lider');

  it('o Líder respondeu ao áudio antes: a resposta à correção chega uma vez, sem tocar na do áudio', async () => {
    const w = world();
    w.audioTranscrito();
    const l = lider(w);
    await l.consumer.round();
    await l.consumer.round();
    l.conversa([[0, 'Abrindo o do nel.']]);
    await l.consumer.round();
    expect(respostas(w).map((linha) => linha.texto)).toEqual(['Abrindo o do nel.']);

    await w.corrigir(UUID(2), 'Abre o Donel e manda o PR pra staging.');
    await l.consumer.round();
    await l.consumer.round();
    expect(l.lidas).toHaveLength(2);
    expect(l.lidas[1]).toContain(corrigida(UUID(2), 'Abre o Donel e manda o PR pra staging.'));
    l.conversa([
      [0, 'Abrindo o do nel.'],
      [1, 'Ah, o Donel: abrindo.'],
    ]);
    for (let i = 0; i < 3; i += 1) await l.consumer.round();
    const linhas = respostas(w);
    expect(linhas.map((linha) => [linha.em_resposta_a, linha.texto])).toEqual([
      [AUDIO, 'Abrindo o do nel.'],
      [AUDIO, 'Ah, o Donel: abrindo.'],
    ]);
    expect(w.store.chatEstado(AUDIO)).toBe('respondida');
    expect(chatKey(UUID(2))).not.toBe(chatKey(AUDIO));
  });

  it('o Líder ainda não tinha respondido ao áudio: cada um recebe a sua resposta uma vez, nenhuma some', async () => {
    const w = world();
    w.audioTranscrito();
    const l = lider(w);
    await l.consumer.round();
    await l.consumer.round();
    await w.corrigir(UUID(2), 'Abre o Donel e manda o PR pra staging.');
    await l.consumer.round();
    await l.consumer.round();
    expect(l.lidas).toHaveLength(2);
    l.conversa([
      [0, 'Vou abrir.'],
      [1, 'Corrigido: abro o Donel.'],
    ]);
    for (let i = 0; i < 3; i += 1) await l.consumer.round();
    w.reopen();
    expect(respostas(w).map((linha) => linha.texto)).toEqual(['Vou abrir.', 'Corrigido: abro o Donel.']);
  });
});
