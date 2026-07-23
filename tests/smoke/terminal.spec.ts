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

test('resizing the window does not crash the app', async () => {
  const originalSize = window.viewportSize();
  await window.setViewportSize({ width: 1000, height: 700 });
  await window.waitForTimeout(500);
  await window.setViewportSize({ width: originalSize?.width ?? 1280, height: originalSize?.height ?? 800 });

  // App ainda vivo e com o terminal renderizado após o resize.
  await expect(window.locator('[data-testid="terminal-pane"]')).toBeVisible();
  expect(electronApp.windows().length).toBeGreaterThan(0);
});
