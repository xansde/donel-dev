// Blind send right at the readiness gate: paste, then Enter after `gap` ms WITHOUT waiting for the paste to render.
module.exports = async (A) => {
  const rec = (o) => console.log(JSON.stringify(o));
  for (const gap of [100, 0]) {
    const s = A.start({ name: 'q2h-' + gap, cwd: A.dir('cwd'), quiet: true });
    await s.ready();
    const tag = 'reply with only the word BLIND' + gap;
    const pAt = (s.paste(tag, 'paste'), s.t());
    if (gap) await A.sleep(gap);
    const eAt = s.write('\r', 'enter');
    const up = await s.waitHook('UserPromptSubmit', { after: eAt - 50, timeout: 40000 });
    const stop = await s.waitHook('Stop', { after: eAt - 50, timeout: 60000 });
    const hp = s.hooks().filter((h) => h.event === 'UserPromptSubmit').map((h) => h.in.prompt);
    const tr = s.readTranscript() || [];
    const users = tr.filter((e) => e.type === 'user' && e.message && JSON.stringify(e.message.content).includes('BLIND' + gap));
    rec({ gap, readyAt: s.firstMark('ready'), pasteAt: pAt, enterAt: eAt, hookPrompts: hp, hookAfterEnterMs: up.ok ? up.t - eAt : null, userEntries: users.length, stopOk: stop.ok });
    await s.kill();
  }
};
