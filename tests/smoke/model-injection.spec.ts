import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PROJECT_NAME } from './repoUnderTest';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { openLauncherPanel, waitForClaudeBooted } from './helpers/ui';

// FIX (teste manual 27/07) — a feature original deste arquivo (T011, injeção
// de `/model`/`/effort` numa sessão claude JÁ VIVA, pela toolbar
// SessionDetails) foi REMOVIDA a pedido do dono ("não tem sido nem um pouco
// útil", commit 40c202c): a cadeia inteira (`watchLiveInjection`,
// `pendingInjection`, `possiblyBlockedOnPrompt`, `handleSelectModel`/
// `handleSelectEffort`/`handleRestartWithConfig`, os imports de
// `shared/liveSessionInjection.ts`) saiu do App.tsx. SessionDetails.tsx
// continua existindo no repo, mas não é mais montada em lugar nenhum — os
// testids `session-details`/`session-context`/`session-details-hint` não
// aparecem mais na árvore renderizada.
//
// O NOVO caminho equivalente (mesmo commit): trocar modelo/esforço não
// injeta mais numa sessão viva — abre-se o Launcher (corpo do "＋ Nova
// sessão", agora `onClick={() => setLauncherOpen(true)}`) e lança-se uma
// sessão NOVA com o modelo/esforço escolhidos ali, que vão pro argv real de
// `claude` (CommandBuilder, T006). Este smoke prova esse caminho novo:
// (1) o Launcher monta o argv exato com `--model`/`--effort` (mesmo hook de
// teste `launcher-last-command` de terminal.spec.ts T008); (2) a sessão real
// sobe com esses args; (3) a StatusBar (rodapé) reflete modelo/esforço da
// aba em foco — a "leitura equivalente" que sobrou depois da toolbar sair
// (FIX teste manual 27/07 em App.tsx, `activeModelEffort`).
//
// shared/liveSessionInjection.ts e shared/possiblyBlockedOnPrompt.ts não
// foram deletados (só pararam de ser importados pelo App.tsx) — a cobertura
// de unidade pura deles continua em tests/liveSessionInjection.test.ts e
// tests/possiblyBlockedOnPrompt.test.ts, sem relação com este smoke.

// T801/§B19 (008) — `APP_MAIN`/`REPO_ROOT`/`PROJECT_NAME` vêm de
// `repoUnderTest.ts`: o projeto na sidebar é o `basename` da PASTA de onde a
// suíte roda (numa worktree, `donel-dev-wt-x`), nunca o literal `donel-dev`.

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  ({ app: electronApp, window, userDataDir } = await launchIsolatedApp({ name: 'model-injection' }));
});

test.afterAll(async () => {
  // FIX B11 (2026-07-24) — mesmo achado de `profiles.spec.ts` e
  // `tabs-lifecycle.spec.ts`: folga só neste hook (não mascara asserção, não
  // é retry) + `finally` para o diretório isolado nunca ficar órfão se o
  // close estourar.
  test.setTimeout(90_000);
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('corpo do "＋ Nova sessão" abre o Launcher; escolher modelo/esforço ali lança a sessão com --model/--effort no argv e a StatusBar reflete a aba (substitui a injeção ao vivo removida) @abas', async () => {
  test.setTimeout(120_000);

  // 1. Corpo do SplitButton abre o painel do Launcher direto (App.tsx,
  // `onClick={() => setLauncherOpen(true)}` — não é mais quick-launch).
  await expect(window.locator('[data-testid="empty-state"]')).toBeVisible();
  const launcher = await openLauncherPanel(window);
  await expect(window.locator('aside[aria-label="Lançar sessão"]')).toBeVisible();
  await launcher.getByRole('button', { name: 'Selecione um projeto' }).click();
  await window.getByRole('option', { name: PROJECT_NAME, exact: true }).click();
  await launcher.getByRole('radio', { name: 'sonnet', exact: true }).click();
  await launcher.getByRole('radio', { name: 'high', exact: true }).click();
  await launcher.getByLabel('Nome').fill('model-injection-test');
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const newTab = window.locator('[role="tab"]', { hasText: 'model-injection-test' });
  await expect(newTab).toBeVisible();
  await expect(newTab).toHaveAttribute('aria-selected', 'true');
  await expect(launcher).toHaveCount(0);

  const lastCommand = window.locator('[data-testid="launcher-last-command"]');
  await expect(lastCommand).toHaveText(/--model sonnet --effort high/);

  // 3. Prova funcional: a sessão claude real sobe com esses args.
  await waitForClaudeBooted(window, { until: 'prompt' });

  const statusBar = window.locator('div:has(> [data-testid="statusbar-account"])');
  await expect(statusBar).toContainText('sonnet/high');

  // Nenhuma leitura de contexto ainda (nenhum turno rodou) — a StatusBar não
  // acrescenta o medidor de contexto sem uma leitura real do transcript-watcher
  // (T610): `activeSmartZone` fica `undefined` e o slot não renderiza. Desde o
  // CA-22 da 009 o que se procura é o medidor (`[data-zone]`), não mais o texto
  // "ctx Nk"; cobertura completa do `%` ao vivo em session-context.spec.ts.
  await expect(statusBar.locator('[data-zone]')).toHaveCount(0);
  await expect(statusBar).not.toContainText('contexto');
});
