// 014-chat (T075) — pending queue (FR-035), PermissionRequest → Pending and the translation of the owner's
// answer into the hook decision (`contracts/hook-bridge.md` §3). Pure.

import type { PendingAnswer } from './ipc';
import type {
  PermissionSuggestion,
  Pending,
  PendingScope,
  PendingState,
  Question,
} from './rows';

const DEFAULT_DENY_MESSAGE = 'Negado pelo dono no Donel.';
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit']);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function prefixLines(text: string, prefix: string): string[] {
  if (text === '') return [];
  return text.split(/\r?\n/).map((line) => prefix + line);
}

/**
 * D-C14: diff straight from the tool input — old lines as `-`, new lines as `+`, no LCS, no line numbers.
 * `Write` is all `+`; other tools have no diff.
 */
export function permissionDiff(toolName: string, toolInput: Record<string, unknown>): string | undefined {
  if (toolName === 'Write') {
    return prefixLines(asString(toolInput.content), '+').join('\n');
  }
  if (!EDIT_TOOLS.has(toolName)) return undefined;
  const edits: Record<string, unknown>[] =
    toolName === 'MultiEdit' && Array.isArray(toolInput.edits)
      ? toolInput.edits.map(asRecord)
      : [toolInput];
  const lines: string[] = [];
  for (const edit of edits) {
    lines.push(...prefixLines(asString(edit.old_string), '-'), ...prefixLines(asString(edit.new_string), '+'));
  }
  return lines.join('\n');
}

export function pendingFromRequest(input: {
  id: string;
  payload: Record<string, unknown>;
  toolUseId: string | null;
  arrivedAt: string;
  scope: PendingScope;
}): Pending {
  const { payload } = input;
  const toolName = asString(payload.tool_name);
  const toolInput = asRecord(payload.tool_input);
  const agentId = typeof payload.agent_id === 'string' && payload.agent_id !== '' ? payload.agent_id : undefined;
  const base = {
    id: input.id,
    match: { ...(agentId !== undefined ? { agentId } : {}), toolName, toolInput },
    toolUseId: input.toolUseId,
    scope: input.scope,
    arrivedAt: input.arrivedAt,
    state: 'open' as const,
  };
  if (toolName === 'AskUserQuestion') {
    const questions = Array.isArray(toolInput.questions) ? (toolInput.questions as Question[]) : [];
    return { ...base, kind: 'question', payload: { questions } };
  }
  if (toolName === 'ExitPlanMode') {
    return { ...base, kind: 'plan', payload: { markdown: asString(toolInput.plan) } };
  }
  const diff = permissionDiff(toolName, toolInput);
  const suggestions = Array.isArray(payload.permission_suggestions)
    ? (payload.permission_suggestions as PermissionSuggestion[])
    : undefined;
  return {
    ...base,
    kind: 'permission',
    payload: {
      toolName,
      toolInput,
      ...(diff !== undefined ? { diff } : {}),
      ...(suggestions !== undefined ? { permissionSuggestions: suggestions } : {}),
    },
  };
}

function allowAlwaysPermissions(toolName: string, suggestions: readonly PermissionSuggestion[] | undefined) {
  const rules = (suggestions ?? [])
    .filter((s) => s.type === 'addRules')
    .map((s) => ({ ...s, destination: 'localSettings' }));
  if (rules.length > 0) return rules;
  return [{ type: 'addRules', rules: [{ toolName }], behavior: 'allow', destination: 'localSettings' }];
}

/** The `decision` object (D) of hook-bridge §3 — not the `hookSpecificOutput` wrapper. */
export function toHookDecision(pending: Pending, answer: PendingAnswer): Record<string, unknown> {
  const bad = (): never => {
    throw new Error(`invalid answer "${answer.kind}" for pending of kind "${pending.kind}"`);
  };
  switch (answer.kind) {
    case 'interrupt':
      return { behavior: 'deny', interrupt: true };
    case 'allow':
      return pending.kind === 'permission' ? { behavior: 'allow' } : bad();
    case 'allow-always':
      return pending.kind === 'permission'
        ? {
            behavior: 'allow',
            updatedPermissions: allowAlwaysPermissions(pending.payload.toolName, pending.payload.permissionSuggestions),
          }
        : bad();
    case 'deny':
      return { behavior: 'deny', message: answer.reason?.trim() || DEFAULT_DENY_MESSAGE };
    case 'answers':
      if (pending.kind !== 'question') return bad();
      // CLI 2.1.314 takes the owner's note per question as `annotations[question].notes` and shows it to the model
      // as `"question"="answer" notes: ...`. No note = no `annotations` key, the payload of before.
      return {
        behavior: 'allow',
        updatedInput: {
          ...pending.match.toolInput,
          answers: answer.answers,
          ...(answer.annotations !== undefined && Object.keys(answer.annotations).length > 0
            ? { annotations: answer.annotations }
            : {}),
        },
      };
    case 'plan-approve':
      return pending.kind === 'plan' ? { behavior: 'allow', updatedInput: { ...pending.match.toolInput } } : bad();
    case 'plan-adjust':
      return pending.kind === 'plan' ? { behavior: 'deny', message: answer.text } : bad();
  }
}

export function pendingQueueView(pendings: readonly Pending[]): { head: Pending | null; waiting: number } {
  const open = pendings.filter((p) => p.state === 'open');
  let head: Pending | null = null;
  for (const p of open) {
    if (head === null || Date.parse(p.arrivedAt) < Date.parse(head.arrivedAt)) head = p;
  }
  return { head, waiting: Math.max(0, open.length - 1) };
}

export function closePending(p: Pending, state: Exclude<PendingState, 'open'>): Pending {
  return p.state === 'open' ? { ...p, state } : p;
}
