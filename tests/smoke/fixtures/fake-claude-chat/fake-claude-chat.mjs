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
// Held PermissionRequest hooks (permission/ask/plan steps) wait this long for the app's decision before falling back to the TUI dialog.
const permissionTimeoutMs = Number(process.env.DONEL_FAKE_CLAUDE_PERMISSION_TIMEOUT_MS || 600000);
// A message containing "demorar" makes the round last this long (interruptible), so smokes can queue / interrupt.
const slowMs = Number(process.env.DONEL_FAKE_CLAUDE_SLOW_MS || 3000);
// Swallows the first Enter that has text in the box (a lost Enter), to exercise the driver's single `\r` resend.
let dropFirstEnter = process.env.DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER === '1';
// `1`: while a round runs the box and footer are not drawn (a long tool call, as the real CLI 2.1.314 sometimes does).
const hideBoxWhileWorking = process.env.DONEL_FAKE_CLAUDE_HIDE_BOX_WHILE_WORKING === '1';

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
async function fireHook(event, extra = {}, options = {}) {
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
      signal: AbortSignal.timeout(options.timeoutMs ?? (event === 'PermissionRequest' ? Math.max(hookTimeoutMs, 1000) : hookTimeoutMs)),
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
const state = { dialog: false, working: false, input: '', pastes: [], history: [], menuClosed: false, images: 0 };
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
  if (permissionQueue.length > 0) {
    out(`\x1b[2J\x1b[H${permissionDialogLines(permissionQueue[0]).join('\r\n')}`);
    return;
  }
  if (state.dialog) {
    // `/pick`: a model-selection dialog that replaces the input box and stays until Esc (smoke of the "terminal needed" strip).
    const dialog = ['▔'.repeat(Math.max(20, process.stdout.columns || 100)), 'Select model', '', '  ❯ 1. Default (recommended) ✔', '    2. Fake Model', '', '  Enter to confirm · Esc to exit'];
    out(`\x1b[2J\x1b[H${dialog.join('\r\n')}`);
    return;
  }
  const lines = [' ▐▛███▜▌   Claude Code v2.1.293', `▝▜█████▛▘  Fake Model · fake-claude-chat`, ` ▘▘ ▝▝    ${cwd}`, ''];
  lines.push(...state.history.slice(-12));
  for (const queued of pending) lines.push(`  ⎿ queued: ${queued.replace(/\n/g, ' ').slice(0, 60)}`);
  if (hideBoxWhileWorking && state.working) {
    lines.push('  ● Bash(npx vitest run)', '    ⎿  Running…');
    out(`[2J[H${lines.join('
')}`);
    return;
  }
  menuMatches().slice(0, 6).forEach((c, i) => lines.push(i === 0 ? `  ❯ ${c}` : `    ${c}`));
  const [firstRow, ...nextRows] = inputRows();
  lines.push(ruler(), `❯ ${firstRow}`, ...nextRows.map((row) => `  ${row}`), ruler());
  lines.push(state.working ? '  esc to interrupt' : state.input === '' ? '  ? for shortcuts' : '  ! for shell mode');
  // The real CLI shows the permission mode in the footer; the smokes use it as the "ready for keys" signal.
  if (args.permissionMode === 'acceptEdits' && !state.working) lines.push('  ⏵⏵ accept edits on (shift+tab to cycle)');
  out(`\x1b[2J\x1b[H${lines.join('\r\n')}`);
}

/**
 * Rows the box draws for the typed text, as the real CLI 2.1.293 does (captured in
 * specs/014-chat/spike/b2/logs/q6.txt, "long-wrapped" and the Shift+Enter shapes): a real LF starts a
 * new row, a long line wraps at the last space that fits the terminal width, the space at the wrap
 * point is NOT drawn, and every row after the first is indented by 2 columns (the first row carries the
 * "❯ " mark). Text area width = columns - 2. Words longer than the area are hard-cut.
 * Assumption (no capture): the exact width the real CLI wraps at; the spike shows 116-char rows on a
 * 120-column terminal, which this model reproduces.
 */
function inputRows() {
  const width = Math.max(10, (process.stdout.columns || 100) - 2);
  const rows = [];
  for (let rest of state.input.split('\n')) {
    while (rest.length > width) {
      const cut = rest.lastIndexOf(' ', width);
      if (cut <= 0) {
        rows.push(rest.slice(0, width));
        rest = rest.slice(width);
      } else {
        rows.push(rest.slice(0, cut));
        rest = rest.slice(cut + 1);
      }
    }
    rows.push(rest);
  }
  return rows;
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
    case 'permission':
    case 'ask':
    case 'bash_permission':
    case 'edit_permission':
    case 'plan':
      await handlePermission(expandPermissionStep(step));
      break;
    case 'subagent_permissions': {
      // Two (or more) subagents asking at the same time: SubagentStart for each, all requests held in parallel.
      const requests = (step.requests ?? []).map((request, i) => expandPermissionStep({ type: 'permission', agentId: `agent-${i + 1}`, agentType: 'general-purpose', ...request }));
      for (const request of requests) await fireHook('SubagentStart', { agent_id: request.agentId, agent_type: request.agentType });
      await Promise.all(requests.map((request) => handlePermission(request)));
      for (const request of requests) await fireHook('SubagentStop', { agent_id: request.agentId, agent_type: request.agentType });
      break;
    }
    default:
      break;
  }
}

// -------------------------------------------------------------- permissions
// Held-permission steps (T080). Mirrors hook-bridge.md section 3: PreToolUse, then PermissionRequest held until the
// app answers or the TUI dialog is keyed (first answer wins; a late hook answer is ignored and only logged).
const permissionQueue = []; // dialogs on screen, head first; each is a pending request

const COMMON_FIELDS = ['id', 'agentId', 'agentType', 'result', 'delayMs', 'denyReply', 'transcript', 'suggestions'];

function expandPermissionStep(step) {
  const common = Object.fromEntries(COMMON_FIELDS.filter((k) => step[k] !== undefined).map((k) => [k, step[k]]));
  if (step.type === 'ask') return { ...common, name: 'AskUserQuestion', input: { questions: step.questions ?? [] } };
  if (step.type === 'bash_permission') {
    const rule = step.rule ?? `${String(step.command ?? '').split(/\s+/).slice(0, 2).join(' ')}:*`;
    const suggestions = step.suggestions ?? [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: rule }], behavior: 'allow', destination: 'localSettings' }];
    return { ...common, suggestions, name: 'Bash', input: { command: step.command ?? '', description: step.description ?? '' } };
  }
  if (step.type === 'edit_permission') return { ...common, name: 'Edit', input: { file_path: step.file_path ?? '', old_string: step.old_string ?? '', new_string: step.new_string ?? '' } };
  if (step.type === 'plan') return { ...common, name: 'ExitPlanMode', input: { plan: step.plan ?? '', planFilePath: step.planFilePath ?? '' } };
  return { ...common, name: step.name ?? 'Bash', input: step.input ?? {} };
}

/** The hook's decision, or null when the CLI would not act on it (empty body, unknown behavior, ExitPlanMode allow without updatedInput). */
function effectiveDecision(body, spec) {
  const decision = body?.hookSpecificOutput?.decision;
  if (!decision || typeof decision !== 'object') return null;
  if (decision.behavior === 'deny') return decision;
  if (decision.behavior === 'allow') {
    if (spec.name === 'ExitPlanMode' && !decision.updatedInput) return null; // ignored by the real CLI on this tool
    return decision;
  }
  return null;
}

function summarizeInput(spec) {
  const i = spec.input;
  return String(i.command ?? i.file_path ?? i.questions?.[0]?.question ?? i.planFilePath ?? JSON.stringify(i)).replace(/\s+/g, ' ').slice(0, 70);
}

function askOptions(entry) {
  return entry.spec.input.questions?.[0]?.options ?? [];
}

function permissionDialogLines(entry) {
  const { spec } = entry;
  const bar = '▔'.repeat(Math.max(20, process.stdout.columns || 100));
  const queue = permissionQueue.length > 1 ? ` (1 of ${permissionQueue.length})` : '';
  const agent = spec.agentId ? `  Subagent ${spec.agentId} (${spec.agentType ?? 'general-purpose'}) requests permission` : '';
  const head = [bar, `${spec.name}${queue}`, ...(agent ? [agent] : []), `  ${summarizeInput(spec)}`, ''];
  if (spec.name === 'AskUserQuestion') {
    const q = spec.input.questions?.[0];
    return [...head, `  ${q?.question ?? ''}`, ...askOptions(entry).map((o, i) => `  ${i === 0 ? '❯' : ' '} ${i + 1}. ${o.label ?? o}`), '', '  Esc to cancel'];
  }
  if (spec.name === 'ExitPlanMode') {
    return [...head, 'Would you like to proceed?', '', '  ❯ 1. Yes, and auto-accept edits', "    2. Yes, and don't ask again", '    3. No, keep planning', '', '  Esc to cancel'];
  }
  return [...head, 'Do you want to proceed?', '  ❯ 1. Yes', `    2. Yes, and don't ask again for ${spec.name} commands in ${cwd}`, '    3. No, and tell Claude what to do differently', '', '  Esc to cancel'];
}

/** Rules for "always allow": the suggested addRules (destination forced to localSettings) or the bare tool name. */
function alwaysAllowPermissions(spec) {
  const suggested = (spec.suggestions ?? []).filter((s) => s.type === 'addRules').map((s) => ({ ...s, destination: 'localSettings' }));
  return suggested.length > 0 ? suggested : [{ type: 'addRules', rules: [{ toolName: spec.name }], behavior: 'allow', destination: 'localSettings' }];
}

function answerPermissionByKey(data) {
  const entry = permissionQueue[0];
  const esc = data === '\x1b';
  if (!esc && !/^[1-9]$/.test(data)) return;
  let decision = null;
  if (entry.spec.name === 'AskUserQuestion') {
    const options = askOptions(entry);
    if (esc) decision = { behavior: 'deny' };
    else if (Number(data) <= options.length) {
      const answers = {};
      (entry.spec.input.questions ?? []).forEach((q, i) => {
        const list = q.options ?? [];
        const pick = i === 0 ? list[Number(data) - 1] : list[0];
        answers[q.question] = pick?.label ?? pick ?? '';
      });
      decision = { behavior: 'allow', updatedInput: { ...entry.spec.input, answers } };
    }
  } else if (esc || data === '3') decision = { behavior: 'deny' };
  else if (data === '1') decision = { behavior: 'allow' };
  else if (data === '2') decision = { behavior: 'allow', updatedPermissions: alwaysAllowPermissions(entry.spec) };
  if (decision) entry.finish('tui', decision);
}

function writeLocalRules(permissions) {
  const folder = join(cwd, '.claude');
  const file = join(folder, 'settings.local.json');
  let current = {};
  try {
    current = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // no file yet
  }
  current.permissions = current.permissions ?? {};
  for (const permission of permissions) {
    if (permission.type !== 'addRules' || (permission.destination ?? 'localSettings') !== 'localSettings') continue;
    const behavior = permission.behavior ?? 'allow';
    const list = Array.isArray(current.permissions[behavior]) ? current.permissions[behavior] : [];
    for (const rule of permission.rules ?? []) {
      const text = rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName;
      if (!list.includes(text)) list.push(text);
    }
    current.permissions[behavior] = list;
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}

function defaultResult(spec, input) {
  if (spec.result !== undefined) return spec.result;
  if (spec.name === 'AskUserQuestion') {
    const pairs = Object.entries(input.answers ?? {}).map(([q, a]) => `"${q}"="${a}"`).join(', ');
    return `User has answered your questions: ${pairs}. You can now continue with the user's answers in mind.`;
  }
  if (spec.name === 'ExitPlanMode') return 'User has approved your plan. You can now start coding.';
  if (spec.name === 'Edit') return `The file ${input.file_path ?? ''} has been updated successfully.`;
  return 'ok';
}

async function handlePermission(spec) {
  const id = spec.id ?? `toolu_${randomUUID().slice(0, 12)}`;
  const agent = spec.agentId ? { agent_id: spec.agentId, agent_type: spec.agentType ?? 'general-purpose' } : {};
  // Subagent calls live in the subagent's own file in the real CLI, so by default they stay out of the main transcript.
  const inTranscript = spec.transcript ?? !spec.agentId;
  if (inTranscript) appendAssistant({ type: 'tool_use', id, name: spec.name, input: spec.input, caller: { type: 'direct' } });
  note(`● ${spec.name}(${summarizeInput(spec)})`);
  await fireHook('PreToolUse', { tool_name: spec.name, tool_input: spec.input, tool_use_id: id, ...agent });

  const outcome = await new Promise((resolve) => {
    const entry = { spec, id, settled: false };
    entry.finish = (source, decision) => {
      if (entry.settled) return false;
      entry.settled = true;
      const at = permissionQueue.indexOf(entry);
      if (at >= 0) permissionQueue.splice(at, 1);
      render();
      resolve({ source, decision });
      return true;
    };
    permissionQueue.push(entry);
    render();
    // PermissionRequest has no tool_use_id in the real CLI: the app correlates by the (agent, tool, input) triple.
    const payload = { tool_name: spec.name, tool_input: spec.input, ...(spec.suggestions ? { permission_suggestions: spec.suggestions } : {}), ...agent };
    void fireHook('PermissionRequest', payload, { timeoutMs: permissionTimeoutMs }).then((body) => {
      const decision = effectiveDecision(body, spec);
      logCall({ hookResponse: 'PermissionRequest', tool_use_id: id, tool_name: spec.name, ...agent, body, effective: decision !== null });
      if (decision && !entry.finish('hook', decision)) logCall({ lateHookResponse: 'PermissionRequest', tool_use_id: id });
    });
  });

  const { source, decision } = outcome;
  logCall({ permissionOutcome: decision.behavior, source, tool_use_id: id, tool_name: spec.name, ...agent });
  if (decision.behavior === 'deny') {
    if (decision.interrupt) {
      turnState.interrupted = true; // aborts the round; runTurn writes `[Request interrupted by user]`
      return;
    }
    const message = decision.message ?? "The user doesn't want to proceed with this tool use. The tool use was rejected.";
    if (inTranscript) appendToolResult(id, message, true);
    note(`  ⎿  ${message}`);
    if (spec.denyReply) {
      appendAssistant({ type: 'text', text: spec.denyReply });
      note(`● ${spec.denyReply}`);
    }
    return;
  }
  const input = decision.updatedInput ?? spec.input;
  if (Array.isArray(decision.updatedPermissions)) writeLocalRules(decision.updatedPermissions);
  await sleep(spec.delayMs ?? 0);
  const result = defaultResult(spec, input);
  if (inTranscript) appendToolResult(id, result, false);
  await fireHook('PostToolUse', { tool_name: spec.name, tool_input: input, tool_use_id: id, tool_response: { output: result }, ...agent });
}

async function runTurn(text, queued = false) {
  state.working = true;
  turnState.interrupted = false;
  render();
  const startedAt = Date.now();
  appendUser(text, { turnOrigin: 'human', promptSource: queued ? 'queued' : 'typed' });
  await fireHook('UserPromptSubmit', { prompt: text });
  if (/demorar|cancelavel/.test(text)) await sleepInterruptible(slowMs);
  // A message containing "cancelavel": Esc before the first answer makes the CLI drop the request and give the text
  // back to ITS box (no assistant line, no "[Request interrupted]", no Stop hook) - the real CLI at 09/10 (e2e 19.5).
  if (/cancelavel/.test(text) && turnState.interrupted) {
    state.input = text;
    state.working = false;
    turnState.counter += 1;
    render();
    return;
  }
  const turn = pickTurn(text);
  for (const step of turn.steps ?? []) {
    if (turnState.interrupted) break;
    await runStep(step);
  }
  if (turnState.interrupted) {
    appendUser([{ type: 'text', text: '[Request interrupted by user]' }]);
    note('  ⎿  Interrupted · What should Claude do instead?');
  } else if (!turn.skipTurnDuration) {
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
  } else if (name === '/pick') {
    state.dialog = true;
    render();
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

// ConPTY drops the bracketed-paste markers (see onData), so a LARGE paste arrives as plain chunks of text with LF
// and no marker. The real CLI collapses a big paste into `[Pasted text #N +M lines]` (T089); to stay faithful the
// fake treats a marker-less chunk of 5+ lines or 1000+ characters as a paste, and the chunks that follow it within
// BURST_WINDOW_MS (the PTY splits one write into several) as the continuation of the same paste.
const BURST_WINDOW_MS = 250;
let burstIdx = -1;
let burstAt = 0;
function commitBurst(chunk) {
  const now = Date.now();
  const text = chunk.replace(/\r\n|\r/g, '\n');
  const big = (text.match(/\n/g) ?? []).length >= 4 || text.length >= 1000;
  if (burstIdx >= 0 && now - burstAt < BURST_WINDOW_MS) {
    state.pastes[burstIdx] += text;
    const lineCount = state.pastes[burstIdx].split('\n').length;
    state.input = state.input.replace(
      new RegExp(`\\[Pasted text #${burstIdx + 1} \\+\\d+ lines\\]`),
      `[Pasted text #${burstIdx + 1} +${lineCount - 1} lines]`,
    );
    burstAt = now;
    return true;
  }
  if (!big) {
    burstIdx = -1;
    return false;
  }
  commitPaste(text);
  burstIdx = state.pastes.length - 1;
  burstAt = now;
  return true;
}

// ConPTY drops the bracketed-paste markers (see onData), so an image path pasted by the app arrives as plain
// typed text. Like the real CLI, an absolute image path that ends up at the start of the box (or right after
// another `[Image #N]`) becomes the `[Image #N]` placeholder.
const TYPED_IMAGE_PATH = /(^|\])((?:[A-Za-z]:[\\/]|\/)[^\r\n]*\.(?:png|jpe?g|gif|webp))$/i;
function convertTypedImagePath() {
  const match = TYPED_IMAGE_PATH.exec(state.input);
  if (!match) return;
  state.images += 1;
  state.input = `${state.input.slice(0, match.index)}${match[1]}[Image #${state.images}]`;
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
  if (permissionQueue.length > 0) {
    answerPermissionByKey(data);
    return;
  }
  if (state.dialog) {
    if (data === '\x1b') {
      state.dialog = false;
      render();
    }
    return;
  }
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
    if (start === -1 && plain.length > 1 && !/[\r\x1b\x7f\b]/.test(plain) && commitBurst(plain)) break;
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
    convertTypedImagePath();
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
