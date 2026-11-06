import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { ConfigIoDeps } from '../src/main/config-store';
import { createCelularAuth } from '../src/main/celular/auth';
import { createLedgerMobilePort } from '../src/main/celular/ledger-port';
import { createLedgerService, ledgerProofsDir, type LedgerProofFs } from '../src/main/ledger-store';
import { resolveProofUrl } from '../src/main/ledger-proof-protocol';
import { proofUrl } from '../src/shared/ledger/channels';
import type { LedgerActor, LedgerForOwner } from '../src/shared/ledger/contract';
import { createMobileHandler, startMobileServer, TICKET_TTL_MS, type MobileResponse } from '../src/main/celular/server';
import { pickTailscaleAddress } from '../src/main/celular/tailscale';

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
function deliveredTask(ledger: ReturnType<typeof createLedgerService>, request: string): string {
  const created = ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request, doneWhen: 'pronto', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: 'alto' });
  if (!created.ok) throw new Error(created.reason);
  const id = created.task.id;
  expect(ledger.apply(DEV, { op: 'assumir', id }).ok).toBe(true);
  expect(ledger.apply(DEV, { op: 'entregar', id, proofs: [{ kind: 'texto', text: '4 passed' }], forOwner: FOR_OWNER }).ok).toBe(true);
  return id;
}

function setup() {
  const io = memoryIo();
  const auth = createCelularAuth({ filePath: FILE, io });
  let seq = 0;
  const ledger = createLedgerService({ filePath: LEDGER, io, proofFs: noProofFs, newId: () => `t-${++seq}` });
  const first = deliveredTask(ledger, 'quero salvar sem fechar');
  const second = deliveredTask(ledger, 'a mensagem chegou duas vezes');
  // A new handler over the same files is the app after a restart.
  let handle = createMobileHandler({ auth, ledger: () => createLedgerMobilePort(() => ledger), assets: {}, provasRoot: null });
  const restart = (): void => {
    handle = createMobileHandler({ auth, ledger: () => createLedgerMobilePort(() => createLedgerService({ filePath: LEDGER, io, proofFs: noProofFs })), assets: {}, provasRoot: null });
  };
  const call = (method: string, url: string, token?: string | null, body?: unknown): MobileResponse =>
    atOnce(handle({ method, url, authorization: token ? `Bearer ${token}` : undefined, body: body === undefined ? '' : JSON.stringify(body) }));
  const pairWith = (code: string): MobileResponse => call('POST', '/api/parear', null, { codigo: code, aparelho: 'iPhone' });
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

  it('recusa /api sem token válido; o código de pareamento vale uma vez; token revogado para de valer', () => {
    const { auth, first, decisions, call, pairWith } = setup();

    expect(call('GET', '/api/fila').status).toBe(401);
    expect(call('GET', '/api/fila', 'inventado').status).toBe(401);
    expect(call('POST', '/api/decidir', null, { pedidoId: 'abcdefgh1', itemId: first, decisao: 'aceitar' }).status).toBe(401);
    expect(call('GET', `/api/prova?item=${first}&prova=0`).status).toBe(401);
    expect(decisions(first)).toHaveLength(0);

    // sem convite aberto, nada pareia
    expect(pairWith('qualquer').status).toBe(403);
    const { code } = auth.createPairingCode();
    expect(pairWith('errado').status).toBe(403);
    const paired = pairWith(code);
    expect(paired.status).toBe(200);
    const token = bodyOf(paired).token as string;
    expect(pairWith(code).status).toBe(403); // uso único

    const fila = call('GET', '/api/fila', token);
    expect(fila.status).toBe(200);
    expect((bodyOf(fila).itens as { id: string }[]).map((item) => item.id)).toEqual([first, expect.any(String)]);
    const [device] = auth.devices();
    auth.revoke(device.id);
    expect(call('GET', '/api/fila', token).status).toBe(401);
  });

  it('convite vencido não pareia', () => {
    const io = memoryIo();
    let now = 1_000_000;
    const auth = createCelularAuth({ filePath: FILE, io, now: () => now });
    const { code } = auth.createPairingCode();
    now += 10 * 60_000 + 1;
    expect(auth.pair(code, 'Android')).toBeNull();
  });

  it('aceitar pelo celular grava no ledger uma vez só, com autor dono', () => {
    const { auth, ledger, first, decisions, call, pairWith, restart } = setup();
    const token = bodyOf(pairWith(auth.createPairingCode().code)).token as string;

    const pedido = { pedidoId: 'pedido-0001', itemId: first, decisao: 'aceitar' };
    const firstCall = call('POST', '/api/decidir', token, pedido);
    const retry = call('POST', '/api/decidir', token, pedido); // a rede caiu e o celular reenviou
    expect(firstCall.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(bodyOf(retry)).toEqual(bodyOf(firstCall));
    restart(); // o pedidoId está no ledger, não na memória do servidor
    expect(bodyOf(call('POST', '/api/decidir', token, pedido))).toEqual(bodyOf(firstCall));

    // outro pedido para a mesma entrega (dois toques, outro celular): recusado, sem gravar
    expect(call('POST', '/api/decidir', token, { ...pedido, pedidoId: 'pedido-0002', decisao: 'rejeitar', motivo: 'não' }).status).toBe(409);

    expect(decisions(first)).toEqual([expect.objectContaining({ kind: 'aceita', by: { kind: 'dono' } })]);
    expect(ledger.load().doc.tasks[first]!.state).toBe('aceita');
    expect((bodyOf(call('GET', '/api/fila', token)).itens as { id: string }[]).some((item) => item.id === first)).toBe(false);
  });

  it('a fila leva só o começo da saída, sem segredo; a inteira vem mascarada ao abrir', () => {
    const { auth, ledger, call, pairWith } = setup();
    const token = bodyOf(pairWith(auth.createPairingCode().code)).token as string;
    const secrets = ['sk-ant-api03-abcdefghijklmnopqrstuv', 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'Bearer eyJhbGciOi.abcdefghijk.lmnopqrstuv', 'abcdef0123456789ABCDEF0123456789'];
    const output = [`ANTHROPIC_API_KEY=${secrets[0]}`, `token: ${secrets[1]}`, `Authorization: ${secrets[2]}`, `DB_URL_X=${secrets[3]}`, ...Array.from({ length: 40 }, (_, i) => `linha ${i}`)].join('\n');
    const created = ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request: 'r', doneWhen: 'd', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: 'alto' });
    if (!created.ok) throw new Error(created.reason);
    const id = created.task.id;
    ledger.apply(DEV, { op: 'assumir', id });
    ledger.apply(DEV, { op: 'entregar', id, proofs: [{ kind: 'texto', text: output }], forOwner: FOR_OWNER });

    const item = (bodyOf(call('GET', '/api/fila', token)).itens as { id: string; provas: { texto: string; cortado?: boolean }[] }[]).find((entry) => entry.id === id)!;
    expect(item.provas[0]!.cortado).toBe(true);
    expect(item.provas[0]!.texto.length).toBeLessThan(500);
    const full = call('GET', `/api/prova?item=${id}&prova=0`, token);
    expect(full.status).toBe(200);
    const fullText = Buffer.from(full.body as Uint8Array).toString('utf8');
    expect(fullText).toContain('linha 39');
    for (const secret of secrets) {
      const core = secret.replace(/^Bearer /, '').slice(4);
      expect(item.provas[0]!.texto).not.toContain(core);
      expect(fullText).not.toContain(core);
    }
  });

  it('rejeitar sem motivo não grava; com motivo grava uma vez', () => {
    const { auth, second, decisions, call, pairWith } = setup();
    const token = bodyOf(pairWith(auth.createPairingCode().code)).token as string;

    expect(call('POST', '/api/decidir', token, { pedidoId: 'pedido-0003', itemId: second, decisao: 'rejeitar', motivo: '   ' }).status).toBe(400);
    expect(decisions(second)).toHaveLength(0);

    const pedido = { pedidoId: 'pedido-0004', itemId: second, decisao: 'rejeitar', motivo: 'falta o teste' };
    expect(call('POST', '/api/decidir', token, pedido).status).toBe(200);
    expect(call('POST', '/api/decidir', token, pedido).status).toBe(200);
    expect(decisions(second)).toEqual([expect.objectContaining({ kind: 'rejeitada', by: { kind: 'dono' }, text: 'falta o teste' })]);
  });
  it('a carta A leva o nome do lugar e não o id; escolher a opção que rejeita grava a opção uma vez, sem motivo digitado', () => {
    const { auth, ledger, second, decisions, call, pairWith } = setup();
    const token = bodyOf(pairWith(auth.createPairingCode().code)).token as string;
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
    expect(call('POST', '/api/decidir', token, { pedidoId: 'pedido-0005', itemId: second, decisao: 'aceitar', opcao: 'Refazer' }).status).toBe(409);
    const escolha = { pedidoId: 'pedido-0006', itemId: second, decisao: 'rejeitar', opcao: 'Refazer' };
    expect(call('POST', '/api/decidir', token, escolha).status).toBe(200);
    expect(call('POST', '/api/decidir', token, escolha).status).toBe(200);
    expect(decisions(second)).toEqual([expect.objectContaining({ kind: 'rejeitada', by: { kind: 'dono' }, option: 'Refazer', text: 'Refazer' })]);
  });
  it('o protótipo sai com a CSP sandbox allow-scripts, por bilhete de uso único que vence; donel-prova só serve nome de dentro das provas', () => {
    const io = memoryIo();
    const auth = createCelularAuth({ filePath: FILE, io });
    const ledger = createLedgerService({ filePath: LEDGER, io, proofFs: noProofFs, newId: () => 't-proto' });
    const created = ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request: 'r', doneWhen: 'd', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: 'alto' });
    if (!created.ok) throw new Error(created.reason);
    const html = '2026-11-05-abcdef012345.html';
    ledger.apply(DEV, { op: 'assumir', id: 't-proto' });
    expect(ledger.apply(DEV, { op: 'entregar', id: 't-proto', proofs: [{ kind: 'arquivo', file: html, mediaType: 'text/html' }, { kind: 'texto', text: 'ok' }], forOwner: { ...FOR_OWNER, visual: { kind: 'prova', proof: 0 } } }).ok).toBe(true);
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
