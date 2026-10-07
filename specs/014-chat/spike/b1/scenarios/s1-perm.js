// Q1 + Q3(partial): PermissionRequest in manual (default) mode, isolated from global settings.
const fs = require('fs');
const { allHooks, txSummary, summarizeHooks } = require('../lib');
const PR = (o) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: o } });
module.exports = {
  name: 's1-perm',
  claudeArgs: ['--permission-mode', 'manual', '--setting-sources', 'project,local'],
  maxSec: 420,
  debug: true,
  setup(h) {
    fs.mkdirSync(h.cwd + '/.claude', { recursive: true });
    fs.writeFileSync(h.cwd + '/.claude/settings.local.json', JSON.stringify({ permissions: { allow: ['Bash(touch pre-allowed.txt)'] } }, null, 2));
    fs.writeFileSync(h.cwd + '/notes.txt', 'alpha beta gamma\n');
    h.writeSettings(allHooks({ defaultTimeout: 60 }));
    h.setPolicy([
      { id: 'allow-m1', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'm1\.txt', out: PR({ behavior: 'allow' }) },
      { id: 'deny-m2', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'm2\.txt', out: PR({ behavior: 'deny', message: 'BLOCKED-BY-DONEL-b1: the user declined this command, do not retry it' }) },
      { id: 'always-m3', event: 'PermissionRequest', tool: 'Bash', cmdRe: 'm3\.txt', out: PR({ behavior: 'allow', updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch m3.txt' }], behavior: 'allow', destination: 'localSettings' }] }) },
    ]);
  },
  async run(h) {
    h.watch('dialog', /Do you want to|don't ask again|Esc to cancel/i);
    const turns = [
      ['T1 Read (expect no PermissionRequest)', 'Use the Read tool to read notes.txt in the current directory. Reply with only its first word.'],
      ['T2 pre-allowed by localSettings rule', 'Use the Bash tool to run exactly this command and nothing else: touch pre-allowed.txt . Then reply DONE.'],
      ['T3 allow via hook (m1)', 'Use the Bash tool to run exactly this command and nothing else: touch m1.txt . Then reply DONE.'],
      ['T4 deny via hook with message (m2)', 'Use the Bash tool to run exactly this command and nothing else: touch m2.txt . Then reply with one sentence saying what happened and quote any message you received.'],
      ['T5 allow + addRules localSettings (m3)', 'Use the Bash tool to run exactly this command and nothing else: touch m3.txt . Then reply DONE.'],
    ];
    let n = 0, from = 0;
    for (const [label, prompt] of turns) {
      n++; h.resetWatch('dialog');
      h.log(`===== ${label}`);
      await h.submit(prompt);
      const ok = await h.waitStops(n, 90000);
      await h.sleep(1500);
      const all = h.hooks();
      h.log(`--- hooks during ${label} (stop reached=${ok}); dialog watch=${JSON.stringify(h.seen('dialog'))}`);
      for (const l of summarizeHooks(all.slice(from))) h.log('  ' + l);
      from = all.length;
      h.snap(label);
    }
    // T6: same m3 command again -> rule should now exist, PermissionRequest should NOT fire
    h.resetWatch('dialog');
    h.log('===== T6 repeat m3 (rule written?)');
    h.log('settings.local.json now: ' + fs.readFileSync(h.cwd + '/.claude/settings.local.json', 'utf8').replace(/\s+/g, ' '));
    await h.submit('Use the Bash tool to run exactly this command and nothing else: touch m3.txt . Then reply DONE.');
    await h.waitStops(6, 90000); await h.sleep(1500);
    const all = h.hooks();
    h.log('--- hooks during T6; dialog watch=' + JSON.stringify(h.seen('dialog')));
    for (const l of summarizeHooks(all.slice(from))) h.log('  ' + l);
    const tp = h.hookStarts('SessionStart')[0].input.transcript_path;
    h.log('TRANSCRIPT SUMMARY:');
    for (const l of txSummary(tp, 500)) h.log('  ' + l);
    h.log('files in cwd: ' + fs.readdirSync(h.cwd).join(', '));
  },
};
