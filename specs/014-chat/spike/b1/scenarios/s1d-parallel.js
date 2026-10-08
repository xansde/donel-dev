// Q1: two parallel tool calls in one assistant message -> are PermissionRequests raised together or one at a time?
const fs = require('fs');
const { allHooks, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
module.exports = {
  name: 's1d-parallel',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 120,
  debug: true,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60, only: ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionStart'] }));
    h.setPolicy([{ id: 'slow-allow', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'par[12]\.txt', sleepMs: 4000, out: PR({ behavior: 'allow' }) }]);
  },
  async run(h) {
    await h.submit('In ONE response, call the Bash tool twice in parallel (two tool calls in the same message): "touch par1.txt" and "touch par2.txt". Then reply DONE.');
    const ok = await h.waitStops(1, 60000); await h.sleep(1500);
    h.log('stop=' + ok + ' files=' + fs.readdirSync(h.cwd).join(','));
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
  },
};
