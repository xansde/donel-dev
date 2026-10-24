// Which paste contents get dropped/delayed? (x1 lost "hello world" as the first paste.)
module.exports = async (A) => {
  const s = A.start({ name: 'x3', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(700);
  const cases = ['hello world', 'hello', 'a b', 'hello world', 'x\ny'];
  for (const c of cases) {
    // clear first (Ctrl+U x3 then backspaces)
    s.write('\x15'); await A.sleep(80); s.write('\x15'); await A.sleep(80);
    for (let i = 0; i < 12; i++) s.write('\x7f');
    await A.sleep(300);
    const before = s.boxState();
    const t0 = s.t();
    s.paste(c, 'paste');
    // poll for when the text appears
    let seenAt = null;
    for (let i = 0; i < 100; i++) { await A.sleep(10); const st = s.boxState(); if (st.kind === 'typed') { seenAt = s.t() - t0; break; } }
    await A.sleep(400);
    const st = s.boxState();
    console.log(JSON.stringify({ paste: c, beforeKind: before.kind, appearedAfterMs: seenAt, finalKind: st.kind, finalText: st.text }));
  }
  s.snap('end', { show: 6 });
};
