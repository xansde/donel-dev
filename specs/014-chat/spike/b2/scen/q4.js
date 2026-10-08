// Q4 - large paste behaviour + exactness in the transcript. Few model turns (haiku, "reply OK").
const crypto = require('crypto');
const mk = require('./lib');

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 12);
function userTexts(tr) {
  const out = [];
  for (const e of tr || []) {
    if (e.type !== 'user' || !e.message) continue;
    const c = e.message.content;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) text = c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    out.push({ text, ts: e.timestamp, uuid: e.uuid, isMeta: e.isMeta, blocks: Array.isArray(c) ? c.map((b) => b.type) : ['string'] });
  }
  return out;
}

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'threshold,mixed,l500,l200k').split(',');
  const s = A.start({ name: 'q4', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(2000);
  const H = mk(A, s);
  const rec = (o) => console.log(JSON.stringify(o));

  const mkLines = (n, head) => head + '\n' + Array.from({ length: n }, (_, i) => 'L' + String(i + 1).padStart(4, '0') + ' abcdefghijklmnopqrstuvwxyz0123456789 ABCDEFGHIJ').join('\n');

  if (PARTS.includes('threshold')) {
    console.log('--- collapse threshold (no turns)');
    for (const [label, text] of [
      ['5 lines x10', Array.from({ length: 5 }, (_, i) => 'line' + i + 'xxxx').join('\n')],
      ['10 lines x10', Array.from({ length: 10 }, (_, i) => 'line' + i + 'xxxx').join('\n')],
      ['11 lines x10', Array.from({ length: 11 }, (_, i) => 'line' + i + 'xxxx').join('\n')],
      ['20 lines x10', Array.from({ length: 20 }, (_, i) => 'line' + i + 'xxxx').join('\n')],
      ['1 line 500ch', 'a'.repeat(500)],
      ['1 line 1000ch', 'b'.repeat(1000)],
      ['1 line 1500ch', 'c'.repeat(1500)],
      ['1 line 3000ch', 'd'.repeat(3000)],
      ['1 line 10000ch', 'e'.repeat(10000)],
    ]) {
      await H.smartClear();
      const t0 = s.t();
      s.paste(text, 'paste');
      await H.until((st) => st.kind === 'typed', 8000);
      await H.settle(400, 4000);
      const st = H.state();
      rec({ label, appearedMs: s.t() - t0, nBoxLines: st.nLines, boxText: (st.text || '').slice(0, 60).replace(/\n/g, '\\n'), collapsed: /\[Pasted text/.test(st.text || '') });
    }
    await H.smartClear();
  }

  const sendAndCheck = async (label, expected, enterGap = 120) => {
    // expected: the string we think should be recorded (LF-normalised)
    const before = userTexts(s.readTranscript()).length;
    const stBox = H.state();
    const enterAt = (await A.sleep(enterGap), s.write('\r', 'enter'));
    const ups = await s.waitHook('UserPromptSubmit', { after: enterAt - 50, timeout: 40000 });
    const upAt = ups.ok ? ups.t : null;
    const tr = await s.waitTranscript((e) => e.type === 'user' && userTexts([e])[0] && userTexts([e])[0].text.includes(expected.slice(0, 36)), { timeout: 40000 });
    const trAt = tr.ok ? tr.t : null;
    const stop = await s.waitHook('Stop', { after: enterAt - 50, timeout: 120000 });
    await H.settle(500, 3000);
    const users = userTexts(s.readTranscript());
    const mine = users.filter((u) => u.text.includes(expected.slice(0, 36)));
    const got = mine.length ? mine[mine.length - 1].text : null;
    const hookPrompt = (s.hooks().filter((h) => h.event === 'UserPromptSubmit').pop() || { in: {} }).in.prompt;
    rec({
      label, boxBeforeEnter: { nLines: stBox.nLines, head: (stBox.text || '').slice(0, 50).replace(/\n/g, '\\n') },
      enterToHookMs: upAt != null ? upAt - enterAt : null, enterToTranscriptMs: trAt != null ? trAt - enterAt : null, stopOk: stop.ok,
      userEntriesMatching: mine.length,
      transcript: got == null ? null : { len: got.length, lines: got.split('\n').length, sha: sha(got), equalsExpected: got === expected, equalsExpectedTrimEnd: got === expected.replace(/\s+$/, ''), blocks: mine[mine.length - 1].blocks },
      hookPrompt: hookPrompt == null ? null : { len: hookPrompt.length, sha: sha(hookPrompt), equalsTranscript: hookPrompt === got },
      expected: { len: expected.length, lines: expected.split('\n').length, sha: sha(expected) },
    });
    if (got != null && got !== expected) {
      // locate first difference
      let i = 0; while (i < Math.min(got.length, expected.length) && got[i] === expected[i]) i++;
      rec({ label, firstDiffAt: i, got: JSON.stringify(got.slice(Math.max(0, i - 10), i + 30)), exp: JSON.stringify(expected.slice(Math.max(0, i - 10), i + 30)) });
    }
    s.snap('after send ' + label);
    return { got };
  };

  if (PARTS.includes('mixed')) {
    console.log('--- mixed newline/tab/unicode message (1 turn)');
    await H.smartClear();
    const p1 = 'Reply with only the word OK [tag-mixed]. [LF-TEST]\nA\tTAB-after\nB ação 你好 😀 end\n';
    const p2 = '[CRLF-TEST]\r\nC1\r\nC2\r\n';
    const p3 = '[CR-TEST]\rD1\rD2';
    s.paste(p1, 'paste1'); await A.sleep(250);
    s.paste(p2, 'paste2'); await A.sleep(250);
    s.paste(p3, 'paste3');
    await H.until((st) => st.kind === 'typed' && /D2/.test(st.text), 4000);
    await H.settle(400, 3000);
    const expected = (p1 + p2 + p3).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '    ');
    rec({ boxShows: H.state().text.replace(/\n/g, '\\n').slice(0, 200) });
    await sendAndCheck('mixed', expected);
  }

  if (PARTS.includes('l500')) {
    console.log('--- 500 lines (~30 KB) (1 turn)');
    await H.smartClear();
    const text = mkLines(500, 'Reply with only the word OK and nothing else [tag-l500]. The lines below are filler to ignore.');
    const t0 = s.t();
    s.paste(text, 'paste');
    const r = await H.until((st) => st.kind === 'typed', 15000);
    await H.settle(500, 5000);
    const st = H.state();
    rec({ sentChars: text.length, sentLines: text.split('\n').length, appearedMs: r.ok ? r.ms : null, boxText: (st.text || '').slice(0, 120).replace(/\n/g, '\\n'), nBoxLines: st.nLines, hint: st.hint });
    s.snap('l500 box', {});
    await sendAndCheck('l500', text);
  }

  if (PARTS.includes('l200k')) {
    console.log('--- ~200 KB (1 turn)');
    await H.smartClear();
    const text = mkLines(3600, 'Reply with only the word OK and nothing else [tag-l200k]. The lines below are filler to ignore.');
    const t0 = s.t();
    s.paste(text, 'paste');
    const r = await H.until((st) => st.kind === 'typed', 60000);
    await H.settle(800, 8000);
    const st = H.state();
    rec({ sentChars: text.length, sentLines: text.split('\n').length, appearedMs: r.ok ? r.ms : null, boxText: (st.text || '').slice(0, 120).replace(/\n/g, '\\n'), nBoxLines: st.nLines });
    s.snap('l200k box', {});
    await sendAndCheck('l200k', text, 300);
  }
};
