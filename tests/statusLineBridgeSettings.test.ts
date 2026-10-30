import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHookBridge, type BridgeEvent } from '../src/main/hook-bridge';
import {
  buildSessionHooksSettings,
  buildStatusLineScript,
  buildStatusLineSetting,
  isChainableStatusLineCommand,
  planStatusLineBridge,
  removeSessionHooksSettings,
  statusLineBridgeMode,
  writeSessionHooksSettings,
} from '../src/main/hooks-settings';

// Ponte da statusline — geração do `statusLine` do `--settings` da sessão e o
// encadeamento com a statusline do usuário (hooks-settings.ts, "Ponte da
// statusline").

const base = { port: 4321, token: 'tok', chatEnabled: true, curlPath: 'C:\\Windows\\System32\\curl.exe' } as const;

describe('statusLineBridgeMode', () => {
  it('always/off explícitos; o resto é auto', () => {
    expect(statusLineBridgeMode('always')).toBe('always');
    expect(statusLineBridgeMode('off')).toBe('off');
    expect(statusLineBridgeMode(undefined)).toBe('auto');
    expect(statusLineBridgeMode('yes')).toBe('auto');
  });
});

describe('planStatusLineBridge', () => {
  const user = { command: '~/.claude/statusline.sh', padding: 1 };

  it('com statusline do usuário: encadeia (a tela não muda — as dicas do rodapé já tinham sumido)', () => {
    expect(planStatusLineBridge({ mode: 'auto', userStatusLine: user, chatEnabled: true })).toEqual({ kind: 'chain', user });
  });

  it('sem statusline do usuário e chat ligado: só encaminha (o chat prova o turno pelo spinner, não pelo rodapé)', () => {
    expect(planStatusLineBridge({ mode: 'auto', userStatusLine: null, chatEnabled: true })).toEqual({ kind: 'forward' });
  });

  it('sem statusline do usuário e chat desligado: só encaminha', () => {
    expect(planStatusLineBridge({ mode: 'auto', userStatusLine: null, chatEnabled: false })).toEqual({ kind: 'forward' });
  });

  it('always vale o mesmo que auto; off desliga tudo, até o encadeamento', () => {
    expect(planStatusLineBridge({ mode: 'always', userStatusLine: null, chatEnabled: true })).toEqual({ kind: 'forward' });
    expect(planStatusLineBridge({ mode: 'off', userStatusLine: null, chatEnabled: true })).toBeNull();
    expect(planStatusLineBridge({ mode: 'off', userStatusLine: user, chatEnabled: false })).toBeNull();
  });

  it('comando do usuário que não cabe num pipe: sem ponte, statusline dele intacta', () => {
    expect(planStatusLineBridge({ mode: 'auto', userStatusLine: { command: 'cd x && ./s.sh' }, chatEnabled: true })).toBeNull();
    expect(planStatusLineBridge({ mode: 'always', userStatusLine: { command: 'a; b' }, chatEnabled: true })).toBeNull();
  });
});

describe('isChainableStatusLineCommand', () => {
  it.each([
    '~/.claude/statusline.sh',
    'powershell -NoProfile -File C:/Users/u/.claude/statusline.ps1',
    'npx -y ccstatusline@latest',
    `jq -r '"[\\(.model.display_name)] \\(.context_window.used_percentage // 0)% context"'`,
    'node "C:/x;y/s.js"',
    "bash -c 'a && b'",
    'jq -r .model.id | tr a-z A-Z',
  ])('aceita %s', (command) => {
    expect(isChainableStatusLineCommand(command)).toBe(true);
  });

  it.each(['cd x && ./s.sh', 'a || b', 'a; b', 'a & b', 'a\nb', 'echo "aberto', '   '])('recusa %j', (command) => {
    expect(isChainableStatusLineCommand(command)).toBe(false);
  });
});

describe('buildStatusLineSetting', () => {
  it('encadeia: tee | comando do usuário, carregando padding/refreshInterval/hideVimModeIndicator', () => {
    const setting = buildStatusLineSetting(
      { kind: 'chain', user: { command: '~/.claude/statusline.sh', padding: 2, refreshInterval: 5, hideVimModeIndicator: true } },
      { ...base, statusLineScriptPath: 'C:/ud/hook-settings/p.statusline.ps1' },
    );
    expect(setting).toEqual({
      type: 'command',
      command: 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:/ud/hook-settings/p.statusline.ps1" | ~/.claude/statusline.sh',
      padding: 2,
      refreshInterval: 5,
      hideVimModeIndicator: true,
    });
  });

  it('só encaminha com curl: timeouts curtos, sem proxy, token no header, rota StatusLine', () => {
    const { command } = buildStatusLineSetting({ kind: 'forward' }, base);
    // Barras normais e "@-" entre aspas: válido no Git Bash, no PowerShell e no cmd.
    expect(command).toBe(
      'C:/Windows/System32/curl.exe -s --noproxy 127.0.0.1 --connect-timeout 1 --max-time 2 --data-binary "@-" -H "X-Donel-Token: tok" http://127.0.0.1:4321/h/StatusLine',
    );
    expect(buildStatusLineSetting({ kind: 'forward' }, { ...base, curlPath: 'C:\\Program Files\\curl\\curl.exe' }).command.startsWith('"C:/Program Files/curl/curl.exe" -s')).toBe(true);
  });

  it('só encaminha sem curl: o .ps1 calado', () => {
    expect(buildStatusLineSetting({ kind: 'forward' }, { ...base, curlPath: null, statusLineScriptPath: 'C:/s.ps1' }).command).toBe(
      'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:/s.ps1"',
    );
  });
});

describe('buildStatusLineScript', () => {
  it('tee: devolve o stdin (ASCII-escapado) e fecha o stdout ANTES de postar', () => {
    const script = buildStatusLineScript({ port: 9, token: 't', echo: true });
    expect(script.indexOf('$stdout.Close()')).toBeGreaterThan(0);
    expect(script.indexOf('$stdout.Close()')).toBeLessThan(script.indexOf('GetRequestStream'));
    expect(script).toContain("'[^\\u0000-\\u007F]'");
  });

  it('encaminhador calado: não escreve no stdout', () => {
    expect(buildStatusLineScript({ port: 9, token: 't', echo: false })).not.toContain('OpenStandardOutput');
  });

  it('nunca lança: timeout curto, sem proxy, exit 0', () => {
    const script = buildStatusLineScript({ port: 9, token: 't', echo: false });
    expect(script).toContain('http://127.0.0.1:9/h/StatusLine');
    expect(script).toContain('$req.Timeout = 1500');
    expect(script).toContain('$req.Proxy = $null');
    expect(script).toContain('} catch {}');
    expect(script.trimEnd().endsWith('exit 0')).toBe(true);
  });
});

describe('buildSessionHooksSettings + statusLine', () => {
  it('sem plano: nenhuma chave statusLine (comportamento de antes)', () => {
    expect(buildSessionHooksSettings(base)).not.toHaveProperty('statusLine');
    expect(buildSessionHooksSettings({ ...base, statusLine: null })).not.toHaveProperty('statusLine');
  });

  it('com plano: a chave entra ao lado dos hooks', () => {
    const content = buildSessionHooksSettings({ ...base, statusLine: { kind: 'forward' } });
    expect(content.statusLine?.command).toContain('/h/StatusLine');
    expect(content.hooks.Stop).toBeDefined();
  });
});

describe('per-session I/O da statusline', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'donel-sl-'));
    dirs.push(d);
    return d;
  };

  it('encadear grava o tee <ptyId>.statusline.ps1, aponta o comando para ele e o remove no fim', () => {
    const userData = tmp();
    const path = writeSessionHooksSettings({ ...base, userDataDir: userData, ptyId: 'p1', statusLine: { kind: 'chain', user: { command: 'my.sh' } } });
    const script = join(userData, 'hook-settings', 'p1.statusline.ps1');
    expect(readFileSync(script, 'utf8')).toContain('OpenStandardOutput');
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.statusLine.command).toBe(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}" | my.sh`);
    removeSessionHooksSettings(userData, 'p1');
    expect(existsSync(script)).toBe(false);
  });

  it('encaminhar com curl não grava script', () => {
    const userData = tmp();
    writeSessionHooksSettings({ ...base, userDataDir: userData, ptyId: 'p2', statusLine: { kind: 'forward' } });
    expect(existsSync(join(userData, 'hook-settings', 'p2.statusline.ps1'))).toBe(false);
  });

  it('encaminhar sem curl grava o encaminhador calado', () => {
    const userData = tmp();
    writeSessionHooksSettings({ ...base, curlPath: null, userDataDir: userData, ptyId: 'p3', statusLine: { kind: 'forward' } });
    expect(readFileSync(join(userData, 'hook-settings', 'p3.statusline.ps1'), 'utf8')).not.toContain('OpenStandardOutput');
  });
});

// Ponta a ponta no Windows: o comando gerado roda no shell que o CLI usaria
// (Git Bash ou PowerShell), com JSON acentuado no stdin, contra a ponte real.
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const onWindows = process.platform === 'win32';

function run(file: string, args: string[], stdin: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { windowsHide: true, timeout: 20_000, encoding: 'buffer' }, (error, stdout) => {
      const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ code, stdout: Buffer.from(stdout).toString('utf8') });
    });
    child.stdin?.end(Buffer.from(stdin, 'utf8'));
  });
}

describe.skipIf(!onWindows)('encadeamento real (Windows)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const payload = { session_id: 's-1', workspace: { current_dir: 'C:/Área de Trabalho/projeto' }, rate_limits: { five_hour: { used_percentage: 12 } } };

  async function scenario(shell: 'bash' | 'powershell', userCommand: ((dir: string) => string) | null) {
    const dir = mkdtempSync(join(tmpdir(), 'donel-sl-e2e-'));
    dirs.push(dir);
    const bridge = createHookBridge();
    const { port } = await bridge.start();
    const token = bridge.registerSession('pty-e2e');
    const seen: BridgeEvent[] = [];
    bridge.on('pty-e2e', (e) => seen.push(e));
    try {
      const path = writeSessionHooksSettings({
        port,
        token,
        chatEnabled: true,
        curlPath: userCommand ? null : 'C:\\Windows\\System32\\curl.exe',
        userDataDir: dir,
        ptyId: 'pty-e2e',
        statusLine: userCommand ? { kind: 'chain', user: { command: userCommand(dir) } } : { kind: 'forward' },
      });
      const { command } = JSON.parse(readFileSync(path, 'utf8')).statusLine as { command: string };
      // O CLI troca `\` por `/` no comando quando o shell é o Git Bash (lido no binário 2.1.314).
      const result =
        shell === 'bash'
          ? await run(GIT_BASH, ['-c', command.replaceAll('\\', '/')], JSON.stringify(payload))
          : await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], JSON.stringify(payload));
      await new Promise((r) => setTimeout(r, 100));
      return { dir, result, seen };
    } finally {
      await bridge.close();
    }
  }

  it.skipIf(!existsSync(GIT_BASH))(
    'Git Bash: o comando do usuário recebe o MESMO JSON, a saída e o código dele passam, e a ponte recebe a cópia',
    async () => {
      const { dir, result, seen } = await scenario('bash', (d) => {
        const script = join(d, 'user.sh').replaceAll('\\', '/');
        writeFileSync(script, '#!/bin/bash\ninput=$(cat)\nprintf "%s" "$input" > "$(dirname "$0")/got.json"\necho "USER-LINE"\nexit 3\n');
        return `bash ${script}`;
      });
      expect(result.stdout.trim()).toBe('USER-LINE');
      expect(result.code).toBe(3);
      expect(JSON.parse(readFileSync(join(dir, 'got.json'), 'utf8'))).toEqual(payload);
      expect(seen).toEqual([{ type: 'statusline', ptyId: 'pty-e2e', payload }]);
    },
    30_000,
  );

  it('PowerShell (sem Git Bash): idem, com o acento intacto no JSON', async () => {
    const { dir, result, seen } = await scenario('powershell', (d) => {
      const script = join(d, 'user.ps1');
      writeFileSync(
        script,
        [
          '$j = $input | Out-String | ConvertFrom-Json',
          '[IO.File]::WriteAllText((Join-Path $PSScriptRoot "got.txt"), $j.workspace.current_dir, [Text.Encoding]::UTF8)',
          'Write-Output ("PS-LINE " + $j.rate_limits.five_hour.used_percentage)',
          '',
        ].join('\r\n'),
      );
      return `powershell -NoProfile -File "${script}"`;
    });
    expect(result.stdout.trim()).toBe('PS-LINE 12');
    expect(readFileSync(join(dir, 'got.txt'), 'utf8').replace(/^\uFEFF/, '')).toBe('C:/Área de Trabalho/projeto');
    expect(seen).toEqual([{ type: 'statusline', ptyId: 'pty-e2e', payload }]);
  }, 30_000);

  it.each(['bash', 'powershell'] as const)('só encaminhar (curl), no %s: não imprime nada, sai com 0 e a ponte recebe', async (shell) => {
    if (shell === 'bash' && !existsSync(GIT_BASH)) return;
    const { result, seen } = await scenario(shell, null);
    expect(result).toEqual({ code: 0, stdout: '' });
    expect(seen).toEqual([{ type: 'statusline', ptyId: 'pty-e2e', payload }]);
  }, 30_000);
});
