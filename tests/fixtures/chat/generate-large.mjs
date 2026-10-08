// T058 (014-chat) - deterministic synthetic session of ~10k transcript lines,
// with a few large lines, for the long-session smoke (SC-005) and for manual
// profiling. No clock, no randomness: the same arguments give the same bytes.
// Content is generic (atlas / beacon / vega) - never real project data.
//
//   node tests/fixtures/chat/generate-large.mjs <out.jsonl> [sessionId] [cwd] [rounds]
//
// Shape of one round (5 lines): user prompt, thinking, Bash tool_use,
// tool_result, assistant text. Every 250th round the tool_result is a ~300 KB
// block (under the 1 MB "too-large" limit of the classifier, but far over any
// sane row), and every 100th assistant text carries a table and a code fence.
// The very first prompt holds START_MARKER and the very last answer END_MARKER,
// so a test can wait for either end of the conversation.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const START_MARKER = 'INICIO-SESSAO-SINTETICA-ATLAS';
export const END_MARKER = 'FIM-SESSAO-SINTETICA-VEGA';
export const DEFAULT_ROUNDS = 2000; // 5 lines per round = 10k lines
const BASE_TIME = Date.UTC(2026, 0, 5, 12, 0, 0);
const PROJECTS = ['atlas', 'beacon', 'vega'];

/** Deterministic uuid-shaped id from a counter. */
function uuidOf(n) {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function bigBlock(seed) {
  const line = `${PROJECTS[seed % 3]} synthetic output line ${'x'.repeat(60)}\n`;
  return line.repeat(Math.ceil(300_000 / line.length));
}

function answerText(round, last) {
  const project = PROJECTS[round % 3];
  if (last) return `Concluído o ciclo final do ${project}. ${END_MARKER}`;
  if (round % 100 === 0) {
    return [
      `Resumo da rodada ${round} do ${project}:`,
      '',
      '| etapa | estado |',
      '| --- | --- |',
      `| ${project}-leitura | ok |`,
      `| ${project}-escrita | ok |`,
      '',
      '```ts',
      `export const step${round} = (n: number): number => n + ${round};`,
      '```',
    ].join('\n');
  }
  return `Rodada ${round} do ${project} concluída: leitura e verificação sem pendências.`;
}

/** Builds the JSONL text (every line ends with \n). */
export function buildLargeSession({ sessionId, cwd, rounds = DEFAULT_ROUNDS }) {
  const lines = [];
  let counter = 0;
  let parent = null;
  let tick = 0;
  const push = (line) => {
    counter += 1;
    tick += 1000;
    const uuid = uuidOf(counter);
    lines.push(
      JSON.stringify({
        parentUuid: parent,
        isSidechain: false,
        uuid,
        sessionId,
        timestamp: new Date(BASE_TIME + tick).toISOString(),
        cwd,
        version: '2.1.293',
        ...line,
      }),
    );
    parent = uuid;
  };
  for (let round = 1; round <= rounds; round += 1) {
    const last = round === rounds;
    const project = PROJECTS[round % 3];
    const toolId = `toolu_large_${String(round).padStart(6, '0')}`;
    const prompt = round === 1 ? `${START_MARKER}: revisar o módulo ${project}` : `Revisar o módulo ${project} (rodada ${round})`;
    push({ type: 'user', message: { role: 'user', content: prompt } });
    push({
      type: 'assistant',
      message: {
        id: `msg_large_${round}_a`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'thinking', thinking: `Plano da rodada ${round} para ${project}.`, signature: 'sig' }],
        stop_reason: 'end_turn',
      },
    });
    push({
      type: 'assistant',
      message: {
        id: `msg_large_${round}_b`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: `echo ${project}-${round}` }, caller: { type: 'direct' } }],
        stop_reason: 'tool_use',
      },
    });
    push({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolId, content: round % 250 === 0 ? bigBlock(round) : `${project}-${round}\n` }],
      },
    });
    push({
      type: 'assistant',
      message: {
        id: `msg_large_${round}_c`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'text', text: answerText(round, last) }],
        stop_reason: 'end_turn',
      },
    });
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [out, sessionId = uuidOf(0), cwd = process.cwd(), rounds] = process.argv.slice(2);
  if (!out) {
    process.stderr.write('usage: node generate-large.mjs <out.jsonl> [sessionId] [cwd] [rounds]\n');
    process.exit(2);
  }
  writeFileSync(out, buildLargeSession({ sessionId, cwd, rounds: rounds ? Number(rounds) : DEFAULT_ROUNDS }), 'utf8');
}
