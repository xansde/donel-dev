// Skill / project-command invocation by paste+Enter: exact command executed? how is it recorded (transcript + hook)?
const mk = require('./lib');
module.exports = async (A) => {
  const rec = (o) => console.log(JSON.stringify(o));
  const s = A.start({ name: 'q2f', cwd: A.dir('cwd'), quiet: true });
  await s.ready();
  await A.sleep(3000);
  const H = mk(A, s);
  for (const text of ['/spike-help', '/spike-skill alpha beta']) {
    await H.smartClear();
    s.paste(text, 'paste');
    await H.until((st) => st.kind === 'typed', 3000);
    await A.sleep(1200);
    const menu = s.screenLines().filter((l) => /^\s{2}❯\s+\//.test(l)).map((l) => l.trim().slice(0, 70));
    const eAt = (await A.sleep(100), s.write('\r', 'enter'));
    const up = await s.waitHook('UserPromptSubmit', { after: eAt - 50, timeout: 20000 });
    const stop = await s.waitHook('Stop', { after: eAt - 50, timeout: 60000 });
    await H.settle(500, 3000);
    const hp = s.hooks().filter((h) => h.event === 'UserPromptSubmit' && (h.startedAt - s.t0) > eAt - 50).map((h) => h.in.prompt);
    const tr = s.readTranscript() || [];
    const rel = tr.filter((e) => e.timestamp && Date.parse(e.timestamp) - s.t0 >= eAt - 100);
    const brief = rel.filter((e) => e.type === 'user' || e.type === 'assistant' || (e.type === 'system' && e.subtype === 'local_command')).map((e) => {
      const c = e.message ? e.message.content : e.content;
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.type === 'text' ? b.text : b.type).join('|') : String(c);
      return { type: e.type + (e.subtype ? ':' + e.subtype : ''), meta: e.isMeta, src: e.promptSource, text: txt.slice(0, 160) };
    });
    rec({ text, menuRowsBeforeEnter: menu, hookPrompt: hp, userPromptSubmitOk: up.ok, stopOk: stop.ok, transcript: brief });
  }
  await s.kill();
};
