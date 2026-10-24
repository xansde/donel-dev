// shared helpers for scenarios
const B1 = __dirname.split('\\').join('/');
const EVENTS = ['PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','PermissionDenied','Notification','UserPromptSubmit','UserPromptExpansion','SessionStart','SessionEnd','Stop','StopFailure','SubagentStart','SubagentStop','PreCompact','PostCompact','Elicitation','ElicitationResult','MessageDisplay','PostToolBatch'];
// returns a settings object that logs every event through hook.js
function allHooks({ timeouts = {}, defaultTimeout = 30, only = null, matchers = {} } = {}) {
  const hooks = {};
  for (const ev of EVENTS) {
    if (only && !only.includes(ev)) continue;
    const entry = { hooks: [{ type: 'command', command: `node "${B1}/hook.js" ${ev}`, timeout: timeouts[ev] ?? defaultTimeout }] };
    if (matchers[ev] !== undefined) entry.matcher = matchers[ev];
    hooks[ev] = [entry];
  }
  return { hooks };
}
module.exports = { B1, EVENTS, allHooks };

// ---- transcript helpers ----
const fs = require('fs');
function readTx(p) {
  try { return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { _bad: l.slice(0, 80) }; } }); } catch (e) { return []; }
}
// compact summary of tool_use / tool_result / text blocks in a transcript
function txSummary(p, max = 400) {
  const out = [];
  for (const e of readTx(p)) {
    const c = e.message && e.message.content;
    const who = e.type + (e.isSidechain ? '[side]' : '') + (e.agentId ? '[' + e.agentId.slice(0, 6) + ']' : '');
    if (typeof c === 'string') { out.push(`${who} text: ${c.slice(0, max).replace(/\n/g, ' ')}`); continue; }
    if (!Array.isArray(c)) { if (e.type !== 'file-history-snapshot' && e.type !== 'mode' && e.type !== 'permission-mode' && e.type !== 'bridge-session' && e.type !== 'cost-state' && e.type !== 'last-prompt') out.push(`${who} ${e.subtype || ''} ${JSON.stringify(e.content || '').slice(0, max)}`); continue; }
    for (const b of c) {
      if (b.type === 'tool_use') out.push(`${who} tool_use ${b.name} id=${b.id.slice(-6)} ${JSON.stringify(b.input).slice(0, max)}`);
      else if (b.type === 'tool_result') out.push(`${who} tool_result id=${(b.tool_use_id || '').slice(-6)} is_error=${b.is_error} ${JSON.stringify(b.content).slice(0, max)}${e.toolUseResult ? ' | toolUseResult=' + JSON.stringify(e.toolUseResult).slice(0, 200) : ''}`);
      else if (b.type === 'text') out.push(`${who} text: ${b.text.slice(0, max).replace(/\n/g, ' ')}`);
    }
  }
  return out;
}
module.exports.readTx = readTx;
module.exports.txSummary = txSummary;

// one-line summary per hook start/end record
function hookLine(e) {
  if (e.phase === 'end') return `    └ end ${e.ev} +${e.t1 - (e._t0 || e.t1)}ms out=${e.out === undefined ? '-' : JSON.stringify(e.out).slice(0, 220)}`;
  const i = e.input || {};
  const ti = i.tool_input;
  const bits = [];
  if (i.tool_name) bits.push('tool=' + i.tool_name);
  if (ti && ti.command) bits.push('cmd=' + JSON.stringify(ti.command).slice(0, 80));
  else if (ti && ti.file_path) bits.push('file=' + ti.file_path.split(/[\/]/).pop());
  else if (ti && ti.questions) bits.push('q=' + JSON.stringify(ti.questions[0].question).slice(0, 60));
  else if (ti && ti.plan) bits.push('plan=' + JSON.stringify(ti.plan).slice(0, 60));
  if (i.tool_use_id) bits.push('tuid=' + i.tool_use_id.slice(-6));
  if (i.agent_id) bits.push('agent=' + i.agent_id.slice(0, 8) + '/' + i.agent_type);
  else if (i.agent_type) bits.push('agent_type=' + i.agent_type);
  if (i.permission_mode) bits.push('pm=' + i.permission_mode);
  if (i.notification_type) bits.push('ntype=' + i.notification_type + ' msg=' + JSON.stringify(i.message).slice(0, 70));
  if (i.prompt !== undefined) bits.push('prompt=' + JSON.stringify(i.prompt).slice(0, 70) + (i.source ? ' src=' + i.source : ''));
  if (i.source && i.prompt === undefined) bits.push('source=' + i.source);
  if (i.reason) bits.push('reason=' + JSON.stringify(i.reason).slice(0, 60));
  if (i.permission_suggestions) bits.push('sugg=' + JSON.stringify(i.permission_suggestions).slice(0, 160));
  if (e.rule) bits.push('rule=' + e.rule);
  return `${new Date(e.t0).toISOString().slice(11, 23)} ${e.ev} ${bits.join(' ')}`;
}
function summarizeHooks(entries) {
  const starts = new Map();
  const lines = [];
  for (const e of entries) {
    if (e.phase === 'start') { starts.set(e.pid, e.t0); lines.push(hookLine(e)); }
    else lines.push(hookLine({ ...e, _t0: starts.get(e.pid) }));
  }
  return lines;
}
module.exports.hookLine = hookLine;
module.exports.summarizeHooks = summarizeHooks;
