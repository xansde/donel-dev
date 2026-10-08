// Q5 - image by path: does a pasted path become [Image #N]? what reaches the transcript? (2 haiku turns)
const mk = require('./lib');

function userEntries(tr) {
  return (tr || []).filter((e) => e.type === 'user' && e.message).map((e) => ({ e, c: e.message.content }));
}

module.exports = async (A) => {
  const s = A.start({ name: 'q5', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(2000);
  const H = mk(A, s);
  const rec = (o) => console.log(JSON.stringify(o));
  const png = A.dir('assets/red.png');                 // C:\...\b2\assets\red.png
  const pngFwd = png.replace(/\\/g, '/');
  const pngSp = A.dir('assets/red square.png');
  const cases = [
    ['abs backslash, no quotes', png],
    ['abs forward slash, no quotes', pngFwd],
    ['abs backslash, double quotes', '"' + png + '"'],
    ['abs backslash, single quotes', "'" + png + "'"],
    ['abs w/ spaces, no quotes', pngSp],
    ['abs w/ spaces, double quotes', '"' + pngSp + '"'],
    ['abs w/ spaces, backslash-escaped spaces', pngSp.replace(/ /g, '\\ ')],
    ['path + trailing space', png + ' '],
    ['path embedded in text', 'look at ' + png + ' please'],
    ['relative path', 'assets-red.png'],
    ['@relative mention', '@assets-red.png'],
    ['file:// url', 'file:///' + pngFwd],
  ];
  for (const [label, text] of cases) {
    await H.smartClear();
    const t0 = s.t();
    s.paste(text, 'paste');
    // image conversion may be async (file read): wait up to 4 s for an [Image placeholder, else settle
    await H.until((st) => /\[Image #\d+\]/.test(st.text || ''), 4000);
    await H.settle(500, 3000);
    const st = H.state();
    rec({ label, boxKind: st.kind, boxText: (st.text || '').slice(0, 90), converted: /\[Image #\d+\]/.test(st.text || ''), ms: s.t() - t0, hint: st.hint, below: st.below });
  }
  s.snap('last case');

  // ---- turn 1: converted image + text
  console.log('--- turn 1: abs backslash path -> [Image] + text');
  await H.smartClear();
  s.paste(png, 'paste');
  await H.until((st) => /\[Image #\d+\]/.test(st.text || ''), 4000);
  await H.settle(400, 3000);
  const afterImg = H.state();
  rec({ afterImagePaste: afterImg.text });
  s.paste(' describe the image in 3 words', 'paste');
  await H.settle(400, 3000);
  rec({ boxBeforeEnter: H.state().text });
  const e1 = (await A.sleep(150), s.write('\r', 'enter'));
  await s.waitHook('Stop', { after: e1 - 50, timeout: 90000 });
  await H.settle(400, 3000);
  s.snap('after turn 1', {});
  let tr = s.readTranscript();
  let us = userEntries(tr);
  const u1 = us[us.length - 1];
  rec({ turn1UserContent: Array.isArray(u1.c) ? u1.c.map((b) => b.type === 'image' ? { type: 'image', media: b.source && b.source.media_type, srcType: b.source && b.source.type, b64len: b.source && b.source.data && b.source.data.length } : b.type === 'text' ? { type: 'text', text: b.text } : { type: b.type }) : { string: u1.c } });
  const hookPrompt = (s.hooks().filter((h) => h.event === 'UserPromptSubmit').pop() || { in: {} }).in;
  rec({ hookPromptField: hookPrompt.prompt });
  const asst = (tr || []).filter((e) => e.type === 'assistant').pop();
  rec({ assistantReply: asst && asst.message && asst.message.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 120) });

  // ---- turn 2: @mention of the image file
  console.log('--- turn 2: @assets-red.png mention');
  await H.smartClear();
  s.paste('@assets-red.png describe it in 3 words', 'paste');
  await H.settle(600, 3000);
  rec({ boxBeforeEnter2: H.state().text, below: H.state().below });
  // close any file-suggestion menu with a single Esc only if a menu row is visible above the box
  const menuRows = s.screenLines().filter((l) => /^\s*(❯|›)?\s*(assets-red\.png|@assets)/.test(l));
  rec({ menuRows });
  const e2 = (await A.sleep(150), s.write('\r', 'enter'));
  await s.waitHook('Stop', { after: e2 - 50, timeout: 90000 });
  await H.settle(400, 3000);
  s.snap('after turn 2', {});
  tr = s.readTranscript();
  us = userEntries(tr);
  const u2 = us[us.length - 1];
  rec({ turn2UserContent: Array.isArray(u2.c) ? u2.c.map((b) => (b.type === 'image' ? { type: 'image', b64len: b.source && b.source.data && b.source.data.length } : { type: b.type, text: b.text && b.text.slice(0, 120) })) : { string: u2.c } });
  // attachments recorded around turn 2
  const att = (tr || []).filter((e) => e.type === 'attachment' && e.attachment && e.attachment.type !== 'hook_success').slice(-4).map((e) => ({ t: e.attachment.type, k: Object.keys(e.attachment).join(','), file: e.attachment.filename || (e.attachment.content && e.attachment.content.file && e.attachment.content.file.filePath) }));
  rec({ attachments: att });
  const asst2 = (tr || []).filter((e) => e.type === 'assistant').pop();
  rec({ assistantReply2: asst2 && asst2.message && asst2.message.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 120) });
};
