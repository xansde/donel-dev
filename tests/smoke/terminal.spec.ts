import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

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
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('terminal');
  electronApp = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: APP_CWD,
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

// FIX (feedback E2E rodada 3, "painel lateral 'Lançar sessão' fixo rouba
// espaço") — o Launcher deixou de ser um painel fixo: nasce fechado, abre
// via item "Sessão Claude" do menu do "＋ Nova sessão" (App.tsx,
// `launcherOpen`). Testes que interagem direto com `[data-testid="launcher"]`
// precisam abrir o painel primeiro.
async function openLauncherPanel(): Promise<void> {
  await window.getByRole('button', { name: 'Mais opções de ＋ Nova sessão' }).click();
  await window.getByRole('menuitem', { name: 'Sessão Claude' }).click();
  await expect(window.locator('[data-testid="launcher"]')).toBeVisible();
}

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
});

test('terminal spawns a real claude session inside Electron', async () => {
  // FIX (decisão A, 2026-07-23) — o app nasce com ZERO abas agora (empty
  // state, App.tsx `INITIAL_TABS`); a antiga aba "Sessão" default (cwd=home,
  // spawnada sozinha no boot) deixou de existir. Este teste ainda quer
  // provar o mesmo cenário original (sessão claude em `os.homedir()`, sem
  // projeto selecionado) — reproduz isso clicando direto no corpo do "＋
  // Nova sessão" (handleQuickNewClaudeSession, App.tsx), que sem nenhum
  // projeto selecionado ainda spawna exatamente esse cenário. Esta é a
  // PRIMEIRA aba de toda a suíte deste arquivo — os testes seguintes
  // dependem dela existir e ficar em foco.
  await expect(window.locator('[data-testid="empty-state"]')).toBeVisible();
  await window.getByRole('button', { name: '＋ Nova sessão', exact: true }).click();
  await expect(window.locator('[data-testid="empty-state"]')).toHaveCount(0);

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
  await openLauncherPanel();
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

test('semáforo: o StateDot de uma aba em BACKGROUND muda de trabalhando pra aguardando resposta sem precisar focá-la (T009, FR-010/CA-6)', async () => {
  // Timeout default do arquivo (30s, playwright.config.ts) não sobra pro
  // turno real completar (boot + espera pelo prompt pronto + resposta do
  // modelo) — as duas esperas de 60s/120s abaixo já somam mais que isso
  // sozinhas. 300s (não 180s) — folga extra pro achado da suíte completa
  // (ver comentário da asserção final, timeout local 45s -> 120s).
  test.setTimeout(300_000);

  // --model haiku (barato) + prompt trivial, conforme a DoD da task: prova
  // o pipeline completo hook->HTTP local->main->IPC->preload->TerminalPane
  // ->App.tsx->TerminalTab funcionando de ponta a ponta com uma sessão
  // claude real, SEM nunca focar a aba de novo depois do prompt enviado —
  // é exatamente isso que uma UI hardcoded (o estado fixo 'working' de
  // antes do T009) não conseguiria fingir.
  await openLauncherPanel();
  const launcher = window.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible();

  await launcher.getByRole('radio', { name: 'haiku', exact: true }).click();
  await launcher.getByLabel('Nome').fill('semaforo-test');

  const tabsBefore = await window.locator('[role="tab"]').count();
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const newTab = window.locator('[role="tab"]', { hasText: 'semaforo-test' });
  await expect(newTab).toBeVisible();
  await expect(window.locator('[role="tab"]')).toHaveCount(tabsBefore + 1);
  await expect(newTab).toHaveAttribute('aria-selected', 'true');

  const activePane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(activePane).toHaveCount(1);
  await expect(async () => {
    const text = await activePane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });

  await activePane.click();
  if ((await activePane.innerText()).includes('trust this folder')) {
    await window.keyboard.press('Enter');
  }
  await expect(async () => {
    const text = await activePane.innerText();
    expect(text.toLowerCase()).toContain('claude code');
  }).toPass({ timeout: 15_000 });

  // StateDot fica dentro da própria aba na barra de abas — TerminalTab não
  // passa `label` pro StateDot, então o estado só é exposto via aria-label
  // (design-system.md §9: "o estado nunca é comunicado só por cor").
  const dot = newTab.locator('[role="img"]');
  await expect(dot).toHaveAttribute('aria-label', 'Trabalhando'); // baseline otimista antes de qualquer hook

  // Espera o prompt de verdade ficar pronto pra digitar (status bar "accept
  // edits on") em vez de assumir que o boot já terminou — em máquinas com
  // hooks globais do usuário lentos/instáveis (achado do addendum T009), a
  // tela ainda redesenha por um tempo mesmo depois do banner "Claude Code"
  // aparecer, e digitar cedo demais faz o prompt se perder.
  await expect(async () => {
    expect(await activePane.innerText()).toContain('accept edits on');
  }).toPass({ timeout: 60_000 });

  await activePane.click();
  await window.keyboard.type('Responda só OK, sem mais nada.', { delay: 30 });
  await window.keyboard.press('Enter');

  // Tira o foco da aba ANTES do turno terminar — troca pra "Nova sessão"
  // (decisão A, 2026-07-23: a primeira aba deste arquivo, criada no início
  // do 1º teste via corpo do "＋ Nova sessão"; substitui a antiga aba
  // "Sessão" default do boot, que deixou de existir). O resto do teste
  // nunca mais toca `newTab`.
  const defaultTab = window.locator('[role="tab"]', { hasText: 'Nova sessão' }).first();
  await defaultTab.click();
  await expect(newTab).toHaveAttribute('aria-selected', 'false');
  await expect(defaultTab).toHaveAttribute('aria-selected', 'true');

  // A prova de CA-6: sem NUNCA refocar `newTab`, o dot dela na barra de
  // abas muda pra "Aguardando resposta" quando o turno completa (Stop hook
  // -> SessionSemaphoreManager -> IPC -> App.tsx, tudo com a aba em segundo
  // plano, TerminalPane só invisível via CSS mas nunca desmontado).
  //
  // FIX (diagnóstico da rodada 6) — 120s, não 45s: achado real medido nesta
  // máquina com `tasklist` durante a falha — 14 processos `claude.exe`
  // concorrentes no momento (mesmo padrão já documentado no roteiro batch-5,
  // item "CA-6 rodou 2x e falhou 2x por carga concorrente"). O servidor HTTP
  // do semáforo é local e por-instância (porta efêmera, `session-semaphore-
  // manager.ts`) — os outros processos `claude.exe` não competem por ELE;
  // o gargalo é a resposta da API em si sob concorrência pesada de contas/
  // rede na máquina. Turno real (hook `Stop` só dispara quando o turno
  // TERMINA) — não é bug de entrega do hook, é o turno legitimamente
  // demorando mais sob essa carga. Não é enfraquecimento de asserção (o
  // `expect` continua exato, exigindo "Aguardando resposta"), só mais tempo
  // real pro turno terminar.
  await expect(dot).toHaveAttribute('aria-label', 'Aguardando resposta', { timeout: 120_000 });
});
