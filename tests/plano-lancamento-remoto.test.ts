import { describe, expect, it } from 'vitest';
import { planRemoteLaunch, type RemoteLaunchInput } from '../src/main/remote-launch-plan';
import { appMcpAllowArgs } from '../src/shared/commandBuilder';
import { SUPER_BYPASS_ENV } from '../src/shared/launchPermission';

// t-1a3f7150 (abrir sessão com o PC desligado), fatia 1 — the files and the argv of a session on a remote place leave
// `spawnRemoteClaudeSession` (index.ts) for a pure plan the VPS daemon will reuse. The argv of a launch is on the
// short list of what this repo tests: a change here changes how every remote session is born. Decision 2 of the
// board's Líder (18/11): a remote session with a non-Líder role and no explicit permission is born in bypass.

const SID = '11111111-2222-4333-8444-555555555555';
const ROLE_TEXT = '# Dev\nVocê implementa.\n';

function input(overrides: Partial<RemoteLaunchInput> = {}): RemoteLaunchInput {
  return {
    sid: SID,
    launcherArgs: ['--model', 'opus'],
    extraArgs: ['--session-id', SID],
    launchArgs: ['--model', 'opus', '--worktree', 'tarefa-x'],
    facts: { roleId: 'dev' },
    role: { promptText: ROLE_TEXT, scope: { mcps: ['github'] }, scopeSettings: { allowedMcpServers: [{ serverName: 'donel' }, { serverName: 'github' }] } },
    hooks: { on: true, port: 41001, token: 'hooktok', statusLine: { kind: 'forward' } },
    mcp: { port: 41002, token: 'mcptok' },
    localCwd: 'C:\\Users\\x\\seazone\\atlas',
    projectName: 'atlas',
    name: 'Dev atlas',
    openedBy: 'place:lider',
    createdAt: '2026-11-18T10:00:00.000Z',
    homeRelativeDir: 'seazone/atlas',
    worktree: 'tarefa-x',
    repoUrl: 'https://github.com/acme/atlas',
    branch: 'staging',
    ...overrides,
  };
}

function fileOf(script: string, name: string): string | null {
  const escaped = name.replace(/\./g, '\\.');
  const match = new RegExp(`printf '%s' '([A-Za-z0-9+/=]+)' \\| base64 -d > "\\$S"/'${escaped}'`).exec(script);
  return match ? Buffer.from(match[1]!, 'base64').toString('utf8') : null;
}

describe('plano do lançamento remoto', () => {
  it('a Dev aberta por sessao_abrir, sem permissão escolhida, nasce em bypass com papel, hooks e MCP', () => {
    const plan = planRemoteLaunch(input());

    expect(plan.claudeArgs).toEqual([
      '--model', 'opus',
      '--session-id', SID,
      '--append-system-prompt-file', '@S/role.md',
      '--settings', '@S/settings.json',
      ...appMcpAllowArgs(), '--mcp-config', '@S/mcp.json',
      '--permission-mode', 'bypassPermissions',
    ]);
    expect(plan.env).toEqual(SUPER_BYPASS_ENV);
    expect(plan.bypass).toBe(true);
    expect(plan.roleMissing).toEqual([]);

    expect(plan.files.map((file) => file.name)).toEqual(['role.md', 'hook-header', 'slack-guard.sh', 'settings.json', 'mcp.json']);
    const content = (name: string): string => plan.files.find((file) => file.name === name)!.content;
    expect(content('role.md')).toBe(ROLE_TEXT);
    expect(content('hook-header')).toBe('X-Donel-Token: hooktok\n');
    const settings = JSON.parse(content('settings.json'));
    expect(settings.hooks.SessionStart[0].hooks.map((hook: { command: string }) => hook.command)).toEqual([
      `curl -s --data-binary @- -H "@$HOME/.donel/s/${SID}/hook-header" http://127.0.0.1:41001/h/SessionStart`,
      expect.stringContaining(`$HOME/.donel/s/${SID}/current`),
    ]);
    expect(settings.hooks.Stop[0].hooks[0]).toMatchObject({ type: 'http', url: 'http://127.0.0.1:41001/h/Stop', headers: { 'X-Donel-Token': 'hooktok' } });
    expect(settings.allowedMcpServers).toEqual([{ serverName: 'donel' }, { serverName: 'github' }]);
    expect(settings.statusLine).toBeDefined();
    expect(settings.permissions.deny.length).toBeGreaterThan(0);
    expect(JSON.parse(content('mcp.json')).mcpServers.donel).toMatchObject({ type: 'http', url: 'http://127.0.0.1:41002/mcp', headers: { Authorization: 'Bearer mcptok' } });

    // meta.json: the key order is the file the place keeps; a reattach reads it back.
    expect(Object.keys(plan.meta)).toEqual(['sid', 'hookToken', 'hookPort', 'mcpToken', 'mcpPort', 'localCwd', 'projectName', 'name', 'launchArgs', 'openedBy', 'createdAt', 'roleId']);
    expect(plan.meta).toMatchObject({ sid: SID, hookToken: 'hooktok', hookPort: 41001, mcpToken: 'mcptok', mcpPort: 41002, launchArgs: ['--model', 'opus', '--worktree', 'tarefa-x'], openedBy: 'place:lider', roleId: 'dev' });

    const script = plan.setupScript(SID);
    expect(script).toContain("WT='tarefa-x'");
    expect(script).toContain("REPO='https://github.com/acme/atlas'; BRANCH='staging'");
    expect(script).not.toContain('DONEL_GONE');
    expect(fileOf(script, 'meta.json')).toBe(`${JSON.stringify(plan.meta)}\n`);
    expect(fileOf(script, 'settings.json')).toBe(content('settings.json'));
    const claudeSh = fileOf(script, 'claude.sh')!;
    expect(claudeSh).toContain('export CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1');
    expect(claudeSh).toContain(
      `exec claude '--model' 'opus' '--session-id' '${SID}' '--append-system-prompt-file' "$S"/'role.md' '--settings' "$S"/'settings.json'`,
    );
    expect(claudeSh.trimEnd().endsWith("'--mcp-config' \"$S\"/'mcp.json' '--permission-mode' 'bypassPermissions'")).toBe(true);
    // Another folder (a reattach past a `/clear`) only attaches.
    expect(plan.setupScript('99999999-2222-4333-8444-555555555555')).toContain('DONEL_GONE');
  });

  it('sem hooks, sem MCP e sem papel: só o settings.json das chaves, e a permissão escolhida vira bypass', () => {
    const plan = planRemoteLaunch(
      input({
        launcherArgs: ['--permission-mode', 'acceptEdits', '--model', 'opus'],
        facts: {},
        role: { promptText: null, scope: undefined, scopeSettings: null },
        hooks: { on: false, port: 41001, token: 'hooktok', statusLine: null },
        mcp: null,
        openedBy: undefined,
        worktree: '../fora',
      }),
    );
    expect(plan.claudeArgs).toEqual(['--permission-mode', 'bypassPermissions', '--model', 'opus', '--session-id', SID, '--settings', '@S/settings.json']);
    expect(plan.files.map((file) => file.name)).toEqual(['settings.json']);
    expect(Object.keys(JSON.parse(plan.files[0]!.content))).toEqual(['permissions']);
    expect(Object.keys(plan.meta)).toEqual(['sid', 'hookToken', 'hookPort', 'mcpToken', 'mcpPort', 'localCwd', 'projectName', 'name', 'launchArgs', 'createdAt']);
    expect(plan.meta).toMatchObject({ mcpToken: null, mcpPort: null });
    // An unsafe worktree name is dropped: the session runs in the project folder.
    expect(plan.setupScript(SID)).toContain("WT=''");
  });

  it('papel sem texto e escopo que não montou: abre sem eles e diz o que faltou; o Líder único leva a marca no meta', () => {
    const plan = planRemoteLaunch(
      input({ facts: { roleId: 'lider', leaderOfAll: true }, role: { promptText: null, scope: { mcps: ['github'] }, scopeSettings: null } }),
    );
    expect(plan.roleMissing).toEqual(['papel', 'escopo']);
    expect(plan.claudeArgs).not.toContain('--append-system-prompt-file');
    expect(plan.files.map((file) => file.name)).not.toContain('role.md');
    expect(plan.meta).toMatchObject({ roleId: 'lider', leaderOfAll: true });
    expect(plan.claudeArgs.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
  });
});
