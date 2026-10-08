import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';
import { refuseIfRealClaudeHome } from './accountsCredentialGuard';

// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — o caminho de ponta a
// ponta de "Adicionar conta" por LOGIN ISOLADO (plan-etapa-3.md §4.2), com um
// `claude` FALSO (nunca o CLI real — regra dura da etapa): dois seams, mesmo
// espírito de `DONEL_ACCOUNTS_FAKE_MOD_FIXTURE`.
//
// - `DONEL_CLAUDE_EXECUTABLE_FIXTURE` aponta pro `claude.cmd` falso deste
//   diretório (`resolveClaudeExecutable` prefere QUALQUER `claude.exe` real
//   do PATH a um shim — só apontar o seam garante que é ESTE `claude` que
//   abre, nunca o de verdade).
// - `DONEL_ACCOUNTS_FAKE_MOD_FIXTURE` (com `includeConfiguredLocalAccounts`)
//   deixa listar/trocar pra conta que o login isolado grava DE VERDADE em
//   `localAccounts` — sem isso o smoke não conseguiria trocar pra ela sem
//   abrir sessão real (item 4 da bateria do prompt da etapa).
//
// `claudeHome` de teste isolado via `setConfig` ANTES de qualquer troca
// (G2 — ver accountsCredentialGuard.ts): a troca (item 4) escreve de verdade
// em `accounts.claudeHome`, mesmo com o mod/list fixos pela fixture acima.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');
const MOD_FIXTURE_PATH = path.join(__dirname, '../fixtures/accounts-fake-mod-login.json');
const FAKE_CLAUDE_CMD_PATH = path.join(__dirname, 'fixtures/fake-claude-login/claude.cmd');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let claudeHomeParent: string;
let claudeHomeDir: string;

/** id da conta "Conta smoke" — capturado no 1º teste, usado pelos últimos. */
let contaSmokeId: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('accounts-add-login');
  claudeHomeParent = mkdtempSync(path.join(tmpdir(), 'donel-accounts-smoke-add-login-'));
  claudeHomeDir = join(claudeHomeParent, '.claude');
  // G2 (batch n3) — cinto de segurança (ver accounts-switch.spec.ts): recusa
  // rodar ANTES de qualquer IPC se `claudeHomeDir` resolver pra pasta real.
  refuseIfRealClaudeHome(claudeHomeDir);
  mkdirSync(claudeHomeParent, { recursive: true });
  writeFileSync(join(claudeHomeParent, '.claude.json'), JSON.stringify({ oauthAccount: { seeded: true } }), 'utf8');

  electronApp = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: APP_CWD,
    env: { ...process.env, DONEL_ACCOUNTS_FAKE_MOD_FIXTURE: MOD_FIXTURE_PATH, DONEL_CLAUDE_EXECUTABLE_FIXTURE: FAKE_CLAUDE_CMD_PATH },
  });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');

  // Isola o motor no claudeHome de teste ANTES de qualquer troca (item 4) —
  // nunca toca o ~/.claude real da máquina que roda o smoke.
  await appWindow.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), claudeHomeDir);
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
  rmSync(claudeHomeParent, { recursive: true, force: true });
});

test('painel sem Pool Seazone; login isolado adiciona "Conta smoke" sem reiniciar o app (F6 ponta a ponta) @contas', async () => {
  test.setTimeout(90_000);

  await appWindow.locator('[data-testid="accounts-panel-trigger"]').click();
  await expect(appWindow.locator('[data-testid="accounts-panel"]')).toBeVisible();
  await expect(appWindow.getByText('Pool Seazone')).toHaveCount(0);

  await appWindow.getByLabel('Rótulo da conta').fill('Conta smoke');
  await appWindow.getByTestId('accounts-login-start').click();

  // started -> onStartLogin abre a aba "Login · Conta smoke" e o modal fecha.
  const loginTab = appWindow.locator('[role="tab"][title^="Login · Conta smoke"]');
  await expect(loginTab).toBeVisible();
  await expect(appWindow.locator('[data-testid="accounts-panel"]')).toHaveCount(0);

  // A aba fecha sozinha: o `claude` falso escreve a credencial, o colhedor
  // mata o PTY e apaga o diretório efêmero (timeout generoso — login real
  // simulado, não instantâneo).
  await expect(loginTab).toHaveCount(0, { timeout: 20_000 });

  // O painel reabre com o resultado do login.
  await expect(appWindow.locator('[data-testid="accounts-panel"]')).toBeVisible();
  await expect(appWindow.getByTestId('accounts-login-result')).toHaveText('Conta «Conta smoke» adicionada.');

  // A linha existe SEM reiniciar o app — prova do F6 ponta a ponta.
  const row = appWindow.locator('[data-testid="account-row"]', { hasText: 'Conta smoke' });
  await expect(row).toBeVisible();

  // Nenhum diretório temporário do login sobrou no userData.
  const leftoverLoginDirs = readdirSync(userDataDir).filter((name) => name.startsWith('accounts-login-'));
  expect(leftoverLoginDirs).toEqual([]);

  // `accounts-vault.json` tem a chave do id novo, e a conta tem fingerprint
  // (o fake `.claude.json` escreveu um `accountUuid`).
  const config = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  const added = config.localAccounts.find((account) => account.label === 'Conta smoke');
  expect(added).toBeTruthy();
  contaSmokeId = added!.id;
  expect(added!.fingerprint).toBeTruthy();

  const vault = JSON.parse(readFileSync(join(userDataDir, 'accounts-vault.json'), 'utf8')) as { entries: Record<string, string> };
  expect(Object.keys(vault.entries)).toContain(contaSmokeId);

  await appWindow.keyboard.press('Escape');
});

test('conta repetida (mesmo uuid falso) substitui o par — nunca duplica nem troca o rótulo existente @contas', async () => {
  test.setTimeout(90_000);

  const before = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  const countBefore = before.localAccounts.length;

  await appWindow.locator('[data-testid="accounts-panel-trigger"]').click();
  await appWindow.getByLabel('Rótulo da conta').fill('Outra');
  await appWindow.getByTestId('accounts-login-start').click();

  const loginTab = appWindow.locator('[role="tab"][title^="Login · Outra"]');
  await expect(loginTab).toBeVisible();
  await expect(loginTab).toHaveCount(0, { timeout: 20_000 });

  await expect(appWindow.locator('[data-testid="accounts-panel"]')).toBeVisible();
  await expect(appWindow.getByTestId('accounts-login-result')).toHaveText('«Outra» é a mesma conta que «Conta smoke» — a credencial dela foi renovada.');

  const after = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  expect(after.localAccounts.length).toBe(countBefore);
  expect(after.localAccounts.some((account) => account.label === 'Outra')).toBe(false);

  await appWindow.keyboard.press('Escape');
});

test('colar token com validade vazia adiciona "Conta colada"; confirmar remoção apaga da lista e do cofre @contas', async () => {
  await appWindow.locator('[data-testid="accounts-panel-trigger"]').click();
  await appWindow.getByLabel('Rótulo da conta').fill('Conta colada');
  await appWindow.getByTestId('accounts-paste-toggle').click();
  await appWindow.getByLabel('Access token').fill('pasted-access');
  await appWindow.getByLabel('Refresh token').fill('pasted-refresh');
  // Validade vazia de propósito (F2): não preenche accounts-paste-expires.
  await appWindow.getByTestId('accounts-paste-submit').click();

  const row = appWindow.locator('[data-testid="account-row"]', { hasText: 'Conta colada' });
  await expect(row).toBeVisible();

  const config = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  const added = config.localAccounts.find((account) => account.label === 'Conta colada');
  expect(added).toBeTruthy();
  const pastedId = added!.id;

  await row.getByTestId('account-remove').click();
  await row.getByTestId('account-remove-confirm').click();

  await expect(row).toHaveCount(0);

  const vaultAfter = JSON.parse(readFileSync(join(userDataDir, 'accounts-vault.json'), 'utf8')) as { entries: Record<string, string> };
  expect(Object.keys(vaultAfter.entries)).not.toContain(pastedId);

  const configAfter = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  expect(configAfter.localAccounts.some((account) => account.id === pastedId)).toBe(false);

  await appWindow.keyboard.press('Escape');
});

test('trocar para "Conta smoke" e tentar remover a conta ativa mostra o bloqueio, sem tirá-la da lista @contas', async () => {
  test.setTimeout(30_000);

  const switchOutcome = await appWindow.evaluate((id) => window.donel.accounts.switch(id), contaSmokeId);
  expect(switchOutcome.kind).toBe('switched');

  await appWindow.locator('[data-testid="accounts-panel-trigger"]').click();
  const row = appWindow.locator('[data-testid="account-row"]', { hasText: 'Conta smoke' });
  await expect(row).toBeVisible();

  await row.getByTestId('account-remove').click();
  await row.getByTestId('account-remove-confirm').click();

  await expect(row.getByTestId('account-remove-blocked')).toContainText('troque para outra antes de removê-la');
  // A tela NÃO desabilita o Remover da ativa — quem bloqueia é o main; a
  // linha continua na lista (nada foi removido).
  await expect(row).toBeVisible();

  await appWindow.keyboard.press('Escape');
});
