import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir } from './userDataIsolation';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { confirmCloseModalIfOpen, openLauncherPanel, waitForClaudeBooted } from './helpers/ui';

// "Isolar em worktree" no Launcher → `claude --worktree <nome>`, e a limpeza ao FECHAR A ABA.
// Roda com o `claude` falso, que faz o que o CLI 2.1.314 faz com a flag (README do falso): cria
// `<repo>/.claude/worktrees/<nome>` na branch `worktree-<nome>`, trava com `claude session <nome> (pid N)`
// e roda a sessão dentro dela. O projeto é um repo git TEMPORÁRIO (nunca este repo): a worktree nasce
// debaixo do checkout principal do projeto, e um teste não pode criar nada no repo de verdade.

const PROJECT = 'wt-smoke-proj';
let root: string;
let repo: string;
/** O HEAD da pasta do projeto (branch `staging`, à frente de `main`, que é o `origin/HEAD`). */
let stagingSha: string;
let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const worktreesDir = (): string => path.join(repo, '.claude', 'worktrees');

test.beforeAll(async () => {
  test.setTimeout(120_000); // subir o app sob carga passa dos 30 s do default
  root = mkdtempSync(path.join(os.tmpdir(), 'smoke-launcher-wt-root-'));
  repo = path.join(root, PROJECT);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'smoke@test.invalid');
  git(repo, 'config', 'user.name', 'Smoke');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(repo, 'README.md'), '# smoke\n');
  writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  // Como o repo do dono: o padrão do remoto é `main` (o beta), mas a pasta trabalha em `staging`, à frente.
  // A sessão isolada tem de partir de `staging` (o HEAD da pasta), não de `origin/HEAD`.
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'staging');
  writeFileSync(path.join(repo, 'staging.txt'), 'só em staging\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'staging: à frente de main');
  stagingSha = git(repo, 'rev-parse', 'HEAD');

  const dir = createIsolatedUserDataDir('launcher-worktree');
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ userDataDir: dir }));
});

test.afterAll(async () => {
  test.setTimeout(180_000); // fechar o app com PTY sob carga já passou de 90 s (B11)
  try {
    await closeIsolatedApp({ app: electronApp, userDataDir });
  } finally {
    // A worktree que o teste deixou de propósito (com trabalho) e o repo temporário inteiro.
    try {
      for (const line of git(repo, 'worktree', 'list', '--porcelain').split(/\r?\n/)) {
        if (!line.startsWith('worktree ') || path.resolve(line.slice(9)) === path.resolve(repo)) continue;
        const wt = line.slice(9);
        try {
          git(repo, 'worktree', 'unlock', wt);
        } catch {
          // não estava travada
        }
        git(repo, 'worktree', 'remove', '--force', wt);
      }
    } catch {
      // repo já sumiu
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

/** Abre o Launcher no projeto temporário com "Isolar em worktree" ligado e inicia a sessão `name`. Devolve o nome da worktree. */
async function launchIsolated(name: string): Promise<string> {
  const launcher = await openLauncherPanel(appWindow);
  // Da segunda vez o Launcher já vem no projeto da última sessão (herdado da seleção).
  const placeholder = launcher.getByRole('button', { name: 'Selecione um projeto' });
  if (await placeholder.isVisible()) {
    await placeholder.click();
    await appWindow.getByRole('option', { name: PROJECT, exact: true }).click();
  }
  await expect(launcher.getByRole('button', { name: PROJECT })).toBeVisible();
  const toggle = launcher.getByRole('switch', { name: /Isolar em worktree/ });
  if (!(await toggle.isChecked())) await launcher.getByText('Isolar em worktree').click();
  await expect(toggle).toBeChecked();
  await launcher.getByLabel('Nome').fill(name);
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const command = appWindow.locator('[data-testid="launcher-last-command"]');
  await expect(command).toHaveText(new RegExp(`-n ${name} --worktree ${name}-\\d{4}-\\d{4}$`));
  const worktree = /--worktree (\S+)$/.exec((await command.textContent()) ?? '')?.[1];
  if (!worktree) throw new Error('o argv não trouxe --worktree');
  return worktree;
}

async function closeTab(name: string): Promise<void> {
  await appWindow.locator('[role="tab"]', { hasText: name }).getByRole('button', { name: `Fechar aba ${name}` }).click();
  await confirmCloseModalIfOpen(appWindow);
  await expect(appWindow.locator('[role="tab"]', { hasText: name })).toHaveCount(0);
}

test('sessão isolada sem trabalho: a aba mostra a worktree e, ao fechar, a pasta e a branch somem @abas', async () => {
  test.setTimeout(120_000);
  const worktree = await launchIsolated('isolada');
  const wtPath = path.join(worktreesDir(), worktree);

  const tab = appWindow.locator('[role="tab"]', { hasText: 'isolada' });
  await expect(tab).toContainText('⎇');
  await expect(appWindow.getByTestId('session-header-worktree')).toHaveText(`⎇ worktree-${worktree}`);
  await waitForClaudeBooted(appWindow);
  await expect.poll(() => existsSync(wtPath), { timeout: 20_000 }).toBe(true);
  // A trava vem logo depois da pasta (o falso faz `worktree add` e depois `worktree lock`, como o CLI).
  await expect.poll(() => git(repo, 'worktree', 'list', '--porcelain'), { timeout: 10_000 }).toContain(`locked claude session ${worktree} (pid `);
  // Nasceu no HEAD da pasta (staging), não em origin/HEAD (main): o --settings da aba leva `worktree.baseRef: "head"`.
  expect(git(wtPath, 'rev-parse', 'HEAD')).toBe(stagingSha);
  expect(existsSync(path.join(wtPath, 'staging.txt'))).toBe(true);

  await closeTab('isolada');
  await expect.poll(() => existsSync(wtPath), { timeout: 30_000 }).toBe(false);
  // A branch sai logo depois da pasta (a remoção vem antes, ver session-worktree.ts).
  await expect.poll(() => git(repo, 'branch', '--list', `worktree-${worktree}`), { timeout: 15_000 }).toBe('');
  expect(git(repo, 'worktree', 'list')).not.toContain(worktree);
  // Lembrado como os outros controles do Launcher.
  expect((await appWindow.evaluate(() => window.donel.config.get())).launcherDefaults.worktree).toBe(true);
});

test('sessão isolada com arquivo não commitado: ao fechar, nada é apagado e aparece o aviso com "Abrir pasta" @abas', async () => {
  test.setTimeout(120_000);
  const worktree = await launchIsolated('pendente');
  const wtPath = path.join(worktreesDir(), worktree);
  await waitForClaudeBooted(appWindow);
  await expect.poll(() => existsSync(wtPath), { timeout: 20_000 }).toBe(true);
  writeFileSync(path.join(wtPath, 'rascunho.md'), 'trabalho não enviado\n');

  await closeTab('pendente');
  const toast = appWindow.getByRole('status').filter({ hasText: `A worktree ${worktree} ficou porque tem trabalho não enviado` });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await expect(toast).toContainText('rascunho.md');
  await expect(toast.getByRole('button', { name: 'Abrir pasta' })).toBeVisible();
  expect(existsSync(path.join(wtPath, 'rascunho.md'))).toBe(true);
  expect(git(repo, 'branch', '--list', `worktree-${worktree}`)).toContain(`worktree-${worktree}`);
});
