// T020 (014-chat) - classification of one transcript line,
// contracts/conversation-rows.md §2 (precedence order).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineRef, TranscriptEntry } from '../src/shared/chat/rows';
import { classifyLine, MAX_LINE_BYTES } from '../src/shared/chat/transcriptEntry';

const FIXTURES = join(__dirname, 'fixtures', 'chat');

function ref(raw: string, offset = 0): LineRef {
  return { path: 'fake.jsonl', offset, length: Buffer.byteLength(raw) };
}

function classify(obj: unknown): TranscriptEntry | null {
  const raw = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return classifyLine(raw, ref(raw));
}

const NODE = { uuid: 'u-1', parentUuid: 'u-0', timestamp: '2026-10-01T12:00:00.000Z', isSidechain: false };

describe('classifyLine - rule 0: invalid and too large', () => {
  it('returns invalid/json for text that is not JSON', () => {
    const e = classify('{"type":"user", ');
    expect(e).toMatchObject({ k: 'invalid', reason: 'json' });
  });

  it('returns invalid/json for JSON that is not an object', () => {
    expect(classify('123')).toMatchObject({ k: 'invalid', reason: 'json' });
    expect(classify('[1,2]')).toMatchObject({ k: 'invalid', reason: 'json' });
    expect(classify('null')).toMatchObject({ k: 'invalid', reason: 'json' });
  });

  it('returns invalid/too-large when the line is larger than 8 MB, without parsing', () => {
    const lineRef: LineRef = { path: 'f', offset: 10, length: MAX_LINE_BYTES + 1 };
    // text is irrelevant (the pager does not even hand it over for huge lines)
    expect(classifyLine('', lineRef)).toEqual({ k: 'invalid', reason: 'too-large', raw: lineRef });
  });

  it('accepts a line of exactly 8 MB', () => {
    const lineRef: LineRef = { path: 'f', offset: 0, length: MAX_LINE_BYTES };
    expect(classifyLine('{"type":"mode"}', lineRef)).toMatchObject({ k: 'meta' });
  });

  it('keeps the LineRef on invalid entries', () => {
    const raw = 'not json';
    const lineRef = ref(raw, 77);
    expect(classifyLine(raw, lineRef)).toEqual({ k: 'invalid', reason: 'json', raw: lineRef });
  });
});

describe('classifyLine - rule 1: metadata', () => {
  const metaTypes = [
    'permission-mode', 'last-prompt', 'custom-title', 'ai-title', 'agent-name', 'mode', 'cost-state', 'pr-link',
    'queue-operation', 'file-history-snapshot', 'file-history-delta', 'bridge-session', 'atis-latch', 'history-suppression',
  ];
  for (const type of metaTypes) {
    it(`classifies ${type} without uuid as meta and keeps the payload`, () => {
      const obj = { type, sessionId: 's', extra: 1 };
      expect(classify(obj)).toEqual({ k: 'meta', type, payload: obj });
    });
  }

  it('does not treat a metadata type WITH uuid as meta (falls to the generic rule)', () => {
    const e = classify({ type: 'mode', uuid: 'u-9', parentUuid: null });
    expect(e).toMatchObject({ k: 'unknown', typeLabel: 'mode', uuid: 'u-9' });
  });
});

describe('classifyLine - rule 2: sidechain', () => {
  it('discards isSidechain:true in the main file', () => {
    expect(classify({ ...NODE, type: 'user', isSidechain: true, message: { role: 'user', content: 'x' } })).toBeNull();
  });

  it('discards sidechain even when it would otherwise be noise or unknown', () => {
    expect(classify({ ...NODE, type: 'future', isSidechain: true })).toBeNull();
  });

  it('keeps isSidechain:false', () => {
    expect(classify({ ...NODE, type: 'user', message: { role: 'user', content: 'x' } })).toMatchObject({ k: 'node' });
  });
});

describe('classifyLine - rule 3: noise attachments are discarded before unknown', () => {
  const noise = [
    'hook_success', 'hook_additional_context', 'total_tokens_reminder', 'deferred_tools_record', 'deferred_tools_delta',
    'prompt_snapshot', 'environment', 'date', 'model', 'language', 'instructions', 'session_context', 'credential_org',
    'auto_mode', 'remote_session_change', 'thinking_drop', 'structured_output', 'command_permissions',
    'agent_listing_delta', 'mcp_instructions_delta', 'nested_memory',
  ];
  for (const t of noise) {
    it(`reduces attachment ${t} to a link-only noise node (never unknown)`, () => {
      const e = classify({ ...NODE, type: 'attachment', attachment: { type: t, email: 'fake@example.invalid' } });
      expect(e).toMatchObject({ k: 'node', role: 'attachment', noise: true, uuid: 'u-1', parentUuid: 'u-0' });
      expect((e as { data: unknown }).data).toEqual({ type: 'attachment', attachment: { type: t } });
    });
  }

  it('drops a noise attachment that has no uuid (nothing to link)', () => {
    expect(classify({ type: 'attachment', attachment: { type: 'date' } })).toBeNull();
  });

  it('never exposes session_context / credential_org data (privacy, FR-031)', () => {
    for (const t of ['session_context', 'credential_org']) {
      const e = classify({ ...NODE, type: 'attachment', attachment: { type: t, token: 'FAKE-TOKEN', email: 'a@b.invalid' } });
      expect(JSON.stringify(e)).not.toContain('FAKE-TOKEN');
      expect(JSON.stringify(e)).not.toContain('a@b.invalid');
    }
  });
});

describe('classifyLine - rule 4/5/6: nodes', () => {
  it('classifies recognised attachments as nodes with role attachment', () => {
    const types = ['queued_command', 'file', 'plan_mode', 'edited_text_file', 'task_status', 'hook_non_blocking_error', 'hook_system_message', 'hook_permission_decision', 'skill_listing'];
    for (const t of types) {
      const e = classify({ ...NODE, type: 'attachment', attachment: { type: t } });
      expect(e).toMatchObject({ k: 'node', role: 'attachment', uuid: 'u-1', parentUuid: 'u-0' });
      expect((e as { unknownLabel?: string }).unknownLabel).toBeUndefined();
    }
  });

  it('keeps an unrecognised attachment as a node, labelled for the adapter (chain stays intact)', () => {
    const e = classify({ ...NODE, type: 'attachment', attachment: { type: 'future_attachment' } });
    expect(e).toMatchObject({ k: 'node', role: 'attachment', unknownLabel: 'attachment:future_attachment' });
  });

  it('classifies system subtypes and labels unknown ones', () => {
    for (const subtype of ['compact_boundary', 'turn_duration', 'local_command', 'informational', 'stop_hook_summary']) {
      const e = classify({ ...NODE, type: 'system', subtype });
      expect(e).toMatchObject({ k: 'node', role: 'system' });
      expect((e as { unknownLabel?: string }).unknownLabel).toBeUndefined();
    }
    expect(classify({ ...NODE, type: 'system', subtype: 'future_subtype' })).toMatchObject({
      k: 'node', role: 'system', unknownLabel: 'system:future_subtype',
    });
  });

  it('keeps user and assistant as nodes with parsed data and timestamp', () => {
    const u = classify({ ...NODE, type: 'user', message: { role: 'user', content: 'oi' } });
    expect(u).toMatchObject({ k: 'node', role: 'user', at: NODE.timestamp });
    const a = classify({ ...NODE, uuid: 'u-2', parentUuid: 'u-1', type: 'assistant', message: { id: 'm', content: [] } });
    expect(a).toMatchObject({ k: 'node', role: 'assistant', uuid: 'u-2', parentUuid: 'u-1' });
    expect((a as { data: Record<string, unknown> }).data.message).toEqual({ id: 'm', content: [] });
  });

  it('carries logicalParentUuid for a compaction boundary (parentUuid null)', () => {
    const e = classify({ ...NODE, parentUuid: null, type: 'system', subtype: 'compact_boundary', logicalParentUuid: 'u-prev' });
    expect(e).toMatchObject({ k: 'node', parentUuid: null, logicalParentUuid: 'u-prev' });
  });

  it('normalises a missing parentUuid to null and a missing timestamp to empty', () => {
    const e = classify({ uuid: 'u-5', type: 'user', message: { role: 'user', content: 'x' } });
    expect(e).toMatchObject({ k: 'node', parentUuid: null, at: '' });
  });

  it('keeps the LineRef of the line', () => {
    const raw = JSON.stringify({ ...NODE, type: 'user', message: { role: 'user', content: 'x' } });
    const lineRef = ref(raw, 4096);
    expect(classifyLine(raw, lineRef)).toMatchObject({ raw: lineRef });
  });
});

describe('classifyLine - rule 8: unknown', () => {
  it('returns unknown with the type as label for an unrecognised top-level type', () => {
    const e = classify({ ...NODE, type: 'future_type', payload: 'x' });
    expect(e).toMatchObject({ k: 'unknown', typeLabel: 'future_type', uuid: 'u-1', parentUuid: 'u-0' });
  });

  it('returns unknown for a line without type', () => {
    expect(classify({ foo: 1 })).toMatchObject({ k: 'unknown', typeLabel: '?', uuid: null });
  });

  it('returns unknown for a node type without uuid', () => {
    expect(classify({ type: 'assistant', message: {} })).toMatchObject({ k: 'unknown', typeLabel: 'assistant', uuid: null });
  });
});

describe('classifyLine - precedence', () => {
  it('metadata (rule 1) wins over sidechain (rule 2)', () => {
    expect(classify({ type: 'mode', isSidechain: true })).toMatchObject({ k: 'meta' });
  });

  it('sidechain (rule 2) wins over noise (rule 3) - discards, no entry', () => {
    expect(classify({ ...NODE, isSidechain: true, type: 'attachment', attachment: { type: 'date' } })).toBeNull();
  });

  it('too large (rule 0) wins over everything, even sidechain', () => {
    const lineRef: LineRef = { path: 'f', offset: 0, length: MAX_LINE_BYTES + 5 };
    expect(classifyLine(JSON.stringify({ ...NODE, isSidechain: true, type: 'user' }), lineRef)).toMatchObject({ reason: 'too-large' });
  });
});

describe('classifyLine - over the fixtures', () => {
  function classifyFile(name: string): { entries: TranscriptEntry[]; dropped: number } {
    const buf = readFileSync(join(FIXTURES, name));
    const entries: TranscriptEntry[] = [];
    let dropped = 0;
    let offset = 0;
    for (const part of buf.toString('latin1').split('\n')) {
      const length = Buffer.byteLength(part, 'latin1');
      if (part !== '') {
        const text = Buffer.from(part, 'latin1').toString('utf8');
        const e = classifyLine(text, { path: name, offset, length });
        if (e === null) dropped += 1;
        else entries.push(e);
      }
      offset += length + 1;
    }
    return { entries, dropped };
  }

  it('errors-noise: no account data survives, sidechain/noise dropped, unknowns surfaced', () => {
    const { entries, dropped } = classifyFile('errors-noise.jsonl');
    expect(dropped).toBe(1); // the leaked sidechain line; the 21 noise attachments stay as link-only nodes
    expect(entries.filter((e) => e.k === 'node' && e.noise === true)).toHaveLength(21);
    const blob = JSON.stringify(entries);
    expect(blob).not.toContain('fake.user@example.invalid');
    expect(blob).not.toContain('FAKE-ORG-TOKEN-0000');
    expect(blob).not.toContain('acct-fake-0000');
    expect(entries.some((e) => e.k === 'invalid' && e.reason === 'json')).toBe(true);
    expect(entries.some((e) => e.k === 'unknown' && e.typeLabel === 'future_type')).toBe(true);
    expect(entries.filter((e) => e.k === 'meta').length).toBeGreaterThanOrEqual(10);
  });

  it('basic-round: every kept line is a node or meta', () => {
    const { entries } = classifyFile('basic-round.jsonl');
    expect(entries.every((e) => e.k === 'node' || e.k === 'meta')).toBe(true);
  });

  it('edge-big-line: the 1 MB line is still a node', () => {
    const { entries } = classifyFile('edge-big-line.jsonl');
    expect(entries.every((e) => e.k === 'node')).toBe(true);
  });
});
