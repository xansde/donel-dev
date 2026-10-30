import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../repoUnderTest';
import { createIsolatedUserDataDir } from '../userDataIsolation';

/**
 * Isolated userData whose `config.json` points the project scanner at the
 * repo's real parent folder. The default root (`~/seazone`) does not list a
 * worktree under `.claude/worktrees/`, so specs that open "this repo" by name
 * failed there before reaching what they test. In the main checkout the parent
 * is `~/seazone` itself — same list as the default. Same seeding as
 * `favorite-sessions.spec.ts` and `chatSmoke.ts`.
 */
export function seededUserDataDir(specName: string): string {
  const userDataDir = createIsolatedUserDataDir(specName);
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [path.dirname(REPO_ROOT)] }), 'utf8');
  return userDataDir;
}
