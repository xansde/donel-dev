// Double Enter: does a second \r right after the first duplicate the message?
const mk = require('./lib');
module.exports = async (A) => {
  const rec = (o) => console.log(JSON.stringify(o));
  const s = A.start({ name: 'q2g', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(4000);
  const H = mk(A, s);
  for (const [label, gap] of [['enter+enter 0ms', 0], ['enter+enter 30ms', 30], ['enter+enter 120ms', 120]]) {
    await H.smartClear();
    const tag = 'reply with only the word DUP' + gap;
    s.paste(tag, 'paste');
    await H.until((st) => st.kind === 'typed' && st.text === tag, 4000);
    await A.sleep(150);
    const e1 = s.write('\r', 'enter-1');
    if (gap > 0) await A.sleep(gap);
    s.write('\r', 'enter-2');
    await s.waitHook('Stop', { after: e1 - 50, timeout: 60000 });
    await H.settle(1500, 5000);
    const tr = s.readTranscript() || [];
    const users = tr.filter((e) => e.type === 'user' && e.message && JSON.stringify(e.message.content).includes('DUP' + gap));
    const q = tr.filter((e) => e.type === 'queue-operation' && JSON.stringify(e.content || '').includes('DUP' + gap));
    const ups = s.hooks().filter((h) => h.event === 'UserPromptSubmit' && String(h.in.prompt).includes('DUP' + gap));
    rec({ label, userEntries: users.length, queueOps: q.length, userPromptSubmitHooks: ups.length, boxAfter: H.state().kind });
  }
  await s.kill();
};
