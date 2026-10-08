// Q6b - tall input rendering, clearing of placeholder shapes, Ctrl+C / Esc on empty, ghost suggestion hazard.
const mk = require('./lib');

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'tall,shapes,empty,ghost').split(',');
  const s = A.start({ name: 'q6b', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(2500);
  const H = mk(A, s);
  const rec = (o) => console.log(JSON.stringify(o));
  const png = A.dir('assets/red.png');

  if (PARTS.includes('tall')) {
    console.log('--- tall typed input (backslash+Enter newlines)');
    for (const n of [8, 20, 34, 60]) {
      await H.smartClear();
      for (let i = 1; i <= n; i++) { await s.type('line' + i, 4); s.write('\\', 'bs'); await A.sleep(8); s.write('\r', 'nl'); await A.sleep(12); }
      await H.settle(600, 6000);
      const b = s.box();
      const rows = s.screenLines();
      rec({ typedLines: n, boxKind: b.kind, boxTop: b.top, boxBottom: b.bottom, insideRows: b.inside ? b.inside.length : null, firstRow: b.inside && b.inside[0], lastRow: b.inside && b.inside[b.inside.length - 1], hint: H.hintLine(), parsedLines: b.textLines ? b.textLines.length : null, cursor: s.cursor() });
      s.snap('tall ' + n);
    }
    await H.smartClear();
  }

  if (PARTS.includes('shapes')) {
    console.log('--- clearing placeholder shapes');
    const mkShape = {
      'paste-20-lines': async () => { s.paste(Array.from({ length: 20 }, (_, i) => 'row' + i).join('\n'), 'paste'); await H.until((st) => /\[Pasted text/.test(st.text || ''), 4000); },
      'image-placeholder': async () => { s.paste(png, 'paste'); await H.until((st) => /\[Image #/.test(st.text || ''), 4000); },
      'placeholder+typed-text': async () => { s.paste(Array.from({ length: 12 }, (_, i) => 'r' + i).join('\n'), 'paste'); await H.until((st) => /\[Pasted text/.test(st.text || ''), 4000); await s.type(' extra words', 10); },
    };
    const METHODS = [
      ['ctrl-u', [['\x15', 0]]], ['ctrl-c', [['\x03', 0]]], ['esc-esc-1w', [['\x1b\x1b', 0]]], ['esc-esc-2w-100ms', [['\x1b', 0], ['\x1b', 100]]],
      ['ctrl-a,ctrl-k', [['\x01', 0], ['\x0b', 60]]], ['backspace x1', [['\x7f', 0]]], ['backspace x3', [['\x7f', 0], ['\x7f', 30], ['\x7f', 30]]],
    ];
    for (const [shape, make] of Object.entries(mkShape)) {
      for (const [mid, steps] of METHODS) {
        await H.smartClear();
        await make();
        await H.settle(300, 3000);
        const before = H.state();
        for (const [seq, gap] of steps) { if (gap) await A.sleep(gap); s.write(seq, 'clear-' + mid); }
        await H.settle(500, 3000);
        const after = H.state();
        rec({ shape, method: mid, before: (before.text || '').slice(0, 40), after: { kind: after.kind, text: (after.text || '').slice(0, 40), hint: after.hint, below: after.below } });
      }
    }
    await H.smartClear();
  }

  if (PARTS.includes('empty')) {
    console.log('--- empty-box safety');
    await H.smartClear();
    const t0 = s.t();
    s.write('\x03', 'ctrl-c-on-empty');
    await A.sleep(500);
    const hintShown = H.state();
    rec({ ctrlC_empty_after500ms: { below: hintShown.below, kind: hintShown.kind } });
    // wait for it to vanish
    let gone = null;
    for (let i = 0; i < 80; i++) { await A.sleep(100); const b = H.state(); if (!b.below.some((x) => /Ctrl-C again/.test(x))) { gone = s.t() - t0; break; } }
    rec({ ctrlC_hintGoneAfterMs: gone, alive: !s.exited });
    s.write('\x15', 'ctrl-u-on-empty'); await A.sleep(300);
    rec({ ctrlU_on_empty: H.state().kind, alive: !s.exited });
  }

  if (PARTS.includes('ghost')) {
    console.log('--- ghost prompt suggestion (3 tiny turns)');
    let ghost = null;
    for (let i = 1; i <= 3; i++) {
      await H.smartClear();
      const e = (s.paste('reply with only the word R' + i, 'paste'), await A.sleep(150), s.write('\r', 'enter'));
      await s.waitHook('Stop', { after: e - 50, timeout: 60000 });
      for (let k = 0; k < 80; k++) { await A.sleep(100); const st = s.boxState(); if (st.placeholder && st.rawText && !/^Try "/.test(st.rawText)) { ghost = st.rawText; break; } }
      rec({ turn: i, ghost });
      if (ghost) break;
    }
    if (ghost) {
      s.snap('ghost shown');
      const st = s.boxState();
      rec({ ghostState: { kind: st.kind, placeholder: st.placeholder, rawText: st.rawText, cursor: st.cursor } });
      // Esc Esc with ghost showing (box looks non-empty to a naive reader)
      s.write('\x1b\x1b', 'esc-esc-with-ghost'); await H.settle(700, 3000);
      rec({ escEscWithGhost: { screen: /Rewind/.test(s.screenText()) ? 'REWIND-DIALOG' : 'no-dialog', ghostGone: !s.boxState().placeholder } });
      s.write('\x1b', 'esc'); await H.settle(500, 2000);
    } else {
      rec({ note: 'no ghost produced after 3 tiny turns' });
    }
  }
  await s.kill();
};
