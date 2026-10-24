// Q2 (paste + autocomplete menus), Q3 (prefix modes typed vs pasted), hostile content. No model turns here.
const mk = require('./lib');

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'menus,prefix,hostile').split(',');
  let s = A.start({ name: 'q23', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(1500);
  let H = mk(A, s);
  const out = [];
  const rec = (o) => { out.push(o); console.log(JSON.stringify(o)); };

  // clear whatever is in the box with Esc Esc (2 writes, 80 ms) and verify; fallback to brute clear
  const clear = async () => {
    const st0 = s.boxState();
    if (st0.kind === 'empty' && !st0.textLines) { /* nothing */ }
    s.write('\x1b', 'esc'); await A.sleep(80); s.write('\x1b', 'esc');
    await H.settle(400, 3000);
    let st = s.boxState();
    if (st.kind !== 'empty') { await H.bruteClear(200); st = s.boxState(); }
    return st.kind === 'empty';
  };
  const dumpBelow = () => s.screenLines().slice(Math.max(0, (s.box().bottom || 0) + 1)).map((l) => l.trim()).filter(Boolean);
  const menuAbove = () => { const b = s.box(); return b.top == null ? [] : s.screenLines().slice(Math.max(0, b.top - 8), b.top).map((l) => l.trim()).filter(Boolean); };

  const probe = async (label, how, text, opts = {}) => {
    await clear();
    const t0 = s.t();
    if (how === 'paste') s.paste(text, 'paste'); else await s.type(text, opts.gap || 30);
    await H.until((st) => st.kind === 'typed' || st.kind === 'menu', 3000);
    await H.settle(450, 3000);
    const st = H.state();
    const below = dumpBelow();
    const row = { label, how, text: text.slice(0, 30), kind: st.kind, mark: st.mark, boxText: (st.text || '').slice(0, 60), nLines: st.nLines, hint: st.hint, below: below.slice(0, 6) };
    rec(row);
    s.snap(label + ' [' + how + ']');
    return row;
  };

  if (PARTS.includes('menus')) {
    console.log('--- MENUS (Q2)');
    await probe('slash-full-cmd', 'paste', '/clear');
    await probe('slash-skill-args', 'paste', '/spike-skill alpha beta');
    await probe('slash-prefix-pair', 'paste', '/spike-help');
    await probe('slash-only', 'paste', '/');
    await probe('slash-partial', 'paste', '/spik');
    await probe('slash-partial-typed', 'type', '/spik');
    await probe('at-partial', 'paste', '@notes/al');
    await probe('at-partial-typed', 'type', '@notes/al');
    await probe('at-full-then-text', 'paste', 'read @notes/alpha.txt please');
    await probe('at-full-typed', 'type', 'read @notes/alpha.txt please', { gap: 15 });
    await probe('multi-LF', 'paste', 'line1\nline2\nline3');
    await probe('multi-CRLF', 'paste', 'line1\r\nline2\r\nline3');
    await probe('multi-CR', 'paste', 'line1\rline2\rline3');
  }

  if (PARTS.includes('prefix')) {
    console.log('--- PREFIXES (Q3)');
    for (const P of ['!', '#', '&', '?', '/', '@', '*', '\\']) {
      await probe('prefix ' + P, 'type', P + 'echo spike');
      await probe('prefix ' + P, 'paste', P + 'echo spike');
      // paste a lone prefix char too
      await probe('prefix-only ' + P, 'paste', P);
      await probe('prefix-only ' + P, 'type', P);
    }
  }

  if (PARTS.includes('hostile')) {
    console.log('--- HOSTILE CONTENT');
    await probe('tab-in-paste', 'paste', 'a\tb');
    await probe('esc-in-paste', 'paste', 'x\x1by');
    await probe('endmarker-in-paste', 'paste', 'pre\x1b[201~post');
    await probe('ctrlc-in-paste', 'paste', 'c1\x03c2');
    await probe('ctrlu-in-paste', 'paste', 'keep\x15this');
    await probe('bs-in-paste', 'paste', 'ab\x7fc');
    await probe('nul-in-paste', 'paste', 'n\x00z');
    await probe('unicode-in-paste', 'paste', 'ação 你好 😀 z');
    await probe('trailing-newline-paste', 'paste', 'abc\n');
    await probe('leading-newline-paste', 'paste', '\nabc');
  }
  await clear();
  s.snap('end', { show: 6 });
  require('fs').writeFileSync(A.dir('logs/q23-results.json'), JSON.stringify(out, null, 1));
};
