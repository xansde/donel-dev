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
// Teste 1 usa terminal LIVRE (shell, `powershell.exe`) de propósito — custo
// zero de cota/API (regra do projeto: sessões claude de teste só quando o
// cenário exige, ver CLAUDE.md "cota escassa"). O empty state reage a
// `tabs.length`, não a `sessionType` — uma aba shell prova o mecanismo tão
// bem quanto uma aba claude.
//
// Teste 2 PRECISA de uma sessão claude real (auditoria rodada 6, achado
// media "CTA do empty state reproduz o bug em 1 clique") — só assim dá pra
// provar que o caminho SAUDÁVEL (projeto já confiável, via Launcher) não
// fica preso no diálogo de confiança do jeito que `os.homedir()` ficava;
// modelo `haiku` (barato) e nenhum prompt enviado (boot não dispara turno de
// API) minimizam o custo.

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

test('CTA "Nova sessão" do empty state abre o Launcher (sem projeto/lastLaunch, em vez de reproduzir o bug em 1 clique); escolher um projeto lança uma sessão claude saudável (auditoria rodada 6, achado media)', async () => {
  test.setTimeout(60_000);

  // Estado herdado do teste anterior (mesma janela/app, mesmo arquivo):
  // zero abas de novo, empty state visível. A aba shell do teste 1 usou o
  // menu do SplitButton (`handleNewFreeTerminal`), que nunca grava
  // `selectedProjectPath`; `lastLaunch` também nunca foi tocado (só
  // `handleLaunch`, via Launcher, grava) — este teste ainda reproduz
  // exatamente o estado "boot limpo, nenhum projeto escolhido ainda" que
  // o achado mirava.
  const emptyState = window.locator('[data-testid="empty-state"]');
  await expect(emptyState).toBeVisible();

  // FIX (auditoria rodada 6, achado media "CTA do próprio empty state
  // reproduz o bug reportado em 1 clique") — ANTES: este clique reaproveitava
  // `handleQuickNewClaudeSession` direto e, sem `lastLaunch`/
  // `selectedProjectPath`, spawnava a sessão em `cwd: undefined` ->
  // `os.homedir()` -> "Quick safety check" preso, semáforo `undefined` pra
  // sempre — e o teste PASSAVA mesmo assim, porque a única asserção era
  // "terminal-pane não vazio, sem CLAUDE_NOT_FOUND" (não provava nada sobre o
  // estado ÚTIL da sessão). App.tsx agora abre o Launcher em vez de
  // reproduzir esse cenário (`handleEmptyStateNewSession`) — o botão do
  // titlebar (corpo do "＋ Nova sessão") continua com o atalho antigo de
  // propósito, coberto por terminal.spec.ts/profiles.spec.ts/shell.spec.ts.
  await emptyState.getByRole('button', { name: 'Nova sessão' }).click();

  const launcher = window.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible();
  // Nenhuma sessão nasceu só de abrir o painel — prova que o caminho antigo
  // (spawn direto em home) não roda mais a partir deste botão.
  await expect(window.locator('[data-testid="terminal-pane"]')).toHaveCount(0);
  await expect(emptyState).toBeVisible();

  // Escolhe um projeto real e JÁ confiável nesta máquina (o próprio repo sob
  // teste, usado em centenas de execuções reais do CLI — nunca dispara o
  // "Quick safety check") — prova o caminho SAUDÁVEL completo até uma sessão
  // claude de verdade, não só que o Launcher abriu. `haiku` (barato) mesmo
  // sem nenhum turno de fato disparar (boot não custa API) — convenção do
  // resto da suíte (model-injection.spec.ts).
  await launcher.getByRole('button', { name: 'Selecione um projeto' }).click();
  await window.getByRole('option', { name: 'donel-dev', exact: true }).click();
  await launcher.getByRole('radio', { name: 'haiku', exact: true }).click();
  await launcher.getByLabel('Nome').fill('empty-state-cta-test');
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const newTab = window.locator('[role="tab"]', { hasText: 'empty-state-cta-test' });
  await expect(newTab).toBeVisible();
  await expect(emptyState).toHaveCount(0);

  const terminalPane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(terminalPane).toBeVisible();
  await expect(async () => {
    const text = await terminalPane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });

  // FIX (auditoria rodada 6, achado media "teste passa com a sessão presa no
  // diálogo") — asserção sobre o estado final ÚTIL da sessão (não só "tem
  // texto"): o hint da toolbar (SessionDetails.tsx, App.tsx
  // `possiblyBlockedOnPrompt`) prova que a sessão NÃO ficou presa — se
  // tivesse ficado (o cenário do bug original), o hint mudaria pro texto de
  // diagnóstico ("O CLI pode estar aguardando resposta...") depois de ~20s.
  // `donel-dev` já é confiável nesta máquina, então o hint esperado é o de
  // sessão pronta (toolbar Modelo/Esforço segue desabilitada por design até
  // o primeiro turno, FR-011 — não mandamos nenhum prompt aqui, custo de
  // cota; ver `tests/possiblyBlockedOnPrompt.test.ts` pra cobertura de
  // unidade dos dois sentidos dessa decisão).
  const hint = window.locator('[data-testid="session-details-hint"]');
  await expect(hint).toHaveText(
    'Sessão pronta — digite no terminal; modelo/esforço liberam após o primeiro turno.',
    { timeout: 25_000 },
  );
});
