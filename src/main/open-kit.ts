// Kit de abertura (t-1a3f7150, fatia 2; docs/adr/0009) — what only the PC knows and the Oráculo daemon on the VPS needs
// to open a session while the PC is off: the roles (their text, scope and launcher args), the board folders (the board
// key, the folder on the place, repo and branch) and `team.openCap`. The app leaves it in `~/.donel/oraculo/abrir.json`
// at each handshake (ledger-remote-host.ts), next to `vigia.json`.
//
// Hard rule: no secret ever goes in the kit — no token, key, password, credential, cookie, OAuth pair or proxy key.
// That is why `buildOpenKit` reads only named fields (never spreads the config) and strips the userinfo of a remote URL
// (`https://x-access-token:<token>@github.com/...` is a common way to clone a private repo). Pure: no I/O, no electron.

import type { AppConfig } from './config-store';
import { remoteDirFor } from './remote-session';
import { MCP_SERVER_NAME } from '../shared/browser/mcp';
import { buildClaudeArgs, DEFAULT_EFFORT_LEVEL, DEFAULT_MODEL_ALIAS, type EffortLevel, type ModelAlias, type PermissionMode } from '../shared/commandBuilder';
import { buildRoleScopeSettings, EMPTY_INVENTORY, roleScopeNeedsInventory, type RoleScopeSettings } from '../shared/role-scope';
import { LEADER_ROLE_ID, rolePromptText, type RoleScope, type SessionRole } from '../shared/roles';

/** The kit's file in `~/.donel/oraculo` on the place of the Oráculo. */
export const OPEN_KIT_FILE = 'abrir.json';
export const OPEN_KIT_VERSION = 1;

export interface OpenKitRole {
  readonly id: string;
  readonly name: string;
  /** `lugar: qualquer` in the role's header. */
  readonly anyPlace: boolean;
  /** What becomes the session's `role.md` (identity + guidance), as the PC writes it. */
  readonly promptText: string;
  readonly model: ModelAlias;
  readonly effort: EffortLevel;
  readonly permissionMode: PermissionMode;
  /** The launcher's argv for this role, without name and worktree (the opener adds `-n`; the setup makes the worktree). */
  readonly launcherArgs: readonly string[];
  readonly scope?: RoleScope;
  /**
   * The scope's `--settings` keys when they need no inventory; `null` with `scopeNeedsInventory` = the daemon builds
   * them with the place's own plugins and skills (`buildRoleScopeSettings`, pure), as the PC does by ssh.
   */
  readonly scopeSettings: RoleScopeSettings | null;
  readonly scopeNeedsInventory: boolean;
}

export interface OpenKitBoard {
  /** The board key: the project folder on the PC (`localCwd` of the session's `meta.json`). */
  readonly localCwd: string;
  readonly name: string;
  /** The project folder on the place, relative to `$HOME` (`remoteDirFor`). */
  readonly homeRelativeDir: string;
  /** `origin` without any user or password; `null` = none. */
  readonly repoUrl: string | null;
  readonly branch: string | null;
}

export interface OpenKit {
  readonly version: typeof OPEN_KIT_VERSION;
  /** When the PC wrote it (ISO). */
  readonly at: string;
  /** The place this kit was written to (the Oráculo's), as the PC names it. */
  readonly place: { readonly id: string; readonly label: string };
  /** `team.openCap`: live sessions a Líder may have opened per board; `null` = no limit. */
  readonly openCap: number | null;
  readonly roles: readonly OpenKitRole[];
  readonly boards: readonly OpenKitBoard[];
}

export interface OpenKitInput {
  /** Only `projectRoots`, `launcherDefaults`, `team` and the provider ids are read. */
  readonly config: Pick<AppConfig, 'projectRoots' | 'launcherDefaults' | 'team' | 'providers'>;
  readonly roles: readonly SessionRole[];
  /** The boards of the Mindscape, with the git facts of each folder on the PC. */
  readonly boards: readonly { readonly localCwd: string; readonly git: { readonly repoUrl: string | null; readonly branch: string | null } }[];
  readonly place: { readonly id: string; readonly label: string };
  readonly now: Date;
}

/**
 * Pure — a remote URL without its userinfo when it can carry a secret: every user of http(s) (a token alone is a
 * user there) and any `user:password`. `ssh://git@host/...` and `git@host:owner/repo` keep their user (no secret).
 */
export function stripUrlCredentials(url: string | null): string | null {
  if (url === null) return null;
  const trimmed = url.trim();
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/@]*)@(.*)$/i.exec(trimmed);
  if (!match) return trimmed.length > 0 ? trimmed : null;
  const [, scheme, userinfo, rest] = match as unknown as [string, string, string, string];
  const http = /^https?:\/\//i.test(scheme);
  return http || userinfo.includes(':') ? `${scheme}${rest}` : trimmed;
}

const folderName = (path: string): string => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;

/** Pure — the kit of abrir.json. */
export function buildOpenKit(input: OpenKitInput): OpenKit {
  const { config } = input;
  const defaults = config.launcherDefaults;
  const providerIds = new Set(config.providers.entries.map((entry) => entry.id));
  const roles: OpenKitRole[] = [];
  for (const role of input.roles) {
    // Only the Líder único opens a Líder (never without the PC); a provider's role does not run on a remote place.
    if (role.id === LEADER_ROLE_ID) continue;
    if (role.engine && providerIds.has(role.engine)) continue;
    const model = role.model ?? defaults.model ?? DEFAULT_MODEL_ALIAS;
    const effort = role.effort ?? defaults.effort ?? DEFAULT_EFFORT_LEVEL;
    const permissionMode = role.permissionMode ?? defaults.permissionMode ?? 'acceptEdits';
    const needsInventory = roleScopeNeedsInventory(role.scope);
    roles.push({
      id: role.id,
      name: role.name,
      anyPlace: role.anyPlace === true,
      promptText: rolePromptText(role),
      model,
      effort,
      permissionMode,
      launcherArgs: buildClaudeArgs({ model, effort, permissionMode }),
      ...(role.scope ? { scope: role.scope } : {}),
      scopeSettings: needsInventory ? null : buildRoleScopeSettings(role.scope, EMPTY_INVENTORY, MCP_SERVER_NAME),
      scopeNeedsInventory: needsInventory,
    });
  }
  const boards = input.boards.map(
    (board): OpenKitBoard => ({
      localCwd: board.localCwd,
      name: folderName(board.localCwd),
      homeRelativeDir: remoteDirFor(board.localCwd, config.projectRoots),
      repoUrl: stripUrlCredentials(board.git.repoUrl),
      branch: board.git.branch,
    }),
  );
  return {
    version: OPEN_KIT_VERSION,
    at: input.now.toISOString(),
    place: { id: input.place.id, label: input.place.label },
    openCap: config.team.openCap,
    roles,
    boards,
  };
}

/**
 * Pure — the lines of the handshake that leave the kit (after its `umask 077`; `$d` = `~/.donel/oraculo`). Base64, so
 * no quoting can break it; the temp file is chmod 600 before the rename, also when an old one was there with another
 * mode (a redirect keeps the mode of a file that exists).
 */
export function openKitScriptLines(kit: OpenKit): string[] {
  const tmp = `"$d/${OPEN_KIT_FILE}.tmp"`;
  return [
    `printf '%s' '${Buffer.from(JSON.stringify(kit), 'utf8').toString('base64')}' | base64 -d > ${tmp}`,
    `chmod 600 ${tmp}`,
    `mv -f ${tmp} "$d/${OPEN_KIT_FILE}"`,
  ];
}
