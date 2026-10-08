import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PROJECT_NAME } from './repoUnderTest';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';

// Smoke do feedback E2E rodada 3 ("BUG — favoritar projeto só reflete após
// reiniciar o app", → Batch 5): a lógica de merge/ordenação já estava
// correta (tests/projects.test.ts) — o que faltava era a UI refletir sem
// esperar o round-trip do scan síncrono do main (App.tsx agora reordena
// otimisticamente, ver handleToggleFavorite).
//
// FIX (item 1, rodada de feedback do teste de 30/07) — "o seletor de
// projetos substitui a necessidade de ocupar a barra lateral com todos os
// projetos possíveis": a árvore completa "Projetos" saiu da sidebar (só
// ficaram Favoritos + Sessões); favoritar/desfavoritar um projeto qualquer
// migrou pro popover "Projetos" do seletor no titlebar (`ProjectSwitcher`).
// O CENÁRIO deste smoke continua o mesmo — favoritar reflete IMEDIATAMENTE,
// sem restart — só que a observação virou "o grupo aparece/some do
// `section[aria-label="Favoritos"]`" em vez de "a linha reordena", porque é
// isso que a UI nova expõe (favoritar não move mais uma linha dentro de uma
// árvore que não existe mais — ele faz o projeto NASCER como grupo).
//
// Roda contra o scan REAL de `~/seazone` (mesmo padrão de terminal.spec.ts
// — `donel-dev`, este próprio repo, sempre presente) — sem fixture
// isolada de projetos. `test.afterAll` deixa o favorito desmarcado de novo
// (best-effort) pra não sujar o `project-config.json` real da máquina.
//
// Variável da página chamada `appWindow` (não `window`, diferente do padrão
// dos outros arquivos de smoke) DE PROPÓSITO: este arquivo usa
// `page.evaluate()` pra chamar `window.donel.*` DENTRO do contexto do
// browser — nomear a variável do Playwright igual ao global do browser
// sombrearia `window` léxicamente pro TypeScript dentro do callback do
// `evaluate` (ele resolveria pro tipo `Page`, não pro `Window` do DOM).

// T801/§B19 (008) — `APP_MAIN`/`REPO_ROOT`/`PROJECT_NAME` vêm de
// `repoUnderTest.ts`: o projeto na sidebar é o `basename` da PASTA de onde a
// suíte roda (numa worktree, `donel-dev-wt-x`), nunca o literal `donel-dev`.

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ name: 'sidebar-favorites' }));
});

test.afterAll(async () => {
  await appWindow
    .evaluate(async () => {
      const projects = await window.donel.projects.list();
      const target = projects.find((project) => project.name === PROJECT_NAME);
      if (target?.favorite) await window.donel.projects.setFavorite(target.path, false);
    })
    .catch(() => undefined);
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('favoritar um projeto pelo seletor reflete no grupo Favoritos da sidebar imediatamente, sem restart @sessoes', async () => {
  const sidebar = appWindow.locator('nav[aria-label="Projetos e sessões"]');
  await expect(sidebar).toBeVisible();
  const favoriteGroup = sidebar.locator(`[data-testid="favorite-group-${PROJECT_NAME}"]`);

  const trigger = appWindow.getByRole('button', { name: 'Trocar de projeto' });
  const popover = appWindow.getByRole('dialog', { name: 'Projetos' });

  await trigger.click();
  await expect(popover).toBeVisible();
  const favoriteButton = popover.getByRole('button', {
    name: new RegExp(`^(Favoritar ${PROJECT_NAME}|Remover ${PROJECT_NAME} dos favoritos)$`),
  });
  await expect(favoriteButton).toBeVisible({ timeout: 15_000 });

  // Estado limpo: garante que começa DESFAVORITADO — não assume o que uma
  // run anterior (ou uso manual real do app) deixou.
  if ((await favoriteButton.getAttribute('aria-pressed')) === 'true') {
    await favoriteButton.click();
    await expect(favoriteButton).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(favoriteGroup).toHaveCount(0);

  await favoriteButton.click();
  await expect(favoriteButton).toHaveAttribute('aria-pressed', 'true');
  await appWindow.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  // Sem NENHUM reload/restart — só o próximo paint do React. `toPass` cobre
  // o tempo normal de um re-render, nunca um round-trip de IPC/scan.
  await expect(favoriteGroup).toBeVisible({ timeout: 2_000 });

  // Desfavoritar também reflete na hora — o grupo some de novo.
  await trigger.click();
  await expect(popover).toBeVisible();
  await favoriteButton.click();
  await expect(favoriteButton).toHaveAttribute('aria-pressed', 'false');
  await appWindow.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(favoriteGroup).toHaveCount(0);
});
