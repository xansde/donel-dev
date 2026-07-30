import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { APP_MAIN, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// CA-30 (009-modo-dev-v3, lote 9) — smoke do "lançar um projeto do zero
// pelo app" (US-15): abre o seletor de projetos no titlebar → "＋ Novo
// projeto" → cria num diretório temporário ISOLADO → o projeto aparece
// imediatamente na sidebar (re-scan), com o marcador CLAUDE.md em disco.
//
// Isolamento: `--user-data-dir` (userDataIsolation.ts, mesmo padrão do
// resto da suíte) cobre o ConfigStore inteiro; como `projectRoots` nasce com
// o default REAL da máquina (`~/seazone`, `~/pessoal` — project-scanner.ts
// `defaultProjectRoots`), este smoke troca os dois pelos de Preferências por
// UM root isolado (`mkdtempSync`) ANTES de criar qualquer coisa — nenhuma
// escrita aqui toca `~/seazone` real do Alexandre.

const PROJECT_NAME = 'ca30-smoke-projeto-novo';
const DEFAULT_ROOTS = [join(homedir(), 'seazone'), join(homedir(), 'pessoal')];

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
let isolatedRoot: string;

async function launchApp(): Promise<void> {
  electronApp = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
}

/** Troca os roots default pelo `isolatedRoot` — via a UI de Preferências (T015), sem tocar ConfigStore/disco por fora do app. */
async function isolateProjectRoots(): Promise<void> {
  await window.getByRole('button', { name: 'Preferências' }).click();
  const dialog = window.getByRole('dialog', { name: 'Preferências' });
  await expect(dialog).toBeVisible();

  // Sequencial e ESPERANDO cada remoção assentar antes da próxima: os dois
  // handlers (`handleRemoveProjectRoot`, App.tsx) leem `appConfig.projectRoots`
  // do estado React NA HORA DO CLIQUE — dois cliques em sequência rápida
  // correriam sobre o mesmo snapshot stale e um dos dois roots "ressuscitaria".
  for (const root of DEFAULT_ROOTS) {
    const removeButton = dialog.getByRole('button', { name: `Remover pasta ${root}` });
    if (await removeButton.isVisible().catch(() => false)) {
      await removeButton.click();
      await expect(removeButton).toBeHidden();
    }
  }

  await dialog.getByLabel('Nova pasta-raiz').fill(isolatedRoot);
  await dialog.getByRole('button', { name: 'Adicionar' }).click();
  await expect(dialog.getByText(isolatedRoot)).toBeVisible();

  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(dialog).toBeHidden();
}

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('new-project');
  isolatedRoot = mkdtempSync(join(tmpdir(), 'donel-dev-smoke-new-project-root-'));
  await launchApp();
  await isolateProjectRoots();
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test('CA-30 — seletor de projetos no titlebar cria um projeto novo dentro do root isolado e ele aparece na sidebar', async () => {
  test.setTimeout(60_000);

  // 1. Abre o seletor de projetos do titlebar.
  const trigger = window.getByRole('button', { name: 'Trocar de projeto' });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const projectsDialog = window.getByRole('dialog', { name: 'Projetos' });
  await expect(projectsDialog).toBeVisible();

  // 2. "＋ Novo projeto" abre o modal de criação (e fecha o popover).
  await projectsDialog.getByRole('button', { name: '＋ Novo projeto' }).click();
  await expect(projectsDialog).toBeHidden();

  const newProjectDialog = window.getByRole('dialog', { name: 'Novo projeto' });
  await expect(newProjectDialog).toBeVisible();

  // 3. Fonte do código default é "Começar vazio" — "Criar projeto" nasce
  //    desabilitado até o nome ser preenchido (sem root inválido, sem nome vazio).
  const createButton = newProjectDialog.getByRole('button', { name: 'Criar projeto' });
  await expect(createButton).toBeDisabled();

  await newProjectDialog.getByLabel('Nome do projeto').fill(PROJECT_NAME);

  // 4. "Pasta local" é o preview (só-leitura) do destino real — dentro do root isolado.
  const expectedPath = join(isolatedRoot, PROJECT_NAME);
  await expect(newProjectDialog.getByLabel('Pasta local')).toHaveValue(`${isolatedRoot}\\${PROJECT_NAME}`);

  await expect(createButton).toBeEnabled();
  await createButton.click();

  // 5. Sucesso fecha o modal (sem mensagem de erro).
  await expect(newProjectDialog).toBeHidden({ timeout: 15_000 });

  // 6. Em disco: a pasta existe DENTRO do root isolado, com o marcador
  //    CLAUDE.md (garante o projeto na lista mesmo sem git) e `.git` (best
  //    effort — a máquina de dev tem git, então isto é esperado aqui).
  expect(existsSync(expectedPath)).toBe(true);
  expect(existsSync(join(expectedPath, 'CLAUDE.md'))).toBe(true);
  expect(existsSync(join(expectedPath, '.git'))).toBe(true);

  // 7. Aparece IMEDIATAMENTE na sidebar (re-scan), sem precisar reiniciar o app.
  const sidebar = window.locator('nav[aria-label="Projetos e sessões"]');
  await expect(sidebar.locator(`[data-testid="project-row-${PROJECT_NAME}"]`)).toBeVisible({ timeout: 10_000 });

  // 8. E também no próprio seletor do titlebar (reabre o popover). Escopado
  //    ao dialog: a sessão claude que a criação já abriu tem seu próprio
  //    cabeçalho mostrando o mesmo path (session-header), e um `getByText`
  //    solto bateria nos dois.
  await trigger.click();
  const reopenedDialog = window.getByRole('dialog', { name: 'Projetos' });
  await expect(reopenedDialog).toBeVisible();
  await expect(reopenedDialog.getByText(expectedPath)).toBeVisible();
});
