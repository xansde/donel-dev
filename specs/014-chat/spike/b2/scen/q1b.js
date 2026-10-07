// Q1b - trust dialog timing (selection revert), post-trust arming, and inline (tui=default) readiness.
const fs = require('fs');
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function selected(s) {
  const ls = s.screenLines();
  const no = ls.findIndex((l) => /No, exit/.test(l));
  const yes = ls.findIndex((l) => /Yes, I trust this folder/.test(l));
  if (no < 0 || yes < 0) return '?';
  if (/❯/.test(ls[yes])) return 'YES';
  if (/❯/.test(ls[no])) return 'NO';
  return '??';
}

async function dialogRevert(A, label, downAfterMs, dir) {
  fs.mkdirSync(A.dir(dir), { recursive: true });
  const s = A.start({ name: 'q1b-' + label, cwd: A.dir(dir), quiet: true });
  const r = await s.waitFor(() => /Enter to confirm/.test(s.screenText()) && /trust this folder/.test(s.screenText()), { timeout: 15000 });
  const t1 = s.t();
  const trace = [];
  let last = selected(s);
  trace.push([t1, last]);
  await A.sleep(downAfterMs);
  const dAt = s.write('\x1b[B', 'down');
  const end = s.t() + 3000;
  while (s.t() < end) {
    const cur = selected(s);
    if (cur !== last) { trace.push([s.t(), cur]); last = cur; }
    await A.sleep(5);
  }
  console.log(label, 'dialog first visible', t1, 'down written', dAt, 'selection trace', JSON.stringify(trace));
  await s.kill();
}

async function postTrust(A, label, dir, wait) {
  fs.mkdirSync(A.dir(dir), { recursive: true });
  const s = A.start({ name: 'q1b-' + label, cwd: A.dir(dir), quiet: true });
  await s.waitFor(() => /Enter to confirm/.test(s.screenText()) && /trust this folder/.test(s.screenText()), { timeout: 15000 });
  const seen = s.t();
  await A.sleep(wait);
  s.write('\x1b[B', 'down');
  await A.sleep(300);
  const sel = selected(s);
  const enterAt = s.write('\r', 'enter');
  const sent = [];
  let boxAt = null;
  const deadline = Date.now() + 15000;
  let i = 0;
  let nextProbe = s.t() + 60;
  while (Date.now() < deadline && !s.exited) {
    if (i < LETTERS.length && s.t() >= nextProbe) { s.write(LETTERS[i], 'probe'); sent.push({ ch: LETTERS[i], t: s.t() }); i++; nextProbe += 100; }
    const b = s.box();
    if (boxAt == null && (b.kind === 'empty' || b.kind === 'typed') && s.footer() && !/Enter to confirm/.test(s.screenText())) boxAt = s.t();
    if (boxAt != null && s.t() > boxAt + 1500) break;
    await A.sleep(10);
  }
  await s.quiet(500, 4000);
  const b = s.box();
  const txt = b.text || '';
  const first = txt ? LETTERS.indexOf(txt[0]) : -1;
  const ss = s.hooks().find((h) => h.event === 'SessionStart');
  const altAt = (s.rawChunks.find((c) => c.d.includes('\x1b[?1049h')) || {}).t;
  console.log(JSON.stringify({ label, dialogSeen: seen, selectionBeforeEnter: sel, enterAt, sessionStartHook: ss ? ss.startedAt - s.t0 : null, altAt, boxAt, boxText: txt, firstAcceptedLetter: txt[0], firstAcceptedWrittenAt: first >= 0 ? sent[first].t : null, lastLostWrittenAt: first > 0 ? sent[first - 1].t : null, sentCount: sent.length }));
  s.snap('final', { show: 5 });
  await s.kill();
}

async function inline(A, label, n) {
  const s = A.start({ name: 'q1b-' + label, cwd: A.dir('cwd'), settings: A.dir('settings-inline.json'), quiet: true });
  const sent = [];
  let boxAt = null; let i = 0; let next = 100;
  while (s.t() < 12000 && !s.exited) {
    if (i < LETTERS.length && s.t() >= next) { s.write(LETTERS[i], 'probe'); sent.push({ ch: LETTERS[i], t: s.t() }); i++; next += 100; }
    const b = s.box();
    if (boxAt == null && (b.kind === 'empty' || b.kind === 'typed') && s.footer()) boxAt = s.t();
    if (boxAt != null && s.t() > boxAt + 2000) break;
    await A.sleep(10);
  }
  await s.quiet(500, 4000);
  const b = s.box();
  const txt = b.text || '';
  const first = txt ? LETTERS.indexOf(txt[0]) : -1;
  const ss = s.hooks().find((h) => h.event === 'SessionStart');
  const altAt = (s.rawChunks.find((c) => c.d.includes('\x1b[?1049h')) || {}).t;
  const modes = {};
  for (const m of s.raw.matchAll(/\x1b\[\?([0-9;]+)([hl])/g)) { const k = m[1] + m[2]; modes[k] = (modes[k] || 0) + 1; }
  console.log(JSON.stringify({ label, sessionStartHook: ss ? ss.startedAt - s.t0 : null, altAt: altAt || null, boxAt, boxKind: b.kind, boxText: txt, firstAcceptedLetter: txt[0], firstAcceptedWrittenAt: first >= 0 ? sent[first].t : null, lastLostWrittenAt: first > 0 ? sent[first - 1].t : null, modes }));
  s.snap('final', { show: 12 });
  await s.kill();
}

module.exports = async (A) => {
  const which = (process.env.PARTS || 'revert,posttrust,inline').split(',');
  if (which.includes('revert')) {
    await dialogRevert(A, 'revert-100', 100, 'fresh-dialog');
    await dialogRevert(A, 'revert-1500', 1500, 'fresh-dialog');
  }
  if (which.includes('posttrust')) {
    await postTrust(A, 'posttrust-1500', 'fresh-pt-' + Date.now().toString(36), 1500);
  }
  if (which.includes('inline')) {
    await inline(A, 'inline-1');
    await inline(A, 'inline-2');
  }
};
