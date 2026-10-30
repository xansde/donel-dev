import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir } from './userDataIsolation';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { launchClaudeTab } from './helpers/ui';

// Sidebar — "Abrir no editor" + branch atual da pasta da sessão. Com o
// `claude` falso (default). A branch esperada é a do próprio checkout de onde
// a suíte roda (lida aqui com o git, não hardcoded). O botão do editor tem de
// refletir o que o main achou no PATH desta máquina (`code`, senão `cursor`):
// habilitado com "Abrir no <editor>", ou desabilitado com a dica. Clicar não
// faz parte do smoke — abriria uma janela de editor de verdade.

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  // Root apontado para a pasta-mãe real do repo: o default (`~/seazone`) não lista uma worktree em `.claude/worktrees/`.
  const dir = createIsolatedUserDataDir('sidebar-editor-branch');
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ projectRoots: [path.dirname(REPO_ROOT)] }), 'utf8');
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ userDataDir: dir }));
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('linha da sessão mostra a branch atual e o botão do editor segue o que existe no PATH @sessoes', async () => {
  test.setTimeout(90_000);
  const expectedBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

  await launchClaudeTab(appWindow, { name: 'branch-test' });

  const sessions = appWindow.locator('nav[aria-label="Projetos e sessões"] section', { hasText: 'Sessões' }).last();
  const row = sessions.locator('div', { has: appWindow.getByRole('button', { name: /branch-test/ }) }).last();
  await expect(row.getByTestId('sidebar-branch')).toHaveText(expectedBranch, { timeout: 15_000 });

  const status = await appWindow.evaluate(() => window.donel.workspace.editorStatus());
  if (status.available) {
    const button = row.getByRole('button', { name: `Abrir branch-test no ${status.name}` });
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await expect(button).toHaveAttribute('title', `Abrir no ${status.name}`);
  } else {
    const button = row.getByRole('button', { name: 'Abrir branch-test no editor (indisponível)' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', 'Nenhum editor encontrado no PATH (code ou cursor)');
  }

  // O main recusa caminho que não é pasta absoluta (nada é spawnado).
  const refused = await appWindow.evaluate(() => window.donel.workspace.openInEditor('--version'));
  expect(refused).toEqual({ ok: false, reason: 'invalid-path' });
});
