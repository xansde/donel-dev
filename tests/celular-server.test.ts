import { describe, expect, it } from 'vitest';
import type { ConfigIoDeps } from '../src/main/config-store';
import { createCelularAuth } from '../src/main/celular/auth';
import { createDemoLedger } from '../src/main/celular/ledger-port';
import { createMobileHandler, startMobileServer, type MobileResponse } from '../src/main/celular/server';
import { pickTailscaleAddress } from '../src/main/celular/tailscale';

// Ledger no celular — o que quebraria sem o dono ver: o servidor aceitar quem não pareou, subir fora da
// Tailscale, ou uma decisão do celular gravar duas vezes no ledger.

const FILE = 'C:/data/celular.json';

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

function setup() {
  const io = memoryIo();
  const auth = createCelularAuth({ filePath: FILE, io });
  const ledger = createDemoLedger();
  const handle = createMobileHandler({ auth, ledger: () => ledger, assets: {}, provasRoot: null });
  const call = (method: string, url: string, token?: string | null, body?: unknown): MobileResponse =>
    handle({ method, url, authorization: token ? `Bearer ${token}` : undefined, body: body === undefined ? '' : JSON.stringify(body) });
  const pairWith = (code: string): MobileResponse => call('POST', '/api/parear', null, { codigo: code, aparelho: 'iPhone' });
  return { io, auth, ledger, call, pairWith };
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
    const { auth, ledger, call, pairWith } = setup();

    expect(call('GET', '/api/fila').status).toBe(401);
    expect(call('GET', '/api/fila', 'inventado').status).toBe(401);
    expect(call('POST', '/api/decidir', null, { pedidoId: 'abcdefgh1', itemId: 'demo-1', decisao: 'aceitar' }).status).toBe(401);
    expect(call('GET', '/api/prova?item=demo-1&prova=p1').status).toBe(401);
    expect(ledger.gravacoes).toHaveLength(0);

    // sem convite aberto, nada pareia
    expect(pairWith('qualquer').status).toBe(403);
    const { code } = auth.createPairingCode();
    expect(pairWith('errado').status).toBe(403);
    const paired = pairWith(code);
    expect(paired.status).toBe(200);
    const token = bodyOf(paired).token as string;
    expect(pairWith(code).status).toBe(403); // uso único

    expect(call('GET', '/api/fila', token).status).toBe(200);
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
    const { auth, ledger, call, pairWith } = setup();
    const token = bodyOf(pairWith(auth.createPairingCode().code)).token as string;

    const pedido = { pedidoId: 'pedido-0001', itemId: 'demo-1', decisao: 'aceitar' };
    const first = call('POST', '/api/decidir', token, pedido);
    const retry = call('POST', '/api/decidir', token, pedido); // a rede caiu e o celular reenviou
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(bodyOf(retry)).toEqual(bodyOf(first));

    // outro pedido para a mesma entrega (dois toques, outro celular): recusado, sem gravar
    expect(call('POST', '/api/decidir', token, { ...pedido, pedidoId: 'pedido-0002', decisao: 'rejeitar', motivo: 'não' }).status).toBe(409);

    expect(ledger.gravacoes).toEqual([{ itemId: 'demo-1', decisao: 'aceitar', motivo: null, autor: 'dono', via: 'celular' }]);
    expect(ledger.pendentes().some((item) => item.id === 'demo-1')).toBe(false);
  });

  it('rejeitar sem motivo não grava; com motivo grava uma vez', () => {
    const { auth, ledger, call, pairWith } = setup();
    const token = bodyOf(pairWith(auth.createPairingCode().code)).token as string;

    expect(call('POST', '/api/decidir', token, { pedidoId: 'pedido-0003', itemId: 'demo-2', decisao: 'rejeitar', motivo: '   ' }).status).toBe(400);
    expect(ledger.gravacoes).toHaveLength(0);

    const pedido = { pedidoId: 'pedido-0004', itemId: 'demo-2', decisao: 'rejeitar', motivo: 'falta o teste' };
    expect(call('POST', '/api/decidir', token, pedido).status).toBe(200);
    expect(call('POST', '/api/decidir', token, pedido).status).toBe(200);
    expect(ledger.gravacoes).toEqual([{ itemId: 'demo-2', decisao: 'rejeitar', motivo: 'falta o teste', autor: 'dono', via: 'celular' }]);
  });
});
