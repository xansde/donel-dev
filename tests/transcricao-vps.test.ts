import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranscriptionJobs, VPS_TRANSCRIBE_TIMEOUT_MS, whisperServerTranscriber } from '../src/main/celular/transcrever';
import { daemonWhisper } from '../src/oraculo/chat-audio';
import { pedacoCurlArgs } from '../src/oraculo/chat-audio-longo';

// t-0eb91241 — um transcritor só, na VPS: o Pedir por voz que o daemon do Oráculo atende (o celular fala com a VPS, o
// PC fica fora) manda o áudio ao transcritor residente da VPS (127.0.0.1:8179), não ao OpenWhispr do PC (:8178), que
// lá não existe. Caminho: o WAV chega inteiro ao /inference; volta: o texto chega ao pedido.

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(() => done(undefined)));
});

/** A stand-in for the VPS transcriber: keeps what it got, answers `answer`. */
async function fakeTranscriber(answer: { status: number; body: unknown }): Promise<{ url: string; got: Buffer[] }> {
  const got: Buffer[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/inference') got.push(Buffer.concat(chunks));
      response.writeHead(answer.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    });
  });
  servers.push(server);
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sem porta');
  return { url: `http://127.0.0.1:${address.port}`, got };
}

function wav(seconds = 1): Uint8Array {
  const data = 16_000 * 2 * seconds;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, data, true);
  for (let i = 44; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
}

async function settled(jobs: ReturnType<typeof createTranscriptionJobs>, id: string) {
  for (let i = 0; i < 200; i += 1) {
    const status = jobs.status(id);
    if (status && status.estado !== 'transcrevendo') return status;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('a transcrição não terminou');
}

describe('o daemon da VPS transcreve o Pedir no transcritor da VPS', () => {
  it('sem configuração, o daemon aponta para o transcritor residente da VPS e espera o adiamento por carga', () => {
    expect(daemonWhisper({})).toEqual({ url: 'http://127.0.0.1:8179', where: 'vps', timeoutMs: VPS_TRANSCRIBE_TIMEOUT_MS });
    expect(daemonWhisper({ DONEL_WHISPER_URL: 'http://127.0.0.1:9000' }).url).toBe('http://127.0.0.1:9000');
    // The transcriber may hold an audio up to 8 min while the machine is loaded; the client waits for it.
    expect(VPS_TRANSCRIBE_TIMEOUT_MS).toBeGreaterThan(8 * 60_000);
  });

  it('caminho e volta: o WAV do Pedir chega inteiro ao transcritor, e o texto volta ao pedido', async () => {
    const vps = await fakeTranscriber({ status: 200, body: { text: '  Abre a tarefa   do celular. ' } });
    const files = new Map<string, Uint8Array>();
    const jobs = createTranscriptionJobs({
      dir: '/pedidos-audio',
      writeFile: (path, bytes) => files.set(path, bytes),
      exists: (path) => files.has(path),
      transcribe: whisperServerTranscriber({ ...daemonWhisper({ DONEL_WHISPER_URL: vps.url }) }),
    });
    const audio = wav();
    const started = jobs.start(audio);
    if (!started.ok) throw new Error(started.mensagem);
    expect(await settled(jobs, started.audioId)).toEqual({ estado: 'pronto', texto: 'Abre a tarefa do celular.' });
    expect(vps.got).toHaveLength(1);
    expect(vps.got[0]!.includes(Buffer.from(audio))).toBe(true);
    expect(vps.got[0]!.toString('latin1')).toContain('name="language"');
    expect(jobs.has(started.audioId)).toBe(true);
  });

  it('transcritor da VPS fora: o pedido falha dizendo que é o da VPS (não o OpenWhispr do PC), e o áudio fica guardado', async () => {
    const vps = await fakeTranscriber({ status: 200, body: {} });
    const down = vps.url;
    await new Promise((done) => servers.pop()!.close(() => done(undefined)));
    const files = new Map<string, Uint8Array>();
    const jobs = createTranscriptionJobs({
      dir: '/pedidos-audio',
      writeFile: (path, bytes) => files.set(path, bytes),
      exists: (path) => files.has(path),
      transcribe: whisperServerTranscriber({ ...daemonWhisper({ DONEL_WHISPER_URL: down }) }),
    });
    const started = jobs.start(wav());
    if (!started.ok) throw new Error(started.mensagem);
    const status = await settled(jobs, started.audioId);
    expect(status.estado).toBe('falhou');
    expect(status.estado === 'falhou' && status.mensagem).toContain('transcritor da VPS');
    expect(status.estado === 'falhou' && status.mensagem).not.toContain('OpenWhispr');
    expect(jobs.has(started.audioId)).toBe(true);
  });

  it('o transcritor recusou (ou ficou sem texto): o pedido falha e não inventa texto', async () => {
    for (const answer of [{ status: 503, body: { error: 'ocupado' } }, { status: 200, body: { nada: 1 } }]) {
      const vps = await fakeTranscriber(answer);
      const jobs = createTranscriptionJobs({ dir: '/a', writeFile: () => undefined, exists: () => true, transcribe: whisperServerTranscriber(daemonWhisper({ DONEL_WHISPER_URL: vps.url })) });
      const started = jobs.start(wav());
      if (!started.ok) throw new Error(started.mensagem);
      expect((await settled(jobs, started.audioId)).estado).toBe('falhou');
    }
  });
});

describe('o daemon liga o Pedir ao transcritor da VPS', () => {
  it('o servidor do celular do daemon recebe o transcritor da VPS (sem isso o Pedir cai no :8178 do PC)', () => {
    // Guard of the wiring (t-0eb91241, revisão do #558): the daemon's phone server is built in registro.ts.
    const source = readFileSync(join(__dirname, '../src/oraculo/registro.ts'), 'utf8');
    const call = source.slice(source.indexOf('celular = createCelularCore({'), source.indexOf('});', source.indexOf('celular = createCelularCore({')));
    expect(call).toContain('whisper: daemonWhisper(process.env)');
  });

  it('a página do Pedir espera mais que o Oráculo espera o transcritor', () => {
    const page = readFileSync(join(__dirname, '../src/main/celular/pwa/pedir.js'), 'utf8');
    const tries = Number(/var TENTATIVAS_TRANSCRICAO = (\d+);/.exec(page)?.[1]);
    expect(tries * 2_000).toBeGreaterThan(VPS_TRANSCRIBE_TIMEOUT_MS);
  });
});

describe('o pedaço longo do chat diz quanto espera (ressalva do bizops#159)', () => {
  it('o curl do pedaço manda a paciência de 900 s ao transcritor, que não o descarta aos 570', () => {
    const args = pedacoCurlArgs('http://127.0.0.1:8179', '/tmp/p.ogg', 'audio/ogg', '/tmp/p.ogg.json');
    expect(args).toContain('--max-time');
    expect(args[args.indexOf('--max-time') + 1]).toBe('900');
    expect(args).toContain('X-Donel-Paciencia-S: 900');
  });
});
