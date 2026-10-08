const fs = require('fs');
const { allHooks, txSummary, summarizeHooks } = require('../lib');
const ASK = 'Use the AskUserQuestion tool now to ask me two questions in a single call. Question 1: "Which color?" with header "Color" and options "Red" and "Blue" (single choice). Question 2: "Which toppings?" with header "Toppings" and options "Cheese", "Ham", "Olives" with multiSelect true. After I answer, reply with one line stating both answers exactly as you received them.';
module.exports = function make(name, rules, opts = {}) {
  return {
    name,
    claudeArgs: ['--permission-mode', opts.mode || 'manual', '--setting-sources', 'project,local'],
    maxSec: opts.maxSec || 240,
    debug: true,
    setup(h) { h.writeSettings(allHooks({ defaultTimeout: opts.hookTimeout || 60, timeouts: opts.timeouts || {} })); h.setPolicy(rules); },
    async run(h) {
      h.watch('dialog', /Which color|Which toppings|Esc to cancel|Enter to select/i);
      const turns = opts.turns || [ASK];
      let n = 0, from = 0;
      for (const t of turns) {
        n++;
        h.log(`===== turn ${n}`);
        h.resetWatch('dialog');
        await h.submit(t);
        const ok = await h.waitStops(n, opts.waitMs || 60000);
        await h.sleep(opts.afterMs ?? 2500);
        h.log(`--- turn ${n} stop=${ok}; dialog=${JSON.stringify(h.seen('dialog'))}`);
        const all = h.hooks();
        for (const l of summarizeHooks(all.slice(from))) h.log('  ' + l);
        from = all.length;
        h.snap('turn ' + n);
        if (!ok && opts.onNoStop) await opts.onNoStop(h);
      }
      const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
      h.log('TRANSCRIPT SUMMARY:');
      for (const l of txSummary(tp, 900)) { if (!/^\s*attachment|atis-latch|ai-title|file-history/.test(l)) h.log('  ' + l); }
      const ask = h.hookStarts().filter((e) => e.input.tool_name === 'AskUserQuestion');
      for (const e of ask.slice(0, 2)) h.log(`AskUserQuestion ${e.ev} input.tool_input: ` + JSON.stringify(e.input.tool_input).slice(0, 1500) + ' sugg=' + JSON.stringify(e.input.permission_suggestions));
    },
  };
};
module.exports.ASK = ASK;
