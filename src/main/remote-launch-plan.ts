// Plano do lançamento remoto (t-1a3f7150, fatia 1) — the files and the argv a `claude` session on a remote place is
// born with, out of `spawnRemoteClaudeSession` (index.ts). Pure: no I/O, no token or port drawn here (the caller
// draws them and registers them with the bridge and the MCP), no electron. The app on the PC uses it on every remote
// launch; the Oráculo daemon on the VPS will use it to open a session while the PC is off (docs/adr/0009).

import { MCP_SERVER_NAME } from '../shared/browser/mcp';
import { appMcpAllowArgs, buildBrowserMcpConfig } from '../shared/commandBuilder';
import { isBypassLaunch, planLaunchPermission, type SpawnFacts } from '../shared/launchPermission';
import type { RoleScopeSettings } from '../shared/role-scope';
import { planRoleLaunch, type RoleLaunchGap } from '../shared/roleLaunch';
import type { RoleScope } from '../shared/roles';
import { isSafeWorktreeName } from '../shared/sessionWorktree';
import { browserMcpUrl } from './browser/browser-mcp-server';
import { buildSessionHooksSettings, buildSlackMarkFile, keyFilePermissions, tokenHeaderFileContent, type StatusLineBridgePlan } from './hooks-settings';
import { buildRemoteSetupScript, REMOTE_SESSIONS_DIR, type RemoteFile, type RemoteSessionMeta } from './remote-session';

export interface RemoteLaunchInput {
  /** The conversation id the CLI is born with (also the session folder `~/.donel/s/<sid>`). */
  readonly sid: string;
  /** The launcher's argv, without `--worktree` (the setup makes the worktree). */
  readonly launcherArgs: readonly string[];
  /** What names the conversation (`--session-id <sid>`, a resume…). */
  readonly extraArgs: readonly string[];
  /** The launcher's argv as it came, kept in `meta.json` (a resume reuses it). */
  readonly launchArgs: readonly string[];
  readonly facts: SpawnFacts;
  /** The role of `facts.roleId`: its text (`null` = gone or unreadable), its scope and the settings already built for this place. */
  readonly role: { readonly promptText: string | null; readonly scope: RoleScope | undefined; readonly scopeSettings: RoleScopeSettings | null };
  /** Hook token and port always go in `meta.json`; `on` = the bridge is up and the hooks are written. */
  readonly hooks: { readonly on: boolean; readonly port: number; readonly token: string; readonly statusLine: StatusLineBridgePlan | null };
  /** The app's MCP through the tunnel (the gate on the place rewrites the URL); `null` = no MCP. */
  readonly mcp: { readonly port: number; readonly token: string } | null;
  readonly localCwd: string;
  readonly projectName: string;
  readonly name: string;
  readonly openedBy?: string;
  readonly createdAt: string;
  /** Project folder relative to `$HOME` on the place. */
  readonly homeRelativeDir: string;
  /** The session's own worktree; an unsafe name is dropped. */
  readonly worktree: string | null;
  readonly repoUrl: string | null;
  readonly branch: string | null;
  /** t-1a3f7150 — the Oráculo daemon opened it with the PC off: its meta says so, and the first message is a file. */
  readonly openedWithoutPc?: boolean;
}

export interface RemoteLaunchPlan {
  /** The files of the session folder (the setup adds `claude.sh`, `run.sh` and `meta.json`). */
  readonly files: readonly RemoteFile[];
  /** The argv of `claude`; `@S/<name>` is a file of the session folder. */
  readonly claudeArgs: readonly string[];
  /** The env the CLI needs (the `claude.sh` writes it from the argv). */
  readonly env: Readonly<Record<string, string>>;
  readonly bypass: boolean;
  readonly meta: RemoteSessionMeta;
  /** What the role could not hand the CLI. */
  readonly roleMissing: readonly RoleLaunchGap[];
  /** The setup script for `folder`; a folder other than `sid` only attaches to its live tmux. */
  setupScript(folder: string): string;
}

/** Pure — the plan of one remote launch. */
export function planRemoteLaunch(input: RemoteLaunchInput): RemoteLaunchPlan {
  const { sid, facts, role } = input;
  const roleId = facts.roleId;
  const files: RemoteFile[] = [];
  const claudeArgs: string[] = [...input.launcherArgs, ...input.extraArgs];

  let remoteRolePath: string | null = null;
  if (roleId && role.promptText !== null) {
    files.push({ name: 'role.md', content: role.promptText });
    remoteRolePath = '@S/role.md';
  }
  // Papel não entregue — the remote settings.json always carries the scope when there is one.
  const rolePlan = planRoleLaunch('claude-code', { roleId, promptPath: remoteRolePath, scope: roleId ? role.scope : undefined, scopeDelivered: role.scopeSettings !== null });
  claudeArgs.push(...rolePlan.args);
  const roleScope = roleId ? role.scopeSettings : null;

  // The session folder holds its keys (`meta.json`, `hook-header`, `mcp.json`, `settings.json`): its tools may not read it.
  const remoteKeyDirs = [`~/${REMOTE_SESSIONS_DIR}`];
  if (input.hooks.on) {
    // The token goes in a file of its own (600, like every file of the session folder): a hook command never carries it.
    const tokenHeaderPath = `$HOME/${REMOTE_SESSIONS_DIR}/${sid}/hook-header`;
    files.push({ name: 'hook-header', content: tokenHeaderFileContent(input.hooks.token) });
    // Letters never lock (owner, 09/11): no offline Slack guard runs as a hook. The file is still written because the
    // Theo West MCP reads its "carta-com-arquivo" mark to offer the file upload.
    files.push({ name: 'slack-guard.sh', content: buildSlackMarkFile() });
    const settings = buildSessionHooksSettings({
      port: input.hooks.port,
      token: input.hooks.token,
      tokenHeaderPath,
      curlPath: 'curl',
      statusLine: input.hooks.statusLine,
      roleScope,
      keyDirs: remoteKeyDirs,
      // t-205b44c8 — which conversation this tmux carries now (a `/clear` moves it on); a resume reads it there.
      conversationMarkPath: `$HOME/${REMOTE_SESSIONS_DIR}/${sid}/current`,
    });
    files.push({ name: 'settings.json', content: `${JSON.stringify(settings, null, 2)}\n` });
  } else {
    // `meta.json` (and `mcp.json`) hold keys even without hooks: the deny rules go in any case.
    files.push({ name: 'settings.json', content: `${JSON.stringify({ ...(roleScope ?? {}), ...keyFilePermissions(remoteKeyDirs) }, null, 2)}\n` });
  }
  claudeArgs.push('--settings', '@S/settings.json');

  const meta: RemoteSessionMeta = {
    sid,
    hookToken: input.hooks.token,
    hookPort: input.hooks.port,
    mcpToken: input.mcp?.token ?? null,
    mcpPort: input.mcp?.port ?? null,
    localCwd: input.localCwd,
    projectName: input.projectName,
    name: input.name,
    launchArgs: input.launchArgs,
    ...(input.openedBy ? { openedBy: input.openedBy } : {}),
    createdAt: input.createdAt,
    // Líder único na VPS — the tab that comes back after a restart is the Líder again (`remoteAliveFromMeta`).
    ...(roleId ? { roleId } : {}),
    ...(facts.leaderOfAll === true ? { leaderOfAll: true } : {}),
    ...(input.openedWithoutPc === true ? { abertaSemPc: true } : {}),
  };
  if (input.mcp) {
    const endpoint = { name: MCP_SERVER_NAME, url: browserMcpUrl(input.mcp.port), bearerToken: input.mcp.token };
    files.push({ name: 'mcp.json', content: `${JSON.stringify(buildBrowserMcpConfig(endpoint), null, 2)}\n` });
    claudeArgs.push(...appMcpAllowArgs(), '--mcp-config', '@S/mcp.json');
  }
  // Super bypass (t-66cb0ce4, t-2a9060dd): every session on a remote place is born in it, new, opened or renewed. The
  // env goes in the claude.sh (`bypassEnvLines`), read from these args.
  const permission = planLaunchPermission(claudeArgs, { ...facts, remote: true }, undefined);
  const finalArgs = permission.args;

  const worktree = input.worktree !== null && isSafeWorktreeName(input.worktree) ? input.worktree : null;
  return {
    files,
    claudeArgs: finalArgs,
    env: permission.env,
    bypass: isBypassLaunch(finalArgs),
    meta,
    roleMissing: roleId ? rolePlan.missing : [],
    setupScript: (folder) =>
      buildRemoteSetupScript({
        sid: folder,
        homeRelativeDir: input.homeRelativeDir,
        ...(worktree !== null ? { worktree } : {}),
        repoUrl: input.repoUrl,
        branch: input.branch,
        files,
        claudeArgs: finalArgs,
        meta,
        ...(folder !== sid ? { attachOnly: true } : {}),
        ...(input.openedWithoutPc === true ? { firstPromptFile: true } : {}),
      }),
  };
}
