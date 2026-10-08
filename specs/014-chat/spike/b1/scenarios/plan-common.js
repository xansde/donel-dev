const fs = require('fs');
const { allHooks, txSummary, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
// factory: name, rules (policy), extraNotes
module.exports = function make(name, rules, opts = {}) {
  return {
    name,
    claudeArgs: ['--permission-mode', opts.mode || 'plan', '--setting-sources', 'project,local'],
    maxSec: 300,
    debug: true,
    setup(h) { h.writeSettings(allHooks({ defaultTimeout: 60 })); h.setPolicy(rules); },
    async run(h) {
      h.watch('dialog', /Would you like to proceed|Ready to code|auto-accept edits|keep planning|Do you want to|No, keep/i);
      h.watch('planmode', /plan mode on/i);
      await h.submit(opts.prompt || 'Plan a trivial change: create a file hello.txt in the current directory containing the single word hi. Write the plan, then call ExitPlanMode with the plan. Do not create the file until the plan is approved.');
      const ok = await h.waitStops(1, opts.waitMs || 70000);
      await h.sleep(2500);
      h.log(`--- turn finished stop=${ok}; dialog=${JSON.stringify(h.seen('dialog'))}`);
      for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
      h.snap('final screen');
      const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
      h.log('TRANSCRIPT SUMMARY:');
      for (const l of txSummary(tp, 700)) h.log('  ' + l);
      h.log('files in cwd: ' + fs.readdirSync(h.cwd).join(', '));
      const ep = h.hookStarts('PermissionRequest').filter((e) => e.input.tool_name === 'ExitPlanMode');
      for (const e of ep) h.log('ExitPlanMode PermissionRequest input: ' + JSON.stringify({ ...e.input, transcript_path: undefined, cwd: undefined, scratchpad_dir: undefined }).slice(0, 1800));
      if (opts.extra) await opts.extra(h);
    },
  };
};
module.exports.PR = PR;
