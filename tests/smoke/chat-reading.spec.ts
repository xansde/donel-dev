import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { confirmCloseModalIfOpen, launchClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';

// 014-chat, T059 - smoke de LEITURA do chat (Fase 2), contra o `claude` FALSO
// roteirizado (T040): nunca o CLI real, nenhum turno de API. `chat.enabled` e
// semeado no config.json do userData isolado antes do launch (ver chatSmoke.ts).
//
// Prova: a aba abre no chat; markdown, tabela e codigo (Shiki) renderizados;
// copiar bloco e resposta; alternar chat <-> terminal 10x preserva a sessao;
// aviso depois de /clear; /exit -> barra "Sessao encerrada" + Retomar.

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/chat/scenarios/reading.json');

let chat: ChatApp;
let page: Page;
let helpers: ReturnType<typeof chatHelpers>;

test.beforeAll(async () => {
  chat = await launchChatApp({ name: 'chat-reading', scenario: SCENARIO });
  page = chat.window;
  helpers = chatHelpers(page);
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await chat.dispose();
});

const launched = { get app() { return chat.app; } };
const viewSwitch = () => helpers.viewSwitch();
const timeline = () => helpers.timeline();
const showView = (v: 'chat' | 'terminal') => helpers.showView(v);
const typeInTerminal = (t: string) => helpers.typeInTerminal(t);
const shot = (n: string) => helpers.shot(n);

test('T059 - leitura: markdown, tabela, codigo, copiar, alternar 10x, /clear e fim de sessao @chat', async () => {
  test.setTimeout(240_000);

  // 1. A claude tab opens on the chat view.
  const tab = await launchClaudeTab(page, {});
  await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
  await expect(viewSwitch()).toBeVisible();
  await expect(page.getByTestId('chat-empty')).toBeVisible();

  // The fake only draws its footer once booted: wait in the terminal view, then prompt.
  await showView('terminal');
  const pane = page.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    expect(await pane.innerText()).toContain('shortcuts');
  }).toPass({ timeout: 30_000 });
  await typeInTerminal('leitura do modulo atlas');
  await showView('chat');

  // 2. Markdown, table and code are rendered (not raw source).
  const answer = page.getByRole('article', { name: 'Resposta do Claude' });
  await expect(answer).toHaveCount(1, { timeout: 30_000 });
  await expect(answer.getByRole('heading', { name: 'Resumo do atlas' })).toBeVisible();
  await expect(answer.getByRole('table')).toBeVisible();
  await expect(answer.getByRole('cell', { name: 'sem pendências' })).toBeVisible();
  await expect(answer.getByText('segundo item com')).toBeVisible();
  const codeBlock = answer.locator('pre').first();
  await expect(codeBlock).toContainText('export function sum');
  // Shiki applied: tokens carry an inline color from the theme tokens.
  await expect(async () => {
    const colored = await codeBlock.locator('span[style*="color"]').count();
    expect(colored).toBeGreaterThan(2);
  }).toPass({ timeout: 15_000 });
  const tokenColors = await codeBlock.locator('span[style*="color"]').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.color),
  );
  expect(tokenColors.some((c) => c.includes('var(--code-') || c.startsWith('rgb') || c.startsWith('#'))).toBe(true);

  // Work rows: the failed action shows up, thinking too.
  await expect(timeline()).toContainText('cat beacon/missing.ts');
  await shot('01-leitura-markdown');

  // 3. Copy block and copy answer (clipboard read in the main process).
  await answer.getByRole('button', { name: 'Copiar bloco de código' }).click();
  await expect
    .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('export function sum(a: number, b: number): number {');
  await answer.getByRole('button', { name: /Copiar resposta/ }).click();
  await expect
    .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('## Resumo do atlas');
  const copied = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toContain('| atlas | ok | sem pendências |');
  expect(copied).toContain('```ts');

  // 4. Switch chat <-> terminal 10x (button and Ctrl+`) keeps the session.
  for (let i = 0; i < 5; i += 1) {
    await viewSwitch().getByText('Terminal', { exact: true }).click();
    await expect(page.locator('[data-testid="terminal-pane"]:visible')).toBeVisible();
    await viewSwitch().getByText('Chat', { exact: true }).click();
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible();
  }
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Control+`');
    await expect(page.locator('[data-testid="terminal-pane"]:visible')).toBeVisible();
    await page.keyboard.press('Control+`');
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible();
  }
  await expect(answer).toHaveCount(1);
  await expect(answer.getByRole('table')).toBeVisible();
  await expect(tab).toBeVisible();
  await expect(page.getByTestId('chat-session-ended')).toHaveCount(0);
  // The same fake process still answers: a second prompt lands in the same conversation.
  await typeInTerminal('oi');
  await showView('chat');
  await expect(timeline().getByText('Olá! Tudo certo por aqui.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('article', { name: 'Resposta do Claude' })).toHaveCount(2);
  await shot('02-depois-de-alternar');

  // 5. Modo Foco: the work folds into one bar.
  await page.getByTestId('chat-focus-toggle').getByRole('switch').click();
  await expect(page.getByText(/trabalhou —/).first()).toBeVisible();
  await shot('03-modo-foco');
  await page.getByTestId('chat-focus-toggle').getByRole('switch').click();

  // 6. /clear typed in the terminal view: the chat shows the new conversation notice.
  await typeInTerminal('/clear');
  await showView('chat');
  await expect(page.getByText(/Conversa nova/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('article', { name: 'Resposta do Claude' })).toHaveCount(0);
  await shot('04-depois-do-clear');

  // 7. /exit -> "Sessao encerrada" bar; Retomar brings the session back.
  await typeInTerminal('/exit');
  await showView('chat');
  const ended = page.getByTestId('chat-session-ended');
  await expect(ended).toBeVisible({ timeout: 20_000 });
  await expect(ended).toContainText('Sessão encerrada');
  await shot('05-sessao-encerrada');
  await ended.getByRole('button', { name: 'Retomar' }).click();
  await expect(ended).toBeHidden({ timeout: 30_000 });
  await showView('terminal');
  await expect(async () => {
    expect(await page.locator('[data-testid="terminal-pane"]:visible').innerText()).toContain('shortcuts');
  }).toPass({ timeout: 30_000 });

  // Close the tab.
  await tab.getByRole('button', { name: /^Fechar aba/ }).click();
  await confirmCloseModalIfOpen(page);
  await expect(page.locator('[role="tab"]')).toHaveCount(0);
});
