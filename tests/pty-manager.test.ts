import { describe, expect, it } from 'vitest';
import { buildPtyEnv, buildSpawnFailureMessage } from '../src/main/pty-manager';

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
  // T017 (014-chat, FR-030/R17)
  it('acrescenta CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 como garantia de gravação do transcript', () => {
    expect(buildPtyEnv({ PATH: 'C:\\bin' }, undefined).CLAUDE_CODE_FORCE_SESSION_PERSISTENCE).toBe('1');
  });

  it('remove as variáveis de ponte/mensageria herdadas de uma sessão-mãe', () => {
    const env = buildPtyEnv(
      {
        PATH: 'C:\\bin',
        CLAUDE_CODE_BRIDGE_SESSION_ID: 'bridge-1',
        CLAUDE_CODE_MESSAGING_SOCKET: 'pipe-x',
        CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
      },
      undefined,
    );
    expect('CLAUDE_CODE_BRIDGE_SESSION_ID' in env).toBe(false);
    expect('CLAUDE_CODE_MESSAGING_SOCKET' in env).toBe(false);
    expect('CLAUDE_CODE_MESSAGING_TOKEN' in env).toBe(false);
  });

  it('NO_PROXY: cria com 127.0.0.1,localhost quando ausente e acrescenta quando já existe', () => {
    expect(buildPtyEnv({ PATH: 'C:\\bin' }, undefined).NO_PROXY).toBe('127.0.0.1,localhost');
    expect(buildPtyEnv({ NO_PROXY: 'corp.local' }, undefined).NO_PROXY).toBe('corp.local,127.0.0.1,localhost');
    expect(buildPtyEnv({ NO_PROXY: 'localhost,corp.local' }, undefined).NO_PROXY).toBe('localhost,corp.local,127.0.0.1');
  });

  it('NO_PROXY: respeita a grafia minúscula herdada (no_proxy) sem duplicar a chave', () => {
    const env = buildPtyEnv({ no_proxy: 'corp.local' }, undefined);
    expect(env.no_proxy).toBe('corp.local,127.0.0.1,localhost');
    expect('NO_PROXY' in env).toBe(false);
  });

  it('mantém o overlay do provedor por cima e não varre CLAUDE_*', () => {
    const env = buildPtyEnv(
      { PATH: 'C:\\bin', CLAUDE_CUSTOM_THING: 'keep', CLAUDE_CODE_MESSAGING_TOKEN: 'x' },
      undefined,
      { ANTHROPIC_BASE_URL: 'https://x.test', CLAUDE_CODE_MESSAGING_TOKEN: 'overlay-cannot-bring-it-back' },
    );
    expect(env.ANTHROPIC_BASE_URL).toBe('https://x.test');
    expect(env.CLAUDE_CUSTOM_THING).toBe('keep');
    expect('CLAUDE_CODE_MESSAGING_TOKEN' in env).toBe(false);
    expect(env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE).toBe('1');
  });

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
    expect(withoutThirdArg).toEqual({
      PATH: 'C:\\bin',
      USERNAME: 'x',
      CLAUDE_CONFIG_DIR: 'C:\\perfil\\.claude',
      // T018 (014-chat): acréscimos fixos do ambiente da PTY.
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      NO_PROXY: '127.0.0.1,localhost',
    });
  });
});

// FIX ambiente genérico (28/07, teste do colega) — spawn que falha precisa
// virar mensagem acionável, nunca exceção crua do node-pty atravessando o
// IPC. O caso com PTY real ('comando inexistente') está em
// `pty-manager.spawn.test.ts`.
describe('PtyManager — falha de spawn vira mensagem acionável', () => {
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
