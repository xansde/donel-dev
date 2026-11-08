import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHookBridge, type HookBridge } from '../src/main/hook-bridge';
import { buildSessionHooksSettings, buildSlackOfflineGuardScript, tokenHeaderFileContent, writeSessionHooksSettings } from '../src/main/hooks-settings';
import { buildRemoteSetupScript, REMOTE_SESSIONS_DIR } from '../src/main/remote-session';

// A chave dos hooks não pode ir à linha de comando de nada: o CLI grava a linha de comando do hook de início
// (`hook_success.command`) no transcript, e dali ela chegava a coletores e subagentes (08/11). O teste lança uma
// sessão no `claude` falso (que grava o transcript como o real) e procura o valor no argv, no claude.sh da sessão
// remota, nos comandos do --settings e em cada linha do transcript — e confere que a ponte recebeu a chave mesmo assim.

const FAKE_CLAUDE = join(__dirname, 'smoke', 'fixtures', 'fake-claude-chat', 'fake-claude-chat.mjs');
const dirs: string[] = [];
const bridges: HookBridge[] = [];
afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Every `command` the CLI would run from this settings file (hooks and statusLine). */
function commandsOf(settingsPath: string): string[] {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
    hooks: Record<string, Array<{ hooks: Array<{ type: string; command?: string }> }>>;
    statusLine?: { command: string };
  };
  const commands = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command ?? '')));
  return [...commands, settings.statusLine?.command ?? ''].filter((command) => command !== '');
}

function transcriptsUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.jsonl')) found.push(path);
    }
  };
  walk(root);
  return found;
}

/** Runs the fake CLI until the bridge takes its SessionStart; returns once it exited. */
async function runSession(bridge: HookBridge, ptyId: string, argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const started = new Promise<void>((resolve) => {
    const off = bridge.on(ptyId, (event) => {
      if (event.type === 'hook' && event.event === 'SessionStart') {
        off();
        resolve();
      }
    });
  });
  const child = spawn(process.execPath, [FAKE_CLAUDE, ...argv], { env: { ...process.env, ...env }, stdio: ['pipe', 'ignore', 'ignore'] });
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('a ponte não recebeu o SessionStart (chave não chegou)')), 8_000));
  try {
    await Promise.race([started, timeout]);
  } finally {
    child.stdin.end();
  }
  await exited;
}

async function startBridge(): Promise<{ bridge: HookBridge; port: number }> {
  const bridge = createHookBridge();
  bridges.push(bridge);
  const { port } = await bridge.start();
  return { bridge, port };
}

function expectNoToken(where: string, text: string, token: string): void {
  // Never print the value: only where it was found.
  expect(text.includes(token), `a chave apareceu em ${where}`).toBe(false);
}

describe('chave dos hooks fora do argv e do transcript', () => {
  it('sessão local: nova e retomada — a ponte recebe a chave, que não está no argv, nos comandos nem no transcript', async () => {
    const { bridge, port } = await startBridge();
    const ptyId = 'pty-local';
    const token = bridge.registerSession(ptyId);
    const userDataDir = tempDir('chave-local-');
    const claudeHome = tempDir('chave-home-');
    const settingsPath = writeSessionHooksSettings({ userDataDir, ptyId, port, token, curlPath: 'curl', statusLine: { kind: 'forward' } });
    if (process.platform !== 'win32') expect(statSync(join(userDataDir, 'hook-settings', `${ptyId}.header`)).mode & 0o777).toBe(0o600);

    const sessionId = '11111111-2222-4333-8444-555555555555';
    const env = { DONEL_FAKE_CLAUDE_HOME: claudeHome };
    for (const argv of [
      ['--session-id', sessionId, '--settings', settingsPath],
      ['-r', sessionId, '--settings', settingsPath],
    ]) {
      expectNoToken('argv', argv.join(' '), token);
      await runSession(bridge, ptyId, argv, env);
    }

    for (const command of commandsOf(settingsPath)) expectNoToken('um comando do --settings', command, token);
    const transcripts = transcriptsUnder(claudeHome);
    expect(transcripts).toHaveLength(1);
    const lines = readFileSync(transcripts[0], 'utf8').split('\n');
    expect(lines.filter((line) => line.includes('"hook_success"'))).toHaveLength(2); // the CLI's record of each start
    lines.forEach((line, index) => expectNoToken(`linha ${index + 1} do transcript`, line, token));
  });

  it.skipIf(process.platform === 'win32')('sessão remota: claude.sh, comandos e transcript sem a chave, e a ponte a recebe pelo arquivo da sessão', async () => {
    const { bridge, port } = await startBridge();
    const ptyId = 'pty-remota';
    const token = bridge.registerSession(ptyId);
    const home = tempDir('chave-remota-');
    const sid = '66666666-7777-4888-9999-000000000000';
    // Same assembly as createRemoteClaudeSession: the header file next to the settings, named by `$HOME`.
    const tokenHeaderPath = `$HOME/${REMOTE_SESSIONS_DIR}/${sid}/hook-header`;
    const settings = buildSessionHooksSettings({
      port,
      token,
      tokenHeaderPath,
      curlPath: 'curl',
      slackOfflineGuardCommand: `sh "$HOME/${REMOTE_SESSIONS_DIR}/${sid}/slack-guard.sh"`,
      statusLine: { kind: 'forward' },
    });
    const files = [
      { name: 'hook-header', content: tokenHeaderFileContent(token) },
      { name: 'slack-guard.sh', content: buildSlackOfflineGuardScript({ port, tokenHeaderPath }) },
      { name: 'settings.json', content: `${JSON.stringify(settings, null, 2)}\n` },
    ];
    const claudeArgs = ['--session-id', sid, '--settings', '@S/settings.json'];
    const setup = buildRemoteSetupScript({
      sid,
      homeRelativeDir: 'proj',
      repoUrl: null,
      branch: null,
      files,
      claudeArgs,
      meta: { sid, hookToken: token, hookPort: port, mcpToken: null, mcpPort: null, localCwd: '/p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' },
    });
    // claude.sh is written from base64 by the setup script: decode it the way the remote does.
    const claudeSh = [...setup.matchAll(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d > "\$S"\/'claude\.sh'/g)].map((match) => Buffer.from(match[1], 'base64').toString('utf8'));
    expect(claudeSh).toHaveLength(1);
    expectNoToken('claude.sh', claudeSh[0], token);
    expectNoToken('argv', claudeArgs.join(' '), token);

    // The session folder as the setup leaves it, under a fake `$HOME`.
    const sessionDir = join(home, REMOTE_SESSIONS_DIR, sid);
    mkdirSync(sessionDir, { recursive: true });
    for (const file of files) writeFileSync(join(sessionDir, file.name), file.content, { mode: 0o600 });
    const settingsPath = join(sessionDir, 'settings.json');
    for (const command of commandsOf(settingsPath)) expectNoToken('um comando do --settings', command, token);

    const claudeHome = join(home, '.claude');
    await runSession(bridge, ptyId, ['--session-id', sid, '--settings', settingsPath], { HOME: home, DONEL_FAKE_CLAUDE_HOME: claudeHome });
    const transcripts = transcriptsUnder(claudeHome);
    expect(transcripts).toHaveLength(1);
    readFileSync(transcripts[0], 'utf8')
      .split('\n')
      .forEach((line, index) => expectNoToken(`linha ${index + 1} do transcript`, line, token));
  });
});
