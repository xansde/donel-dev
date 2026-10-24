import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { listPids, listPidsByCommandLine, waitForNewPids, waitForPidsGone } from './helpers/processes';
import { confirmCloseModalIfOpen, launchClaudeTab, openFreeTerminalTab } from './helpers/ui';

// Smoke da T010 (abas múltiplas + ciclo de vida + terminal livre, FR-006/
// FR-008). Instância própria de Electron (não compartilha janela com
// terminal.spec.ts) pra medir vazamento de processo isoladamente.
//
// A prova de "sem vazamento de PTY" usa `tasklist` real do Windows — nunca
// confia só no estado da UI (uma aba podia sumir da tela e o powershell.exe
// continuar vivo por trás). Como esta máquina roda VÁRIAS sessões claude/
// powershell concorrentes (outros subagentes desta mesma esteira), contagens
// absolutas são inúteis — cada asserção usa DIFERENÇA de PID (snapshot antes
// vs. depois de uma ação específica), nunca tamanho absoluto do conjunto.

// T801/§B19 (008) — `APP_MAIN`/`REPO_ROOT`/`PROJECT_NAME` vêm de
// `repoUnderTest.ts`: o projeto na sidebar é o `basename` da PASTA de onde a
// suíte roda (numa worktree, `donel-dev-wt-x`), nunca o literal `donel-dev`.

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  ({ app: electronApp, window, userDataDir } = await launchIsolatedApp({ name: 'tabs-lifecycle' }));
});

test.afterAll(async () => {
  // FIX (achado da suíte completa, rodada 6) — este arquivo é o mais pesado
  // do diretório (6+ sessões PTY/claude.exe simultâneas nos 2 testes); sob
  // carga real da máquina (outras sessões claude concorrentes, comum neste
  // ambiente de dev — confirmado via `tasklist`: 14 processos `claude.exe`
  // concorrentes durante a validação desta suíte) `electronApp.close()` —
  // que espera o processo Electron encerrar de verdade, incluindo o
  // teardown de todos os PTYs vivos — pode passar do timeout default de
  // hook (30s, playwright.config.ts). Não é vazamento (tabs-lifecycle.spec.ts
  // já prova isso via `tasklist` real dentro dos próprios testes); é só o
  // fechamento levando mais tempo sob contenção de CPU/IO. `test.setTimeout`
  // aqui (chamável dentro do hook, Playwright API) dá folga só a ESTE
  // `afterAll`, sem mascarar nenhuma asserção nem virar retry global.
  test.setTimeout(90_000);
  // FIX (auditoria rodada 6, achado baixa "resíduo em %TEMP% quando o close
  // estoura") — ANTES a limpeza do diretório temp só rodava DEPOIS de
  // `electronApp.close()` resolver; se o close estourasse os 90s de folga
  // acima (sob carga real da máquina — o próprio motivo da folga existir),
  // o diretório ficava órfão pra sempre (2 resíduos
  // `donel-dev-smoke-tabs-lifecycle-*` encontrados na auditoria rodada 6,
  // já limpos manualmente). `finally` garante a limpeza mesmo se o close
  // falhar/estourar.
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('T010 — abrir/fechar um terminal livre 3x não deixa powershell.exe órfão, e "sessão encerrada" -> Reabrir respawna processo de verdade (FR-006/FR-008) @abas', async () => {
  test.setTimeout(120_000);

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const beforeOpen = listPids('powershell.exe');

    await openFreeTerminalTab(window);
    const newTab = window.locator('[role="tab"]', { hasText: 'Terminal' }).last();
    await expect(newTab).toBeVisible();
    await expect(newTab).toHaveAttribute('aria-selected', 'true');

    // Aba nova = processo powershell.exe novo de verdade (não só um elemento na UI).
    const spawnedPids = await waitForNewPids('powershell.exe', beforeOpen, 1);

    const pane = window.locator('[data-testid="terminal-pane"]:visible');
    await pane.click();

    // Processo termina SOZINHO (FR-006, 2ª metade): `exit` no prompt real do
    // PowerShell mata o processo de verdade — não é o app fingindo estado.
    await window.keyboard.type('exit', { delay: 20 });
    await window.keyboard.press('Enter');

    // Overlay é IRMÃO do container do xterm (não descendente) — TerminalPane.tsx
    // renderiza os dois direto sob `.wrapper`, por isso o locator é separado de `pane`.
    const endedOverlay = window.locator('[data-testid="session-ended-overlay"]');
    await expect(endedOverlay).toBeVisible({ timeout: 15_000 });
    await waitForPidsGone('powershell.exe', spawnedPids); // prova: o `exit` matou o processo de verdade, não só mudou a UI

    // "Reabrir" (ui-spec §2 "sessão encerrada"): respawna um processo NOVO na mesma aba.
    const beforeReopen = listPids('powershell.exe');
    await endedOverlay.getByRole('button', { name: 'Reabrir' }).click();
    const reopenedPids = await waitForNewPids('powershell.exe', beforeReopen, 1);

    // Fecha pela barra de abas — processo está vivo de novo (pós-Reabrir) => pede confirmação (FR-006, 1ª metade).
    await newTab.getByRole('button', { name: 'Fechar aba Terminal' }).click();
    await expect(window.getByRole('dialog', { name: 'Fechar sessão?' })).toBeVisible();
    await confirmCloseModalIfOpen(window);
    await waitForPidsGone('powershell.exe', reopenedPids);

    await expect(window.locator('[role="tab"]', { hasText: 'Terminal' })).toHaveCount(0);

    // Fim do ciclo: nenhum PID novo sobrevive — sem acúmulo entre ciclos.
    const afterCycle = listPids('powershell.exe');
    for (const pid of [...spawnedPids, ...reopenedPids]) expect(afterCycle.has(pid)).toBe(false);
  }
});

test('T010 — 5 sessões simultâneas (1 claude + 4 shell); fechar 3 mata só os processos certos, sem vazamento (tasklist) @abas', async () => {
  test.setTimeout(180_000);

  const shellBaseline = listPids('powershell.exe');
  // FIX (decisão A, 2026-07-23) — antes já incluía a aba "Sessão" default,
  // aberta sozinha no boot do app; essa aba deixou de existir (app nasce com
  // zero abas). `claudeBaseline` agora só cobre QUALQUER sessão claude alheia
  // já rodando na máquina (fora do controle deste teste) — a diferença de
  // PID (`waitForNewPids` abaixo) continua sendo a prova real, nunca uma
  // contagem absoluta.
  // The claude of this spec is the scripted fake: a `node.exe` running fake-claude-chat.mjs.
  const claudeBaseline = listPidsByCommandLine('node.exe', 'fake-claude-chat');

  // 4 abas de terminal livre (FR-008) via "+" > Terminal.
  for (let i = 0; i < 4; i += 1) await openFreeTerminalTab(window);
  const shellTabs = window.locator('[role="tab"]', { hasText: 'Terminal' });
  await expect(shellTabs).toHaveCount(4);
  const shellPidsAdded = await waitForNewPids('powershell.exe', shellBaseline, 4);

  // Única sessão claude desta run (decisão A removeu a aba "Sessão" default
  // que antes existia sozinha) — haiku (barato), sem prompt. Este arquivo
  // nunca abre nada pela sidebar (só pelo "+"/Launcher), então "Projeto-alvo"
  // nasce vazio — sem selecionar um projeto o "▶ Iniciar" fica desabilitado
  // (`canLaunch`, Launcher.tsx). Seleciona `donel-dev` (o próprio repo sob
  // teste) direto no Select do Launcher, sem passar pela sidebar (evita abrir
  // uma 6ª aba redundante).
  const claudeTab = await launchClaudeTab(window, { model: 'haiku', name: 'lifecycle-test' });
  const claudePidsAdded = await waitForNewPids('node.exe', claudeBaseline, 1, 30_000, false, 'fake-claude-chat');

  // Total: lifecycle-test (claude) + 4 Terminal (shell) = 5 (sem aba
  // "Sessão" default — decisão A).
  await expect(window.locator('[role="tab"]')).toHaveCount(5);

  // Digita echo em 2 das 4 abas de terminal livre (custo mínimo — não toca as sessões claude, DoD da task).
  for (let i = 0; i < 2; i += 1) {
    const tab = shellTabs.nth(i);
    await tab.click();
    const pane = window.locator('[data-testid="terminal-pane"]:visible');
    await pane.click();
    const marker = `tab-echo-${i}`;
    await window.keyboard.type(`echo ${marker}`, { delay: 20 });
    await window.keyboard.press('Enter');
    await expect(async () => {
      expect(await pane.innerText()).toContain(marker);
    }).toPass({ timeout: 10_000 });
  }

  // Fecha 3 abas — 2 terminais livres + a sessão claude nova — misturando os dois sessionType (FR-006 genérico, não só claude).
  const closeTab = async (tabLocator: Locator, closeButtonName: string): Promise<void> => {
    await tabLocator.getByRole('button', { name: closeButtonName }).click();
    await confirmCloseModalIfOpen(window);
  };
  await closeTab(shellTabs.nth(0), 'Fechar aba Terminal');
  await closeTab(shellTabs.nth(0), 'Fechar aba Terminal'); // depois de fechar a 1ª, a próxima 0-index é a 2ª
  await closeTab(claudeTab, 'Fechar aba lifecycle-test');

  // 2 Terminal restantes — a única aba claude (lifecycle-test) foi uma das
  // 3 fechadas acima, então zero abas claude sobram (decisão A: sem aba
  // "Sessão" default pra sobreviver ao fechamento).
  await expect(window.locator('[role="tab"]')).toHaveCount(2);

  // Prova de leak zero: EXATAMENTE os PIDs das abas fechadas morreram; os das abas que continuam abertas sobrevivem.
  await expect(async () => {
    const shellNow = listPids('powershell.exe');
    const stillAlive = shellPidsAdded.filter((pid) => shellNow.has(pid));
    const dead = shellPidsAdded.filter((pid) => !shellNow.has(pid));
    expect(dead.length).toBeGreaterThanOrEqual(2); // as 2 fechadas realmente morreram
    expect(stillAlive.length).toBeGreaterThanOrEqual(2); // as 2 que continuam na barra de abas NÃO foram mortas por engano
  }).toPass({ timeout: 15_000 });

  await waitForPidsGone('node.exe', claudePidsAdded, 15_000, 'fake-claude-chat'); // a sessão claude nova (lifecycle-test) também morreu de verdade

  // App segue vivo e sem crash depois de todo o ciclo.
  expect(electronApp.windows().length).toBeGreaterThan(0);
});
