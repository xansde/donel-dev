// Q8: hooks inside a subagent (agent_id/agent_type), SubagentStart/SubagentStop payloads, PermissionRequest from a subagent.
const fs = require('fs');
const { allHooks, txSummary, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
module.exports = {
  name: 's8-subagent',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 240,
  debug: true,
  setup(h) {
    h.writeSettings(allHooks({ defaultTimeout: 60 }));
    h.setPolicy([{ id: 'sub-allow', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'sa1\.txt', out: PR({ behavior: 'allow' }) }]);
  },
  async run(h) {
    await h.submit('Use the Agent tool exactly once with subagent_type "general-purpose", description "touch test", and prompt: "Run exactly this bash command with the Bash tool and nothing else: touch sa1.txt . Then reply with the single word DONE." After the subagent finishes, reply with its result.');
    // wait for SubagentStop of a real subagent (agent_type non-empty) then the final Stop
    const sub = await h.waitHook((e) => e.phase === 'start' && e.ev === 'SubagentStop' && e.input.agent_type, 120000, 'real SubagentStop');
    await h.sleep(20000);
    for (const l of summarizeHooks(h.hooks())) h.log('  ' + l);
    const strip = (i) => ({ ...i, cwd: undefined, scratchpad_dir: undefined });
    for (const e of h.hooks().filter((x) => x.phase === 'start' && ['SubagentStart', 'SubagentStop'].includes(x.ev))) h.log(`${e.ev} payload: ` + JSON.stringify(strip(e.input)));
    const pre = h.hooks().filter((x) => x.phase === 'start' && x.ev === 'PermissionRequest' && x.input.agent_id);
    for (const e of pre) h.log('sub PermissionRequest payload: ' + JSON.stringify(strip(e.input)).slice(0, 900));
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    h.log('main transcript path: ' + tp);
    h.log('TRANSCRIPT SUMMARY:');
    for (const l of txSummary(tp, 500)) { if (!/^\s*attachment|atis-latch|ai-title|file-history/.test(l)) h.log('  ' + l); }
    const dir = tp.replace(/\.jsonl$/, '');
    h.log('session dir exists=' + fs.existsSync(dir) + ' listing: ' + (fs.existsSync(dir) ? JSON.stringify(fs.readdirSync(dir)) : ''));
    if (fs.existsSync(dir + '/subagents')) h.log('subagents dir: ' + JSON.stringify(fs.readdirSync(dir + '/subagents')));
    h.log('files: ' + fs.readdirSync(h.cwd).join(','));
    h.snap('final');
  },
};
