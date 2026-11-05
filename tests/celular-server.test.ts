import { describe, expect, it } from 'vitest';
import type { ConfigIoDeps } from '../src/main/config-store';
import { createCelularAuth } from '../src/main/celular/auth';
import { createLedgerMobilePort } from '../src/main/celular/ledger-port';
import { createLedgerService, type LedgerProofFs } from '../src/main/ledger-store';
import type { LedgerActor } from '../src/shared/ledger/contract';
import { createMobileHandler, startMobileServer, type MobileResponse } from '../src/main/celular/server';
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

/** Uma entrega de risco alto, entregue pelo Dev com prova: espera o dono. */
function deliveredTask(ledger: ReturnType<typeof createLedgerService>, request: string): string {
  const created = ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request, doneWhen: 'pronto', due: '2026-11-10', ownerPlaceId: 'p-dev', risk: 'alto' });
  if (!created.ok) throw new Error(created.reason);
  const id = created.task.id;
  expect(ledger.apply(DEV, { op: 'assumir', id }).ok).toBe(true);
  expect(ledger.apply(DEV, { op: 'entregar', id, proofs: [{ kind: 'texto', text: '4 passed' }] }).ok).toBe(true);
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
    handle({ method, url, authorization: token ? `Bearer ${token}` : undefined, body: body === undefined ? '' : JSON.stringify(body) });
  const pairWith = (code: string): MobileResponse => call('POST', '/api/parear', null, { codigo: code, aparelho: 'iPhone' });
  const decisions = (id: string) => ledger.load().doc.tasks[id]!.events.filter((event) => event.kind === 'aceita' || event.kind === 'rejeitada');
  return { io, auth, ledger, first, second, decisions, call, pairWith, restart };
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
    ledger.apply(DEV, { op: 'entregar', id, proofs: [{ kind: 'texto', text: output }] });

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
});
