// Q5 + Q3: AskUserQuestion with NO answering hook -> which Notification fires and when; then Esc; then idle_prompt wait.
const fs = require('fs');
const { allHooks, txSummary, summarizeHooks } = require('../lib');
const { ASK } = require('./ask-common');
module.exports = {
  name: 's3c-ask-unanswered',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 300,
  debug: true,
  setup(h) { h.writeSettings(allHooks({ defaultTimeout: 60 })); h.setPolicy([]); },
  async run(h) {
    await h.submit(ASK);
    h.log('waiting 14s for dialog + notification');
    await h.sleep(14000);
    h.snap('ask dialog open, nobody answered');
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
    h.log('pressing Esc');
    h.write('\x1b');
    const ok = await h.waitStops(1, 30000);
    await h.sleep(2000);
    h.snap('after Esc, stop=' + ok);
    let from = h.hooks().length;
    h.log('now idle: waiting 80s for idle_prompt Notification');
    await h.sleep(80000);
    for (const l of summarizeHooks(h.hooks().slice(from))) h.log('  [idle] ' + l);
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    h.log('TRANSCRIPT SUMMARY:');
    for (const l of txSummary(tp, 600)) { if (!/^\s*attachment|atis-latch|ai-title|file-history/.test(l)) h.log('  ' + l); }
    const notifs = h.hookStarts('Notification');
    for (const e of notifs) h.log('Notification payload: ' + JSON.stringify({ ...e.input, transcript_path: undefined, cwd: undefined, scratchpad_dir: undefined, session_id: undefined }));
  },
};
