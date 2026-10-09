import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';

// 014-chat, alfa-4 item 4 - Esc antes da primeira resposta (e2e do dono, 09/10, teste 19.5), contra o `claude`
// FALSO: a mensagem "cancelavel" faz o falso devolver o texto a SUA caixa quando o Esc chega antes da resposta
// (como o CLI real). O chat deve reconhecer o texto, limpar a caixa do terminal, pôr o texto de volta na caixa
// do chat, marcar o cartão como interrompido e deixar a mensagem seguinte sair (sem o faixa de sobra).

const input = (page: Page): Locator => page.locator('[data-testid="chat-composer-input"]:visible');
const timeline = (page: Page): Locator => page.locator('[data-testid="chat-timeline"]:visible');

test('Esc antes da resposta: texto volta, cartão "interrompida" e a mensagem seguinte sai sem faixa @chat', async () => {
  test.setTimeout(180_000);
  const chat = await launchChatApp({ name: 'chat-interrupt-early' });
  const page = chat.window;
  const helpers = chatHelpers(page);
  try {
    await launchClaudeTab(page, {});
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await expect(input(page)).toBeFocused({ timeout: 10_000 });
    await helpers.waitForFakeFooter();
    await helpers.showView('chat');

    await input(page).fill('cancelavel teste grande');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('working-footer')).toHaveAttribute('data-state', 'working', { timeout: 20_000 });

    // Parar: o falso devolve o texto a caixa dele; a tela encerra a rodada (o CLI nao dispara Stop) e o texto volta.
    await page.getByRole('button', { name: 'Parar' }).click();
    await expect(page.getByTestId('working-footer')).toHaveCount(0, { timeout: 15_000 });
    await expect(input(page)).toHaveValue('cancelavel teste grande', { timeout: 10_000 });
    await expect(timeline(page).getByText('interrompida')).toBeVisible();

    // A mensagem seguinte sai sem faixa de sobra: a caixa do terminal ja foi limpa.
    await input(page).fill('segunda mensagem');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('segunda mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(timeline(page).getByText('✓ entrou').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Há texto não enviado no terminal')).toHaveCount(0);
    await expect(timeline(page).getByText('na fila', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(timeline(page).getByText('interrompida')).toBeVisible();
    await helpers.shot('interrupt-early-01');
  } finally {
    await chat.dispose();
  }
});

test('Esc antes da resposta SEM mensagem seguinte: a tela encerra a rodada, o pé sai e o texto volta @chat', async () => {
  test.setTimeout(180_000);
  const chat = await launchChatApp({ name: 'chat-interrupt-early-alone' });
  const page = chat.window;
  const helpers = chatHelpers(page);
  try {
    await launchClaudeTab(page, {});
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await helpers.waitForFakeFooter();
    await helpers.showView('chat');

    await input(page).fill('cancelavel sozinha');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('working-footer')).toHaveAttribute('data-state', 'working', { timeout: 20_000 });

    await page.getByRole('button', { name: 'Parar' }).click();
    // Sem Stop hook (o CLI não o dispara): é a tela que encerra a rodada dentro da janela do pedido.
    await expect(page.getByTestId('working-footer')).toHaveCount(0, { timeout: 15_000 });
    await expect(input(page)).toHaveValue('cancelavel sozinha', { timeout: 10_000 });
    await expect(timeline(page).getByText('o texto voltou para a caixa')).toBeVisible();
    await expect(page.getByText('Há texto não enviado no terminal')).toHaveCount(0);
    await helpers.shot('interrupt-early-02-sozinha');
  } finally {
    await chat.dispose();
  }
});
