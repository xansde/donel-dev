import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';

// 014-chat, T068/T070 - smoke do pe de trabalho e da faixa "o terminal precisa de voce" (Fase 3),
// contra o `claude` FALSO (nunca o CLI real). O prompt e digitado no terminal: a caixa do chat e de outra frente.

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/chat/scenarios/working.json');

let chat: ChatApp;
let page: Page;
let helpers: ReturnType<typeof chatHelpers>;

test.beforeAll(async () => {
  chat = await launchChatApp({ name: 'chat-working', scenario: SCENARIO });
  page = chat.window;
  helpers = chatHelpers(page);
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await chat.dispose();
});

const footer = () => page.getByTestId('working-footer');

test('T068 - pe de trabalho: acao em gerundio, Parar interrompe, Esc no chat tambem, "Interrompido" @chat', async () => {
  test.setTimeout(180_000);
  await launchClaudeTab(page, {});
  await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
  await helpers.waitForFakeFooter();

  // Round 1: the footer shows the action (gerund) and Parar stops the round.
  await helpers.typeInTerminal('rodar os testes');
  await helpers.showView('chat');
  await expect(footer()).toHaveAttribute('data-state', 'working', { timeout: 20_000 });
  await expect(footer()).toContainText('trabalhando');
  await expect(footer()).toContainText('Rodando');
  await expect(footer()).toContainText('npm test');
  await helpers.shot('t068-01-trabalhando');
  await page.getByRole('button', { name: 'Parar' }).click();
  await expect(footer()).toHaveAttribute('data-state', 'interrupted', { timeout: 20_000 });
  await expect(footer()).toContainText('Interrompido');
  await expect(footer()).toContainText('depois de');
  await helpers.shot('t068-02-interrompido');

  // Round 2: Esc with the focus on the chat view is Parar too.
  await helpers.typeInTerminal('rodar de novo');
  await helpers.showView('chat');
  await expect(footer()).toHaveAttribute('data-state', 'working', { timeout: 20_000 });
  await page.locator('[data-testid="chat-view"]:visible').focus();
  await page.keyboard.press('Escape');
  await expect(footer()).toHaveAttribute('data-state', 'interrupted', { timeout: 20_000 });
});

test('T070 - faixa "o terminal precisa de voce": tela de dialogo, Abrir terminal, some ao voltar a caixa @chat', async () => {
  test.setTimeout(120_000);
  await helpers.typeInTerminal('/pick');
  await helpers.showView('chat');
  const strip = page.getByTestId('terminal-needed-text');
  await expect(strip).toContainText('tela que só funciona lá', { timeout: 15_000 });
  await helpers.shot('t070-01-faixa');

  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await expect(page.locator('[data-testid="terminal-pane"]:visible')).toBeVisible();
  await page.locator('[data-testid="terminal-pane"]:visible').click();
  await page.keyboard.press('Escape'); // closes the fake dialog: the input box is back
  await helpers.showView('chat');
  await expect(strip).toHaveCount(0, { timeout: 15_000 });
});
