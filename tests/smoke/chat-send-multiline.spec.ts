import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';

// 014-chat, aceite dos achados do alfa de 08/10 (e2e.md, "Uso real no alfa" da Fase 3 e da Fase 4): envio
// MULTILINHA pelo chat, com e sem imagem, e uma linha unica longa. Antes da correcao (#97) o cartao ficava
// "nao foi - o texto nao entrou na caixa" porque `readInputBox` juntava as linhas da caixa sem separador e
// `textSeen` nunca igualava o rascunho. Contra o `claude` FALSO, que desenha a caixa como o CLI real:
// `❯ ` + 1a linha, continuacoes com recuo de 2 colunas, quebra no espaco (que some) pela largura do PTY.

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ~200 characters, with a double space and parentheses (the real case of the alfa).
const LONG_LINE =
  'Revise o modulo de reservas (arquivo principal e testes)  e confirme se o calculo da diaria considera a taxa de limpeza (quando houver), o desconto por estadia longa e a regra de cancelamento do parceiro';

const input = (page: Page): Locator => page.locator('[data-testid="chat-composer-input"]:visible');
const timeline = (page: Page): Locator => page.locator('[data-testid="chat-timeline"]:visible');

async function pasteImage(page: Page): Promise<void> {
  await input(page).focus();
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    const target = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]');
    target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG_BASE64);
}

function transcriptUserTexts(sessionsDir: string): string[] {
  const out: string[] = [];
  for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(path.join(sessionsDir, file), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
        if (entry.type !== 'user') continue;
        const content = entry.message?.content;
        out.push(typeof content === 'string' ? content : Array.isArray(content) ? content.map((b: { text?: string }) => b.text ?? '').join('') : '');
      } catch {
        // partial line while the fake is writing
      }
    }
  }
  return out;
}

async function withChat(name: string, body: (chat: ChatApp, page: Page) => Promise<void>): Promise<void> {
  const chat = await launchChatApp({ name });
  try {
    await launchClaudeTab(chat.window, {});
    await expect(chat.window.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await expect(input(chat.window)).toBeFocused({ timeout: 10_000 });
    await body(chat, chat.window);
  } finally {
    await chat.dispose();
  }
}

/**
 * After the card says "entrou" the CLI box must be empty (idle, no leftover text). With the statusline bridge on
 * the fake draws the footer WITHOUT hints (CLI 2.1.314), so the box row itself is read: the last `❯` row is bare.
 */
async function expectCliBoxClean(page: Page): Promise<void> {
  const helpers = chatHelpers(page);
  await helpers.showView('terminal');
  const pane = page.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    const text = await pane.innerText();
    expect(text).not.toContain('for shell mode');
    expect(text).not.toContain('Pondering…');
    const boxRows = text.split('\n').filter((row) => row.startsWith('❯'));
    expect(boxRows.at(-1)?.trim()).toBe('❯');
  }).toPass({ timeout: 10_000 });
  await helpers.showView('chat');
}

async function expectNoFailureCard(page: Page): Promise<void> {
  await expect(timeline(page).getByText('✕ não foi')).toHaveCount(0);
  await expect(timeline(page).getByText(/o texto não entrou na caixa/)).toHaveCount(0);
}

test('envio multilinha SEM imagem: entra inteiro, com as quebras, e a caixa fica limpa @chat', async () => {
  test.setTimeout(120_000);
  await withChat('chat-multiline', async (chat, page) => {
    await input(page).fill('linha um');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('linha dois');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('linha tres');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    await expectNoFailureCard(page);
    await expect.poll(() => transcriptUserTexts(chat.sessionsDir).includes('linha um\nlinha dois\nlinha tres'), { timeout: 15_000 }).toBe(true);
    await expectCliBoxClean(page);
    await chatHelpers(page).shot('multiline-01-sem-imagem-entrou');
  });
});

test('envio multilinha COM imagem: [Image #1] + as duas linhas, cartao "entrou" @chat', async () => {
  test.setTimeout(120_000);
  await withChat('chat-multiline-image', async (chat, page) => {
    await pasteImage(page);
    await expect(page.locator('[data-testid="chat-attachment"]:visible')).toHaveCount(1, { timeout: 10_000 });
    await input(page).fill('Estou rodando o e2e aqui');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('Descreva o que tem nessa imagem');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    await expectNoFailureCard(page);
    await expect
      .poll(
        () => transcriptUserTexts(chat.sessionsDir).some((t) => t.includes('[Image #1]') && t.includes('Estou rodando o e2e aqui\nDescreva o que tem nessa imagem')),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expectCliBoxClean(page);
    await chatHelpers(page).shot('multiline-02-com-imagem-entrou');
  });
});

test('linha unica longa (~200 caracteres, espaco duplo e parenteses): entra e a caixa fica limpa @chat', async () => {
  test.setTimeout(120_000);
  expect(LONG_LINE.length).toBeGreaterThanOrEqual(190);
  await withChat('chat-long-line', async (chat, page) => {
    await input(page).fill(LONG_LINE);
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    await expectNoFailureCard(page);
    await expect.poll(() => transcriptUserTexts(chat.sessionsDir).includes(LONG_LINE), { timeout: 15_000 }).toBe(true);
    await expectCliBoxClean(page);
    await chatHelpers(page).shot('multiline-03-linha-longa-entrou');
  });
});
