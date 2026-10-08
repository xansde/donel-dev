import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';
import { refuseIfRealClaudeHome } from './accountsCredentialGuard';

// T1126 (011-contas-e-provedores, etapa 1) — mod FALSO (via
// `DONEL_ACCOUNTS_FAKE_MOD_FIXTURE`, mesmo espírito de `DONEL_QUOTA_AXI_FIXTURE`),
// `claudeHome` TEMPORÁRIO isolado de `%APPDATA%`/`~/.claude` real: conectar
// -> listar -> trocar; confere que `.credentials.json` foi reescrito e que
// `oauthAccount` sumiu do `.claude.json` de teste. NUNCA abre sessão `claude`
// real (o mod é 100% em memória, sem rede).
//
// O `.claude.json` de teste é IRMÃO do `claudeHome` de teste de propósito: é
// assim que `applyAccountsClaudeStateSwitch` deriva o segundo alvo quando o
// override existe. Até 04/08/2026 ele saía direto de `homedir()`, e este
// smoke — que nunca tinha rodado — teria apagado o `oauthAccount` do
// `~/.claude.json` REAL da máquina, derrubando o login do CLI de quem o
// rodasse (e falhado a asserção mesmo assim). Achado da captura visual.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');
const FIXTURE_PATH = path.join(__dirname, '../fixtures/accounts-fake-mod.json');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let claudeHomeDir: string;
let claudeJsonPath: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('accounts-switch');
  const claudeHomeParent = mkdtempSync(path.join(tmpdir(), 'donel-accounts-smoke-claude-'));
  claudeHomeDir = join(claudeHomeParent, '.claude');
  claudeJsonPath = join(claudeHomeParent, '.claude.json');
  // G2 (batch n3) — cinto de segurança: recusa rodar ANTES de qualquer IPC
  // se `claudeHomeDir` por acaso resolver pra pasta real (ver comentário de
  // topo do arquivo — este smoke já causou o incidente uma vez).
  refuseIfRealClaudeHome(claudeHomeDir);
  // Seed: `.claude.json` de teste com `oauthAccount` presente (simula uma
  // sessão CLI já logada) + uma chave qualquer que TEM que sobreviver ao
  // switch — só assim o "oauthAccount sumiu, o resto ficou" é uma prova real.
  mkdirSync(claudeHomeParent, { recursive: true });
  writeFileSync(claudeJsonPath, JSON.stringify({ oauthAccount: { seeded: true }, mcpServers: { fake: { command: 'x' } } }), 'utf8');

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

test('T1126 — conectar, listar, trocar: .credentials.json reescrito e oauthAccount removido @contas', async () => {
  test.setTimeout(60_000);

  // Isola o motor no claudeHome de teste ANTES de conectar (nunca toca o
  // ~/.claude real da máquina que roda o smoke).
  await appWindow.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), claudeHomeDir);

  const connectOutcome = await appWindow.evaluate(() =>
    window.donel.accounts.connectMod({ mod: 'local', label: 'Conta de teste', accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3600_000 }),
  );
  expect(connectOutcome.kind).toBe('connected');

  const view = await appWindow.evaluate(() => window.donel.accounts.list());
  expect(view.state).toBe('ready');
  const ids = view.accounts.map((a) => a.id).sort();
  expect(ids).toEqual(['acc-alfa', 'acc-beta']);

  const switchOutcome = await appWindow.evaluate(() => window.donel.accounts.switch('acc-alfa'));
  expect(switchOutcome).toMatchObject({ kind: 'switched', to: 'acc-alfa' });

  // `.credentials.json` do claudeHome de TESTE recebeu o par da fixture.
  const credentials = JSON.parse(readFileSync(join(claudeHomeDir, '.credentials.json'), 'utf8'));
  expect(credentials.claudeAiOauth.accessToken).toBe('fixture-access-alfa');

  // `oauthAccount` sumiu do `.claude.json` de teste (o resto sobrevive).
  expect(readFileSync(claudeJsonPath, 'utf8')).not.toContain('oauthAccount');

  // Segunda troca: prova que o motor segue funcional e reescreve de novo.
  const secondSwitch = await appWindow.evaluate(() => window.donel.accounts.switch('acc-beta'));
  expect(secondSwitch).toMatchObject({ kind: 'switched', from: 'acc-alfa', to: 'acc-beta' });
  const credentialsAfter = JSON.parse(readFileSync(join(claudeHomeDir, '.credentials.json'), 'utf8'));
  expect(credentialsAfter.claudeAiOauth.accessToken).toBe('fixture-access-beta');
});

test('T1126 — painel AccountsPanel renderiza sem quebrar (motor já conectado) @contas', async () => {
  const trigger = appWindow.locator('[data-testid="accounts-panel-trigger"]');
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(appWindow.locator('[data-testid="accounts-panel"]')).toBeVisible();
  await appWindow.keyboard.press('Escape');
});
