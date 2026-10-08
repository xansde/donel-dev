// T064 (014-chat) - sinais de aceite do envio extraidos do transcript e do anel
// de UserPromptSubmit (contracts/send-protocol.md §5/§7). Puro.
import { describe, expect, it } from 'vitest';
import { createSubmitRing, lookupAck, normalizeForMatch, signalsFromEntries, type PromptSignal } from '../src/main/chat/prompt-signals';
import type { TranscriptEntry } from '../src/shared/chat/rows';

const ref = { path: 'x', offset: 0, length: 1 } as never;
const AT = '2026-10-08T10:00:00.000Z';

function node(role: 'user' | 'system' | 'attachment', data: Record<string, unknown>): TranscriptEntry {
  return { k: 'node', uuid: Math.random().toString(36), parentUuid: null, role, at: AT, raw: ref, data: { type: role, ...data } } as TranscriptEntry;
}
const user = (content: unknown, extra: Record<string, unknown> = {}): TranscriptEntry =>
  node('user', { message: { role: 'user', content }, turnOrigin: 'human', promptSource: 'typed', ...extra });
const queueOp = (operation: string, content?: string): TranscriptEntry =>
  ({ k: 'meta', type: 'queue-operation', payload: { type: 'queue-operation', operation, timestamp: AT, ...(content !== undefined ? { content } : {}) } }) as TranscriptEntry;

describe('normalizeForMatch', () => {
  it('unwraps pasted_content, CRLF, TAB, borders and [Image #N]', () => {
    expect(normalizeForMatch('  a\r\nb\tc  ')).toBe('a\nb    c');
    expect(normalizeForMatch('x\n\n<pasted_content id="1">linha1\nlinha2</pasted_content id="1">\n')).toBe('x\n\nlinha1\nlinha2');
    expect(normalizeForMatch('veja [Image #3] agora')).toBe(normalizeForMatch('veja [Image #1] agora'));
  });
});

describe('signalsFromEntries', () => {
  it('maps the transcript shapes of the send protocol', () => {
    const out = signalsFromEntries([
      queueOp('enqueue', 'depois'),
      queueOp('remove'),
      node('attachment', { attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'depois', humanTurn: true } }),
      user('ola'),
      user('<command-name>/model</command-name><command-message>model</command-message><command-args>opus</command-args>'),
      user('<bash-input>ls -la</bash-input>'),
      node('system', { subtype: 'local_command', commandRun: { command: '/cost', args: '' } }),
      node('system', { subtype: 'compact_boundary' }),
      node('system', { subtype: 'informational', content: 'Unknown command: /naoexiste' }),
    ]);
    expect(out.map((s) => s.signal)).toEqual(['enqueue', 'deliver', 'submit', 'command', 'shell', 'local', 'compact', 'unknown-command']);
    expect(out[0]!.text).toBe('depois');
    expect(out[3]!.text).toBe('/model opus');
    expect(out[4]!.text).toBe('ls -la');
    expect(out[7]!.text).toBe('/naoexiste');
    expect(out.every((s) => s.origin === 'transcript')).toBe(true);
  });

  it('ignores tool results, meta user lines and task notifications', () => {
    const out = signalsFromEntries([
      user([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }], { turnOrigin: undefined, promptSource: undefined }),
      user('<local-command-stdout>x</local-command-stdout>', { isMeta: true }),
      node('attachment', { attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: 'x' } }),
    ]);
    expect(out).toEqual([]);
  });
});

describe('lookupAck', () => {
  const sig = (signal: PromptSignal['signal'], text: string | undefined, at = AT): PromptSignal => ({ signal, text, at, origin: 'transcript' });

  it('finds a late UserPromptSubmit with the same normalized text since the cutoff', () => {
    const ring = createSubmitRing(20);
    ring.push({ text: 'oi\r\nmundo', at: AT });
    expect(lookupAck(ring.items(), [], 'oi\nmundo', '2026-10-08T09:59:00.000Z')).toEqual({ matched: true, via: 'UserPromptSubmit' });
    expect(lookupAck(ring.items(), [], 'oi\nmundo', '2026-10-08T10:00:01.000Z')).toEqual({ matched: false });
  });

  it('keeps only the last 20 submits', () => {
    const ring = createSubmitRing(20);
    for (let i = 0; i < 25; i += 1) ring.push({ text: `p${i}`, at: AT });
    expect(ring.items()).toHaveLength(20);
    expect(ring.items()[0]!.text).toBe('p5');
  });

  it('matches transcript signals by kind', () => {
    expect(lookupAck([], [sig('deliver', 'fila')], 'fila', AT)).toEqual({ matched: true, via: 'deliver' });
    expect(lookupAck([], [sig('shell', 'ls')], '!ls', AT)).toEqual({ matched: true, via: 'shell' });
    expect(lookupAck([], [sig('command', '/model opus')], '/model opus', AT)).toEqual({ matched: true, via: 'command' });
    expect(lookupAck([], [sig('compact', undefined)], '/compact', AT)).toEqual({ matched: true, via: 'compact' });
    expect(lookupAck([], [sig('session-switch', undefined)], '/clear', AT)).toEqual({ matched: true, via: 'session-switch' });
    expect(lookupAck([], [sig('unknown-command', '/naoexiste')], '/naoexiste', AT)).toEqual({ matched: true, via: 'unknown-command' });
    expect(lookupAck([], [sig('local', '/cost')], '/cost', AT)).toEqual({ matched: true, via: 'local' });
    expect(lookupAck([], [sig('submit', 'outra')], 'fila', AT)).toEqual({ matched: false });
  });
});
