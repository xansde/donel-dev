// Q1/Q4: user answers in the TUI while the PermissionRequest hook is still pending -> who wins, is the hook process killed?
const fs = require('fs');
const { allHooks, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
module.exports = {
  name: 's4b-race',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 240,
  debug: true,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60, timeouts: { PermissionRequest: 120 } }));
    h.setPolicy([
      { id: 'pr-long-deny', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'rc1\.txt', sleepMs: 40000, out: PR({ behavior: 'deny', message: 'LATE DENY from hook (should be ignored if TUI answered first)' }) },
    ]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to proceed/i);
    h.log('===== turn 1: hook pending (40s then deny); user answers Yes in TUI after 4s');
    await h.submit('Use the Bash tool to run exactly this command and nothing else: touch rc1.txt . Then reply DONE.');
    const t0 = Date.now();
    while (Date.now() - t0 < 45000 && !h.seen('dialog').first) await h.sleep(250);
    await h.sleep(4000);
    const pr = h.hookStarts('PermissionRequest')[0];
    h.log(`hook pid=${pr.pid} alive before answer=${alive(pr.pid)}`);
    h.log('pressing Enter (1. Yes) in the TUI');
    h.enter();
    const ok = await h.waitStops(1, 40000);
    h.log(`stop=${ok}; hook pid alive right after Stop=${alive(pr.pid)}`);
    await h.sleep(3000);
    h.log(`hook pid alive 3s later=${alive(pr.pid)}`);
    await h.sleep(40000);
    h.log(`hook pid alive 43s later (after its own 40s sleep would have ended)=${alive(pr.pid)}`);
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
    h.snap('final');
  },
};
