import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDiagnosticsLog, DIAGNOSTICS_LOG_FILE_NAME } from '../src/main/chat/diagnostics-log';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-diag-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lines(): Array<Record<string, unknown>> {
  const raw = readFileSync(join(dir, DIAGNOSTICS_LOG_FILE_NAME), 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('diagnostics log', () => {
  it('writes JSONL to chat-diagnostics.log', () => {
    const log = createDiagnosticsLog(dir, () => 1000);
    log.hook({ event: 'PreToolUse', ptyId: 'p1', durationMs: 3 });
    log.sendFailed({ ptyId: 'p1', reason: 'pty-closed' });
    expect(lines()).toEqual([
      { ts: 1000, kind: 'hook', event: 'PreToolUse', ptyId: 'p1', durationMs: 3 },
      { ts: 1000, kind: 'send-failed', ptyId: 'p1', reason: 'pty-closed' },
    ]);
  });

  it('logs unknown-entry once per session and type', () => {
    const log = createDiagnosticsLog(dir, () => 1);
    log.unknownEntry({ ptyId: 'p1', entryType: 'weird' });
    log.unknownEntry({ ptyId: 'p1', entryType: 'weird' });
    log.unknownEntry({ ptyId: 'p1', entryType: 'other' });
    log.unknownEntry({ ptyId: 'p2', entryType: 'weird' });
    expect(lines().map((l) => `${l.ptyId}/${l.entryType}`)).toEqual(['p1/weird', 'p1/other', 'p2/weird']);
  });

  it('never writes extra fields such as conversation content or hook payload', () => {
    const log = createDiagnosticsLog(dir, () => 1);
    log.hook({ event: 'Stop', ptyId: 'p1', durationMs: 1, payload: { secret: 'x' }, content: 'oi' } as never);
    log.sendFailed({ ptyId: 'p1', reason: 'r', text: 'conversa' } as never);
    const raw = readFileSync(join(dir, DIAGNOSTICS_LOG_FILE_NAME), 'utf8');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('conversa');
    expect(raw).not.toContain('"oi"');
  });

  it('never throws when the directory is unwritable', () => {
    const log = createDiagnosticsLog(join(dir, 'missing', 'sub'), () => 1);
    expect(() => log.hook({ event: 'Stop', ptyId: 'p', durationMs: 1 })).not.toThrow();
  });
});
