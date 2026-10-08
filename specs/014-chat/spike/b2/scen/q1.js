// Q1 - readiness. Letter-train probe: one lowercase/uppercase letter every GAP ms; whatever shows up in the input box
// tells us from when bytes are accepted and whether earlier ones were lost or buffered.
const fs = require('fs');
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GAP = +process.env.GAP || 100;

async function oneRun(A, name, dirName, mode) {
  fs.mkdirSync(A.dir(dirName), { recursive: true });
  const s = A.start({ name, cwd: A.dir(dirName), quiet: true });
  const sent = []; // {ch, t}
  let probing = false;
  const probeLoop = async (startDelay) => {
    probing = true;
    await A.sleep(startDelay);
    for (let i = 0; i < LETTERS.length && probing; i++) {
      s.write(LETTERS[i], 'probe');
      sent.push({ ch: LETTERS[i], t: s.t() });
      await A.sleep(GAP);
    }
  };
  let trustSeen = null, trustDownAt = null, trustEnterAt = null, probeStartedAt = null;
  const loops = [];
  if (mode === 'trusted') loops.push(probeLoop(100));
  // watch loop: handle trust dialog manually (so we control timing), detect banner/box/footer
  const tl = {};
  const deadline = Date.now() + 40000;
  let boxAt = null;
  while (Date.now() < deadline && !s.exited) {
    const text = s.screenText();
    const trust = /Enter to confirm/.test(text) && /trust this folder/.test(text);
    if (trust && trustSeen == null) {
      trustSeen = s.t();
      if (mode === 'fresh-fast') { // Down immediately when the dialog is first visible, Enter 120ms later
        trustDownAt = s.write('\x1b[B', 'trust-down'); await A.sleep(120); trustEnterAt = s.write('\r', 'trust-enter');
      } else if (mode === 'fresh-coalesced') { // Down+Enter in ONE write, immediately
        trustDownAt = trustEnterAt = s.write('\x1b[B\r', 'trust-down+enter');
      } else { // fresh-slow
        await A.sleep(300); trustDownAt = s.write('\x1b[B', 'trust-down'); await A.sleep(300); trustEnterAt = s.write('\r', 'trust-enter');
      }
      if (mode.startsWith('fresh')) { probeStartedAt = s.t(); loops.push(probeLoop(60)); } // letters right after trust accept
    }
    const b = s.box();
    if (!trust && boxAt == null && (b.kind === 'empty' || b.kind === 'typed') && s.footer()) { boxAt = s.t(); tl.boxAt = boxAt; if (!probeStartedAt && mode !== 'trusted') { /* noop */ } }
    if (boxAt != null && sent.length && s.t() > boxAt + 1500 && s.t() > sent[sent.length - 1].t - 0) { /* keep probing while quiet check below */ }
    if (boxAt != null && s.t() > boxAt + 2500) break; // keep the train running 2.5 s after the box appeared
    await A.sleep(20);
  }
  probing = false;
  await Promise.all(loops).catch(() => {});
  await s.quiet(600, 5000);
  const b = s.box();
  const hooks = s.hooks();
  const ss = hooks.find((h) => h.event === 'SessionStart');
  const out = { name, mode, dir: dirName };
  out.trustSeen = trustSeen; out.trustEnterAt = trustEnterAt;
  out.firstData = s.firstDataAt;
  out.bannerAt = s.screenText().match(/Claude Code v\d/) ? 'present' : 'absent';
  out.boxAt = boxAt;
  out.sessionStartHookStarted = ss ? ss.startedAt - s.t0 : null;
  out.sessionStartHookDone = ss ? ss.ts - s.t0 : null;
  out.boxKind = b.kind; out.boxText = b.text;
  const txt = b.text || '';
  // accepted = probe letters present in the box, in order
  const first = txt ? LETTERS.indexOf(txt[0]) : -1;
  out.sentCount = sent.length;
  out.firstAcceptedLetter = txt ? txt[0] : null;
  const firstSent = first >= 0 ? sent[first] : null;
  out.firstAcceptedWrittenAt = firstSent ? firstSent.t : null;
  out.lastLostWrittenAt = first > 0 ? sent[first - 1].t : null;
  out.lostLetters = first > 0 ? LETTERS.slice(0, first) : '';
  const expected = LETTERS.slice(Math.max(first, 0), sent.length);
  out.contiguousTail = txt === expected;
  out.sentFirstAt = sent.length ? sent[0].t : null;
  out.sentLastAt = sent.length ? sent[sent.length - 1].t : null;
  // were any probe letters echoed raw BEFORE the alt-screen switch (cooked-mode echo)?
  const altAt = s.rawChunks.find((c) => c.d.includes('\x1b[?1049h'));
  out.altScreenAt = altAt ? altAt.t : null;
  const pre = s.rawChunks.filter((c) => (altAt ? c.t < altAt.t : true)).map((c) => c.d).join('');
  const preClean = pre.replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  out.rawEchoOfProbeRun = null;
  for (let k = 0; k + 4 <= LETTERS.length; k++) { const seg = LETTERS.slice(k, k + 4); if (preClean.includes(seg)) { out.rawEchoOfProbeRun = seg; break; } }
  s.snap('final', { show: 6 });
  console.log(JSON.stringify(out, null, 1));
  await s.kill();
  return out;
}

module.exports = async (A) => {
  const which = (process.env.RUNS || 'trusted,trusted,trusted,fresh-fast,fresh-coalesced').split(',');
  const results = [];
  let n = 0;
  for (const m of which) {
    n++;
    const dirName = m.startsWith('fresh') ? 'fresh-q1-' + Date.now().toString(36) + n : 'cwd';
    results.push(await oneRun(A, 'q1-' + n + '-' + m, dirName, m));
  }
  require('fs').writeFileSync(A.dir('logs/q1-results.json'), JSON.stringify(results, null, 1));
};
