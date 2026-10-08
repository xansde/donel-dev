import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { launchClaudeTab } from './helpers/ui';
import { APP_MAIN, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';
import { refuseIfRealClaudeHome } from './accountsCredentialGuard';

// 011-contas-e-provedores, etapa 3, Fase 2 ("verdade na tela") — a aba
// `claude` passa a mostrar a conta VIGENTE (D1: rótulo + cota da conta ATIVA
// agora, com `· trocou em voo (era <nascimento>)` quando a aba nasceu com
// outra), o painel deixa explícito que a troca é GLOBAL (D2,
// `accounts-switch-scope`), o auto-switch fica visível (D5/D6: `armed` só
// troca quando existe candidata com folga; `saturated` avisa sem trocar;
// D8 `blind` — falta LEITURA de carga, não falta folga, e não é a mesma
// coisa) e `expired-credentials` numa troca vira "Reconectar" (D3: login
// isolado apontado pra UMA conta, aceita só se o fingerprint colhido bate
// com ela ou ela ainda não tinha nenhum).
//
// Dois seams, mesmo espírito de sempre:
// - `DONEL_ACCOUNTS_FAKE_MOD_FIXTURE` -> `accounts-fake-mod-fase-2.json`:
//   três contas fixas (`acc-cheia` 95%, `acc-folga` 10%, `acc-lotada` 92%),
//   `includeConfiguredLocalAccounts: true` (as contas coladas por
//   `connectMod` entram na lista, com carga DESCONHECIDA — é o que liga o
//   `blind` do cenário 5) e `expiredLabels: ["Conta vencida", "Conta vencida
//   2"]` (o `switchTo` de qualquer conta com esse rótulo falha sempre com
//   `expired-credentials`, fixture ou configurada).
// - `DONEL_CLAUDE_EXECUTABLE_FIXTURE` -> `fake-claude-login/claude.cmd`: o
//   MESMO `claude` falso serve dois papéis. Sem `CLAUDE_CONFIG_DIR` (aba
//   `claude` comum, aberta pra ler a statusbar) fica vivo sem gravar nada.
//   Com `CLAUDE_CONFIG_DIR` (login isolado/reconectar) grava credencial falsa
//   com `accountUuid` FIXO — o mesmo fingerprint em TODO login desta suíte,
//   o que é exatamente o que faz o cenário 7 (reconectar "Conta vencida 2"
//   colher o fingerprint que já é da "Conta vencida") virar `wrong-account`.
//
// `claudeHome` de teste isolado via `setConfig` ANTES de qualquer troca (G2 —
// accountsCredentialGuard.ts) — nunca o `~/.claude` real da máquina.
//
// ORDEM DELIBERADAMENTE DIFERENTE do desenho (fase2-design.md): lá, colar a
// "Conta vencida" vinha ANTES do cenário de auto-switch saturado. Colar uma
// conta sem leitura de carga é exatamente o gatilho do `blind` (D8) — colar
// antes do cenário "saturated" faria ele nascer `blind`, não `saturated`, e
// o cenário 4 nunca provaria o que devia provar. Aqui o "saturated" (4) roda
// TODO com só contas de carga conhecida, e só o cenário 5 introduz a conta
// sem leitura, virando `blind`.

const MOD_FIXTURE_PATH = join(__dirname, '../fixtures/accounts-fake-mod-fase-2.json');
const FAKE_CLAUDE_CMD_PATH = join(__dirname, 'fixtures/fake-claude-login/claude.cmd');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let claudeHomeParent: string;
let claudeHomeDir: string;
let tabA: Locator;
let tabB: Locator;

// Os cenários dependem do estado deixado pelo anterior (mesmo app, mesmas
// abas, mesmas contas): em modo serial, uma falha pula os seguintes em vez de
// o Playwright subir um worker novo — e um app novo, inerte — e produzir
// falhas em cascata que não dizem nada.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('accounts-fase-2');
  claudeHomeParent = mkdtempSync(join(tmpdir(), 'donel-accounts-smoke-fase2-'));
  claudeHomeDir = join(claudeHomeParent, '.claude');
  // G2 (batch n3) — cinto de segurança: recusa rodar ANTES de qualquer IPC
  // se `claudeHomeDir` resolver pra pasta real (ver accounts-switch.spec.ts).
  refuseIfRealClaudeHome(claudeHomeDir);
  mkdirSync(claudeHomeParent, { recursive: true });
  writeFileSync(join(claudeHomeParent, '.claude.json'), JSON.stringify({ oauthAccount: { seeded: true } }), 'utf8');

  electronApp = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: { ...process.env, DONEL_ACCOUNTS_FAKE_MOD_FIXTURE: MOD_FIXTURE_PATH, DONEL_CLAUDE_EXECUTABLE_FIXTURE: FAKE_CLAUDE_CMD_PATH },
  });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
  rmSync(claudeHomeParent, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers — nada aqui importa de `src/`; é 1:1 com o gesto que um operador
// faria na tela (padrão do diretório, ver repoUnderTest.ts).
// ---------------------------------------------------------------------------

const statusBarAccount = (): Locator => appWindow.getByTestId('statusbar-account');

/** Linha de `AccountsPanel` cujo rótulo é EXATAMENTE `label` — nunca por
 * substring: "Conta vencida" é prefixo de "Conta vencida 2", e os cenários
 * 6/7 precisam das duas linhas sem ambiguidade. */
function accountRow(label: string): Locator {
  return appWindow.locator('[data-testid="account-row"]').filter({ has: appWindow.getByText(label, { exact: true }) });
}

async function openAccountsPanel(): Promise<void> {
  await appWindow.getByTestId('accounts-panel-trigger').click();
  await expect(appWindow.getByTestId('accounts-panel')).toBeVisible();
}

/**
 * `pasteOpen` mora no `AccountsPanel` (nunca desmonta — só o `<Modal>` que
 * ele contém desmonta os filhos ao fechar, ver `Modal.tsx`: `if (!open) ...
 * return null`). Na SEGUNDA vez que esta suíte colar um token (cenário 7), o
 * estado já está `true` desde o cenário 5 — clicar de novo em "Colar token
 * (avançado)" fecharia o formulário em vez de abri-lo. Só clica se o campo
 * ainda não estiver visível.
 */
async function ensurePasteFormOpen(): Promise<void> {
  if (!(await appWindow.getByLabel('Access token').isVisible())) {
    await appWindow.getByTestId('accounts-paste-toggle').click();
  }
}

/** "Rótulo da conta" -> "Colar token (avançado)" -> Access/Refresh -> Adicionar. Validade fica vazia de propósito (F2). */
async function pasteAccount(label: string, accessToken: string, refreshToken: string): Promise<void> {
  await appWindow.getByLabel('Rótulo da conta').fill(label);
  await ensurePasteFormOpen();
  await appWindow.getByLabel('Access token').fill(accessToken);
  await appWindow.getByLabel('Refresh token').fill(refreshToken);
  await appWindow.getByTestId('accounts-paste-submit').click();
  await expect(accountRow(label)).toBeVisible();
}

/** Clica no botão da linha (`account-switch`) pra tentar trocar pra ela. Devolve a própria linha, já localizada, pras asserções seguintes. */
async function clickRowToSwitch(label: string): Promise<Locator> {
  const row = accountRow(label);
  await row.getByTestId('account-switch').click();
  return row;
}

/**
 * "Reconectar" na linha já com `account-reconnect-box` visível: fecha o
 * painel, abre a aba `Login · <rótulo>`, espera ela fechar sozinha (o
 * `claude` falso grava a credencial e o colhedor mata o PTY) e o painel
 * reabrir com o resultado. Mesmo padrão de `accounts-add-login.spec.ts`.
 */
async function reconnectAndWaitLoginEnd(row: Locator, targetLabel: string): Promise<void> {
  await row.getByTestId('account-reconnect').click();
  await expect(appWindow.getByTestId('accounts-panel')).toHaveCount(0);

  const loginTab = appWindow.locator(`[role="tab"][title^="Login · ${targetLabel}"]`);
  await expect(loginTab).toBeVisible();
  await expect(loginTab).toHaveCount(0, { timeout: 20_000 });

  await expect(appWindow.getByTestId('accounts-panel')).toBeVisible();
}

// ---------------------------------------------------------------------------

test('cenário 1 — liga o motor sem criar conta; a aba claude mostra a conta ativa (D1) @contas', async () => {
  test.setTimeout(90_000);

  await appWindow.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), claudeHomeDir);
  await appWindow.evaluate(() => window.donel.accounts.setConfig({ mod: 'local' }));

  const switchOutcome = await appWindow.evaluate(() => window.donel.accounts.switch('acc-folga'));
  expect(switchOutcome.kind).toBe('switched');

  tabA = await launchClaudeTab(appWindow, { name: 'aba-a' });

  await expect(statusBarAccount()).toHaveText('Sessão: Conta folga · 10% usado');
});

test('cenário 2 — troca em voo aparece na aba já aberta, não na aba nova; painel confirma o escopo global (D1/D2) @contas', async () => {
  test.setTimeout(90_000);

  const switchOutcome = await appWindow.evaluate(() => window.donel.accounts.switch('acc-lotada'));
  expect(switchOutcome.kind).toBe('switched');

  // Aba A nasceu com "Conta folga"; a ativa agora é "Conta lotada" -> mismatch.
  await tabA.click();
  await expect(statusBarAccount()).toHaveText('Sessão: Conta lotada · 92% usado · trocou em voo (era Conta folga)');

  // Aba B nasce DEPOIS da troca -> nasce já com "Conta lotada", sem mismatch.
  tabB = await launchClaudeTab(appWindow, { project: null, name: 'aba-b' });
  await expect(statusBarAccount()).toHaveText('Sessão: Conta lotada · 92% usado');

  await openAccountsPanel();
  await expect(appWindow.getByTestId('accounts-switch-scope')).toHaveText(
    'A troca vale para todas as sessões abertas: cada uma passa a usar a conta nova na próxima mensagem. Sessões de provedor não mudam.',
  );
  await appWindow.keyboard.press('Escape');
});

test('cenário 3 — "Atualizar" dispara o auto-switch de verdade: "Conta cheia" cede pra "Conta folga" (D5) @contas', async () => {
  test.setTimeout(60_000);

  const switchOutcome = await appWindow.evaluate(() => window.donel.accounts.switch('acc-cheia'));
  expect(switchOutcome.kind).toBe('switched');

  await openAccountsPanel();
  await appWindow.getByTestId('accounts-refresh').click();

  // `list({force:true})` avalia o auto-switch de verdade (Bloco 3 item 3): com
  // a política default (90/20), só "Conta folga" (85 pontos de folga) é
  // candidata elegível -> o motor troca sozinho, sem sessão "working" pra adiar.
  // O clique não espera a avaliação terminar: primeiro a tela, depois a conta.
  await expect(appWindow.getByTestId('accounts-autoswitch-last')).toContainText('de «Conta cheia» para «Conta folga»');
  await expect.poll(async () => (await appWindow.evaluate(() => window.donel.accounts.list())).activeAccountId).toBe('acc-folga');

  // Aba B (em foco) segue a troca automática do mesmo jeito que segue a manual.
  // O painel fecha antes: o overlay do modal intercepta o clique na aba.
  await appWindow.keyboard.press('Escape');
  await tabB.click();
  await expect(statusBarAccount()).toHaveText('Sessão: Conta folga · 10% usado · trocou em voo (era Conta lotada)');
});

test('cenário 4 — sem candidata com folga suficiente: auto-switch fica "saturated", avisa e não troca (D6) @contas', async () => {
  test.setTimeout(60_000);

  await appWindow.evaluate(() =>
    window.donel.accounts.setConfig({ autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 90 } }),
  );
  const switchOutcome = await appWindow.evaluate(() => window.donel.accounts.switch('acc-cheia'));
  expect(switchOutcome.kind).toBe('switched');

  await openAccountsPanel();
  await appWindow.getByTestId('accounts-refresh').click();

  // Nenhuma outra conta tem 90 pontos de folga sobre "Conta cheia" (95): nem
  // "Conta folga" (85) nem "Conta lotada" (3) — e as duas têm carga
  // CONHECIDA, então é "saturated", não "blind" (isso só entra no cenário 5).
  await expect(appWindow.getByTestId('accounts-autoswitch-saturated')).toHaveText(
    'A conta ativa passou de 90% e nenhuma outra tem 90 pontos de folga — a troca automática não tem para onde ir.',
  );
  await expect(appWindow.getByTestId('accounts-panel-trigger')).toHaveText('Contas ⚠');

  const activeAfterRefresh = await appWindow.evaluate(() => window.donel.accounts.list());
  expect(activeAfterRefresh.activeAccountId).toBe('acc-cheia'); // avisou, não trocou.

  await appWindow.keyboard.press('Escape');
  await tabB.click();
  await expect(statusBarAccount()).toContainText('· sem conta com folga');
});

test('cenário 5 — conta colada sem leitura de carga vira "blind", não "saturated" (D8) @contas', async () => {
  test.setTimeout(60_000);

  await openAccountsPanel();
  await pasteAccount('Conta vencida', 'x', 'y');

  // "Conta vencida" entra com `load: null` (fixture: `includeConfiguredLocalAccounts`
  // nunca lê carga de conta configurada) — falta LEITURA, não falta folga.
  await expect(appWindow.getByTestId('accounts-autoswitch-blind')).toHaveText(
    'A conta ativa passou de 90% e falta a leitura de carga de outras contas — a troca automática só escolhe conta com carga conhecida.',
  );
  await expect(appWindow.getByTestId('accounts-panel-trigger')).toHaveText('Contas ⚠');

  await appWindow.keyboard.press('Escape');
  await tabB.click();
  await expect(statusBarAccount()).toContainText('· sem leitura das outras contas');
});

test('cenário 6 — expired-credentials marca "Reconectar"; reconectar renova a credencial e grava o fingerprint (D3) @contas', async () => {
  test.setTimeout(120_000);

  await appWindow.evaluate(() =>
    window.donel.accounts.setConfig({ autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
  );

  await openAccountsPanel();

  // Clicar na linha tenta trocar PRA ela; o mod de fixture recusa com
  // `expired-credentials` porque o rótulo está em `expiredLabels` — o motor
  // marca `needsReconnect` e a troca não acontece.
  const row = await clickRowToSwitch('Conta vencida');
  await expect(row.getByTestId('account-reconnect-box')).toBeVisible();
  await expect(row.getByTestId('account-reconnect-box')).toContainText(
    'A credencial de «Conta vencida» venceu e o servidor recusou a renovação. Reconecte para voltar a usar esta conta.',
  );

  const afterFailedSwitch = await appWindow.evaluate(() => window.donel.accounts.list());
  expect(afterFailedSwitch.activeAccountId).toBe('acc-cheia'); // a troca falhou; ninguém assumiu o lugar.

  await reconnectAndWaitLoginEnd(row, 'Conta vencida');
  await expect(appWindow.getByTestId('accounts-login-result')).toHaveText('Conta «Conta vencida» reconectada.');
  await expect(accountRow('Conta vencida').getByTestId('account-reconnect-box')).toHaveCount(0);

  const configAfterReconnect = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  const contaVencida = configAfterReconnect.localAccounts.find((account) => account.label === 'Conta vencida');
  expect(contaVencida?.fingerprint).toBeTruthy();

  await appWindow.keyboard.press('Escape');
});

test('cenário 7 — reconectar com a conta errada (mesmo fingerprint fixo) recusa e não altera nada (D3) @contas', async () => {
  test.setTimeout(120_000);

  await openAccountsPanel();
  await pasteAccount('Conta vencida 2', 'x', 'y');

  const row = await clickRowToSwitch('Conta vencida 2');
  await expect(row.getByTestId('account-reconnect-box')).toBeVisible();

  // O `claude` falso grava o MESMO `accountUuid` fixo em todo login — o
  // fingerprint colhido aqui já é o da "Conta vencida" (cenário 6), então o
  // login que acabou de terminar não é aceito como sendo de "Conta vencida 2".
  await reconnectAndWaitLoginEnd(row, 'Conta vencida 2');
  await expect(appWindow.getByTestId('accounts-login-result')).toHaveText(
    'Você entrou com a conta de «Conta vencida», não com a de «Conta vencida 2» — nada foi alterado.',
  );

  // Nada foi gravado: a marca de "Conta vencida 2" continua (só um harvest
  // bem-sucedido limpa o registro) e ela segue sem fingerprint.
  await expect(accountRow('Conta vencida 2').getByTestId('account-reconnect-box')).toBeVisible();
  const configAfter = await appWindow.evaluate(() => window.donel.accounts.getConfig());
  const contaVencida2 = configAfter.localAccounts.find((account) => account.label === 'Conta vencida 2');
  expect(contaVencida2?.fingerprint).toBeFalsy();

  await appWindow.keyboard.press('Escape');
});
