import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PROJECT_NAME, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir } from './userDataIsolation';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { openLauncherPanel } from './helpers/ui';

// Toggle "Navegador (Chrome/Edge)" do Launcher → `claude --chrome`.
// Roda com o `claude` falso (default de `launchIsolatedApp`): o que se prova é
// o argv montado pelo Launcher (hook `launcher-last-command`) e a lembrança da
// última escolha, igual a modelo/esforço/permissões (`launcherDefaults`). A
// trava com provedor de terceiro é coberta por `launchArgsForProvider.test.ts`.

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  // O root default do scanner (`~/seazone`) não lista uma worktree em
  // `.claude/worktrees/`: aponta para a pasta-mãe real do repo (mesmo
  // recurso de `favorite-sessions.spec.ts`).
  const dir = createIsolatedUserDataDir('launcher-chrome');
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ projectRoots: [path.dirname(REPO_ROOT)] }), 'utf8');
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ userDataDir: dir }));
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('Navegador ligado no Launcher acrescenta --chrome ao argv e fica lembrado no próximo Launcher @abas', async () => {
  test.setTimeout(90_000);

  const launcher = await openLauncherPanel(appWindow);
  const toggle = launcher.getByRole('switch', { name: /Navegador \(Chrome\/Edge\)/ });
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();

  await launcher.getByRole('button', { name: 'Selecione um projeto' }).click();
  await appWindow.getByRole('option', { name: PROJECT_NAME, exact: true }).click();
  await launcher.getByText('Navegador (Chrome/Edge)').click();
  await expect(toggle).toBeChecked();
  await launcher.getByLabel('Nome').fill('chrome-test');
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  await expect(appWindow.locator('[role="tab"]', { hasText: 'chrome-test' })).toBeVisible();
  await expect(appWindow.locator('[data-testid="launcher-last-command"]')).toHaveText(
    'claude --model fable --effort high --permission-mode acceptEdits -n chrome-test --chrome',
  );

  // Lembrado como os outros controles: o próximo Launcher já abre ligado.
  const again = await openLauncherPanel(appWindow);
  await expect(again.getByRole('switch', { name: /Navegador \(Chrome\/Edge\)/ })).toBeChecked();
  const onDisk = await appWindow.evaluate(() => window.donel.config.get());
  expect(onDisk.launcherDefaults.chrome).toBe(true);
});
