// Q7 (Esc interrupt then new message) and Q8 (queue while working). Slow tool = ping -n 8 127.0.0.1. bypassPermissions to avoid prompts.
const mk = require('./lib');

function brief(e, t0) {
  const rel = e.timestamp ? Date.parse(e.timestamp) - t0 : null;
  if (e.type === 'user' && e.message) {
    const c = e.message.content;
    if (typeof c === 'string') return { rel, kind: 'USER', src: e.promptSource, origin: e.origin && e.origin.kind, meta: e.isMeta, text: c.slice(0, 90) };
    return { rel, kind: 'USER', src: e.promptSource, blocks: c.map((b) => (b.type === 'tool_result' ? 'tool_result' + (b.is_error ? '(ERR)' : '') + ':' + String(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 70) : b.type === 'text' ? 'text:' + b.text.slice(0, 80) : b.type)) };
  }
  if (e.type === 'assistant') return { rel, kind: 'ASSISTANT', blocks: e.message.content.map((b) => (b.type === 'text' ? 'text:' + b.text.slice(0, 80) : b.type === 'tool_use' ? 'tool_use:' + JSON.stringify(b.input).slice(0, 60) : b.type)) };
  if (e.type === 'attachment') {
    const a = e.attachment;
    if (['hook_success', 'prompt_snapshot', 'total_tokens_reminder', 'environment', 'model', 'language', 'deferred_tools_delta', 'agent_listing_delta', 'mcp_instructions_delta', 'skill_listing', 'instructions', 'session_context', 'date', 'credential_org', 'remote_session_change'].includes(a.type)) return null;
    return { rel, kind: 'ATTACH', type: a.type, keys: Object.keys(a).join(','), prompt: a.prompt && String(a.prompt).slice(0, 80), commandMode: a.commandMode, origin: a.origin };
  }
  if (['file-history-snapshot', 'last-prompt', 'mode', 'permission-mode', 'atis-latch', 'bridge-session', 'ai-title', 'cost-state'].includes(e.type)) return null;
  return { rel, kind: e.type, sub: e.subtype, content: e.content && String(e.content).slice(0, 80) };
}

module.exports = async (A) => {
  const PARTS = (process.env.PARTS || 'q7,q8').split(',');
  const SLOW = 'Run this exact bash command and then reply with the single word DONE: ping -n 8 127.0.0.1';
  const rec = (o) => console.log(JSON.stringify(o));

  const bottom = (s, n = 8) => s.screenLines().slice(-n).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/─{6,}/g, '───').slice(0, 110));

  async function startWorking(s, H) {
    const eAt = (s.paste(SLOW, 'paste'), await A.sleep(200), s.write('\r', 'enter'));
    const pre = await s.waitHook('PreToolUse', { after: eAt - 50, timeout: 60000 });
    // hook list may contain user's other hooks? (ours logs only to HOOK_LOG)
    await A.sleep(1500);
    return { eAt, preOk: pre.ok };
  }

  if (PARTS.includes('q7')) {
    console.log('===== Q7 interrupt');
    const s = A.start({ name: 'q7', cwd: A.dir('cwd'), quiet: true, permissionMode: 'bypassPermissions' });
    await s.ready();
    await A.sleep(2500);
    const H = mk(A, s);
    const delays = (process.env.DELAYS || '0,150,600').split(',').map(Number);
    let round = 0;
    for (const D of delays) {
      round++;
      await H.smartClear();
      const roundStartAbs = Date.now();
      const w = await startWorking(s, H);
      rec({ round, D, toolStarted: w.preOk, working: { footer: s.footer().trim().slice(0, 80), bottom: bottom(s, 7) } });
      s.snap('q7 r' + round + ' working');
      const tEsc = s.write('\x1b', 'ESC-interrupt');
      await A.sleep(60);
      s.snap('q7 r' + round + ' +60ms after Esc');
      const snap60 = bottom(s, 9);
      if (D > 0) await A.sleep(D);
      const tPaste = (s.paste('reply with only the word OK' + round, 'paste'), s.t());
      await A.sleep(150);
      const tEnter = s.write('\r', 'enter-after-interrupt');
      const stop = await s.waitHook('Stop', { after: tEsc - 50, timeout: 60000 });
      await H.settle(600, 4000);
      s.snap('q7 r' + round + ' end');
      const tr = s.readTranscript() || [];
      const rows = tr.map((e) => brief(e, s.t0)).filter((x) => x && x.rel != null && x.rel >= tEsc - 3500).map((x) => ({ ...x, rel: x.rel - tEsc }));
      rec({ round, D, tEsc, pasteAfterEscMs: tPaste - tEsc, enterAfterEscMs: tEnter - tEsc, screenAt60ms: snap60, stopOk: stop.ok, stopRelEsc: stop.ok ? stop.t - tEsc : null });
      for (const r of rows) rec({ round, tr: r });
      const evs = s.hooks().filter((h) => h.startedAt - s.t0 >= tEsc - 3500).map((h) => (h.event + '@' + (h.startedAt - s.t0 - tEsc) + (h.in.prompt ? '[' + h.in.prompt.slice(0, 30) + ']' : '')));
      rec({ round, hookEventsRelEsc: evs });
      await A.sleep(500);
    }
    // Esc Esc on an idle empty box after a conversation: Rewind?
    await H.smartClear();
    s.write('\x1b', 'esc'); await A.sleep(80); s.write('\x1b', 'esc');
    await H.settle(700, 3000);
    s.snap('q7 esc-esc on empty box with history');
    rec({ escEscEmptyWithHistory: { kind: s.box().kind, region: s.screenLines().filter((l) => /Rewind|Restore|Esc to cancel|Enter to continue/.test(l)).map((l) => l.trim().slice(0, 100)) } });
    s.write('\x1b', 'esc'); await H.settle(500, 2500);
    await s.kill();
  }

  if (PARTS.includes('q8')) {
    console.log('===== Q8 queue while working');
    const s = A.start({ name: 'q8', cwd: A.dir('cwd'), quiet: true, permissionMode: 'bypassPermissions' });
    await s.ready();
    await A.sleep(2500);
    const H = mk(A, s);
    await H.smartClear();
    const w = await startWorking(s, H);
    rec({ toolStarted: w.preOk, bottomWorking: bottom(s, 8) });
    const tQ1 = (s.paste('queued-one: add the token QONE at the end of your final answer', 'paste'), await A.sleep(150), s.write('\r', 'enter-q1'));
    await A.sleep(400);
    s.snap('q8 +400ms after q1');
    rec({ afterQ1_400ms: bottom(s, 9), box: H.state() });
    await A.sleep(800);
    const tQ2 = (s.paste('queued-two: add the token QTWO at the end of your final answer', 'paste'), await A.sleep(150), s.write('\r', 'enter-q2'));
    await A.sleep(500);
    s.snap('q8 +500ms after q2');
    rec({ afterQ2_500ms: bottom(s, 10), box: H.state() });
    // hold the Up arrow test: "Press up to edit queued messages" is only observed, not used
    const stop1 = await s.waitHook('Stop', { after: w.eAt - 50, timeout: 90000 });
    await H.settle(1500, 8000);
    // wait for possible second Stop (queued messages run as a following turn)
    await A.sleep(8000);
    s.snap('q8 end');
    const tr = s.readTranscript() || [];
    const rows = tr.map((e) => brief(e, s.t0)).filter((x) => x && x.rel != null && x.rel >= w.eAt - 500).map((x) => ({ ...x, rel: x.rel }));
    rec({ eAt: w.eAt, tQ1, tQ2, stop1Rel: stop1.ok ? stop1.t : null });
    for (const r of rows) rec({ tr: r });
    rec({ hookEvents: s.hooks().filter((h) => h.startedAt - s.t0 >= w.eAt - 500).map((h) => h.event + '@' + (h.startedAt - s.t0) + (h.in.prompt ? '[' + h.in.prompt.slice(0, 40) + ']' : '') + (h.in.tool_name ? '{' + h.in.tool_name + '}' : '')) });
    await s.kill();
  }
};
