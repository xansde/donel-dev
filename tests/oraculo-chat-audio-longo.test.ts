import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { createChatAudioWorker } from '../src/oraculo/chat-audio';
import { emendar, planPedacos, type AudioMidia } from '../src/oraculo/chat-audio-longo';

// t-b03fdec8 — o áudio sem limite de duração (contrato v1.6): partes de 60 s, `fim`, fechamento sozinho em 30 min e a
// transcrição em pedaços. O que não pode acontecer sem o dono ver: uma parte reenviada entrar duas vezes ou trocar de
// conteúdo; o áudio ir ao Líder antes do fim, em pedaços, fora de ordem ou cortado; uma queda no meio perder o que já
// tinha chegado.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
const T0 = Date.parse('2026-11-19T10:00:00Z');
const UUID = (n: number): string => `${String(n).padStart(8, '0')}-1111-4222-8333-444455556666`;
/** A fake webm: part 0 opens with the header and the first Cluster; each part carries its label. */
const HEADER = Buffer.from('HDR');
const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
const parteBytes = (n: number): Buffer => (n === 0 ? Buffer.concat([HEADER, CLUSTER, Buffer.from('P0;')]) : Buffer.from(`P${n};`));

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-audio-longo-'));
  dirs.push(dir);
  const file = join(dir, 'celular-local.json');
  let at = T0;
  const now = () => at;
  const store = createCelularLocalStore(file, now);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now });
  const queued: string[] = [];
  const kicks: string[] = [];
  const h = createCelularV2Handler({
    verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
    doc: () => ledger.load().doc,
    store,
    readProof: async () => ({ kind: 'sumiu' }),
    arvoreFile: join(dir, 'arvore.json'),
    audio: (id) => queued.push(id),
    kick: (fila) => kicks.push(fila),
    now,
  });
  return {
    dir,
    store,
    queued,
    kicks,
    advance(ms: number) {
      at += ms;
    },
    now,
    call(method: string, url: string, body = '') {
      const ts = String(now());
      const sig = createHmac('sha256', KEY).update(signedMessage(method, url, ts, body), 'utf8').digest('hex');
      return h({ method, url, body, authorization: `Donel-HMAC ${ts}.${sig}` });
    },
  };
}

const parse = (response: { body: unknown }): any => JSON.parse(String(response.body));
const parte = (id: string, n: number, bytes: Buffer = parteBytes(n), mime = 'audio/webm'): string => JSON.stringify({ id, n, mime, audio_b64: bytes.toString('base64') });
const fim = (id: string, partes: number, interrompido = false, duracao_ms = partes * 60_000): string => JSON.stringify({ id, partes, duracao_ms, interrompido });

/** ffmpeg of mentira: each label `P<n>;` is the minute n of the recording; a piece holds the labels whose middle is in it. */
function fakeMidia(silencios: Array<[number, number]> = []): AudioMidia {
  const labels = (path: string): number[] => [...readFileSync(path, 'latin1').matchAll(/P(\d+);/g)].map((m) => Number(m[1]));
  return {
    async paraWav(entrada, wav) {
      const ns = labels(entrada);
      // Without the header (a later run that lost it) ffmpeg would not read it.
      if (!readFileSync(entrada, 'latin1').startsWith('HDR')) throw new Error('sem cabeçalho');
      writeFileSync(wav, ns.map((n) => `P${n};`).join(''));
      return ns.length * 60;
    },
    async silencios() {
      return silencios;
    },
    async cortar(wav, inicio, fimS, saida) {
      const ns = labels(wav);
      writeFileSync(saida, ns.filter((_, i) => i * 60 + 30 >= inicio && i * 60 + 30 < fimS).map((n) => `fala${n}`).join(' '));
    },
  };
}

describe('áudio em partes (/api/v2/chat/audio/parte e /fim)', () => {
  it('partes fora de ordem e repetidas entram uma vez; outros bytes dão 409; o fim junta em ordem e é idempotente', async () => {
    const w = world();
    const id = UUID(1);
    expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 2)))).toEqual({ ok: true, nova: true, recebidas: 1 });
    expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 0)))).toEqual({ ok: true, nova: true, recebidas: 2 });
    expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 2)))).toEqual({ ok: true, nova: false, recebidas: 2 });
    expect((await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 2, Buffer.from('outra')))).status).toBe(409);
    // Subindo: aparece na conversa, nunca vai ao Líder.
    const [linha] = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(linha).toMatchObject({ id, estado: null, audio: { estado: 'subindo', partes: 2, interrompido: false } });
    expect(await w.store.chat.tomar(10)).toHaveLength(0);

    // Falta a parte 1: 409 com a lista; nada é transcrito.
    const faltando = await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 4));
    expect(faltando.status).toBe(409);
    expect(parse(faltando)).toEqual({ erro: 'faltam-partes', faltam: [1, 3] });
    expect(w.queued).toEqual([]);

    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 3));
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 1));
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 4)))).toEqual({ ok: true, nova: true, estado: 'transcrevendo' });
    expect(readFileSync(join(w.dir, 'chat-audio', `${id}.webm`))).toEqual(Buffer.concat([0, 1, 2, 3].map((n) => parteBytes(n))));
    expect(existsSync(join(w.dir, 'chat-audio', id))).toBe(false);
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 4)))).toEqual({ ok: true, nova: false, estado: 'transcrevendo' });
    expect(w.queued).toEqual([id]);
    // Depois do fim: a mesma parte é a mesma; uma parte nova é recusada.
    expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 1))).nova).toBe(false);
    expect((await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 4))).status).toBe(409);
    // O id de um texto, ou de um áudio inteiro, não vira áudio em partes (nem o contrário).
    await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(2), texto: 'oi' }));
    expect((await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(2), 0))).status).toBe(409);
    expect((await w.call('POST', '/api/v2/chat/audio', JSON.stringify({ id, mime: 'audio/webm', duracao_ms: 1000, audio_b64: parteBytes(0).toString('base64') }))).status).toBe(409);
  });

  it('mp4 em parte dá 415; passar de 2 h dá 413', async () => {
    const w = world();
    const mp4 = await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(1), 0, parteBytes(0), 'audio/mp4'));
    expect(mp4.status).toBe(415);
    expect(parse(mp4).erro).toBe('formato-sem-partes');
    expect((await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(1), 0, parteBytes(0), 'audio/flac'))).status).toBe(415);
    expect((await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(1), 119))).status).toBe(200);
    const longa = await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(1), 120));
    expect(longa.status).toBe(413);
    expect(parse(longa).erro).toBe('longo-demais');
    expect((await w.call('POST', '/api/v2/chat/audio/fim', fim(UUID(1), 120, false, 2 * 3600_000 + 1))).status).toBe(413);
  });

  it('sem a parte 0 o fim marca falhou (sem-parte-0) e o Líder recebe o aviso uma vez, com o que chegou guardado', async () => {
    const w = world();
    const id = UUID(1);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 1));
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 2, true)))).toEqual({ ok: true, nova: true, estado: 'falhou' });
    expect(w.queued).toEqual([]);
    expect(w.kicks).toEqual(['chat']);
    const taken = await w.store.chat.tomar(10);
    expect(taken).toHaveLength(1);
    expect(taken[0]!.texto).toContain('o começo da gravação não chegou à VPS');
    expect(readFileSync(join(w.dir, 'chat-audio', `${id}.webm`))).toEqual(parteBytes(1));
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
  });

  it('buraco no meio com interrompido: junta o que tem, em ordem, com a marca no lugar do buraco; uma entrega só', async () => {
    const w = world();
    const id = UUID(1);
    for (const n of [0, 1, 4, 5]) await w.call('POST', '/api/v2/chat/audio/parte', parte(id, n));
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 7, true))).estado).toBe('transcrevendo');
    const worker = createChatAudioWorker({
      store: w.store,
      transcribe: async () => 'não é o caminho curto',
      transcribePedaco: async (file) => readFileSync(file, 'utf8'),
      midia: fakeMidia(),
      kick: (fila) => w.kicks.push(fila),
      log: () => {},
    });
    worker.enqueue(id);
    await worker.idle();
    const taken = await w.store.chat.tomar(10);
    expect(taken).toHaveLength(1);
    expect(taken[0]!.texto).toBe(
      '🎙 Áudio de 7:00 (transcrição): (gravação interrompida) fala0 fala1 (gravação interrompida; faltou o trecho de ~2 min) fala4 fala5 (gravação interrompida; faltou o trecho de ~1 min)',
    );
    expect(readFileSync(join(w.dir, 'chat-audio', `${id}.txt`), 'utf8')).toContain('fala4 fala5');
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens[0].audio).toMatchObject({ estado: 'transcrito', partes: 4, interrompido: true });
    worker.stop();
  });

  it('sem fim há 30 min a VPS fecha sozinha como interrompido, com o que tem', async () => {
    const w = world();
    const id = UUID(1);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 0));
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 1));
    const worker = createChatAudioWorker({
      store: w.store,
      transcribe: async () => '',
      transcribePedaco: async (file) => readFileSync(file, 'utf8'),
      midia: fakeMidia(),
      kick: () => {},
      log: () => {},
      now: w.now,
    });
    w.advance(29 * 60_000);
    worker.fecharParados();
    expect(w.store.audioEstado(id)).toBe('subindo');
    w.advance(2 * 60_000);
    worker.fecharParados();
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens[0].audio).toMatchObject({ partes: 2, interrompido: true, duracao_ms: 120_000 });
    expect(readFileSync(join(w.dir, 'chat-audio', `${id}.webm`))).toEqual(Buffer.concat([parteBytes(0), parteBytes(1)]));
    // O fim que o app manda ao reabrir depois disso não fecha de novo.
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 2, true))).nova).toBe(false);
    await worker.idle();
    expect((await w.store.chat.tomar(10)).map((row) => row.texto)).toEqual(['🎙 Áudio de 2:00 (transcrição): (gravação interrompida) fala0 fala1']);
    worker.stop();
  });

  it('10 min em pedaços cortados no silêncio, um por vez e em ordem, com o andamento; o texto longo chega inteiro', async () => {
    const w = world();
    const id = UUID(1);
    for (let n = 11; n >= 0; n -= 1) await w.call('POST', '/api/v2/chat/audio/parte', parte(id, n));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 12, false, 720_000));
    const andamento: string[] = [];
    let emCurso = 0;
    const worker = createChatAudioWorker({
      store: w.store,
      transcribe: async () => 'não é o caminho curto',
      transcribePedaco: async (file) => {
        emCurso += 1;
        expect(emCurso).toBe(1);
        andamento.push(parse(await w.call('GET', '/api/v2/chat')).mensagens[0].audio.pedacos);
        emCurso -= 1;
        // ~4000 caracteres por pedaço: o texto inteiro passa do corte de 3500 da fila.
        return `${readFileSync(file, 'utf8')} ${'blá '.repeat(1000)}`;
      },
      midia: fakeMidia([[289, 291], [589, 591]]),
      kick: () => {},
      log: () => {},
    });
    worker.enqueue(id);
    await worker.idle();
    expect(andamento).toEqual(['0/3', '1/3', '2/3']);
    const [row] = await w.store.chat.tomar(10);
    expect(row!.inteiro).toBe(true);
    expect(row!.texto.startsWith('◆ Do dono, pelo chat do celular [celular #00000001]: «🎙 Áudio de 12:00 (transcrição): fala0 fala1 fala2 fala3 fala4 blá')).toBe(true);
    const ordem = [...row!.texto.matchAll(/fala(\d+)/g)].map((m) => Number(m[1]));
    expect(ordem).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(row!.texto.endsWith('»')).toBe(true);
    worker.stop();
  });
});

describe('pedaços e emenda', () => {
  it('corta no silêncio mais perto de 5 min entre 4 e 6; sem silêncio, corte seco em 5 min com 2 s de sobreposição', () => {
    expect(planPedacos(200, [])).toEqual([{ inicio: 0, fim: 200, sobrepoe: false }]);
    expect(planPedacos(600, [[100, 101], [250, 251], [310, 311], [400, 401]])).toEqual([
      { inicio: 0, fim: 310.5, sobrepoe: false },
      { inicio: 310.5, fim: 600, sobrepoe: false },
    ]);
    expect(planPedacos(600, [[100, 101]])).toEqual([
      { inicio: 0, fim: 300, sobrepoe: false },
      { inicio: 298, fim: 600, sobrepoe: true },
    ]);
  });

  it('a emenda do corte seco não repete as palavras dos 2 s em comum; uma palavra só nunca some', () => {
    expect(emendar('eu quero ver o resultado inteiro', 'Resultado, inteiro! e depois o resto', true)).toBe('eu quero ver o resultado inteiro e depois o resto');
    expect(emendar('falei que sim', 'sim, e mais', true)).toBe('falei que sim sim, e mais');
    expect(emendar('o resultado inteiro', 'resultado inteiro', false)).toBe('o resultado inteiro resultado inteiro');
  });
});
