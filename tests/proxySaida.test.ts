// Proxy de saída das VPS (scripts/proxy-saida): o que vazaria sem o dono ver — o proxy do PC escutando fora
// da Tailscale ou abrindo túnel para qualquer destino, a senha aceita errada, e a VPS que não cai para o
// direto (ou não volta) quando o PC some.
import { describe, expect, it } from 'vitest';
import {
  assertTailnetBind,
  checkProxyAuth,
  createUpstreamHealth,
  hashPassword,
  isAllowed,
  parseConnectTarget,
} from '../scripts/proxy-saida/proxy-saida.mjs';

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

  it('sem o PC cai para o direto, avisa uma vez e volta sozinho', async () => {
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
