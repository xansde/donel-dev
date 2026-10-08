import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';
import { refuseIfRealClaudeHome } from './accountsCredentialGuard';

// T1127 (011-contas-e-provedores, etapa 1, D6) — a promessa central da spec:
// MCP configurado UMA VEZ em `~/.claude.json` continua presente depois de
// DUAS trocas de conta. O motor só reescreve `.credentials.json` e apaga
// `oauthAccount` — nunca cria/aponta `CLAUDE_CONFIG_DIR` por conta (é o
// requisito cumprido por AUSÊNCIA de mecanismo, não por código novo; ver
// plan.md D6). Mesmo mod falso/claudeHome isolado de T1126.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');
const FIXTURE_PATH = path.join(__dirname, '../fixtures/accounts-fake-mod.json');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let claudeHomeDir: string;
let claudeJsonPath: string;

const SEEDED_MCP_SERVERS = { seazoneKb: { command: 'npx', args: ['-y', 'seazone-kb-mcp'] }, github: { command: 'npx', args: ['-y', '@github/mcp'] } };

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('accounts-mcp-survives');
  const claudeHomeParent = mkdtempSync(path.join(tmpdir(), 'donel-accounts-smoke-mcp-'));
  claudeHomeDir = join(claudeHomeParent, '.claude');
  claudeJsonPath = join(claudeHomeParent, '.claude.json');
  // G2 (batch n3) — cinto de segurança (ver accounts-switch.spec.ts).
  refuseIfRealClaudeHome(claudeHomeDir);
  mkdirSync(claudeHomeParent, { recursive: true });
  writeFileSync(claudeJsonPath, JSON.stringify({ oauthAccount: { seeded: true }, mcpServers: SEEDED_MCP_SERVERS, machineID: 'fixed-machine-id' }), 'utf8');

  electronApp = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: APP_CWD,
    env: { ...process.env, DONEL_ACCOUNTS_FAKE_MOD_FIXTURE: FIXTURE_PATH },
  });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
  rmSync(path.dirname(claudeHomeDir), { recursive: true, force: true });
});

test('T1127 — mcpServers sobrevive a duas trocas de conta seguidas @contas', async () => {
  test.setTimeout(60_000);

  await appWindow.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), claudeHomeDir);
  const connectOutcome = await appWindow.evaluate(() =>
    window.donel.accounts.connectMod({ mod: 'local', label: 'Conta de teste', accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3600_000 }),
  );
  expect(connectOutcome.kind).toBe('connected');

  await appWindow.evaluate(() => window.donel.accounts.switch('acc-alfa'));
  const afterFirstSwitch = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
  expect(afterFirstSwitch.mcpServers).toEqual(SEEDED_MCP_SERVERS);
  expect(afterFirstSwitch.machineID).toBe('fixed-machine-id'); // qualquer outra chave desconhecida também sobrevive.
  expect(afterFirstSwitch.oauthAccount).toBeUndefined();

  await appWindow.evaluate(() => window.donel.accounts.switch('acc-beta'));
  const afterSecondSwitch = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
  expect(afterSecondSwitch.mcpServers).toEqual(SEEDED_MCP_SERVERS);
  expect(afterSecondSwitch.machineID).toBe('fixed-machine-id');

  // Nenhum `CLAUDE_CONFIG_DIR` por conta foi criado — só existe o claudeHome de teste.
  const view = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  expect(view.claudeHome).toBe(claudeHomeDir);
});
