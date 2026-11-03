import { describe, expect, it } from 'vitest';
import { adapt, initAdapterState } from '../src/shared/chat/adapter';
import { deriveBackgroundTasks } from '../src/shared/chat/backgroundTasks';
import type { TranscriptEntry } from '../src/shared/chat/rows';
import { classifyLine } from '../src/shared/chat/transcriptEntry';

// Segundo plano visível (03/11) — "rodando" só enquanto a notificação de fim não veio, e só no processo vivo.
// É o que mentiria sem o dono perceber: o indicador diria que algo roda quando já acabou (ou o contrário).

let n = 0;
function line(data: Record<string, unknown>, parent: string | null): { uuid: string; entry: TranscriptEntry } {
  n += 1;
  const uuid = `u${n}`;
  const text = JSON.stringify({ uuid, parentUuid: parent, timestamp: `2026-11-03T12:00:${String(n).padStart(2, '0')}Z`, ...data });
  return { uuid, entry: classifyLine(text, { path: 't.jsonl', offset: n * 1000, length: text.length })! };
}

const notification = (toolUseId: string, status?: string): Record<string, unknown> => ({
  type: 'attachment',
  attachment: {
    type: 'queued_command',
    commandMode: 'task-notification',
    prompt: `<task-notification>\n<task-id>x</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n${status ? `<status>${status}</status>\n` : ''}<summary>…</summary>\n</task-notification>`,
  },
});

describe('tarefas em segundo plano', () => {
  it('rodando até a notificação de fim; evento de monitor não encerra; processo morto vira desconhecido', () => {
    const a = line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [
      { type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'npm run dev', description: 'Sobe o servidor', run_in_background: true } },
      { type: 'tool_use', id: 'mon1', name: 'Monitor', input: { command: 'tail -f x', description: 'Vigia o log' } },
    ] } }, null);
    const r1 = line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bash1', content: 'Command running in background with ID: b1' }] }, toolUseResult: { backgroundTaskId: 'b1' } }, a.uuid);
    const r2 = line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'mon1', content: 'Monitor started' }] }, toolUseResult: { taskId: 'm9' } }, r1.uuid);
    let state = adapt(initAdapterState(), [a.entry, r1.entry, r2.entry]).state;
    const alive = { processAlive: true, processSince: Date.parse('2026-11-03T11:00:00Z') };
    expect(deriveBackgroundTasks(state.rows, alive).map((t) => [t.kind, t.label, t.state])).toEqual([
      ['command', 'Sobe o servidor', 'running'],
      ['monitor', 'Vigia o log', 'running'],
    ]);

    const event = line(notification('mon1'), r2.uuid);
    const done = line(notification('bash1', 'completed'), event.uuid);
    state = adapt(state, [event.entry, done.entry]).state;
    const tasks = deriveBackgroundTasks(state.rows, alive);
    expect(tasks.map((t) => [t.id, t.state])).toEqual([['mon1', 'running'], ['bash1', 'completed']]);

    // the same transcript in a newer process (resumed later), or after the CLI exited: nothing is running
    expect(deriveBackgroundTasks(state.rows, { processAlive: true, processSince: Date.parse('2026-11-03T13:00:00Z') }).find((t) => t.id === 'mon1')?.state).toBe('unknown');
    expect(deriveBackgroundTasks(state.rows, { processAlive: false }).find((t) => t.id === 'mon1')?.state).toBe('unknown');
  });
});
