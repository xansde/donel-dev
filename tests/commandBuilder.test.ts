// T006 — CommandBuilder (TDD)
//
// Tests written before the implementation. Cover every row of the FR-003
// table (spec.md), the "flag omitted when control is empty" rule, and the
// `-n` escaping gotcha called out in plan.md point 3: `buildClaudeArgs`
// returns a plain argv array (no shell involved — node-pty/ConPTY spawns the
// process directly), so a value must NEVER be wrapped in literal quote
// characters. The `-n "<nome>"` notation in the FR-003 table and in CA-1 is
// just human-readable shorthand for "the flag followed by the value as one
// argv token" — adding real quote chars would corrupt the session name.
import { describe, expect, it } from 'vitest';
import {
  buildClaudeArgs,
  mcpDeliveryFor,
  APP_MCP_PREAUTHORIZED_TOOLS,
  parseModelEffortFromArgs,
  resolvePermissionMode,
  withResolvedPermissionMode,
  type BuildClaudeArgsOptions,
} from '../src/shared/commandBuilder';

describe('buildClaudeArgs', () => {
  it('returns an empty argv when no option is provided (all flags omitted, CLI uses user default)', () => {
    expect(buildClaudeArgs()).toEqual([]);
    expect(buildClaudeArgs({})).toEqual([]);
  });

  describe('Modelo — --model <alias>', () => {
    (['fable', 'opus', 'sonnet', 'haiku'] as const).forEach((alias) => {
      it(`maps model=${alias} to --model ${alias}`, () => {
        expect(buildClaudeArgs({ model: alias })).toEqual(['--model', alias]);
      });
    });

    it('omits --model when not provided', () => {
      expect(buildClaudeArgs({ effort: 'high' })).not.toContain('--model');
    });
  });

  describe('Esforço — --effort <low|medium|high|xhigh|max>', () => {
    (['low', 'medium', 'high', 'xhigh', 'max'] as const).forEach((level) => {
      it(`maps effort=${level} to --effort ${level}`, () => {
        expect(buildClaudeArgs({ effort: level })).toEqual(['--effort', level]);
      });
    });

    it('omits --effort when not provided', () => {
      expect(buildClaudeArgs({ model: 'sonnet' })).not.toContain('--effort');
    });
  });

  describe('Permissões — --permission-mode <manual|acceptEdits|auto|plan|dontAsk|bypassPermissions>', () => {
    (
      ['manual', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'] as const
    ).forEach((mode) => {
      it(`maps permissionMode=${mode} to --permission-mode ${mode}`, () => {
        expect(buildClaudeArgs({ permissionMode: mode })).toEqual(['--permission-mode', mode]);
      });
    });

    it('omits --permission-mode when not provided', () => {
      expect(buildClaudeArgs({ model: 'sonnet' })).not.toContain('--permission-mode');
    });
  });

  describe('Nome da sessão — -n "<nome>"', () => {
    it('maps sessionName to -n <nome> as two separate argv tokens', () => {
      expect(buildClaudeArgs({ sessionName: 'radar' })).toEqual(['-n', 'radar']);
    });

    it('omits -n when sessionName is empty (ui-spec §4: nome vazio = ok, flag omitida)', () => {
      expect(buildClaudeArgs({ sessionName: '' })).toEqual([]);
    });

    it('omits -n when sessionName is not provided', () => {
      expect(buildClaudeArgs({ model: 'sonnet' })).not.toContain('-n');
    });

    it('gotcha: does NOT wrap a session name with spaces in literal quote characters', () => {
      const args = buildClaudeArgs({ sessionName: 'minha sessão de teste' });
      expect(args).toEqual(['-n', 'minha sessão de teste']);
      // The value must be a single argv token with no embedded quote chars —
      // node-pty/ConPTY does its own low-level quoting from the array; a
      // manually-added quote would show up literally inside the CLI's -n value.
      expect(args[1]).not.toMatch(/["']/);
    });

    it('gotcha: passes special shell characters through untouched (no shell involved, argv array is safe by construction)', () => {
      const dangerous = 'nome; rm -rf / && echo $HOME `whoami`';
      const args = buildClaudeArgs({ sessionName: dangerous });
      expect(args).toEqual(['-n', dangerous]);
    });
  });

  describe('Retomar — -r <session-id>', () => {
    it('maps a resume continuation to -r <session-id>', () => {
      const opts: BuildClaudeArgsOptions = {
        continuation: { type: 'resume', sessionId: 'abc-123' },
      };
      expect(buildClaudeArgs(opts)).toEqual(['-r', 'abc-123']);
    });
  });

  describe('Fork — -r <session-id> --fork-session', () => {
    it('maps a fork continuation to -r <session-id> --fork-session', () => {
      const opts: BuildClaudeArgsOptions = {
        continuation: { type: 'fork', sessionId: 'abc-123' },
      };
      expect(buildClaudeArgs(opts)).toEqual(['-r', 'abc-123', '--fork-session']);
    });
  });

  describe('Continuar última — -c', () => {
    it('maps a continueLast continuation to -c', () => {
      const opts: BuildClaudeArgsOptions = { continuation: { type: 'continueLast' } };
      expect(buildClaudeArgs(opts)).toEqual(['-c']);
    });
  });

  describe('Claude in Chrome removido (03/11) — o navegador é o integrado do app', () => {
    it('never emits --chrome, even if an old caller still passes `chrome`', () => {
      const legacy = { model: 'sonnet', chrome: true } as unknown as BuildClaudeArgsOptions;
      const args = buildClaudeArgs(legacy);
      expect(args).toEqual(['--model', 'sonnet']);
      expect(args).not.toContain('--chrome');
      expect(args).not.toContain('--no-chrome');
    });
  });

  describe('Isolar em worktree — --worktree <nome>', () => {
    it('maps worktree to --worktree <name> as two tokens, no quotes', () => {
      expect(buildClaudeArgs({ worktree: 'radar-1030-1752' })).toEqual(['--worktree', 'radar-1030-1752']);
    });

    it('omits --worktree when absent or empty', () => {
      expect(buildClaudeArgs({})).not.toContain('--worktree');
      expect(buildClaudeArgs({ worktree: '' })).not.toContain('--worktree');
    });

    it('comes last, keeping the existing argv order stable', () => {
      expect(
        buildClaudeArgs({ model: 'fable', effort: 'high', permissionMode: 'acceptEdits', sessionName: 'radar', worktree: 'radar-1030-1752' }),
      ).toEqual(['--model', 'fable', '--effort', 'high', '--permission-mode', 'acceptEdits', '-n', 'radar', '--worktree', 'radar-1030-1752']);
    });
  });

  it('omits every continuation flag when continuation is not provided', () => {
    const args = buildClaudeArgs({ model: 'sonnet' });
    expect(args).not.toContain('-r');
    expect(args).not.toContain('-c');
    expect(args).not.toContain('--fork-session');
  });

  describe('cenários combinados (ordem estável, tabela FR-003)', () => {
    it('CA-1 (spec.md): modelo=sonnet, esforço=high, permissões=acceptEdits, nome=radar', () => {
      const args = buildClaudeArgs({
        model: 'sonnet',
        effort: 'high',
        permissionMode: 'acceptEdits',
        sessionName: 'radar',
      });
      expect(args).toEqual([
        '--model',
        'sonnet',
        '--effort',
        'high',
        '--permission-mode',
        'acceptEdits',
        '-n',
        'radar',
      ]);
    });

    it('CA-2 (spec.md): retomar sessão por id → -r <id>', () => {
      const args = buildClaudeArgs({
        continuation: { type: 'resume', sessionId: 'a1b2c3' },
      });
      expect(args).toEqual(['-r', 'a1b2c3']);
    });

    it('combina todas as flags mantendo a ordem da tabela FR-003', () => {
      const args = buildClaudeArgs({
        model: 'opus',
        effort: 'xhigh',
        permissionMode: 'plan',
        sessionName: 'sessao completa',
        continuation: { type: 'fork', sessionId: 'zzz-999' },
      });
      expect(args).toEqual([
        '--model',
        'opus',
        '--effort',
        'xhigh',
        '--permission-mode',
        'plan',
        '-n',
        'sessao completa',
        '-r',
        'zzz-999',
        '--fork-session',
      ]);
    });
  });

  describe('parseModelEffortFromArgs (T011 — inverso de --model/--effort, pra semear o valor inicial da SessionDetails)', () => {
    it('extrai model e effort de um argv com os dois presentes', () => {
      expect(parseModelEffortFromArgs(['--model', 'sonnet', '--effort', 'high'])).toEqual({
        model: 'sonnet',
        effort: 'high',
      });
    });

    it('extrai só o model quando --effort não está no argv', () => {
      expect(parseModelEffortFromArgs(['--model', 'opus'])).toEqual({ model: 'opus' });
    });

    it('extrai só o effort quando --model não está no argv', () => {
      expect(parseModelEffortFromArgs(['--effort', 'xhigh'])).toEqual({ effort: 'xhigh' });
    });

    it('devolve objeto vazio pra argv undefined (aba aberta sem Launcher, ex. clique direto na sidebar)', () => {
      expect(parseModelEffortFromArgs(undefined)).toEqual({});
    });

    it('devolve objeto vazio pra argv vazio', () => {
      expect(parseModelEffortFromArgs([])).toEqual({});
    });

    it('ignora --model/--effort com valor desconhecido (argv corrompido/futuro) em vez de propagar lixo pro tipo', () => {
      expect(parseModelEffortFromArgs(['--model', 'gpt5', '--effort', 'ludicrous'])).toEqual({});
    });

    it('encontra as flags em qualquer posição do argv (ordem real: CA-1 tem --model antes de --effort, mas não é garantido)', () => {
      expect(parseModelEffortFromArgs(['-n', 'radar', '--effort', 'low', '--permission-mode', 'plan', '--model', 'haiku'])).toEqual({
        model: 'haiku',
        effort: 'low',
      });
    });

    it('ignora uma flag --model/--effort no fim do array sem valor seguinte (argv truncado)', () => {
      expect(parseModelEffortFromArgs(['--model'])).toEqual({});
    });
  });

  describe('pureza (sem I/O, sem mutação)', () => {
    it('não muta o objeto de opções recebido', () => {
      const opts: BuildClaudeArgsOptions = Object.freeze({
        model: 'sonnet',
        effort: 'low',
        sessionName: 'imutavel',
      });
      expect(() => buildClaudeArgs(opts)).not.toThrow();
    });

    it('é determinística: mesma entrada produz a mesma saída (novo array a cada chamada)', () => {
      const opts: BuildClaudeArgsOptions = { model: 'haiku', effort: 'medium' };
      const first = buildClaudeArgs(opts);
      const second = buildClaudeArgs(opts);
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    });
  });
});

// T017 (014-chat, FR-030/R17) — modo de permissão explícito em todo spawn de sessão.
describe('resolvePermissionMode', () => {
  it('launcher (argv já tem --permission-mode) vence o padrão do usuário', () => {
    expect(resolvePermissionMode(['--model', 'opus', '--permission-mode', 'plan'], 'acceptEdits')).toBe('plan');
    expect(resolvePermissionMode(['--permission-mode=auto'], 'plan')).toBe('auto');
  });

  it('sem launcher: padrão do usuário; sem nada: default', () => {
    expect(resolvePermissionMode([], 'acceptEdits')).toBe('acceptEdits');
    expect(resolvePermissionMode(['--model', 'opus'], undefined)).toBe('default');
  });

  it('padrão do usuário inválido cai em default', () => {
    expect(resolvePermissionMode([], 'banana')).toBe('default');
    expect(resolvePermissionMode([], '')).toBe('default');
  });
});

describe('withResolvedPermissionMode', () => {
  it('acrescenta --permission-mode <resolvido> quando o argv não tem', () => {
    expect(withResolvedPermissionMode(['-r', 'abc'], 'plan')).toEqual(['-r', 'abc', '--permission-mode', 'plan']);
    expect(withResolvedPermissionMode([], undefined)).toEqual(['--permission-mode', 'default']);
  });

  it('não altera o argv quando já tem --permission-mode (nem a forma com =)', () => {
    expect(withResolvedPermissionMode(['--permission-mode', 'auto'], 'plan')).toEqual(['--permission-mode', 'auto']);
    expect(withResolvedPermissionMode(['--permission-mode=auto'], 'plan')).toEqual(['--permission-mode=auto']);
  });
});

describe('Navegador integrado — entrega do MCP `donel` ao CLI da sessão', () => {
  const endpoint = { name: 'donel', url: 'http://127.0.0.1:51234/mcp', bearerToken: 'f'.repeat(32) };

  it('mcpDeliveryFor(claude-code): --mcp-config <path> as two tokens and one HTTP server named donel with the bearer header', () => {
    const path = 'C:\\Users\\x y\\browser-mcp\\pty-1.json';
    const delivery = mcpDeliveryFor('claude-code', endpoint, path);
    expect(delivery.args).toEqual(['--allowedTools', APP_MCP_PREAUTHORIZED_TOOLS.join(','), '--mcp-config', path]);
    // Only the board and session tools are pre-authorized; the browser keeps the CLI's permission flow.
    expect(APP_MCP_PREAUTHORIZED_TOOLS.some((tool) => tool.includes('navegador'))).toBe(false);
    expect(JSON.parse(delivery.configFileContent ?? 'null')).toEqual({
      mcpServers: {
        donel: { type: 'http', url: 'http://127.0.0.1:51234/mcp', headers: { Authorization: `Bearer ${'f'.repeat(32)}` }, timeout: 35 * 60_000 },
      },
    });
  });

  // 10/11 (t-58d7c191) — without `timeout`, Claude Code cuts an HTTP MCP call at 60 s ("The operation timed out.",
  // measured with a server that answers at 75 s), while `sessao_enviar` may answer at 90 s and `sessao_abrir` waits up
  // to 30 min for the owner: 60 sends from sessions of the Homologações place came back like that in 5 h.
  it('the server timeout outlasts the longest wait of the app (the owner deciding, 30 min), never the CLI default of 60 s', () => {
    const config = JSON.parse(mcpDeliveryFor('claude-code', endpoint, 'x.json').configFileContent ?? 'null');
    expect(config.mcpServers.donel.timeout).toBeGreaterThan(30 * 60_000);
  });
});
