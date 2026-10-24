import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { openPreviousSessionsDialog } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';

// 014-chat, T059 (SC-005) - sessao longa: ~10 mil linhas sinteticas (T058),
// com resultados de ~300 KB. Retomar a sessao -> o FIM da conversa fica
// visivel em ate 2 s; rolar ate o topo carrega historico SEM salto (a posicao
// do primeiro item visivel se preserva). Contra o `claude` FALSO.
//
// SC-005 falhou? NAO adotar react-virtuoso aqui: registrar a medicao em
// specs/014-chat/e2e.md e abrir tarefa (plano B do R19).

const GENERATOR = path.join(REPO_ROOT, 'tests/fixtures/chat/generate-large.mjs');
const END_MARKER = 'FIM-SESSAO-SINTETICA-VEGA';
const START_MARKER = 'INICIO-SESSAO-SINTETICA-ATLAS';
const END_BUDGET_MS = 2_000;
const JUMP_TOLERANCE_PX = 24;
// 4000 rounds (20k lines): a page is bounded by 2 MB read, so the 10k-line fixture only has two loads above the initial window; three need more history.
const ROUNDS = 4000;

test.describe.configure({ mode: 'serial' });

let chat: ChatApp;
let page: Page;
const sessionId = randomUUID();

test.beforeAll(async () => {
  chat = await launchChatApp({
    name: 'chat-long-session',
    seed: (sessionsDir) => {
      execFileSync(process.execPath, [GENERATOR, path.join(sessionsDir, `${sessionId}.jsonl`), sessionId, REPO_ROOT, String(ROUNDS)]);
    },
  });
  page = chat.window;
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await chat.dispose();
});

interface TopRow {
  readonly roundTail: string | null;
  readonly offset: number;
  readonly rounds: number;
}

const FIRST_VISIBLE_SCRIPT = (scroller: Element): TopRow => {
  const sections = Array.from(scroller.querySelectorAll<HTMLElement>('section[data-round-tail]'));
  const top = scroller.getBoundingClientRect().top;
  const first = sections.find((s) => s.getBoundingClientRect().bottom > top + 1);
  return {
    roundTail: first?.getAttribute('data-round-tail') ?? null,
    offset: first ? first.getBoundingClientRect().bottom - top : 0,
    rounds: sections.length,
  };
};

test('T059 - sessao longa: fim visivel em <= 2 s (SC-005) @chat', async () => {
  test.setTimeout(180_000);
  const { shot } = chatHelpers(page);

  const dialog = await openPreviousSessionsDialog(page);
  await dialog.getByLabel('Filtrar sessões anteriores por nome').fill(START_MARKER);
  const row = dialog.locator('[data-testid="previous-session-row"]');
  await expect(row).toHaveCount(1, { timeout: 15_000 });

  const startedAt = Date.now();
  await row.getByRole('button', { name: 'Retomar' }).click();
  await expect(dialog).toBeHidden();

  // The END of the conversation is on screen (inside the viewport of the timeline).
  const endText = page.locator('[data-testid="chat-timeline"]:visible').getByText(END_MARKER);
  await expect(endText).toBeInViewport({ timeout: 15_000 });
  const endMs = Date.now() - startedAt;
  console.log(`SC-005 fim visivel apos Retomar: ${endMs} ms (orcamento ${END_BUDGET_MS} ms)`);
  test.info().annotations.push({ type: 'SC-005 fim visivel (ms)', description: String(endMs) });
  await shot('10-sessao-longa-fim');
  expect(endMs).toBeLessThanOrEqual(END_BUDGET_MS);
});

// SC-005 (parte da rolagem): o historico entra por ANCORA (rodada visivel + deslocamento), refeita enquanto as
// rodadas fora da tela trocam a altura estimada pela real. Tolerancia: 24 px (~1 linha de texto) - antes: ~1068 px.
test('T059 - sessao longa: rolar ate o topo carrega historico sem salto (SC-005) @chat', async () => {
  test.setTimeout(180_000);
  const { shot } = chatHelpers(page);

  // Scroll to the very top: older history is loaded and the reader's place holds.
  const scroller = page.locator('[data-testid="chat-timeline"]:visible');
  const jumps: number[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    // Approach the top the way a reader does (steps, with the layout settling), then cross the load threshold.
    for (let step = 0; step < 40; step += 1) {
      const top = await scroller.evaluate((el) => {
        el.scrollTop = Math.max(2_000, el.scrollTop - 20_000);
        return el.scrollTop;
      });
      await page.waitForTimeout(40);
      if (top <= 2_000) break;
    }
    await page.waitForTimeout(500);
    // Same synchronous step: jump to the top and note the first round on screen (before any load lands).
    const before = await scroller.evaluate((el, script) => {
      el.scrollTop = 100;
      // eslint-disable-next-line no-new-func
      return (new Function('scroller', `return (${script})(scroller)`) as (e: Element) => TopRow)(el);
    }, FIRST_VISIBLE_SCRIPT.toString());
    // wait for the load triggered by being at the top (the round count grows) ...
    await expect
      .poll(async () => scroller.evaluate((el, script) => (new Function('scroller', `return (${script})(scroller)`) as (e: Element) => TopRow)(el).rounds, FIRST_VISIBLE_SCRIPT.toString()), {
        timeout: 20_000,
        intervals: [100, 250, 500],
      })
      .toBeGreaterThan(before.rounds);
    // ... and for the layout to settle
    await page.waitForTimeout(400);
    console.log(`DIAG pass ${pass}`, JSON.stringify(await scroller.evaluate((el) => ({ top: el.scrollTop, h: el.scrollHeight, c: el.clientHeight, r: el.querySelectorAll('section[data-round-tail]').length }))));
    const after = await page.evaluate((roundTail) => {
      const scrollerEl = document.querySelector<HTMLElement>('[data-testid="chat-timeline"]');
      const section = scrollerEl?.querySelector<HTMLElement>(`section[data-round-tail="${roundTail}"]`);
      if (!scrollerEl || !section) return null;
      return section.getBoundingClientRect().bottom - scrollerEl.getBoundingClientRect().top;
    }, before.roundTail);
    expect(after, 'the first visible round must still exist after loading older history').not.toBeNull();
    jumps.push(Math.round(Math.abs((after as number) - before.offset)));
  }
  console.log(`SC-005 salto (px) por carga de historico: ${jumps.join(', ')}`);
  test.info().annotations.push({ type: 'SC-005 salto (px)', description: jumps.join(', ') });
  await shot('11-sessao-longa-topo');
  for (const jump of jumps) expect(jump).toBeLessThanOrEqual(JUMP_TOLERANCE_PX);
});
