// Q4/Q5: hook timeout behaviour (PreToolUse + PermissionRequest, timeout 5s vs hook sleeping 10s) and Notification timing.
const fs = require('fs');
const { allHooks, txSummary, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
const PRE = (o) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...o } });
module.exports = {
  name: 's4a-timeout',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 300,
  debug: true,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60, timeouts: { PreToolUse: 5, PermissionRequest: 5 } }));
    h.setPolicy([
      { id: 'pre-slow', event: 'PreToolUse', tool: 'Bash', cmdRe: 'to1\.txt', sleepMs: 10000, out: PRE({ permissionDecision: 'allow', permissionDecisionReason: 'late allow' }) },
      { id: 'pr-slow', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'to2\.txt', sleepMs: 10000, out: PR({ behavior: 'allow' }) },
    ]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to proceed/i);
    let n = 0, from = 0;
    for (const cmd of ['to1.txt', 'to2.txt']) {
      n++;
      h.resetWatch('dialog');
      h.log(`===== turn ${n}: touch ${cmd}`);
      await h.submit(`Use the Bash tool to run exactly this command and nothing else: touch ${cmd} . Then reply DONE.`);
      // wait for the dialog to be on screen at least 8s
      const t0 = Date.now();
      while (Date.now() - t0 < 45000 && !h.seen('dialog').first) await h.sleep(250);
      h.log(`dialog first seen at ${h.seen('dialog').first}s`);
      // let the timeout (5s) and notification (6s) elapse with the dialog still open
      await h.sleep(14000);
      h.snap('14s after dialog open');
      h.log('pressing Enter (1. Yes) in the TUI');
      h.enter();
      const ok = await h.waitStops(n, 40000);
      await h.sleep(1500);
      const all = h.hooks();
      h.log(`--- turn ${n} stop=${ok} dialog=${JSON.stringify(h.seen('dialog'))}`);
      for (const l of summarizeHooks(all.slice(from))) h.log('  ' + l);
      from = all.length;
    }
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
  },
};
