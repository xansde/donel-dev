import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeIsolatedApp } from './helpers/launch';
import { createIsolatedUserDataDir } from './userDataIsolation';

// T1216 (011-contas-e-provedores, etapa 2) — assistente de migração:
// árvore de perfis FALSA em `mkdtemp`, isolada do `homedir()` e do
// `%APPDATA%` reais (regra dura desta etapa — nenhum teste toca
// `~/.claude-profiles`/`~/.claude` de verdade). O isolamento reaproveita o
// MESMO seam de `accounts.claudeHome` que `accounts-switch.spec.ts` já usa:
// `migrationHomedir()` (main/index.ts) deriva a raiz falsa de
// `dirname(claudeHome override)`.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let fakeHomeRoot: string;
let claudeHomeDir: string;
let profilesRoot: string;

function seedProfile(slug: string, displayName: string): void {
  const profileDir = join(profilesRoot, slug);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, '.donel-profile.json'), JSON.stringify({ name: displayName }), 'utf8');
  writeFileSync(
    join(profileDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: `fake-access-${slug}`, refreshToken: `fake-refresh-${slug}`, expiresAt: Date.now() + 3600_000, scopes: [] } }),
    'utf8',
  );
}

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('migration-wizard');
  fakeHomeRoot = mkdtempSync(path.join(tmpdir(), 'donel-migration-smoke-'));
  claudeHomeDir = join(fakeHomeRoot, '.claude');
  profilesRoot = join(fakeHomeRoot, '.claude-profiles');
  mkdirSync(claudeHomeDir, { recursive: true });
  mkdirSync(join(claudeHomeDir, 'projects'), { recursive: true });

  seedProfile('acc-1', 'Conta 1');
  seedProfile('acc-2', 'Conta 2');

  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: APP_CWD });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
  // Isola o motor/migração no home falso ANTES de qualquer scan (nunca toca ~/.claude-profiles real).
  await appWindow.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), claudeHomeDir);
});

test.afterAll(async () => {
  await closeIsolatedApp({ app: electronApp, userDataDir });
  rmSync(fakeHomeRoot, { recursive: true, force: true });
});

test('T1216 — inventário aparece, importar UM perfil deixa o outro pendente, estado persiste ao reabrir @contas', async () => {
  test.setTimeout(60_000);

  const firstScan = await appWindow.evaluate(() => window.donel.migration.scan());
  expect(firstScan.entries.map((e) => e.slug).sort()).toEqual(['acc-1', 'acc-2']);
  expect(firstScan.entries.every((e) => e.credentials === 'pending')).toBe(true);
  expect(firstScan.canArchive).toBe(false);

  const importResult = await appWindow.evaluate(() => window.donel.migration.importCredentials('acc-1'));
  expect(importResult.kind).toBe('imported');

  const afterImport = await appWindow.evaluate(() => window.donel.migration.scan());
  const acc1 = afterImport.entries.find((e) => e.slug === 'acc-1');
  const acc2 = afterImport.entries.find((e) => e.slug === 'acc-2');
  expect(acc1?.credentials).toBe('imported');
  expect(acc2?.credentials).toBe('pending');
  expect(afterImport.canArchive).toBe(false); // acc-2 ainda pending

  // "Reabrir o assistente" — nova leitura (`scan`) mostra o mesmo estado persistido.
  const reopened = await appWindow.evaluate(() => window.donel.migration.scan());
  expect(reopened.entries.find((e) => e.slug === 'acc-1')?.credentials).toBe('imported');
});

test('T1216 — painel de contas mostra a entrada do assistente e a tela renderiza @contas', async () => {
  const trigger = appWindow.locator('[data-testid="accounts-panel-trigger"]');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const openMigration = appWindow.locator('[data-testid="accounts-open-migration"]');
  await expect(openMigration).toBeVisible();
  await openMigration.click();

  await expect(appWindow.locator('[data-testid="migration-wizard"]')).toBeVisible();
  const rows = appWindow.locator('[data-testid="migration-row"]');
  await expect(rows).toHaveCount(2);

  await appWindow.locator('[data-testid="migration-close"]').click();
  await appWindow.keyboard.press('Escape');
});
