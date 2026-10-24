import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractTranscriptTail, readTranscriptLastAssistantText } from '../src/main/transcript-watcher';

// Mindscape, fatia 03 — fallback of the post-it written by the session: when the
// `Stop` hook comes without `last_assistant_message`, the text is the last
// assistant message of the `.jsonl` tail.

function assistant(content: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content }, ...extra });
}

function user(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
}

describe('extractTranscriptTail — lastAssistantText', () => {
  it('returns the text of the last assistant message of the tail', () => {
    const tail = [
      '{"cut in the mid',
      user('oi'),
      assistant([{ type: 'text', text: 'primeira' }]),
      user('de novo'),
      assistant([{ type: 'text', text: 'Resposta final.' }]),
      JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 10 }),
      '',
    ].join('\n');
    expect(extractTranscriptTail(tail).lastAssistantText).toBe('Resposta final.');
  });

  it('skips assistant lines with only tool_use/thinking and joins the text blocks', () => {
    const tail = [
      assistant([
        { type: 'text', text: 'linha um' },
        { type: 'text', text: 'linha dois' },
      ]),
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
      assistant([{ type: 'thinking', thinking: 'hmm' }]),
    ].join('\n');
    expect(extractTranscriptTail(tail).lastAssistantText).toBe('linha um\nlinha dois');
  });

  it('ignores sidechain (subagent) lines and returns null when there is no text', () => {
    expect(extractTranscriptTail(assistant([{ type: 'text', text: 'sub' }], { isSidechain: true })).lastAssistantText).toBeNull();
    expect(extractTranscriptTail(user('só usuário')).lastAssistantText).toBeNull();
    expect(extractTranscriptTail('').lastAssistantText).toBeNull();
  });
});

describe('readTranscriptLastAssistantText', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads only the tail of the file; missing file → null', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tail-last-assistant-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(file, `${user('oi')}\n${assistant([{ type: 'text', text: 'Da cauda.' }])}\n`, 'utf8');
    await expect(readTranscriptLastAssistantText(file)).resolves.toBe('Da cauda.');
    await expect(readTranscriptLastAssistantText(join(dir, 'nope.jsonl'))).resolves.toBeNull();
  });
});
