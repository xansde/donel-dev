import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';
import { removeTempDir } from './userDataIsolation';

// Observacao nas perguntas do Claude (`AskUserQuestion`), contra o `claude` FALSO: nunca o CLI real.
//
// Cada pergunta do cartao ganha um "+ observacao" opcional. O que se escreve ali segue com a resposta no
// `updatedInput.annotations[pergunta].notes` do `PermissionRequest` - o formato que o CLI 2.1.314 aceita e
// mostra ao modelo como `"pergunta"="resposta" notes: ...`. Sem observacao, o payload e o de antes (sem
// `annotations`). Vale para escolha unica, multipla e "Outra".

const STOP = { type: 'hook', event: 'Stop' };
const SINGLE = { question: 'Qual banco?', header: 'Banco', options: [{ label: 'Postgres' }, { label: 'SQLite' }], multiSelect: false };
const MULTI = {
  question: 'Quais camadas?',
  header: 'Camadas',
  options: [{ label: 'main' }, { label: 'preload' }, { label: 'renderer' }],
  multiSelect: true,
};
const FREE = { question: 'Qual nome?', header: 'Nome', options: [{ label: 'atlas' }, { label: 'vega' }], multiSelect: false };

const SCENARIO = {
  turns: [
    { match: 'com observacao', steps: [{ type: 'ask', questions: [SINGLE, MULTI, FREE] }, { type: 'assistant', text: 'Anotado.' }, STOP] },
    { match: 'sem observacao', steps: [{ type: 'ask', questions: [SINGLE] }, { type: 'assistant', text: 'Ok.' }, STOP] },
  ],
};

interface LogLine {
  hookResponse?: string;
  tool_name?: string;
  effective?: boolean;
  body?: { hookSpecificOutput?: { decision?: { behavior?: string; updatedInput?: Record<string, unknown> } } };
}

let chat: ChatApp;
let page: Page;
let helpers: ReturnType<typeof chatHelpers>;
let tmp: string;
let hookLog: string;
let savedLog: string | undefined;

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

/** The n-th (0-based) effective answer to an `AskUserQuestion`, as the fake received it. */
async function answerAt(index: number): Promise<Record<string, unknown>> {
  let found: LogLine | undefined;
  await expect
    .poll(
      () => {
        found = readHookLog().filter((l) => l.hookResponse === 'PermissionRequest' && l.tool_name === 'AskUserQuestion' && l.effective === true)[index];
        return found !== undefined;
      },
      { message: `resposta ${index + 1} da pergunta no log do falso`, timeout: 30_000 },
    )
    .toBe(true);
  const decision = found?.body?.hookSpecificOutput?.decision;
  expect(decision?.behavior).toBe('allow');
  return decision?.updatedInput ?? {};
}

/** Text of the AskUserQuestion `tool_result`s the fake wrote in the transcript (what the model would read). */
function toolResultTexts(): string[] {
  const texts: string[] = [];
  for (const file of readdirSync(chat.sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(path.join(chat.sessionsDir, file), 'utf8').split('\n')) {
      if (!line.includes('tool_result')) continue;
      try {
        const entry = JSON.parse(line) as { message?: { content?: { type?: string; content?: unknown }[] } };
        for (const block of entry.message?.content ?? []) {
          if (block.type === 'tool_result' && typeof block.content === 'string') texts.push(block.content);
        }
      } catch {
        // partial line
      }
    }
  }
  return texts;
}

const panel = (): Locator => page.locator('[data-testid="pending-panel"]:visible');
const composer = (): Locator => page.locator('[data-testid="chat-composer-input"]:visible');
const card = (): Locator => page.getByTestId('pending-question');

async function expectNotWorking(): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="working-footer"]')?.getAttribute('data-state') === 'working'), { timeout: 30_000 })
    .toBe(false);
}

async function send(text: string): Promise<void> {
  await expectNotWorking();
  await composer().fill(text);
  await composer().press('Enter');
}

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'donel-chat-notes-'));
  hookLog = path.join(tmp, 'fake-hooks.log');
  const scenarioFile = path.join(tmp, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(SCENARIO), 'utf8');
  savedLog = process.env.DONEL_FAKE_CLAUDE_LOG;
  process.env.DONEL_FAKE_CLAUDE_LOG = hookLog;
  chat = await launchChatApp({ name: 'chat-question-notes', scenario: scenarioFile });
  page = chat.window;
  helpers = chatHelpers(page);
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await chat?.dispose();
  } finally {
    if (savedLog === undefined) delete process.env.DONEL_FAKE_CLAUDE_LOG;
    else process.env.DONEL_FAKE_CLAUDE_LOG = savedLog;
    removeTempDir(tmp);
  }
});

test('observacao: escolha unica, multipla e "Outra" levam a observacao ao CLI em annotations @chat', async () => {
  test.setTimeout(180_000);
  await launchClaudeTab(page, { name: 'notas' });
  await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
  await expect(composer()).toBeVisible({ timeout: 20_000 });
  await send('pergunta com observacao');
  await expect(panel()).toBeVisible({ timeout: 30_000 });

  // 1 - escolha unica + observacao de duas linhas. Fechado, o campo e so o link discreto.
  await expect(card().getByTestId('pending-notes')).toHaveCount(0);
  await card().getByTestId('pending-option').filter({ hasText: 'SQLite' }).click();
  await helpers.shot('observacao-00-fechado');
  await card().getByTestId('pending-notes-open').click();
  const notes = card().getByTestId('pending-notes');
  await expect(notes).toBeFocused();
  await notes.fill('só em dev\nem prod continua Postgres');
  // Esc no campo nao nega a pergunta: so sai do campo, e a observacao fica.
  await notes.press('Escape');
  await expect(panel()).toBeVisible();
  await expect(notes).toHaveValue('só em dev\nem prod continua Postgres');
  await helpers.shot('observacao-01-escolha-unica');

  // 2 - multipla + observacao; trocar de opcao depois nao apaga a observacao.
  await page.getByTestId('pending-next').click();
  await card().getByTestId('pending-option').filter({ hasText: 'main' }).click();
  await card().getByTestId('pending-notes-open').click();
  await card().getByTestId('pending-notes').fill('preload fica para depois');
  await card().getByTestId('pending-option').filter({ hasText: 'renderer' }).click();
  await expect(card().getByTestId('pending-notes')).toHaveValue('preload fica para depois');

  // 3 - "Outra" + observacao.
  await page.getByTestId('pending-next').click();
  await card().getByTestId('pending-other').fill('beacon');
  await card().getByTestId('pending-notes-open').click();
  await card().getByTestId('pending-notes').fill('nome provisório');

  // Voltar a pagina 1: a observacao escrita continua la, com o campo aberto.
  await page.getByTestId('pending-prev').click();
  await page.getByTestId('pending-prev').click();
  await expect(card().getByTestId('pending-notes')).toHaveValue('só em dev\nem prod continua Postgres');
  await helpers.shot('observacao-02-volta-pagina');

  await page.getByTestId('pending-answer').click();
  const input = await answerAt(0);
  expect(input.answers).toEqual({ 'Qual banco?': 'SQLite', 'Quais camadas?': 'main, renderer', 'Qual nome?': 'beacon' });
  expect(input.annotations).toEqual({
    'Qual banco?': { notes: 'só em dev\nem prod continua Postgres' },
    'Quais camadas?': { notes: 'preload fica para depois' },
    'Qual nome?': { notes: 'nome provisório' },
  });
  await expect(panel()).toHaveCount(0, { timeout: 15_000 });
  await expectNotWorking();
  // What the model reads: the fake renders the note as the real CLI does.
  await expect.poll(() => toolResultTexts().join('\n'), { timeout: 15_000 }).toContain('"Qual banco?"="SQLite" notes: só em dev');
});

test('sem observacao: o payload e o de antes, sem annotations; "remover observacao" limpa @chat', async () => {
  test.setTimeout(120_000);
  await send('pergunta sem observacao');
  await expect(panel()).toBeVisible({ timeout: 30_000 });
  await card().getByTestId('pending-option').filter({ hasText: 'Postgres' }).click();
  // Abrir, escrever e remover: nada vai.
  await card().getByTestId('pending-notes-open').click();
  await card().getByTestId('pending-notes').fill('rascunho');
  await card().getByTestId('pending-notes-remove').click();
  await expect(card().getByTestId('pending-notes')).toHaveCount(0);
  await expect(card().getByTestId('pending-notes-open')).toBeVisible();
  await page.getByTestId('pending-answer').click();

  const input = await answerAt(1);
  expect(input.answers).toEqual({ 'Qual banco?': 'Postgres' });
  expect(Object.keys(input)).not.toContain('annotations');
  await expect(panel()).toHaveCount(0, { timeout: 15_000 });
});
