// Tiny HTTP hook server for the spike: POST /hook/<tag> with the hook input JSON; policy-driven reply.
// Logs 'start'/'end'/'aborted' records into the same JSONL as hook.js (tag prefixed with 'http:').
const http = require('http');
const fs = require('fs');

function matches(r, input, tag) {
  const ev = input.hook_event_name;
  if (r.event) { const evs = Array.isArray(r.event) ? r.event : [r.event]; if (!evs.includes(ev)) return false; }
  if (r.tool && !new RegExp('^(' + r.tool + ')$').test(input.tool_name || '')) return false;
  if (r.cmdRe) { const c = input.tool_input && (input.tool_input.command || input.tool_input.file_path || ''); if (!new RegExp(r.cmdRe).test(String(c))) return false; }
  if (r.agent === 'main' && input.agent_id) return false;
  if (r.agent === 'sub' && !input.agent_id) return false;
  return true;
}
function tpl(v, input) {
  if (v === '$INPUT') return input.tool_input;
  if (v === '$SUGGESTIONS') return input.permission_suggestions;
  if (Array.isArray(v)) return v.map((x) => tpl(x, input));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = tpl(x, input); return o; }
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
  if (evName === 'PermissionRequest') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput } } };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } };
}

module.exports = function start({ port, policyFile, hookLog }) {
  const log = (o) => { try { fs.appendFileSync(hookLog, JSON.stringify(o) + '\n'); } catch {} };
  let seq = 0;
  const server = http.createServer((req, res) => {
    const id = ++seq;
    const tag = 'http:' + (req.url || '').split('/').pop();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const t0 = Date.now();
      let input; try { input = JSON.parse(body); } catch (e) { input = { _raw: body.slice(0, 200), _err: String(e) }; }
      let policy = { rules: [] }; try { policy = JSON.parse(fs.readFileSync(policyFile, 'utf8')); } catch {}
      const rule = (policy.rules || []).find((r) => matches(r, input, tag));
      const hdr = { method: req.method, url: req.url, 'content-type': req.headers['content-type'], 'user-agent': req.headers['user-agent'], 'x-donel-token': req.headers['x-donel-token'], authorization: req.headers['authorization'] ? '(present)' : undefined, remote: req.socket.remoteAddress };
      log({ phase: 'start', t0, iso: new Date(t0).toISOString(), tag, pid: 'http#' + id, ev: input.hook_event_name, rule: rule ? rule.id || true : null, headers: hdr, input });
      let aborted = false;
      res.on('close', () => { if (!res.writableEnded) { aborted = true; log({ phase: 'aborted', t1: Date.now(), tag, pid: 'http#' + id, ev: input.hook_event_name, afterMs: Date.now() - t0 }); } });
      if (rule && rule.sleepMs) await new Promise((r) => setTimeout(r, rule.sleepMs));
      if (aborted) return;
      let out;
      if (rule) { if (rule.answerAsk !== undefined) out = answerAsk(input, rule.answerAsk, input.hook_event_name, rule.answerList); else if (rule.out !== undefined) out = tpl(rule.out, input); }
      res.writeHead(rule && rule.status ? rule.status : 200, { 'Content-Type': 'application/json' });
      res.end(out === undefined ? '' : (typeof out === 'string' ? out : JSON.stringify(out)));
      log({ phase: 'end', t1: Date.now(), tag, pid: 'http#' + id, ev: input.hook_event_name, out });
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
};
