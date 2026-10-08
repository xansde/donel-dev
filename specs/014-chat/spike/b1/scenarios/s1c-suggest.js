// Q1: permission_suggestions catalogue for several tools/commands + deny with interrupt:true.
const fs = require('fs');
const { allHooks, txSummary, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
module.exports = {
  name: 's1c-suggest',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 300,
  debug: true,
  setup(h) {
    fs.writeFileSync(h.cwd + '/notes.txt', 'alpha beta gamma\n');
    h.writeSettings(allHooks({ defaultTimeout: 60 }));
    h.setPolicy([
      { id: 'intr', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'intr\.txt', out: PR({ behavior: 'deny', message: 'STOP NOW (interrupt true)', interrupt: true }) },
      { id: 'allow-all', event: 'PermissionRequest', out: PR({ behavior: 'allow' }) },
    ]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to/i);
    h.log('===== turn 1: several bash commands + edit + write');
    await h.submit('Do these one at a time, each with its own tool call, and nothing else: (1) Bash: mkdir newdir1 (2) Bash: cp notes.txt notes2.txt (3) Bash: npm --version (4) Bash: echo hi > out.txt (5) Bash: git init (6) Use the Edit tool to replace "alpha" with "ALPHA" in notes.txt (after reading it) (7) Use the Write tool to create w1.txt containing the word w1. Then reply DONE.');
    const ok = await h.waitStops(1, 120000); await h.sleep(2000);
    h.log('stop=' + ok);
    for (const e of h.hooks().filter((x) => x.phase === 'start' && x.ev === 'PermissionRequest')) {
      const ti = e.input.tool_input || {};
      h.log(`PR ${e.input.tool_name} ${JSON.stringify(ti.command || ti.file_path || '').slice(0, 70)} tx=${JSON.stringify(e.tx)}`);
      h.log('     suggestions=' + JSON.stringify(e.input.permission_suggestions));
      if (e.input.tool_name === 'Edit') h.log('     Edit tool_input keys=' + Object.keys(ti).join(','));
    }
    const pre = h.hooks().filter((x) => x.phase === 'start' && x.ev === 'PreToolUse').map((e) => e.input.tool_name + ':' + (e.input.tool_input.command || e.input.tool_input.file_path || '').slice(0, 30)).join(' | ');
    h.log('PreToolUse seq: ' + pre);
    h.log('===== turn 2: deny with interrupt:true');
    const nStops = h.hookStarts('Stop').length;
    await h.submit('Use the Bash tool to run exactly this command and nothing else: touch intr.txt . Then reply DONE.');
    await h.sleep(15000);
    h.log('Stop hooks count before/after interrupt turn: ' + nStops + ' -> ' + h.hookStarts('Stop').length);
    h.snap('after interrupt deny');
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    for (const l of txSummary(tp, 300)) { if (/tool_result|user text|assistant text/.test(l) && /intr|Request|STOP|interrupt|reject/i.test(l)) h.log('  ' + l); }
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
  },
};
