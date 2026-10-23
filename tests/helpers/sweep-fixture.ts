// 016-jobu-faxina - temporary REAL git repos for the integration tests of the sweep. Every repo lives under
// `os.tmpdir()`; its `origin` is a bare repo next to it. The git of the machine is isolated from the global
// configuration (hooks, signing, identity) through environment variables that are restored by `cleanup`.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Sandbox {
  readonly root: string;
  /** The folder the sidebar would list as a root; repos are created inside. */
  readonly seazone: string;
  /** Stands for `~/.claude/projects`. */
  readonly claudeProjects: string;
  /** Stands for `%TEMP%/claude`. */
  readonly tempClaude: string;
  cleanup(): Promise<void>;
}

const ENV_KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT'] as const;

export async function createSandbox(): Promise<Sandbox> {
  const root = await fs.mkdtemp(join(tmpdir(), 'sweep-it-'));
  const seazone = join(root, 'seazone');
  const claudeProjects = join(root, 'claude-projects');
  const tempClaude = join(root, 'temp-claude');
  await Promise.all([seazone, claudeProjects, tempClaude, join(root, 'origins')].map((dir) => fs.mkdir(dir, { recursive: true })));
  const config = join(root, 'gitconfig');
  await fs.writeFile(config, '[user]\n\tname = Sweep Test\n\temail = sweep@test.invalid\n[init]\n\tdefaultBranch = staging\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n');
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_TERMINAL_PROMPT = '0';
  return {
    root,
    seazone,
    claudeProjects,
    tempClaude,
    async cleanup() {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** Runs git synchronously (a fixture does not need to be fast) and returns trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function write(path: string, content: string): Promise<void> {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, content);
}

/** Commits everything in `cwd` with the message. Returns the new SHA. */
export function commitAll(cwd: string, message: string): string {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

/**
 * `seazone/<name>` with a first commit on `staging` (a `.gitignore` for the usual output included) and a bare `origin`
 * it was pushed to. `withOrigin = false` leaves the repo with no remote at all.
 */
export async function createRepo(sandbox: Sandbox, name: string, options: { withOrigin?: boolean } = {}): Promise<string> {
  const repo = join(sandbox.seazone, name);
  await fs.mkdir(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'staging');
  await write(join(repo, '.gitignore'), 'node_modules\nout\nrelease\n.esteira-ignored\n.env\n');
  await write(join(repo, 'README.md'), `# ${name}\n`);
  commitAll(repo, 'chore: inicio');
  if (options.withOrigin !== false) {
    const origin = join(sandbox.root, 'origins', `${name}.git`);
    git(sandbox.root, 'init', '-q', '--bare', '-b', 'staging', origin);
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', '-u', 'origin', 'staging');
  }
  return repo;
}

/** Sets an old modification time on a file or folder. */
export async function age(path: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * 24 * 60 * 60_000);
  await fs.utimes(path, when, when);
}
