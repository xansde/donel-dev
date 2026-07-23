import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Smoke da T004 (overnight, sem humano): abre o app buildado e prova que
// node-pty carrega dentro do Electron (não só do Node puro). Redimensiona a
// janela em seguida e confirma que o processo não crasha.
//
// T005 mudou o que a aba spawna: `claude` real direto no PTY (FR-006), não
// mais powershell — por isso o teste de eco por shell virou "o terminal
// mostra a sessão claude de verdade".
//
// O ciclo "sessão encerrada" (FR-006) e o banner CA-5 NÃO têm E2E aqui —
// tentado e descartado (ver dossiê do T005): (1) forçar CA-5 via env
// (USERPROFILE fake) derruba o processo Electron inteiro (sandbox do
// Chromium no Windows rejeita um USERPROFILE que não bate com o perfil
// logado, exit STATUS_BREAKPOINT antes mesmo de abrir janela); mover/ocultar
// o `claude.exe` real da máquina pra simular ausência foi descartado por
// mexer num executável que não é desta worktree. (2) `/exit` no CLI real
// esbarra no "Quick safety check" (diálogo de confiança de pasta) da
// primeira execução num cwd novo — mesmo tratando o diálogo, o timing de
// digitar teclas enquanto a sessão claude ainda está renderizando o banner
// inicial é nao-determinístico (a tela pode ficar em branco sem a sessão
// realmente ter saído). Cobertura real desses dois casos:
// tests/claude-executable.test.ts (resolução PATH/fallback/CA-5, com o caso
// "máquina real"), tests/pty-manager.test.ts (onExit dispara de verdade com
// `cmd.exe /c exit` como dummy) e tests/parse-claude-not-found.test.ts
// (parsing do erro CA-5 no lado do renderer).
//
// O que este smoke NÃO cobre (setas interativas, colar multilinha visual,
// scrollback com mouse) fica em "Não verificado" para o T017 — ver dossiê.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [APP_MAIN],
    cwd: APP_CWD,
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

test('terminal spawns a real claude session inside Electron', async () => {
  const terminalPane = window.locator('[data-testid="terminal-pane"]');
  await expect(terminalPane).toBeVisible();

  // xterm monta e o pty:create (IPC async) resolve; espera a sessão claude
  // real imprimir algo (o CLI é encontrado nesta máquina — where.exe claude
  // resolve pra ~/.local/bin/claude.exe). Não digitamos nenhum prompt aqui:
  // é só o boot da sessão, sem turno de API.
  await expect(async () => {
    const text = await terminalPane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });

  // cwd = home (T005 não tem contexto de projeto ainda, isso chega no T007)
  // pode disparar o "Quick safety check" (diálogo de confiança) do próprio
  // CLI na primeira vez que essa pasta é usada — Enter aceita a opção
  // default ("1. Yes, trust folder"). Se a pasta já estiver confiável (ex.:
  // reexecução), o terminal já está no prompt normal e esse Enter no campo
  // de input vazio não tem efeito nenhum.
  await terminalPane.click();
  if ((await terminalPane.innerText()).includes('trust this folder')) {
    await window.keyboard.press('Enter');
  }

  await expect(async () => {
    const text = await terminalPane.innerText();
    expect(text.toLowerCase()).toContain('claude code');
  }).toPass({ timeout: 15_000 });
});

test('opening a project from the sidebar creates a tab with a claude session in that project cwd', async () => {
  // T007 — prova o DoD ("abrir projeto pela sidebar funciona", FR-001/FR-002):
  // clicar num projeto real da sidebar spawna uma sessão claude nova com
  // `cwd` correto, sem matar a aba "Sessão" default (continua montada, só
  // fica display:none — App.tsx mantém o PTY vivo ao trocar de aba).
  // `donel-dev` é o próprio repo sob teste — sempre presente no scan (tem
  // `.git`) e sempre em `~\seazone\donel-dev` nesta máquina de dev.
  const sidebar = window.locator('nav[aria-label="Projetos e sessões"]');
  await expect(sidebar).toBeVisible();

  const projectButton = sidebar.getByRole('button', { name: 'donel-dev', exact: true });
  await expect(projectButton).toBeVisible({ timeout: 15_000 });
  await projectButton.click();

  const newTab = window.locator('[role="tab"]', { hasText: 'donel-dev' });
  await expect(newTab).toBeVisible();
  await expect(newTab).toHaveAttribute('aria-selected', 'true');

  // Só a aba ativa fica com o terminal-pane visível — a "Sessão" default virou display:none.
  const activePane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(activePane).toHaveCount(1);

  await expect(async () => {
    const text = await activePane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });

  // Mesmo diálogo de "Quick safety check" do primeiro teste, agora pra uma
  // pasta possivelmente ainda não confiável na sessão anterior desta run.
  await activePane.click();
  if ((await activePane.innerText()).includes('trust this folder')) {
    await window.keyboard.press('Enter');
  }

  await expect(async () => {
    const text = await activePane.innerText();
    expect(text.toLowerCase()).toContain('claude code');
    // Prova o cwd: o prompt do claude mostra o path do projeto clicado.
    expect(text).toContain('donel-dev');
  }).toPass({ timeout: 15_000 });
});

test('resizing the window does not crash the app', async () => {
  const originalSize = window.viewportSize();
  await window.setViewportSize({ width: 1000, height: 700 });
  await window.waitForTimeout(500);
  await window.setViewportSize({ width: originalSize?.width ?? 1280, height: originalSize?.height ?? 800 });

  // App ainda vivo e com o terminal renderizado após o resize. `:visible`
  // porque o teste anterior (T007) deixa 2 abas montadas (só a ativa fica
  // visível — a "Sessão" default vira display:none, App.tsx mantém o PTY
  // vivo ao trocar de aba).
  await expect(window.locator('[data-testid="terminal-pane"]:visible')).toBeVisible();
  expect(electronApp.windows().length).toBeGreaterThan(0);
});

test('launcher builds the exact CommandBuilder argv and opens a tab wired to it (T008, CA-1)', async () => {
  // CA-1 (spec.md): modelo=sonnet, esforço=high, permissões=acceptEdits,
  // nome=radar, projeto=donel-dev → aba com `claude --model sonnet --effort
  // high --permission-mode acceptEdits -n radar` e cwd no projeto.
  //
  // "Projeto-alvo" não é tocado aqui de propósito: o teste T007 acima já
  // clicou em "donel-dev" na sidebar, então o Launcher já herdou esse
  // projeto (ui-spec §4, "herdado da seleção da sidebar") — é a própria
  // regra de herança sendo exercitada, não um atalho de teste.
  //
  // Não dá pra inspecionar o argv real recebido pelo processo `claude`
  // spawnado no main process a partir do Playwright/renderer — por isso
  // App.tsx expõe o comando montado pelo CommandBuilder num elemento oculto
  // só de teste (`data-testid="launcher-last-command"`, ver comentário lá).
  // A prova de que os args/cwd realmente funcionam (não só que foram
  // montados) vem da sessão claude real subindo na aba nova logo abaixo.
  const launcher = window.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible();

  // Modelo nasce 'fable' (default do Launcher) — CA-1 pede 'sonnet'.
  await launcher.getByRole('radio', { name: 'sonnet', exact: true }).click();
  // Esforço já nasce 'high' e Permissões já nasce 'acceptEdits' (defaults
  // do Launcher, ui-spec §4/Brief 3) — já batem com o CA-1, nada a mudar.

  await launcher.getByLabel('Nome').fill('radar');

  const tabsBefore = await window.locator('[role="tab"]').count();
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const newTab = window.locator('[role="tab"]', { hasText: 'radar' });
  await expect(newTab).toBeVisible();
  await expect(window.locator('[role="tab"]')).toHaveCount(tabsBefore + 1);
  await expect(newTab).toHaveAttribute('aria-selected', 'true');

  const lastCommand = window.locator('[data-testid="launcher-last-command"]');
  await expect(lastCommand).toHaveText('claude --model sonnet --effort high --permission-mode acceptEdits -n radar');
  const cwd = await lastCommand.getAttribute('data-cwd');
  expect(cwd).toBeTruthy();
  expect(cwd).toContain('donel-dev');

  // Prova funcional: a aba lançada pelo Launcher sobe uma sessão claude de
  // verdade (os args não quebraram o spawn), mesmo padrão do teste T007.
  const activePane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(activePane).toHaveCount(1);

  await expect(async () => {
    const text = await activePane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });

  // NÃO perseguimos aqui o banner completo "Claude Code" nem diálogos
  // interativos de onboarding (trust folder / "chrome in extension
  // detected" / outros que apareçam só a partir da 3ª+ sessão claude desta
  // run) — tentado nesta task: nem Enter nem Escape fecharam de forma
  // confiável o prompt "chrome extension detected" que passou a aparecer a
  // partir daqui (onboarding global do CLI, não por-pasta). O cabeçalho
  // deste arquivo já documenta (comentário do T005) por que perseguir
  // diálogos interativos do CLI real é não-determinístico neste ambiente.
  //
  // Cobertura que FICA automatizada pro CA-1: o comando exato (asserção
  // acima) e o processo real permanecendo vivo com esses args — se
  // `--model/--effort/--permission-mode` fossem flags inválidas, o CLI
  // falharia rápido e a aba cairia no estado "sessão encerrada"
  // (session-ended-overlay). Ausência desse overlay após um tempo de
  // espera é a prova de que o CLI aceitou o argv montado pelo Launcher.
  await window.waitForTimeout(3_000);
  await expect(window.locator('[data-testid="session-ended-overlay"]')).toHaveCount(0);
  // Diálogos de onboarding pós-spawn (trust folder / chrome extension /
  // etc.) ficam como "Não verificado" — ver dossiê do T008.
});
