import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';

// 014-chat, T090 - smoke da CAIXA do chat na Fase 5 (menus `/` e `@`, ficha de colagem grande, selos `!` e
// `/login`), contra o `claude` FALSO: nunca o CLI real. A imagem tem smoke proprio (chat-composer-image.spec.ts).
//
// O HOME do app e temporario (chatSmoke.ts): a skill de disco do menu `/` nasce em `<home>/.claude/skills` e o
// menu `@` lista os arquivos do repositorio sob teste (git ls-files do cwd da aba).

const SKILL_NAME = 'zeta-revisar';
const SKILL_DESCRIPTION = 'Revisa a mudanca atual antes do PR (skill de teste do smoke).';

const input = (page: Page): Locator => page.locator('[data-testid="chat-composer-input"]:visible');
const timeline = (page: Page): Locator => page.locator('[data-testid="chat-timeline"]:visible');
const slashMenu = (page: Page): Locator => page.locator('[data-testid="chat-menu-slash"]:visible');
const pathMenu = (page: Page): Locator => page.locator('[data-testid="chat-menu-path"]:visible');
const options = (menu: Locator): Locator => menu.getByRole('option');

/** All text the transcripts of the fake hold in `user` lines (what the "CLI" really received). */
function transcriptTexts(sessionsDir: string): string[] {
  const out: string[] = [];
  for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(path.join(sessionsDir, file), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown }; content?: unknown };
        const content = entry.message?.content ?? entry.content;
        if (typeof content === 'string') out.push(content);
        else if (Array.isArray(content)) out.push(content.map((b: { text?: string }) => b.text ?? '').join(''));
      } catch {
        // partial line while the fake is writing
      }
    }
  }
  return out;
}

async function withChat(name: string, body: (chat: ChatApp, page: Page) => Promise<void>): Promise<void> {
  const chat = await launchChatApp({
    name,
    seed: (sessionsDir) => {
      // sessionsDir = <home>/.claude/projects/<slug>: the user skills live two levels up.
      const skillDir = path.join(sessionsDir, '..', '..', 'skills', SKILL_NAME);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${SKILL_NAME}\ndescription: ${SKILL_DESCRIPTION}\n---\n\nCorpo da skill de teste.\n`, 'utf8');
    },
  });
  try {
    await launchClaudeTab(chat.window, {});
    await expect(chat.window.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await expect(input(chat.window)).toBeFocused({ timeout: 10_000 });
    await body(chat, chat.window);
  } finally {
    await chat.dispose();
  }
}

/** What Ctrl+V of a long text does: a `paste` event with `text/plain` on the box. */
async function pasteText(page: Page, text: string): Promise<void> {
  await input(page).focus();
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    const target = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]');
    target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

async function expectNoFailureCard(page: Page): Promise<void> {
  await expect(timeline(page).getByText('✕ não foi')).toHaveCount(0);
}

test('menu / : filtra, mostra a origem, Tab insere a skill e Enter envia o que esta escrito @chat', async () => {
  test.setTimeout(180_000);
  await withChat('chat-composer-slash', async (chat, page) => {
    const helpers = chatHelpers(page);

    // `/` sozinho: nativos primeiro, com a ficha de origem "CLI".
    await input(page).pressSequentially('/');
    await expect(slashMenu(page)).toBeVisible({ timeout: 10_000 });
    await expect(options(slashMenu(page)).first()).toContainText('CLI');
    // /login e /logout nao sao oferecidos (FR-018).
    await input(page).pressSequentially('log');
    await expect(slashMenu(page).getByText('/login', { exact: false })).toHaveCount(0);

    // Filtra pela skill de disco: nome, descricao e ficha "global".
    await input(page).fill('/zet');
    await expect(options(slashMenu(page))).toHaveCount(1, { timeout: 10_000 });
    await expect(options(slashMenu(page)).first()).toContainText(SKILL_NAME);
    await expect(options(slashMenu(page)).first()).toContainText(SKILL_DESCRIPTION);
    await expect(options(slashMenu(page)).first()).toContainText('global');
    await helpers.shot('composer-01-menu-barra');

    // Tab escolhe: insere `/zeta-revisar ` e fecha o menu; o foco fica na caixa.
    await input(page).press('Tab');
    await expect(input(page)).toHaveValue(`/${SKILL_NAME} `);
    await expect(slashMenu(page)).toHaveCount(0);
    await expect(input(page)).toBeFocused();

    // Esc fecha o menu sem apagar o texto, e ↑/↓ navegam enquanto ele esta aberto.
    await input(page).fill('/c');
    await expect(slashMenu(page)).toBeVisible();
    const first = await options(slashMenu(page)).first().innerText();
    await input(page).press('ArrowDown');
    await expect(options(slashMenu(page)).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options(slashMenu(page)).first()).toHaveAttribute('aria-selected', 'false');
    expect(first.length).toBeGreaterThan(0);
    await input(page).press('Escape');
    await expect(slashMenu(page)).toHaveCount(0);
    await expect(input(page)).toHaveValue('/c');

    // `/mod` + Enter: o menu NAO completa para /model; o CLI recebe o literal `/mod`.
    // (apagar antes: o Esc fecha o menu para aquele token ate o cursor sair dele)
    await input(page).fill('');
    await input(page).fill('/mod');
    await expect(slashMenu(page)).toBeVisible();
    await input(page).press('Enter');
    await expect(input(page)).toHaveValue('');
    await expect(slashMenu(page)).toHaveCount(0);
    await expect
      .poll(() => transcriptTexts(chat.sessionsDir).some((t) => t.includes('Unknown command: /mod') && !t.includes('/model')), { timeout: 30_000 })
      .toBe(true);

    // A skill de disco com argumento: o CLI recebe exatamente `/zeta-revisar o arquivo x`.
    await input(page).pressSequentially('/zet');
    await input(page).press('Tab');
    await input(page).pressSequentially('o arquivo x');
    await input(page).press('Enter');
    await expect
      .poll(() => transcriptTexts(chat.sessionsDir).some((t) => t.includes(`Unknown command: /${SKILL_NAME}`) || t.includes(`/${SKILL_NAME} o arquivo x`)), { timeout: 30_000 })
      .toBe(true);
  });
});

test('seletor de modelo: /model puro e Alt+P abrem o menu proprio; escolher envia /model <alias> @chat', async () => {
  test.setTimeout(180_000);
  await withChat('chat-composer-model', async (chat, page) => {
    const modelMenu = page.locator('[data-testid="chat-menu-model"]:visible');

    // `/model` puro nao vai ao CLI: abre o seletor e limpa o rascunho.
    await input(page).fill('/model');
    await input(page).press('Enter');
    await expect(modelMenu).toBeVisible({ timeout: 10_000 });
    await expect(options(modelMenu)).toHaveCount(4);
    await expect(input(page)).toHaveValue('');
    // Esc fecha; Alt+P reabre.
    await input(page).press('Escape');
    await expect(modelMenu).toHaveCount(0);
    await input(page).press('Alt+p');
    await expect(modelMenu).toBeVisible();

    // Setas movem, Enter escolhe: o CLI recebe `/model opus`.
    await input(page).press('ArrowDown');
    await input(page).press('Enter');
    await expect(modelMenu).toHaveCount(0);
    await expect.poll(() => transcriptTexts(chat.sessionsDir).some((t) => t.includes('/model opus')), { timeout: 30_000 }).toBe(true);
  });
});

test('menu @ : lista arquivos do projeto e Tab insere a mencao @caminho @chat', async () => {
  test.setTimeout(180_000);
  await withChat('chat-composer-path', async (chat, page) => {
    const helpers = chatHelpers(page);

    await input(page).pressSequentially('Veja o @specs/014-chat/quickstart.m');
    await expect(pathMenu(page)).toBeVisible({ timeout: 15_000 });
    await expect(options(pathMenu(page)).first()).toContainText('specs/014-chat/quickstart.md');
    await helpers.shot('composer-02-menu-arquivos');

    await input(page).press('Tab');
    await expect(input(page)).toHaveValue('Veja o @specs/014-chat/quickstart.md ');
    await expect(pathMenu(page)).toHaveCount(0);

    // Esc fecha o menu e deixa o token como esta.
    await input(page).pressSequentially('e o @CLAUDE');
    await expect(pathMenu(page)).toBeVisible({ timeout: 15_000 });
    await input(page).press('Escape');
    await expect(pathMenu(page)).toHaveCount(0);
    await expect(input(page)).toHaveValue('Veja o @specs/014-chat/quickstart.md e o @CLAUDE');
    // A tecla Esc foi do menu: nada foi interrompido nem negado.
    await expect(timeline(page).getByText(/interrompid/i)).toHaveCount(0);

    // Enter envia o que esta escrito: a mencao chega intacta.
    await input(page).fill('Veja o @specs/014-chat/quickstart.m');
    await expect(pathMenu(page)).toBeVisible({ timeout: 15_000 });
    await expect(options(pathMenu(page)).first()).toContainText('specs/014-chat/quickstart.md');
    await input(page).press('Tab');
    await input(page).pressSequentially('e diga a versao');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    await expectNoFailureCard(page);
    await expect.poll(() => transcriptTexts(chat.sessionsDir).filter((t) => t.includes('Veja')), { timeout: 15_000 }).toContain('Veja o @specs/014-chat/quickstart.md e diga a versao');
  });
});

test('colagem grande vira ficha, abre num modal so de leitura e volta inteira no envio; selos ! e /login @chat', async () => {
  test.setTimeout(240_000);
  await withChat('chat-composer-paste', async (chat, page) => {
    const helpers = chatHelpers(page);
    const body = Array.from({ length: 500 }, (_, i) => `linha ${i + 1} do log`).join('\n');

    // Acima do limite a colagem vira ficha (o limite exato e coberto no vitest; um evento sintetico nao insere texto).
    await pasteText(page, body);
    const chip = page.locator('[data-testid="chat-pasted-text"]:visible');
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText('texto colado — 500 linhas');
    await expect(input(page)).toHaveValue('');
    await input(page).fill('O que acha desse erro?');
    await helpers.shot('composer-03-ficha-de-colagem');

    // Abre para conferir: Modal so leitura, em mono, com o texto inteiro; Esc fecha so o modal.
    await chip.getByTestId('chat-pasted-text-open').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('texto colado — 500 linhas');
    const text = dialog.getByTestId('chat-pasted-text-body');
    await expect(text).toContainText('linha 1 do log');
    await expect(text).toContainText('linha 500 do log');
    expect(await text.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    expect(await dialog.locator('textarea, input').count()).toBe(0);
    await helpers.shot('composer-04-modal-do-texto-colado');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(chip).toHaveCount(1);

    // Envio: o CLI recebe o que foi escrito e, em seguida, o texto colado inteiro; o cartao chega a "entrou".
    await input(page).focus();
    await input(page).press('Enter');
    await expect(chip).toHaveCount(0);
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 120_000 });
    await expectNoFailureCard(page);
    await expect
      .poll(() => transcriptTexts(chat.sessionsDir).some((t) => t.startsWith('O que acha desse erro?\n\nlinha 1 do log') && t.endsWith('linha 500 do log') && t.split('\n').length === 502), {
        timeout: 20_000,
      })
      .toBe(true);

    // Remover a ficha descarta o texto.
    await pasteText(page, body);
    await expect(chip).toHaveCount(1);
    await chip.getByTestId('chat-pasted-text-remove').click();
    await expect(chip).toHaveCount(0);

    // Selo do `!`: aparece antes do envio e some quando o texto deixa de comecar com `!`.
    await input(page).fill('!echo oi');
    const shell = page.getByTestId('chat-composer-seal-shell');
    await expect(shell).toBeVisible();
    await expect(shell).toContainText('vai rodar como comando de shell');
    await helpers.shot('composer-05-selo-shell');
    // Enter envia o que esta escrito: roda como comando de shell local (o falso grava `<bash-input>`).
    await input(page).press('Enter');
    await expect(shell).toHaveCount(0);
    await expect.poll(() => transcriptTexts(chat.sessionsDir).some((t) => t.includes('<bash-input>echo oi</bash-input>')), { timeout: 30_000 }).toBe(true);
    await input(page).fill('echo oi');
    await expect(shell).toHaveCount(0);

    // Selo de /login e /logout (FR-018).
    await input(page).fill('/login');
    const account = page.getByTestId('chat-composer-seal-account');
    await expect(account).toBeVisible();
    await expect(account).toContainText('afeta a conta — use o painel de Contas');
    await helpers.shot('composer-06-selo-login');
    await input(page).fill('/logout');
    await expect(account).toBeVisible();
    await input(page).fill('/model');
    await expect(account).toHaveCount(0);
    await input(page).fill('');
  });
});
