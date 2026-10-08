import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';

// FIX (teste manual da T1325, 2026-08-04 — issue 09 de contas-e-provedores):
// digitar em qualquer campo do painel "Provedores" roubava o foco para o
// primeiro focável do diálogo (o TextInput "Nome"). Causa: o efeito de foco
// do Modal (design-system) dependia de `onClose`, que o ProviderForm recria
// a cada render — cada tecla re-rodava o efeito e re-focava o primeiro
// campo. O contrato agora é: o foco inicial acontece UMA vez por abertura;
// re-renders com o modal aberto nunca movem o foco de onde o usuário está.


let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ name: 'modal-focus-steal' }));
});

test.afterAll(async () => {
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('digitar num campo do painel Provedores não move o foco para o campo Nome @provedores', async () => {
  await appWindow.click('[data-testid="providers-panel-trigger"]');
  await appWindow.waitForSelector('[data-testid="providers-panel"]');

  const envInput = appWindow.locator('[data-testid="provider-env-input"]');
  await envInput.click();
  await appWindow.keyboard.type('ANTHROPIC_BASE_URL=https://exemplo.invalido/api', { delay: 15 });

  // Com o bug, a primeira tecla re-rodava o efeito de foco do Modal e as
  // teclas seguintes caíam no TextInput "Nome": o textarea ficava com 1
  // caractere e o foco em outro lugar.
  await expect(envInput).toBeFocused();
  await expect(envInput).toHaveValue('ANTHROPIC_BASE_URL=https://exemplo.invalido/api');
});
