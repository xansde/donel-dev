import { existsSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab, openFreeTerminalTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { removeTempDir } from './userDataIsolation';

// 014-chat, T081 - smoke das pendencias (Fase 4, SC-002), contra o `claude` FALSO (T080): nunca o CLI real.
//
// Cobre: pergunta, permissao (Permitir sempre / Negar com motivo), plano (aprovar / pedir ajuste), fila de
// pedidos de subagentes, resposta pelo terminal (o painel fecha sozinho), Parar com pendencia aberta e a
// notificacao (stub `DONEL_SMOKE_NOTIFICATIONS_LOG`: registra em vez de mostrar). Toda pendencia tem de
// aparecer no painel - o teste falha se ela nunca aparecer.

const SETTINGS_LOCAL = path.join(REPO_ROOT, '.claude', 'settings.local.json');
const NOTIFICATION_BODY = 'Esperando você — permissão para rodar um comando';
const STOP = { type: 'hook', event: 'Stop' };

const SCENARIO = {
  turns: [
    {
      match: 'pergunta',
      steps: [{ type: 'ask', questions: [{ question: 'Which db?', header: 'DB', options: [{ label: 'Postgres' }, { label: 'SQLite' }], multiSelect: false }] }, { type: 'assistant', text: 'Resposta recebida.' }, STOP],
    },
    {
      match: 'sempre',
      steps: [{ type: 'bash_permission', command: 'npm install left-pad', description: 'Install', rule: 'npm install:*', result: 'installed' }, { type: 'assistant', text: 'Instalado.' }, STOP],
    },
    {
      match: 'negar',
      steps: [{ type: 'bash_permission', command: 'rm -r build', denyReply: 'Entendi, nao vou rodar.' }, STOP],
    },
    {
      match: 'aprovar plano',
      steps: [{ type: 'plan', plan: '# Plano\n- passo um\n- passo dois', planFilePath: 'C:/x/plan.md' }, { type: 'assistant', text: 'Executando o plano.' }, STOP],
    },
    {
      match: 'ajustar plano',
      steps: [{ type: 'plan', plan: '# Plano B\n- passo um', planFilePath: 'C:/x/plan-b.md' }, { type: 'assistant', text: 'Refazendo.' }, STOP],
    },
    {
      match: 'fila',
      steps: [
        {
          type: 'subagent_permissions',
          requests: [
            { type: 'bash_permission', command: 'npm test', agentType: 'tester' },
            { type: 'edit_permission', file_path: 'a.ts', old_string: 'a', new_string: 'b', agentType: 'reviewer' },
          ],
        },
        { type: 'assistant', text: 'Subagentes terminaram.' },
        STOP,
      ],
    },
    {
      match: 'terminal',
      steps: [{ type: 'bash_permission', command: 'npm run lint', result: 'lint ok' }, { type: 'assistant', text: 'Lint feito.' }, STOP],
    },
    {
      match: 'parar',
      steps: [{ type: 'bash_permission', command: 'npm run build' }, { type: 'assistant', text: 'Isto nunca deve aparecer.' }, STOP],
    },
    {
      match: 'notificar',
      steps: [{ type: 'wait', ms: 3000 }, { type: 'bash_permission', command: 'echo SEGREDO-NOTIF', result: 'ok' }, { type: 'assistant', text: 'Notificado.' }, STOP],
    },
  ],
};

interface LogLine {
  hookResponse?: string;
  permissionOutcome?: string;
  lateHookResponse?: string;
  source?: string;
  tool_name?: string;
  agent_id?: string;
  effective?: boolean;
  body?: unknown;
  [key: string]: unknown;
}

let chat: ChatApp;
let page: Page;
let helpers: ReturnType<typeof chatHelpers>;
let tmp: string;
let hookLog: string;
let notificationsLog: string;
let settingsBefore: string | null = null;
const savedEnv: Record<string, string | undefined> = {};
const pageErrors: string[] = [];

function readHookLog(): LogLine[] {
  if (!existsSync(hookLog)) return [];
  const out: LogLine[] = [];
  for (const line of readFileSync(hookLog, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as LogLine);
    } catch {
      // partial line while the fake is writing
    }
  }
  return out;
}

function readNotifications(): { title: string; body: string }[] {
  if (!existsSync(notificationsLog)) return [];
  return readFileSync(notificationsLog, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { title: string; body: string });
}

/** Polls the fake's log until a line matches. */
async function waitForLog(predicate: (line: LogLine) => boolean, description: string, timeout = 30_000): Promise<LogLine> {
  let found: LogLine | undefined;
  await expect
    .poll(
      () => {
        found = readHookLog().find(predicate);
        return found !== undefined;
      },
      { message: description, timeout },
    )
    .toBe(true);
  return found as LogLine;
}

const bodyText = (line: LogLine): string => JSON.stringify(line.body ?? '');

const panel = (): Locator => page.locator('[data-testid="pending-panel"]:visible');
const composer = (): Locator => page.locator('[data-testid="chat-composer-input"]:visible');

/** The footer only exists while the Claude is working or just stopped: absent counts as "not working". */
async function expectNotWorking(): Promise<void> {
  await expect
    // One atomic read in the page: `count()` + `getAttribute()` as two calls raced with the footer unmounting
    // (the happy path!) and `getAttribute` then waited for an element that was gone until the poll timed out.
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="working-footer"]')?.getAttribute('data-state') === 'working'), { timeout: 30_000 })
    .toBe(false);
}

async function send(text: string): Promise<void> {
  // The previous round must be over, or the message would only be queued.
  await expectNotWorking();
  await composer().fill(text);
  await composer().press('Enter');
}

async function expectRoundOver(): Promise<void> {
  await expect(panel()).toHaveCount(0, { timeout: 15_000 });
  await expectNotWorking();
}

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'donel-chat-pending-'));
  hookLog = path.join(tmp, 'fake-hooks.log');
  notificationsLog = path.join(tmp, 'notifications.log');
  const scenarioFile = path.join(tmp, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(SCENARIO), 'utf8');
  settingsBefore = existsSync(SETTINGS_LOCAL) ? readFileSync(SETTINGS_LOCAL, 'utf8') : null;

  const env = { DONEL_FAKE_CLAUDE_LOG: hookLog, DONEL_SMOKE_NOTIFICATIONS_LOG: notificationsLog };
  for (const [k, v] of Object.entries(env)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  chat = await launchChatApp({ name: 'chat-pending', scenario: scenarioFile });
  page = chat.window;
  helpers = chatHelpers(page);
  page.on('pageerror', (error) => pageErrors.push(String(error)));
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await chat?.dispose();
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // The fake wrote a rule into the repo under test (`settings.local.json`): put it back as it was.
    if (settingsBefore === null) {
      if (existsSync(SETTINGS_LOCAL)) unlinkSync(SETTINGS_LOCAL);
    } else writeFileSync(SETTINGS_LOCAL, settingsBefore, 'utf8');
    removeTempDir(tmp);
  }
});

test('T081 - pergunta: o painel aparece, a resposta chega ao CLI e o painel some @chat', async () => {
  test.setTimeout(180_000);
  await launchClaudeTab(page, { name: 'pend-a' });
  await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
  await expect(composer()).toBeVisible({ timeout: 20_000 });
  await send('pergunta sobre o banco');

  await expect(panel()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pending-question')).toBeVisible();
  await expect(page.getByTestId('pending-option')).toHaveCount(2);
  await helpers.shot('t081-01-pergunta');
  await page.getByTestId('pending-option').filter({ hasText: 'SQLite' }).click();
  await page.getByTestId('pending-answer').click();

  const line = await waitForLog((l) => l.hookResponse === 'PermissionRequest' && l.tool_name === 'AskUserQuestion' && l.effective === true, 'resposta da pergunta no log do falso');
  expect(bodyText(line)).toContain('answers');
  expect(bodyText(line)).toContain('SQLite');
  await expectRoundOver();
});

test('T081 - permissao Bash: "Permitir sempre" grava a regra; "Negar" com motivo chega como erro @chat', async () => {
  test.setTimeout(180_000);
  await send('permitir sempre o install');
  await expect(page.getByTestId('pending-permission')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pending-origin')).toHaveCount(0);
  await helpers.shot('t081-02-permissao');
  await page.getByTestId('pending-allow-always').click();
  await waitForLog((l) => l.permissionOutcome === 'allow' && l.source === 'hook', 'Permitir sempre chegou ao falso');
  await expectRoundOver();
  await expect.poll(() => (existsSync(SETTINGS_LOCAL) ? readFileSync(SETTINGS_LOCAL, 'utf8') : ''), { timeout: 10_000 }).toContain('Bash(npm install:*)');

  const denyBefore = readHookLog().filter((l) => l.permissionOutcome === 'deny').length;
  await send('negar o rm');
  await expect(page.getByTestId('pending-permission')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('pending-deny').click();
  await page.getByTestId('pending-deny-reason').fill('Nao apague a pasta build');
  await page.getByTestId('pending-deny-send').click();
  await expect.poll(() => readHookLog().filter((l) => l.permissionOutcome === 'deny').length, { timeout: 30_000 }).toBe(denyBefore + 1);
  const denied = await waitForLog((l) => l.hookResponse === 'PermissionRequest' && l.tool_name === 'Bash' && bodyText(l).includes('deny'), 'resposta de negar no log');
  expect(bodyText(denied)).toContain('Nao apague a pasta build');
  await expectRoundOver();
  // the error tool_result with the reason reached the transcript
  await expect
    .poll(() => readdirSync(chat.sessionsDir).filter((f) => f.endsWith('.jsonl')).map((f) => readFileSync(path.join(chat.sessionsDir, f), 'utf8')).join('\n'), { timeout: 15_000 })
    .toContain('Nao apague a pasta build');
});

test('T081 - plano: Aprovar e seguir ecoa o plano; Pedir ajuste sai como negacao com o texto @chat', async () => {
  test.setTimeout(180_000);
  await send('aprovar plano');
  await expect(page.getByTestId('pending-plan')).toBeVisible({ timeout: 30_000 });
  await helpers.shot('t081-03-plano');
  await page.getByTestId('pending-plan-approve').click();
  const approved = await waitForLog((l) => l.hookResponse === 'PermissionRequest' && l.tool_name === 'ExitPlanMode' && l.effective === true, 'aprovacao do plano efetiva');
  expect(bodyText(approved)).toContain('updatedInput');
  await expectRoundOver();

  const planResponses = readHookLog().filter((l) => l.hookResponse === 'PermissionRequest' && l.tool_name === 'ExitPlanMode').length;
  await send('ajustar plano');
  await expect(page.getByTestId('pending-plan')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('pending-plan-adjust').click();
  await expect(page.getByTestId('pending-plan-adjust-input')).toBeVisible();
  await page.getByTestId('pending-plan-adjust-input').fill('Troque o passo um por testes primeiro');
  await page.getByTestId('pending-plan-adjust-input').press('Enter');
  await expect.poll(() => readHookLog().filter((l) => l.hookResponse === 'PermissionRequest' && l.tool_name === 'ExitPlanMode').length, { timeout: 30_000 }).toBe(planResponses + 1);
  const adjusted = readHookLog().filter((l) => l.hookResponse === 'PermissionRequest' && l.tool_name === 'ExitPlanMode').pop() as LogLine;
  expect(bodyText(adjusted)).toContain('deny');
  expect(bodyText(adjusted)).toContain('Troque o passo um por testes primeiro');
  await expectRoundOver();
});

test('T081 - fila de subagentes: contador, origem, e o segundo pedido sobe na hora @chat', async () => {
  test.setTimeout(180_000);
  await send('fila de subagentes');
  await expect(page.getByTestId('pending-permission')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pending-waiting-count')).toHaveText('mais 1 esperando');
  await expect(page.getByTestId('pending-origin')).toContainText('pedido do subagente');
  const firstOrigin = (await page.getByTestId('pending-origin').innerText()).trim();
  await helpers.shot('t081-04-fila');

  await page.getByTestId('pending-allow').click();
  // the second one is promoted at once: no empty state in between, counter gone, other origin
  await expect(page.getByTestId('pending-waiting-count')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('pending-origin')).toContainText('pedido do subagente');
  expect((await page.getByTestId('pending-origin').innerText()).trim()).not.toBe(firstOrigin);
  await expect(panel()).toBeVisible();
  await page.getByTestId('pending-allow').click();
  await expectRoundOver();
});

test('T081 - resposta pelo terminal: o painel fecha sozinho, sem erro @chat', async () => {
  test.setTimeout(180_000);
  await send('responder no terminal');
  await expect(page.getByTestId('pending-permission')).toBeVisible({ timeout: 30_000 });

  await helpers.showView('terminal');
  await page.locator('[data-testid="terminal-pane"]:visible').click();
  await page.keyboard.press('1'); // the fake TUI dialog: 1 = allow
  await waitForLog((l) => l.permissionOutcome === 'allow' && l.source === 'tui', 'resposta pela TUI registrada');
  await helpers.showView('chat');
  await expectRoundOver();
  expect(pageErrors).toEqual([]);
});

test('T081 - Parar com pendencia aberta responde interrupt e a rodada termina @chat', async () => {
  test.setTimeout(180_000);
  await send('parar aqui');
  await expect(page.getByTestId('pending-permission')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Parar' }).click();
  const line = await waitForLog((l) => l.hookResponse === 'PermissionRequest' && bodyText(l).includes('interrupt'), 'interrupt no log do falso');
  expect(bodyText(line)).toContain('true');
  await expect(panel()).toHaveCount(0, { timeout: 15_000 });
  await expectNotWorking();
  await expect(page.locator('[data-testid="chat-timeline"]:visible')).not.toContainText('Isto nunca deve aparecer');
});

test('T081 - notificacao com a aba inativa: corpo sem o comando @chat', async () => {
  test.setTimeout(180_000);
  // A free terminal tab is the "other" tab: tab A (the Claude session) stays alive in the background.
  const tabA = page.locator('[role="tab"]', { hasText: 'pend-a' }).last();
  await openFreeTerminalTab(page);
  const tabs = page.locator('[role="tab"]');
  await expect(tabs).toHaveCount(2);
  const tabB = tabs.last();
  await tabA.click();
  await expect(tabA).toHaveAttribute('aria-selected', 'true');
  await expect(composer()).toBeVisible({ timeout: 20_000 });

  const before = readNotifications().length;
  await send('notificar agora');
  await tabB.click(); // A goes to the background before the fake asks (3 s wait in the script)
  await expect(tabB).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => readNotifications().length, { timeout: 30_000 }).toBeGreaterThan(before);
  const fresh = readNotifications().slice(before);
  expect(fresh.some((n) => n.body === NOTIFICATION_BODY)).toBe(true);
  expect(JSON.stringify(fresh)).not.toContain('SEGREDO-NOTIF');

  // back on tab A the pending is there (never lost): answer it
  await tabA.click();
  await expect(page.getByTestId('pending-permission')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('pending-allow').click();
  await expectRoundOver();
  expect(pageErrors).toEqual([]);
});
