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
import { TranscribeError } from '../src/main/celular/transcrever';
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
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const HEADER = Buffer.concat([EBML, Buffer.from('HDR')]);
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
const parte = (id: string, n: number, bytes: Buffer = parteBytes(n), mime = 'audio/webm', continua?: string): string =>
  JSON.stringify({ id, n, mime, audio_b64: bytes.toString('base64'), ...(continua ? { continua } : {}) });
const fim = (id: string, partes: number, interrompido = false, duracao_ms = partes * 60_000, continua?: string): string =>
  JSON.stringify({ id, partes, duracao_ms, interrompido, ...(continua ? { continua } : {}) });

/** ffmpeg of mentira: each label `P<n>;` is the minute n of the recording; a piece holds the labels whose middle is in it. */
function fakeMidia(silencios: Array<[number, number]> = []): AudioMidia {
  const labels = (path: string): number[] => [...readFileSync(path, 'latin1').matchAll(/P(\d+);/g)].map((m) => Number(m[1]));
  return {
    async paraWav(entrada, wav) {
      const ns = labels(entrada);
      // Without the header (a later run that lost it) ffmpeg would not read it.
      if (!readFileSync(entrada).subarray(0, EBML.length).equals(EBML)) throw new Error('sem cabeçalho');
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
        // ~2000 caracteres por pedaço: o texto inteiro passa do corte de 3500 da fila e cabe no teto do tmux.
        return `${readFileSync(file, 'utf8')} ${'blá '.repeat(500)}`;
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

describe('áudio longo: o que o Líder recebe e o que não se perde', () => {
  it('transcrição enorme vai ao Líder com começo, fim e o caminho do .txt, abaixo do teto do tmux (~16 KB) em bytes', async () => {
    const w = world();
    const id = UUID(1);
    for (let n = 0; n < 3; n += 1) await w.call('POST', '/api/v2/chat/audio/parte', parte(id, n));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 3));
    const worker = createChatAudioWorker({
      store: w.store,
      transcribe: async () => '',
      // ~25 min de fala com acento: passa de 16 KB, longe dos 40 mil caracteres de antes.
      transcribePedaco: async (file) => `${readFileSync(file, 'utf8')} ${'ação é coração '.repeat(2500)}`,
      midia: fakeMidia(),
      kick: () => {},
      log: () => {},
    });
    worker.enqueue(id);
    await worker.idle();
    const [row] = await w.store.chat.tomar(10);
    expect(Buffer.byteLength(row!.texto)).toBeLessThanOrEqual(12_000);
    expect(row!.texto).toContain('fala0');
    expect(row!.texto).toContain(join(w.dir, 'chat-audio', `${id}.txt`));
    expect(row!.texto.endsWith('coração»')).toBe(true);
    expect(readFileSync(join(w.dir, 'chat-audio', `${id}.txt`), 'utf8').length).toBeGreaterThan(30_000);
    worker.stop();
  });

  it('pedaço sem vaga no limitador (ou fora do tempo) é tentado de novo mais tarde, sem marca e sem refazer o que já saiu', async () => {
    const w = world();
    const id = UUID(1);
    for (let n = 0; n < 12; n += 1) await w.call('POST', '/api/v2/chat/audio/parte', parte(id, n));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 12));
    const chamadas: string[] = [];
    let recusar = 1;
    const worker = createChatAudioWorker({
      store: w.store,
      transcribe: async () => '',
      transcribePedaco: async (file) => {
        const texto = readFileSync(file, 'utf8');
        chamadas.push(texto.split(' ')[0]!);
        if (texto.startsWith('fala5') && recusar-- > 0) throw new TranscribeError('tempo', 'a VPS ficou sem vaga para transcrever');
        return texto;
      },
      midia: fakeMidia([[289, 291], [589, 591]]),
      kick: () => {},
      log: () => {},
      adiarMs: 5,
    });
    worker.enqueue(id);
    await worker.idle();
    expect(w.store.audioEstado(id)).toBe('transcrevendo');
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await worker.idle();
    const [row] = await w.store.chat.tomar(10);
    expect(row!.texto).not.toContain('não transcrito');
    expect([...row!.texto.matchAll(/fala(\d+)/g)].map((m) => Number(m[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // O pedaço que já tinha saído não volta ao transcritor.
    expect(chamadas).toEqual(['fala0', 'fala5', 'fala5', 'fala10']);
    worker.stop();
  });
});

describe('rodada 3: fim do aparelho e o cancelar (v1.7)', () => {
  const worker = (w: ReturnType<typeof world>, extra: Partial<Parameters<typeof createChatAudioWorker>[0]> = {}) =>
    createChatAudioWorker({
      store: w.store,
      transcribe: async () => '',
      transcribePedaco: async (file) => readFileSync(file, 'utf8'),
      midia: fakeMidia(),
      kick: () => {},
      log: () => {},
      now: w.now,
      ...extra,
    });

  it('depois de um fim mandado pelo aparelho (interrompido) parte nova dá 409 e nada chega ao Líder depois', async () => {
    const w = world();
    const id = UUID(1);
    const wk = worker(w);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 0));
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 1));
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 2, true))).estado).toBe('transcrevendo');
    expect((await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 2))).status).toBe(409);
    for (const queued of w.queued) wk.enqueue(queued);
    await wk.idle();
    w.advance(31 * 60_000);
    wk.fecharParados();
    await wk.idle();
    expect((await w.store.chat.tomar(10)).map((row) => row.texto)).toEqual(['🎙 Áudio de 2:00 (transcrição): (gravação interrompida) fala0 fala1']);
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens).toHaveLength(1);
    wk.stop();
  });

  it('cancelado: apaga as partes na hora, some da conversa, é idempotente, deixa lápide e nunca chega ao Líder', async () => {
    const w = world();
    const id = UUID(1);
    const logs: string[] = [];
    const wk = worker(w);
    const h = createCelularV2Handler({
      verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
      doc: () => ({}) as any,
      store: w.store,
      readProof: async () => ({ kind: 'sumiu' }),
      arvoreFile: join(w.dir, 'arvore.json'),
      log: (line) => logs.push(line),
      now: w.now,
    });
    const call = (url: string, body: string) => {
      const ts = String(w.now());
      const sig = createHmac('sha256', KEY).update(signedMessage('POST', url, ts, body), 'utf8').digest('hex');
      return h({ method: 'POST', url, body, authorization: `Donel-HMAC ${ts}.${sig}` });
    };
    const cancelar = (alvo: string, partes: number) => JSON.stringify({ id: alvo, partes, duracao_ms: partes * 60_000, interrompido: true, cancelado: true });
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 0));
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 1));
    expect(parse(await call('/api/v2/chat/audio/fim', cancelar(id, 3)))).toEqual({ ok: true, nova: true, estado: 'cancelado' });
    expect(existsSync(join(w.dir, 'chat-audio', id))).toBe(false);
    expect(existsSync(join(w.dir, 'chat-audio', `${id}.webm`))).toBe(false);
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens).toEqual([]);
    expect(logs).toEqual([`áudio ${id} cancelado pelo dono, 2 partes apagadas`]);
    expect(parse(await call('/api/v2/chat/audio/fim', cancelar(id, 3)))).toEqual({ ok: true, nova: false, estado: 'cancelado' });
    // Parte atrasada da fila do aparelho, ou um fim, não ressuscitam o áudio.
    const atrasada = await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 2));
    expect(atrasada.status).toBe(409);
    expect(parse(atrasada).erro).toBe('conflito');
    expect((await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 3, true))).status).toBe(409);
    w.advance(31 * 60_000);
    wk.fecharParados();
    await wk.idle();
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens).toEqual([]);
    // Id sem parte nenhuma: o mesmo 200.
    expect(parse(await call('/api/v2/chat/audio/fim', cancelar(UUID(2), 0)))).toEqual({ ok: true, nova: true, estado: 'cancelado' });
    expect((await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(2), 0))).status).toBe(409);
    // Depois de um fim normal: 409 ja-enviado e nada apagado.
    const outro = UUID(3);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(outro, 0));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(outro, 1));
    const tarde = await call('/api/v2/chat/audio/fim', cancelar(outro, 1));
    expect(tarde.status).toBe(409);
    expect(parse(tarde).erro).toBe('ja-enviado');
    expect(existsSync(join(w.dir, 'chat-audio', `${outro}.webm`))).toBe(true);
    expect(w.store.audioEstado(outro)).toBe('transcrevendo');
    wk.stop();
  });

  it('adiamento conta por pedaço (até 6 cada) e não refaz o wav dos trechos a cada volta', async () => {
    const w = world();
    const id = UUID(1);
    for (let n = 0; n < 12; n += 1) await w.call('POST', '/api/v2/chat/audio/parte', parte(id, n));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 12));
    const base = fakeMidia([[289, 291], [589, 591]]);
    let wavs = 0;
    const recusas = new Map<string, number>();
    const wk = worker(w, {
      midia: { ...base, paraWav: async (entrada, wav) => ((wavs += 1), base.paraWav(entrada, wav)) },
      // Cada um dos 3 pedaços fica sem vaga 3 vezes: 9 adiamentos no áudio, nenhum pedaço passa de 6.
      transcribePedaco: async (file) => {
        const texto = readFileSync(file, 'utf8');
        const vezes = recusas.get(texto) ?? 0;
        recusas.set(texto, vezes + 1);
        if (vezes < 3) throw new TranscribeError('tempo', 'a VPS ficou sem vaga para transcrever');
        return texto;
      },
      adiarMs: 2,
    });
    wk.enqueue(id);
    for (let i = 0; i < 60 && w.store.audioEstado(id) === 'transcrevendo'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await wk.idle();
    }
    const [row] = await w.store.chat.tomar(10);
    expect(row!.texto).not.toContain('não transcrito');
    expect([...row!.texto.matchAll(/fala(\d+)/g)].map((m) => Number(m[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(wavs).toBe(1);
    wk.stop();
  });
});

describe('v1.8: depois do fechamento automático, o resto vai como áudio novo com continua', () => {
  const worker = (w: ReturnType<typeof world>) =>
    createChatAudioWorker({
      store: w.store,
      transcribe: async () => '',
      transcribePedaco: async (file) => readFileSync(file, 'utf8'),
      midia: fakeMidia(),
      kick: () => {},
      log: () => {},
      now: w.now,
    });
  const cancelar = (alvo: string, partes: number) => JSON.stringify({ id: alvo, partes, duracao_ms: partes * 60_000, interrompido: true, cancelado: true });
  /** Parts 0 and 1 of `id` reach the VPS, then 31 min without one: the VPS closes it and the worker transcribes it. */
  async function fechadoPeloAutomatico(w: ReturnType<typeof world>, wk: ReturnType<typeof worker>, id: string, partes = [0, 1]) {
    for (const n of partes) await w.call('POST', '/api/v2/chat/audio/parte', parte(id, n));
    w.advance(31 * 60_000);
    wk.fecharParados();
    await wk.idle();
  }

  it('parte nova dá 409 fechado-auto com as recebidas; cancelar dá 409 ja-enviado; nada do anterior muda', async () => {
    const w = world();
    const id = UUID(1);
    const wk = worker(w);
    await fechadoPeloAutomatico(w, wk, id);
    const antes = readFileSync(join(w.dir, 'chat-audio', `${id}.webm`));
    const nova = await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 2));
    expect(nova.status).toBe(409);
    expect(parse(nova)).toEqual({ erro: 'fechado-auto', recebidas: [0, 1] });
    // A mesma parte de antes continua sendo a mesma.
    expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 1))).nova).toBe(false);
    const cancel = await w.call('POST', '/api/v2/chat/audio/fim', cancelar(id, 3));
    expect(cancel.status).toBe(409);
    expect(parse(cancel).erro).toBe('ja-enviado');
    expect(readFileSync(join(w.dir, 'chat-audio', `${id}.webm`))).toEqual(antes);
    expect(existsSync(join(w.dir, 'chat-audio', id))).toBe(false);
    const linhas = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ id, audio: { estado: 'transcrito', partes: 2, interrompido: true } });
    expect((await w.store.chat.tomar(10)).map((row) => row.texto)).toEqual(['🎙 Áudio de 2:00 (transcrição): (gravação interrompida) fala0 fala1']);
    wk.stop();
  });

  it('o app reenvia o resto como áudio novo: duas entregas, a 2ª marcada como continuação, com o cabeçalho do anterior, nenhum trecho perdido', async () => {
    const w = world();
    const id = UUID(1);
    const id2 = UUID(2);
    const wk = worker(w);
    await fechadoPeloAutomatico(w, wk, id);
    // O aparelho tinha as partes 2, 3 e 4; a 2 volta com 409 fechado-auto e as três vão como áudio novo, de 0.
    const recusada = parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id, 2)));
    expect(recusada.erro).toBe('fechado-auto');
    const faltantes = [2, 3, 4].filter((n) => !recusada.recebidas.includes(n));
    for (const [novo, original] of faltantes.entries()) {
      expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id2, novo, parteBytes(original))))).toMatchObject({ ok: true, nova: true });
    }
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 3, false, 180_000, id)))).toEqual({ ok: true, nova: true, estado: 'transcrevendo' });
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 3, false, 180_000, id))).nova).toBe(false);
    for (const queued of w.queued) wk.enqueue(queued);
    await wk.idle();
    const textos = (await w.store.chat.tomar(10)).map((row) => row.texto);
    expect(textos).toHaveLength(2);
    expect(textos[0]).toBe('🎙 Áudio de 2:00 (transcrição): (gravação interrompida) fala0 fala1');
    // 10:00 UTC é 07:00 em São Paulo: a hora em que o anterior começou.
    expect(textos[1]).toBe('(continuação do áudio #00000001 de 07:00) 🎙 Áudio de 3:00 (transcrição): fala2 fala3 fala4');
    expect([...textos.join(' ').matchAll(/fala(\d+)/g)].map((m) => Number(m[1]))).toEqual([0, 1, 2, 3, 4]);
    wk.stop();
  });

  it('continua inválido dá 409 (desconhecido, fechado pelo aparelho, ainda subindo); sem parte 0 no anterior, falhou sem-parte-0', async () => {
    const w = world();
    const wk = worker(w);
    const invalido = async (alvo: string, continua: string) => {
      await w.call('POST', '/api/v2/chat/audio/parte', parte(alvo, 0, parteBytes(5)));
      const response = await w.call('POST', '/api/v2/chat/audio/fim', fim(alvo, 1, false, 60_000, continua));
      expect(response.status).toBe(409);
      expect(parse(response).erro).toBe('continua-invalido');
      expect(w.store.audioEstado(alvo)).toBe('subindo');
    };
    await invalido(UUID(10), UUID(99));
    const peloAparelho = UUID(3);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(peloAparelho, 0));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(peloAparelho, 1, true));
    await invalido(UUID(11), peloAparelho);
    const subindo = UUID(4);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(subindo, 0));
    await invalido(UUID(12), subindo);
    // Anterior fechado pelo automático, mas sem a parte 0: o novo sem cabeçalho não tem de onde tirá-lo.
    const semZero = UUID(5);
    await fechadoPeloAutomatico(w, wk, semZero, [1]);
    const novo = UUID(13);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(novo, 0, parteBytes(2)));
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(novo, 1, false, 60_000, semZero)))).toEqual({ ok: true, nova: true, estado: 'falhou' });
    const avisos = (await w.store.chat.tomar(10)).filter((row) => row.id === novo).map((row) => row.texto);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.startsWith('(continuação do áudio #00000005 de ')).toBe(true);
    expect(avisos[0]).toContain('o começo da gravação não chegou à VPS');
    wk.stop();
  });

  // Revisão do #527: as sondas do revisor.
  it('fim do id original depois do automático: sem parte que a VPS não tem, 200 fechado auto; com, 409 fechado-auto; cancelado, ja-enviado', async () => {
    const w = world();
    const id = UUID(1);
    const wk = worker(w);
    await fechadoPeloAutomatico(w, wk, id);
    const mais = await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 5));
    expect(mais.status).toBe(409);
    expect(parse(mais)).toEqual({ erro: 'fechado-auto', recebidas: [0, 1] });
    const mesmo = await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 2));
    expect(mesmo.status).toBe(200);
    expect(parse(mesmo)).toEqual({ ok: true, nova: false, estado: 'transcrito', fechado: 'auto' });
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id, 1, true)))).toEqual({ ok: true, nova: false, estado: 'transcrito', fechado: 'auto' });
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', cancelar(id, 2))).erro).toBe('ja-enviado');
    // Fim depois do fim do aparelho segue como antes: 200 sem a marca.
    const peloAparelho = UUID(2);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(peloAparelho, 0));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(peloAparelho, 1));
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(peloAparelho, 1)))).toEqual({ ok: true, nova: false, estado: 'transcrevendo' });
    expect((await w.store.chat.tomar(10)).filter((row) => row.id === id)).toHaveLength(1);
    wk.stop();
  });

  it('continua na parte: o id2 fechado pelo automático antes do fim usa o cabeçalho do anterior e sai como continuação; divergente dá 409', async () => {
    const w = world();
    const id = UUID(1);
    const id2 = UUID(2);
    const wk = worker(w);
    // Outro anterior fechado pelo automático: o id2 não troca de anterior no meio.
    const outro = UUID(5);
    await fechadoPeloAutomatico(w, wk, id);
    await fechadoPeloAutomatico(w, wk, outro);
    for (const [novo, original] of [2, 3].entries()) {
      expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id2, novo, parteBytes(original), 'audio/webm', id)))).toMatchObject({ ok: true, nova: true });
    }
    const divergente = await w.call('POST', '/api/v2/chat/audio/parte', parte(id2, 2, parteBytes(4), 'audio/webm', outro));
    expect(divergente.status).toBe(409);
    expect(parse(divergente).erro).toBe('continua-invalido');
    const fimDivergente = await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 2, false, 120_000, outro));
    expect(fimDivergente.status).toBe(409);
    expect(parse(fimDivergente).erro).toBe('continua-invalido');
    // O aparelho some de novo: 31 min sem parte e a VPS fecha o id2 sozinha.
    w.advance(31 * 60_000);
    wk.fecharParados();
    await wk.idle();
    const textos = (await w.store.chat.tomar(10)).filter((row) => row.id === id2).map((row) => row.texto);
    expect(textos).toEqual(['(continuação do áudio #00000001 de 07:00) 🎙 Áudio de 2:00 (transcrição): (gravação interrompida) fala2 fala3']);
    // O fim do id2 que chega depois segue a regra do fechamento automático.
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 2, false, 120_000, id)))).toEqual({ ok: true, nova: false, estado: 'transcrito', fechado: 'auto' });
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 3, false, 180_000, id)))).toEqual({ erro: 'fechado-auto', recebidas: [0, 1] });
    wk.stop();
  });

  it('uma continuação por anterior: outro id com o mesmo continua dá 409 ja-continuado; o mesmo id2 segue idempotente', async () => {
    const w = world();
    const id = UUID(1);
    const id2 = UUID(2);
    const id3 = UUID(3);
    const wk = worker(w);
    await fechadoPeloAutomatico(w, wk, id);
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id2, 0, parteBytes(2)));
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 1, false, 60_000, id)))).toEqual({ ok: true, nova: true, estado: 'transcrevendo' });
    expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 1, false, 60_000, id)))).toEqual({ ok: true, nova: false, estado: 'transcrevendo' });
    // O app perdeu o 200 e tentou com outro id: na parte e no fim.
    const naParte = await w.call('POST', '/api/v2/chat/audio/parte', parte(id3, 0, parteBytes(2), 'audio/webm', id));
    expect(naParte.status).toBe(409);
    expect(parse(naParte)).toEqual({ erro: 'ja-continuado', id: id2 });
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id3, 0, parteBytes(2)));
    const noFim = await w.call('POST', '/api/v2/chat/audio/fim', fim(id3, 1, false, 60_000, id));
    expect(noFim.status).toBe(409);
    expect(parse(noFim)).toEqual({ erro: 'ja-continuado', id: id2 });
    for (const queued of w.queued) wk.enqueue(queued);
    await wk.idle();
    const textos = (await w.store.chat.tomar(10)).map((row) => row.texto);
    expect(textos.filter((texto) => texto.includes('fala2'))).toHaveLength(1);
    wk.stop();
  });

  it('continua exige o mesmo formato do anterior', async () => {
    const w = world();
    const id = UUID(1);
    const wk = worker(w);
    await fechadoPeloAutomatico(w, wk, id);
    const naParte = await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(2), 0, Buffer.from('OggS;P2;'), 'audio/ogg', id));
    expect(naParte.status).toBe(409);
    expect(parse(naParte).erro).toBe('continua-invalido');
    await w.call('POST', '/api/v2/chat/audio/parte', parte(UUID(3), 0, Buffer.from('OggS;P2;'), 'audio/ogg'));
    const noFim = await w.call('POST', '/api/v2/chat/audio/fim', fim(UUID(3), 1, false, 60_000, id));
    expect(noFim.status).toBe(409);
    expect(parse(noFim).erro).toBe('continua-invalido');
    expect(w.store.audioEstado(UUID(3))).toBe('subindo');
    wk.stop();
  });

  it('anterior que falhou sem a parte 0: o id2 que não cobre as partes dele avisa no texto; o que cobre, não', async () => {
    for (const [reenvio, avisa] of [
      [[0, 2], true],
      [[0, 1, 2], false],
    ] as const) {
      const w = world();
      const id = UUID(1);
      const id2 = UUID(2);
      const wk = worker(w);
      await fechadoPeloAutomatico(w, wk, id, [1]);
      expect(w.store.audioEstado(id)).toBe('falhou');
      await w.store.chat.tomar(10);
      for (const [novo, original] of reenvio.entries()) await w.call('POST', '/api/v2/chat/audio/parte', parte(id2, novo, parteBytes(original), 'audio/webm', id));
      expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, reenvio.length, false, reenvio.length * 60_000, id))).ok).toBe(true);
      for (const queued of w.queued) wk.enqueue(queued);
      await wk.idle();
      const [texto] = (await w.store.chat.tomar(10)).map((row) => row.texto);
      expect(texto).toContain(reenvio.map((n) => `fala${n}`).join(' '));
      if (avisa) expect(texto).toContain('ficaram sem transcrição');
      else expect(texto).not.toContain('sem transcrição');
      wk.stop();
    }
  });

  // Rodada 3 da revisão do #527: as sondas S4/S8 (cadeia) e S8 (ordem).
  it('cadeia id1 -> id2 -> id3: o id3 usa o cabeçalho que o id2 pegou emprestado e sai como continuação, com ou sem a parte 0 do id2', async () => {
    for (const partesId2 of [[0, 1], [1]]) {
      const w = world();
      const id = UUID(1);
      const id2 = UUID(2);
      const id3 = UUID(3);
      const wk = worker(w);
      await fechadoPeloAutomatico(w, wk, id, partesId2.length === 2 ? [0, 1] : [0]);
      // O id2 sobe sem cabeçalho, com continua=id1, e o automático o fecha antes do fim.
      for (const [i, n] of partesId2.entries()) await w.call('POST', '/api/v2/chat/audio/parte', parte(id2, n, parteBytes(2 + i), 'audio/webm', id));
      w.advance(31 * 60_000);
      wk.fecharParados();
      await wk.idle();
      expect(w.store.audioEstado(id2)).toBe('transcrito');
      // O resto vai como id3, continua=id2, sem cabeçalho na parte 0.
      expect(parse(await w.call('POST', '/api/v2/chat/audio/parte', parte(id3, 0, parteBytes(4), 'audio/webm', id2)))).toMatchObject({ ok: true, nova: true });
      expect(parse(await w.call('POST', '/api/v2/chat/audio/fim', fim(id3, 1, false, 60_000, id2)))).toEqual({ ok: true, nova: true, estado: 'transcrevendo' });
      for (const queued of w.queued) wk.enqueue(queued);
      await wk.idle();
      const textos = (await w.store.chat.tomar(10)).filter((row) => row.id === id3).map((row) => row.texto);
      // 10:31 UTC é 07:31 em São Paulo: a hora em que o id2 começou.
      expect(textos).toEqual(['(continuação do áudio #00000002 de 07:31) 🎙 Áudio de 1:00 (transcrição): fala4']);
      wk.stop();
    }
  });

  it('a continuação nunca chega ao Líder antes do anterior: espera enquanto ele transcreve; nenhum dos dois se perde nem duplica', async () => {
    const w = world();
    const id = UUID(1);
    const id2 = UUID(2);
    let recusar = 1;
    const wk = createChatAudioWorker({
      store: w.store,
      transcribe: async () => '',
      transcribePedaco: async (file) => {
        const texto = readFileSync(file, 'utf8');
        if (texto.startsWith('fala0') && recusar-- > 0) throw new TranscribeError('tempo', 'a VPS ficou sem vaga para transcrever');
        return texto;
      },
      midia: fakeMidia(),
      kick: () => {},
      log: () => {},
      now: w.now,
      adiarMs: 50,
    });
    await fechadoPeloAutomatico(w, wk, id);
    expect(w.store.audioEstado(id)).toBe('transcrevendo');
    await w.call('POST', '/api/v2/chat/audio/parte', parte(id2, 0, parteBytes(2), 'audio/webm', id));
    await w.call('POST', '/api/v2/chat/audio/fim', fim(id2, 1, false, 60_000, id));
    wk.enqueue(id2);
    await wk.idle();
    expect(w.store.audioEstado(id2)).toBe('transcrito');
    // O id1 ainda transcreve: a continuação espera.
    expect(await w.store.chat.tomar(10)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await wk.idle();
    const textos = (await w.store.chat.tomar(10)).map((row) => row.texto);
    expect(textos).toEqual([
      '🎙 Áudio de 2:00 (transcrição): (gravação interrompida) fala0 fala1',
      '(continuação do áudio #00000001 de 07:00) 🎙 Áudio de 1:00 (transcrição): fala2',
    ]);
    expect(await w.store.chat.tomar(10)).toEqual([]);
    wk.stop();
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
