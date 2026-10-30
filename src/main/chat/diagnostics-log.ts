import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeSendFailure, type SendFailureDetail } from '../../shared/chat/sendDiagnostics';

// T009 — JSONL diagnostics for the chat. Records only event names, ptyId,
// durations and short reasons; never conversation content or hook payloads
// (contracts/hook-bridge.md §6). Every field is whitelisted explicitly.
//
// `send-failed` also carries the gate detail of the failed send (`SendFailureDetail`: step, last wait, box
// found, footer, working, attempts...). It goes through `sanitizeSendFailure`, the field-by-field whitelist:
// booleans, counts and the machine's fixed reasons only, never message or screen text.

export const DIAGNOSTICS_LOG_FILE_NAME = 'chat-diagnostics.log';

export interface DiagnosticsLog {
  hook(entry: { event: string; ptyId: string; durationMs: number }): void;
  unknownEntry(entry: { ptyId: string; entryType: string }): void;
  sendFailed(entry: { ptyId: string; reason: string; detail?: SendFailureDetail }): void;
}

/** `dir` is injected (the app passes `app.getPath('userData')`); `now` is injectable for tests. Writing never throws. */
export function createDiagnosticsLog(dir: string, now: () => number = Date.now): DiagnosticsLog {
  const file = join(dir, DIAGNOSTICS_LOG_FILE_NAME);
  const seenUnknown = new Set<string>();

  function write(record: Record<string, unknown>): void {
    try {
      appendFileSync(file, `${JSON.stringify({ ts: now(), ...record })}\n`, 'utf8');
    } catch {
      // diagnostics must never break the app
    }
  }

  return {
    hook: ({ event, ptyId, durationMs }) => write({ kind: 'hook', event, ptyId, durationMs }),
    unknownEntry: ({ ptyId, entryType }) => {
      const key = `${ptyId}\u0000${entryType}`;
      if (seenUnknown.has(key)) return;
      seenUnknown.add(key);
      write({ kind: 'unknown-entry', ptyId, entryType });
    },
    sendFailed: ({ ptyId, reason, detail }) => {
      const clean = detail === undefined ? null : sanitizeSendFailure(detail);
      if (clean === null) {
        write({ kind: 'send-failed', ptyId, reason });
        return;
      }
      // The record's `reason` is the caller's; the detail's own copy is dropped.
      const gate: Record<string, unknown> = { ...clean };
      delete gate.reason;
      write({ kind: 'send-failed', ptyId, reason, ...gate });
    },
  };
}
