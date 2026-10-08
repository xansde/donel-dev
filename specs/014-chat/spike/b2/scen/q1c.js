// term.modes.bracketedPasteMode / buffer type transitions vs the first accepted write (arming) - 3 trusted boots.
module.exports = async (A) => {
  for (let run = 1; run <= 3; run++) {
    const s = A.start({ name: 'q1c-' + run, cwd: A.dir('cwd'), quiet: true });
    const trans = [];
    let last = '';
    const sent = [];
    let i = 0; let next = 100;
    const L = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    while (s.t() < 5200 && !s.exited) {
      const key = (s.term.modes.bracketedPasteMode ? 'BP' : 'bp') + '/' + s.term.buffer.active.type;
      if (key !== last) { trans.push(s.t() + ':' + key); last = key; }
      if (i < L.length && s.t() >= next) { s.write(L[i], 'probe'); sent.push({ ch: L[i], t: s.t() }); i++; next += 100; }
      await A.sleep(5);
    }
    await s.quiet(400, 3000);
    const txt = s.boxState().text || '';
    const first = txt ? L.indexOf(txt.replace(/^.*?(?=[a-zA-Z])/, '')[0]) : -1;
    const row = s.boxState().rawText || '';
    // find first late-accepted letter: the letter after the last gap
    const acc = new Set(row.split(''));
    let lastLost = -1; sent.forEach((p, k) => { if (!acc.has(p.ch)) lastLost = k; });
    console.log(JSON.stringify({ run, transitions: trans.join('  '), lastLostWrite: lastLost >= 0 ? sent[lastLost].t : null, firstAcceptedAfterGap: sent[lastLost + 1] ? sent[lastLost + 1].t : null, ready: s.firstMark('ready') }));
    await s.kill();
  }
};
