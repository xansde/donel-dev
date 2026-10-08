// E1b: UI-level "entered" signals after Enter (box cleared, echo of the message, spinner) vs hook/transcript; E2b: ghost suggestion + bare Enter.
const mk = require('./lib');

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'ui,ghost').split(',');
  const rec = (o) => console.log(JSON.stringify(o));

  if (PARTS.includes('ui')) {
    for (const [label, extraWait] of [['gate+0', 0], ['gate+6s', 6000]]) {
      const s = A.start({ name: 'q2d-ui-' + label.replace(/\W/g, ''), cwd: A.dir('cwd'), quiet: true });
      await s.ready();
      const H = mk(A, s);
      if (extraWait) await A.sleep(extraWait);
      const tag = 'reply with only the word U' + extraWait;
      s.paste(tag, 'paste');
      const sh = await H.until((st) => st.kind === 'typed' && st.text === tag, 8000);
      await A.sleep(100);
      const eAt = s.write('\r', 'enter');
      // poll UI signals
      let clearedAt = null, echoAt = null, spinnerAt = null;
      const end = eAt + 12000;
      while (s.t() < end) {
        const st = s.boxState();
        const rows = s.screenLines();
        if (clearedAt == null && st.kind === 'empty') clearedAt = s.t() - eAt;
        if (echoAt == null && rows.some((l) => l.startsWith('❯') && l.includes(tag.slice(0, 25)) && !/^❯\s*$/.test(l)) && st.kind === 'empty') echoAt = s.t() - eAt;
        if (spinnerAt == null && rows.some((l) => /esc to interrupt/.test(l))) spinnerAt = s.t() - eAt;
        if (clearedAt != null && echoAt != null && spinnerAt != null) break;
        await A.sleep(10);
      }
      const up = await s.waitHook('UserPromptSubmit', { after: eAt - 50, timeout: 30000 });
      const tr = await s.waitTranscript((e) => e.type === 'user' && e.message && JSON.stringify(e.message.content).includes('word U' + extraWait), { timeout: 30000 });
      const ss = s.hooks().find((h) => h.event === 'SessionStart');
      rec({ label, pasteShownAfterMs: sh.ok ? sh.ms : null, boxClearedAfterEnterMs: clearedAt, messageEchoAfterEnterMs: echoAt, spinnerFooterAfterEnterMs: spinnerAt, hookAfterEnterMs: up.ok ? up.t - eAt : null, transcriptAfterEnterMs: tr.ok ? tr.t - eAt : null, sessionStartHookDoneAtRelEnter: ss ? (ss.ts - s.t0) - eAt : null });
      await s.waitHook('Stop', { after: eAt - 50, timeout: 60000 });
      await s.kill();
    }
  }

  if (PARTS.includes('ghost')) {
    const s = A.start({ name: 'q2d-ghost', cwd: A.dir('cwd'), quiet: true });
    await s.ready();
    await A.sleep(2500);
    const H = mk(A, s);
    // shell-mode turn tends to produce a prompt suggestion
    const e0 = (s.paste('!echo GHOST1', 'paste'), await A.sleep(150), s.write('\r', 'enter'));
    await s.waitHook('Stop', { after: e0 - 50, timeout: 60000 });
    let ghost = null;
    for (let i = 0; i < 120; i++) { await A.sleep(100); const st = s.boxState(); if (st.placeholder && st.rawText && !/^Try "/.test(st.rawText)) { ghost = st.rawText; break; } }
    rec({ ghostAfterShellTurn: ghost });
    s.snap('ghost');
    if (ghost) {
      const hooksBefore = s.hooks().length;
      const eB = s.write('\r', 'bare-enter');
      await A.sleep(3500);
      const hs = s.hooks().filter((h) => (h.startedAt - s.t0) > eB - 50).map((h) => h.event + (h.in.prompt ? '[' + h.in.prompt.slice(0, 40) + ']' : ''));
      const tr = (s.readTranscript() || []).filter((e) => e.type === 'user' && e.message).slice(-2).map((e) => JSON.stringify(e.message.content).slice(0, 120));
      rec({ bareEnterOnGhost: { hooksAfter: hs, lastUserEntries: tr, boxNow: H.state().kind } });
      s.snap('after bare enter');
    }
    await s.kill();
  }
};
