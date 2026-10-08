// T021 (014-chat) - classification of ONE transcript line,
// specs/014-chat/contracts/conversation-rows.md §2 (precedence order). Pure.
//
// `classifyLine` never throws. It returns:
//   - `null`   -> the line is discarded (sidechain, noise attachment);
//   - `invalid`-> not JSON / too large (rule 0);
//   - `meta`   -> metadata line without uuid (rule 1);
//   - `node`   -> user / assistant / system / attachment (rules 4-7); finer
//                 routing (§2.1-§2.4) is the adapter's job, EXCEPT unrecognised
//                 `attachment.type` / `system.subtype`, flagged via `unknownLabel`;
//   - `unknown`-> any other top-level `type` (rule 8).
// Unrecognised attachment/system lines stay `node`s on purpose: dropping them
// would break the `parentUuid` chain of every line that hangs off them.

import type { LineRef, TranscriptEntry, TranscriptNodeRole } from './rows';

/** Lines larger than this are never parsed (rule 0). */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

const META_TYPES: ReadonlySet<string> = new Set([
  'permission-mode', 'last-prompt', 'custom-title', 'ai-title', 'agent-name', 'mode', 'cost-state', 'pr-link',
  'queue-operation', 'file-history-snapshot', 'file-history-delta', 'bridge-session', 'atis-latch', 'history-suppression',
]);

/** conversation-rows.md §6. `session_context` and `credential_org` carry account data. */
const NOISE_ATTACHMENTS: ReadonlySet<string> = new Set([
  'hook_success', 'hook_additional_context', 'total_tokens_reminder', 'deferred_tools_record', 'deferred_tools_delta',
  'prompt_snapshot', 'environment', 'date', 'model', 'language', 'instructions', 'session_context', 'credential_org',
  'auto_mode', 'remote_session_change', 'thinking_drop', 'structured_output', 'command_permissions',
  'agent_listing_delta', 'mcp_instructions_delta', 'nested_memory',
]);

/** conversation-rows.md §2.1. */
const KNOWN_ATTACHMENTS: ReadonlySet<string> = new Set([
  'queued_command', 'file', 'plan_mode', 'edited_text_file', 'task_status', 'hook_non_blocking_error',
  'hook_system_message', 'hook_permission_decision', 'skill_listing',
]);

/** conversation-rows.md §2.2. */
const KNOWN_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
  'compact_boundary', 'turn_duration', 'local_command', 'informational', 'stop_hook_summary',
]);

const NODE_ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'system', 'attachment']);

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function classifyLine(raw: string, lineRef: LineRef): TranscriptEntry | null {
  // Rule 0 - size is judged by the on-disk length, so the pager can skip reading the body.
  if (lineRef.length > MAX_LINE_BYTES) return { k: 'invalid', reason: 'too-large', raw: lineRef };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { k: 'invalid', reason: 'json', raw: lineRef };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { k: 'invalid', reason: 'json', raw: lineRef };
  }
  const data = parsed as Json;
  const type = str(data.type);
  const uuid = str(data.uuid);

  // Rule 1 - metadata (no uuid).
  if (uuid === null && type !== null && META_TYPES.has(type)) {
    return { k: 'meta', type, payload: data };
  }

  // Rule 2 - sidechain lines live in the subagent's own file.
  if (data.isSidechain === true) return null;

  const attachmentType =
    type === 'attachment' && data.attachment !== null && typeof data.attachment === 'object'
      ? str((data.attachment as Json).type)
      : null;

  // Rule 3 - noise attachments, BEFORE any `unknown` is recorded (privacy: the
  // account attachments must never reach the raw block).
  if (attachmentType !== null && NOISE_ATTACHMENTS.has(attachmentType)) return null;

  const parentUuid = str(data.parentUuid);

  if (type !== null && uuid !== null && NODE_ROLES.has(type)) {
    const logical = str(data.logicalParentUuid);
    let unknownLabel: string | undefined;
    if (type === 'attachment' && (attachmentType === null || !KNOWN_ATTACHMENTS.has(attachmentType))) {
      unknownLabel = `attachment:${attachmentType ?? '?'}`;
    } else if (type === 'system') {
      const subtype = str(data.subtype);
      if (subtype === null || !KNOWN_SYSTEM_SUBTYPES.has(subtype)) unknownLabel = `system:${subtype ?? '?'}`;
    }
    return {
      k: 'node',
      uuid,
      parentUuid,
      ...(logical !== null ? { logicalParentUuid: logical } : {}),
      role: type as TranscriptNodeRole,
      at: str(data.timestamp) ?? '',
      raw: lineRef,
      data,
      ...(unknownLabel !== undefined ? { unknownLabel } : {}),
    };
  }

  // Rule 8 - anything else.
  return { k: 'unknown', typeLabel: type ?? '?', uuid, parentUuid, raw: lineRef, data };
}

/**
 * Cheap text test (no JSON.parse) for "this line opens a round": a user line
 * typed by the human (not a tool_result, not meta). Used by the pager to count
 * rounds per page (R11: 30 rounds). Over-counting only makes pages smaller.
 */
export function isRoundOpenerLine(raw: string): boolean {
  if (raw.length > 65536) return false;
  if (!raw.includes('"type":"user"')) return false;
  if (raw.includes('"isMeta":true') || raw.includes('"isCompactSummary":true')) return false;
  return raw.includes('"turnOrigin":"human"') || raw.includes('"promptSource":"typed"') || raw.includes('"promptSource":"queued"');
}
