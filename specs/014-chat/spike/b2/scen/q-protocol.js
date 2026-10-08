// End-to-end validation of protocol.js: varied messages, verified against the UserPromptSubmit payload and the transcript.
const P = require('../protocol');
const mk = require('./lib');

const unwrap = (c) => { const m = c.match(/^\n\n<pasted_content id="([0-9a-f]+)">\n([\s\S]*?)\n?<\/pasted_content id="\1">\n$/); return m ? m[2] : c; };

module.exports = async (A) => {
  const rec = (o) => console.log(JSON.stringify(o));
  const s = A.start({ name: 'qproto', cwd: A.dir('cwd'), quiet: true });
  const g = await P.waitReady(s);
  rec({ gate: g.ok, ms: g.ms });
  const H = mk(A, s);
  let first = true;
  const cases = [
    ['plain', 'reply with only the word P1'],
    ['multiline-3', 'reply with only the word P2\nline two\nline three'],
    ['collapsed-12', 'reply with only the word P3\n' + Array.from({ length: 11 }, (_, i) => 'filler line ' + i).join('\n')],
    ['tab+unicode', 'reply with only the word P4\tação 你好 😀'],
    ['slash-exact', '/spike-help'],
    ['at-mention', '@assets-red.png describe it in 2 words'],
    ['leftover', 'reply with only the word P7', async () => { await s.type('leftover junk', 8); await A.sleep(400); }],
    ['hostile', 'reply with only the word P8 \x1b[201~\r\x03\x15 end'],
    ['unknown-slash', '/zzzunknown foo'],
    ['path-like', '/etc/hosts reply with only the word P10'],
    ['esc-armed-enter', 'reply with only the word P11', null, 'esc-armed'],
  ];
  for (const [label, text, pre, special] of cases) {
    if (pre) await pre();
    const before = (s.hooks().filter((h) => h.event === 'UserPromptSubmit')).length;
    let r;
    if (special === 'esc-armed') {
      // manual: paste, ONE Esc with no menu open (arms double-Esc), then Enter
      await P.clearLeftover(s);
      s.paste(text, 'paste'); await P.until(s, (x) => x.text === text, 3000);
      s.write('\x1b'); await A.sleep(300);
      const hint = H.hintLine();
      const at = s.write('\r', 'enter');
      r = { ok: true, reason: 'manual', enterAt: at, hintAfterEsc: hint };
    } else {
      r = await P.send(s, text, { firstPaste: first });
    }
    first = false;
    // authoritative confirmation
    const expectedBox = P.cliView(P.sanitize(text));
    let hookPrompt = null; let transcriptText = null; let kind = null;
    const isLocal = /^\/zzzunknown/.test(text);
    if (!isLocal && r.ok) {
      const up = await s.waitFor(() => s.hooks().filter((h) => h.event === 'UserPromptSubmit').length > before, { timeout: 20000 });
      if (up.ok) hookPrompt = s.hooks().filter((h) => h.event === 'UserPromptSubmit').pop().in.prompt;
      await s.waitHook('Stop', { after: (r.enterAt || 0) - 50, timeout: 60000 });
      const tr = s.readTranscript() || [];
      const us = tr.filter((e) => e.type === 'user' && e.message && e.promptSource === 'typed');
      const last = us[us.length - 1];
      transcriptText = last ? (typeof last.message.content === 'string' ? last.message.content : JSON.stringify(last.message.content)) : null;
    } else if (isLocal) {
      await A.sleep(1200);
      kind = P.D.unknownCommand(s.screenText()) ? 'unknown-command-shown' : 'no-message';
    }
    await H.settle(500, 3000);
    const hp = hookPrompt == null ? null : unwrap(hookPrompt);
    rec({ label, ok: r.ok, reason: r.reason, steps: (r.steps || []).map((x) => x.k + (x.ms != null ? ':' + x.ms : '') + (x.ok === false ? '(FAIL)' : '')).join(' > '),
      hookPromptEqualsExpected: hp == null ? null : hp === expectedBox, hookPromptHead: hookPrompt == null ? null : JSON.stringify(hookPrompt.slice(0, 60)), kind, hintAfterEsc: r.hintAfterEsc });
    if (hp != null && hp !== expectedBox) rec({ label, got: JSON.stringify(hp.slice(0, 120)), exp: JSON.stringify(expectedBox.slice(0, 120)) });
  }
  // queue case: send while working
  const SLOW = 'Run this exact bash command and then reply with the single word DONE: ping -n 6 127.0.0.1';
  await P.clearLeftover(s);
  const r0 = await P.send(s, SLOW);
  await s.waitHook('PreToolUse', { after: (r0.enterAt || 0) - 50, timeout: 60000 });
  await A.sleep(1000);
  const rq = await P.send(s, 'reply with only the word P12 queued');
  const tq = (s.readTranscript() || []).filter((e) => e.type === 'queue-operation' && /P12/.test(e.content || ''));
  rec({ label: 'queued-while-working', ok: rq.ok, reason: rq.reason, steps: rq.steps.map((x) => x.k + (x.ms != null ? ':' + x.ms : '')).join(' > '), queueOps: tq.map((e) => e.operation) });
  await s.waitHook('Stop', { after: (r0.enterAt || 0) - 50, timeout: 90000 });
  await A.sleep(1500);
  const tq2 = (s.readTranscript() || []).filter((e) => e.type === 'queue-operation' && /P12/.test(e.content || '')).map((e) => e.operation + ':' + (e.reason || ''));
  rec({ label: 'queued-after-turn', queueOps: tq2, attachments: (s.readTranscript() || []).filter((e) => e.type === 'attachment' && e.attachment && e.attachment.type === 'queued_command').length });
  await s.kill();
};
