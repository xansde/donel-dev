// Papel não entregue (ideia do OpenRig 0.7.9: a successor that came up without a required startup file is marked) —
// a launch that asked for a role says what it could not deliver, instead of opening silently without the role or
// with every MCP (a scope that did not reach the CLI widens the session). Pure: the spawn in the main feeds it.

import { roleDeliveryFor, type AgentCli } from './commandBuilder';
import { roleScopeRestricts } from './role-scope';
import type { RoleScope } from './roles';

/** What a launch with a role failed to hand the CLI: the guidance (`papel`) or the scope settings (`escopo`). */
export type RoleLaunchGap = 'papel' | 'escopo';

export interface RoleLaunchInput {
  /** The role the launch carries; `undefined` = none asked. */
  readonly roleId: string | undefined;
  /** The guidance file written for this launch; `null` = the role is gone or the write failed. */
  readonly promptPath: string | null;
  /** The role's scope (MCPs, plugins, skills); only one that restricts something has to reach the CLI. */
  readonly scope: RoleScope | undefined;
  /** The scope reached the CLI (a `--settings` file carrying it was written). */
  readonly scopeDelivered: boolean;
}

export interface RoleLaunchPlan {
  readonly args: readonly string[];
  readonly missing: readonly RoleLaunchGap[];
}

export function planRoleLaunch(cli: AgentCli, input: RoleLaunchInput): RoleLaunchPlan {
  if (!input.roleId) return { args: [], missing: [] };
  const missing: RoleLaunchGap[] = [];
  if (!input.promptPath) missing.push('papel');
  if (roleScopeRestricts(input.scope) && !input.scopeDelivered) missing.push('escopo');
  return { args: input.promptPath ? roleDeliveryFor(cli, input.promptPath).args : [], missing };
}

/** The warning the tab shows (pt-BR, user text); `null` when nothing is missing. */
export function roleLaunchWarning(roleId: string | undefined, missing: readonly RoleLaunchGap[]): string | null {
  if (!roleId || missing.length === 0) return null;
  const role = `"${roleId}"`;
  if (missing.includes('papel') && missing.includes('escopo')) {
    return `Sessão aberta sem o papel ${role} e sem o escopo dele: o texto do papel não foi gravado e a sessão tem todos os MCPs, plugins e skills.`;
  }
  if (missing.includes('papel')) return `Sessão aberta sem o papel ${role}: o papel não existe mais ou o texto dele não foi gravado.`;
  return `Sessão aberta sem o escopo do papel ${role}: as configurações não foram gravadas e a sessão tem todos os MCPs, plugins e skills.`;
}
