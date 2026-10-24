// Q9/FR-017: how text sent through the PTY arrives in UserPromptSubmit.prompt and in the transcript (typed / bracketed paste / Ctrl+J newline / @mention).
const fs = require('fs');
const { allHooks, readTx } = require('../lib');
const CASES = [
  ['A typed single line (unicode, quotes, $, backticks, braces, backslash)', 'type', 'Reply with the single word OK. ünïcode ✓ "quotes" $dollar `ticks` {braces} [brackets] \\ backslash'],
  ['B bracketed paste, 2 short lines', 'paste', 'Reply with the single word OK.\nsecond line'],
  ['C typed with LF (Ctrl+J) between lines', 'typeLF', 'Reply with the single word OK.\nsecond line typed'],
  ['D bracketed paste, one long line (900 chars)', 'paste', 'Reply with the single word OK. ' + 'x'.repeat(870)],
  ['E typed @mention', 'type', 'Reply with the single word OK. Context: @notes.txt'],
  ['F typed with CRLF-ish: text containing a tab', 'type', 'Reply with the single word OK.\tafter tab'],
];
module.exports = {
  name: 's9b-input',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 300,
  setup(h) {
    fs.writeFileSync(h.cwd + '/notes.txt', 'alpha beta gamma\n');
    h.writeSettings(allHooks({ defaultTimeout: 30, only: ['UserPromptSubmit', 'Stop', 'SessionStart'] })); h.setPolicy([]);
  },
  async run(h) {
    let n = 0;
    for (const [label, mode, text] of CASES) {
      n++;
      h.log(`===== case ${label}`);
      if (mode === 'paste') { h.write('\x1b[200~' + text + '\x1b[201~'); }
      else if (mode === 'typeLF') { h.write(text.split('\n').join('\n')); }
      else h.write(text);
      await h.sleep(800);
      if (mode !== 'type' || true) { /* snapshot the input box once for the first multi-line cases */ }
      if (n <= 3 || n === 6) h.snap('input box before Enter, case ' + n);
      h.enter();
      await h.waitStops(n, 60000); await h.sleep(1200);
      const ups = h.hookStarts('UserPromptSubmit');
      const got = ups[ups.length - 1].input.prompt;
      h.log(`case ${n}: prompt==sent ? ${got === text} | sent=${JSON.stringify(text).slice(0, 120)} | got=${JSON.stringify(got).slice(0, 220)}`);
    }
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    h.log('transcript user messages:');
    for (const e of readTx(tp)) {
      if (e.type === 'user' && e.message) { const c = e.message.content; const t = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('|') : ''); if (t) h.log('  ' + JSON.stringify(t).slice(0, 260)); }
    }
  },
};
