import { createHash, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfigIoDeps } from '../src/main/config-store';
import { createCelularAuth, type CelularAuth } from '../src/main/celular/auth';
import { createLedgerMobilePort } from '../src/main/celular/ledger-port';
import { createLedgerService, LEDGER_WRITE_FAILED, ledgerProofsDir, type LedgerProofFs } from '../src/main/ledger-store';
import { resolveProofUrl } from '../src/main/ledger-proof-protocol';
import { proofUrl } from '../src/shared/ledger/channels';
import { lastDelivery, type LedgerActor, type LedgerForOwner } from '../src/shared/ledger/contract';
import { createMobileHandler, fromTailnet, startMobileServer, TICKET_TTL_MS, type MobileResponse } from '../src/main/celular/server';
import { httpsServeUrl } from '../src/main/celular/webpush';
import { pickTailscaleAddress } from '../src/main/celular/tailscale';
import { createCardWriter, type OwnerMessage } from '../src/main/ledger-card-writer';
import type { EntregaCelular } from '../src/shared/celular';
import {
  createDecisoesConsumer,
  decisaoMessage,
  OPTION_REQUIRED,
  STALE_DECISION,
  UNSIGNED_DECISION,
  PHONE_OFF,
  type DecisaoRow,
  type DecisaoVerifier,
  type DecisoesQueue,
} from '../src/oraculo/decisoes';

// Ledger no celular — o que quebraria sem o dono ver: o servidor aceitar quem não pareou, subir fora da
// Tailscale, ou uma decisão do celular gravar duas vezes no ledger.

const FILE = 'C:/data/celular.json';
const LEDGER = 'C:/data/ledger.json';
const LIDER: LedgerActor = { kind: 'lugar', placeId: 'p-lider', roleId: 'lider' };
const DEV: LedgerActor = { kind: 'lugar', placeId: 'p-dev', roleId: 'dev' };
const noProofFs: LedgerProofFs = {
  stat: () => Promise.reject(new Error('sem arquivo')),
  lstat: () => Promise.reject(new Error('sem arquivo')),
  realpath: () => Promise.reject(new Error('sem arquivo')),
  readFile: () => Promise.reject(new Error('sem arquivo')),
  mkdir: () => Promise.resolve(),
  copyFile: () => Promise.reject(new Error('sem arquivo')),
  writeFile: () => Promise.reject(new Error('sem arquivo')),
  unlink: () => Promise.resolve(),
};

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

/** The owner block a high-risk delivery needs (cartas forma A). */
const FOR_OWNER: LedgerForOwner = {
  question: 'Aceito assim?',
  summary: 'Feito e testado.',
  options: [
    { label: 'Aceitar', effect: 'Vai para o alfa.', closes: 'aceita', recommended: true },
    { label: 'Refazer', effect: 'Volta para quem fez.', closes: 'rejeitada' },
  ],
  why: 'Os testes passaram.',
  risk: 'Baixo.',
};

/** Uma entrega de risco alto, entregue pelo Dev com prova: espera o dono. */
async function deliveredTask(ledger: ReturnType<typeof createLedgerService>, request: string, forOwner: LedgerForOwner | null = FOR_OWNER): Promise<string> {
  const created = await ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request, doneWhen: 'pronto', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: forOwner ? 'alto' : 'baixo' });
  if (!created.ok) throw new Error(created.reason);
  const id = created.task.id;
  expect((await ledger.apply(DEV, { op: 'assumir', id })).ok).toBe(true);
  expect((await ledger.apply(DEV, { op: 'entregar', id, proofs: [{ kind: 'texto', text: '4 passed' }], ...(forOwner ? { forOwner } : {}) })).ok).toBe(true);
  return id;
}

/** The key a paired phone keeps (sha256 of its token) and its signature over a queue row (scheme donel-decisao-v1). */
const keyOf = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();
const signWith = (key: Buffer, row: DecisaoRow): string => createHmac('sha256', key).update(decisaoMessage(row), 'utf8').digest('hex');
const verifierOf =
  (auth: CelularAuth): DecisaoVerifier =>
  (message, signature) => {
    const device = auth.verifySignature(message, signature);
    return device ? { deviceName: device.name } : null;
  };
/** The delivery the phone shows on the card, as PostgREST hands a timestamptz back. */
const seenOf = (ledger: ReturnType<typeof createLedgerService>, id: string): string =>
  new Date(lastDelivery(ledger.load().doc.tasks[id]!)!.at).toISOString().replace('Z', '+00:00');

async function setup() {
  const io = memoryIo();
  const auth = createCelularAuth({ filePath: FILE, io });
  let seq = 0;
  const ledger = createLedgerService({ filePath: LEDGER, io, proofFs: noProofFs, newId: () => `t-${++seq}` });
  const first = await deliveredTask(ledger, 'quero salvar sem fechar');
  const second = await deliveredTask(ledger, 'a mensagem chegou duas vezes');
  // A new handler over the same files is the app after a restart.
  let handle = createMobileHandler({ auth, ledger: () => createLedgerMobilePort(() => ledger), assets: {}, provasRoot: null });
  const restart = (): void => {
    handle = createMobileHandler({ auth, ledger: () => createLedgerMobilePort(() => createLedgerService({ filePath: LEDGER, io, proofFs: noProofFs })), assets: {}, provasRoot: null });
  };
  const call = async (method: string, url: string, token?: string | null, body?: unknown): Promise<MobileResponse> =>
    handle({ method, url, authorization: token ? `Bearer ${token}` : undefined, body: body === undefined ? '' : JSON.stringify(body) });
  const pairWith = (code: string): Promise<MobileResponse> => call('POST', '/api/parear', null, { codigo: code, aparelho: 'iPhone' });
  const decisions = (id: string) => ledger.load().doc.tasks[id]!.events.filter((event) => event.kind === 'aceita' || event.kind === 'rejeitada');
  return { io, auth, ledger, first, second, decisions, call, pairWith, restart };
}

/** Every route but writing on the card answers at once. */
function atOnce(response: MobileResponse | Promise<MobileResponse>): MobileResponse {
  if (response instanceof Promise) throw new Error('resposta assíncrona onde se esperava na hora');
  return response;
}

function bodyOf(response: MobileResponse): Record<string, unknown> {
  return JSON.parse(response.body as string) as Record<string, unknown>;
}

describe('servidor do celular', () => {
  it('https pelo tailscale serve: só o 127.0.0.1 repassando a tailnet entra, e o QR só usa o serve que chega', () => {
    const serve = { 'x-forwarded-for': '100.101.102.104', 'tailscale-user-login': 'dono@example.com' };
    expect(fromTailnet('100.101.102.104', {})).toBe(true);
    expect(fromTailnet('127.0.0.1', serve)).toBe(true);
    expect(fromTailnet('127.0.0.1', { 'x-forwarded-for': '100.101.102.104' })).toBe(false);
    expect(fromTailnet('127.0.0.1', { ...serve, 'x-forwarded-for': '192.168.0.10' })).toBe(false);
    expect(fromTailnet('127.0.0.1', {})).toBe(false);
    expect(fromTailnet('192.168.0.10', serve)).toBe(false);

    const status = (proxy: string) => ({ Web: { 'pc.tail0000.ts.net:443': { Handlers: { '/': { Proxy: proxy } } } } });
    expect(httpsServeUrl(status('http://127.0.0.1:47815'), 47815)).toBe('https://pc.tail0000.ts.net');
    // O serve do Windows não alcança o IP Tailscale do próprio PC: esse endereço daria 502 no celular.
    expect(httpsServeUrl(status('http://100.101.102.103:47815'), 47815)).toBeNull();
    expect(httpsServeUrl(status('http://127.0.0.1:47816'), 47815)).toBeNull();
    expect(httpsServeUrl({}, 47815)).toBeNull();
  });

  it('recusa subir fora da Tailscale e só escolhe o endereço dela', async () => {
    for (const host of ['0.0.0.0', '127.0.0.1', '192.168.0.10', '::', '10.0.0.5', '100.128.0.1', '']) {
      await expect(startMobileServer({ host, port: 0, handler: () => ({ status: 200, headers: {}, body: '' }) })).rejects.toThrow(/Tailscale/);
    }
    expect(
      pickTailscaleAddress({
        Ethernet: [{ address: '192.168.0.10', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
        Tailscale: [{ address: '100.101.102.103', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
      }),
    ).toBe('100.101.102.103');
    expect(pickTailscaleAddress({ Ethernet: [{ address: '192.168.0.10', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }] })).toBeNull();
  });

  it('recusa /api sem token válido; o código de pareamento vale uma vez; token revogado para de valer', async () => {
    const { auth, first, decisions, call, pairWith } = await setup();

    expect((await call('GET', '/api/fila')).status).toBe(401);
    expect((await call('GET', '/api/fila', 'inventado')).status).toBe(401);
    expect((await call('POST', '/api/decidir', null, { pedidoId: 'abcdefgh1', itemId: first, decisao: 'aceitar' })).status).toBe(401);
    expect((await call('GET', `/api/prova?item=${first}&prova=0`)).status).toBe(401);
    expect(decisions(first)).toHaveLength(0);

    // sem convite aberto, nada pareia
    expect((await pairWith('qualquer')).status).toBe(403);
    const { code } = auth.createPairingCode();
    expect((await pairWith('errado')).status).toBe(403);
    const paired = await pairWith(code);
    expect(paired.status).toBe(200);
    const token = bodyOf(paired).token as string;
    expect((await pairWith(code)).status).toBe(403); // uso único

    const fila = await call('GET', '/api/fila', token);
    expect(fila.status).toBe(200);
    expect((bodyOf(fila).itens as { id: string }[]).map((item) => item.id)).toEqual([first, expect.any(String)]);
    const [device] = auth.devices();
    auth.revoke(device.id);
    expect((await call('GET', '/api/fila', token)).status).toBe(401);
  });

  it('convite vencido não pareia', async () => {
    const io = memoryIo();
    let now = 1_000_000;
    const auth = createCelularAuth({ filePath: FILE, io, now: () => now });
    const { code } = auth.createPairingCode();
    now += 10 * 60_000 + 1;
    expect(auth.pair(code, 'Android')).toBeNull();
  });

  it('aceitar pelo celular grava no ledger uma vez só, com autor dono', async () => {
    const { auth, ledger, first, decisions, call, pairWith, restart } = await setup();
    const token = bodyOf(await pairWith(auth.createPairingCode().code)).token as string;

    const pedido = { pedidoId: 'pedido-0001', itemId: first, decisao: 'aceitar' };
    const firstCall = await call('POST', '/api/decidir', token, pedido);
    const retry = await call('POST', '/api/decidir', token, pedido); // a rede caiu e o celular reenviou
    expect(firstCall.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(bodyOf(retry)).toEqual(bodyOf(firstCall));
    restart(); // o pedidoId está no ledger, não na memória do servidor
    expect(bodyOf(await call('POST', '/api/decidir', token, pedido))).toEqual(bodyOf(firstCall));

    // outro pedido para a mesma entrega (dois toques, outro celular): recusado, sem gravar
    expect((await call('POST', '/api/decidir', token, { ...pedido, pedidoId: 'pedido-0002', decisao: 'rejeitar', motivo: 'não' })).status).toBe(409);

    expect(decisions(first)).toEqual([expect.objectContaining({ kind: 'aceita', by: { kind: 'dono' } })]);
    expect(ledger.load().doc.tasks[first]!.state).toBe('aceita');
    expect((bodyOf(await call('GET', '/api/fila', token)).itens as { id: string }[]).some((item) => item.id === first)).toBe(false);
  });

  it('escrever na carta: sai uma vez para quem fez e fica na carta; recusado, não grava e diz o motivo', async () => {
    const { auth, ledger, first } = await setup();
    const sent: OwnerMessage[] = [];
    let closed = false;
    const writer = createCardWriter({
      service: () => ledger,
      deliver: async (message) => {
        sent.push(message);
        return closed ? null : { placeId: message.placeId };
      },
    });
    const handle = createMobileHandler({ auth, ledger: () => createLedgerMobilePort(() => ledger, undefined, () => writer), assets: {}, provasRoot: null });
    const token = (JSON.parse(atOnce(handle({ method: 'POST', url: '/api/parear', body: JSON.stringify({ codigo: auth.createPairingCode().code, aparelho: 'Android' }) })).body as string) as { token: string }).token;
    const write = async (body: unknown) => {
      const response = await handle({ method: 'POST', url: '/api/comentar', authorization: `Bearer ${token}`, body: JSON.stringify(body) });
      return { status: response.status, body: bodyOf(response) };
    };
    const comments = () => ledger.load().doc.tasks[first]!.events.filter((event) => event.kind === 'comentada');
    const pedido = { pedidoId: 'escrever-0001', itemId: first, texto: 'Pode configurar com a senha do cofre.' };

    // Sucesso: entregue a quem fez, gravado na carta com o id do envio, recibo para o celular.
    const ok = await write(pedido);
    expect(ok).toEqual({ status: 200, body: { ok: true, recibo: expect.stringMatching(/^Enviado a /) } });
    // A resposta se perdeu (a rede caiu) e o celular reenviou: o mesmo recibo, sem mandar nem gravar de novo.
    expect(await write(pedido)).toEqual(ok);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Pode configurar com a senha do cofre.');
    expect(comments()).toEqual([expect.objectContaining({ text: 'Pode configurar com a senha do cofre.', requestId: 'escrever-0001', by: { kind: 'dono' } })]);
    // A carta mostra o que foi escrito, com o id do envio (o celular apaga o rascunho guardado por ele).
    const fila = bodyOf(atOnce(handle({ method: 'GET', url: '/api/fila', authorization: `Bearer ${token}`, body: '' }))).itens as EntregaCelular[];
    expect(fila.find((item) => item.id === first)?.conversa).toEqual([expect.objectContaining({ de: 'voce', texto: 'Pode configurar com a senha do cofre.', pedidoId: 'escrever-0001' })]);

    // Ninguém aberto: não se perde, fica guardado na carta.
    closed = true;
    expect(await write({ ...pedido, pedidoId: 'escrever-0002', texto: 'E me avisa.' })).toEqual({ status: 200, body: { ok: true, recibo: expect.stringContaining('fica guardado na carta') } });
    expect(comments()).toHaveLength(2);

    // Falha: a carta já fechou. Não manda, não grava, e o motivo volta para o celular mostrar.
    expect((await ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: first })).ok).toBe(true);
    const refused = await write({ ...pedido, pedidoId: 'escrever-0003', texto: 'Tarde demais.' });
    expect(refused).toEqual({ status: 409, body: { erro: 'recusada', mensagem: expect.stringContaining('já foi aceita') } });
    // O app ainda abrindo (sem o escritor da carta): recusa com motivo, sem gravar.
    const opening = createMobileHandler({ auth, ledger: () => createLedgerMobilePort(() => ledger, undefined, () => null), assets: {}, provasRoot: null });
    const early = await opening({ method: 'POST', url: '/api/comentar', authorization: `Bearer ${token}`, body: JSON.stringify({ ...pedido, pedidoId: 'escrever-0004' }) });
    expect(early.status).toBe(409);
    expect(bodyOf(early).mensagem).toEqual(expect.stringContaining('abrindo'));
    expect(sent).toHaveLength(2);
    expect(comments()).toHaveLength(2);
  });

  it('a fila leva só o começo da saída, sem segredo; a inteira vem mascarada ao abrir', async () => {
    const { auth, ledger, call, pairWith } = await setup();
    const token = bodyOf(await pairWith(auth.createPairingCode().code)).token as string;
    const secrets = ['sk-ant-api03-abcdefghijklmnopqrstuv', 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'Bearer eyJhbGciOi.abcdefghijk.lmnopqrstuv', 'abcdef0123456789ABCDEF0123456789'];
    const output = [`ANTHROPIC_API_KEY=${secrets[0]}`, `token: ${secrets[1]}`, `Authorization: ${secrets[2]}`, `DB_URL_X=${secrets[3]}`, ...Array.from({ length: 40 }, (_, i) => `linha ${i}`)].join('\n');
    const created = await ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request: 'r', doneWhen: 'd', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: 'alto' });
    if (!created.ok) throw new Error(created.reason);
    const id = created.task.id;
    await ledger.apply(DEV, { op: 'assumir', id });
    await ledger.apply(DEV, { op: 'entregar', id, proofs: [{ kind: 'texto', text: output }], forOwner: FOR_OWNER });

    const item = (bodyOf(await call('GET', '/api/fila', token)).itens as { id: string; provas: { texto: string; cortado?: boolean }[] }[]).find((entry) => entry.id === id)!;
    expect(item.provas[0]!.cortado).toBe(true);
    expect(item.provas[0]!.texto.length).toBeLessThan(500);
    const full = await call('GET', `/api/prova?item=${id}&prova=0`, token);
    expect(full.status).toBe(200);
    const fullText = Buffer.from(full.body as Uint8Array).toString('utf8');
    expect(fullText).toContain('linha 39');
    for (const secret of secrets) {
      const core = secret.replace(/^Bearer /, '').slice(4);
      expect(item.provas[0]!.texto).not.toContain(core);
      expect(fullText).not.toContain(core);
    }
  });

  it('rejeitar sem motivo não grava; com motivo grava uma vez', async () => {
    const { auth, second, decisions, call, pairWith } = await setup();
    const token = bodyOf(await pairWith(auth.createPairingCode().code)).token as string;

    expect((await call('POST', '/api/decidir', token, { pedidoId: 'pedido-0003', itemId: second, decisao: 'rejeitar', motivo: '   ' })).status).toBe(400);
    expect(decisions(second)).toHaveLength(0);

    const pedido = { pedidoId: 'pedido-0004', itemId: second, decisao: 'rejeitar', motivo: 'falta o teste' };
    expect((await call('POST', '/api/decidir', token, pedido)).status).toBe(200);
    expect((await call('POST', '/api/decidir', token, pedido)).status).toBe(200);
    expect(decisions(second)).toEqual([expect.objectContaining({ kind: 'rejeitada', by: { kind: 'dono' }, text: 'falta o teste' })]);
  });
  it('a carta A leva o nome do lugar e não o id; escolher a opção que rejeita grava a opção uma vez, sem motivo digitado', async () => {
    const { auth, ledger, second, decisions, call, pairWith } = await setup();
    const token = bodyOf(await pairWith(auth.createPairingCode().code)).token as string;
    const port = createLedgerMobilePort(() => ledger, (projectPath, placeId) => (projectPath === 'C:/proj/atlas' && placeId === 'p-dev' ? 'painel do Jobu' : undefined));
    const item = port.pendentes().find((entry) => entry.id === second)!;
    expect(item.quemEntregou).toBe('Dev · painel do Jobu');
    expect(item.carta).toMatchObject({ pergunta: FOR_OWNER.question, opcoes: [{ rotulo: 'Aceitar', recomendada: true }, { rotulo: 'Refazer', fecha: 'rejeitada' }] });
    // `id` só endereça a API; `ids`, provas, pedido e critério ficam nos recolhidos do verso.
    const { id, ids, provas, pedido, criterio, ...front } = item;
    expect(id).toBe(second);
    expect(JSON.stringify(front)).not.toMatch(/p-dev|t-\d/);
    expect(ids.join(' ')).toContain('p-dev');

    // Opção que não existe, ou que fecha do outro jeito: recusada sem gravar.
    expect((await call('POST', '/api/decidir', token, { pedidoId: 'pedido-0005', itemId: second, decisao: 'aceitar', opcao: 'Refazer' })).status).toBe(409);
    const escolha = { pedidoId: 'pedido-0006', itemId: second, decisao: 'rejeitar', opcao: 'Refazer' };
    expect((await call('POST', '/api/decidir', token, escolha)).status).toBe(200);
    expect((await call('POST', '/api/decidir', token, escolha)).status).toBe(200);
    expect(decisions(second)).toEqual([expect.objectContaining({ kind: 'rejeitada', by: { kind: 'dono' }, option: 'Refazer', text: 'Refazer' })]);
  });
  it('a fila do celular aplica uma vez, não duplica, não some', async () => {
    const { auth, ledger, first, second, decisions } = await setup();
    auth.setEnabled(true);
    const key = keyOf(auth.pair(auth.createPairingCode().code, 'Android')!.token);
    const t0 = Date.now();
    const seen: Record<string, string> = { [first]: seenOf(ledger, first), [second]: seenOf(ledger, second) };
    const row = (n: number, tarefa: string, lado: DecisaoRow['lado'], rest: Partial<DecisaoRow> = {}): DecisaoRow => {
      const unsigned: DecisaoRow = {
        pedido: `00000000-0000-4000-8000-00000000000${n}`,
        tarefa,
        lado,
        opcao: null,
        comentario: null,
        paginas: null,
        criada_em: new Date(t0 + n * 1000).toISOString(),
        entrega_vista: seen[tarefa] ?? new Date(t0).toISOString(),
        assinatura: null,
        ...rest,
      };
      return { ...unsigned, assinatura: signWith(key, unsigned) };
    };
    // The Supabase queue in memory: `tomar` hands the rows not yet marked (sorted by the consumer, not here).
    const rows: (DecisaoRow & { resultado?: string })[] = [
      row(1, first, 'sim', { opcao: 'Aceitar', paginas: [{ pagina: 1, nome: 'capa', nota: 'down' }, { pagina: 99, nota: 'up' }] }),
      row(2, second, 'nao', { opcao: 'Refazer' }),
      row(4, 't-99', 'sim'),
      row(3, 't-98', 'sim'), // annulled between `tomar` and `marcar`
      // Decided on a card older than the last delivery: a card he never saw, never applied.
      row(5, second, 'sim', { opcao: 'Aceitar', entrega_vista: new Date(Date.parse(seen[second]!) - 60_000).toISOString(), criada_em: new Date(t0 - 3_600_000).toISOString() }),
    ];
    const result = (n: number): string | undefined => rows.find((entry) => entry.pedido.endsWith(String(n)))!.resultado;
    const failMark = new Set(['1', '2']);
    const queue: DecisoesQueue = {
      tomar: async () => rows.filter((entry) => !entry.resultado),
      marcar: async (pedido, resultado) => {
        if (failMark.delete(pedido.slice(-1))) throw new Error('sem rede');
        const target = rows.find((entry) => entry.pedido === pedido)!;
        if (target.resultado) return false;
        target.resultado = resultado;
        return true;
      },
    };
    let failWrite = false;
    const port = createLedgerMobilePort(() => ({
      ...ledger,
      apply: async (actor, op) => (failWrite ? ((failWrite = false), { ok: false as const, reason: LEDGER_WRITE_FAILED }) : ledger.apply(actor, op)),
    }));
    const asked: string[] = [];
    let returned = true;
    let verifier: DecisaoVerifier | null = null;
    const consumer = createDecisoesConsumer({
      queue: () => queue,
      port: {
        decidir: (input) => {
          asked.push(input.pedidoId);
          if (input.pedidoId.endsWith('3')) rows.find((entry) => entry.pedido === input.pedidoId)!.resultado = 'anulada pelo dono';
          return port.decidir(input);
        },
        comentar: (input) => port.comentar(input),
      },
      verifier: () => verifier,
      ledger: () => ledger,
      returned: () => returned,
    });

    // The ledger went back to the PC: nothing is taken, applied or marked (not lost).
    await consumer.round();
    // The phone's core is not up: nothing can be checked, so nothing is applied nor refused.
    returned = false;
    await consumer.round();
    expect(asked).toEqual([]);
    expect(rows.map((entry) => entry.resultado)).toEqual([undefined, undefined, undefined, undefined, undefined]);

    // Round 1: the stale row is refused without reaching the ledger; the write fails on the next one, which stays.
    verifier = verifierOf(auth);
    failWrite = true;
    await consumer.round();
    expect(result(5)).toBe(`recusada: ${STALE_DECISION}`);
    expect(decisions(second)).toHaveLength(0);
    expect(result(1)).toBeUndefined();
    expect(decisions(first)).toHaveLength(0);
    expect(result(2)).toBeUndefined();

    // Round 2: applied, but two marks fail; the batch goes on. The refusals are marked, the annulled row is not overwritten.
    await consumer.round();
    expect(decisions(first)).toEqual([expect.objectContaining({ kind: 'aceita', by: { kind: 'dono' }, option: 'Aceitar', text: 'Notas por página: 👎 p1 capa' })]);
    expect(result(1)).toBeUndefined();
    expect(decisions(second)).toEqual([expect.objectContaining({ kind: 'rejeitada', by: { kind: 'dono' }, option: 'Refazer', text: 'Refazer' })]);
    expect(result(2)).toBeUndefined();
    expect(result(3)).toBe('anulada pelo dono');
    expect(result(4)).toBe('recusada: Esta entrega não existe mais.');

    // The Dev delivers `second` again before the rejection's mark went through: the row read again is already in the
    // ledger, so the new delivery does not turn it into a refusal (and nothing is written twice).
    expect((await ledger.apply(DEV, { op: 'assumir', id: second })).ok).toBe(true);
    expect((await ledger.apply(DEV, { op: 'entregar', id: second, proofs: [{ kind: 'texto', text: '5 passed' }], forOwner: FOR_OWNER })).ok).toBe(true);

    // Round 3: the same rows again do not write twice; they are marked.
    await consumer.round();
    expect(decisions(first)).toHaveLength(1);
    expect(decisions(second)).toHaveLength(1);
    expect(result(1)).toBe('aplicada: aceita');
    expect(result(2)).toBe('aplicada: rejeitada');
    expect(ledger.load().doc.tasks[second]!.state).toBe('entregue');

    // Round 4: nothing left, nothing changes; the stale row never reached the ledger.
    const before = JSON.stringify(ledger.load().doc);
    await consumer.round();
    expect(JSON.stringify(ledger.load().doc)).toBe(before);
    expect(asked).not.toContain(rows[4]!.pedido);
    expect(asked).toHaveLength(7);
  });

  it('a fila do celular só aplica o que um celular pareado assinou, na carta que ele viu, com um lado da carta', async () => {
    // The scheme's vector: the phone (donel-nucleo's assinatura.rs) asserts the same key, bytes and signature, and a
    // phone paired with that token is the one the Oráculo finds.
    const vectorToken = 'tok_exemplo_nao_secreto_0123456789abcdef';
    const vectorKey = keyOf(vectorToken);
    expect(vectorKey.toString('hex')).toBe('d6118f5b53abaf6e629249b695a40f4a2ce2e7e0899e5b20799ebbab0f828bf4');
    const vectorRow: DecisaoRow = {
      pedido: '0b1e5c1a-7f3d-4c2a-9e8b-1d2c3b4a5f60',
      tarefa: 't-52bf8b45',
      lado: 'nao',
      opcao: 'Refazer',
      comentario: 'Falta o teste\nda página 3 — ação',
      paginas: [{ pagina: 1, nota: 'down', nome: 'capa' }, { pagina: 3, nota: 'up', nome: 'provas' }],
      criada_em: '2026-11-17T01:06:20.000+00:00',
      entrega_vista: '2026-11-17T01:06:11.128+00:00', // 1794877571128 ms
      assinatura: 'c848862f6f2328dfd518a8c057481d0de824063874c31f0fa1f30700febabe71',
    };
    expect(decisaoMessage(vectorRow)).toBe(
      '16:donel-decisao-v1\n36:0b1e5c1a-7f3d-4c2a-9e8b-1d2c3b4a5f60\n10:t-52bf8b45\n3:nao\n7:Refazer\n37:Falta o teste\nda página 3 — ação\n13:1794877571128\n23:1:down:capa;3:up:provas\n',
    );
    expect(signWith(vectorKey, vectorRow)).toBe(vectorRow.assinatura);
    const vectorIo = memoryIo();
    vectorIo.writeFileText(FILE, JSON.stringify({ schemaVersion: 1, enabled: true, devices: [{ id: 'd1', name: 'Android', tokenHash: vectorKey.toString('hex'), pairedAt: '2026-11-16T00:00:00.000Z' }] }));
    const vectorAuth = createCelularAuth({ filePath: FILE, io: vectorIo });
    expect(vectorAuth.verifySignature(decisaoMessage(vectorRow), vectorRow.assinatura!)?.name).toBe('Android');
    expect(vectorAuth.verifySignature(decisaoMessage({ ...vectorRow, lado: 'sim' }), vectorRow.assinatura!)).toBeNull();

    const { auth, ledger, first, second, decisions } = await setup();
    // No option closes as rejected: the phone draws the generic "Rejeitar" on the left.
    const third = await deliveredTask(ledger, 'só opções que aceitam', {
      ...FOR_OWNER,
      options: [
        { label: 'Aceitar', effect: 'Vai para o alfa.', closes: 'aceita', recommended: true },
        { label: 'Aceitar e seguir', effect: 'Vai para o alfa e segue.', closes: 'aceita' },
      ],
    });
    // The Revisor's accept, still before the owner (the daily sample): nothing to decide, words go on the card.
    const sample = await deliveredTask(ledger, 'aceita pelo Revisor', null);
    expect((await ledger.apply({ kind: 'lugar', placeId: 'p-rev', roleId: 'revisor' }, { op: 'aceitar', id: sample })).ok).toBe(true);

    // A card the owner already rejected on the PC before the row was read: his words were a decision, not a note.
    const rejectedOnPc = await deliveredTask(ledger, 'rejeitada pelo PC');
    expect((await ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id: rejectedOnPc, reason: 'falta o teste' })).ok).toBe(true);
    // A delivered card decided while the phone is switched off in Preferences.
    const fourth = await deliveredTask(ledger, 'entregue, celular desligado');
    // The Revisor's sample of a delivery that came with a card: the owner sees the old card, without options.
    const lowWithCard = await ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request: 'amostra com carta', doneWhen: 'pronto', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: 'baixo' });
    if (!lowWithCard.ok) throw new Error(lowWithCard.reason);
    const sampleCard = lowWithCard.task.id;
    expect((await ledger.apply(DEV, { op: 'assumir', id: sampleCard })).ok).toBe(true);
    expect((await ledger.apply(DEV, { op: 'entregar', id: sampleCard, proofs: [{ kind: 'texto', text: '4 passed' }], forOwner: FOR_OWNER })).ok).toBe(true);
    expect((await ledger.apply({ kind: 'lugar', placeId: 'p-rev', roleId: 'revisor' }, { op: 'aceitar', id: sampleCard })).ok).toBe(true);
    // A second sample he writes on: the note goes out, its mark fails, and the row is read again after the phone is
    // switched off (an applied note is answered as applied, not refused by a later check).
    const sampleNote = await deliveredTask(ledger, 'amostra com recado', null);
    expect((await ledger.apply({ kind: 'lugar', placeId: 'p-rev', roleId: 'revisor' }, { op: 'aceitar', id: sampleNote })).ok).toBe(true);
    // A card of its own, with no option closing as rejected, that nothing else decides: an unknown label on its
    // left side is refused, never turned into the generic "Rejeitar".
    const unknownLabel = await deliveredTask(ledger, 'rótulo desconhecido', {
      ...FOR_OWNER,
      options: [
        { label: 'Aceitar', effect: 'Vai para o alfa.', closes: 'aceita', recommended: true },
        { label: 'Aceitar e seguir', effect: 'Vai para o alfa e segue.', closes: 'aceita' },
      ],
    });
    // A label recorded with spaces around it: the phone sends it trimmed.
    const fifth = await deliveredTask(ledger, 'rótulo com espaço', {
      ...FOR_OWNER,
      options: [
        { label: ' Seguir ', effect: 'Vai para o alfa.', closes: 'aceita', recommended: true },
        { label: 'Refazer', effect: 'Volta para quem fez.', closes: 'rejeitada' },
      ],
    });

    auth.setEnabled(true);
    const keyA = keyOf(auth.pair(auth.createPairingCode().code, 'Android')!.token);
    const paired = auth.pair(auth.createPairingCode().code, 'Antigo')!;
    const keyB = keyOf(paired.token);
    auth.revoke(paired.deviceId);
    const stranger = keyOf('nunca-pareado-com-este-oraculo');

    const t0 = Date.now();
    const seen = (id: string): string => seenOf(ledger, id);
    const row = (n: number, tarefa: string, lado: DecisaoRow['lado'], rest: Partial<DecisaoRow> = {}, key: Buffer | null = keyA): DecisaoRow => {
      const unsigned: DecisaoRow = {
        pedido: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
        tarefa,
        lado,
        opcao: null,
        comentario: null,
        paginas: null,
        criada_em: new Date(t0 + n * 1000).toISOString(),
        entrega_vista: seen(tarefa),
        assinatura: null,
        ...rest,
      };
      return { ...unsigned, assinatura: key ? signWith(key, unsigned) : null };
    };
    const tampered = row(8, first, 'sim', { opcao: 'Aceitar', comentario: 'ok' });
    const rows: (DecisaoRow & { resultado?: string })[] = [
      row(1, first, 'sim', { opcao: 'Aceitar' }, null), // an old APK, or the password alone
      row(2, first, 'sim', { opcao: 'Aceitar' }, stranger),
      row(3, first, 'sim', { opcao: 'Aceitar' }, keyB), // a revoked phone
      row(4, first, 'sim', { opcao: 'Aceitar', entrega_vista: new Date(Date.parse(seen(first)) + 1).toISOString() }),
      row(5, first, 'sim', { opcao: 'Aceitar como está' }), // a label of another card
      row(6, first, 'nao', { opcao: 'Aceitar' }), // an option that closes the other way
      row(7, first, 'nao', { opcao: 'Rejeitar' }), // the generic, while "Refazer" closes as rejected
      { ...tampered, comentario: 'outra coisa' }, // changed after signing
      row(9, third, 'nao', { opcao: 'Rejeitar', comentario: 'Falta o teste\u0007' }),
      row(10, sample, 'comentario', { comentario: 'Gostei da capa' }),
      row(11, second, 'sim', { opcao: 'Aceitar' }),
      row(12, first, 'sim', { opcao: 'Aceitar', entrega_vista: null }), // does not say which card he saw
      row(13, first, 'sim'), // no label, on a card whose "Aceitar" closes as accepted
      row(14, sampleNote, 'comentario', { comentario: 'Faltou o print' }),
      row(15, fifth, 'sim', { opcao: 'Seguir' }),
      row(16, unknownLabel, 'nao', { opcao: 'Refazer tudo' }), // unknown label, on a card with no option closing as rejected
      row(17, sampleCard, 'sim'), // the owner confirms the Revisor's accept
      row(18, rejectedOnPc, 'comentario', { comentario: 'Pode seguir assim' }),
    ];
    const result = (n: number): string | undefined => rows[n - 1]!.resultado;
    const failMark = new Set([rows[13]!.pedido]);
    const queue: DecisoesQueue = {
      tomar: async () => rows.filter((entry) => !entry.resultado),
      marcar: async (pedido, resultado) => {
        if (failMark.delete(pedido)) throw new Error('sem rede');
        const target = rows.find((entry) => entry.pedido === pedido)!;
        if (target.resultado) return false;
        target.resultado = resultado;
        return true;
      },
    };
    const sent: OwnerMessage[] = [];
    const writer = createCardWriter({
      service: () => ledger,
      deliver: async (message) => {
        sent.push(message);
        return { placeId: message.placeId };
      },
    });
    const port = createLedgerMobilePort(() => ledger, undefined, () => writer);
    const decided: string[] = [];
    const consumer = createDecisoesConsumer({
      queue: () => queue,
      port: {
        decidir: (input) => {
          decided.push(input.pedidoId);
          return port.decidir(input);
        },
        comentar: (input) => port.comentar(input),
      },
      verifier: () => verifierOf(auth),
      phoneOn: () => auth.enabled,
      ledger: () => ledger,
      returned: () => false,
    });
    await consumer.round();

    for (const n of [1, 2, 3, 8]) expect(result(n)).toBe(`recusada: ${UNSIGNED_DECISION}`);
    for (const n of [4, 5, 6, 7, 12, 16]) expect(result(n)).toBe(`recusada: ${STALE_DECISION}`);
    expect(result(13)).toBe(`recusada: ${OPTION_REQUIRED}`);
    expect(decisions(first)).toHaveLength(0);
    expect(ledger.load().doc.tasks[first]!.state).toBe('entregue');
    expect(decisions(unknownLabel)).toHaveLength(0);
    expect(ledger.load().doc.tasks[unknownLabel]!.state).toBe('entregue');
    // Only the rows that passed every check reached the ledger.
    expect(decided).toEqual([rows[8]!.pedido, rows[10]!.pedido, rows[14]!.pedido, rows[16]!.pedido, rows[17]!.pedido]);
    expect(result(17)).toBe('aplicada: aceita');
    expect(result(18)).toMatch(/^recusada: /);
    expect(sent.filter((message) => message.text.includes('Pode seguir assim'))).toHaveLength(0);
    expect(ledger.load().doc.tasks[sampleCard]!.state).toBe('aceita');

    expect(result(15)).toBe('aplicada: aceita');
    expect(decisions(fifth)).toEqual([expect.objectContaining({ kind: 'aceita', by: { kind: 'dono' }, option: ' Seguir ' })]);

    // The note on `sampleNote` went out but its mark failed. The phone is switched off in Preferences before the row is
    // read again: the note already on the card is answered as applied, and goes out once; a new signed row is refused
    // for the phone being off, never applied.
    expect(result(14)).toBeUndefined();
    auth.setEnabled(false);
    rows.push(row(19, fourth, 'sim', { opcao: 'Aceitar' }));
    await consumer.round();
    expect(result(14)).toBe('aplicada: comentário');
    expect(sent.filter((message) => message.text.includes('Faltou o print'))).toHaveLength(1);
    expect(result(19)).toBe(`recusada: ${PHONE_OFF}`);
    expect(decisions(fourth).filter((event) => event.kind === 'aceita')).toHaveLength(0);

    expect(result(9)).toBe('aplicada: rejeitada');
    expect(decisions(third)).toEqual([expect.objectContaining({ kind: 'rejeitada', by: { kind: 'dono' }, text: 'Falta o teste' })]);
    expect(decisions(third)[0]).not.toHaveProperty('option');

    expect(result(10)).toBe('aplicada: comentário');
    expect(ledger.load().doc.tasks[sample]!.state).toBe('aceita');
    expect(ledger.load().doc.tasks[sample]!.events.filter((event) => event.kind === 'comentada')).toEqual([expect.objectContaining({ by: { kind: 'dono' }, text: 'Gostei da capa' })]);
    expect(sent.filter((message) => message.text.includes('Gostei da capa'))).toHaveLength(1);

    expect(result(11)).toBe('aplicada: aceita');
    expect(decisions(second)).toEqual([expect.objectContaining({ kind: 'aceita', by: { kind: 'dono' }, option: 'Aceitar' })]);
  });

  it('o protótipo sai com a CSP sandbox allow-scripts, por bilhete de uso único que vence; donel-prova só serve nome de dentro das provas', async () => {
    const io = memoryIo();
    const auth = createCelularAuth({ filePath: FILE, io });
    const ledger = createLedgerService({ filePath: LEDGER, io, proofFs: noProofFs, newId: () => 't-proto' });
    const created = await ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request: 'r', doneWhen: 'd', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: 'alto' });
    if (!created.ok) throw new Error(created.reason);
    const html = '2026-11-05-abcdef012345.html';
    await ledger.apply(DEV, { op: 'assumir', id: 't-proto' });
    expect((await ledger.apply(DEV, { op: 'entregar', id: 't-proto', proofs: [{ kind: 'arquivo', file: html, mediaType: 'text/html' }, { kind: 'texto', text: 'ok' }], forOwner: { ...FOR_OWNER, visual: { kind: 'prova', proof: 0 } } })).ok).toBe(true);
    let now = 1_000_000;
    const handle = createMobileHandler({ auth, ledger: () => createLedgerMobilePort(() => ledger), assets: {}, provasRoot: ledgerProofsDir(LEDGER), now: () => now });
    const token = (JSON.parse(atOnce(handle({ method: 'POST', url: '/api/parear', body: JSON.stringify({ codigo: auth.createPairingCode().code, aparelho: 'iPhone' }) })).body as string) as { token: string }).token;
    const get = (url: string, withToken = true): MobileResponse => atOnce(handle({ method: 'GET', url, authorization: withToken ? `Bearer ${token}` : undefined, body: '' }));
    const ticket = (prova: string): MobileResponse => get(`/api/prova-bilhete?item=t-proto&prova=${prova}`);

    expect(get('/api/prova-bilhete?item=t-proto&prova=0', false).status).toBe(401);
    expect(ticket('1').status).toBe(404); // a saída de comando não é protótipo
    const bilhete = (JSON.parse(ticket('0').body as string) as { bilhete: string }).bilhete;
    const page = get(`/api/prova-html?b=${bilhete}`, false);
    expect(page.status).toBe(200);
    const csp = page.headers['Content-Security-Policy']!;
    expect(csp.startsWith('sandbox allow-scripts;')).toBe(true);
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("connect-src 'none'");
    expect(page.body).toEqual({ filePath: expect.stringContaining(html) });
    expect(get(`/api/prova-html?b=${bilhete}`, false).status).toBe(404); // uso único

    const late = (JSON.parse(ticket('0').body as string) as { bilhete: string }).bilhete;
    now += TICKET_TTL_MS + 1;
    expect(get(`/api/prova-html?b=${late}`, false).status).toBe(404); // venceu

    // Desktop: donel-prova só serve um nome que o main deu, dentro de ledger-provas.
    expect(resolveProofUrl(proofUrl(html), '/u/ledger-provas')).toMatchObject({ ok: true, path: join('/u/ledger-provas', html), csp: expect.stringMatching(/^sandbox allow-scripts;/) });
    for (const bad of ['donel-prova://prova/..%2Fledger.json', 'donel-prova://prova/a%2Fb.html', 'donel-prova://prova/x.exe', 'donel-prova://outro/' + html, 'donel-asset://prova/' + html])
      expect(resolveProofUrl(bad, '/u/ledger-provas').ok, bad).toBe(false);
  });
});
