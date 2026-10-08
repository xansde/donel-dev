// 014-chat T040 - scripted FAKE `claude` for the chat smokes (never the real CLI in tests).
// See README.md in this folder for args, env vars and the scenario format.
// Plain Node, no dependencies. Works with any cwd.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const out = { sessionId: null, settings: null, resume: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--session-id') out.sessionId = argv[++i] ?? null;
    else if (a === '--settings') out.settings = argv[++i] ?? null;
    else if (a === '-r' || a === '--resume') out.resume = argv[++i] ?? null;
    else if (a === '--permission-mode') out.permissionMode = argv[++i] ?? null;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

let settings = { hooks: {} };
if (args.settings) {
  try {
    settings = JSON.parse(readFileSync(args.settings, 'utf8'));
  } catch {
    // unreadable settings: behave like a CLI without hooks
  }
}

function loadScenario() {
  const raw = process.env.DONEL_FAKE_CLAUDE_SCENARIO;
  if (!raw) return {};
  try {
    return JSON.parse(raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8'));
  } catch (error) {
    process.stderr.write(`fake-claude-chat: bad DONEL_FAKE_CLAUDE_SCENARIO (${error.message})\n`);
    return {};
  }
}

const scenario = loadScenario();
const homeDir = process.env.DONEL_FAKE_CLAUDE_HOME || join(tmpdir(), `fake-claude-chat-${process.pid}`);
const callLogPath = process.env.DONEL_FAKE_CLAUDE_LOG || null;
const hookTimeoutMs = Number(process.env.DONEL_FAKE_CLAUDE_HOOK_TIMEOUT_MS || 5000);
// A message containing "demorar" makes the round last this long (interruptible), so smokes can queue / interrupt.
const slowMs = Number(process.env.DONEL_FAKE_CLAUDE_SLOW_MS || 3000);
// Swallows the first Enter that has text in the box (a lost Enter), to exercise the driver's single `\r` resend.
let dropFirstEnter = process.env.DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER === '1';

// ------------------------------------------------------------------ session
const cwd = process.cwd();
let sessionId = args.resume || args.sessionId || randomUUID();
let transcriptPath = '';
let lastUuid = null;

function logCall(entry) {
  if (!callLogPath) return;
  try {
    appendFileSync(callLogPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {
    // diagnostics only
  }
}

function openTranscript() {
  const folder = join(homeDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(folder, { recursive: true });
  transcriptPath = join(folder, `${sessionId}.jsonl`);
  if (!existsSync(transcriptPath)) writeFileSync(transcriptPath, '');
  lastUuid = null;
}

function appendLine(line) {
  const uuid = randomUUID();
  const full = { parentUuid: lastUuid, isSidechain: false, uuid, sessionId, timestamp: new Date().toISOString(), cwd, version: '2.1.293', ...line };
  lastUuid = uuid;
  appendFileSync(transcriptPath, `${JSON.stringify(full)}\n`);
}

function appendUser(content, extra = {}) {
  appendLine({ type: 'user', message: { role: 'user', content }, ...extra });
}

/** Metadata line of the CLI's input queue: no uuid, outside the parentUuid chain. */
function appendQueueOp(operation, extra = {}) {
  appendFileSync(transcriptPath, `${JSON.stringify({ type: 'queue-operation', operation, timestamp: new Date().toISOString(), sessionId, ...extra })}\n`);
}

function appendToolResult(toolUseId, content, isError = false) {
  appendLine({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] } });
}

function appendAssistant(block) {
  appendLine({
    type: 'assistant',
    requestId: `req_${randomUUID().slice(0, 8)}`,
    message: { id: `msg_${randomUUID().slice(0, 12)}`, type: 'message', role: 'assistant', model: 'fake-model', content: [block], stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn' },
  });
}

// -------------------------------------------------------------------- hooks
function basePayload(event) {
  return { session_id: sessionId, transcript_path: transcriptPath, cwd, permission_mode: 'default', hook_event_name: event };
}

/** Runs the `command` hook of SessionStart exactly like the CLI: JSON on stdin, shell. */
function runCommandHook(command, payload) {
  return new Promise((done) => {
    const proc = spawn(command, { shell: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => proc.kill(), 10_000);
    proc.on('error', () => done());
    proc.on('exit', () => {
      clearTimeout(timer);
      done();
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(JSON.stringify(payload));
  });
}

/** Posts a hook event the way the settings say. Resolves with the parsed response body (or null). */
async function fireHook(event, extra = {}) {
  const entry = settings.hooks?.[event]?.[0]?.hooks?.[0];
  if (!entry) return null;
  const payload = { ...basePayload(event), ...extra };
  logCall({ hook: event, type: entry.type });
  if (entry.type === 'command') {
    await runCommandHook(entry.command, payload);
    return null;
  }
  if (entry.type !== 'http') return null;
  try {
    const response = await fetch(entry.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(entry.headers ?? {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(event === 'PermissionRequest' ? Math.max(hookTimeoutMs, 1000) : hookTimeoutMs),
    });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null; // fail-open, like the real CLI
  }
}

async function startSession(source) {
  openTranscript();
  await fireHook('SessionStart', { source });
}

// ------------------------------------------------------------------- screen
const state = { working: false, input: '', pastes: [], history: [], menuClosed: false, images: 0 };
const pending = []; // messages submitted during a round, waiting in the CLI's queue
const NATIVE_COMMANDS = ['/clear', '/compact', '/config', '/cost', '/exit', '/help', '/mcp', '/memory', '/model', '/status'];
const LOCAL_COMMANDS = new Set(['/config', '/cost', '/help', '/mcp', '/memory', '/model', '/status']);

/** Slash-menu candidates for the text in the box (the CLI shows them above the ruler). */
function menuMatches() {
  if (state.menuClosed || !state.input.startsWith('/') || /\s/.test(state.input)) return [];
  return NATIVE_COMMANDS.filter((c) => c.startsWith(state.input));
}
const out = (text) => process.stdout.write(text);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ruler() {
  return '─'.repeat(Math.max(20, (process.stdout.columns || 100) - 0));
}

function render() {
  const lines = [' ▐▛███▜▌   Claude Code v2.1.293', `▝▜█████▛▘  Fake Model · fake-claude-chat`, ` ▘▘ ▝▝    ${cwd}`, ''];
  lines.push(...state.history.slice(-12));
  for (const queued of pending) lines.push(`  ⎿ queued: ${queued.replace(/\n/g, ' ').slice(0, 60)}`);
  menuMatches().slice(0, 6).forEach((c, i) => lines.push(i === 0 ? `  ❯ ${c}` : `    ${c}`));
  lines.push(ruler(), `❯ ${displayInput()}`, ruler());
  lines.push(state.working ? '  esc to interrupt' : state.input === '' ? '  ? for shortcuts' : '  ! for shell mode');
  // The real CLI shows the permission mode in the footer; the smokes use it as the "ready for keys" signal.
  if (args.permissionMode === 'acceptEdits' && !state.working) lines.push('  ⏵⏵ accept edits on (shift+tab to cycle)');
  out(`\x1b[2J\x1b[H${lines.join('\r\n')}`);
}

function displayInput() {
  return state.input.replace(/\n/g, ' ');
}

function note(line) {
  state.history.push(line);
  render();
}

// ------------------------------------------------------------------- turns
const turnState = { counter: 0, sequential: 0, interrupted: false };

/** Sleeps in slices so Esc ends a long round promptly. */
async function sleepInterruptible(ms) {
  const end = Date.now() + ms;
  while (!turnState.interrupted && Date.now() < end) await sleep(Math.min(40, end - Date.now()));
}

function pickTurn(text) {
  const turns = Array.isArray(scenario.turns) ? scenario.turns : [];
  const matched = turns.find((t) => t.match !== undefined && matches(t.match, text));
  if (matched) return matched;
  const sequential = turns.filter((t) => t.match === undefined);
  const next = sequential[turnState.sequential];
  turnState.sequential += 1;
  return next ?? scenario.default ?? { steps: [{ type: 'wait', ms: 150 }, { type: 'assistant', text: 'OK' }, { type: 'hook', event: 'Stop' }] };
}

function matches(pattern, text) {
  if (typeof pattern === 'string' && pattern.startsWith('re:')) return new RegExp(pattern.slice(3)).test(text);
  return typeof pattern === 'string' && text.includes(pattern);
}

async function runStep(step) {
  switch (step.type) {
    case 'wait':
      await sleepInterruptible(step.ms ?? 0);
      break;
    case 'assistant':
      appendAssistant({ type: 'text', text: step.text ?? '' });
      note(`● ${step.text ?? ''}`);
      break;
    case 'thinking':
      appendAssistant({ type: 'thinking', thinking: step.text ?? '', signature: 'sig' });
      break;
    case 'hook':
      await fireHook(step.event, step.payload ?? {});
      break;
    case 'tool': {
      const id = step.id ?? `toolu_${randomUUID().slice(0, 12)}`;
      const toolPayload = { tool_name: step.name, tool_input: step.input ?? {}, tool_use_id: id };
      appendAssistant({ type: 'tool_use', id, name: step.name, input: step.input ?? {}, caller: { type: 'direct' } });
      note(`● ${step.name}(${JSON.stringify(step.input ?? {})})`);
      if (step.permission) await fireHook('PermissionRequest', { tool_name: step.name, tool_input: step.input ?? {} });
      await fireHook('PreToolUse', toolPayload);
      await sleep(step.delayMs ?? 0);
      appendToolResult(id, step.result ?? '', Boolean(step.isError));
      await fireHook('PostToolUse', { ...toolPayload, tool_response: { output: step.result ?? '' } });
      break;
    }
    default:
      break;
  }
}

async function runTurn(text, queued = false) {
  state.working = true;
  turnState.interrupted = false;
  render();
  const startedAt = Date.now();
  appendUser(text, { turnOrigin: 'human', promptSource: queued ? 'queued' : 'typed' });
  await fireHook('UserPromptSubmit', { prompt: text });
  if (/demorar/.test(text)) await sleepInterruptible(slowMs);
  const turn = pickTurn(text);
  for (const step of turn.steps ?? []) {
    if (turnState.interrupted) break;
    await runStep(step);
  }
  if (turnState.interrupted) {
    appendUser([{ type: 'text', text: '[Request interrupted by user]' }]);
    note('  ⎿  Interrupted · What should Claude do instead?');
  } else {
    appendLine({ type: 'system', subtype: 'turn_duration', durationMs: Date.now() - startedAt });
  }
  state.working = false;
  turnState.counter += 1;
  render();
}

// ----------------------------------------------------------------- commands
let busy = false;

async function endSession(reason) {
  await fireHook('SessionEnd', { reason });
}

/** Native commands that print to the transcript: caveat, command echo, stdout and `system/local_command` (2.1.293). */
function playLocalCommand(name, args) {
  appendLine({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>' } });
  appendUser(`<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>\n<command-args>${args}</command-args>`);
  appendUser(`<local-command-stdout>${name} ok</local-command-stdout>`);
  appendLine({ type: 'system', subtype: 'local_command', content: `${name} ${args}`.trim(), level: 'info', commandRun: { command: name, args } });
  note(`  ⎿  ${name} ok`);
}

async function handleSlash(text) {
  const [name, ...rest] = text.trim().split(/\s+/);
  const args = rest.join(' ');
  if (name === '/exit') {
    await endSession('prompt_input_exit');
    shutdown(0);
  } else if (name === '/clear') {
    await endSession('clear');
    sessionId = randomUUID();
    state.history = [];
    await startSession('clear');
    render();
  } else if (name === '/compact') {
    const before = lastUuid;
    appendLine({ type: 'system', subtype: 'compact_boundary', parentUuid: null, logicalParentUuid: before, content: 'Conversation compacted', level: 'info', compactMetadata: { trigger: 'manual', preTokens: 1200, postTokens: 300, durationMs: 50 } });
    note('✻ Conversation compacted');
    await fireHook('SessionStart', { source: 'compact' });
  } else if (LOCAL_COMMANDS.has(name)) {
    playLocalCommand(name, args);
  } else {
    appendLine({ type: 'system', subtype: 'informational', content: `Unknown command: ${name}`, level: 'warning' });
    note(`  ⎿  Unknown command: ${name}`);
  }
}

function handleShell(text) {
  const command = text.trim().slice(1).trim();
  appendUser(`<bash-input>${command}</bash-input>`);
  appendUser('<bash-stdout>fake output</bash-stdout><bash-stderr></bash-stderr>');
  note(`! ${command}`);
}

async function handleSubmit(text, queued = false) {
  const trimmed = text.trim();
  if (trimmed.startsWith('/')) {
    await handleSlash(trimmed);
    return;
  }
  if (trimmed.startsWith('!')) {
    handleShell(trimmed);
    return;
  }
  note(`❯ ${text.replace(/\n/g, ' ')}`);
  await runTurn(text, queued);
}

/** One submission at a time; what was queued during it is delivered right after (queue-operation remove + queued_command). */
async function run(text) {
  busy = true;
  try {
    await handleSubmit(text);
    while (pending.length > 0) {
      const next = pending.shift();
      appendQueueOp('remove');
      appendLine({ type: 'attachment', attachment: { type: 'queued_command', prompt: next, commandMode: 'prompt', humanTurn: true } });
      render();
      await handleSubmit(next, true);
    }
  } finally {
    busy = false;
  }
}

function shutdown(code) {
  out('\x1b[?2004l');
  setTimeout(() => process.exit(code), 20);
}

// -------------------------------------------------------------------- input
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
let inPaste = false;
let pasteBuffer = '';

function commitPaste(text) {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  const lineCount = normalized.split('\n').length;
  state.menuClosed = false;
  if (/^(?:[A-Za-z]:[\\/]|\/).+\.(?:png|jpe?g|gif|webp)$/i.test(normalized.trim())) {
    state.images += 1;
    state.input += `[Image #${state.images}]`;
  } else if (lineCount >= 5 || normalized.length >= 1000) {
    state.pastes.push(normalized);
    state.input += `[Pasted text #${state.pastes.length} +${lineCount - 1} lines]`;
  } else {
    state.input += normalized;
  }
}

function submitInput() {
  let text = state.input;
  state.pastes.forEach((paste, i) => {
    text = text.replace(new RegExp(`\\[Pasted text #${i + 1} \\+\\d+ lines\\]`), () => paste);
  });
  state.input = '';
  state.pastes = [];
  state.menuClosed = false;
  if (text.trim() === '') {
    render();
    return;
  }
  if (busy) {
    // the CLI keeps what is typed during a round in its input queue
    appendQueueOp('enqueue', { content: text });
    pending.push(text);
    render();
    return;
  }
  render();
  void run(text);
}

function pressEnter() {
  if (dropFirstEnter && state.input !== '') {
    dropFirstEnter = false;
    return;
  }
  const matches = menuMatches();
  if (matches.length > 0 && matches[0] !== state.input) {
    // with the slash menu open Enter COMPLETES the highlighted command instead of sending
    state.input = matches[0];
    return;
  }
  submitInput();
}

function onData(chunk) {
  let data = chunk.toString('utf8');
  if (!inPaste && data === '\x1b') {
    if (state.working) turnState.interrupted = true;
    else if (menuMatches().length > 0) {
      state.menuClosed = true; // Esc closes the menu and keeps the text
      render();
    }
    return;
  }
  if (!inPaste && data === '\x1b\x1b') {
    if (!state.working) {
      state.input = '';
      state.pastes = [];
      state.menuClosed = false;
      render();
    }
    return;
  }
  if (!inPaste && data === '\x03') {
    if (state.working) turnState.interrupted = true;
    else void endSession('prompt_input_exit').then(() => shutdown(0));
    return;
  }
  while (data.length > 0) {
    if (inPaste) {
      const end = data.indexOf(PASTE_END);
      if (end === -1) {
        pasteBuffer += data;
        return;
      }
      commitPaste(pasteBuffer + data.slice(0, end));
      pasteBuffer = '';
      inPaste = false;
      data = data.slice(end + PASTE_END.length);
      continue;
    }
    const start = data.indexOf(PASTE_START);
    const plain = start === -1 ? data : data.slice(0, start);
    for (const ch of plain) {
      if (ch === '\r') {
        pressEnter();
        continue;
      }
      // ConPTY drops the bracketed-paste markers before a Node child sees them, so a multi-line paste arrives
      // as plain text with LF: like the real CLI (Ctrl+J), LF inserts a line break instead of sending.
      if (ch === '\n') {
        state.input += '\n';
        state.menuClosed = false;
        continue;
      }
      if (ch === '\x7f' || ch === '\b') state.input = state.input.slice(0, -1);
      else if (ch >= ' ') state.input += ch;
      else continue;
      state.menuClosed = false;
    }
    if (start === -1) break;
    inPaste = true;
    data = data.slice(start + PASTE_START.length);
  }
  render();
}

// --------------------------------------------------------------------- main
// Like the real CLI: `-r <id>` with no transcript anywhere ends with an error and exit 1.
// Opt-in (DONEL_FAKE_CLAUDE_RESUME_STRICT=1) so scripted tests may resume any id.
function resumeTargetMissing() {
  if (!args.resume || process.env.DONEL_FAKE_CLAUDE_RESUME_STRICT !== '1') return false;
  const folder = cwd.replace(/[^A-Za-z0-9]/g, '-');
  return ![homeDir, join(homedir(), '.claude')].some((root) => existsSync(join(root, 'projects', folder, `${args.resume}.jsonl`)));
}

async function main() {
  if (resumeTargetMissing()) {
    out(`No conversation found with session ID: ${args.resume}\r\n`);
    setTimeout(() => process.exit(1), 300);
    return;
  }
  out('\x1b[?2004h');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', onData);
  process.stdin.on('end', () => void endSession('other').then(() => shutdown(0)));
  render();
  await startSession(args.resume ? 'resume' : 'startup');
  render();
}

process.on('SIGTERM', () => shutdown(0));
await main();
