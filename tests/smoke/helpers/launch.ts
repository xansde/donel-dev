import path from 'node:path';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { APP_MAIN, REPO_ROOT } from '../repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from '../userDataIsolation';

// Single place that knows how a smoke opens the built app. Every launch gets
// its own `--user-data-dir` (mkdtemp, see userDataIsolation.ts): no smoke may
// ever touch the real userData of the machine.

export interface LaunchedApp {
  readonly app: ElectronApplication;
  readonly window: Page;
  readonly userDataDir: string;
}

/** `claude.cmd` of the scripted fake CLI (fixtures/fake-claude-chat). */
export const FAKE_CLAUDE_CMD = path.join(__dirname, '..', 'fixtures', 'fake-claude-chat', 'claude.cmd');

export interface LaunchOptions {
  /** Reuse an existing isolated dir (restart scenarios). Omit to create a fresh one named after `name`. */
  readonly userDataDir?: string;
  /** Used only to name the new temp dir. */
  readonly name?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  /**
   * Which `claude` the app spawns. Default `true`: the scripted fake
   * (`DONEL_CLAUDE_EXECUTABLE_FIXTURE`), zero quota, no trust dialog, no slow
   * banner. Pass `false` ONLY in specs tagged `@real` (docs/testes/proposta.md
   * §2). An explicit `DONEL_CLAUDE_EXECUTABLE_FIXTURE` in `env` always wins
   * (e.g. the fake LOGIN cli of the accounts specs).
   *
   * The fake keeps its own transcripts inside the isolated userData dir
   * (`<userData>/fake-claude-home`), so nothing lands in the machine's
   * `~/.claude`. Specs that exercise the app's transcript watcher still write
   * the `.jsonl` the app watches (`SESSIONS_DIR`) themselves.
   */
  readonly fakeClaude?: boolean;
}


export async function launchIsolatedApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? createIsolatedUserDataDir(options.name ?? 'smoke');
  const useFake = options.fakeClaude !== false;
  const baseEnv = options.env ?? (useFake ? process.env : undefined);
  const env =
    useFake && baseEnv && !baseEnv.DONEL_CLAUDE_EXECUTABLE_FIXTURE
      ? { ...baseEnv, DONEL_CLAUDE_EXECUTABLE_FIXTURE: FAKE_CLAUDE_CMD, DONEL_FAKE_CLAUDE_HOME: baseEnv.DONEL_FAKE_CLAUDE_HOME ?? path.join(userDataDir, 'fake-claude-home'), DONEL_FAKE_CLAUDE_RESUME_STRICT: '1' }
      : baseEnv;
  const app = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: options.cwd ?? REPO_ROOT,
    ...(env ? { env: env as Record<string, string> } : {}),
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userDataDir };
}

/**
 * Closes the app and (by default) removes its temp userData in a `finally`,
 * so a close that times out under load (B11) never leaves a stray dir.
 * Callers that close with live PTYs should `test.setTimeout(90_000)` first.
 */
export async function closeIsolatedApp(launched: Pick<LaunchedApp, 'app' | 'userDataDir'>, removeUserData = true): Promise<void> {
  try {
    await launched.app?.close();
  } finally {
    if (removeUserData && launched.userDataDir) removeIsolatedUserDataDir(launched.userDataDir);
  }
}
