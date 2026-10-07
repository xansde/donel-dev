// SessionStart via a command hook that just curls the app (no node dependency); SessionEnd via type:http; /clear to see both.
const PORT = 47123;
module.exports = {
  name: 's6e-curl-sessionstart',
  http: { port: PORT },
  env: { B1_TOKEN: 'tok-b1-123' },
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 90,
  debug: true,
  setup(h) {
    const curl = { type: 'command', command: `curl -s -X POST -H "X-Donel-Token: $B1_TOKEN" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:${PORT}/hook/SessionStart`, timeout: 10 };
    h.writeSettings({ hooks: {
      SessionStart: [{ hooks: [curl] }],
      SessionEnd: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${PORT}/hook/SessionEnd`, timeout: 5, headers: { 'X-Donel-Token': '$B1_TOKEN' }, allowedEnvVars: ['B1_TOKEN'] }] }],
    } });
    h.setPolicy([]);
  },
  async run(h) {
    await h.sleep(2000);
    await h.submit('/clear'); await h.sleep(4000);
    await h.submit('/exit'); await h.sleep(4000);
    for (const e of h.hooks().filter((x) => x.phase === 'start')) h.log(`${e.iso.slice(11, 23)} ${e.tag} ev=${e.ev} source=${e.input.source} reason=${e.input.reason} sid=${(e.input.session_id || '').slice(0, 8)} hdr=${JSON.stringify(e.headers && e.headers['x-donel-token'])}`);
  },
};
