// Q6: /compact -> SessionStart(source=compact)? new session_id/transcript? PreCompact/PostCompact payloads.
const { allHooks } = require('../lib');
const ID = '63a85fe8-e815-444b-9769-4ac70e70d026'; // the forked session (own spike session)
module.exports = {
  name: 's6d-compact', cwdName: 's1-perm',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local', '--resume', ID],
  maxSec: 180,
  setup(h) { h.writeSettings(allHooks({ defaultTimeout: 30, only: ['SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact', 'Stop', 'UserPromptSubmit', 'UserPromptExpansion'] })); h.setPolicy([]); },
  async run(h) {
    await h.sleep(3000);
    h.log('sending /compact'); await h.submit('/compact');
    await h.waitHook((e) => e.phase === 'start' && e.ev === 'PostCompact', 90000, 'PostCompact');
    await h.sleep(4000);
    h.snap('after compact');
    h.log('sending /exit'); await h.submit('/exit'); await h.sleep(5000);
    for (const e of h.hooks().filter((x) => x.phase === 'start')) {
      const i = e.input;
      const tpFile = i.transcript_path.split(/[\\/]/).pop();
      h.log(`${e.iso.slice(11, 23)} ${e.ev} source=${i.source} reason=${i.reason} trigger=${i.trigger} sid=${i.session_id.slice(0, 8)} tp=${tpFile} prompt=${JSON.stringify(i.prompt || '').slice(0, 50)} summaryLen=${i.compact_summary ? i.compact_summary.length : ''}`);
    }
  },
};
