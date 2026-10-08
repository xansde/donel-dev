import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';

// 014-chat, T059 (SC-008) - latencia ao vivo: uma linha acrescentada ao
// transcript aparece na tela do chat em ate 1 s. Mede 5x (append -> texto no
// DOM, polling por frame) e registra a mediana. Contra o `claude` FALSO; o
// append e feito direto no arquivo, como o CLI faria.

const BUDGET_MS = 1_000;
const SAMPLES = 5;

let chat: ChatApp;
let page: Page;

test.beforeAll(async () => {
  chat = await launchChatApp({ name: 'chat-live-latency' });
  page = chat.window;
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await chat.dispose();
});

/** The transcript the fake created for the tab (the only `.jsonl` of the temp home). */
function transcriptOfTab(): string {
  const files = readdirSync(chat.sessionsDir).filter((f) => f.endsWith('.jsonl'));
  if (files.length !== 1) throw new Error(`expected 1 transcript, found ${files.length}`);
  return path.join(chat.sessionsDir, files[0]!);
}

function lastUuid(file: string): string | null {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
  const last = lines.at(-1);
  return last ? ((JSON.parse(last) as { uuid?: string }).uuid ?? null) : null;
}

test('T059 - latencia ao vivo: append no transcript -> linha na tela em <= 1 s (SC-008) @chat', async () => {
  test.setTimeout(120_000);
  const { shot } = chatHelpers(page);
  await launchClaudeTab(page, {});
  await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
  await chatHelpers(page).waitForFakeFooter();
  await chatHelpers(page).showView('chat');
  const file = transcriptOfTab();
  const sessionId = path.basename(file, '.jsonl');

  const samples: number[] = [];
  for (let i = 1; i <= SAMPLES; i += 1) {
    const marker = `LATENCIA-AO-VIVO-${i}-${randomUUID().slice(0, 8)}`;
    const line = {
      parentUuid: lastUuid(file),
      isSidechain: false,
      type: 'assistant',
      uuid: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      cwd: REPO_ROOT,
      version: '2.1.293',
      requestId: `req_${i}`,
      message: {
        id: `msg_latency_${i}`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'text', text: `Linha ao vivo ${marker}` }],
        stop_reason: 'end_turn',
      },
    };
    // Arm the page-side wait first (frame polling), then append and time it.
    const seen = page.waitForFunction(
      (text) => (document.querySelector('[data-testid="chat-timeline"]') as HTMLElement | null)?.innerText.includes(text) ?? false,
      marker,
      { polling: 'raf', timeout: 10_000 },
    );
    const startedAt = Date.now();
    appendFileSync(file, `${JSON.stringify(line)}\n`);
    await seen;
    samples.push(Date.now() - startedAt);
    await page.waitForTimeout(300);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(`SC-008 latencia (ms): ${samples.join(', ')} - mediana ${median} ms (orcamento ${BUDGET_MS} ms)`);
  test.info().annotations.push({ type: 'SC-008 latencia (ms)', description: `${samples.join(', ')} | mediana ${median}` });
  await shot('12-latencia-ao-vivo');
  expect(median).toBeLessThanOrEqual(BUDGET_MS);
  expect(Math.max(...samples)).toBeLessThanOrEqual(BUDGET_MS * 2);
});
