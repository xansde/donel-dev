import { describe, expect, it } from 'vitest';
import type { ConfigIoDeps } from '../src/main/config-store';
import { createCelularAuth } from '../src/main/celular/auth';
import { cleanPedidoText, createMobilePedidosPort, createPedidoRouter, createPedidosStore, pedidoCelular, type MobilePedidosPort } from '../src/main/celular/pedidos';
import { createMobileHandler, type MobileResponse } from '../src/main/celular/server';
import { createTranscriptionJobs, isWav } from '../src/main/celular/transcrever';
import { parseLedgerToolCall } from '../src/shared/ledger/tools';

// Pedir pelo Oráculo — o que sumiria ou duplicaria sem o dono ver: o pedido do celular se perder com o Líder
// fechado ou o app reiniciado, entrar duas vezes, ou o texto dele virar comando no CLI do Líder.

const FILE = 'C:/data/pedidos-do-dono.json';

function memoryIo(): ConfigIoDeps {
  const files: Record<string, string> = {};
  return {
    existsSync: (path) => path in files || path === 'C:/data',
    readFileText: (path) => files[path] ?? null,
    writeFileText: (path, content) => {
      files[path] = content;
    },
    renameFile: (from, to) => {
      files[to] = files[from]!;
      delete files[from];
    },
    mkdirSync: () => undefined,
    unlinkFile: (path) => {
      delete files[path];
    },
  };
}

/** O Líder único: fechado (`open = false`) recusa; aberto guarda o que recebeu. */
function leader() {
  const state = { open: false, received: [] as string[] };
  const deliver = async (text: string): Promise<boolean> => {
    if (!state.open) return false;
    state.received.push(text);
    return true;
  };
  return { state, deliver };
}

/** Um WAV mínimo (cabeçalho PCM 16 kHz mono + algumas amostras). */
function wav(samples = 16): Uint8Array {
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples * 2, 40);
  return new Uint8Array(buffer);
}

describe('pedido do dono ao Líder único', () => {
  it('Líder fechado: o pedido espera na fila, na ordem, e é entregue quando ele abre', async () => {
    const io = memoryIo();
    const store = createPedidosStore({ filePath: FILE, io });
    const { state, deliver } = leader();
    const router = createPedidoRouter({ store, deliver, retryMs: 60_000 });

    const first = router.submit({ requestId: 'req-000000001', texto: 'abre uma sessão para o PR do oráculo' });
    router.submit({ requestId: 'req-000000002', texto: 'e depois me mostra o quadro' });
    await router.flush();
    expect(state.received).toEqual([]);
    expect(store.pending().map((p) => p.texto)).toEqual(['abre uma sessão para o PR do oráculo', 'e depois me mostra o quadro']);
    expect(pedidoCelular(store.list(10)[1]!).estado).toBe('na-fila');

    state.open = true;
    await router.flush();
    expect(state.received).toHaveLength(2);
    expect(state.received[0]).toMatch(/^◆ Pedido do dono pelo Oráculo .*abre uma sessão para o PR do oráculo/);
    expect(state.received[0]).toContain(`pedidoDoDono: "${first.id}"`);
    expect(state.received[1]).toContain('e depois me mostra o quadro');
    expect(store.pending()).toEqual([]);
    expect(pedidoCelular(store.list(10)[0]!).estado).toBe('entregue');

    // Uma volta a mais não manda de novo.
    await router.flush();
    expect(state.received).toHaveLength(2);
    router.dispose();
  });

  it('app reiniciado: o pedido gravado antes continua na fila e é entregue pela fila nova', async () => {
    const io = memoryIo();
    const before = createPedidoRouter({ store: createPedidosStore({ filePath: FILE, io }), deliver: leader().deliver, retryMs: 60_000 });
    before.submit({ requestId: 'req-000000003', texto: 'pedido antes de reiniciar', audio: `${'a'.repeat(24)}.wav` });
    await before.flush();
    before.dispose();

    // O app subiu de novo: outra fila sobre o mesmo arquivo.
    const store = createPedidosStore({ filePath: FILE, io });
    expect(store.pending().map((p) => p.texto)).toEqual(['pedido antes de reiniciar']);
    const { state, deliver } = leader();
    state.open = true;
    const after = createPedidoRouter({ store, deliver, audioPath: (file) => `C:/data/pedidos-audio/${file}`, retryMs: 60_000 });
    await after.flush();
    expect(state.received).toHaveLength(1);
    expect(state.received[0]).toContain(`C:/data/pedidos-audio/${'a'.repeat(24)}.wav`);
    expect(createPedidosStore({ filePath: FILE, io }).pending()).toEqual([]);
    after.dispose();
  });

  it('o mesmo envio do celular entra uma vez; o texto vai como dado, nunca como comando do CLI', async () => {
    const io = memoryIo();
    const store = createPedidosStore({ filePath: FILE, io });
    const { state, deliver } = leader();
    state.open = true;
    const router = createPedidoRouter({ store, deliver, retryMs: 60_000 });

    const sent = router.submit({ requestId: 'req-000000004', texto: cleanPedidoText('/clear\u0007 e ! rm -rf') });
    const again = router.submit({ requestId: 'req-000000004', texto: '/clear e ! rm -rf' });
    expect(again.id).toBe(sent.id);
    await router.flush();
    expect(state.received).toHaveLength(1);
    expect(state.received[0]!.startsWith('◆ ')).toBe(true);
    expect(state.received[0]).not.toContain('\u0007');

    // Virou tarefa: o celular mostra o nome humano dela.
    expect(store.linkTask(sent.id, { id: 't-1', titulo: 'Limpar o quadro' })).toBe(true);
    expect(pedidoCelular(store.list(1)[0]!, () => 'em-execucao')).toMatchObject({ estado: 'tarefa', tarefa: { titulo: 'Limpar o quadro', estado: 'em-execucao' } });
    expect(parseLedgerToolCall('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-07', risco: 'baixo', pedidoDoDono: sent.id })).toMatchObject({ ok: true, call: { pedidoDoDono: sent.id } });
    expect(parseLedgerToolCall('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-07', risco: 'baixo', pedidoDoDono: '../t' }).ok).toBe(false);
    router.dispose();
  });

  it('servidor: pedir exige o celular pareado e limita o tamanho do texto', () => {
    const io = memoryIo();
    const auth = createCelularAuth({ filePath: 'C:/data/celular.json', io });
    const created: string[] = [];
    const pedidos: MobilePedidosPort = {
      listar: () => [],
      criar: (input) => {
        created.push(input.texto);
        return { ok: true, pedido: { id: 'pd-000000000000', texto: input.texto, criadoEm: '', estado: 'na-fila', falado: false } };
      },
      transcrever: () => ({ ok: true, audioId: 'b'.repeat(24) }),
      transcricao: () => ({ estado: 'transcrevendo' }),
    };
    const handle = createMobileHandler({ auth, ledger: () => { throw new Error('sem ledger'); }, assets: {}, provasRoot: null, pedidos });
    const call = (method: string, url: string, token: string | null, body: unknown): MobileResponse =>
      handle({ method, url, authorization: token ? `Bearer ${token}` : undefined, body: JSON.stringify(body) }) as MobileResponse;

    expect(call('POST', '/api/pedidos', null, { pedidoId: 'req-000000005', texto: 'oi' }).status).toBe(401);
    expect(handle({ method: 'POST', url: '/api/pedidos/audio', body: '', bytes: wav() }) as MobileResponse).toMatchObject({ status: 401 });
    const { code } = auth.createPairingCode();
    const token = JSON.parse(call('POST', '/api/parear', null, { codigo: code, aparelho: 'Android' }).body as string).token as string;
    expect(call('POST', '/api/pedidos', token, { pedidoId: 'req-000000005', texto: 'x'.repeat(4001) }).status).toBe(400);
    expect(call('POST', '/api/pedidos', token, { pedidoId: 'req-000000005', texto: 'oi', audioId: '../../etc' }).status).toBe(400);
    expect(call('POST', '/api/pedidos', token, { pedidoId: 'req-000000005', texto: 'oi' }).status).toBe(200);
    expect(created).toEqual(['oi']);
  });

  it('pedido falado: o áudio sobe, é transcrito no PC e o pedido chega ao Líder com o texto e o áudio', async () => {
    const io = memoryIo();
    const written: Record<string, Uint8Array> = {};
    let release: (text: string) => void = () => undefined;
    const audio = createTranscriptionJobs({
      dir: 'C:/data/pedidos-audio',
      writeFile: (path, bytes) => {
        written[path] = bytes;
      },
      exists: (path) => path in written,
      transcribe: () => new Promise<string>((resolve) => (release = resolve)),
    });
    const store = createPedidosStore({ filePath: FILE, io });
    const { state, deliver } = leader();
    state.open = true;
    const router = createPedidoRouter({ store, deliver, audioPath: audio.fileOf, retryMs: 60_000 });
    const auth = createCelularAuth({ filePath: 'C:/data/celular.json', io });
    const handle = createMobileHandler({
      auth,
      ledger: () => { throw new Error('sem ledger'); },
      assets: {},
      provasRoot: null,
      pedidos: createMobilePedidosPort({ store, router, audio }),
    });
    const { code } = auth.createPairingCode();
    const pairing = handle({ method: 'POST', url: '/api/parear', body: JSON.stringify({ codigo: code, aparelho: 'Android' }) }) as MobileResponse;
    const authorization = `Bearer ${JSON.parse(pairing.body as string).token as string}`;
    const body = (response: MobileResponse): Record<string, unknown> => JSON.parse(response.body as string) as Record<string, unknown>;

    // Só WAV entra: outra coisa nem é gravada no PC.
    const html = new TextEncoder().encode('<html>não é áudio</html>'.padEnd(64, ' '));
    expect(isWav(html)).toBe(false);
    expect((handle({ method: 'POST', url: '/api/pedidos/audio', authorization, body: '', bytes: html }) as MobileResponse).status).not.toBe(200);
    expect(Object.keys(written)).toEqual([]);

    // O celular manda o WAV, recebe o id e pergunta até ficar pronto.
    const sent = handle({ method: 'POST', url: '/api/pedidos/audio', authorization, body: '', bytes: wav() }) as MobileResponse;
    expect(sent.status).toBe(200);
    const audioId = body(sent).audioId as string;
    const poll = (): Record<string, unknown> => body(handle({ method: 'GET', url: `/api/pedidos/audio?id=${audioId}`, authorization, body: '' }) as MobileResponse);
    expect(poll()).toMatchObject({ estado: 'transcrevendo' });
    await Promise.resolve();
    release('Líder, abre uma sessão para revisar o PR.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(poll()).toMatchObject({ estado: 'pronto', texto: 'Líder, abre uma sessão para revisar o PR.' });

    // Um audioId que o PC não guardou é recusado; o certo entra e chega ao Líder com o texto e o caminho do áudio.
    const pedir = (audio: string): MobileResponse =>
      handle({ method: 'POST', url: '/api/pedidos', authorization, body: JSON.stringify({ pedidoId: 'req-000000006', texto: 'Líder, abre uma sessão para revisar o PR.', audioId: audio }) }) as MobileResponse;
    expect(pedir('c'.repeat(24)).status).toBe(409);
    const created = pedir(audioId);
    expect(created.status).toBe(200);
    expect(body(created).pedido).toMatchObject({ falado: true });
    await router.flush();
    expect(state.received).toHaveLength(1);
    expect(state.received[0]).toContain('Líder, abre uma sessão para revisar o PR.');
    expect(state.received[0]).toContain(audio.fileOf(audioId));
    expect(written[audio.fileOf(audioId)]).toEqual(wav());
    router.dispose();
  });
});
