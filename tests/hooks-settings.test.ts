import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync as realWriteFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildByteSafeForwarderScript,
  buildHookForwarderScript,
  buildHooksSettingsContent,
  buildSessionHooksSettings,
  cleanupStaleHookSettings,
  removeSessionHooksSettings,
  SEMAPHORE_HOOK_EVENTS,
  sessionHookSettingsPath,
  writeHooksSettingsFile,
  writeSessionHooksSettings,
} from '../src/main/hooks-settings';

// T009 — arquivo `--settings` adicional (spike: soma aditiva, nunca toca
// ~/.claude/settings.json). Script `.ps1` + settings.json puros; só a
// escrita em disco tem I/O (testada com `writeFileSync` injetado).
//
// O comando inline `-Command "..."` foi tentado primeiro e NUNCA chegou a
// disparar no smoke real do app (nem erro visível, nem POST recebido) — só
// o padrão `-File "<script>"` (mesmo do hook-forward.ps1 do spike T002,
// reconfirmado no addendum) funciona de ponta a ponta. Os testes abaixo
// travam essa forma.

describe('buildHookForwarderScript', () => {
  it('embute a porta local no Invoke-RestMethod', () => {
    const script = buildHookForwarderScript(54321);
    expect(script).toContain('http://127.0.0.1:54321/hook');
    expect(script).toContain('Invoke-RestMethod');
  });

  it('nunca lança — try/catch envolve o POST e termina com exit 0', () => {
    const script = buildHookForwarderScript(8765);
    expect(script).toContain('try {');
    expect(script).toContain('catch {}');
    expect(script).toContain('exit 0');
  });
});

describe('buildHooksSettingsContent', () => {
  const scriptPath = 'C:\\Users\\test\\AppData\\Roaming\\donel-dev\\session-hook-forward.ps1';

  it('registra os 6 eventos da matriz do spike + StopFailure', () => {
    const content = buildHooksSettingsContent(scriptPath);

    for (const event of SEMAPHORE_HOOK_EVENTS) {
      expect(content.hooks[event]).toBeDefined();
      expect(content.hooks[event][0].hooks[0].type).toBe('command');
    }
    expect(Object.keys(content.hooks)).toHaveLength(7);
  });

  it('registra StopFailure — o CLI dispara ele no lugar de Stop quando o limite da conta encerra o turno', () => {
    const content = buildHooksSettingsContent(scriptPath);

    expect(Object.keys(content.hooks)).toContain('StopFailure');
  });

  it('cada comando usa -File apontando pro script gerado, não -Command inline', () => {
    const content = buildHooksSettingsContent(scriptPath);

    for (const event of SEMAPHORE_HOOK_EVENTS) {
      const command = content.hooks[event][0].hooks[0].command;
      expect(command).toContain(`-File "${scriptPath}"`);
      expect(command).not.toContain('-Command');
    }
  });

  it('é determinístico pro mesmo script path (puro, sem I/O)', () => {
    expect(buildHooksSettingsContent(scriptPath)).toEqual(buildHooksSettingsContent(scriptPath));
  });
});

describe('writeHooksSettingsFile', () => {
  it('escreve o script forwarder E o settings.json, sem tocar o FS real', () => {
    const writeFileSyncMock = vi.fn();
    const userDataDir = 'C:\\Users\\test\\AppData\\Roaming\\donel-dev';

    const settingsPath = writeHooksSettingsFile(userDataDir, 8765, writeFileSyncMock as never);

    expect(settingsPath).toBe(`${userDataDir}\\session-hooks-settings.json`);
    expect(writeFileSyncMock).toHaveBeenCalledTimes(2);

    const [scriptCall, settingsCall] = writeFileSyncMock.mock.calls;
    const [scriptPath, scriptContent, scriptEncoding] = scriptCall;
    expect(scriptPath).toBe(`${userDataDir}\\session-hook-forward.ps1`);
    expect(scriptContent).toBe(buildHookForwarderScript(8765));
    expect(scriptEncoding).toBe('utf8');

    const [settingsWrittenPath, settingsContent, settingsEncoding] = settingsCall;
    expect(settingsWrittenPath).toBe(settingsPath);
    expect(settingsEncoding).toBe('utf8');
    expect(JSON.parse(settingsContent as string)).toEqual(buildHooksSettingsContent(scriptPath));
  });
});

// --- 014 (T010): per-session file, contracts/hook-bridge.md §1-§2 ---

const HTTP_EVENTS = ['PermissionRequest', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'SubagentStart', 'SubagentStop', 'SessionEnd'];

describe('buildSessionHooksSettings', () => {
  const base = { port: 4567, token: 'tok123', chatEnabled: true, curlPath: 'curl.exe' };

  it('registers http entries with url, X-Donel-Token header and no matcher', () => {
    const { hooks } = buildSessionHooksSettings(base) as { hooks: Record<string, Array<Record<string, unknown>>> };
    for (const event of HTTP_EVENTS) {
      const group = hooks[event][0];
      expect(group).not.toHaveProperty('matcher');
      const entry = (group.hooks as Array<Record<string, unknown>>)[0];
      expect(entry).toMatchObject({ type: 'http', url: `http://127.0.0.1:4567/h/${event}`, headers: { 'X-Donel-Token': 'tok123' } });
    }
  });

  it('uses the timeouts from the table', () => {
    const { hooks } = buildSessionHooksSettings(base) as { hooks: Record<string, Array<{ hooks: Array<{ timeout: number }> }>> };
    expect(hooks.PermissionRequest[0].hooks[0].timeout).toBe(86400);
    expect(hooks.SessionEnd[0].hooks[0].timeout).toBe(2);
    for (const e of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'SubagentStart', 'SubagentStop']) {
      expect(hooks[e][0].hooks[0].timeout).toBe(10);
    }
  });

  it('only includes PermissionRequest when chat is enabled', () => {
    const off = buildSessionHooksSettings({ ...base, chatEnabled: false }) as { hooks: Record<string, unknown> };
    expect(off.hooks).not.toHaveProperty('PermissionRequest');
    expect(off.hooks).toHaveProperty('PreToolUse');
  });

  it('SessionStart is a curl.exe command reading stdin as bytes', () => {
    const { hooks } = buildSessionHooksSettings(base) as { hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string; timeout: number }> }>> };
    const entry = hooks.SessionStart[0].hooks[0];
    expect(entry.type).toBe('command');
    expect(entry.timeout).toBe(10);
    expect(entry.command).toBe('curl.exe -s --data-binary @- -H "X-Donel-Token: tok123" http://127.0.0.1:4567/h/SessionStart');
  });

  it('falls back to the PowerShell forwarder when curl is missing', () => {
    const { hooks } = buildSessionHooksSettings({ ...base, curlPath: null, forwarderScriptPath: 'C:/x/p1.forward.ps1' }) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(hooks.SessionStart[0].hooks[0].command).toContain('-File "C:/x/p1.forward.ps1"');
    expect(hooks.SessionStart[0].hooks[0].command).not.toContain('curl');
  });

  it('is pure and deterministic', () => {
    expect(buildSessionHooksSettings(base)).toEqual(buildSessionHooksSettings(base));
  });
});

describe('buildByteSafeForwarderScript', () => {
  it('reads stdin and posts raw bytes with the token header', () => {
    const script = buildByteSafeForwarderScript({ port: 4567, token: 'tok123' });
    expect(script).toContain('OpenStandardInput');
    expect(script).toContain('http://127.0.0.1:4567/h/SessionStart');
    expect(script).toContain('X-Donel-Token');
    expect(script).toContain('tok123');
    expect(script).toMatch(/UploadData|GetRequestStream/);
    expect(script).not.toContain('ReadToEnd');
    expect(script).toContain('exit 0');
  });
});

describe('per-session file I/O', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'donel-hs-'));
    dirs.push(d);
    return d;
  };

  it('writes userData/hook-settings/<ptyId>.json and removes it', () => {
    const userData = tmp();
    const path = writeSessionHooksSettings({ userDataDir: userData, ptyId: 'pty-1', port: 1234, token: 'abc', chatEnabled: true, curlPath: 'curl.exe' });
    expect(path).toBe(join(userData, 'hook-settings', 'pty-1.json'));
    expect(path).toBe(sessionHookSettingsPath(userData, 'pty-1'));
    expect(JSON.parse(readFileSync(path, 'utf8')).hooks.PreToolUse[0].hooks[0].headers['X-Donel-Token']).toBe('abc');
    removeSessionHooksSettings(userData, 'pty-1');
    expect(existsSync(path)).toBe(false);
    expect(() => removeSessionHooksSettings(userData, 'pty-1')).not.toThrow();
  });

  it('writes and removes the forwarder script in the curl-less fallback', () => {
    const userData = tmp();
    const path = writeSessionHooksSettings({ userDataDir: userData, ptyId: 'pty-2', port: 1234, token: 'abc', chatEnabled: false, curlPath: null });
    const script = join(userData, 'hook-settings', 'pty-2.forward.ps1');
    expect(existsSync(script)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('pty-2.forward.ps1');
    removeSessionHooksSettings(userData, 'pty-2');
    expect(existsSync(script)).toBe(false);
  });

  it('cleans up files older than one day and keeps fresh ones', () => {
    const userData = tmp();
    const dir = join(userData, 'hook-settings');
    mkdirSync(dir, { recursive: true });
    const old = join(dir, 'old.json');
    const fresh = join(dir, 'fresh.json');
    realWriteFileSync(old, '{}');
    realWriteFileSync(fresh, '{}');
    const now = Date.now();
    utimesSync(old, new Date(now - 2 * 86400_000), new Date(now - 2 * 86400_000));
    cleanupStaleHookSettings(userData, now);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('cleanup tolerates a missing directory', () => {
    expect(() => cleanupStaleHookSettings(join(tmp(), 'nope'))).not.toThrow();
  });
});
