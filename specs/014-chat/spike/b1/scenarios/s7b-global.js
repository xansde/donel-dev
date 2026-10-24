// Q7 + realism: the user's REAL global settings (hooks + permissions) are active (no --setting-sources), plus our --settings hooks.
const fs = require('fs');
const { allHooks, txSummary, summarizeHooks, readTx } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
const PRE = (d, why) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d, permissionDecisionReason: why } });
module.exports = {
  name: 's7b-global',
  claudeArgs: ['--permission-mode', 'manual'],
  maxSec: 300,
  debug: true,
  startupWaitMs: 12000,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60 }));
    h.setPolicy([
      { id: 'gl1-deny', event: 'PreToolUse', tool: 'Bash', cmdRe: 'gl1\.txt', out: PRE('deny', 'SESSION hook denies gl1 (global hooks probably allow)') },
      { id: 'ask-pr', event: 'PermissionRequest', tool: 'AskUserQuestion', answerAsk: 0, answerList: ['Blue', 'Cheese, Olives'] },
    ]);
  },
  async run(h) {
    const { ASK } = require('./ask-common');
    let from = 0;
    const T = (c) => `Use the Bash tool to run exactly this command and nothing else: touch ${c} . Then reply with one word: DONE if the command ran, BLOCKED if it did not.`;
    h.log('===== turn 1: gl1 (session PreToolUse denies; global hooks allow?)');
    await h.submit(T('gl1.txt')); await h.waitStops(1, 60000); await h.sleep(2500);
    h.log('===== turn 2: gl2 (no session rule; global allow rule + hook)');
    await h.submit(T('gl2.txt')); await h.waitStops(2, 60000); await h.sleep(2500);
    h.log('===== turn 3: AskUserQuestion answered by our PermissionRequest hook under real global config');
    await h.submit(ASK); await h.waitStops(3, 60000); await h.sleep(2500);
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    for (const l of txSummary(tp, 300)) { if (/tool_use (Bash|AskUser)|tool_result|assistant text/.test(l)) h.log('  ' + l); }
    h.log('hook-related transcript attachments:');
    for (const e of readTx(tp)) {
      const a = e.attachment; if (!a) continue;
      if (/hook/i.test(a.type)) h.log('  ' + a.type + ' ' + JSON.stringify({ hookName: a.hookName, hookEvent: a.hookEvent, command: a.command && String(a.command).slice(0, 110), content: a.content && String(a.content).slice(0, 80), decision: a.decision }));
    }
    h.snap('final');
  },
};
