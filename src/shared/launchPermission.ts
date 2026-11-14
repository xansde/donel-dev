// Super bypass das orquestradoras (dono, 09/11, t-66cb0ce4: "as sessões orquestradoras nunca são o super bypass
// permissions. Deveria ser"). The ONE decision of the permission a `claude` session is born with, used by both spawn
// points of the main (this computer and a remote place) on every way of being born: a place the owner starts, the
// Líder único the Jobu opens, `sessao_abrir`, a renewal in flight, a resume.
//
// - An orchestrator is born in super bypass, whatever the role, the launcher default or a mode carried by a renewal
//   say: `--permission-mode bypassPermissions` AND `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1`. Without it
//   the session stops on a prompt that only the owner, inside its tab, can answer (the Theo renewed in flight, 09/11).
// - Orchestrator: the Líder role (of a board, or the Líder único), the Jobu's mark, or a place above another one on its
//   board (it opened or directs sessions: `spawnFactsOf`, src/shared/mindscape/reach.ts).
// - A session on a remote place (VPS) is born in super bypass too, whatever its role (owner's rule; t-2a9060dd, 14/11:
//   the Revisor and the Dev renewed in flight came back `--permission-mode default` and stopped on every command).
// - Every other session keeps its mode (launcher > CLI user default > `default`, T018). Any session that ends up in
//   bypass gets the env too, here as on a remote place: without it the CLI asks to confirm the bypass.
// The hook guards (pretooluse-safety-check) are untouched: they run in any permission mode.

import { resolvePermissionMode, withResolvedPermissionMode } from './commandBuilder';
import { LEADER_ROLE_ID } from './roles';

/** The env that lets the CLI start in bypass without asking to confirm it. */
export const SUPER_BYPASS_ENV: Readonly<Record<string, string>> = Object.freeze({ CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS: '1' });

/** What the main knows of a session at spawn. */
export interface SpawnFacts {
  readonly roleId?: string;
  /** The Jobu's mark (Líder único). */
  readonly leaderOfAll?: boolean;
  /** Its place is above another one on the board (it opened or directs sessions). */
  readonly directsOthers?: boolean;
  /** It runs on a remote place (VPS), not on this computer. */
  readonly remote?: boolean;
}

export function isOrchestratorSpawn(facts: SpawnFacts): boolean {
  return facts.roleId === LEADER_ROLE_ID || facts.leaderOfAll === true || facts.directsOthers === true;
}

/** The argv runs in bypass (mode or the old flag). */
export function isBypassLaunch(argv: readonly string[]): boolean {
  return argv.includes('--dangerously-skip-permissions') || resolvePermissionMode(argv, undefined) === 'bypassPermissions';
}

/** `argv` with every `--permission-mode` replaced by one `--permission-mode bypassPermissions`, in place of the first. */
function withBypassMode(argv: readonly string[]): string[] {
  const out: string[] = [];
  let placed = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const spaced = arg === '--permission-mode';
    if (!spaced && !arg.startsWith('--permission-mode=')) {
      out.push(arg);
      continue;
    }
    if (spaced) i += 1;
    if (!placed) out.push('--permission-mode', 'bypassPermissions');
    placed = true;
  }
  if (!placed) out.push('--permission-mode', 'bypassPermissions');
  return out;
}

export interface LaunchPermissionPlan {
  /** The argv with exactly one explicit `--permission-mode` (T018). */
  readonly args: string[];
  /** Env to add to the session's process (empty outside bypass). */
  readonly env: Readonly<Record<string, string>>;
}

/** The argv and env a `claude` session is born with. `userDefault`: `permissions.defaultMode` of the CLI user (T018). */
export function planLaunchPermission(argv: readonly string[], facts: SpawnFacts, userDefault: string | undefined): LaunchPermissionPlan {
  const args = isOrchestratorSpawn(facts) || facts.remote === true ? withBypassMode(argv) : withResolvedPermissionMode(argv, userDefault);
  return { args, env: isBypassLaunch(args) ? SUPER_BYPASS_ENV : {} };
}
