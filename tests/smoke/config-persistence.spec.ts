import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchIsolatedApp } from './helpers/launch';
import { PROJECT_NAME } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Smoke da T015 (ConfigStore + statusbar — FR-007, FR-009): prova de
// persistência REAL através de um restart COMPLETO do app (fechar + reabrir
// via `electronApp.close()` + `electron.launch()` de novo), não só
// re-render — é o requisito explícito do DoD da task ("preferências
// sobrevivem a restart") e do roteiro E2E batch 5, passo 1.
//
// Cobre as DUAS preferências NOVAS deste batch pela UI de Preferências de
// verdade (gear icon no titlebar): roots de projetos (add + remove) e
// notificação do Windows. `launcherDefaults` e o favorito do projeto sob teste
// são verificados via `window.donel.config.*`/`window.donel.projects.*` direto
// (`evaluate`), sem passar pela UI de lançamento real — abrir uma sessão
// `claude` de verdade custaria cota e não é necessário pra provar persistência
// do CAMPO.
//
// 011-contas-e-provedores, etapa 3 (13/09/2026) — este smoke deixou de ser a
// exceção de `userDataIsolation.ts`. Ele subia o app contra o userData REAL
// (`%APPDATA%\donel-dev`) para provar o path de produção, e desde a Fase 1 das
// contas o boot faz trabalho de verdade ali: a faxina do cofre e a varredura
// de `accounts-login-*`. Às 17:53 de 13/09 esse boot limpou o cofre real da
// máquina do dono no meio da suíte. Agora a persistência é provada num
// `--user-data-dir` isolado, reaproveitado entre as duas execuções do app, e o
// path de produção é conferido pelos ingredientes que o compõem — nome do app
// e `appData` — sem nada ser gravado nele.

// Nome do APP (`app.setName`, src/main/index.ts), não da pasta do repo —
// constante em qualquer worktree. É ele que compõe o userData de produção.
const APP_NAME = 'donel-dev';
const TEST_ROOT = 'C:\\donel-dev-smoke-t015-root';
const NEW_LAUNCHER_DEFAULTS = { model: 'haiku', effort: 'low', permissionMode: 'plan' } as const;

const NOTIFICATION_LABELS: Record<string, string> = {
  all: 'Todas as transições',
  'permission-only': 'Só permissão pendente',
  none: 'Nenhuma',
};

interface ConfigSnapshot {
  projectRoots: string[];
  notificationPreference: 'all' | 'permission-only' | 'none';
  launcherDefaults: { model: string; effort: string; permissionMode: string };
}

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let original: ConfigSnapshot;
let donelDevPath = '';

// Copia campo a campo pra um shape MUTÁVEL (config-store.ts devolve
// `readonly`) — evita fricção de tipos nas asserções deste teste.
async function readConfig(win: Page): Promise<ConfigSnapshot> {
  const config = await win.evaluate(() => window.donel.config.get());
  return {
    projectRoots: [...config.projectRoots],
    notificationPreference: config.notificationPreference,
    launcherDefaults: { ...config.launcherDefaults },
  };
}

async function openPreferences(win: Page): Promise<import('@playwright/test').Locator> {
  await win.getByRole('button', { name: 'Preferências' }).click();
  const dialog = win.getByRole('dialog', { name: 'Preferências' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function launchApp(): Promise<void> {
  ({ app: electronApp, window: appWindow } = await launchIsolatedApp({ userDataDir }));
}

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('config-persistence');
  await launchApp();

  original = await readConfig(appWindow);
  const projectsBefore = await appWindow.evaluate(() => window.donel.projects.list());
  donelDevPath = projectsBefore.find((project) => project.name === PROJECT_NAME)?.path ?? '';
});

test.afterAll(async () => {
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
  }
});

test('o app grava no userData isolado, e o de produção seria <appData>\\<nome do app> — sem tocar nele @config', async () => {
  const paths = await electronApp.evaluate(({ app }) => ({
    name: app.getName(),
    appData: app.getPath('appData'),
    userData: app.getPath('userData'),
  }));

  // O `--user-data-dir` venceu: tudo que este spec grava fica na pasta temporária.
  expect(path.resolve(paths.userData).toLowerCase()).toBe(path.resolve(userDataDir).toLowerCase());

  // Sem o override, o Electron usa `<appData>\<nome do app>`. Conferir os dois
  // ingredientes prova o path de produção (`%APPDATA%\donel-dev`) sem abrir o
  // app nele — é lá que moram o cofre e as contas reais do dono.
  expect(paths.name).toBe(APP_NAME);
  expect(path.resolve(paths.appData).toLowerCase()).toBe(path.resolve(String(process.env.APPDATA)).toLowerCase());
});

test('preferências (roots, notificação, launcher defaults, favoritos, cor/ordem de aba — ex-tabs-v3 CA-27) sobrevivem a fechar e reabrir o app @config', async () => {
  test.setTimeout(90_000);

  const targetPreference = original.notificationPreference === 'all' ? 'none' : 'all';

  // 1. Roots + notificação — pela UI de Preferências de verdade.
  let dialog = await openPreferences(appWindow);

  await dialog.getByLabel('Nova pasta-raiz').fill(TEST_ROOT);
  await dialog.getByRole('button', { name: 'Adicionar' }).click();
  await expect(dialog.getByText(TEST_ROOT)).toBeVisible();

  const notificationWrap = dialog.getByTestId('notification-preference-select');
  await notificationWrap.getByRole('button', { name: NOTIFICATION_LABELS[original.notificationPreference] }).click();
  await appWindow.getByRole('option', { name: NOTIFICATION_LABELS[targetPreference] }).click();
  await expect(notificationWrap.getByRole('button', { name: NOTIFICATION_LABELS[targetPreference] })).toBeVisible();

  await appWindow.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 2. launcherDefaults + favorito — via API direta (evaluate), sem spawnar
  // sessão real (custaria cota — não necessário pra provar persistência do campo).
  await appWindow.evaluate((defaults) => window.donel.config.setLauncherDefaults(defaults as never), NEW_LAUNCHER_DEFAULTS);
  if (donelDevPath) await appWindow.evaluate((p) => window.donel.projects.setFavorite(p, true), donelDevPath);

  // 3. Confirma no ARQUIVO antes do restart (roteiro batch 5, passo 1:
  // "confirmar também que config.json existe e reflete os valores") — o do
  // userData isolado, que é o que o app está usando.
  const configPath = path.join(userDataDir, 'config.json');
  await expect(async () => {
    expect(existsSync(configPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(onDisk.projectRoots).toContain(TEST_ROOT);
    expect(onDisk.notificationPreference).toBe(targetPreference);
    expect(onDisk.launcherDefaults).toEqual(NEW_LAUNCHER_DEFAULTS);
  }).toPass({ timeout: 5_000 });

  // CA-27 (moved from tabs-v3): tab color and order go through the same restart.
  // Direct persistence API, because the app is born with zero tabs.
  const tabSessionId = randomUUID();
  await appWindow.evaluate(({ id }) => window.donel.tabs.setColor(id, 'accent'), { id: tabSessionId });
  await appWindow.evaluate(({ id }) => window.donel.tabs.setOrder(id, 2), { id: tabSessionId });
  const tabBeforeRestart = await appWindow.evaluate(() => window.donel.config.get());
  expect(tabBeforeRestart.tabAppearance[tabSessionId]).toEqual({ color: 'accent', order: 2 });

  // 4. Restart COMPLETO — fecha o processo inteiro e relança do zero, no MESMO userData.
  await electronApp.close();
  await launchApp();

  const tabAfterRestart = await appWindow.evaluate(() => window.donel.config.get());
  expect(tabAfterRestart.tabAppearance[tabSessionId]).toEqual({ color: 'accent', order: 2 });

  // A color change keeps the order; an invalid payload is ignored (sanitized by the main process).
  await appWindow.evaluate(({ id }) => window.donel.tabs.setColor(id, 'permission'), { id: tabSessionId });
  const afterColorChange = await appWindow.evaluate(() => window.donel.config.get());
  expect(afterColorChange.tabAppearance[tabSessionId]).toEqual({ color: 'permission', order: 2 });
  await appWindow.evaluate(
    ({ id }) => window.donel.tabs.setColor(id, 'roxo-inventado' as unknown as Parameters<typeof window.donel.tabs.setColor>[1]),
    { id: tabSessionId },
  );
  const afterInvalidPayload = await appWindow.evaluate(() => window.donel.config.get());
  expect(afterInvalidPayload.tabAppearance[tabSessionId]).toEqual({ color: 'permission', order: 2 });

  // 5. Verifica tudo persistiu — via API (config.json relido do disco, sem cache de processo).
  const afterRestart = await readConfig(appWindow);
  expect(afterRestart.projectRoots).toContain(TEST_ROOT);
  expect(afterRestart.notificationPreference).toBe(targetPreference);
  expect(afterRestart.launcherDefaults).toEqual(NEW_LAUNCHER_DEFAULTS);

  const projectsAfter = await appWindow.evaluate(() => window.donel.projects.list());
  if (donelDevPath) expect(projectsAfter.find((project) => project.name === PROJECT_NAME)?.favorite).toBe(true);

  // 6. UI também reflete (reabre Preferências na instância NOVA do app).
  dialog = await openPreferences(appWindow);
  await expect(dialog.getByText(TEST_ROOT)).toBeVisible();
  await expect(
    dialog.getByTestId('notification-preference-select').getByRole('button', { name: NOTIFICATION_LABELS[targetPreference] }),
  ).toBeVisible();

  // 7. Remoção de root também funciona pela UI (não só adição).
  await dialog.getByRole('button', { name: `Remover pasta ${TEST_ROOT}` }).click();
  await expect(dialog.getByText(TEST_ROOT)).toHaveCount(0);

  await appWindow.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
