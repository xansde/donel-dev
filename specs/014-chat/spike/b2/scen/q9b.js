// Q9b - model-driven blocking dialogs: edit permission, AskUserQuestion, plan-mode exit. One tiny haiku turn each. Always rejected with Esc.
const mk = require('./lib');

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'perm,ask,plan').split(',');
  const rec = (o) => console.log(JSON.stringify(o));
  const dialogRows = (s) => {
    const ls = s.screenLines();
    let start = ls.map((l, i) => (/^\s*▔{10,}/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
    if (start == null) start = Math.max(0, ls.length - 14);
    return ls.slice(start).map((l) => l.trim().replace(/▔{6,}/g, '▔▔▔').replace(/─{6,}/g, '───')).filter(Boolean);
  };
  async function run(name, permissionMode, prompt, waitRe) {
    const s = A.start({ name: 'q9b-' + name, cwd: A.dir('cwd'), quiet: true, permissionMode });
    await s.ready();
    await A.sleep(2500);
    const H = mk(A, s);
    const e = (s.paste(prompt, 'paste'), await A.sleep(150), s.write('\r', 'enter'));
    const r = await s.waitFor(() => { const b = s.box(); return (b.kind === 'menu' || b.kind === 'unreadable') && /Esc to cancel|Enter to confirm|to select|^s*(❯s*)?1.s/m.test(s.screenText()); }, { timeout: 60000 });
    await A.sleep(1200);
    const rows = dialogRows(s);
    s.snap(name + ' dialog');
    const notif = s.hooks().filter((h) => h.event === 'Notification').map((h) => ({ t: (h.startedAt - s.t0) - e, type: h.in.notification_type, msg: String(h.in.message).slice(0, 100) }));
    rec({ name, appeared: r.ok, afterEnterMs: r.ok ? r.t - e : null, boxKindWhileDialog: s.box().kind, rows: rows.slice(0, 16).map((x) => x.slice(0, 120)), notifications: notif });
    // reject with a single Esc
    s.write('\x1b', 'esc-reject'); await A.sleep(1500);
    rec({ name, afterEsc: { boxKind: s.box().kind, rows: dialogRows(s).slice(-6).map((x) => x.slice(0, 100)) } });
    await s.kill();
  }
  if (PARTS.includes('perm')) await run('perm', 'default', 'Create a file named spike-perm.txt in the current directory containing the text hi. Use the Write tool.', /Do you want to (create|make|proceed)|Create file|Esc to cancel/);
  if (PARTS.includes('ask')) await run('ask', 'default', 'Use the AskUserQuestion tool to ask me whether I prefer Red or Blue (two options), then wait for my answer. Do nothing else.', /Esc to cancel|Enter to select|Which|prefer/);
  if (PARTS.includes('plan')) await run('plan', 'plan', 'Plan how to create a file hello.txt containing the text hi. When the plan is ready call ExitPlanMode with a 2 line plan. Do not write any files.', /Would you like to proceed|Ready to code|Esc to cancel|proceed/);
};
