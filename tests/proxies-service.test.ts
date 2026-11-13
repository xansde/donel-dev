import { describe, expect, it } from 'vitest';
import { sanitizeProxiesConfig } from '../src/main/proxies/proxies-config';
import { createProxyService, proxyVaultKey, type ProxyMachine, type ProxyVault } from '../src/main/proxies/proxy-service';
import type { ProxiesConfig, ProxiesViewDto } from '../src/shared/proxies';

// Proxy da vez — o que quebraria sem o dono perceber: a chave de uma máquina indo para outra (o portal pareia uma por
// máquina), a chave vazando para a tela, a troca "em todas" parando na primeira falha, e o cadastro perdendo entradas
// ou trazendo de volta o lugar que o dono apagou.

const MACHINES: readonly ProxyMachine[] = [
  { id: 'local', label: 'Este computador', sshTarget: null },
  { id: 'vps', label: 'VPS', sshTarget: 'vps' },
  { id: 'hml', label: 'Homologações', sshTarget: 'hml' },
];

function memoryVault(): ProxyVault & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    available: () => true,
    read: (key) => store.get(key) ?? null,
    write: (key, value) => (store.set(key, value), true),
    delete: (key) => void store.delete(key),
  };
}

function setup(answers: Record<string, (program: string) => string | null>) {
  let config: ProxiesConfig = sanitizeProxiesConfig({
    seeded: true,
    entries: [
      { id: 'portal', label: 'Portal', kind: 'portal', baseUrl: 'https://portal.example/', machines: [] },
      { id: 'gateway', label: 'Gateway do PC', kind: 'gateway', baseUrl: 'http://pc.example:8317', machines: [] },
    ],
  });
  const vault = memoryVault();
  const sent: Array<{ machine: string; program: string }> = [];
  const views: ProxiesViewDto[] = [];
  const service = createProxyService({
    getConfig: () => config,
    setConfig: (next) => (config = next),
    machines: () => MACHINES,
    run: async (machine, program) => {
      sent.push({ machine: machine.id, program });
      return answers[machine.id]?.(program) ?? null;
    },
    vault,
    probe: async () => ({ up: true, httpStatus: 401, latencyMs: 10, error: null }),
    localClaudeDir: () => null,
    onChanged: (view) => views.push(view),
    onProxyDown: () => undefined,
  });
  return { service, vault, sent, views, config: () => config };
}

const reply = (out: object) => (program: string) => (program.includes('"op":"read"') ? JSON.stringify({ kind: 'ok', baseUrl: 'https://portal.example', donelProxyId: 'portal' }) : JSON.stringify(out));

describe('serviço do proxy da vez', () => {
  it('troca todas, uma por uma, com a chave de cada máquina, e segue depois de uma falha', async () => {
    const { service, vault, sent, views } = setup({
      local: reply({ kind: 'switched', from: 'http://pc.example:8317' }),
      vps: () => null,
      hml: reply({ kind: 'precheck-failed', httpStatus: 502 }),
    });
    expect(service.setKey('portal', 'local', 'sk-local-key-000001')).toEqual({ kind: 'ok' });
    expect(service.setKey('portal', 'vps', 'sk-vps-key-0000002')).toEqual({ kind: 'ok' });
    expect(service.setKey('portal', 'hml', 'sk-hml-key-0000003')).toEqual({ kind: 'ok' });

    const outcomes = await service.switchAll('portal');
    expect(outcomes).toEqual([
      { kind: 'switched', machineId: 'local', from: 'gateway', to: 'portal' },
      { kind: 'failed', machineId: 'vps', reason: 'unreachable' },
      { kind: 'failed', machineId: 'hml', reason: 'precheck-failed', httpStatus: 502 },
    ]);

    const switches = sent.filter((s) => s.program.includes('"op":"switch"'));
    expect(switches.map((s) => s.machine)).toEqual(['local', 'vps', 'hml']);
    for (const s of switches) {
      const own = vault.store.get(proxyVaultKey('portal', s.machine))!;
      expect(s.program).toContain(own);
      for (const [key, value] of vault.store) if (key !== proxyVaultKey('portal', s.machine)) expect(s.program).not.toContain(value);
    }
    const shown = JSON.stringify(views);
    for (const value of vault.store.values()) expect(shown).not.toContain(value);
  });

  it('só oferece à máquina o proxy que tem endereço, chave dela e é permitido nela', async () => {
    const { service } = setup({});
    service.setKey('gateway', 'vps', 'sk-vps-gateway-0001');
    service.upsert({ id: 'portal', label: 'Portal', kind: 'portal', baseUrl: 'https://portal.example', machines: ['local'] });
    service.setKey('portal', 'vps', 'sk-vps-portal-00001');
    const vps = service.view().machines.find((m) => m.id === 'vps')!;
    expect(vps.choices).toEqual(['gateway']);
    expect(await service.switchMachine('vps', 'portal')).toEqual({ kind: 'failed', machineId: 'vps', reason: 'not-allowed' });
    expect(await service.switchMachine('local', 'gateway')).toEqual({ kind: 'failed', machineId: 'local', reason: 'no-key' });
  });

  it('apagar um proxy apaga as chaves dele no cofre e deixa as outras', () => {
    const { service, vault, config } = setup({});
    service.setKey('portal', 'vps', 'sk-vps-portal-00001');
    service.setKey('gateway', 'vps', 'sk-vps-gateway-0001');
    service.remove('portal');
    expect([...vault.store.keys()]).toEqual([proxyVaultKey('gateway', 'vps')]);
    expect(config().entries.map((entry) => entry.id)).toEqual(['gateway']);
  });
});

describe('chave de proxy com endereço novo', () => {
  it('mudar o endereço de um proxy apaga as chaves dele (eram do endereço antigo); mudar só o nome as mantém', () => {
    const { service, vault } = setup({});
    service.setKey('portal', 'vps', 'sk-vps-portal-00001');
    service.upsert({ id: 'portal', label: 'Portal novo nome', kind: 'portal', baseUrl: 'https://portal.example' });
    expect(vault.store.has(proxyVaultKey('portal', 'vps'))).toBe(true);
    service.upsert({ id: 'portal', label: 'Portal', kind: 'portal', baseUrl: 'https://outro-portal.example' });
    expect(vault.store.has(proxyVaultKey('portal', 'vps'))).toBe(false);
  });
});

describe('config proxies', () => {
  it('descarta só a entrada ruim e traz o lugar "Outro PC" uma vez só', () => {
    const first = sanitizeProxiesConfig({ entries: [{ id: 'ok', label: 'Ok', kind: 'portal', baseUrl: 'https://a.example' }, { id: 'Ruim!', label: 'x', kind: 'portal' }] });
    expect(first.entries.map((entry) => [entry.id, entry.baseUrl])).toEqual([
      ['ok', 'https://a.example'],
      ['outro-pc', null],
    ]);
    const afterRemoval = sanitizeProxiesConfig({ ...first, entries: first.entries.filter((entry) => entry.id !== 'outro-pc') });
    expect(afterRemoval.entries.map((entry) => entry.id)).toEqual(['ok']);
    expect(sanitizeProxiesConfig('lixo').entries.map((entry) => entry.id)).toEqual(['outro-pc']);
  });
});
