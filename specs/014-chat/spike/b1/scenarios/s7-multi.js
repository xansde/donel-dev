// Q7: two hooks on the same event with conflicting decisions (isolated from global settings).
const fs = require('fs');
const { B1, txSummary, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
const PRE = (d, why) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d, permissionDecisionReason: why } });
const cmd = (tag) => ({ type: 'command', command: `node "${B1}/hook.js" ${tag}`, timeout: 30 });
module.exports = {
  name: 's7-multi',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 300,
  debug: true,
  setup(h) {
    h.writeSettings({ hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [cmd('PreA'), cmd('PreB')] }],
      PermissionRequest: [{ matcher: 'Bash', hooks: [cmd('PrA'), cmd('PrB')] }],
      Stop: [{ hooks: [cmd('Stop')] }],
      SessionStart: [{ hooks: [cmd('SessionStart')] }],
    } });
    h.setPolicy([
      { id: 'mp1-A-deny', tag: 'PreA', event: 'PreToolUse', cmdRe: 'mp1\.txt', out: PRE('deny', 'A says deny') },
      { id: 'mp1-B-allow-late', tag: 'PreB', event: 'PreToolUse', cmdRe: 'mp1\.txt', sleepMs: 1500, out: PRE('allow', 'B says allow') },
      { id: 'mp2-A-allow', tag: 'PreA', event: 'PreToolUse', cmdRe: 'mp2\.txt', out: PRE('allow', 'A says allow') },
      { id: 'mp2-B-deny-late', tag: 'PreB', event: 'PreToolUse', cmdRe: 'mp2\.txt', sleepMs: 1500, out: PRE('deny', 'B says deny') },
      { id: 'mp3-A-ask', tag: 'PreA', event: 'PreToolUse', cmdRe: 'mp3\.txt', out: PRE('ask', 'A says ask') },
      { id: 'mp3-B-allow', tag: 'PreB', event: 'PreToolUse', cmdRe: 'mp3\.txt', out: PRE('allow', 'B says allow') },
      { id: 'mp3-PrA-allow', tag: 'PrA', event: 'PermissionRequest', cmdRe: 'mp3\.txt', out: PR({ behavior: 'allow' }) },
      { id: 'mr1-A-deny', tag: 'PrA', event: 'PermissionRequest', cmdRe: 'mr1\.txt', out: PR({ behavior: 'deny', message: 'PR-A denies (fast)' }) },
      { id: 'mr1-B-allow-late', tag: 'PrB', event: 'PermissionRequest', cmdRe: 'mr1\.txt', sleepMs: 1500, out: PR({ behavior: 'allow' }) },
      { id: 'mr2-A-allow', tag: 'PrA', event: 'PermissionRequest', cmdRe: 'mr2\.txt', out: PR({ behavior: 'allow' }) },
      { id: 'mr2-B-deny-late', tag: 'PrB', event: 'PermissionRequest', cmdRe: 'mr2\.txt', sleepMs: 1500, out: PR({ behavior: 'deny', message: 'PR-B denies (late)' }) },
    ]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to proceed/i);
    let n = 0, from = 0;
    for (const f of ['mp1', 'mp2', 'mp3', 'mr1', 'mr2']) {
      n++;
      h.log(`===== turn ${n}: ${f}`);
      await h.submit(`Use the Bash tool to run exactly this command and nothing else: touch ${f}.txt . Then reply with one word: DONE if the command ran, BLOCKED if it did not.`);
      const ok = await h.waitStops(n, 50000);
      await h.sleep(2500);
      const all = h.hooks();
      h.log(`--- ${f}: stop=${ok}; file exists=${fs.existsSync(h.cwd + '/' + f + '.txt')}`);
      for (const l of summarizeHooks(all.slice(from).filter((e) => e.tag !== 'SessionStart' && e.tag !== 'Stop'))) h.log('  ' + l);
      from = all.length;
    }
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    for (const l of txSummary(tp, 260)) { if (/tool_use Bash|tool_result|assistant text/.test(l)) h.log('  ' + l); }
  },
};
