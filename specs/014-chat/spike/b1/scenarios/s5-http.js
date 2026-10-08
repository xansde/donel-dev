// Bonus: type:"http" hooks (loopback) for PermissionRequest/PreToolUse/Notification/...: header interpolation, long answer, abort when the TUI answers first.
const fs = require('fs');
const { txSummary, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
const PORT = 47123;
const httpHook = (tag, timeout) => ({ hooks: [{ type: 'http', url: `http://127.0.0.1:${PORT}/hook/${tag}`, timeout, headers: { 'X-Donel-Token': '$B1_TOKEN' }, allowedEnvVars: ['B1_TOKEN'] }] });
module.exports = {
  name: 's5-http',
  http: { port: PORT },
  env: { B1_TOKEN: 'tok-b1-123' },
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 300,
  debug: true,
  setup(h) {
    h.writeSettings({ hooks: {
      PermissionRequest: [httpHook('PermissionRequest', 120)],
      PreToolUse: [httpHook('PreToolUse', 30)],
      Notification: [httpHook('Notification', 30)],
      SessionStart: [httpHook('SessionStart', 30)],
      Stop: [httpHook('Stop', 30)],
    } });
    h.setPolicy([
      { id: 'h1-allow-3s', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'h1\.txt', sleepMs: 3000, out: PR({ behavior: 'allow' }) },
      { id: 'ask-http', event: 'PermissionRequest', tool: 'AskUserQuestion', answerAsk: 0, answerList: ['Blue', 'Cheese, Olives'] },
      { id: 'h3-slow', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'h3\.txt', sleepMs: 30000, out: PR({ behavior: 'deny', message: 'LATE DENY via http' }) },
      { id: 'h4-deny', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'h4\.txt', out: PR({ behavior: 'deny', message: 'HTTP-DENY-b1: not allowed' }) },
    ]);
  },
  async run(h) {
    const { ASK } = require('./ask-common');
    h.watch('dialog', /Do you want to proceed/i);
    const T = (c) => `Use the Bash tool to run exactly this command and nothing else: touch ${c} . Then reply DONE.`;
    h.log('===== T1 allow via http after 3s');
    await h.submit(T('h1.txt')); await h.waitStops(1, 60000); await h.sleep(1500);
    h.log('===== T2 AskUserQuestion answered via http PermissionRequest');
    await h.submit(ASK); await h.waitStops(2, 60000); await h.sleep(1500);
    h.log('===== T3 TUI answers first while http hook pending (30s)');
    h.resetWatch('dialog');
    await h.submit(T('h3.txt'));
    const t0 = Date.now();
    while (Date.now() - t0 < 45000 && !h.seen('dialog').first) await h.sleep(250);
    await h.sleep(4000);
    h.log('pressing Enter in TUI'); h.enter();
    await h.waitStops(3, 60000); await h.sleep(35000);
    h.log('===== T4 deny with message via http');
    await h.submit(T('h4.txt')); await h.waitStops(4, 60000); await h.sleep(1500);
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
    for (const e of h.hooks().filter((x) => x.phase === 'aborted')) h.log('ABORTED record: ' + JSON.stringify(e));
    const first = h.hooks().find((x) => x.phase === 'start' && x.headers);
    h.log('sample headers seen by server: ' + JSON.stringify(first && first.headers));
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    for (const l of txSummary(tp, 300)) { if (/tool_result/.test(l)) h.log('  ' + l); }
  },
};
