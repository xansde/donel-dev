// Proxy de saída das VPS (scripts/proxy-saida): o que vazaria sem o dono ver — o proxy do PC escutando fora
// da Tailscale ou abrindo túnel para qualquer destino, a senha aceita errada, e o Claude da VPS saindo pelo IP
// da nuvem quando o PC some (dono, 08/11: "não pode deixar o proxy sair no IP da VPS").
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  assertTailnetBind,
  checkProxyAuth,
  createUpstreamHealth,
  hashPassword,
  isAllowed,
  parseConnectTarget,
  startVpsRelay,
} from '../scripts/proxy-saida/proxy-saida.mjs';

/** A port nobody listens on: open one, take its number, close it. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Sends a CONNECT through the relay and returns the status line it answers. */
function connectStatus(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      if (data.includes('\r\n')) {
        socket.destroy();
        resolve(data.split('\r\n')[0] ?? '');
      }
    });
    socket.on('error', reject);
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error('o relay não respondeu'));
    });
  });
}

describe('proxy de saída', () => {
  it('só escuta num IP da Tailscale', () => {
    expect(() => assertTailnetBind('100.76.108.30')).not.toThrow();
    for (const bind of ['0.0.0.0', '192.168.0.58', '127.0.0.1', '::', '100.128.0.1', '']) {
      expect(() => assertTailnetBind(bind)).toThrow();
    }
  });

  it('só abre túnel para Anthropic/Claude na 443', () => {
    expect(isAllowed('api.anthropic.com', 443)).toBe(true);
    expect(isAllowed('claude.ai', 443)).toBe(true);
    expect(isAllowed('platform.claude.com', 443)).toBe(true);
    expect(isAllowed('api.anthropic.com', 80)).toBe(false);
    expect(isAllowed('github.com', 443)).toBe(false);
    expect(isAllowed('evilanthropic.com', 443)).toBe(false);
    expect(isAllowed('anthropic.com.evil.io', 443)).toBe(false);
    expect(parseConnectTarget('api.anthropic.com:443')).toEqual({ host: 'api.anthropic.com', port: 443 });
    expect(parseConnectTarget('api.anthropic.com')).toBeNull();
  });

  it('confere usuário e senha', () => {
    const hash = hashPassword('s3nha');
    const basic = (cred: string) => `Basic ${Buffer.from(cred).toString('base64')}`;
    expect(checkProxyAuth(basic('donel-vps:s3nha'), 'donel-vps', hash)).toBe(true);
    expect(checkProxyAuth(basic('donel-vps:errada'), 'donel-vps', hash)).toBe(false);
    expect(checkProxyAuth(basic('outro:s3nha'), 'donel-vps', hash)).toBe(false);
    expect(checkProxyAuth(undefined, 'donel-vps', hash)).toBe(false);
  });

  it('sem o PC, o Claude da VPS não sai pelo IP da nuvem, nem com a config antiga "direto"', async () => {
    const log: Array<Record<string, unknown>> = [];
    const { server, health } = startVpsRelay(
      { modo: 'vps', porta: 0, upstream: { host: '127.0.0.1', porta: await closedPort(), usuario: 'donel-vps', senha: 'x' }, queda: 'direto', testeMs: 60_000 },
      (entry: Record<string, unknown>) => log.push(entry),
    );
    try {
      if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
      const { port } = server.address() as net.AddressInfo;
      // Direto daria 200 (com rede) ou 502 (sem rede); só a recusa prova que nada saiu pela nuvem.
      expect(await connectStatus(port, 'api.anthropic.com:443')).toMatch(/^HTTP\/1\.1 503/);
      expect(await connectStatus(port, 'claude.ai:443')).toMatch(/^HTTP\/1\.1 503/);
      expect(log.find((entry) => entry.evento === 'proxy-caiu')?.caminho).toBe('parado');
    } finally {
      health.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('sem o PC para, avisa uma vez e volta sozinho', async () => {
    const log: Array<Record<string, unknown>> = [];
    let pcUp = false;
    const health = createUpstreamHealth({
      log: (entry: Record<string, unknown>) => log.push(entry),
      probe: () => (pcUp ? Promise.resolve() : Promise.reject(new Error('ETIMEDOUT'))),
      probeMs: 5,
    });
    health.markDown('ETIMEDOUT');
    health.markDown('ETIMEDOUT');
    expect(health.usarProxy()).toBe(false);
    expect(log.map((e) => e.evento)).toEqual(['proxy-caiu']);
    pcUp = true;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(health.usarProxy()).toBe(true);
    expect(log.map((e) => e.evento)).toEqual(['proxy-caiu', 'proxy-voltou']);
    health.stop();
  });
});
