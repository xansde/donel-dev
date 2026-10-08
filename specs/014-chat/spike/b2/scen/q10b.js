// Q10b - no model turn: boot with each env set at 220 cols and read the "Transcript saving is off" warning.
const SETS = {
  none: { inheritEnv: [], env: {} },
  full: { inheritEnv: ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_EFFORT', 'CLAUDE_PID'], env: { CLAUDE_CODE_SESSION_ID: '00000000-0000-4000-8000-0000000000aa' } },
  only_CLAUDECODE: { inheritEnv: ['CLAUDECODE'], env: {} },
  only_ENTRYPOINT: { inheritEnv: ['CLAUDE_CODE_ENTRYPOINT'], env: {} },
  only_CHILD: { inheritEnv: ['CLAUDE_CODE_CHILD_SESSION'], env: {} },
  notStrippedByApp: { inheritEnv: ['CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_EFFORT', 'CLAUDE_PID'], env: { CLAUDE_CODE_SESSION_ID: '00000000-0000-4000-8000-0000000000aa' } },
  only_SESSION_ID: { inheritEnv: [], env: { CLAUDE_CODE_SESSION_ID: '00000000-0000-4000-8000-0000000000aa' } },
  child_plus_force: { inheritEnv: ['CLAUDE_CODE_CHILD_SESSION'], env: { CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1' } },
};
module.exports = async (A) => {
  for (const name of (process.env.SETS || Object.keys(SETS).join(',')).split(',')) {
    const cfg = SETS[name];
    const s = A.start({ name: 'q10b-' + name, cwd: A.dir('cwd'), quiet: true, cols: 220, inheritEnv: cfg.inheritEnv, env: cfg.env });
    await s.ready();
    await A.sleep(2500);
    const lines = s.screenLines();
    const warn = lines.filter((l) => /Transcript|persist|restart with|inherited/i.test(l)).map((l) => l.trim());
    const ss = s.hooks().find((h) => h.event === 'SessionStart');
    console.log(JSON.stringify({ set: name, warn, footer: s.footer().trim().slice(0, 70), perm: ss && ss.in.permission_mode, sessionStartSource: ss && ss.in.source }));
    await s.kill();
  }
};
