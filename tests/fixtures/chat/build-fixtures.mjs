// T019 (014-chat) - synthetic transcript fixtures, CLI 2.1.293 shape.
//
// Deterministic: no clock, no randomness. Run `node tests/fixtures/chat/build-fixtures.mjs`
// to regenerate every .jsonl / .meta.json next to this file. Content is generic
// (atlas / beacon / vega) and every "secret-looking" value is an obvious fake.
// Structure reference: specs/014-chat/spike/transcript-schema.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const VERSION = '2.1.293';
const CWD = '/work/atlas';
const BASE_TIME = Date.UTC(2026, 9, 1, 12, 0, 0);

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

class Writer {
  constructor(scn, sessionId, opts = {}) {
    this.scn = scn;
    this.sessionId = sessionId;
    this.agentId = opts.agentId ?? null;
    this.n = 0;
    this.tick = 0;
    this.lines = [];
    this.tip = null; // last chain node uuid
    this.suffix = '';
  }

  uuid() {
    this.n += 1;
    const head = this.scn.toString(16).padStart(8, '0');
    return `${head}-0000-4000-8000-${String(this.n).padStart(12, '0')}`;
  }

  ts() {
    this.tick += 1;
    return new Date(BASE_TIME + this.tick * 1000).toISOString();
  }

  /** Common envelope of a node line. `parent` undefined = chain tip. */
  node(type, body, parent) {
    const uuid = this.uuid();
    const parentUuid = parent === undefined ? this.tip : parent;
    const line = {
      parentUuid,
      isSidechain: this.agentId !== null,
      ...(this.agentId ? { agentId: this.agentId } : {}),
      type,
      ...body,
      uuid,
      timestamp: this.ts(),
      sessionId: this.sessionId,
      cwd: CWD,
      version: VERSION,
      gitBranch: 'main',
      userType: 'external',
      entrypoint: 'cli',
    };
    this.lines.push(JSON.stringify(line));
    return uuid;
  }

  /** Advance chain tip. */
  chain(type, body, parent) {
    const uuid = this.node(type, body, parent);
    this.tip = uuid;
    return uuid;
  }

  meta(obj) {
    this.lines.push(JSON.stringify({ ...obj, sessionId: this.sessionId }));
  }

  raw(text) {
    this.lines.push(text);
  }

  // --- user ---------------------------------------------------------------

  human(text, extra = {}, parent) {
    return this.chain(
      'user',
      {
        message: { role: 'user', content: text },
        promptId: `prompt-${this.n + 1}`,
        permissionMode: 'default',
        turnOrigin: 'human',
        promptSource: 'typed',
        ...extra,
      },
      parent,
    );
  }

  toolResult(toolUseId, content, toolUseResult, extra = {}, parent) {
    return this.chain(
      'user',
      {
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(extra.is_error ? { is_error: true } : {}) }],
        },
        ...(toolUseResult === undefined ? {} : { toolUseResult }),
        sourceToolAssistantUUID: extra.source ?? null,
        ...(extra.top ?? {}),
      },
      parent,
    );
  }

  // --- assistant ----------------------------------------------------------

  /** One content block per line; `mid` groups lines of the same API response. */
  assistant(mid, index, block, extra = {}, parent) {
    return this.chain(
      'assistant',
      {
        message: {
          id: mid,
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [block],
          stop_reason: extra.stop_reason ?? null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        requestId: `req-${mid}`,
        apiBlockIndex: index,
        ...(extra.top ?? {}),
      },
      parent,
    );
  }

  text(mid, index, text, extra, parent) {
    return this.assistant(mid, index, { type: 'text', text }, extra, parent);
  }

  thinking(mid, index, ms, parent) {
    return this.assistant(mid, index, { type: 'thinking', thinking: '', signature: 'sig-fake' }, { top: { thinkingDurationMs: ms } }, parent);
  }

  toolUse(mid, index, id, name, input, extra, parent) {
    return this.assistant(mid, index, { type: 'tool_use', id, name, input, caller: { type: 'direct' } }, extra, parent);
  }

  // --- system / attachment ------------------------------------------------

  system(subtype, body, parent) {
    return this.chain('system', { subtype, level: 'info', ...body }, parent);
  }

  /** Attachment node; by default a side leaf (does not advance the tip). */
  attachment(att, parent, advance = false) {
    const body = { attachment: att };
    return advance ? this.chain('attachment', body, parent) : this.node('attachment', body, parent);
  }

  turnDone(ms = 4200, extra = {}) {
    return this.system('turn_duration', { durationMs: ms, messageCount: 4, ...extra });
  }

  serialize({ incompleteTail } = {}) {
    const body = this.lines.join('\n');
    return incompleteTail === undefined ? `${body}\n` : `${body}\n${incompleteTail}`;
  }
}

const files = new Map(); // relative path -> string

function put(path, content) {
  files.set(path, content);
}

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Noise attachments that carry fake account data on purpose (privacy test).
const FAKE_EMAIL = 'fake.user@example.invalid';
const FAKE_TOKEN = 'FAKE-ORG-TOKEN-0000';

// ---------------------------------------------------------------------------
// 01 - basic round
// ---------------------------------------------------------------------------

{
  const w = new Writer(1, 'sess-basic');
  w.meta({ type: 'permission-mode', permissionMode: 'default' });
  w.attachment({ type: 'session_context', email: FAKE_EMAIL, accountUuid: 'acct-fake-0000' }, null, true);
  w.attachment({ type: 'credential_org', organizationUuid: 'org-fake-0000', token: FAKE_TOKEN });
  w.attachment({ type: 'skill_listing', names: ['atlas-notes', 'beacon-sync'], skillCount: 2, content: '- atlas-notes: take notes\n- beacon-sync: sync beacons', isInitial: true });
  w.human('Leia o README do atlas e resuma.');
  w.attachment({ type: 'hook_success', hookEvent: 'UserPromptSubmit', hookName: 'noop', command: 'true', stdout: '', exitCode: 0, toolUseID: 'hook-1' });
  w.thinking('msg_b1', 0, 1800);
  w.toolUse('msg_b1', 1, 'toolu_b1', 'Read', { file_path: '/work/atlas/README.md' });
  w.toolResult(
    'toolu_b1',
    '     1\t# atlas\n     2\tBeacon service.',
    { type: 'text', file: { filePath: '/work/atlas/README.md', content: '# atlas\nBeacon service.', numLines: 2, startLine: 1, totalLines: 2 } },
    { source: 'u-assistant' },
  );
  w.text('msg_b2', 0, 'O atlas expoe o servico beacon.', { stop_reason: 'end_turn' });
  w.turnDone();
  w.meta({ type: 'last-prompt', leafUuid: w.tip, lastPrompt: 'Leia o README do atlas e resuma.' });
  w.meta({ type: 'ai-title', aiTitle: 'Resumo do README do atlas' });
  w.meta({ type: 'cost-state', totalCostUSD: 0.01, totalDuration: 5000, totalAPIDuration: 4000, totalLinesAdded: 0, totalLinesRemoved: 0 });
  put('basic-round.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 02 - every toolUseResult shape of the catalog
// ---------------------------------------------------------------------------

{
  const w = new Writer(2, 'sess-tools');
  w.human('Rode o roteiro completo de ferramentas no atlas.');
  let k = 0;
  const call = (name, input, content, tur, extra) => {
    k += 1;
    const mid = `msg_t${k}`;
    const id = `toolu_t${k}`;
    const au = w.toolUse(mid, 0, id, name, input);
    w.toolResult(id, content, tur, { source: au, ...(extra ?? {}) });
  };

  call('Bash', { command: 'npm test', description: 'run tests' }, 'ok', { stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
  call('Bash', { command: 'npm run watch', run_in_background: true }, 'started', { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-atlas-1' });
  call('Bash', { command: 'cat big.log' }, 'Output saved to disk', { stdout: 'head...', stderr: '', interrupted: false, persistedOutputPath: '/work/atlas/.cache/tool-results/bash-1.txt', persistedOutputSize: 90000 });
  call('Bash', { command: 'git commit -m x' }, 'done', { stdout: '[main abc123] x', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'abc123' } } });
  call('PowerShell', { command: 'Get-ChildItem' }, 'a.txt', { stdout: 'a.txt', stderr: '', interrupted: false });
  call('Read', { file_path: '/work/atlas/src/a.ts', offset: 10, limit: 5 }, '    10\tx', { type: 'text', file: { filePath: '/work/atlas/src/a.ts', content: 'x', numLines: 5, startLine: 10, totalLines: 40 } });
  call('Read', { file_path: '/work/atlas/logo.png' }, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: tinyPng } }], { type: 'image', file: { base64: tinyPng, type: 'image/png', originalSize: 70, dimensions: { originalWidth: 1, originalHeight: 1 } } });
  call('Read', { file_path: '/work/atlas/spec.pdf' }, 'pdf', { type: 'pdf', file: { filePath: '/work/atlas/spec.pdf', base64: 'ZmFrZQ==', originalSize: 4 } });
  call('Read', { file_path: '/work/atlas/src/a.ts' }, 'File unchanged', { type: 'file_unchanged', file: { filePath: '/work/atlas/src/a.ts' } });
  call('Write', { file_path: '/work/atlas/new.md', content: 'a\nb\nc' }, 'created', { type: 'create', filePath: '/work/atlas/new.md', content: 'a\nb\nc', originalFile: null, structuredPatch: [], userModified: false });
  call('Write', { file_path: '/work/atlas/src/a.ts', content: 'y' }, 'updated', { type: 'update', filePath: '/work/atlas/src/a.ts', content: 'y', originalFile: 'x', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }], userModified: false });
  call('Edit', { file_path: '/work/atlas/src/a.ts', old_string: 'y', new_string: 'z' }, 'edited', { filePath: '/work/atlas/src/a.ts', oldString: 'y', newString: 'z', originalFile: 'y', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-y', '+z', '+w'] }], userModified: false, replaceAll: false });
  call('Grep', { pattern: 'beacon' }, 'a.ts\nb.ts', { mode: 'files_with_matches', numFiles: 2, filenames: ['a.ts', 'b.ts'] });
  call('Grep', { pattern: 'nothing' }, 'No files found', { mode: 'files_with_matches', numFiles: 0, filenames: [] });
  call('Glob', { pattern: 'src/**/*.ts' }, 'a.ts\nb.ts\nc.ts', { filenames: ['a.ts', 'b.ts', 'c.ts'], numFiles: 3, durationMs: 12, truncated: false });
  call('Agent', { description: 'Explore beacon', subagent_type: 'Explore', prompt: 'look around' }, 'Async agent launched. agentId: vega01', { status: 'async_launched', agentId: 'vega01', description: 'Explore beacon', prompt: 'look around', isAsync: true, outputFile: '/work/atlas/.cache/agents/vega01.output', canReadOutputFile: true, resolvedModel: 'claude-sonnet-5-5' });
  call('AskUserQuestion', { questions: [{ question: 'Qual banco?', header: 'Banco', multiSelect: false, options: [{ label: 'SQLite' }, { label: 'Postgres' }] }] }, 'answered', { questions: [{ question: 'Qual banco?', header: 'Banco', multiSelect: false, options: [{ label: 'SQLite' }, { label: 'Postgres' }] }], answers: { 'Qual banco?': 'SQLite' } });
  call('ExitPlanMode', { plan: '1. ler\n2. editar', planFilePath: '/work/atlas/.plans/p.md' }, 'approved', { plan: '1. ler\n2. editar', filePath: '/work/atlas/.plans/p.md', isAgent: false });
  call('WebFetch', { url: 'https://example.invalid/doc', prompt: 'summarize' }, 'summary', { url: 'https://example.invalid/doc', code: 200, codeText: 'OK', bytes: 2048, durationMs: 300, result: 'summary' });
  call('WebSearch', { query: 'beacon protocol' }, 'results', { query: 'beacon protocol', results: [{ title: 'Beacon', url: 'https://example.invalid/b' }], durationSeconds: 1.2 });
  call('Skill', { skill: 'atlas-notes' }, 'Launching skill', { commandName: 'atlas-notes', success: true });
  call('ToolSearch', { query: 'select:Monitor' }, [{ type: 'tool_reference', tool_name: 'Monitor' }], { matches: ['Monitor'], query: 'select:Monitor', total_deferred_tools: 12 });
  call('Monitor', { command: 'tail -f log' }, 'monitoring', { taskId: 'task-atlas-1', timeoutMs: 60000, persistent: false });
  call('TaskStop', { task_id: 'task-atlas-1' }, 'stopped', { message: 'stopped', task_id: 'task-atlas-1', task_type: 'monitor', command: 'tail -f log' });
  call('SendMessage', { to: 'vega01', message: 'hi' }, 'sent', { success: true, message: 'sent', resumedAgentId: 'vega01' });
  call('Workflow', { workflow: 'beacon-review' }, 'started', { runId: 'run-1', taskId: 'task-wf-1', status: 'started', transcriptDir: '/work/atlas/.cache/wf', workflowName: 'beacon-review' });
  call('TodoWrite', { todos: [{ content: 'ler', status: 'pending', activeForm: 'lendo' }] }, 'ok', { oldTodos: [], newTodos: [{ content: 'ler', status: 'pending', activeForm: 'lendo' }] });
  call('mcp__vega__lookup', { key: 'beacon' }, [{ type: 'text', text: 'found' }], [{ type: 'text', text: 'found' }]);
  call('FutureTool', { anything: 1 }, 'whatever', { surprise: true });
  call('Bash', { command: 'rm important' }, 'The user doesn\'t want to proceed with this tool use.', 'User rejected tool use', { is_error: true, top: { toolDenialKind: 'user-rejected' } });
  call('Bash', { command: 'exit 2' }, 'Exit code 2', 'Exit code 2', { is_error: true });
  w.text('msg_t_end', 0, 'Roteiro concluido.', { stop_reason: 'end_turn' });
  w.turnDone();
  put('tool-results.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 03 - slash command, skill body, local command, bash mode
// ---------------------------------------------------------------------------

{
  const w = new Writer(3, 'sess-commands');
  // local command: caveat (meta) + command + stdout
  w.chain('user', { message: { role: 'user', content: '<local-command-caveat>Caveat: local command output.</local-command-caveat>' }, isMeta: true });
  w.chain('user', { message: { role: 'user', content: '<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>' } });
  w.chain('user', { message: { role: 'user', content: '<local-command-stdout>Context: 12k tokens</local-command-stdout>' } });
  w.system('local_command', { content: 'context', commandRun: { command: '/context', args: '' } });
  // user-typed skill: command line + meta body + permissions attachment
  const cmd = w.chain('user', { message: { role: 'user', content: '<command-message>atlas-notes</command-message>\n<command-name>/atlas-notes</command-name>\n<command-args>beacon</command-args>\n<skill-format>true</skill-format>' }, turnOrigin: 'human', promptSource: 'typed', promptId: 'prompt-skill' });
  w.chain('user', { message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /work/atlas/skills/notes\n\n# Notes skill body\nDo the thing.' }] }, isMeta: true });
  w.attachment({ type: 'command_permissions', allowedTools: ['Read'] }, cmd);
  w.text('msg_c1', 0, 'Nota registrada.', { stop_reason: 'end_turn' });
  w.turnDone();
  // skill via tool
  w.human('Use a skill beacon-sync.');
  const au = w.toolUse('msg_c2', 0, 'toolu_c2', 'Skill', { skill: 'beacon-sync' });
  w.toolResult('toolu_c2', 'Launching skill: beacon-sync', { commandName: 'beacon-sync', success: true }, { source: au });
  w.chain('user', { message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /work/atlas/skills/sync\n\n# Sync skill body' }] }, isMeta: true });
  w.text('msg_c3', 0, 'Sincronizado.', { stop_reason: 'end_turn' });
  w.turnDone();
  // bash mode (!)
  w.chain('user', { message: { role: 'user', content: '<bash-input>ls -la</bash-input>' }, turnOrigin: 'human', promptSource: 'typed' });
  w.chain('user', { message: { role: 'user', content: '<bash-stdout>total 0\nREADME.md</bash-stdout><bash-stderr></bash-stderr>' } });
  put('commands.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 04 - interruptions
// ---------------------------------------------------------------------------

{
  const w = new Writer(4, 'sess-interrupt');
  w.human('Faca uma varredura longa no atlas.');
  w.text('msg_i1', 0, 'Comecando a varrer', { top: { isAbortedMidStream: true } });
  w.chain('user', { message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, interruptedMessageId: 'msg_i1' });
  w.human('Tente de novo, rodando o build.');
  const au = w.toolUse('msg_i2', 0, 'toolu_i2', 'Bash', { command: 'npm run build' });
  w.toolResult('toolu_i2', 'interrupted', { stdout: '', stderr: '', interrupted: true }, { source: au, is_error: true });
  w.chain('user', { message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, interruptedMessageId: 'msg_i2' });
  put('interrupt.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 05 - prompt with image
// ---------------------------------------------------------------------------

{
  const w = new Writer(5, 'sess-image');
  const u = w.human('Veja este print [Image #1] do beacon.', {});
  // replace message content with text + image
  const last = JSON.parse(w.lines.pop());
  last.message.content = [
    { type: 'text', text: 'Veja este print [Image #1] do beacon.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: tinyPng } },
  ];
  last.imagePasteIds = [1];
  w.lines.push(JSON.stringify(last));
  w.chain('user', { message: { role: 'user', content: [{ type: 'text', text: '[Image: source: /tmp/paste-1.png]' }] }, isMeta: true }, u);
  w.text('msg_im1', 0, 'Vejo um pixel.', { stop_reason: 'end_turn' });
  w.turnDone();
  put('image-prompt.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 06 - queue + compaction
// ---------------------------------------------------------------------------

{
  const w = new Writer(6, 'sess-queue');
  w.human('Inicie o build do atlas.');
  const au = w.toolUse('msg_q1', 0, 'toolu_q1', 'Bash', { command: 'sleep 5' });
  // prompt typed mid-turn: queued_command attachment + queue-operation metas
  w.meta({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-01T12:00:10.000Z', content: 'Depois do build, rode os testes.' });
  w.attachment({ type: 'queued_command', prompt: 'Depois do build, rode os testes.', commandMode: 'prompt', humanTurn: true, origin: { kind: 'human' }, source_uuid: 'q-src-1', delivery_id: 'dlv-1' }, au);
  w.meta({ type: 'queue-operation', operation: 'remove', timestamp: '2026-10-01T12:00:11.000Z', reason: 'absorbed_mid_turn', commandUuid: 'q-src-1', deliveryId: 'dlv-1' });
  w.toolResult('toolu_q1', 'done', { stdout: 'done', stderr: '', interrupted: false }, { source: au });
  // twin user line of the queued prompt (dedupe by text)
  w.chain('user', { message: { role: 'user', content: 'Depois do build, rode os testes.' }, turnOrigin: 'human', promptSource: 'queued', promptId: 'prompt-q2' });
  w.text('msg_q2', 0, 'Build ok; rodando testes.', { stop_reason: 'end_turn' });
  w.turnDone();
  // queued prompt with no twin line
  const au3 = w.toolUse('msg_q3', 0, 'toolu_q3', 'Bash', { command: 'sleep 1' });
  w.attachment({ type: 'queued_command', prompt: 'Sem gemeo na linha user.', commandMode: 'prompt', humanTurn: true, origin: { kind: 'human' } }, au3);
  w.toolResult('toolu_q3', 'ok', { stdout: 'ok', stderr: '', interrupted: false }, { source: au3 });
  w.text('msg_q4', 0, 'Pronto.', { stop_reason: 'end_turn' });
  w.turnDone();
  // compaction: boundary with null parent + logicalParentUuid, then summary, caveat, command echo
  const pre = w.tip;
  const boundary = w.chain(
    'system',
    {
      subtype: 'compact_boundary',
      level: 'info',
      content: 'Conversation compacted',
      compactMetadata: { trigger: 'manual', preTokens: 180000, postTokens: 12000, durationMs: 8000 },
      logicalParentUuid: pre,
    },
    null,
  );
  w.chain('user', { message: { role: 'user', content: 'This session is being continued from a previous conversation... (summary)' }, isCompactSummary: true, isVisibleInTranscriptOnly: true }, boundary);
  w.human('Continue de onde parou.');
  w.text('msg_q5', 0, 'Continuando.', { stop_reason: 'end_turn' });
  w.turnDone();
  put('queue-compact.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 07 - tree: rewind branch + parallel results
// ---------------------------------------------------------------------------

{
  const w = new Writer(7, 'sess-rewind');
  const p1 = w.human('Escreva a funcao A do atlas.');
  w.text('msg_r1', 0, 'Funcao A escrita.', { stop_reason: 'end_turn' });
  w.turnDone();
  const p2 = w.human('Agora escreva a funcao B (abandonada).');
  w.text('msg_r2', 0, 'Funcao B escrita.', { stop_reason: 'end_turn' });
  w.turnDone();
  // rewind: new user line pointing back at the end of round 1 (parent of p2)
  const abandonedParent = JSON.parse(w.lines.find((l) => JSON.parse(l).uuid === p2)).parentUuid;
  const p3 = w.human('Na verdade escreva a funcao C.', {}, abandonedParent);
  void p1;
  void p3;
  w.text('msg_r3', 0, 'Funcao C escrita.', { stop_reason: 'end_turn' });
  w.turnDone();
  put('tree-rewind.jsonl', w.serialize());
}

{
  const w = new Writer(8, 'sess-parallel');
  w.human('Leia dois arquivos em paralelo.');
  // PreToolUse hook attachment hanging as a side leaf of the prompt
  w.attachment({ type: 'hook_additional_context', hookEvent: 'PreToolUse', content: ['ctx'] }, w.tip);
  const a1 = w.toolUse('msg_p1', 0, 'toolu_pa', 'Read', { file_path: '/work/atlas/a.ts' });
  const a2 = w.toolUse('msg_p1', 1, 'toolu_pb', 'Read', { file_path: '/work/atlas/b.ts' });
  // results of parallel calls: first hangs off the first tool_use (side leaf), second off the second
  w.toolResult('toolu_pa', '     1\ta', { type: 'text', file: { filePath: '/work/atlas/a.ts', content: 'a', numLines: 1, startLine: 1, totalLines: 1 } }, { source: a1 }, a1);
  w.tip = a2; // result B hangs off the second tool_use, chain continues from it
  w.toolResult('toolu_pb', '     1\tb', { type: 'text', file: { filePath: '/work/atlas/b.ts', content: 'b', numLines: 1, startLine: 1, totalLines: 1 } }, { source: a2 });
  w.text('msg_p2', 0, 'Li a.ts e b.ts.', { stop_reason: 'end_turn' });
  w.turnDone();
  put('tree-parallel.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 09 - errors and noise
// ---------------------------------------------------------------------------

{
  const w = new Writer(9, 'sess-noise');
  w.meta({ type: 'permission-mode', permissionMode: 'auto' });
  w.meta({ type: 'mode', mode: 'normal' });
  w.meta({ type: 'custom-title', customTitle: 'Titulo Beacon' });
  w.meta({ type: 'agent-name', agentName: 'beacon-agent' });
  w.meta({ type: 'pr-link', prNumber: 7, prUrl: 'https://example.invalid/pr/7', prRepository: 'atlas/beacon', timestamp: '2026-10-01T12:00:00.000Z' });
  w.meta({ type: 'file-history-snapshot', messageId: 'snap-1', snapshot: { trackedFileBackups: {} }, isSnapshotUpdate: false });
  w.meta({ type: 'file-history-delta', messageId: 'snap-2', snapshotMessageId: 'snap-1', trackingPath: '/work/atlas/a.ts', backup: {} });
  w.meta({ type: 'bridge-session', bridgeId: 'bridge-fake' });
  w.meta({ type: 'atis-latch', atis: 'opaque' });
  w.meta({ type: 'history-suppression' });
  w.attachment({ type: 'session_context', email: FAKE_EMAIL, accountUuid: 'acct-fake-0000', plan: 'max-fake' }, null, true);
  w.attachment({ type: 'credential_org', organizationUuid: 'org-fake-0000', token: FAKE_TOKEN });
  for (const t of [
    'hook_success', 'hook_additional_context', 'total_tokens_reminder', 'deferred_tools_record', 'deferred_tools_delta',
    'prompt_snapshot', 'environment', 'date', 'model', 'language', 'instructions', 'auto_mode', 'remote_session_change',
    'thinking_drop', 'structured_output', 'command_permissions', 'agent_listing_delta', 'mcp_instructions_delta', 'nested_memory',
  ]) {
    w.attachment({ type: t, note: 'noise' });
  }
  w.human('Provoque erros no atlas.');
  // synthetic api error + limit error
  w.assistant('msg_e1', 0, { type: 'text', text: 'API Error: 529 overloaded' }, { top: { isApiErrorMessage: true, error: 'server_error', apiErrorStatus: 529 }, stop_reason: 'stop_sequence' });
  w.chain('assistant', {
    message: { id: 'msg_e2', type: 'message', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: "You've hit your limit - resets at 3pm" }], stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 } },
    requestId: 'req-e2', apiBlockIndex: 0, error: 'rate_limit',
  });
  // recognised side attachments
  w.attachment({ type: 'plan_mode', planFilePath: '/work/atlas/.plans/p.md', planExists: true, isSubAgent: false });
  w.attachment({ type: 'edited_text_file', filename: '/work/atlas/a.ts', snippet: 'changed' });
  w.attachment({ type: 'file', filename: '/work/atlas/a.ts', displayPath: 'a.ts', content: { file: { filePath: '/work/atlas/a.ts', content: 'a' } } });
  w.attachment({ type: 'task_status', taskId: 'bg-atlas-1', taskType: 'shell', status: 'running', description: 'watch', outputFilePath: '/work/atlas/.cache/bg-1.out' });
  w.attachment({ type: 'hook_non_blocking_error', hookName: 'lint-hook', stderr: 'warn', exitCode: 1 });
  w.attachment({ type: 'hook_system_message', hookName: 'info-hook', content: 'hello' });
  w.attachment({ type: 'hook_permission_decision', hookName: 'perm-hook', decision: 'allow' });
  // unknown shapes
  w.attachment({ type: 'future_attachment', payload: 'x' });
  w.system('future_subtype', { content: 'x' });
  w.system('informational', { content: 'Heads up', level: 'warning' });
  w.system('stop_hook_summary', { hookCount: 1, hookInfos: [], hookErrors: [], hasOutput: false, preventedContinuation: false, stopReason: '', toolUseID: 'toolu_x' });
  w.system('stop_hook_summary', { hookCount: 1, hookInfos: [], hookErrors: ['boom'], hasOutput: true, preventedContinuation: true, stopReason: 'blocked', toolUseID: 'toolu_y' });
  w.chain('future_type', { payload: 'x' });
  // sidechain line leaked in the main file
  w.raw(JSON.stringify({ parentUuid: null, isSidechain: true, type: 'user', message: { role: 'user', content: 'sidechain prompt' }, uuid: 'ffffffff-0000-4000-8000-000000000001', timestamp: '2026-10-01T12:30:00.000Z', sessionId: 'sess-noise', cwd: CWD, version: VERSION }));
  // invalid JSON
  w.raw('{"type":"user","uuid":"broken", ');
  w.text('msg_e3', 0, 'Fim.', { stop_reason: 'end_turn' });
  put('errors-noise.jsonl', w.serialize());
}

// ---------------------------------------------------------------------------
// 10 - subagent: main file + subagents/*.jsonl + .meta.json + notification
// ---------------------------------------------------------------------------

{
  const w = new Writer(10, 'sess-subagent');
  w.human('Delegue a exploracao do beacon a um subagente.');
  const au = w.toolUse('msg_s1', 0, 'toolu_s1', 'Agent', { description: 'Explore beacon', subagent_type: 'Explore', prompt: 'Explore the beacon service.' });
  w.toolResult(
    'toolu_s1',
    [{ type: 'text', text: 'Async agent launched. agentId: vega01' }],
    { status: 'async_launched', agentId: 'vega01', description: 'Explore beacon', prompt: 'Explore the beacon service.', isAsync: true, outputFile: '/work/atlas/.cache/agents/vega01.output', canReadOutputFile: true, resolvedModel: 'claude-sonnet-5-5' },
    { source: au },
  );
  w.text('msg_s2', 0, 'Subagente lancado; aguardando.', { stop_reason: 'end_turn' });
  w.turnDone(3000, { pendingBackgroundAgentCount: 1 });
  // completion notification as a top-level user line
  const notification =
    '<task-notification>\n<task-id>vega01</task-id>\n<tool-use-id>toolu_s1</tool-use-id>\n<status>completed</status>\n' +
    '<summary>Agent "Explore beacon" completed</summary>\n<result>O beacon e um servico de eco.</result>\n' +
    '<usage><subagent_tokens>5400</subagent_tokens><tool_uses>3</tool_uses><duration_ms>21000</duration_ms></usage>\n' +
    '<output-file>/work/atlas/.cache/agents/vega01.output</output-file>\n</task-notification>';
  w.chain('user', { message: { role: 'user', content: notification }, origin: { kind: 'task-notification' }, turnOrigin: 'task_notification', promptSource: 'system' });
  w.text('msg_s3', 0, 'O subagente terminou: o beacon e um servico de eco.', { stop_reason: 'end_turn' });
  w.turnDone();
  // second agent finished mid-turn: arrives as queued_command + queue-operation
  const au2 = w.toolUse('msg_s4', 0, 'toolu_s4', 'Agent', { description: 'Check vega', subagent_type: 'general-purpose', prompt: 'Check vega.' });
  w.toolResult('toolu_s4', [{ type: 'text', text: 'Async agent launched. agentId: vega02' }], { status: 'async_launched', agentId: 'vega02', description: 'Check vega', prompt: 'Check vega.', isAsync: true, outputFile: '/work/atlas/.cache/agents/vega02.output', canReadOutputFile: true }, { source: au2 });
  const notification2 = notification
    .replace(/vega01/g, 'vega02').replace('toolu_s1', 'toolu_s4').replace('Explore beacon', 'Check vega')
    .replace('O beacon e um servico de eco.', 'Vega esta ok.').replace('<status>completed', '<status>failed');
  w.attachment({ type: 'queued_command', prompt: notification2, commandMode: 'task-notification', origin: { kind: 'task-notification' }, usage: { durationMs: 9000, toolUses: 1, totalTokens: 800 } }, w.tip);
  w.meta({ type: 'queue-operation', operation: 'remove', timestamp: '2026-10-01T12:05:00.000Z', reason: 'absorbed_mid_turn' });
  w.text('msg_s5', 0, 'Um segundo subagente falhou.', { stop_reason: 'end_turn' });
  w.turnDone();
  put('sess-subagent.jsonl', w.serialize());

  // subagent files (flat directory, `<sessionId>/subagents/agent-<agentId>.*`)
  const s = new Writer(11, 'sess-subagent', { agentId: 'vega01' });
  s.chain('user', { message: { role: 'user', content: 'Explore the beacon service.' }, promptId: 'prompt-sub-1' }, null);
  const sa = s.toolUse('msg_sa1', 0, 'toolu_sa1', 'Read', { file_path: '/work/atlas/beacon.ts' });
  s.toolResult('toolu_sa1', '     1\texport const beacon = 1;', { type: 'text', file: { filePath: '/work/atlas/beacon.ts', content: 'export const beacon = 1;', numLines: 1, startLine: 1, totalLines: 1 } }, { source: sa });
  s.text('msg_sa2', 0, 'beacon exports a constant.', { stop_reason: 'end_turn' });
  put('sess-subagent/subagents/agent-vega01.jsonl', s.serialize());
  put(
    'sess-subagent/subagents/agent-vega01.meta.json',
    `${JSON.stringify({ agentType: 'Explore', description: 'Explore beacon', model: 'claude-sonnet-5-5', requestShape: 'background', requestNonInteractive: true, spawnDepth: 1, toolUseId: 'toolu_s1' }, null, 2)}\n`,
  );
  put(
    'sess-subagent/subagents/agent-vega02.meta.json',
    `${JSON.stringify({ agentType: 'general-purpose', description: 'Check vega', requestShape: 'background', requestNonInteractive: true, spawnDepth: 1, toolUseId: 'toolu_s4' }, null, 2)}\n`,
  );
}

// ---------------------------------------------------------------------------
// 11 - edges: line > 1 MB, incomplete last line
// ---------------------------------------------------------------------------

{
  const w = new Writer(12, 'sess-bigline');
  w.human('Leia o log gigante do atlas.');
  const au = w.toolUse('msg_g1', 0, 'toolu_g1', 'Bash', { command: 'cat huge.log' });
  const block = 'beacon-vega-atlas-log-line-0123456789\n';
  const huge = block.repeat(Math.ceil(600_000 / block.length));
  w.toolResult('toolu_g1', huge, { stdout: huge, stderr: '', interrupted: false }, { source: au });
  w.text('msg_g2', 0, 'Log lido.', { stop_reason: 'end_turn' });
  w.turnDone();
  put('edge-big-line.jsonl', w.serialize());
}

{
  const w = new Writer(13, 'sess-incomplete');
  w.human('Primeira pergunta do atlas.');
  w.text('msg_n1', 0, 'Primeira resposta.', { stop_reason: 'end_turn' });
  w.turnDone();
  // last line is cut mid-write (no newline, invalid JSON)
  const tail = '{"parentUuid":"00000000-0000-4000-8000-000000000003","type":"assistant","message":{"id":"msg_n2","type":"message","role":"assistant","content":[{"type":"text","text":"respost';
  put('edge-incomplete-last.jsonl', w.serialize({ incompleteTail: tail }));
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

for (const [rel, content] of files) {
  const full = join(OUT, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  // sanity: every .jsonl line except deliberate breakage must parse
}
console.log(`wrote ${files.size} fixture files to ${OUT}`);
