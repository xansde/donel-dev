import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Smoke da decisão A (2026-07-23, CLAUDE.md/feedback-e2e.md rodada 5) — a
// aba inicial deixa de abrir sessão claude sozinha: o app agora nasce com
// ZERO abas e um empty state na área do terminal (App.tsx `INITIAL_TABS`
// vazio + `styles.emptyState`). Este smoke prova o ciclo de vida completo do
// estado vazio, que antes só era alcançável fechando manualmente TODAS as
// abas (T010) e agora é também o estado INICIAL do app:
//   1. boot -> zero abas, empty state visível, statusbar/terminal-pane
//      coerentes com "nenhuma sessão" (sem "Sessão: undefined", sem
//      terminal-pane nenhum montado);
//   2. abrir uma sessão -> empty state some;
//   3. fechar a única aba aberta -> empty state volta.
//
// Usa terminal LIVRE (shell, `powershell.exe`) em vez de sessão claude de
// propósito — custo zero de cota/API (regra do projeto: sessões claude de
// teste só quando o cenário exige, ver CLAUDE.md "cota escassa"). O empty
// state reage a `tabs.length`, não a `sessionType` — uma aba shell prova o
// mecanismo tão bem quanto uma aba claude.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('empty-state');
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: APP_CWD });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
});

/** Confirma o modal "Fechar sessão?" (FR-006) se ele aparecer — só some quando o processo da aba está vivo (mesmo helper de tabs-lifecycle.spec.ts). */
async function confirmCloseModalIfOpen(): Promise<void> {
  await window
    .getByRole('button', { name: 'Fechar sessão' })
    .click({ timeout: 3_000 })
    .catch(() => undefined);
}

test('app abre com zero abas e empty state; abrir sessão faz o empty state sumir; fechar a última aba faz voltar (decisão A)', async () => {
  test.setTimeout(60_000);

  // 1. Boot: zero abas, empty state visível com CTA, nenhum terminal-pane
  // montado, statusbar coerente (0 sessões, rótulo do perfil ATIVO global —
  // nunca "Sessão: undefined", já que não há aba em foco nenhuma).
  const emptyState = window.locator('[data-testid="empty-state"]');
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText('Nenhuma sessão aberta');
  await expect(window.locator('[role="tab"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="terminal-pane"]')).toHaveCount(0);

  const statusbarAccount = window.locator('[data-testid="statusbar-account"]');
  await expect(statusbarAccount).toBeVisible();
  await expect(statusbarAccount).not.toHaveText(/undefined/);
  // StatusBar.tsx: `sessionCount === 1 ? '1 sessão' : '${n} sessões'` — 0 cai no plural, sem crash de pluralização.
  await expect(window.locator('text=0 sessões')).toBeVisible();

  // 2. Abre uma sessão (terminal livre, custo zero — ver cabeçalho do
  // arquivo) pelo menu do "＋ Nova sessão" — o empty state some.
  await window.getByRole('button', { name: 'Mais opções de ＋ Nova sessão' }).click();
  await window.getByRole('menuitem', { name: 'Terminal (shell livre)' }).click();

  const tab = window.locator('[role="tab"]', { hasText: 'Terminal' });
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(emptyState).toHaveCount(0);
  await expect(window.locator('[data-testid="terminal-pane"]')).toBeVisible();

  // 3. Fecha a única aba aberta — o empty state volta (mesmo estado do
  // boot, alcançado agora por fechamento manual, T010 — prova que os dois
  // caminhos convergem pro MESMO empty state, não dois estados parecidos).
  const pane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    expect((await pane.innerText()).length).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 }); // processo powershell de pé (aliveTabs=true) antes de fechar — senão o "Fechar aba" fecha direto sem modal, o que o teste também tolera via `confirmCloseModalIfOpen`.

  await tab.getByRole('button', { name: 'Fechar aba Terminal' }).click();
  await confirmCloseModalIfOpen();

  await expect(window.locator('[role="tab"]')).toHaveCount(0);
  await expect(emptyState).toBeVisible();
  await expect(window.locator('[data-testid="terminal-pane"]')).toHaveCount(0);
});

test('CTA "＋ Nova sessão" dentro do empty state também abre uma sessão claude (mesmo caminho do corpo do SplitButton)', async () => {
  test.setTimeout(60_000);

  // Estado limpo herdado do teste anterior (mesma janela/app, mesmo
  // arquivo): zero abas de novo, empty state visível.
  const emptyState = window.locator('[data-testid="empty-state"]');
  await expect(emptyState).toBeVisible();

  // O botão DENTRO do empty state (App.tsx, `handleQuickNewClaudeSession`)
  // é o mesmo handler do corpo do "＋ Nova sessão" do titlebar — rótulo
  // "Nova sessão" (sem "＋") de propósito, pra não colidir com o nome
  // acessível do botão do titlebar enquanto os dois estão visíveis (ver
  // comentário em App.tsx). Única sessão claude real deste arquivo,
  // propositalmente a última asserção (não precisa de prompt algum, só
  // provar que o clique liga o cabo certo).
  await emptyState.getByRole('button', { name: 'Nova sessão' }).click();

  await expect(emptyState).toHaveCount(0);
  const terminalPane = window.locator('[data-testid="terminal-pane"]');
  await expect(terminalPane).toBeVisible();
  await expect(async () => {
    const text = await terminalPane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });
});
