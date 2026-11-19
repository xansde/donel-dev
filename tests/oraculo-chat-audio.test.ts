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

// t-268ed62a — o áudio do chat do celular (contrato v1.2). O que não pode acontecer sem o dono ver: o mesmo áudio
// reenviado (a rede caiu) entrar duas vezes; o Líder receber o áudio antes de transcrito, ou duas vezes (o texto e o
// aviso de falha); um restart do daemon perder o áudio que transcrevia; o arquivo antigo, sem áudio, deixar de abrir.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
const T0 = Date.parse('2026-11-19T10:00:00Z');
const UUID = (n: number): string => `${String(n).padStart(8, '0')}-1111-4222-8333-444455556666`;
const BYTES = Buffer.from('OggS fala do dono, de mentira');

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-audio-'));
  dirs.push(dir);
  const file = join(dir, 'celular-local.json');
  const now = () => T0;
  let store = createCelularLocalStore(file, now);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now });
  const queued: string[] = [];
  const handler = () =>
    createCelularV2Handler({
      verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
      doc: () => ledger.load().doc,
      store,
      readProof: async () => ({ kind: 'sumiu' }),
      arvoreFile: join(dir, 'arvore.json'),
      audio: (id) => queued.push(id),
      now,
    });
  let h = handler();
  return {
    dir,
    file,
    queued,
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
  };
}

const parse = (response: { body: unknown }): any => JSON.parse(String(response.body));
const audioBody = (id: string, bytes: Buffer = BYTES, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, mime: 'audio/ogg', duracao_ms: 27_400, audio_b64: bytes.toString('base64'), ...extra });

describe('áudio do chat do celular (/api/v2/chat/audio)', () => {
  it('o mesmo áudio reenviado entra uma vez; outros bytes, ou o id de um texto, dão 409', async () => {
    const w = world();
    const first = await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(1)));
    expect(first.status).toBe(200);
    expect(parse(first)).toEqual({ ok: true, nova: true, estado: 'transcrevendo' });
    // O arquivo está no disco antes da resposta.
    expect(readFileSync(join(w.dir, 'chat-audio', `${UUID(1)}.ogg`))).toEqual(BYTES);
    expect(parse(await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(1))))).toEqual({ ok: true, nova: false, estado: 'transcrevendo' });
    expect(w.queued).toEqual([UUID(1)]);
    expect((await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(1), Buffer.from('outra fala')))).status).toBe(409);
    await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(2), texto: 'oi' }));
    expect((await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(2)))).status).toBe(409);
    // O id de um áudio mandado como texto também não vira outra linha.
    expect((await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(1), texto: 'oi' }))).status).toBe(409);
    const mensagens = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(mensagens).toHaveLength(2);
    expect(mensagens[0]).toMatchObject({ id: UUID(1), texto: '', estado: null, audio: { estado: 'transcrevendo', duracao_ms: 27_400, motivo: null } });
    expect(mensagens[0].audio.sha256).toBeUndefined();
    // Fora dos limites do contrato.
    expect((await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(3), BYTES, { mime: 'audio/flac' }))).status).toBe(415);
    expect((await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(3), BYTES, { duracao_ms: 300_001 }))).status).toBe(413);
    expect((await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(3), BYTES, { audio_b64: 'não é base64' }))).status).toBe(400);
  });

  it('a linha transcrevendo não vai ao Líder; transcrita vai uma vez; falhada vai uma vez, com o aviso e o caminho', async () => {
    const w = world();
    await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(1)));
    await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(2), Buffer.from('ruído')));
    expect(await w.store.chat.tomar(10)).toHaveLength(0);

    const texts = new Map([[UUID(1), 'confere o ledger']]);
    const kicks: string[] = [];
    const worker = createChatAudioWorker({
      store: w.store,
      transcribe: async (bytes) => texts.get(Buffer.from(bytes).equals(BYTES) ? UUID(1) : UUID(2)) ?? '',
      kick: (fila) => kicks.push(fila),
      log: () => {},
    });
    worker.start();
    await worker.idle();
    expect(kicks).toEqual(['chat', 'chat']);

    const taken = await w.store.chat.tomar(10);
    expect(taken.map((row) => row.id)).toEqual([UUID(1), UUID(2)]);
    expect(taken[0]!.texto).toBe('🎙 Áudio de 0:27 (transcrição): confere o ledger');
    expect(taken[1]!.texto).toBe(`🎙 Áudio de 0:27 que não consegui transcrever (não ouvi fala no áudio). Está guardado na VPS em ${join(w.dir, 'chat-audio', `${UUID(2)}.ogg`)}.`);
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
    // Reenfileirar de novo (o app reenviou) não transcreve outra vez nem troca o resultado.
    worker.enqueue(UUID(1));
    worker.enqueue(UUID(2));
    await worker.idle();
    expect(kicks).toHaveLength(2);

    const mensagens = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(mensagens[0]).toMatchObject({ texto: 'confere o ledger', estado: 'na-fila', audio: { estado: 'transcrito', motivo: null } });
    expect(mensagens[1]).toMatchObject({ texto: '', audio: { estado: 'falhou', motivo: 'não ouvi fala no áudio' } });
    expect(parse(await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(1)))).nova).toBe(false);
    worker.stop();
  });

  it('o transcritor fora do ar: tenta de novo; sem volta, falha uma vez só', async () => {
    const w = world();
    await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(1)));
    let calls = 0;
    const worker = createChatAudioWorker({
      store: w.store,
      transcribe: async () => {
        calls += 1;
        throw new TranscribeError('conexao', 'sem conexão');
      },
      kick: () => {},
      log: () => {},
      retryDelayMs: 0,
    });
    worker.start();
    await worker.idle();
    expect(calls).toBe(3);
    const taken = await w.store.chat.tomar(10);
    expect(taken).toHaveLength(1);
    expect(taken[0]!.texto).toContain('que não consegui transcrever');
    worker.stop();
  });

  it('um restart com a linha transcrevendo transcreve de novo e não perde', async () => {
    const w = world();
    await w.call('POST', '/api/v2/chat/audio', audioBody(UUID(1)));
    // O daemon cai no meio da transcrição: a promessa nunca volta.
    const stuck = createChatAudioWorker({ store: w.store, transcribe: () => new Promise<string>(() => {}), kick: () => {}, log: () => {} });
    stuck.start();
    stuck.stop();
    w.reopen();
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
    const worker = createChatAudioWorker({ store: w.store, transcribe: async () => 'de volta', kick: () => {}, log: () => {} });
    worker.start();
    await worker.idle();
    const taken = await w.store.chat.tomar(10);
    expect(taken.map((row) => row.texto)).toEqual(['🎙 Áudio de 0:27 (transcrição): de volta']);
    worker.stop();
  });

  it('o arquivo de antes do áudio (sem o campo) abre e segue como texto', async () => {
    const w = world();
    writeFileSync(
      w.file,
      JSON.stringify({ versao: 1, decisoes: [], pedidas: [], chat: [{ id: UUID(9), autor: 'dono', texto: 'de ontem', em_resposta_a: null, criada_em: '2026-11-18T20:00:00.000Z' }] }),
    );
    w.reopen();
    const [linha] = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(linha).toMatchObject({ id: UUID(9), texto: 'de ontem', estado: 'na-fila' });
    expect(linha.audio).toBeUndefined();
    expect((await w.store.chat.tomar(10)).map((row) => row.texto)).toEqual(['de ontem']);
    expect(existsSync(join(w.dir, 'chat-audio'))).toBe(false);
  });
});
