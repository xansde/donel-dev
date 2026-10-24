import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, SESSIONS_DIR } from '../repoUnderTest';

// Synthetic CLI transcripts (.jsonl) seeded under the REAL `~/.claude/projects/<slug>`
// of this repo, so the app's session indexer finds them. LGPD: content is
// synthetic; callers must `removeSessionFile` in `afterAll`.

export interface SeededSession {
  readonly id: string;
  readonly filePath: string;
  readonly marker: string;
  /** Last `custom-title` written (the one that must win), when requested. */
  readonly customTitle?: string;
}

function detectClaudeCliVersion(): string {
  try {
    const match = execSync('claude --version', { encoding: 'utf8' }).match(/^(\S+)/);
    return match ? match[1] : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function detectGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export interface SeedSessionOptions {
  /** Unique text the user line starts with; lets the UI search find the session. */
  readonly marker: string;
  /** Free label for the synthetic text (which smoke seeded it). */
  readonly origin: string;
  /**
   * Write the fields of a real CLI-resumable line (version, branch, permission
   * mode...). Needed when `claude -r` must accept the file; skip for UI-only seeds.
   */
  readonly resumable?: boolean;
  /** When set, writes an OLD title first and this one last (the last must win). */
  readonly customTitle?: string;
}

export function seedSession(options: SeedSessionOptions & { readonly customTitle: string }): SeededSession & { readonly customTitle: string };
export function seedSession(options: SeedSessionOptions): SeededSession;
export function seedSession(options: SeedSessionOptions): SeededSession {
  const id = randomUUID();
  const filePath = join(SESSIONS_DIR, `${id}.jsonl`);
  const userLine: Record<string, unknown> = {
    type: 'user',
    message: { role: 'user', content: `${options.marker} — fixture sintética do smoke (${options.origin}), sem conteúdo real de trabalho.` },
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: id,
    timestamp: new Date().toISOString(),
    cwd: REPO_ROOT,
    isSidechain: false,
  };
  if (options.resumable) {
    Object.assign(userLine, {
      gitBranch: detectGitBranch(),
      permissionMode: 'bypassPermissions',
      version: detectClaudeCliVersion(),
      entrypoint: 'claude-desktop',
      userType: 'external',
      promptId: randomUUID(),
      promptSource: 'sdk',
    });
  }
  const lines: string[] = [];
  if (options.customTitle) {
    lines.push(JSON.stringify({ type: 'custom-title', customTitle: 'nome-antigo-que-nao-deve-aparecer', sessionId: id }));
  }
  lines.push(JSON.stringify(userLine));
  if (options.customTitle) {
    lines.push(JSON.stringify({ type: 'custom-title', customTitle: options.customTitle, sessionId: id }));
  }
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return { id, filePath, marker: options.marker, customTitle: options.customTitle };
}

export function removeSessionFile(filePath: string | undefined): void {
  if (!filePath || !existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // already gone
  }
}
