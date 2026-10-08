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

export interface LaunchOptions {
  /** Reuse an existing isolated dir (restart scenarios). Omit to create a fresh one named after `name`. */
  readonly userDataDir?: string;
  /** Used only to name the new temp dir. */
  readonly name?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
}

export async function launchIsolatedApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? createIsolatedUserDataDir(options.name ?? 'smoke');
  const app = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: options.cwd ?? REPO_ROOT,
    ...(options.env ? { env: options.env as Record<string, string> } : {}),
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
