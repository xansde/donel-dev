import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';

// B3 — indicador do PR na linha da sessão + painel + "Mandar pro Claude
// consertar". Sem `gh` de verdade: `DONEL_GH_PR_FIXTURE` aponta para a saída
// que o `gh pr view --json` e a consulta GraphQL dariam (o main passa pelos
// MESMOS parsers da leitura real). O prompt vai pelo `sendDriver` da aba até o
// `claude` falso, e a prova é a linha de usuário no transcript que ele grava.

const FIXTURE = {
  pullRequest: {
    number: 142,
    title: 'feat: painel de PRs na sidebar',
    url: 'https://github.com/acme/atlas/pull/142',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/painel-prs-sidebar',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'typecheck', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/atlas/actions/runs/1/job/1' },
      { __typename: 'CheckRun', name: 'vitest', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/acme/atlas/actions/runs/1/job/2' },
    ],
    reviewDecision: 'CHANGES_REQUESTED',
    latestReviews: [{ author: { login: 'revisora' }, state: 'CHANGES_REQUESTED' }],
  },
  reviewThreads: { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }, { isResolved: true }] } } } } },
};

/** Texto das linhas de usuário que o `claude` falso gravou nos transcripts desta execução. */
function userTexts(sessionsDir: string): string[] {
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
        // linha parcial enquanto o falso escreve
      }
    }
  }
  return out;
}

let chat: ChatApp | null = null;
let fixtureDir: string | null = null;

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (chat) await chat.dispose();
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

test('linha da sessão mostra o PR com checks vermelhos e o painel manda o conserto para a aba @sessoes', async () => {
  test.setTimeout(180_000);
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'donel-pr-fixture-'));
  const fixturePath = path.join(fixtureDir, 'pr.json');
  writeFileSync(fixturePath, JSON.stringify(FIXTURE), 'utf8');

  chat = await launchChatApp({ name: 'sidebar-pr', env: { DONEL_GH_PR_FIXTURE: fixturePath } });
  const page = chat.window;
  await launchClaudeTab(page, { name: 'pr-test' });
  await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });

  const sessions = page.locator('nav[aria-label="Projetos e sessões"] section', { hasText: 'Sessões' }).last();
  const row = sessions.locator('div', { has: page.getByRole('button', { name: /pr-test/ }) }).last();
  const indicator = row.getByTestId('sidebar-pr');
  await expect(indicator).toHaveText('#142', { timeout: 20_000 });
  await expect(indicator).toHaveAttribute('data-rollup', 'fail');
  await expect(indicator).toHaveAttribute('data-review', 'changes-requested');
  await expect(indicator).toHaveAccessibleName('PR #142 de pr-test: checks falharam, mudanças pedidas');

  await indicator.click();
  const dialog = page.getByRole('dialog', { name: 'PR #142' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('feat: painel de PRs na sidebar')).toBeVisible();
  await expect(dialog.getByTestId('pr-check')).toHaveCount(2);
  await expect(dialog.locator('[data-testid="pr-check"][data-state="fail"]')).toContainText('CI / vitest');
  await expect(dialog.getByRole('button', { name: 'Abrir o job CI / vitest' })).toHaveText('ver o job que falhou');
  await expect(dialog.getByText('revisora pediu mudanças')).toBeVisible();
  await expect(dialog.getByTestId('pr-threads')).toHaveText('Conversas não resolvidas: 2');

  const fix = dialog.getByRole('button', { name: 'Mandar pro Claude consertar' });
  await expect(fix).toBeEnabled();
  await fix.click();
  await expect(dialog).toBeHidden();

  const sessionsDir = chat.sessionsDir;
  await expect
    .poll(() => userTexts(sessionsDir).find((text) => text.includes('O PR #142')) ?? '', { timeout: 60_000 })
    .toContain('- CI / vitest — https://github.com/acme/atlas/actions/runs/1/job/2');
  const sent = userTexts(sessionsDir).find((text) => text.includes('O PR #142')) ?? '';
  expect(sent).toContain('Mudanças pedidas no review (revisora).');
  expect(sent).toContain('Há 2 conversas não resolvidas no PR.');
  expect(sent).not.toContain('CI / typecheck');
});
