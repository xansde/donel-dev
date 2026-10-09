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

test('Esc antes da resposta: cartão "interrompida", texto volta para a caixa e a fila segue @chat', async () => {
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

    // Parar: o pé mostra "parando…" enquanto o falso devolve o texto à caixa dele.
    await page.getByRole('button', { name: 'Parar' }).click();
    await expect(page.getByRole('button', { name: 'parando…' })).toBeDisabled();
    // O falso nao dispara o Stop (o CLI real tambem nao): o estado segue "trabalhando" e, vencido o teto, o pe avisa.
    await expect(page.getByTestId('working-footer-stuck')).toContainText('o Claude não parou', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Parar' })).toBeEnabled();

    // A mensagem seguinte encontra a sobra, que é o texto devolvido: nada de faixa, texto de volta na caixa do chat.
    await input(page).fill('segunda mensagem');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('interrompida')).toBeVisible({ timeout: 30_000 });
    await expect(timeline(page).getByText('o texto voltou para a caixa')).toBeVisible();
    await expect(input(page)).toHaveValue('cancelavel teste grande', { timeout: 10_000 });
    await expect(page.getByText('Há texto não enviado no terminal')).toHaveCount(0);
    await expect(timeline(page).getByText('segunda mensagem')).toBeVisible();
    await expect(timeline(page).getByText('na fila', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await helpers.shot('interrupt-early-01');
  } finally {
    await chat.dispose();
  }
});
