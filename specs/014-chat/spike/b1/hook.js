// Generic logging + policy-driven hook for the 014-chat verification spike.
// env: B1_HOOKLOG (jsonl path), B1_POLICY (json path, re-read on every call)
// argv[2]: free tag (identifies which settings entry fired)
const fs = require('fs');
const LOG = process.env.B1_HOOKLOG;
const POLICY = process.env.B1_POLICY;
const tag = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function matches(r, input) {
  const ev = input.hook_event_name;
  if (r.event) {
    const evs = Array.isArray(r.event) ? r.event : [r.event];
    if (!evs.includes(ev)) return false;
  }
  if (r.tag && r.tag !== tag) return false;
  if (r.tool && !new RegExp('^(' + r.tool + ')$').test(input.tool_name || '')) return false;
  if (r.cmdRe) {
    const c = input.tool_input && (input.tool_input.command || input.tool_input.file_path || '');
    if (!new RegExp(r.cmdRe).test(String(c))) return false;
  }
  if (r.agent === 'main' && input.agent_id) return false;
  if (r.agent === 'sub' && !input.agent_id) return false;
  if (r.promptRe && !new RegExp(r.promptRe).test(String(input.prompt || ''))) return false;
  return true;
}

function tpl(v, input) {
  if (v === '$INPUT') return input.tool_input;
  if (v === '$SUGGESTIONS') return input.permission_suggestions;
  if (v === '$COMMAND') return input.tool_input && input.tool_input.command;
  if (Array.isArray(v)) return v.map((x) => tpl(x, input));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = tpl(x, input);
    return o;
  }
  return v;
}

function answerAsk(input, idx, evName, byIndex) {
  const ti = input.tool_input || {};
  const answers = {};
  (ti.questions || []).forEach((q, qi) => {
    if (Array.isArray(byIndex) && byIndex[qi] !== undefined) { answers[q.question] = byIndex[qi]; return; }
    const opt = (q.options || [])[idx] || (q.options || [])[0] || { label: 'x' };
    answers[q.question] = opt.label;
  });
  const updatedInput = { ...ti, answers };
  if (evName === 'PermissionRequest') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput } } };
  }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } };
}

let d = '';
process.stdin.on('data', (c) => (d += c)).on('end', async () => {
  const t0 = Date.now();
  let input;
  try { input = JSON.parse(d); } catch (e) { input = { _raw: d, _err: String(e) }; }
  let policy = { rules: [] };
  try { policy = JSON.parse(fs.readFileSync(POLICY, 'utf8')); } catch {}
  const ev = input.hook_event_name;
  // optional per-rule use counter (rule.maxUses), state kept next to the policy file
  const stateFile = (POLICY || '') + '.state';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const rule = (policy.rules || []).find((r) => matches(r, input) && !(r.maxUses !== undefined && (state[r.id] || 0) >= r.maxUses));
  if (rule && rule.maxUses !== undefined) {
    state[rule.id] = (state[rule.id] || 0) + 1;
    try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
  }
  // probe: is the thing this hook is about already visible in the transcript file at hook time?
  let tx = null;
  try {
    if (input.transcript_path && fs.existsSync(input.transcript_path)) {
      const txt = fs.readFileSync(input.transcript_path, 'utf8');
      tx = { size: txt.length };
      if (input.tool_use_id) tx.hasToolUseId = txt.includes(input.tool_use_id);
      if (ev === 'PermissionRequest') {
        const ti = input.tool_input || {};
        const needle = ti.command || ti.file_path || ti.plan || (ti.questions && ti.questions[0] && ti.questions[0].question) || '';
        tx.hasToolUseByInput = needle ? txt.includes(JSON.stringify(String(needle)).slice(1, 41)) : null;
      }
      if (ev === 'UserPromptSubmit') tx.hasPrompt = txt.includes(JSON.stringify(String(input.prompt || '')).slice(1, 31));
    } else tx = { exists: false };
  } catch (e) { tx = { err: String(e) }; }
  try {
    fs.appendFileSync(LOG, JSON.stringify({ phase: 'start', t0, iso: new Date(t0).toISOString(), tag, pid: process.pid, ev, rule: rule ? rule.id || true : null, tx, input }) + '\n');
  } catch {}
  if (rule && rule.sleepMs) await sleep(rule.sleepMs);
  let out;
  if (rule) {
    if (rule.answerAsk !== undefined) out = answerAsk(input, rule.answerAsk, ev, rule.answerList);
    else if (rule.out !== undefined) out = tpl(rule.out, input);
  }
  if (out !== undefined) process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out));
  if (rule && rule.stderr) process.stderr.write(rule.stderr);
  try {
    fs.appendFileSync(LOG, JSON.stringify({ phase: 'end', t1: Date.now(), tag, pid: process.pid, ev, out, exit: rule && rule.exit }) + '\n');
  } catch {}
  process.exit((rule && rule.exit) || 0);
});
