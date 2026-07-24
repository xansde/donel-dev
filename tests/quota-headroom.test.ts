import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeadroomCache, parseQuotaAxiHeadroom, readAllProfilesHeadroom, readQuotaAxiHeadroom, type QuotaAxiOutput } from '../src/main/quota-headroom';

// Mock de `node:child_process` — só pro bloco `readQuotaAxiHeadroom (I/O)`
// abaixo (fix rodada 4 item 8, parte a). `vi.mock` é hoisted pelo vitest
// pro topo do módulo automaticamente (mesmo espírito do jest) — a ordem
// textual com o `import { spawn }` acima não importa.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

/** Fake mínimo de `ChildProcess` — só o que `readQuotaAxiHeadroom` usa (`stdout`, `on('error'|'close')`, `kill`). */
class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly kill = vi.fn();
}

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

describe('readQuotaAxiHeadroom (I/O, spawn mockado) — fix rodada 4 item 8, parte a', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  // `resolveCli: () => null` força o fallback npx nestes 3 testes — mantém
  // a semântica original (spawn via npx) intacta enquanto o resolver de
  // binário é testado separadamente abaixo.
  it('REGRA DURA (achado real, evidência do Alexandre): exit code 255 do quota-axi com JSON válido no stdout ainda retorna o headroom — exit code NUNCA decide sucesso/falha, só o conteúdo', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readQuotaAxiHeadroom({ configDir: undefined, resolveCli: () => null });

    const payload: QuotaAxiOutput = {
      providers: [
        {
          provider: 'claude',
          windows: [{ id: 'five_hour', percentRemaining: 68 }], // percentUsed 32 no payload real reportado
          state: { status: 'fresh', stale: false },
        },
      ],
    };
    fake.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
    fake.emit('close', 255, null); // exit code real reportado — não documentado pelo quota-axi (SKILL.md só lista 0/1/2)

    await expect(promise).resolves.toBe(68);
  });

  it('exit code 0 mas stdout vazio/não-JSON continua null — validação é pelo CONTEÚDO, não pelo exit code (não é "exit 0 = sempre confia")', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readQuotaAxiHeadroom({ configDir: undefined, resolveCli: () => null });
    fake.stdout.emit('data', Buffer.from('não é json'));
    fake.emit('close', 0, null);

    await expect(promise).resolves.toBeNull();
  });

  it('exit code 255 com ruído (warning do wrapper npx) antes/depois do JSON — extrai o objeto balanceado em vez de desistir no primeiro JSON.parse', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readQuotaAxiHeadroom({ configDir: undefined, resolveCli: () => null });
    const payload: QuotaAxiOutput = {
      providers: [{ provider: 'claude', windows: [{ id: 'five_hour', percentRemaining: 41 }], state: { stale: false } }],
    };
    const noisy = `npm warn exec ruído antes\n${JSON.stringify(payload)}\nnpm warn algum aviso depois\n`;
    fake.stdout.emit('data', Buffer.from(noisy));
    fake.emit('close', 255, null);

    await expect(promise).resolves.toBe(41);
  });

  it('quando resolveCli retorna um path, spawna nodeExecPath+cliPath (não npx), sem shell:true, com ELECTRON_RUN_AS_NODE=1', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readQuotaAxiHeadroom({
      configDir: undefined,
      resolveCli: () => 'C:\\fake\\cli.js',
      nodeExecPath: 'C:\\fake\\node.exe',
    });

    const payload: QuotaAxiOutput = {
      providers: [{ provider: 'claude', windows: [{ id: 'five_hour', percentRemaining: 55 }], state: { stale: false } }],
    };
    fake.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
    fake.emit('close', 0, null);
    await expect(promise).resolves.toBe(55);

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe('C:\\fake\\node.exe');
    expect(call[1]).toEqual(['C:\\fake\\cli.js', '--provider', 'claude', '--json']);
    const spawnOptions = call[2] as { shell?: boolean; env?: NodeJS.ProcessEnv };
    expect(spawnOptions.shell).not.toBe(true);
    expect(spawnOptions.env?.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('quando resolveCli retorna null, spawna npx com shell:true (fallback)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readQuotaAxiHeadroom({ configDir: undefined, resolveCli: () => null });
    fake.stdout.emit('data', Buffer.from('{}'));
    fake.emit('close', 0, null);
    await promise;

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe('npx');
    expect(call[1]).toEqual(['-y', 'quota-axi', '--provider', 'claude', '--json']);
    const spawnOptions = call[2] as { shell?: boolean };
    expect(spawnOptions.shell).toBe(true);
  });

  describe('timeout (fake timers)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolve o número quando o child fecha ANTES do timeout', async () => {
      vi.useFakeTimers();
      const fake = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValue(fake as never);

      const promise = readQuotaAxiHeadroom({ configDir: undefined, resolveCli: () => null, timeoutMs: 8000 });
      const payload: QuotaAxiOutput = {
        providers: [{ provider: 'claude', windows: [{ id: 'five_hour', percentRemaining: 30 }], state: { stale: false } }],
      };
      fake.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
      fake.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(30);
    });

    it('mata o child (kill) e resolve null quando passa do timeout', async () => {
      vi.useFakeTimers();
      const fake = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValue(fake as never);

      const promise = readQuotaAxiHeadroom({ configDir: undefined, resolveCli: () => null, timeoutMs: 8000 });
      await vi.advanceTimersByTimeAsync(8001);

      await expect(promise).resolves.toBeNull();
      expect(fake.kill).toHaveBeenCalled();
    });
  });
});

describe('resolveQuotaAxiCli (puro, fs mockado)', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('acha o quota-axi no cache do npx e monta o path do dist/bin', async () => {
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      existsSync: (path: string) => {
        const normalized = path.replace(/\\/g, '/');
        if (normalized.endsWith('/npm-cache/_npx')) return true;
        if (normalized.endsWith('/dist/bin/quota-axi.js')) return normalized.includes('/abc123/');
        return false;
      },
      readdirSync: () => ['abc123'],
      statSync: () => ({ mtimeMs: 1000 }),
    }));

    const mod = await import('../src/main/quota-headroom');
    const result = mod.resolveQuotaAxiCli();
    expect(result).toContain('abc123');
    expect(result).toContain('quota-axi.js');
  });

  it('cache do npx vazio/inexistente -> null', async () => {
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      existsSync: () => false,
      readdirSync: () => [],
      statSync: () => ({ mtimeMs: 0 }),
    }));

    const mod = await import('../src/main/quota-headroom');
    expect(mod.resolveQuotaAxiCli()).toBeNull();
  });
});
