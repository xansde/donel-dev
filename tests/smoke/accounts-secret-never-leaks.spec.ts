import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';
import { refuseIfRealClaudeHome } from './accountsCredentialGuard';

// T1128 (011-contas-e-provedores, etapa 1) — varredura de TODOS os payloads
// de leitura dos `ACCOUNT_CHANNELS` (list/getConfig) e do evento
// `accounts:changed`, procurando o segredo PLANTADO no formulário de conectar
// (T1124), nunca lido de volta. Inclui a superfície visível do DOM (o
// formulário write-only nunca ecoa o que foi digitado).

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');
const FIXTURE_PATH = path.join(__dirname, '../fixtures/accounts-fake-mod.json');
const PLANTED_SECRET = 'PLANTED-SECRET-xJ9k2m-nunca-deve-vazar';

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let claudeHomeParent: string;

function assertNoLeak(payload: unknown): void {
  expect(JSON.stringify(payload)).not.toContain(PLANTED_SECRET);
}

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('accounts-secret-never-leaks');
  claudeHomeParent = mkdtempSync(path.join(tmpdir(), 'donel-accounts-smoke-secret-'));
  // G2 (batch n3) — cinto de segurança (ver accounts-switch.spec.ts): o
  // `claudeHome` real usado é `join(claudeHomeParent, '.claude')`, setado
  // dentro do teste — checa aqui, cedo, antes até de abrir o Electron.
  refuseIfRealClaudeHome(join(claudeHomeParent, '.claude'));

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
  rmSync(claudeHomeParent, { recursive: true, force: true });
});

test('T1128 — segredo plantado no connectMod nunca aparece em list/getConfig/changed nem no DOM', async () => {
  test.setTimeout(60_000);

  await appWindow.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), join(claudeHomeParent, '.claude'));

  // `accounts:changed` é um evento PUSH — assina ANTES de conectar pra capturar o primeiro disparo.
  await appWindow.evaluate(() => {
    (window as unknown as { __accountsChangedPayloads: unknown[] }).__accountsChangedPayloads = [];
    window.donel.accounts.onChanged((view) => {
      (window as unknown as { __accountsChangedPayloads: unknown[] }).__accountsChangedPayloads.push(view);
    });
  });

  const connectOutcome = await appWindow.evaluate(
    (secret) =>
      window.donel.accounts.connectMod({ mod: 'local', label: 'Conta com segredo', accessToken: secret, refreshToken: secret, expiresAt: Date.now() + 3600_000 }),
    PLANTED_SECRET,
  );
  expect(connectOutcome.kind).toBe('connected');
  assertNoLeak(connectOutcome); // `ConnectModOutcome.connected.config` nunca carrega segredo.

  const listView = await appWindow.evaluate(() => window.donel.accounts.list());
  assertNoLeak(listView);

  const getConfigView = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  assertNoLeak(getConfigView);

  await appWindow.evaluate(() => window.donel.accounts.switch('acc-alfa'));

  const listAfterSwitch = await appWindow.evaluate(() => window.donel.accounts.list());
  assertNoLeak(listAfterSwitch);

  const changedPayloads = await appWindow.evaluate(() => (window as unknown as { __accountsChangedPayloads: unknown[] }).__accountsChangedPayloads);
  assertNoLeak(changedPayloads);
  expect((changedPayloads as unknown[]).length).toBeGreaterThan(0); // prova que o evento de fato disparou (a varredura não é vazia por acaso).

  // T1124 — o formulário write-only: o DOM inteiro nunca contém o segredo digitado.
  const bodyHtml = await appWindow.evaluate(() => document.body.innerHTML);
  expect(bodyHtml).not.toContain(PLANTED_SECRET);
});
