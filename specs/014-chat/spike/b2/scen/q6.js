// Q6 - clearing leftover input. Candidate key sequences x input shapes; also safety on an EMPTY box.
const mk = require('./lib');
const METHODS = [
  { id: 'ctrl-u', steps: [['\x15', 0]] },
  { id: 'ctrl-u-x3', steps: [['\x15', 0], ['\x15', 80], ['\x15', 80]] },
  { id: 'ctrl-c', steps: [['\x03', 0]] },
  { id: 'esc-esc-2w-100ms', steps: [['\x1b', 0], ['\x1b', 100]] },
  { id: 'esc-esc-1w', steps: [['\x1b\x1b', 0]] },
  { id: 'esc-esc-2w-500ms', steps: [['\x1b', 0], ['\x1b', 500]] },
  { id: 'esc-esc-2w-1200ms', steps: [['\x1b', 0], ['\x1b', 1200]] },
  { id: 'ctrl-a,ctrl-k(2w)', steps: [['\x01', 0], ['\x0b', 60]] },
  { id: 'ctrl-a+ctrl-k(1w)', steps: [['\x01\x0b', 0]] },
  { id: 'ctrl-a,ctrl-k x3', steps: [['\x01', 0], ['\x0b', 60], ['\x0b', 60], ['\x0b', 60], ['\x0b', 60]] },
  { id: 'ctrl-w', steps: [['\x17', 0]] },
];
const SHAPES = [
  { id: 'one-line', text: 'hello world' },
  { id: 'three-lines', text: 'line one\nline two\nline three' },
  { id: 'long-wrapped', text: 'word '.repeat(50).trim() },
];

module.exports = async (A) => {
  const s = A.start({ name: 'q6', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(1500);
  const H = mk(A, s);
  const results = [];
  for (const shape of SHAPES) {
    for (const m of METHODS) {
      if (s.exited) break;
      const okClear = await H.bruteClear(shape.text.length + 10);
      const pre = await H.pasteAndWait(shape.text);
      const before = H.state();
      for (const [seq, gap] of m.steps) { if (gap) await A.sleep(gap); s.write(seq, 'clear-' + m.id); }
      await H.settle(500, 3000);
      const after = H.state();
      const row = { shape: shape.id, method: m.id, bruteOk: okClear, pastedVisible: pre.ok, before: { kind: before.kind, nLines: before.nLines, len: (before.text || '').length }, after: { kind: after.kind, nLines: after.nLines, text: (after.text || '').slice(0, 40), hint: after.hint, below: after.below }, exited: !!s.exited };
      results.push(row);
      console.log(JSON.stringify(row));
      s.snap('after ' + shape.id + ' / ' + m.id);
      if (s.exited) break;
    }
  }
  require('fs').writeFileSync(A.dir('logs/q6-results.json'), JSON.stringify(results, null, 1));
};
