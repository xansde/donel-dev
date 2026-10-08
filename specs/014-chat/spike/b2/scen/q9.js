// Q9 - interactive screens that replace/steal the input box: open each (paste + Enter), snapshot, try to dismiss.
const mk = require('./lib');
const CMDS = (process.env.CMDS || '/help,/model,/resume,/config,/permissions,/mcp,/status,/agents,/hooks,/memory,/theme,/doctor,/usage,/context,/cost,/skills,/plugin,/release-notes,/export,/rewind,/add-dir,/output-style,/tasks,/stats,/effort,/clear').split(',');

module.exports = async (A) => {
  let s = A.start({ name: 'q9', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(2000);
  let H = mk(A, s);
  const out = [];
  const rec = (o) => { out.push(o); console.log(JSON.stringify(o)); };
  const regionLines = () => {
    const ls = s.screenLines();
    // the last "dialog" region: from the last line starting with the heavy bar or from the box top to the end
    let start = ls.map((l, i) => (/^▔{10,}/.test(l.trim()) ? i : -1)).filter((i) => i >= 0).pop();
    if (start == null) start = Math.max(0, ls.length - 8);
    return ls.slice(start).map((l) => l.trim()).filter(Boolean);
  };
  for (const cmd of CMDS) {
    if (s.exited) { rec({ cmd, note: 'session exited before' }); break; }
    await H.smartClear();
    s.paste(cmd, 'paste');
    await H.until((st) => st.kind === 'typed', 3000);
    await A.sleep(200);
    // close slash menu if open (Esc closes only the menu), then Enter
    const menuOpen = s.screenLines().some((l) => /^\s*❯\s+\/\S+/.test(l) && !/^❯/.test(l));
    if (menuOpen && !process.env.NOMENU) { s.write('\x1b', 'esc-menu'); await A.sleep(250); }
    const t0 = s.t();
    s.write('\r', 'enter');
    await H.settle(900, 7000);
    const afterKind = s.box().kind;
    const reg = regionLines();
    s.snap('after ' + cmd);
    const row = { cmd, menuWasOpen: menuOpen, boxAfterEnter: afterKind, region: reg.slice(0, 3).map((l) => l.slice(0, 90)), regionLast: (reg[reg.length - 1] || '').slice(0, 110), settleMs: s.t() - t0 };
    // dismiss
    const dismiss = [];
    for (const [name, seq] of [['Esc', '\x1b'], ['Esc', '\x1b'], ['q', 'q']]) {
      const st = s.boxState();
      if (st.kind === 'empty' && st.mark === '❯' && !/Rewind|Select model|Esc to cancel/.test(s.screenText().split('\n').slice(-22).join('\n'))) break;
      s.write(seq, 'dismiss-' + name);
      dismiss.push(name);
      await H.settle(600, 4000);
      if (s.exited) break;
    }
    row.dismissKeys = dismiss;
    row.boxAfterDismiss = s.box().kind;
    row.exited = !!s.exited;
    const okNow = s.boxState().kind === 'empty' && s.boxState().mark === '❯';
    if (!okNow && !s.exited) { row.restarted = true; await s.kill(); s = A.start({ name: 'q9-r' + out.length, cwd: A.dir('cwd'), quiet: true }); await s.ready(); await A.sleep(1500); H = mk(A, s); }
    rec(row);
    s.snap('after-dismiss ' + cmd);
    if (s.exited) break;
  }
  require('fs').writeFileSync(A.dir('logs/q9-results.json'), JSON.stringify(out, null, 1));
};
