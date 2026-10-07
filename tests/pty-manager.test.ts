import { describe, expect, it } from 'vitest';
import { buildPtyEnv, buildSpawnFailureMessage, PtyManager } from '../src/main/pty-manager';

// T005 — caso (c) do dossiê de verificação: um processo que sai rápido deve
// disparar `onExit` (é o mesmo sinal que o TerminalPane usa pra mostrar o
// estado "sessão encerrada", FR-006). Usa `cmd.exe /c exit` como dummy —
// não precisa abrir uma sessão claude real pra validar o mecanismo de saída
// do PtyManager, que é agnóstico ao comando spawnado.

describe('PtyManager — ciclo de vida de um processo que sai sozinho', () => {
  it('dispara onExit quando o processo dummy termina (cmd.exe /c exit)', async () => {
    const manager = new PtyManager();

    const exitPromise = new Promise<{ ptyId: string; exitCode: number }>((resolve) => {
      manager.onExit((ptyId, exitCode) => resolve({ ptyId, exitCode }));
    });

    const ptyId = manager.create({ cols: 80, rows: 24, command: 'cmd.exe', args: ['/c', 'exit'] });

    const result = await exitPromise;

    expect(result.ptyId).toBe(ptyId);
    expect(result.exitCode).toBe(0);
  });

  it('spawna o comando/args default (terminal livre, PowerShell) quando command/args são omitidos', async () => {
    // Ciclo de correção 1 (auditoria batch 2) — antes só afirmava que o id
    // era string e que não lançava (smoke fraco). Agora exercita o caminho
    // default de verdade (sem passar command/args) e afirma um sinal
    // observável: o eco de um marcador único chega pelo onData, provando que
    // o PowerShell default foi spawnado e está processando input real.
    const manager = new PtyManager();
    const marker = 'donel-default-shell-probe';

    const dataPromise = new Promise<string>((resolve) => {
      let collected = '';
      manager.onData((_ptyId, data) => {
        collected += data;
        if (collected.includes(marker)) resolve(collected);
      });
    });

    const ptyId = manager.create({ cols: 80, rows: 24 });
    manager.input(ptyId, `echo ${marker}\r`);

    const collected = await dataPromise;
    expect(collected).toContain(marker);

    manager.kill(ptyId);
    // Teto explícito: este teste spawna um PowerShell DE VERDADE, com o profile
    // do usuário. O default de 5 s do vitest não é uma régua do produto — é o
    // default — e a suíte roda os arquivos em paralelo, então o spawn compete
    // por CPU com os outros workers. Medido nesta máquina: mediana 1,8 s e pico
    // 3,2 s isolado; dentro da suíte cheia estourou os 5 s (5328 ms). O input
    // nunca se perdeu em 8 sondagens de 30 s — é latência de cauda, não race.
  }, 20_000);
});

// T014 (FR-005/CA-3) — env efetivo do PTY quando uma aba nasce sob um perfil
// não-Principal. Puro — sem tocar node-pty/filesystem real.
describe('buildPtyEnv (puro)', () => {
  it('seta CLAUDE_CONFIG_DIR quando um perfil é informado', () => {
    const env = buildPtyEnv({ PATH: 'C:\\bin', USERNAME: 'x' }, 'C:\\Users\\x\\.claude-profiles\\conta-b');
    expect(env.CLAUDE_CONFIG_DIR).toBe('C:\\Users\\x\\.claude-profiles\\conta-b');
    expect(env.PATH).toBe('C:\\bin'); // resto do env preservado (plan.md ponto 2 — nunca sobrescrever PATH)
  });

  it('remove CLAUDE_CONFIG_DIR quando nenhum perfil é informado (Principal) — mesmo que já viesse setado no baseEnv', () => {
    const env = buildPtyEnv({ PATH: 'C:\\bin', CLAUDE_CONFIG_DIR: 'C:\\vazamento-de-outro-perfil' }, undefined);
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.PATH).toBe('C:\\bin');
  });

  it('ignora entradas do baseEnv com valor undefined (Record<string,string> de saída nunca tem undefined)', () => {
    const env = buildPtyEnv({ PATH: 'C:\\bin', SOME_UNSET: undefined }, undefined);
    expect('SOME_UNSET' in env).toBe(false);
  });

  // Achado do teste manual (27/07): app lançado de dentro de uma sessão do
  // Claude Code herda os marcadores de sessão-mãe e o CLI dentro do app abre
  // como "sessão filha" (transcript saving off, permission mode herdado). As
  // sessões que o app cria são sempre sessões RAIZ — os marcadores nunca
  // podem vazar do ambiente que lançou o app.
  it('remove os marcadores de sessão-mãe do Claude Code herdados do ambiente que lançou o app', () => {
    const env = buildPtyEnv(
      {
        PATH: 'C:\\bin',
        CLAUDECODE: '1',
        CLAUDE_CODE_CHILD_SESSION: 'marker',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_SSE_PORT: '12345',
      },
      undefined,
    );
    expect('CLAUDECODE' in env).toBe(false);
    expect('CLAUDE_CODE_CHILD_SESSION' in env).toBe(false);
    expect('CLAUDE_CODE_ENTRYPOINT' in env).toBe(false);
    expect('CLAUDE_CODE_SSE_PORT' in env).toBe(false);
    expect(env.PATH).toBe('C:\\bin');
  });
});

// T1314 (011-contas-e-provedores, etapa 3) — `buildPtyEnv` ganha o 2º
// parâmetro `envOverrides` (env do provider, já resolvido por
// `buildProviderEnv`). Regressão byte a byte: sem overrides, a saída é
// IDÊNTICA à de hoje (os testes acima continuam passando sem alteração,
// porque a chamada de 2 args é só o caso `envOverrides === undefined`).
describe('buildPtyEnv (puro) — envOverrides (T1314)', () => {
  it('overrides são aplicados sobre o env base', () => {
    const env = buildPtyEnv({ PATH: 'C:\\bin' }, undefined, { ANTHROPIC_BASE_URL: 'https://provider.test', ANTHROPIC_AUTH_TOKEN: 'segredo' });
    expect(env.PATH).toBe('C:\\bin');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://provider.test');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('segredo');
  });

  it('override tentando setar CLAUDE_CONFIG_DIR é ignorado — só o parâmetro próprio governa essa chave', () => {
    const env = buildPtyEnv({ PATH: 'C:\\bin' }, 'C:\\perfil-legitimo\\.claude', { CLAUDE_CONFIG_DIR: 'C:\\hack-do-provider' });
    expect(env.CLAUDE_CONFIG_DIR).toBe('C:\\perfil-legitimo\\.claude');
  });

  it('override tentando setar CLAUDE_CONFIG_DIR sem claudeConfigDir próprio também não vaza (chave continua ausente)', () => {
    const env = buildPtyEnv({ PATH: 'C:\\bin' }, undefined, { CLAUDE_CONFIG_DIR: 'C:\\hack-do-provider' });
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('marcadores de sessão-filha continuam removidos mesmo com overrides presentes', () => {
    const env = buildPtyEnv({ PATH: 'C:\\bin', CLAUDECODE: '1' }, undefined, { ANTHROPIC_BASE_URL: 'https://provider.test' });
    expect('CLAUDECODE' in env).toBe(false);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://provider.test');
  });

  it('sem overrides (2 args, chamada de hoje), a saída é idêntica à de sempre — regressão byte a byte', () => {
    const withoutThirdArg = buildPtyEnv({ PATH: 'C:\\bin', USERNAME: 'x' }, 'C:\\perfil\\.claude');
    const withUndefinedThirdArg = buildPtyEnv({ PATH: 'C:\\bin', USERNAME: 'x' }, 'C:\\perfil\\.claude', undefined);
    expect(withoutThirdArg).toEqual(withUndefinedThirdArg);
    expect(withoutThirdArg).toEqual({ PATH: 'C:\\bin', USERNAME: 'x', CLAUDE_CONFIG_DIR: 'C:\\perfil\\.claude' });
  });
});

// T014 — integração: `PtyManager.create` aplica `claudeConfigDir` no env real do processo spawnado (não só na função pura `buildPtyEnv` isolada).
describe('PtyManager — claudeConfigDir chega no processo spawnado (FR-005/CA-3)', () => {
  it('a variável CLAUDE_CONFIG_DIR aparece no ambiente real do PTY quando claudeConfigDir é passado', async () => {
    const manager = new PtyManager();
    const dataPromise = new Promise<string>((resolve) => {
      let collected = '';
      manager.onData((_ptyId, data) => {
        collected += data;
        if (collected.includes('DONEL_PROFILE_MARKER_END')) resolve(collected);
      });
    });

    const ptyId = manager.create({
      cols: 80,
      rows: 24,
      command: 'cmd.exe',
      args: ['/c', 'echo %CLAUDE_CONFIG_DIR% & echo DONEL_PROFILE_MARKER_END'],
      claudeConfigDir: 'C:\\Users\\fake-user\\.claude-profiles\\conta-b',
    });

    const collected = await dataPromise;
    expect(collected).toContain('C:\\Users\\fake-user\\.claude-profiles\\conta-b');

    manager.kill(ptyId);
  });
});

// FIX ambiente genérico (28/07, teste do colega) — spawn que falha precisa
// virar mensagem acionável, nunca exceção crua do node-pty atravessando o
// IPC (a aba nascia morta sem explicação na máquina dele).
describe('PtyManager — falha de spawn vira mensagem acionável', () => {
  it('comando inexistente lança com o comando no texto e a dica do node-pty', () => {
    const manager = new PtyManager();

    let thrown: unknown = null;
    try {
      manager.create({ cols: 80, rows: 24, command: 'Z:\\nao-existe\\claude-fantasma.exe', args: [] });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('não consegui iniciar');
    expect(message).toContain('claude-fantasma.exe');
    expect(message).toContain('node-pty');
  });

  it('buildSpawnFailureMessage inclui comando, cwd e as duas dicas de diagnóstico', () => {
    const message = buildSpawnFailureMessage('C:\\npm\\claude.cmd', 'C:\\repo', new Error('File not found'));

    expect(message).toContain('C:\\npm\\claude.cmd');
    expect(message).toContain('C:\\repo');
    expect(message).toContain('File not found');
    expect(message).toContain('node-pty');
  });

  it('buildSpawnFailureMessage sem cwd omite o parêntese e nunca lança com erro não-Error', () => {
    const message = buildSpawnFailureMessage('cmd.exe', undefined, 'string crua');

    expect(message).not.toContain('pasta de trabalho:');
    expect(message).toContain('string crua');
  });
});
