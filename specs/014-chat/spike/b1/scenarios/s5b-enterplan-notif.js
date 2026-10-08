// Q2/Q5: (1) EnterPlanMode through PermissionRequest (does a plain allow work?), (2) Notification type for an unanswered AskUserQuestion dialog.
const { allHooks, summarizeHooks } = require('../lib');
const { ASK } = require('./ask-common');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
module.exports = {
  name: 's5b-enterplan-notif',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 240,
  debug: true,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60 }));
    h.setPolicy([{ id: 'enterplan-allow-plain', event: 'PermissionRequest', tool: 'EnterPlanMode', out: PR({ behavior: 'allow' }) }]);
  },
  async run(h) {
    h.watch('dialog', /enter plan mode|Enter to select|Esc to cancel/i);
    h.log('===== turn 1: EnterPlanMode with a plain allow from the hook');
    await h.submit('Call the EnterPlanMode tool right now (no other tools), then reply with the word ENTERED.');
    await h.sleep(20000);
    h.snap('20s after prompt');
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
    const mode = /plan mode on/i.test(h.viewportText());
    h.log('plan mode on screen = ' + mode);
    if (!mode) { h.log('dialog still open? pressing Enter to accept in TUI'); h.enter(); await h.sleep(5000); h.snap('after Enter'); }
    // leave plan mode back to default with shift+tab cycling is messy; just run turn 2 in whatever mode
    h.log('===== turn 2: unanswered AskUserQuestion -> Notification type/timing');
    const n0 = h.hooks().length;
    await h.submit(ASK);
    await h.waitHook((e) => e.phase === 'start' && e.ev === 'PermissionRequest' && e.input.tool_name === 'AskUserQuestion', 60000, 'PR ask');
    await h.sleep(10000);
    h.snap('ask dialog after 10s');
    for (const l of summarizeHooks(h.hooks().slice(n0))) h.log('  ' + l);
    h.write('\x1b');
    await h.sleep(2000);
  },
};
