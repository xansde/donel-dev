import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { chatText } from '../src/oraculo/chat-celular';
import { sweepChatArquivos } from '../src/oraculo/chat-arquivo';

// t-a1ad1ca2 — o arquivo pelo chat do celular (contrato v1.4). O que não pode acontecer sem o dono ver: o mesmo arquivo
// reenviado (a rede caiu) entrar duas vezes ou ser trocado; um nome vindo do aparelho gravar fora da pasta; o Líder
// receber o arquivo duas vezes, ou sem saber onde ele está; o arquivo sumir antes dos 30 dias, ou nunca sumir.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
const T0 = Date.parse('2026-11-19T10:00:00Z');
const DAY = 86_400_000;
const UUID = (n: number): string => `${String(n).padStart(8, '0')}-1111-4222-8333-444455556666`;
const BYTES = Buffer.from('%PDF-1.7 contrato do imóvel, de mentira');

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-arquivo-'));
  dirs.push(dir);
  const file = join(dir, 'celular-local.json');
  const now = () => T0;
  const store = createCelularLocalStore(file, now);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now });
  const kicks: string[] = [];
  const h = createCelularV2Handler({
    verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
    doc: () => ledger.load().doc,
    store,
    readProof: async () => ({ kind: 'sumiu' }),
    arvoreFile: join(dir, 'arvore.json'),
    kick: (fila) => kicks.push(fila),
    now,
  });
  return {
    dir,
    store,
    kicks,
    pasta: join(dir, 'chat-arquivos'),
    call(method: string, url: string, body = '') {
      const ts = String(now());
      const sig = createHmac('sha256', KEY).update(signedMessage(method, url, ts, body), 'utf8').digest('hex');
      return h({ method, url, body, authorization: `Donel-HMAC ${ts}.${sig}` });
    },
  };
}

const parse = (response: { body: unknown }): any => JSON.parse(String(response.body));
const arquivoBody = (id: string, bytes: Buffer = BYTES, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, nome: 'contrato.pdf', mime: 'application/pdf', tamanho: bytes.length, arquivo_b64: bytes.toString('base64'), ...extra });

describe('arquivo do chat do celular (/api/v2/chat/arquivo)', () => {
  it('o mesmo arquivo reenviado entra uma vez; outros bytes, ou o id de outra mensagem, dão 409', async () => {
    const w = world();
    const first = await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1)));
    expect(first.status).toBe(200);
    expect(parse(first)).toEqual({ ok: true, nova: true, estado: 'na-fila' });
    // O arquivo está no disco, 600, antes da resposta.
    const guardado = join(w.pasta, `${UUID(1)}-contrato.pdf`);
    expect(readFileSync(guardado)).toEqual(BYTES);
    expect(statSync(guardado).mode & 0o777).toBe(0o600);
    expect(parse(await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1))))).toEqual({ ok: true, nova: false, estado: 'na-fila' });
    expect(w.kicks).toEqual(['chat']);
    expect((await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), Buffer.from('outro conteúdo')))).status).toBe(409);
    expect(readFileSync(guardado)).toEqual(BYTES);
    // O id de um texto vira 409 no arquivo, e o id do arquivo vira 409 no texto e no áudio.
    await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(2), texto: 'oi' }));
    expect((await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(2)))).status).toBe(409);
    expect((await w.call('POST', '/api/v2/chat', JSON.stringify({ id: UUID(1), texto: 'oi' }))).status).toBe(409);
    const audio = JSON.stringify({ id: UUID(1), mime: 'audio/ogg', duracao_ms: 1000, audio_b64: BYTES.toString('base64') });
    expect((await w.call('POST', '/api/v2/chat/audio', audio)).status).toBe(409);
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens).toHaveLength(2);
  });

  it('o tamanho que não bate com os bytes dá 400; acima de 15 MB dá 413; nada fica no disco', async () => {
    const w = world();
    const diverge = await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), BYTES, { tamanho: BYTES.length + 1 }));
    expect(diverge.status).toBe(400);
    expect(parse(diverge).erro).toBe('corpo');
    const grande = await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), BYTES, { tamanho: 15 * 1024 * 1024 + 1 }));
    expect(grande.status).toBe(413);
    expect(parse(grande).erro).toBe('grande-demais');
    expect((await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), BYTES, { arquivo_b64: 'não é base64' }))).status).toBe(400);
    expect((await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), BYTES, { legenda: 'x'.repeat(4001) }))).status).toBe(400);
    expect((await w.call('POST', '/api/v2/chat/arquivo', 'x'.repeat(21 * 1024 * 1024))).status).toBe(413);
    expect(existsSync(w.pasta) ? readdirSync(w.pasta) : []).toEqual([]);
    expect(parse(await w.call('GET', '/api/v2/chat')).mensagens).toEqual([]);
  });

  it('o arquivo de 15 MB, no teto do contrato, entra inteiro', async () => {
    const w = world();
    const grande = Buffer.alloc(15 * 1024 * 1024, 7);
    const resposta = await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), grande, { nome: 'video.mp4', mime: 'video/mp4' }));
    expect(resposta.status).toBe(200);
    expect(readFileSync(join(w.pasta, `${UUID(1)}-video.mp4`)).equals(grande)).toBe(true);
  });

  it('o nome perigoso é limpo e o arquivo nunca sai da pasta; a linha guarda o nome original', async () => {
    const w = world();
    const nomes = ['../../x', 'a/b\\c.txt', `${'relatório '.repeat(12)}final.pdf`, '..', '/etc/passwd'];
    for (const [i, nome] of nomes.entries()) {
      const resposta = await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(i + 1), BYTES, { nome }));
      expect(resposta.status).toBe(200);
    }
    const guardados = readdirSync(w.pasta).sort();
    expect(guardados).toHaveLength(nomes.length);
    for (const [i, nome] of guardados.entries()) {
      expect(nome.startsWith(`${UUID(i + 1)}-`)).toBe(true);
      const limpo = nome.slice(UUID(i + 1).length + 1);
      expect(limpo).toMatch(/^[A-Za-z0-9._-]{1,80}$/);
      expect(limpo).not.toContain('..');
    }
    expect(guardados[0]).toBe(`${UUID(1)}-x`);
    expect(guardados[2]!.endsWith('.pdf')).toBe(true);
    // Nada foi escrito fora da pasta.
    expect(readdirSync(w.dir).sort()).toEqual(['celular-local.json', 'chat-arquivos']);
    const mensagens = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(mensagens.map((linha: any) => linha.arquivo.nome)).toEqual(nomes);
  });

  it('o Líder recebe uma entrega com o caminho na VPS e a legenda; a linha do GET traz o arquivo', async () => {
    const w = world();
    await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), BYTES, { legenda: 'olha a cláusula 4' }));
    await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(2), Buffer.alloc(2_400_000, 1), { nome: 'foto.jpg', mime: 'image/jpeg' }));

    const [linha1, linha2] = parse(await w.call('GET', '/api/v2/chat')).mensagens;
    expect(linha1).toMatchObject({ id: UUID(1), autor: 'dono', texto: 'olha a cláusula 4', estado: 'na-fila', arquivo: { nome: 'contrato.pdf', mime: 'application/pdf', tamanho: BYTES.length } });
    expect(Object.keys(linha1.arquivo).sort()).toEqual(['mime', 'nome', 'tamanho']);
    expect(linha2).toMatchObject({ texto: '', arquivo: { nome: 'foto.jpg', mime: 'image/jpeg', tamanho: 2_400_000 } });

    const taken = await w.store.chat.tomar(10);
    expect(taken).toHaveLength(2);
    const caminho1 = join(w.pasta, `${UUID(1)}-contrato.pdf`);
    expect(dirname(caminho1)).toBe(w.pasta);
    expect(chatText(taken[0]!)).toBe(
      `📎 O dono mandou um arquivo pelo celular [celular #${UUID(1).slice(0, 8)}]: contrato.pdf (${BYTES.length} B, application/pdf), em ${caminho1}. olha a cláusula 4`,
    );
    expect(chatText(taken[1]!)).toBe(
      `📎 O dono mandou um arquivo pelo celular [celular #${UUID(2).slice(0, 8)}]: foto.jpg (2,3 MB, image/jpeg), em ${join(w.pasta, `${UUID(2)}-foto.jpg`)}.`,
    );
    // Uma entrega só: entregue, não volta; reenviado pelo app, também não.
    await w.store.chat.entregue(UUID(1), 'entregue');
    await w.store.chat.entregue(UUID(2), 'entregue');
    expect(parse(await w.call('POST', '/api/v2/chat/arquivo', arquivoBody(UUID(1), BYTES, { legenda: 'olha a cláusula 4' })))).toEqual({ ok: true, nova: false, estado: 'com-o-lider' });
    expect(await w.store.chat.tomar(10)).toHaveLength(0);
  });

  it('a faxina apaga os arquivos com mais de 30 dias e deixa os mais novos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-arquivo-faxina-'));
    dirs.push(dir);
    const pasta = join(dir, 'chat-arquivos');
    mkdirSync(pasta);
    const velho = join(pasta, `${UUID(1)}-velho.pdf`);
    const novo = join(pasta, `${UUID(2)}-novo.pdf`);
    writeFileSync(velho, 'v');
    writeFileSync(novo, 'n');
    utimesSync(velho, new Date(T0 - 31 * DAY), new Date(T0 - 31 * DAY));
    utimesSync(novo, new Date(T0 - 29 * DAY), new Date(T0 - 29 * DAY));
    const log: string[] = [];
    sweepChatArquivos(pasta, T0, (line) => log.push(line));
    expect(readdirSync(pasta).map((name) => basename(name))).toEqual([`${UUID(2)}-novo.pdf`]);
    expect(log).toHaveLength(1);
    // Sem a pasta (nenhum arquivo ainda), não quebra.
    sweepChatArquivos(join(dir, 'nao-existe'), T0, () => {});
  });
});
