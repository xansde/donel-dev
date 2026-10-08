// V2 - '@token' at the end of the message + Enter while the file menu is open: swapped (completed) or submitted?
const mk = require('./lib');
module.exports = async (A) => {
  const rec = (o) => console.log(JSON.stringify(o));
  const s = A.start({ name: 'q2e', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(2500);
  const H = mk(A, s);
  const above = () => { const b = s.box(); if (b.top == null) return []; return s.screenLines().slice(Math.max(0, b.top - 6), b.top).map((l) => l.trim()).filter(Boolean).map((l) => l.slice(0, 90)); };
  for (const [label, text, escFirst] of [['@token at end', '@assets-red.png', false], ['@token at end + Esc first', '@assets-red.png', true], ['partial @token', '@assets-r', false]]) {
    await H.smartClear();
    s.paste(text, 'paste');
    await H.until((st) => st.kind === 'typed', 3000);
    await A.sleep(1500); // let the async file search finish
    const before = { box: H.state().text, above: above() };
    s.snap(label + ' before enter');
    if (escFirst) { s.write('\x1b', 'esc'); await A.sleep(400); }
    const afterEsc = escFirst ? { box: H.state().text, above: above() } : null;
    const eAt = s.write('\r', 'enter');
    await A.sleep(1800);
    const st = H.state();
    const up = s.hooks().filter((h) => h.event === 'UserPromptSubmit' && (h.startedAt - s.t0) > eAt - 50).map((h) => h.in.prompt);
    rec({ label, before, afterEsc, afterEnter: { kind: st.kind, text: st.text }, userPromptSubmit: up });
    if (up.length) await s.waitHook('Stop', { after: eAt - 50, timeout: 60000 });
  }
  await s.kill();
};
