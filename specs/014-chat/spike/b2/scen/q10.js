// Q10 - does an inherited Claude Code environment disable transcript writing / change behavior? 1 tiny haiku turn per run.
// NOTE: CLAUDE_CODE_MESSAGING_SOCKET/TOKEN and CLAUDE_CODE_BRIDGE_SESSION_ID are deliberately NOT forwarded (they would attach the child to the parent's channels).
// CLAUDE_CODE_SESSION_ID is forwarded with a FAKE uuid (the real one would collide with the parent's per-session state).
const fs = require('fs');
const mk = require('./lib');

const FAKE_SID = '00000000-0000-4000-8000-0000000000aa';
const SETS = {
  full: { inheritEnv: ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_EFFORT', 'CLAUDE_PID'], env: { CLAUDE_CODE_SESSION_ID: FAKE_SID } },
  appStripped4: { inheritEnv: ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT'], env: {} },
  notStrippedByApp: { inheritEnv: ['CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_EFFORT', 'CLAUDE_PID'], env: { CLAUDE_CODE_SESSION_ID: FAKE_SID } },
  only_CLAUDECODE: { inheritEnv: ['CLAUDECODE'], env: {} },
  only_ENTRYPOINT: { inheritEnv: ['CLAUDE_CODE_ENTRYPOINT'], env: {} },
  only_CHILD: { inheritEnv: ['CLAUDE_CODE_CHILD_SESSION'], env: {} },
  only_SESSION_ID: { inheritEnv: [], env: { CLAUDE_CODE_SESSION_ID: FAKE_SID } },
  claudecode_entry: { inheritEnv: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'], env: {} },
  child_plus_force: { inheritEnv: ['CLAUDE_CODE_CHILD_SESSION'], env: { CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1' } },
  only_ATTENDED: { inheritEnv: ['CLAUDE_CODE_SESSION_ATTENDED'], env: {} },
};

module.exports = async (A) => {
  const which = (process.env.SETS || 'full').split(',');
  for (const name of which) {
    const cfg = SETS[name];
    const s = A.start({ name: 'q10-' + name, cwd: A.dir('cwd'), quiet: true, inheritEnv: cfg.inheritEnv, env: cfg.env });
    await s.ready();
    await A.sleep(2000);
    const H = mk(A, s);
    const footerBefore = s.footer().trim().slice(0, 70);
    s.paste('reply with only the word OK', 'paste');
    await H.until((st) => st.kind === 'typed', 3000);
    await A.sleep(150);
    const eAt = s.write('\r', 'enter');
    const up = await s.waitHook('UserPromptSubmit', { after: eAt - 50, timeout: 20000 });
    const stop = await s.waitHook('Stop', { after: eAt - 50, timeout: 60000 });
    await H.settle(800, 4000);
    const hs = s.hooks();
    const ss = hs.find((h) => h.event === 'SessionStart');
    const tp = s.transcriptPath();
    const exists = tp ? fs.existsSync(tp) : false;
    let entries = null; let userEntry = false;
    if (exists) { const tr = s.readTranscript(tp) || []; entries = tr.length; userEntry = tr.some((e) => e.type === 'user' && e.message && JSON.stringify(e.message.content).includes('reply with only the word OK')); }
    // any jsonl at all in the project dir created after spawn?
    const projDir = tp ? require('path').dirname(tp) : null;
    let newFiles = null;
    if (projDir && fs.existsSync(projDir)) newFiles = fs.readdirSync(projDir).filter((f) => f.endsWith('.jsonl') && fs.statSync(require('path').join(projDir, f)).mtimeMs >= s.t0).length;
    console.log(JSON.stringify({
      set: name, inherit: cfg.inheritEnv.concat(Object.keys(cfg.env)), footerBefore,
      sessionStart: ss ? { source: ss.in.source, permission_mode: ss.in.permission_mode, session_id: ss.in.session_id, transcript_path_tail: String(ss.in.transcript_path).slice(-48) } : null,
      userPromptSubmitHook: up.ok, stopHook: stop.ok, transcriptExists: exists, transcriptEntries: entries, userMessageInTranscript: userEntry, newJsonlInProjDir: newFiles,
      userEntryMeta: (() => { if (!exists) return null; const tr = s.readTranscript(tp) || []; const u = tr.find((e) => e.type === 'user' && e.message); return u ? { entrypoint: u.entrypoint, permissionMode: u.permissionMode, origin: u.origin, promptSource: u.promptSource } : null; })(),
    }));
    s.snap('end', { show: 7 });
    await s.kill();
  }
};
