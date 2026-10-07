// Shared helpers for scenarios (state-driven waits, brute-force clear, compact state dump).
module.exports = (A, s) => {
  const H = {};
  H.hintLine = () => { const b = s.box(); if (b.top == null || b.top < 1) return ''; return s.screenLines()[b.top - 1].trim(); };
  H.belowBox = () => { const b = s.box(); if (b.bottom == null) return []; return s.screenLines().slice(b.bottom + 1).map((l) => l.trim()).filter(Boolean); };
  H.state = () => {
    const st = s.boxState();
    return { kind: st.kind, text: st.text, mark: st.mark, nLines: st.textLines ? st.textLines.length : 0, hint: H.hintLine(), below: H.belowBox().slice(0, 3), cursor: s.cursor() };
  };
  // wait until the screen has been quiet for `ms` (render finished)
  H.settle = async (ms = 400, max = 4000) => s.quiet(ms, max);
  // poll the box state until pred(state) or timeout; returns {ok, ms, state}
  H.until = async (pred, timeout = 3000) => {
    const t0 = s.t();
    for (;;) {
      const st = s.boxState();
      if (pred(st)) return { ok: true, ms: s.t() - t0, state: st };
      if (s.t() - t0 > timeout) return { ok: false, ms: s.t() - t0, state: st };
      await A.sleep(10);
    }
  };
  // brute-force clear used by the harness itself (NOT a candidate under test): backspaces + ctrl+u, verified on screen
  H.bruteClear = async (n = 60) => {
    for (let round = 0; round < 4; round++) {
      s.write('\x7f'.repeat(n), 'bs-clear');
      await A.sleep(150);
      s.write('\x15', 'ctrl-u');
      await H.settle(300, 2500);
      const st = s.boxState();
      if (st.kind === 'empty' && !st.textLines) return true;
      if (st.kind === 'empty') return true;
    }
    return false;
  };
  // State-aware clear: never sends Esc Esc to an empty box (Rewind dialog); single Esc to leave shell mode.
  H.smartClear = async () => {
    for (let round = 0; round < 4; round++) {
      await H.settle(250, 2500);
      const txt = s.screenText();
      if (/Rewind/.test(txt) && /Esc to cancel/.test(txt)) { s.write('\x1b', 'esc-rewind'); await A.sleep(300); continue; }
      const st = s.boxState();
      if (st.kind === 'empty' && st.mark === '❯') return true;
      if (st.kind === 'empty') { s.write('\x1b', 'esc-leave-mode'); await A.sleep(300); continue; }
      if (st.kind === 'typed') {
        s.write('\x1b', 'esc'); await A.sleep(80); s.write('\x1b', 'esc'); await A.sleep(300);
        continue;
      }
      // menu / unreadable: one Esc
      s.write('\x1b', 'esc-other'); await A.sleep(300);
    }
    await H.bruteClear(200);
    const st = s.boxState();
    return st.kind === 'empty' && st.mark === '❯';
  };
  H.pasteAndWait = async (text, timeout = 3000) => {
    s.paste(text, 'paste');
    const r = await H.until((st) => st.kind === 'typed', timeout);
    await H.settle(250, 2500);
    return r;
  };
  return H;
};
