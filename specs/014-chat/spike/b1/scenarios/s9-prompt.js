// Q9 + Q5(idle): UserPromptSubmit payload exactness (multi-line paste), '!' bash mode, slash command expansion, queued message timing, Stop payload, idle_prompt.
const fs = require('fs');
const { allHooks, txSummary, summarizeHooks, readTx } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
const MULTI = 'Reply with the single word OK. Ignore the following lines.\nLine two with ünïcode ✓ and "quotes" and $dollar and `ticks`\n\n  indented line four\ttab';
module.exports = {
  name: 's9-prompt',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 400,
  debug: true,
  setup(h) {
    fs.mkdirSync(h.cwd + '/.claude/commands', { recursive: true });
    fs.writeFileSync(h.cwd + '/.claude/commands/b1cmd.md', '---\ndescription: b1 test command\nargument-hint: [word]\n---\nReply with the single word PONG followed by $ARGUMENTS.\n');
    h.writeSettings(allHooks({ defaultTimeout: 60 }));
    h.setPolicy([{ id: 'sleep-allow', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'sleep', out: PR({ behavior: 'allow' }) }]);
  },
  async run(h) {
    const ups = () => h.hookStarts('UserPromptSubmit');
    // 1. multi-line paste
    h.log('===== step 1: multi-line bracketed paste');
    await h.submit(MULTI, { paste: true });
    await h.waitStops(1, 60000); await h.sleep(1500);
    const p1 = ups()[0];
    h.log('step1 UserPromptSubmit.prompt exact match with sent text = ' + (p1 && p1.input.prompt === MULTI) + ' | got=' + JSON.stringify(p1 && p1.input.prompt));
    h.log('step1 UserPromptSubmit keys=' + Object.keys(p1.input).join(',') + ' source=' + p1.input.source);
    // 2. bang mode
    h.log('===== step 2: !echo bang-b1');
    let n0 = h.hooks().length;
    h.write('!'); await h.sleep(600); h.snap('after typing !');
    await h.submit('echo bang-b1'); await h.sleep(4000);
    for (const l of summarizeHooks(h.hooks().slice(n0))) h.log('  [bang] ' + l);
    h.snap('after bang');
    // 3. slash command
    h.log('===== step 3: /b1cmd X1');
    n0 = h.hooks().length;
    await h.submit('/b1cmd X1');
    await h.waitStops(2, 60000); await h.sleep(1500);
    for (const l of summarizeHooks(h.hooks().slice(n0))) h.log('  [slash] ' + l);
    // 4. queued message while a tool runs
    h.log('===== step 4: queue');
    n0 = h.hooks().length;
    await h.submit('Use the Bash tool to run exactly this command and nothing else: sleep 8 . Then reply with the single word DONE-A.');
    await h.waitHook((e) => e.phase === 'start' && e.ev === 'PreToolUse' && /sleep 8/.test((e.input.tool_input || {}).command || ''), 60000, 'PreToolUse sleep');
    await h.sleep(1500);
    h.log('submitting queued message B now (tool still running)');
    await h.submit('Also, after DONE-A, reply with the word DONE-B on a new line.');
    h.snap('queued message visible?');
    await h.sleep(30000);
    for (const l of summarizeHooks(h.hooks().slice(n0))) h.log('  [queue] ' + l);
    h.snap('after queue test');
    const lastStopIdx = h.hookStarts('Stop').length;
    // 5. idle
    h.log('===== step 5: idle 75s -> idle_prompt?');
    n0 = h.hooks().length;
    await h.sleep(75000);
    for (const l of summarizeHooks(h.hooks().slice(n0))) h.log('  [idle] ' + l);
    // dump
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    h.log('TRANSCRIPT user/queue entries:');
    for (const e of readTx(tp)) {
      if (e.type === 'queue-operation') h.log('  queue-operation ' + e.operation + ' ' + e.timestamp + ' ' + JSON.stringify((e.content || '').slice(0, 90)));
      else if (e.type === 'user') { const c = e.message && e.message.content; const t = typeof c === 'string' ? c : JSON.stringify(c).slice(0, 120); h.log('  user ' + (e.timestamp || '') + ' ' + JSON.stringify(t.slice(0, 140))); }
      else if (e.type === 'attachment' && /queued|command|prompt/.test(e.attachment && e.attachment.type)) h.log('  attachment ' + e.attachment.type + ' ' + JSON.stringify(e.attachment).slice(0, 200));
    }
    for (const st of h.hookStarts('Stop').slice(0, 2)) h.log('Stop payload: ' + JSON.stringify({ ...st.input, cwd: undefined, scratchpad_dir: undefined, transcript_path: undefined }));
    for (const st of h.hookStarts('UserPromptExpansion').slice(0, 1)) h.log('UserPromptExpansion payload: ' + JSON.stringify({ ...st.input, cwd: undefined, scratchpad_dir: undefined, transcript_path: undefined }));
    for (const st of h.hookStarts('Notification')) h.log('Notification payload: ' + JSON.stringify({ ...st.input, cwd: undefined, scratchpad_dir: undefined, transcript_path: undefined }));
  },
};
