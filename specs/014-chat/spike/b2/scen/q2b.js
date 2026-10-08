// Q2b - paste + Enter delay (using local shell-mode commands: no model turn), Enter with menu open, unknown slash, rewind-on-empty.
const mk = require('./lib');

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'delay,menu-enter').split(',');
  const s = A.start({ name: 'q2b', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(2000);
  const H = mk(A, s);
  const out = [];
  const rec = (o) => { out.push(o); console.log(JSON.stringify(o)); };
  const clear = async () => H.smartClear();

  if (PARTS.includes('delay')) {
    console.log('--- ENTER DELAY (shell-mode commands, local)');
    for (const d of ['coalesced', 0, 10, 30, 60, 100, 200]) {
      await clear();
      const n = 100 + (typeof d === 'number' ? d : 999);
      const cmd = '!echo R$((100+' + (typeof d === 'number' ? d : 999) + '))';
      const expectOut = 'R' + (100 + (typeof d === 'number' ? d : 999));
      const t0 = s.t();
      let enterAt;
      if (d === 'coalesced') { s.write('\x1b[200~' + cmd + '\x1b[201~\r', 'paste+enter(1 write)'); enterAt = s.t(); }
      else { s.paste(cmd, 'paste'); if (d > 0) await A.sleep(d); enterAt = s.write('\r', 'enter'); }
      const r = await s.waitFor(() => new RegExp('\\b' + expectOut + '\\b').test(s.screenText()), { timeout: 6000 });
      await H.settle(500, 3000);
      const st = H.state();
      rec({ delay: d, outputSeen: r.ok, outputAfterEnterMs: r.ok ? r.t - enterAt : null, boxAfter: st.kind, boxText: st.text, mark: st.mark });
      s.snap('delay ' + d);
    }
  }

  if (PARTS.includes('menu-enter')) {
    console.log('--- ENTER WITH MENU OPEN');
    const trial = async (label, steps) => {
      await clear();
      for (const [kind, v, wait] of steps) {
        if (kind === 'paste') s.paste(v, 'paste'); else s.write(v, kind);
        await A.sleep(wait || 150);
      }
      await H.settle(900, 5000);
      const st = H.state();
      rec({ label, boxKind: st.kind, boxText: st.text, mark: st.mark, hint: st.hint, below: st.below });
      s.snap(label, { show: 0 });
    };
    await trial('/mod + Enter (menu open)', [['paste', '/mod', 250], ['enter', '\r', 100]]);
    await clear();
    await trial('/mod + Esc + Enter', [['paste', '/mod', 250], ['esc', '\x1b', 300], ['enter', '\r', 100]]);
    await clear();
    await trial('/mo + Tab', [['paste', '/mo', 250], ['tab', '\t', 300]]);
  }
  await clear();
  // dump hook log + transcript tail for reference
  const hs = s.hooks().map((h) => ({ e: h.event, rel: h.startedAt - s.t0, p: h.in.prompt && h.in.prompt.slice(0, 40) }));
  console.log('hooks:', JSON.stringify(hs));
  require('fs').writeFileSync(A.dir('logs/q2b-results.json'), JSON.stringify(out, null, 1));
};
