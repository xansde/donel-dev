import { randomUUID } from 'node:crypto';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { APP_MAIN, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Smoke do lote 1 (009-modo-dev-v3) — TerminalTab · variante v3 (extensão 7):
// CA-26 (reordenar por arraste) e CA-27 (cor por aba, sobrevive a restart).
// CA-28 (ícone de estado) é coberto por Storybook (os 5 estados são texto
// puro por CSS, sem PTY envolvido — nada aqui adiciona sobre o que os
// stories já provam visualmente).
//
// CUSTO ZERO DE COTA, mesmo espírito de session-rename.spec.ts: nenhum teste
// aqui spawna uma sessão `claude`.
// - CA-26 (arraste) é provado sobre DUAS abas de TERMINAL LIVRE (mesmo
//   `EditableLabel`/gesto de renomear já coberto por session-rename.spec.ts —
//   aqui só pra dar identidade única a cada aba, já que as duas nascem com o
//   mesmo nome "Terminal").
// - CA-27 (persistência através de restart) é provada por API DIRETA
//   (`window.donel.tabs.setColor/setOrder` + `config.get()`), sem precisar de
//   sessão real nem de reabrir tab nenhuma — mesmo espírito de
//   config-persistence.spec.ts/session-rename.spec.ts CA-6: "custaria cota e
//   não é necessário pra provar persistência do campo". Tabs não sobrevivem a
//   restart por decisão própria do app (FIX 2026-07-23, "opção A" — boot
//   sempre nasce com zero abas), então a prova real e honesta de CA-27 é a
//   API de persistência, não um round-trip visual de abas reabertas.
//
// `appWindow` (não `window`) de propósito — mesmo motivo de
// session-rename.spec.ts: os testes de CA-27 chamam `window.donel.*` DENTRO
// de `evaluate()` (código que roda no BROWSER); uma variável de módulo
// chamada `window` sombrearia o `window` global bem ali, e o TS resolveria
// pro tipo errado (`Page`, não o DOM `Window`).
//
// Isolamento: `--user-data-dir` temp (userDataIsolation.ts) — o `config.json`
// escrito aqui nunca é o real da máquina.

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

async function launchApp(): Promise<void> {
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: REPO_ROOT });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
}

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('tabs-v3');
  await launchApp();
});

test.afterAll(async () => {
  // Mesmo endurecimento do B11/tabs-lifecycle.spec.ts: folga só neste hook
  // pro close sob carga real da máquina, limpeza em `finally`.
  test.setTimeout(90_000);
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
  }
});

async function openFreeTerminalTab(): Promise<void> {
  await appWindow.getByRole('button', { name: 'Mais opções de ＋ Nova sessão' }).click();
  await appWindow.getByRole('menuitem', { name: 'Terminal (shell livre)' }).click();
}

/** Renomeia a aba pelo MESMO gesto de sempre (duplo-clique + Enter, T407/T408) — só pra dar identidade única a cada aba livre (as duas nascem com o nome "Terminal"). */
async function renameTab(tab: Locator, next: string): Promise<void> {
  await tab.getByText('Terminal', { exact: true }).dblclick();
  const input = tab.getByRole('textbox');
  await input.fill(next);
  await input.press('Enter');
}

/** Fecha o modal de confirmação de fechar aba, quando ele aparece (processo vivo). */
async function confirmCloseModalIfOpen(): Promise<void> {
  const modal = appWindow.getByRole('dialog', { name: 'Fechar sessão?' });
  if (await modal.isVisible().catch(() => false)) {
    await modal.getByRole('button', { name: 'Fechar' }).click();
  }
}

test('CA-26 — arrastar uma aba pela alça reordena a barra (drag nativo HTML5)', async () => {
  test.setTimeout(60_000);

  await openFreeTerminalTab();
  const tabs = appWindow.locator('[role="tab"]');
  await expect(tabs).toHaveCount(1);
  await renameTab(tabs.nth(0), 'aba-um');

  await openFreeTerminalTab();
  await expect(tabs).toHaveCount(2);
  await renameTab(tabs.nth(1), 'aba-dois');

  // Ordem de abertura: aba-um, aba-dois.
  await expect(tabs.nth(0)).toHaveAttribute('title', /^aba-um —/);
  await expect(tabs.nth(1)).toHaveAttribute('title', /^aba-dois —/);

  // CA-26 — arrasta a 1ª aba PARA CIMA da 2ª: a ordem inverte.
  await tabs.nth(0).dragTo(tabs.nth(1));

  await expect(tabs.nth(0)).toHaveAttribute('title', /^aba-dois —/);
  await expect(tabs.nth(1)).toHaveAttribute('title', /^aba-um —/);

  // Limpa as duas abas (terminal livre não gasta cota, mas não deixa
  // powershell.exe pendurado pro próximo teste do arquivo).
  await tabs.nth(0).getByRole('button', { name: /^Fechar aba / }).click();
  await confirmCloseModalIfOpen();
  await tabs.nth(0).getByRole('button', { name: /^Fechar aba / }).click();
  await confirmCloseModalIfOpen();
  await expect(tabs).toHaveCount(0);
});

test('CA-27 — cor e ordem da aba sobrevivem a um restart completo do app (API de persistência)', async () => {
  test.setTimeout(90_000);

  const sessionId = randomUUID();

  // 1. Grava pelo MESMO canal que a UI usa ao escolher a cor no menu da aba
  // (clique direito) e ao soltar um arraste — `window.donel.tabs.*`.
  await appWindow.evaluate(({ id }) => window.donel.tabs.setColor(id, 'accent'), { id: sessionId });
  await appWindow.evaluate(({ id }) => window.donel.tabs.setOrder(id, 2), { id: sessionId });

  const beforeRestart = await appWindow.evaluate(() => window.donel.config.get());
  expect(beforeRestart.tabAppearance[sessionId]).toEqual({ color: 'accent', order: 2 });

  // 2. Restart COMPLETO do app (mesmo `--user-data-dir`) — CA-27.
  await electronApp.close();
  await launchApp();

  const afterRestart = await appWindow.evaluate(() => window.donel.config.get());
  expect(afterRestart.tabAppearance[sessionId]).toEqual({ color: 'accent', order: 2 });

  // 3. Trocar só a cor preserva a ordem já persistida, e vice-versa (mesma
  // garantia provada em tests/tabAppearance.test.ts, agora ponta-a-ponta
  // pelo canal IPC real).
  await appWindow.evaluate(({ id }) => window.donel.tabs.setColor(id, 'permission'), { id: sessionId });
  const afterColorChange = await appWindow.evaluate(() => window.donel.config.get());
  expect(afterColorChange.tabAppearance[sessionId]).toEqual({ color: 'permission', order: 2 });

  // 4. Payload inválido (cor fora dos 4 tokens conhecidos) é no-op — o main
  // nunca confia cegamente no que o renderer manda.
  await appWindow.evaluate(
    ({ id }) => window.donel.tabs.setColor(id, 'roxo-inventado' as unknown as Parameters<typeof window.donel.tabs.setColor>[1]),
    { id: sessionId },
  );
  const afterInvalidPayload = await appWindow.evaluate(() => window.donel.config.get());
  expect(afterInvalidPayload.tabAppearance[sessionId]).toEqual({ color: 'permission', order: 2 });
});
