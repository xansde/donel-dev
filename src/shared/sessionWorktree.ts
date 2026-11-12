// "Isolar em worktree" (Launcher, uso geral) — the pure half: the name the app gives the worktree and how it reads
// that name back from an argv. The worktree itself is created and entered by the CLI (`claude --worktree <name>`,
// CLI 2.1.314): it lives at `<main repo root>/.claude/worktrees/<name>/`, on a new branch `worktree-<name>`, and the
// CLI locks it with the reason `claude session <name> (pid <pid>)` while the session runs. Measured on 30/10 with
// the real CLI (`-p` and interactive, from the repo root, a subfolder and a linked worktree): the folder is always
// under the MAIN checkout, and a killed session leaves its lock behind.

/** The mark of an isolated session on its tab and in the session header. */
export const WORKTREE_TAB_MARK = '⎇';

/** Prefix of the branch the CLI creates for a `--worktree` session. */
export const CLI_WORKTREE_BRANCH_PREFIX = 'worktree-';

/** Longest slug taken from the session name; the date suffix comes on top. */
const MAX_SLUG_LENGTH = 24;

/** The branch `claude --worktree <name>` creates. */
export function cliWorktreeBranch(name: string): string {
  return `${CLI_WORKTREE_BRANCH_PREFIX}${name}`;
}

/** Lowercase ASCII, digits and single dashes: safe as a folder name and inside a git branch name. */
export function slugifyWorktreeName(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Short name for a new isolated session: the session name as a slug (or `sessao` without one) plus the local
 * `MMDD-HHmm`, e.g. `radar-1030-1752`. A name already `taken` (another open tab, same minute) gets `-2`, `-3`...:
 * the CLI REOPENS a worktree whose name exists, and two live tabs must never share one.
 */
export function worktreeNameFor(sessionName: string, now: Date, taken: readonly string[] = []): string {
  const base = `${slugifyWorktreeName(sessionName) || 'sessao'}-${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** A name the app would have produced: nothing that could escape `.claude/worktrees/` or become a flag. */
export function isSafeWorktreeName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}

/** The worktree name in an argv built by `buildClaudeArgs` (`--worktree <name>` or `--worktree=<name>`); `null` without one. */
export function worktreeNameFromArgs(args: readonly string[] | undefined): string | null {
  if (!args) return null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--worktree' || arg === '-w') {
      const value = args[i + 1];
      return value !== undefined && !value.startsWith('-') && value !== '' ? value : null;
    }
    if (arg.startsWith('--worktree=')) {
      const value = arg.slice('--worktree='.length);
      return value === '' ? null : value;
    }
  }
  return null;
}

/**
 * t-58b67066 — the worktree of a session another session opens (`sessao_abrir`): on a remote place it always gets one
 * (sessions there share the project folder, and one switching its branch pulled it from under the others); on this
 * computer, none (the owner's own "Isolar em worktree" decides there). `taken` = names of the open tabs.
 */
export function agentOpenWorktree(remoteId: string | undefined, sessionName: string, now: Date, taken: readonly string[]): string | undefined {
  return remoteId ? worktreeNameFor(sessionName, now, taken) : undefined;
}
