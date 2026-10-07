// Are bracketed pastes dropped shortly after the box becomes visible? Paste unique tokens at offsets after ready.
const OFFS = (process.env.OFFS || '100,300,500,700,900,1100,1500,2000,3000').split(',').map(Number);
async function run(A, label, offs, opts = {}) {
  const s = A.start({ name: 'x2-' + label, cwd: A.dir('cwd'), quiet: true });
  const tl = await s.ready();
  const T0 = s.t();
  const tokens = [];
  let queries = 0;
  for (let i = 0; i < offs.length; i++) {
    const wait = T0 + offs[i] - s.t();
    if (wait > 0) await A.sleep(wait);
    const tok = 'P' + i + 'x';
    if (opts.typed) { s.write(tok, 'typed'); } else { s.paste(tok, 'paste'); }
    tokens.push({ tok, at: s.t() - T0 });
  }
  await A.sleep(1200);
  const st = s.boxState();
  const q = s.rawChunks.filter((c) => c.d.includes('\x1b[>0q')).map((c) => c.t - T0);
  console.log(JSON.stringify({ label, readyAt: T0, tokens: tokens.map((t) => t.tok + '@' + t.at), boxText: st.text, kind: st.kind, xtversionQueriesAtRelToReady: q }));
  s.snap('final', { show: 4 });
  await s.kill();
}
module.exports = async (A) => {
  await run(A, 'paste-early', OFFS);
  await run(A, 'paste-late', [4000, 4300, 4600]);
  await run(A, 'typed-early', OFFS, { typed: true });
};
