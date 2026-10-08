import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { PROJECT_NAME } from '../repoUnderTest';

// Shared UI gestures. `launchClaudeTab` / `openProjectClaudeTab` and
// `waitForClaudeBooted` are the ONLY place that knows how a claude tab shows
// its session today (the xterm `terminal-pane`). When the chat becomes the
// default view (014, Phase 7) only these two need to change.

/** Confirms the "Fechar sessão?" modal (FR-006) if it appears; swallowed when the process was already dead. */
export async function confirmCloseModalIfOpen(window: Page, timeout = 2_000): Promise<void> {
  await window
    .getByRole('button', { name: 'Fechar sessão' })
    .click({ timeout })
    .catch(() => undefined);
}

/** "＋ Nova sessão" dropdown -> Terminal (free shell tab). */
export async function openFreeTerminalTab(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Mais opções de ＋ Nova sessão' }).click();
  await window.getByRole('menuitem', { name: 'Terminal (shell livre)' }).click();
}

/** The body of "＋ Nova sessão" always opens the Launcher. */
export async function openLauncherPanel(window: Page): Promise<Locator> {
  await window.getByRole('button', { name: '＋ Nova sessão', exact: true }).click();
  const launcher = window.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible();
  return launcher;
}

export interface LaunchClaudeTabOptions {
  /** Project name in the Launcher select. Pass `null` to keep the one the Launcher remembers. Default: the repo under test. */
  readonly project?: string | null;
  readonly model?: string;
  readonly effort?: string;
  /** Tab/session name. When omitted the Launcher keeps its default (the project name) and the tab is found by it. */
  readonly name?: string;
}

/** "＋ Nova sessão" -> (project) -> (model/effort) -> Nome -> "▶ Iniciar". Returns the new, selected tab. */
export async function launchClaudeTab(window: Page, options: LaunchClaudeTabOptions): Promise<Locator> {
  const launcher = await openLauncherPanel(window);
  const project = options.project === undefined ? PROJECT_NAME : options.project;
  if (project !== null) {
    await launcher.getByRole('button', { name: 'Selecione um projeto' }).click();
    await window.getByRole('option', { name: project, exact: true }).click();
  }
  if (options.model) await launcher.getByRole('radio', { name: options.model, exact: true }).click();
  if (options.effort) await launcher.getByRole('radio', { name: options.effort, exact: true }).click();
  if (options.name) await launcher.getByLabel('Nome').fill(options.name);
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const tabLabel = options.name ?? project;
  if (!tabLabel) throw new Error('launchClaudeTab: pass `name` or `project` so the new tab can be found');
  const tab = window.locator('[role="tab"]', { hasText: tabLabel }).last();
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return tab;
}

/** Opens a claude session by clicking the project in the titlebar "Trocar de projeto" popover. */
export async function openProjectClaudeTab(window: Page, project: string = PROJECT_NAME): Promise<void> {
  await window.getByRole('button', { name: 'Trocar de projeto' }).click();
  const popover = window.getByRole('dialog', { name: 'Projetos' });
  await expect(popover).toBeVisible();
  const projectButton = popover.getByRole('button', { name: project, exact: true });
  await expect(projectButton).toBeVisible({ timeout: 15_000 });
  await projectButton.click();
  await expect(popover).toBeHidden();
}

export interface WaitForClaudeBootedOptions {
  /** How far to wait. `started` = pane has output and no spawn error; `banner` = "Claude Code" banner; `prompt` = input ready ("accept edits on"). Default `started`. */
  readonly until?: 'started' | 'banner' | 'prompt';
  /** Timeout for the `started` phase (ms). Default 20 s. */
  readonly startTimeout?: number;
  /** Press Enter if the "trust this folder" dialog shows. Default: true for `banner`/`prompt`. */
  readonly acceptTrust?: boolean;
}

/** Waits until the visible claude session has booted. Returns the visible pane locator. */
export async function waitForClaudeBooted(window: Page, options: WaitForClaudeBootedOptions = {}): Promise<Locator> {
  const until = options.until ?? 'started';
  const pane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(pane).toHaveCount(1);
  await expect(async () => {
    const text = await pane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: options.startTimeout ?? 20_000 });

  if (until === 'started' && !options.acceptTrust) return pane;

  // First use of a folder can raise the "Quick safety check"; Enter accepts the
  // default ("Yes, trust folder"). On a trusted folder Enter on an empty prompt is a no-op.
  await pane.click();
  if ((await pane.innerText()).includes('trust this folder')) {
    await window.keyboard.press('Enter');
  }
  if (until === 'banner') {
    await expect(async () => {
      expect((await pane.innerText()).toLowerCase()).toContain('claude code');
    }).toPass({ timeout: 15_000 });
  } else if (until === 'prompt') {
    await expect(async () => {
      expect(await pane.innerText()).toContain('accept edits on');
    }).toPass({ timeout: 60_000 });
  }
  return pane;
}

/** Titlebar "Trocar de projeto" -> "Sessões anteriores de <project>"; returns the previous-sessions screen (a region in the shell grid). */
export async function openPreviousSessionsDialog(window: Page, project: string = PROJECT_NAME): Promise<Locator> {
  await window.getByRole('button', { name: 'Trocar de projeto' }).click();
  const popover = window.getByRole('dialog', { name: 'Projetos' });
  await expect(popover).toBeVisible();
  const historyButton = popover.getByRole('button', { name: `Sessões anteriores de ${project}`, exact: true });
  await expect(historyButton).toBeVisible({ timeout: 15_000 });
  await historyButton.click();
  const screen = window.getByRole('region', { name: new RegExp(`Sessões anteriores · ${project}`) });
  await expect(screen).toBeVisible();
  return screen;
}
