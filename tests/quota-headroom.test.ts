import { describe, expect, it, vi } from 'vitest';
import { HeadroomCache, parseQuotaAxiHeadroom, readAllProfilesHeadroom, type QuotaAxiOutput } from '../src/main/quota-headroom';

// T014 — FR-012 (headroom por perfil via quota-axi). `parseQuotaAxiHeadroom`
// é a peça mais crítica (achado desta task: cache global do quota-axi pode
// devolver números de OUTRO perfil — ver comentário de topo do módulo) e a
// única testada contra o payload real (colado do `npx -y quota-axi
// --provider claude --json` rodado manualmente durante a task). Orquestração
// (paralelo/timeout/cache) testada com um `reader` fake — nunca spawna
// processo real em teste unitário.

const REAL_PAYLOAD_SHAPE: QuotaAxiOutput = {
  providers: [
    {
      provider: 'claude',
      windows: [
        { id: 'five_hour', kind: 'session', percentRemaining: 83 },
        { id: 'seven_day', kind: 'weekly', percentRemaining: 14 },
        { id: 'model:fable', kind: 'model', percentRemaining: 48 },
      ],
      state: { status: 'fresh', stale: false },
    },
  ],
};

describe('parseQuotaAxiHeadroom (puro)', () => {
  it('usa a janela de sessão (five_hour) como headroom principal', () => {
    expect(parseQuotaAxiHeadroom(REAL_PAYLOAD_SHAPE)).toBe(83);
  });

  it('cai pra semanal (seven_day) quando five_hour não vem no payload', () => {
    const output: QuotaAxiOutput = {
      providers: [{ provider: 'claude', windows: [{ id: 'seven_day', percentRemaining: 54 }], state: { stale: false } }],
    };
    expect(parseQuotaAxiHeadroom(output)).toBe(54);
  });

  it('null quando nenhuma janela conhecida vem no payload', () => {
    const output: QuotaAxiOutput = { providers: [{ provider: 'claude', windows: [{ id: 'extra_usage', percentRemaining: 97 }], state: {} }] };
    expect(parseQuotaAxiHeadroom(output)).toBeNull();
  });

  it('null quando não há provider claude no payload', () => {
    expect(parseQuotaAxiHeadroom({ providers: [] })).toBeNull();
    expect(parseQuotaAxiHeadroom(null)).toBeNull();
    expect(parseQuotaAxiHeadroom(undefined)).toBeNull();
  });

  it('REGRA DURA (gotcha desta task): state.stale=true vira null mesmo com windows populado — o cache global do quota-axi pode devolver números de OUTRO perfil', () => {
    const output: QuotaAxiOutput = {
      providers: [
        {
          provider: 'claude',
          windows: [{ id: 'five_hour', percentRemaining: 67 }], // números REAIS de outro perfil, vindos do cache
          state: { status: 'stale', stale: true, error: 'Claude sign-in required' },
        },
      ],
    };
    expect(parseQuotaAxiHeadroom(output)).toBeNull();
  });

  it('REGRA DURA: state.error presente vira null mesmo sem stale=true explícito', () => {
    const output: QuotaAxiOutput = {
      providers: [{ provider: 'claude', windows: [{ id: 'five_hour', percentRemaining: 50 }], state: { error: 'algum erro' } }],
    };
    expect(parseQuotaAxiHeadroom(output)).toBeNull();
  });

  it('arredonda pro inteiro mais próximo', () => {
    const output: QuotaAxiOutput = { providers: [{ provider: 'claude', windows: [{ id: 'five_hour', percentRemaining: 82.6 }], state: {} }] };
    expect(parseQuotaAxiHeadroom(output)).toBe(83);
  });
});

describe('HeadroomCache (puro, now() injetável)', () => {
  it('devolve undefined pra slug nunca lido', () => {
    const cache = new HeadroomCache(() => 0);
    expect(cache.get('conta-b')).toBeUndefined();
  });

  it('devolve o valor cacheado dentro dos 60s de TTL (FR-012)', () => {
    let now = 0;
    const cache = new HeadroomCache(() => now);
    cache.set('conta-b', 42);
    now = 59_000;
    expect(cache.get('conta-b')).toBe(42);
  });

  it('expira depois de 60s (undefined de novo)', () => {
    let now = 0;
    const cache = new HeadroomCache(() => now);
    cache.set('conta-b', 42);
    now = 60_001;
    expect(cache.get('conta-b')).toBeUndefined();
  });

  it('cacheia null também (perfil sem leitura confiável não é reconsultado a cada 60s)', () => {
    let now = 0;
    const cache = new HeadroomCache(() => now);
    cache.set('conta-b', null);
    expect(cache.get('conta-b')).toBeNull();
  });
});

describe('readAllProfilesHeadroom (orquestração, reader fake)', () => {
  it('lê os perfis em PARALELO (Promise.all — não serializado)', async () => {
    const cache = new HeadroomCache();
    const callOrder: string[] = [];
    const reader = vi.fn(async ({ configDir }: { configDir: string | undefined }) => {
      callOrder.push(`start:${configDir ?? 'principal'}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      callOrder.push(`end:${configDir ?? 'principal'}`);
      return 50;
    });

    const result = await readAllProfilesHeadroom(
      [
        { slug: 'principal', configDir: undefined },
        { slug: 'conta-b', configDir: 'C:\\perfil-b' },
      ],
      cache,
      reader,
    );

    expect(result).toEqual({ principal: 50, 'conta-b': 50 });
    // Se fosse sequencial, o 2º "start" só apareceria depois do 1º "end".
    expect(callOrder.indexOf('start:conta-b')).toBeLessThan(callOrder.indexOf('end:principal'));
  });

  it('usa o cache quando disponível, sem chamar o reader de novo', async () => {
    const cache = new HeadroomCache();
    cache.set('conta-b', 77);
    const reader = vi.fn(async () => 999);

    const result = await readAllProfilesHeadroom([{ slug: 'conta-b', configDir: 'C:\\perfil-b' }], cache, reader);

    expect(result).toEqual({ 'conta-b': 77 });
    expect(reader).not.toHaveBeenCalled();
  });

  it('um perfil falhando (reader resolve null) não impede os outros de aparecerem com valor', async () => {
    const cache = new HeadroomCache();
    const reader = vi.fn(async ({ configDir }: { configDir: string | undefined }) => (configDir === 'C:\\quebrado' ? null : 88));

    const result = await readAllProfilesHeadroom(
      [
        { slug: 'ok', configDir: 'C:\\ok' },
        { slug: 'quebrado', configDir: 'C:\\quebrado' },
      ],
      cache,
      reader,
    );

    expect(result).toEqual({ ok: 88, quebrado: null });
  });
});
