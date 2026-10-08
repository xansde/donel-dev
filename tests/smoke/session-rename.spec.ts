import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchIsolatedApp } from './helpers/launch';
import { removeSessionFile, seedSession } from './helpers/sessions';
import type { SeededSession } from './helpers/sessions';
import { confirmCloseModalIfOpen, openFreeTerminalTab, openPreviousSessionsDialog, openProjectClaudeTab, waitForClaudeBooted } from './helpers/ui';
import { PROJECT_NAME, SESSIONS_DIR } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Smoke da T409 (004-nomear-sessoes): renomear sessão pela UI (CA-3),
// persistência através de restart (CA-6), reflexo do `/rename` do CLI na
// listagem (CA-1) e volta ao fallback quando o nome é apagado (C5).
//
// CUSTO ZERO DE COTA, de propósito. Nada aqui spawna uma sessão `claude`:
// - o gesto de edição (duplo-clique, Enter, Esc, e "clicar ainda ATIVA / o ×
//   ainda FECHA") é exercido numa aba de TERMINAL LIVRE, que usa o mesmo
//   `EditableLabel` (T407) e o mesmo `handleRenameTab` (T408) — só grava em
//   memória em vez de persistir (decisão C4);
// - o caminho de PERSISTÊNCIA e de RESOLUÇÃO de nome de sessão claude é
//   provado sobre uma sessão sintética semeada em `~/.claude/projects/...`
//   (mesmo padrão de `previous-sessions.spec.ts`) somada a `sessions.setName`
//   via `evaluate` — mesmo espírito de `config-persistence.spec.ts`, que
//   também prova campos do ConfigStore por API direta em vez de abrir sessão
//   real ("custaria cota e não é necessário pra provar persistência do campo").
// O rename de uma aba claude VIVA pela mão do usuário fica no roteiro E2E
// humano (T410) — é lá que o Alexandre valida o que só ele consegue validar.
//
// Isolamento: `--user-data-dir` temp (userDataIsolation.ts), então o
// `config.json` escrito por este spec NUNCA é o real da máquina. O restart do
// app reaponta para o MESMO dir temp — é o que torna a prova de CA-6 honesta.
//
// LGPD: todo conteúdo das fixtures é sintético, gerado aqui, e o `.jsonl`
// semeado é apagado no `afterAll` (roda mesmo se o teste falhar).

// T801/§B19 (008) — `APP_MAIN`/`PROJECT_NAME`/`REPO_ROOT`/`SESSIONS_DIR` vêm de `repoUnderTest.ts`: o nome do projeto na
// sidebar é o `basename` da PASTA (numa worktree, `donel-dev-wt-x`), e sai da
// MESMA fonte que o `SESSIONS_DIR` da fixture — divergir entre os dois era o
// bug do §B19 (o clique achava o `donel-dev` de verdade e a lista voltava vazia).


let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let seeded: SeededSession & { readonly customTitle: string };
/** Only removed at the end if the live-rename test created the file. */
let createdTranscriptPath: string | null = null;

async function launchApp(): Promise<void> {
  ({ app: electronApp, window: appWindow } = await launchIsolatedApp({ userDataDir }));
}

/** Recarrega só o renderer — o boot do App refaz `config.get()`, então mudanças feitas por `evaluate` (fora do React) aparecem na UI. */
async function reloadRenderer(): Promise<void> {
  await appWindow.reload();
  await appWindow.waitForLoadState('domcontentloaded');
}

test.beforeAll(async () => {
  seeded = seedSession({
    marker: `MARCADOR-SMOKE-RENAME-${randomUUID().slice(0, 8)}`,
    origin: 'T409',
    customTitle: `nome-do-rename-${randomUUID().slice(0, 6)}`,
  });
  userDataDir = createIsolatedUserDataDir('session-rename');
  await launchApp();
});

test.afterAll(async () => {
  // Mesmo endurecimento do B11: folga só neste hook para o close sob carga, e
  // limpeza em `finally` — o `.jsonl` semeado fica sob o homedir REAL.
  test.setTimeout(90_000);
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
    removeSessionFile(seeded?.filePath);
    removeSessionFile(createdTranscriptPath ?? undefined);
  }
});

test('T409 — gesto de edição inline na aba: duplo-clique renomeia, Esc restaura, clicar ainda ativa e o × ainda fecha @sessoes', async () => {
  test.setTimeout(90_000);

  await openFreeTerminalTab(appWindow);
  const tabs = appWindow.locator('[role="tab"]');
  await expect(tabs).toHaveCount(1);
  // POSIÇÃO, não texto: em modo edição o nome vive no `value` de um `<input>`,
  // que não conta como texto do elemento — um locator por `hasText` deixaria
  // de casar exatamente no momento em que precisamos dele. O nome é conferido
  // pelo `title` da aba (que carrega o nome inteiro, T407).
  const tab = tabs.first();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toHaveAttribute('title', /^Terminal —/);

  // 1. Duplo-clique no nome abre o input inline já com o texto atual.
  await tab.getByText('Terminal', { exact: true }).dblclick();
  const input = tab.getByRole('textbox');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('Terminal');

  // 2. Enter confirma — o label da aba passa a ser o nome novo.
  await input.fill('nome pela aba');
  await input.press('Enter');
  await expect(tab.getByRole('textbox')).toHaveCount(0);
  await expect(tab).toHaveAttribute('title', /^nome pela aba —/);
  await expect(tab.getByText('nome pela aba', { exact: true })).toBeVisible();

  // 2b. …e a SIDEBAR mostra o mesmo nome (um valor resolvido, não duas cópias).
  const sidebar = appWindow.locator('nav[aria-label="Projetos e sessões"]');
  await expect(sidebar.getByText('nome pela aba', { exact: true })).toBeVisible();

  // 3. Esc CANCELA: o texto digitado é descartado e o anterior volta — prova
  // também que o blur disparado logo após o Esc não reconfirma o cancelado.
  await tab.getByText('nome pela aba', { exact: true }).dblclick();
  const inputAgain = tab.getByRole('textbox');
  await expect(inputAgain).toBeVisible();
  await inputAgain.fill('ISTO NAO DEVE PERSISTIR');
  await inputAgain.press('Escape');
  await expect(tab.getByRole('textbox')).toHaveCount(0);
  await expect(tab).toHaveAttribute('title', /^nome pela aba —/);
  await expect(sidebar.getByText('ISTO NAO DEVE PERSISTIR', { exact: true })).toHaveCount(0);

  // 4. Interação preservada (lição do ProfileSwitcher, entrega 002): com duas
  // abas, clicar na renomeada ainda ATIVA ela.
  await openFreeTerminalTab(appWindow);
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await tab.getByText('nome pela aba', { exact: true }).click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  // 5. …e o × ainda FECHA (o gesto de rename não roubou o clique do botão).
  await tab.getByRole('button', { name: 'Fechar aba nome pela aba' }).click();
  await confirmCloseModalIfOpen(appWindow);
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveAttribute('title', /^Terminal —/);

  // Limpa a aba restante para não vazar processo pro próximo teste.
  await tabs.first().getByRole('button', { name: /^Fechar aba / }).click();
  await confirmCloseModalIfOpen(appWindow);
  await expect(tabs).toHaveCount(0);
});

test('T409 — CA-1: a lista de sessões anteriores mostra o custom-title do /rename (o último), não a 1ª mensagem @sessoes', async () => {
  test.setTimeout(90_000);

  const dialog = await openPreviousSessionsDialog(appWindow);

  // A busca casa contra o preview (1ª mensagem) — é por isso que o marcador
  // ainda acha a linha mesmo com o label exibindo outro texto.
  await dialog.getByLabel('Filtrar sessões anteriores por nome').fill(seeded.marker);
  const row = dialog.locator('[data-testid="previous-session-row"]');
  await expect(row).toHaveCount(1, { timeout: 10_000 });

  // O que aparece é o custom-title (o ÚLTIMO do arquivo), não o preview.
  await expect(row).toContainText(seeded.customTitle);
  await expect(row).not.toContainText(seeded.marker);
  await expect(row).not.toContainText('nome-antigo-que-nao-deve-aparecer');

  await appWindow.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('T409 — CA-6/C5: nome dado na UI vence o custom-title, sobrevive ao restart e vazio volta ao fallback @sessoes', async () => {
  test.setTimeout(120_000);

  const uiName = `nome-pela-ui-${randomUUID().slice(0, 6)}`;

  // 1. Grava pelo MESMO canal que a UI usa, carimbando o `seenTitle` com o
  // custom-title corrente (é o que o `handleRenameTab` faz, T408). Como esta
  // chamada não passa pelo React (que é quem guarda o config devolvido pelo
  // canal), recarrega a janela em seguida — o boot relê `config.get()`.
  await appWindow.evaluate(
    ({ sessionId, uiName, seenTitle }) => window.donel.sessions.setName(sessionId, uiName, seenTitle),
    { sessionId: seeded.id, uiName, seenTitle: seeded.customTitle },
  );
  await reloadRenderer();

  // 2. Dirty-check do C2: `seenTitle` == custom-title atual → vence a UI.
  let dialog = await openPreviousSessionsDialog(appWindow);
  await dialog.getByLabel('Filtrar sessões anteriores por nome').fill(seeded.marker);
  let row = dialog.locator('[data-testid="previous-session-row"]');
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  await expect(row).toContainText(uiName);
  await expect(row).not.toContainText(seeded.customTitle);
  await appWindow.keyboard.press('Escape');

  // 3. CA-6 — restart COMPLETO do app (mesmo `--user-data-dir`).
  await electronApp.close();
  await launchApp();

  const persisted = await appWindow.evaluate(() => window.donel.config.get());
  expect(persisted.sessionNames[seeded.id]?.name).toBe(uiName);
  expect(persisted.sessionNames[seeded.id]?.seenTitle).toBe(seeded.customTitle);

  dialog = await openPreviousSessionsDialog(appWindow);
  await dialog.getByLabel('Filtrar sessões anteriores por nome').fill(seeded.marker);
  row = dialog.locator('[data-testid="previous-session-row"]');
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  await expect(row).toContainText(uiName);
  await appWindow.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 4. C5 — salvar VAZIO apaga a entrada: a entrada some do store e o nome
  // volta ao fallback da resolução (aqui, o custom-title do CLI).
  await appWindow.evaluate((sessionId) => window.donel.sessions.setName(sessionId, '   ', null), seeded.id);
  const cleared = await appWindow.evaluate(() => window.donel.config.get());
  expect(cleared.sessionNames[seeded.id]).toBeUndefined();
  await reloadRenderer();

  dialog = await openPreviousSessionsDialog(appWindow);
  await dialog.getByLabel('Filtrar sessões anteriores por nome').fill(seeded.marker);
  row = dialog.locator('[data-testid="previous-session-row"]');
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  await expect(row).toContainText(seeded.customTitle);
  await expect(row).not.toContainText(uiName);
  await appWindow.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('T409 — C2: um /rename NOVO no CLI (custom-title diferente do seenTitle) vence o nome da UI @sessoes', async () => {
  test.setTimeout(90_000);

  const uiName = `ui-vai-perder-${randomUUID().slice(0, 6)}`;
  const newCliTitle = `renomeado-depois-${randomUUID().slice(0, 6)}`;

  // UI renomeia conhecendo o custom-title atual…
  await appWindow.evaluate(
    ({ sessionId, uiName, seenTitle }) => window.donel.sessions.setName(sessionId, uiName, seenTitle),
    { sessionId: seeded.id, uiName, seenTitle: seeded.customTitle },
  );

  // …e depois o CLI grava um `/rename` NOVO no transcript.
  writeFileSync(
    seeded.filePath,
    `${JSON.stringify({ type: 'custom-title', customTitle: newCliTitle, sessionId: seeded.id })}\n`,
    { encoding: 'utf8', flag: 'a' },
  );
  await reloadRenderer();

  const dialog = await openPreviousSessionsDialog(appWindow);
  await dialog.getByLabel('Filtrar sessões anteriores por nome').fill(seeded.marker);
  const row = dialog.locator('[data-testid="previous-session-row"]');
  await expect(row).toHaveCount(1, { timeout: 10_000 });

  // Dirty-check: custom-title mudou desde o `seenTitle` → vence o CLI.
  await expect(row).toContainText(newCliTitle);
  await expect(row).not.toContainText(uiName);

  await appWindow.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

// Fused from session-rename-live.spec.ts (revisão de testes, 08/10): same matter
// (session names), one app opening less. Runs last: it opens a REAL claude session
// (no API turn) and leaves zero tabs behind. Context from the original header:
// the CLI `/rename` is simulated by appending the same `custom-title` record to the
// transcript of the live session; its `sessionId` is discovered by renaming the tab
// in the UI (the main process persists the name under that key). The `.jsonl` lives
// under the REAL homedir (that is where the CLI writes): if this test creates the
// file it removes it in `afterAll`. Content is synthetic (a session title, LGPD-safe).
test('T413 — CA-4 (ex-session-rename-live): custom-title escrito no transcript da sessão VIVA reflete na aba em < 1 s, e o CLI vence o nome da UI (C2) @sessoes', async () => {
  test.setTimeout(180_000);

  // T1227 (011-contas-e-provedores, etapa 2) — o guard de "só faz sentido com
  // o perfil Principal ativo" morreu junto com os perfis (T1222): sem
  // `CLAUDE_CONFIG_DIR` por perfil, o transcript SEMPRE fica em `~/.claude`.

  // 1. Abre uma sessão claude real clicando no projeto (1 clique no popover
  //    "Projetos" do seletor, sem Launcher — o watcher nasce no
  //    `pty:create`, não no launcher). FIX (item 1, rodada de feedback do
  //    teste de 30/07) — a árvore "Projetos" da sidebar saiu.
  await openProjectClaudeTab(appWindow);

  // The new tab is the selected one (a text filter would stop matching while the label is an <input>).
  const tab = appWindow.locator('[role="tab"][aria-selected="true"]');
  await expect(tab).toBeVisible();
  await waitForClaudeBooted(appWindow, { startTimeout: 30_000 });

  // 2. Renomeia pela UI — é o que revela o `sessionId` desta sessão viva
  //    (o main persiste sob essa chave) sem inventar API de teste.
  const uiName = `ui-${Date.now().toString(36)}`;
  await tab.getByText(PROJECT_NAME, { exact: true }).dblclick();
  const input = tab.getByRole('textbox');
  await expect(input).toBeVisible();
  await input.fill(uiName);
  await input.press('Enter');
  await expect(tab).toHaveAttribute('title', new RegExp(`^${uiName} —`));

  const config = await appWindow.evaluate(() => window.donel.config.get());
  const entries = Object.entries(config.sessionNames).filter(([, entry]) => entry.name === uiName);
  expect(entries, 'o rename pela UI tinha de ter persistido sob o sessionId da sessão viva').toHaveLength(1);
  const [sessionId] = entries[0];

  // 3. Escreve no transcript exatamente o que o `/rename` do CLI escreve.
  const transcriptPath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(transcriptPath)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    createdTranscriptPath = transcriptPath;
  }
  const cliTitle = `cli-${Date.now().toString(36)}`;
  const startedAt = Date.now();
  appendFileSync(transcriptPath, `${JSON.stringify({ type: 'custom-title', customTitle: cliTitle, sessionId })}\n`, 'utf8');

  // 4. CA-4: a aba troca sozinha, em menos de 1 s.
  //    Medição com polling APERTADO (25 ms) em vez de `expect().toHaveAttribute`:
  //    o polling progressivo do Playwright chega a ~500 ms de intervalo e
  //    inflaria a latência medida (a primeira medição saiu 852 ms por isso, com
  //    debounce de 300 ms — o número não era do app, era do amostrador).
  await appWindow.waitForFunction(
    (expected: string) =>
      [...document.querySelectorAll('[role="tab"]')].some((el) => el.getAttribute('title')?.startsWith(expected) === true),
    cliTitle,
    { polling: 25, timeout: 3_000 },
  );
  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(`[CA-4] aba refletiu o custom-title em ${elapsedMs} ms (debounce 300 ms + fs.watch + IPC; alvo < 1000 ms)`);
  expect(elapsedMs).toBeLessThan(1_000);

  // 5. …e a sidebar (seção "Sessões", que continua existindo — só a árvore
  //    "Projetos" saiu) mostra o mesmo valor (CA-5: uma resolução só).
  const sidebar = appWindow.locator('nav[aria-label="Projetos e sessões"]');
  await expect(sidebar.getByText(cliTitle, { exact: true })).toBeVisible();

  // 6. C2 fechado: o `/rename` veio DEPOIS do nome da UI, então o CLI vence e a
  //    entrada da UI é descartada do storage — não fica nome morto competindo.
  await expect(async () => {
    const after = await appWindow.evaluate(() => window.donel.config.get());
    expect(after.sessionNames[sessionId]).toBeUndefined();
  }).toPass({ timeout: 5_000 });

  // 7. Fecha a aba (mata o PTY) — o watcher tem de sair com ela; a prova de que
  //    não vaza handle é o unit do registry, aqui só não deixamos sujeira.
  await tab.getByRole('button', { name: new RegExp(`^Fechar aba ${cliTitle}`) }).click();
  await confirmCloseModalIfOpen(appWindow);
  await expect(appWindow.locator('[role="tab"]')).toHaveCount(0);
});
