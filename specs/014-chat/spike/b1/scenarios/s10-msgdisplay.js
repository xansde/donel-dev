// Bonus: MessageDisplay hook (streaming deltas of the assistant message) + PostToolBatch.
const fs = require('fs');
const { allHooks, summarizeHooks } = require('../lib');
module.exports = {
  name: 's10-msgdisplay',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 200,
  debug: true,
  setup(h) { h.writeSettings(allHooks({ defaultTimeout: 30, only: ['MessageDisplay', 'PostToolBatch', 'Stop', 'UserPromptSubmit', 'SessionStart', 'PostToolUse', 'PreToolUse'] })); h.setPolicy([]); },
  async run(h) {
    await h.submit('Read notes.txt with the Read tool, then write a numbered list of exactly 12 short lines about the number words one to twelve (one line each, no preamble), then a final line starting with END.');
    await h.waitStops(1, 90000); await h.sleep(2000);
    const md = h.hooks().filter((x) => x.phase === 'start' && x.ev === 'MessageDisplay');
    h.log(`MessageDisplay events: ${md.length}`);
    for (const e of md) h.log(`  ${e.iso.slice(11, 23)} turn=${e.input.turn_id.slice(0, 8)} msg=${e.input.message_id.slice(0, 8)} idx=${e.input.index} final=${e.input.final} delta=${JSON.stringify(e.input.delta).slice(0, 110)} keys=${Object.keys(e.input).join(',')}`);
    const others = h.hooks().filter((x) => x.phase === 'start' && !['MessageDisplay'].includes(x.ev));
    for (const e of others) h.log(`  ${e.iso.slice(11, 23)} ${e.ev} ${e.input.tool_name || ''}`);
    const pb = h.hooks().find((x) => x.phase === 'start' && x.ev === 'PostToolBatch');
    if (pb) h.log('PostToolBatch payload: ' + JSON.stringify({ ...pb.input, cwd: undefined, scratchpad_dir: undefined, transcript_path: undefined }).slice(0, 700));
    h.snap('final');
  },
};
