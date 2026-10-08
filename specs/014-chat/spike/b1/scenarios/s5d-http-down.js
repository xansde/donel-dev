// HTTP hooks pointing at a CLOSED port (app down): does the CLI fail open quickly (tool proceeds; dialog shows)?
module.exports = {
  name: 's5d-http-down',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 90,
  debug: true,
  setup(h) {
    const u = (t) => ({ hooks: [{ type: 'http', url: `http://127.0.0.1:47199/hook/${t}`, timeout: 30 }] });
    h.writeSettings({ hooks: { PreToolUse: [u('PreToolUse')], PermissionRequest: [u('PermissionRequest')], Stop: [u('Stop')] } });
    h.setPolicy([]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to proceed/i);
    const t0 = Date.now();
    await h.submit('Use the Bash tool to run exactly this command and nothing else: touch hd1.txt . Then reply DONE.');
    while (Date.now() - t0 < 45000 && !h.seen('dialog').first) await h.sleep(200);
    h.log('dialog first seen at ' + h.seen('dialog').first + 's (submit at ~' + ((t0 - Date.now()) / 1000 + 0).toFixed(1) + ')');
    await h.sleep(1500);
    h.enter();
    await h.sleep(5000);
    h.snap('after Enter');
  },
};
