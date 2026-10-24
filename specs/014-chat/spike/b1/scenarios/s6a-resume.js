// Q6: SessionStart source for --resume / --resume --fork-session / in-session /resume.
const { allHooks } = require('../lib');
const ID = '5d18be85-2042-4a1f-a6f6-a38e1ac4f698'; // a finished session in work/s1-perm
const mk = (name, extra, afterFn) => ({
  name, cwdName: 's1-perm',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local', ...extra],
  maxSec: 120,
  setup(h) { h.writeSettings(allHooks({ defaultTimeout: 30, only: ['SessionStart', 'SessionEnd'] })); h.setPolicy([]); },
  async run(h) {
    await h.sleep(3000);
    h.snap('after startup');
    if (afterFn) await afterFn(h);
    h.log('sending /exit'); await h.submit('/exit'); await h.sleep(5000);
    for (const e of h.hooks().filter((x) => x.phase === 'start')) {
      const tpFile = e.input.transcript_path.split(/[\\/]/).pop();
      h.log(`${e.ev} source=${e.input.source} reason=${e.input.reason} sid=${e.input.session_id.slice(0, 8)} tp=${tpFile} extra=${JSON.stringify({ model: e.input.model, secs: e.input.seconds_since_last_response, ctx: e.input.context_tokens, cacheExp: e.input.prompt_cache_likely_expired })}`);
    }
  },
});
module.exports = mk('s6a-resume', ['--resume', ID]);
module.exports.mk = mk;
