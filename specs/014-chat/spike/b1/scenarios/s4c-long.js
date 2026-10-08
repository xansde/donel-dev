// Q4: the CLI waits for a long PermissionRequest hook (200s) with timeout 400 and then honours its allow.
const fs = require('fs');
const { allHooks, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
module.exports = {
  name: 's4c-long',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 330,
  debug: true,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60, timeouts: { PermissionRequest: 400 } }));
    h.setPolicy([{ id: 'pr-200s', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'lg1\.txt', sleepMs: 200000, out: PR({ behavior: 'allow' }) }]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to proceed/i);
    await h.submit('Use the Bash tool to run exactly this command and nothing else: touch lg1.txt . Then reply DONE.');
    const ok = await h.waitStops(1, 260000);
    await h.sleep(2000);
    h.log(`stop=${ok}; dialog=${JSON.stringify(h.seen('dialog'))}`);
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
    h.snap('final');
  },
};
