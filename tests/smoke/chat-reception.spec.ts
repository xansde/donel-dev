import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';

// 014-chat, aceite do achado do alfa de 08/10 (e2e.md, Fase 3): o aviso "Não estou recebendo a conversa" nao
// pode aparecer depois de um turno terminado (o hook `Stop` chega DEPOIS da ultima linha e nao e atividade
// pendente) e, se aparecer, tem de sair sozinho quando uma linha nova chega. O limiar de "stale" do hub e 8 s
// (checado a cada 2 s) e nao tem env de teste: o smoke espera o tempo real, sem API nova so para teste.

const BANNER = 'Não estou recebendo a conversa';
const STALE_WAIT_MS = 14_000; // 8 s of threshold + 2 s of poll + margin

const input = (page: Page): Locator => page.locator('[data-testid="chat-composer-input"]:visible');
const timeline = (page: Page): Locator => page.locator('[data-testid="chat-timeline"]:visible');

async function send(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
  await input(page).press('Enter');
}

/** Asserts the banner stays absent for `ms`, sampling every 500 ms. */
async function expectNoBannerFor(page: Page, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await expect(page.getByText(BANNER)).toHaveCount(0);
    await page.waitForTimeout(500);
  }
}

// The order the alfa showed: the LAST transcript line lands, the follower reads it, and only then the Stop hook
// arrives. `skipTurnDuration` keeps the fake from appending a `turn_duration` line after Stop (which would
// count as growth and hide the bug).
const FINISHING_TURN = [
  { type: 'wait', ms: 200 },
  { type: 'assistant', text: 'feito' },
  { type: 'wait', ms: 400 },
  { type: 'hook', event: 'Stop' },
];

test('recepcao: /compact no meio de uma sessao com trocas e turno terminado nao acende o aviso @chat', async () => {
  test.setTimeout(180_000);
  const chat = await launchChatApp({ name: 'chat-reception-compact', scenario: JSON.stringify({ default: { skipTurnDuration: true, steps: FINISHING_TURN } }) });
  const page = chat.window;
  try {
    await launchClaudeTab(page, {});
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await expect(input(page)).toBeFocused({ timeout: 10_000 });

    await send(page, 'primeira troca');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    await send(page, 'segunda troca');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(2, { timeout: 60_000 });
    await send(page, '/compact');
    // The conversation switch of /compact rebuilds the view: wait for the boundary in the transcript instead.
    await expect
      .poll(() => readdirSync(chat.sessionsDir).some((f) => f.endsWith('.jsonl') && readFileSync(path.join(chat.sessionsDir, f), 'utf8').includes('compact_boundary')), { timeout: 30_000 })
      .toBe(true);

    // /compact resets the hub's counters, so the case that matters is the turn AFTER it: it ends with Stop and
    // nothing else will arrive.
    await send(page, 'depois do compact');
    await expect(timeline(page).getByText('depois do compact')).toBeVisible({ timeout: 30_000 });
    await expect(timeline(page).getByText('feito').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    // The turn is over; nothing else will arrive. Past the stale threshold the warning must NOT show.
    await expectNoBannerFor(page, STALE_WAIT_MS);
    await chatHelpers(page).shot('reception-01-compact-sem-aviso');
  } finally {
    await chat.dispose();
  }
});

test('recepcao: aviso forcado some sozinho quando chega linha nova e nao volta com o Stop @chat', async () => {
  test.setTimeout(180_000);
  const scenario = {
    turns: [
      {
        match: 're:^trava',
        skipTurnDuration: true,
        steps: [
          { type: 'wait', ms: 800 },
          // activity with no transcript growth after it: the file "stopped arriving" for 11 s
          { type: 'hook', event: 'PostToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'sleep 11' }, tool_use_id: 'toolu_stall', tool_response: { output: '' } } },
          { type: 'wait', ms: 11_000 },
          ...FINISHING_TURN,
        ],
      },
    ],
    default: { skipTurnDuration: true, steps: FINISHING_TURN },
  };
  const chat = await launchChatApp({ name: 'chat-reception-stale', scenario: JSON.stringify(scenario) });
  const page = chat.window;
  try {
    await launchClaudeTab(page, {});
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await expect(input(page)).toBeFocused({ timeout: 10_000 });

    await send(page, 'trava um pouco');
    // Stale: activity (PostToolUse) without the file growing for > 8 s.
    await expect(page.getByText(BANNER)).toBeVisible({ timeout: 20_000 });
    await chatHelpers(page).shot('reception-02-aviso-forcado');
    // A new line arrives (assistant "feito"): the warning goes away by itself...
    await expect(timeline(page).getByText('feito')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(BANNER)).toHaveCount(0, { timeout: 5_000 });
    // ...and the Stop that follows the last line must not bring it back.
    await expectNoBannerFor(page, STALE_WAIT_MS);
    await chatHelpers(page).shot('reception-03-aviso-sumiu');
  } finally {
    await chat.dispose();
  }
});
