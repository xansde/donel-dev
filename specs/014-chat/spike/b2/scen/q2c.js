// E1: gate-based immediate send (paste right when the box+footer are visible). E2: unknown slash, path-like message, ghost-suggestion + Enter hazard.
const mk = require('./lib');

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'gate,misc').split(',');
  const rec = (o) => console.log(JSON.stringify(o));
  const userOf = (s, needle) => { const tr = s.readTranscript() || []; return tr.filter((e) => e.type === 'user' && e.message && JSON.stringify(e.message.content).includes(needle)); };

  if (PARTS.includes('gate')) {
    console.log('--- E1 gate-based immediate send');
    for (let i = 1; i <= 3; i++) {
      const s = A.start({ name: 'q2c-gate' + i, cwd: A.dir('cwd'), quiet: true });
      const tl = await s.ready();
      const H = mk(A, s);
      const gateAt = s.t();
      const tag = 'reply with only the word G' + i;
      const pAt = (s.paste(tag, 'paste'), s.t());
      const shown = await H.until((st) => st.kind === 'typed' && st.text === tag, 6000);
      const eAt = (await A.sleep(100), s.write('\r', 'enter'));
      const up = await s.waitHook('UserPromptSubmit', { after: eAt - 50, timeout: 30000 });
      const tr = await s.waitTranscript((e) => e.type === 'user' && e.message && JSON.stringify(e.message.content).includes('word G' + i), { timeout: 30000 });
      const stop = await s.waitHook('Stop', { after: eAt - 50, timeout: 60000 });
      const us = userOf(s, 'word G' + i);
      const hookPrompt = (s.hooks().filter((h) => h.event === 'UserPromptSubmit').pop() || { in: {} }).in.prompt;
      rec({ run: i, gateAt, ready: tl.readyAt, pasteShownAfterMs: shown.ok ? shown.ms : null, shownExact: shown.ok && shown.state.text === tag, enterToHookMs: up.ok ? up.t - eAt : null, enterToTranscriptMs: tr.ok ? tr.t - eAt : null, userEntries: us.length, hookPromptExact: hookPrompt === tag, stopOk: stop.ok });
      await s.kill();
    }
  }

  if (PARTS.includes('misc')) {
    console.log('--- E2 unknown slash / path-like / ghost suggestion');
    const s = A.start({ name: 'q2c-misc', cwd: A.dir('cwd'), quiet: true });
    await s.ready();
    await A.sleep(2000);
    const H = mk(A, s);
    const lastRows = (n) => s.screenLines().filter((l) => l.trim()).slice(-n).map((l) => l.trim().replace(/─{6,}/g, '───').slice(0, 110));

    // a. unknown slash command
    await H.smartClear();
    s.paste('/zzzunknown hello', 'paste'); await H.until((st) => st.kind === 'typed', 3000); await A.sleep(200);
    s.write('\x1b', 'esc-close-menu'); await A.sleep(250);
    s.write('\r', 'enter'); await H.settle(900, 4000);
    rec({ a_unknownSlash: lastRows(7) });

    // b. path-like first token
    await H.smartClear();
    s.paste('/etc/hosts reply with only the word PATHLIKE', 'paste'); await H.until((st) => st.kind === 'typed', 3000); await A.sleep(200);
    const menuB = s.screenLines().filter((l) => /^\s*❯\s+\//.test(l)).map((l) => l.trim().slice(0, 80));
    rec({ b_menuRows: menuB });
    const eB = s.write('\r', 'enter');
    await H.settle(1500, 6000);
    const upB = s.hooks().some((h) => h.event === 'UserPromptSubmit' && (h.startedAt - s.t0) > eB - 50);
    rec({ b_pathLike: { userPromptSubmitFired: upB, rows: lastRows(8) } });
    if (upB) await s.waitHook('Stop', { after: eB - 50, timeout: 60000 });

    // c. ghost suggestion + bare Enter
    await H.smartClear();
    const eC = (s.paste('reply with only the word OK', 'paste'), await A.sleep(150), s.write('\r', 'enter'));
    await s.waitHook('Stop', { after: eC - 50, timeout: 60000 });
    // wait up to 10 s for a dim ghost suggestion in the box
    let ghost = null;
    for (let i = 0; i < 100; i++) { await A.sleep(100); const raw = s.boxState(); if (raw.placeholder && raw.rawText) { ghost = raw.rawText; break; } }
    rec({ c_ghostSuggestionAfterTurn: ghost, box: H.state().kind });
    s.snap('ghost');
    const nUsersBefore = (s.readTranscript() || []).filter((e) => e.type === 'user' && e.message && e.promptSource === 'typed').length;
    const eC2 = s.write('\r', 'bare-enter');
    await A.sleep(2500);
    const nUsersAfter = (s.readTranscript() || []).filter((e) => e.type === 'user' && e.message && e.promptSource === 'typed').length;
    const upC = s.hooks().filter((h) => h.event === 'UserPromptSubmit' && (h.startedAt - s.t0) > eC2 - 50).map((h) => h.in.prompt);
    rec({ c_bareEnter: { typedUserEntriesBefore: nUsersBefore, after: nUsersAfter, userPromptSubmit: upC, rows: lastRows(6) } });
    await s.waitHook('Stop', { after: eC2 - 50, timeout: 30000 });
    await s.kill();
  }
};
