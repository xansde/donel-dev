import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';
import { removeTempDir } from './userDataIsolation';

// 014-chat, T088 - smoke das IMAGENS na caixa do chat (Fase 4), contra o `claude` FALSO: nunca o CLI real.
//
// Colar (evento `paste` com um File de imagem no clipboard) e anexar pelo clipe (seletor de arquivos) gravam a
// imagem em `userData/chat-attachments/<sessionId>/`; a miniatura aparece acima do texto, removivel, e o envio
// cola o caminho absoluto sozinho, o que o fake transforma em `[Image #N]` ("entrou"). Arquivo que nao e imagem
// vira o caminho no texto (`@relativo` so dentro do cwd da aba).

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const input = (page: Page): Locator => page.locator('[data-testid="chat-composer-input"]:visible');
const timeline = (page: Page): Locator => page.locator('[data-testid="chat-timeline"]:visible');
const thumbnails = (page: Page): Locator => page.locator('[data-testid="chat-attachment"]:visible');

/** What Ctrl+V of a screenshot does: a `paste` event whose clipboard carries one image file and no text. */
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

function savedImages(userDataDir: string): string[] {
  const root = path.join(userDataDir, 'chat-attachments');
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((session) => readdirSync(path.join(root, session)).map((f) => path.join(root, session, f)));
}

test('T088 - imagem: colar, clipe, remover, rascunho, enviar so imagem e arquivo comum @chat', async () => {
  test.setTimeout(240_000);
  const scratch = mkdtempSync(path.join(tmpdir(), 'donel-chat-img-'));
  const pngFile = path.join(scratch, 'print-erro.png');
  const docFile = path.join(scratch, 'notas.md');
  writeFileSync(pngFile, Buffer.from(PNG_BASE64, 'base64'));
  writeFileSync(docFile, '# notas\n');
  const chat = await launchChatApp({ name: 'chat-composer-image' });
  const page = chat.window;
  try {
    const helpers = chatHelpers(page);
    await launchClaudeTab(page, {});
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await expect(input(page)).toBeFocused({ timeout: 10_000 });

    // Colar: a miniatura "imagem colada 1" aparece e o arquivo foi gravado pelo main, na pasta da sessao.
    await pasteImage(page);
    await expect(thumbnails(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(thumbnails(page).first().getByText('imagem colada 1')).toBeVisible();
    await expect(thumbnails(page).first().locator('img')).toBeVisible();
    await expect.poll(() => savedImages(chat.userDataDir).length, { timeout: 5_000 }).toBe(1);
    const [saved] = savedImages(chat.userDataDir);
    expect(saved).toMatch(/img-[0-9a-z]+-[0-9a-f]+\.png$/);
    // A <img> carrega pelo protocolo donel-asset (a imagem de verdade, nao o icone de quebrada).
    await expect
      .poll(() => thumbnails(page).first().locator('img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 10_000 })
      .toBe(true);
    await helpers.shot('image-01-colada');

    // Remover: a miniatura some; colar de novo, e o rascunho sobrevive a trocar de visao.
    await thumbnails(page).first().getByRole('button', { name: 'Remover imagem colada 1' }).click();
    await expect(thumbnails(page)).toHaveCount(0);
    await pasteImage(page);
    await expect(thumbnails(page)).toHaveCount(1, { timeout: 10_000 });
    await input(page).fill('o que ha de errado neste print?');
    await helpers.showView('terminal');
    await helpers.showView('chat');
    await expect(thumbnails(page)).toHaveCount(1);
    await expect(input(page)).toHaveValue('o que ha de errado neste print?');

    // Enviar texto + imagem: o CLI recebe o caminho colado sozinho ([Image #N]) e a mensagem "entrou".
    await input(page).press('Enter');
    await expect(thumbnails(page)).toHaveCount(0);
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    await expect.poll(() => transcriptUserTexts(chat.sessionsDir).some((t) => t.includes('[Image #1]') && t.includes('o que ha de errado')), { timeout: 15_000 }).toBe(true);
    await helpers.shot('image-02-enviada');

    // Clipe: imagem vira anexo com o nome do arquivo; so imagem (texto vazio) tambem envia.
    await page.getByTestId('chat-composer-file-input').setInputFiles(pngFile);
    await expect(thumbnails(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(thumbnails(page).first().getByText('print-erro.png')).toBeVisible();
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(2, { timeout: 60_000 });
    await expect.poll(() => transcriptUserTexts(chat.sessionsDir).filter((t) => t.includes('[Image #')).length, { timeout: 15_000 }).toBe(2);

    // Clipe com arquivo que nao e imagem: o caminho entra no texto (fora do cwd da aba: sem `@`); sem miniatura.
    await page.getByTestId('chat-composer-file-input').setInputFiles(docFile);
    await expect(input(page)).toHaveValue(new RegExp(`${path.basename(docFile).replace('.', '\\.')} $`), { timeout: 5_000 });
    expect(await input(page).inputValue()).toContain(scratch.replace(/\\/g, '/'));
    await expect(thumbnails(page)).toHaveCount(0);
    await helpers.shot('image-03-arquivo-no-texto');
  } finally {
    await chat.dispose();
    removeTempDir(scratch);
  }
});
