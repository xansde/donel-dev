// HTTP hook: on timeout does the CLI abort the request (server can observe it)? and fall back to the TUI dialog?
const fs = require('fs');
const { summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
const PORT = 47123;
module.exports = {
  name: 's5c-http-timeout',
  http: { port: PORT },
  env: { B1_TOKEN: 'tok-b1-123' },
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 120,
  debug: true,
  setup(h) {
    h.writeSettings({ hooks: { PermissionRequest: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${PORT}/hook/PermissionRequest`, timeout: 4, headers: { 'X-Donel-Token': '$B1_TOKEN' }, allowedEnvVars: ['B1_TOKEN'] }] }] } });
    h.setPolicy([{ id: 'slow', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'ht1\.txt', sleepMs: 12000, out: PR({ behavior: 'allow' }) }]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to proceed/i);
    await h.submit('Use the Bash tool to run exactly this command and nothing else: touch ht1.txt . Then reply DONE.');
    const t0 = Date.now();
    while (Date.now() - t0 < 45000 && !h.seen('dialog').first) await h.sleep(250);
    await h.sleep(8000);
    h.log('dialog still open after the 4s hook timeout = ' + /Do you want to proceed/i.test(h.viewportText()));
    h.enter();
    await h.waitStops(1, 40000); await h.sleep(1500);
    for (const e of h.hooks()) h.log('  ' + e.phase + ' ' + e.ev + ' ' + (e.t0 ? new Date(e.t0).toISOString().slice(11, 23) : e.t1 ? new Date(e.t1).toISOString().slice(11, 23) : '') + (e.afterMs ? ' afterMs=' + e.afterMs : ''));
  },
};
