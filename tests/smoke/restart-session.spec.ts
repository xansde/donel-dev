import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { APP_MAIN, PROJECT_NAME, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Smoke do lote 8 (009-modo-dev-v3), CA-24 — "Reiniciar sessão em foco":
// prova até o ponto de COMANDO ARMADO (`claude -r <sessionId>`), sem gastar
// cota de API (nenhum prompt é digitado/enviado depois do resume — mesmo
// espírito de custo de session-rename-live.spec.ts). Roda com o perfil
// Principal ativo (default do config semeado): mesma conta de origem e de
// destino, então o CA-24 não precisa copiar transcript nenhum — é o caminho
// `same-profile` de `planTranscriptCopy` (shared/transcriptCopy.ts, coberto
// por unidade). O caminho cross-conta (cópia de verdade) é coberto por
// unidade em tests/transcript-copy.test.ts (fs fake) — reproduzi-lo aqui
// exigiria criar um 2º perfil de verdade (bootstrap de `.claude.json` via
// `claude -p`, ver profile-manager.ts), custo desproporcional pra este smoke.
//
// A descoberta do `sessionId` da sessão viva usa o MESMO truque de
// session-rename-live.spec.ts (renomear pela UI revela a chave no
// `config.json` sem inventar API de teste) — nenhum dado novo exposto só
// para teste.

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('restart-session');
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: REPO_ROOT });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  test.setTimeout(90_000); // folga do B11 — close com PTY vivo
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
  }
});

test('CA-24 — "Reiniciar sessão em foco" arma o comando `-r <sessionId>` e não some sem confirmação', async () => {
  test.setTimeout(120_000);

  // Só faz sentido com o perfil Principal ativo — mesma ressalva de
  // session-rename-live.spec.ts (config semeado já garante isso, mas o
  // skip protege contra ambiente divergente).
  const profiles = await appWindow.evaluate(() => window.donel.profiles.list());
  const active = profiles.find((profile) => profile.active);
  test.skip(!active?.isPrimary, `perfil ativo não é o Principal (${active?.slug})`);

  // 1. Abre uma sessão claude real (1 clique na sidebar).
  const sidebar = appWindow.locator('nav[aria-label="Projetos e sessões"]');
  const projectRow = sidebar.locator(`[data-testid="project-row-${PROJECT_NAME}"]`);
  await expect(projectRow).toBeVisible({ timeout: 15_000 });
  await projectRow.getByRole('button', { name: PROJECT_NAME, exact: true }).click();

  const tab = appWindow.locator('[role="tab"]').first();
  await expect(tab).toBeVisible();
  const pane = appWindow.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    const text = await pane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 30_000 });

  // Diálogo de confiança de pasta, quando aparece — responde como humano
  // (mesmo padrão dos smokes de Modo Dev). Nunca cai sobre o comando armado:
  // o resume só é preparado bem mais adiante, depois de confirmado no modal.
  await expect(async () => {
    const text = await pane.innerText();
    if (text.includes('trust this folder') || text.includes('Do you trust')) {
      await pane.click();
      await appWindow.keyboard.press('Enter');
    }
    expect(text.toLowerCase()).toContain('claude code');
  }).toPass({ timeout: 60_000 });

  // 2. Botão "Reiniciar sessão em foco" só aparece com `claudeSessionId`
  //    resolvido — sinal direto de que a sessão está pronta, sem precisar
  //    ler nenhum estado interno novo.
  const restartButton = appWindow.locator('[data-testid="restart-session-button"]');
  await expect(restartButton).toBeVisible({ timeout: 30_000 });

  // 3. Descobre o sessionId da sessão viva pelo MESMO truque de
  //    session-rename-live.spec.ts: renomear pela UI persiste sob a chave.
  const uiName = `restart-${Date.now().toString(36)}`;
  await tab.getByText(PROJECT_NAME, { exact: true }).dblclick();
  const nameInput = tab.getByRole('textbox');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(uiName);
  await nameInput.press('Enter');
  await expect(tab).toHaveAttribute('title', new RegExp(`^${uiName} —`));

  const config = await appWindow.evaluate(() => window.donel.config.get());
  const entries = Object.entries(config.sessionNames).filter(([, entry]) => entry.name === uiName);
  expect(entries, 'o rename pela UI tinha de ter persistido sob o sessionId da sessão viva').toHaveLength(1);
  const [sessionId] = entries[0];

  // 4. Clicar SEM confirmar não faz nada: nenhum comando armado, nenhuma aba nova.
  const tabsBefore = await appWindow.locator('[role="tab"]').count();
  await restartButton.click();
  const modal = appWindow.getByRole('dialog', { name: 'Reiniciar sessão em foco?' });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(active!.slug);
  await modal.getByRole('button', { name: 'Cancelar' }).click();
  await expect(modal).not.toBeVisible();
  expect(await appWindow.locator('[role="tab"]').count()).toBe(tabsBefore);
  await expect(appWindow.locator('[data-testid="restart-last-session"]')).toHaveText('');

  // 5. Confirmado: o comando armado é EXATAMENTE `claude -r <sessionId>` —
  //    mesma conta de origem e destino (Principal), então `same-profile`
  //    (shared/transcriptCopy.ts) decide sem copiar nada.
  await restartButton.click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '⟳ Reiniciar' }).click();
  await expect(appWindow.locator('[data-testid="restart-last-session"]')).toHaveText(`claude -r ${sessionId}`, {
    timeout: 30_000,
  });

  // 6. A aba original fecha e uma nova nasce no lugar — mesma contagem final,
  //    nunca duas abas da "mesma" sessão abertas ao mesmo tempo.
  await expect(async () => {
    expect(await appWindow.locator('[role="tab"]').count()).toBe(tabsBefore);
  }).toPass({ timeout: 30_000 });
});
