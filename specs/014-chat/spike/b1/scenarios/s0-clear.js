// Q6: SessionStart payload, /clear -> SessionEnd(reason) + SessionStart(source=clear), /exit -> SessionEnd. No model turn.
const { allHooks } = require('../lib');
module.exports = {
  name: 's0-clear',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 120,
  setup(h) { h.writeSettings(allHooks()); h.setPolicy([]); },
  async run(h) {
    h.snap('after startup');
    h.log('sending /clear');
    await h.submit('/clear');
    await h.sleep(5000);
    h.snap('after /clear');
    h.log('sending /exit');
    await h.submit('/exit');
    await h.sleep(6000);
    h.snap('after /exit');
  },
};
