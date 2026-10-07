// Q4: very large timeout values (overflow of setTimeout?): PermissionRequest timeout=3000000s (~34d, > 2^31 ms), PreToolUse timeout=86400.
const fs = require('fs');
const { allHooks, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
module.exports = {
  name: 's4d-bigtimeout',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 120,
  debug: true,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60, timeouts: { PermissionRequest: 3000000, PreToolUse: 86400 } }));
    h.setPolicy([{ id: 'pr-3s', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'big1\.txt', sleepMs: 3000, out: PR({ behavior: 'allow' }) }]);
  },
  async run(h) {
    await h.submit('Use the Bash tool to run exactly this command and nothing else: touch big1.txt . Then reply DONE.');
    const ok = await h.waitStops(1, 60000); await h.sleep(1500);
    h.log('stop=' + ok + ' files=' + fs.readdirSync(h.cwd).join(','));
    for (const l of summarizeHooks(h.hooks().filter((e) => ['PermissionRequest', 'PreToolUse'].includes(e.ev)))) h.log('  ' + l);
  },
};
