import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import type { LaunchedApp } from './helpers/launch';
import { REPO_ROOT, slugifyProjectPath } from './repoUnderTest';
import { removeTempDir } from './userDataIsolation';

// 014-chat, T059 - shared setup of the chat smokes (Fase 2), all driven by the
// FAKE `claude` (T040), never the real CLI.
//
// The app derives the transcript path of a tab from `homedir()/.claude` (it does
// not take it from the hook), so the smokes give the app a TEMP home
// (USERPROFILE/HOME): the fake writes its transcripts there, the real
// `~/.claude` of the machine is never touched and the session list starts empty.

export const FAKE_CLAUDE_CMD = path.join(__dirname, 'fixtures/fake-claude-chat/claude.cmd');
export const SHOTS_DIR = path.join(REPO_ROOT, 'test-results', 'chat-fase-2');

export interface ChatApp extends LaunchedApp {
  /** Temp home the app (and the fake) see as `~`. */
  readonly home: string;
  /** `<home>/.claude/projects/<slug of the repo under test>`: where the transcripts of the tab live. */
  readonly sessionsDir: string;
  /** Shuts the app down and removes every temp dir. */
  readonly dispose: () => Promise<void>;
}

export interface LaunchChatAppOptions {
  readonly name: string;
  /** Path of a scenario JSON for the fake (`DONEL_FAKE_CLAUDE_SCENARIO`). */
  readonly scenario?: string;
  readonly focusMode?: boolean;
  /** Runs after the temp home exists and before the app starts (e.g. to seed a transcript). */
  readonly seed?: (sessionsDir: string) => void;
  /** Extra top-level keys of `config.json` (e.g. `pet`), over the defaults of this helper. */
  readonly config?: Record<string, unknown>;
  /** Extra environment of the app (e.g. `DONEL_SMOKE_NOTIFICATIONS_LOG`), over `process.env`. */
  readonly env?: Record<string, string>;
}

export async function launchChatApp(options: LaunchChatAppOptions): Promise<ChatApp> {
  const home = mkdtempSync(path.join(tmpdir(), `donel-chat-home-${options.name}-`));
  const sessionsDir = path.join(home, '.claude', 'projects', slugifyProjectPath(REPO_ROOT));
  mkdirSync(sessionsDir, { recursive: true });
  options.seed?.(sessionsDir);

  const userDataDir = mkdtempSync(path.join(tmpdir(), `donel-chat-smoke-${options.name}-`));
  writeFileSync(
    path.join(userDataDir, 'config.json'),
    JSON.stringify({
      chat: { enabled: true, focusMode: options.focusMode ?? false },
      // `~/seazone` no longer resolves with the temp home: point the scanner at the real parent folder.
      projectRoots: [path.dirname(REPO_ROOT)],
      ...options.config,
    }),
    'utf8',
  );
  const launched = await launchIsolatedApp({
    userDataDir,
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      DONEL_CLAUDE_EXECUTABLE_FIXTURE: FAKE_CLAUDE_CMD,
      DONEL_FAKE_CLAUDE_HOME: path.join(home, '.claude'),
      ...(options.scenario ? { DONEL_FAKE_CLAUDE_SCENARIO: options.scenario } : {}),
      ...options.env,
    },
  });
  mkdirSync(SHOTS_DIR, { recursive: true });
  return {
    ...launched,
    home,
    sessionsDir,
    dispose: async () => {
      try {
        await closeIsolatedApp(launched);
      } finally {
        removeTempDir(home);
      }
    },
  };
}

export function chatHelpers(page: Page) {
  const viewSwitch = (): Locator => page.getByTestId('chat-view-switch');
  const showView = async (view: 'chat' | 'terminal'): Promise<void> => {
    await viewSwitch().getByText(view === 'chat' ? 'Chat' : 'Terminal', { exact: true }).click();
    if (view === 'chat') await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible();
    else await expect(page.locator('[data-testid="terminal-pane"]:visible')).toBeVisible();
  };
  /** The composer arrives in a later phase: prompts are typed in the terminal view. */
  const typeInTerminal = async (text: string): Promise<void> => {
    await showView('terminal');
    await page.locator('[data-testid="terminal-pane"]:visible').click();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };
  const waitForFakeFooter = async (): Promise<void> => {
    await showView('terminal');
    const pane = page.locator('[data-testid="terminal-pane"]:visible');
    // Idle footer: "? for shortcuts", or - without the hints (DONEL_FAKE_CLAUDE_FOOTER_HINTS=0, the real CLI with a
    // statusLine) - the permission mode with no spinner row above the box.
    await expect(async () => {
      const text = await pane.innerText();
      expect(text).toMatch(/shortcuts|manual mode on|accept edits on/);
      expect(text).not.toContain('Pondering…');
    }).toPass({ timeout: 30_000 });
  };
  const shot = async (name: string): Promise<void> => {
    await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
    // Optional extra copy (evidence for a review), off by default so the suite stays clean.
    const extra = process.env.DONEL_SMOKE_SHOTS_DIR;
    if (extra) {
      mkdirSync(extra, { recursive: true });
      await page.screenshot({ path: path.join(extra, `${name}.png`) });
    }
  };
  return { viewSwitch, showView, typeInTerminal, waitForFakeFooter, shot, timeline: (): Locator => page.locator('[data-testid="chat-timeline"]:visible') };
}
