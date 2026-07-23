import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Smoke da T013 (UI de sessões anteriores, FR-004/CA-2). Usa dados REAIS
// desta máquina (`~/.claude/projects/C--Users-...-donel-dev/*.jsonl` —
// dezenas de sessões deste mesmo repo, geradas por outras rodadas de smoke e
// pelo trabalho real na esteira) em vez de fixture sintética: só assim prova
// o slug real (session-indexer.ts `slugifyProjectPath`) E o parsing de
// preview contra transcripts de verdade — os sintéticos já estão cobertos
// pelo TDD do T012 (tests/session-indexer.test.ts).
//
// LGPD: o preview de uma sessão real pode conter conteúdo de trabalho de
// verdade (nomes de projeto, trechos de código etc.) — este arquivo NUNCA
// grava esse texto como literal. O "marcador" usado como prova de retomada é
// extraído do DOM em RUNTIME (a própria linha que o app renderizou a partir
// da sessão real) e só vive numa variável de teste — nunca aparece
// hardcoded aqui nem em log commitado (ver regra do prompt/CLAUDE.md).
//
// Custo: a prova de "histórico restaurado" nunca manda um prompt novo depois
// do resume — só espera o CLI carregar o contexto e reimprimir o scrollback
// da conversa restaurada. Sem prompt novo, sem turno de API novo cobrado.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: [APP_MAIN], cwd: APP_CWD });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

test('T013 — sessões anteriores reais do projeto donel-dev listam com preview, e "Retomar" restaura o histórico (FR-004, CA-2)', async () => {
  test.setTimeout(120_000);

  const sidebar = window.locator('nav[aria-label="Projetos e sessões"]');
  await expect(sidebar).toBeVisible();

  // Ícone dedicado (ProjectSidebar `onShowPreviousSessions`) — distinto do
  // clique no nome do projeto, que abre uma sessão NOVA direto (T007).
  const historyButton = sidebar.getByRole('button', { name: 'Sessões anteriores de donel-dev', exact: true });
  await expect(historyButton).toBeVisible({ timeout: 15_000 });
  await historyButton.click();

  const dialog = window.getByRole('dialog', { name: /Sessões anteriores · donel-dev/ });
  await expect(dialog).toBeVisible();

  // Dados REAIS desta máquina (ver cabeçalho do arquivo) — nunca fixture:
  // o repo sob teste (donel-dev) já tem dezenas de sessões anteriores reais.
  const rows = dialog.locator('[data-testid="previous-session-row"]');
  await expect(async () => {
    expect(await rows.count()).toBeGreaterThan(0);
  }).toPass({ timeout: 10_000 });
  expect(await dialog.locator('[data-testid="previous-sessions-empty"]').count()).toBe(0);

  // Sessão mais RECENTE (1ª linha — SessionIndexer ordena por mtime desc,
  // T012, `indexProjectSessions`).
  const firstRow = rows.first();
  const previewText = (await firstRow.locator('span').first().innerText()).trim();
  expect(previewText.length).toBeGreaterThan(0);

  // Marcador curto pra provar "histórico restaurado" mais adiante — extraído
  // em RUNTIME do preview real (nunca logado/hardcoded, ver cabeçalho). Pula
  // os dois fallbacks textuais do SessionIndexer (não são conteúdo de
  // conversa real, não provariam nada específico como marcador).
  const isFallbackPreview = previewText === '(sem mensagem de usuário)' || previewText === '(ilegível)';
  test.skip(isFallbackPreview, 'Sessão mais recente caiu num fallback do SessionIndexer (sem mensagem genuína/ilegível) — nada de específico do transcript pra provar via marcador de texto.');

  const words = previewText.replace(/[.,;:!?"'()]/g, ' ').split(/\s+/).filter((word) => word.length >= 4);
  test.skip(words.length === 0, 'Preview real sem nenhuma palavra >= 4 chars pra usar como marcador.');
  const marker = words[0];

  await firstRow.getByRole('button', { name: 'Retomar' }).click();

  // Modal fecha (App.tsx `handleResumeSession`) e a aba nova abre.
  await expect(dialog).toBeHidden();
  const activePane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(activePane).toHaveCount(1);

  await expect(async () => {
    const text = await activePane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });

  // Mesmo diálogo de "Quick safety check" dos outros smokes (terminal.spec.ts).
  await activePane.click();
  if ((await activePane.innerText()).includes('trust this folder')) {
    await window.keyboard.press('Enter');
  }

  // Prova real de CA-2: o histórico da sessão RETOMADA aparece no terminal —
  // o marcador (extraído da PRÓPRIA sessão em runtime, nunca hardcoded)
  // surge na tela sem que nenhum prompt novo tenha sido enviado por este
  // teste (o `claude -r <id>` sozinho já reimprime o scrollback restaurado).
  await expect(async () => {
    expect(await activePane.innerText()).toContain(marker);
  }).toPass({ timeout: 30_000 });
});
