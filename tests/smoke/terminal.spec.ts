import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { launchClaudeTab, openProjectClaudeTab, waitForClaudeBooted } from './helpers/ui';
import { PROJECT_NAME } from './repoUnderTest';

// REVISÃO DE TESTES (08/10): o teste do Launcher/argv exato (T008, CA-1) foi
// absorvido por `model-injection.spec.ts` (mesmo hook `launcher-last-command`),
// e o do semáforo em background com turno real (T009, 420 s, gasta cota) saiu por
// decisão do dono — a ponte de hooks do semáforo é coberta pelo vitest
// (hook-bridge, semaphore-state-machine) e pelo smoke do chat (014).
//
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

// T801/§B19 (008) — `APP_MAIN`/`REPO_ROOT`/`PROJECT_NAME` vêm de
// `repoUnderTest.ts`: o projeto na sidebar é o `basename` da PASTA de onde a
// suíte roda (numa worktree, `donel-dev-wt-x`), nunca o literal `donel-dev`.

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

// Só o primeiro teste (@real) precisa do CLI de verdade: ele sobe o próprio app
// (com `fakeClaude: false`) e o fecha ao fim; os demais usam um app com o claude
// falso (docs/testes/proposta.md §2). Sem `describe`, para os títulos não mudarem.
let appOpen = false;

async function openApp(name: string, fakeClaude: boolean): Promise<void> {
  ({ app: electronApp, window, userDataDir } = await launchIsolatedApp({ name, fakeClaude }));
  appOpen = true;
}

async function closeApp(): Promise<void> {
  if (!appOpen) return;
  appOpen = false;
  await closeIsolatedApp({ app: electronApp, userDataDir });
}

test.afterAll(async () => {
  await closeApp();
});

test('terminal spawns a real claude session inside Electron @abas @real', async () => {
  test.setTimeout(60_000);

  // FIX (decisão A, 2026-07-23) — o app nasce com ZERO abas agora (empty
  // state, App.tsx `INITIAL_TABS`); a antiga aba "Sessão" default (cwd=home,
  // spawnada sozinha no boot) deixou de existir. Este teste queria provar o
  // mesmo cenário original (sessão claude em `os.homedir()`, sem projeto
  // selecionado) clicando direto no corpo do "＋ Nova sessão".
  //
  // FIX (auditoria rodada 6 ciclo 2, achado media "CTA do titlebar reproduz
  // o bug do empty state em 1 clique") — esse cenário (`cwd: undefined` ->
  // `os.homedir()` -> "Quick safety check" preso) deixou de ser alcançável
  // por QUALQUER caminho da UI.
  //
  // FIX (teste manual 27/07) — o corpo do "＋ Nova sessão" agora abre o
  // Launcher SEMPRE (App.tsx, `onClick={() => setLauncherOpen(true)}`), não
  // mais condicionado a `lastLaunch`/`selectedProjectPath` (o guard que
  // existia dentro de `handleQuickNewClaudeSession` só se aplica ao
  // quick-launch, agora item "Rápida (última config)" do dropdown). Este
  // teste continua provando o mesmo cenário (1ª aba de toda a suíte, sem
  // lançamento anterior) — escolhe `ai-rats` (repo real sob `~/seazone`, não
  // `donel-dev`) DE PROPÓSITO — `donel-dev` fica reservado pro teste
  // seguinte (T007, abaixo), que precisa abrir esse projeto pela SIDEBAR
  // pela primeira vez nesta run pra provar que a sidebar cria uma aba NOVA
  // (`handleOpenProject` reaproveita a aba existente quando o `cwd` já tem
  // uma — se este teste também usasse `donel-dev`, o clique da sidebar no
  // T007 só focaria esta aba em vez de provar a criação).
  await openApp('terminal-real', false);
  await expect(window.locator('[data-testid="empty-state"]')).toBeVisible();
  await launchClaudeTab(window, { project: 'ai-rats', model: 'haiku' });
  await expect(window.locator('[data-testid="empty-state"]')).toHaveCount(0);

  // Boot only (no API turn): the real CLI prints its banner; the "trust this
  // folder" dialog (first use of a folder) is accepted with Enter.
  await waitForClaudeBooted(window, { until: 'banner' });
  await closeApp();
});

test('opening a project from the project switcher creates a tab with a claude session in that project cwd @abas', async () => {
  await openApp('terminal-fake', true);
  // T007 — prova o DoD ("abrir projeto funciona", FR-001/FR-002): clicar num
  // projeto real spawna uma sessão claude nova com `cwd` correto, sem matar
  // a aba "Sessão" default (continua montada, só fica display:none —
  // App.tsx mantém o PTY vivo ao trocar de aba). `donel-dev` é o próprio
  // repo sob teste — sempre presente no scan (tem `.git`) e sempre em
  // `~\seazone\donel-dev` nesta máquina de dev.
  //
  // FIX (item 1, rodada de feedback do teste de 30/07) — a árvore
  // "Projetos" da sidebar saiu (só ficaram Favoritos + Sessões); abrir um
  // projeto qualquer agora é sempre pelo popover "Projetos" do seletor no
  // titlebar.
  await openProjectClaudeTab(window);

  const newTab = window.locator('[role="tab"]', { hasText: PROJECT_NAME });
  await expect(newTab).toBeVisible();
  await expect(newTab).toHaveAttribute('aria-selected', 'true');

  // Only the active tab keeps its terminal-pane visible.
  const activePane = await waitForClaudeBooted(window, { until: 'banner' });
  await expect(async () => {
    // Proves the cwd: the claude prompt shows the path of the clicked project.
    expect(await activePane.innerText()).toContain(PROJECT_NAME);
  }).toPass({ timeout: 15_000 });
});

test('resizing the window does not crash the app @abas', async () => {
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
