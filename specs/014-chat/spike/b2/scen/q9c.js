// Q9c - edit-permission dialog in a clean-room session (user-level settings excluded so no global hook/allow rule auto-approves).
const mk = require('./lib');
module.exports = async (A) => {
  const rec = (o) => console.log(JSON.stringify(o));
  const s = A.start({ name: 'q9c-perm', cwd: A.dir('cwd'), quiet: true, extraArgs: ['--setting-sources', 'project,local'] });
  // boot: handle the external-imports dialog if it shows up (default selection is "No", Enter keeps it)
  let importsSeen = null;
  for (let i = 0; i < 400; i++) {
    const text = s.screenText();
    if (/disable external imports/.test(text) && importsSeen == null) { importsSeen = s.t(); s.snap('external-imports dialog', { show: 12 }); await A.sleep(1200); s.write('\r', 'imports-enter'); await A.sleep(1200); }
    const b = s.box();
    if ((b.kind === 'empty' || b.kind === 'typed') && s.footer()) break;
    await A.sleep(50);
  }
  rec({ importsDialogSeenAt: importsSeen, ready: s.t() });
  await A.sleep(2500);
  s.snap('boot', { show: 8 });
  const e = (s.paste('Create a file named spike-perm2.txt in the current directory containing the text hi. Use the Write tool.', 'paste'), await A.sleep(200), s.write('\r', 'enter'));
  const r = await s.waitFor(() => /Do you want to|Esc to cancel/.test(s.screenText()) && /\n\s*(❯\s*)?1\.\s/.test(s.screenText()), { timeout: 60000 });
  await A.sleep(1200);
  s.snap('perm dialog', { show: 22 });
  const notif = s.hooks().filter((h) => h.event === 'Notification').map((h) => ({ t: (h.startedAt - s.t0) - e, type: h.in.notification_type, msg: String(h.in.message).slice(0, 100) }));
  rec({ appeared: r.ok, afterEnterMs: r.ok ? r.t - e : null, notifications: notif, box: s.box().kind });
  s.write('\x1b', 'esc-reject'); await A.sleep(1500);
  s.snap('after esc', { show: 8 });
  await s.kill();
};
