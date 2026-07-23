// T009 addendum test: does the `Notification` hook fire inside a REAL PTY
// (node-pty/ConPTY), unlike the T002 spike (headless `claude -p` / non-TTY
// stdin), which never observed it in 5 attempts?
//
// Must run under Electron's Node-compatible ABI, because node-pty's native
// binding (conpty.node) was rebuilt for Electron by the project's postinstall
// (`electron-rebuild -f -w node-pty`, see CLAUDE.md gotcha) — a plain `node`
// process cannot load it (ABI mismatch). Run with:
//
//   set ELECTRON_RUN_AS_NODE=1
//   node_modules\.bin\electron.cmd specs\001-mvp\spike-t002\notification-real-tty-test.cjs
//
// (ELECTRON_RUN_AS_NODE makes the Electron binary behave as a plain Node
// process, no window opened — same trick usable for any future main-process
// -only smoke without a full BrowserWindow.)
//
// Scenario forced: --permission-mode default + permissions.ask:["Bash"]
// (same combo the T002 spike used to force a pending-permission turn),
// inside a REAL interactive PTY session (not `-p`, not piped stdin) — this
// is exactly the environment gap the spike's "Não verificado" section
// flagged as untested.
//
// v2: v1 rushed the prompt in before this machine's (broken, unrelated)
// global SessionStart hooks finished erroring out, and before "N MCP servers
// need authentication" settled — UserPromptSubmit only registered ~27s after
// the keystrokes were sent, so the Bash tool call never actually happened
// (no PreToolUse at all) before the script gave up and sent /exit. v2 waits
// for buffer stability (no new bytes for 2s) before typing anything, and
// waits for UserPromptSubmit to be CONFIRMED by the hook before starting the
// post-prompt observation window.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node-pty');

const PORT = 8766;
const SETTINGS_PATH = path.join(__dirname, 'hooks-settings-realtty.json');
const CLAUDE_PATH = 'C:\\Users\\xansd\\.local\\bin\\claude.exe';
const CWD = path.join(__dirname, '..', '..', '..'); // repo root (already trust-accepted by prior smoke runs)
const RAW_LOG_PATH = path.join(__dirname, 'notification-real-tty-rawbuffer.log');

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g;
function stripAnsi(s) {
  return s.replace(ANSI_RE, '');
}

const events = [];
let rawBuffer = '';
let lastDataAt = Date.now();

const startedAt = Date.now();
function log(msg) {
  console.log(`[t009-realtty +${Date.now() - startedAt}ms] ${msg}`);
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/hook') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let payload = null;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = { parse_error: true, raw: body.slice(0, 300) };
      }
      events.push({ at: Date.now(), payload });
      log(`HOOK RECEIVED: ${payload.hook_event_name ?? '?'}`);
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(pollMs);
  }
  return false;
}

/** Waits until no new PTY bytes arrived for `quietMs`, or `timeoutMs` elapses. */
async function waitForQuiet(quietMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Date.now() - lastDataAt >= quietMs) return true;
    await wait(200);
  }
  return false;
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  log(`capture server listening on 127.0.0.1:${PORT}`);

  const sessionId = crypto.randomUUID();
  log(`spawning claude (session-id=${sessionId}, cwd=${CWD})`);

  const ptyProcess = spawn(
    CLAUDE_PATH,
    ['--model', 'haiku', '--permission-mode', 'default', '--settings', SETTINGS_PATH, '--session-id', sessionId],
    { name: 'xterm-color', cols: 120, rows: 40, cwd: CWD, env: process.env }
  );

  let ptyExited = false;
  let ptyExitInfo = null;

  ptyProcess.onData((chunk) => {
    rawBuffer += chunk;
    lastDataAt = Date.now();
  });
  ptyProcess.onExit((info) => {
    ptyExited = true;
    ptyExitInfo = info;
    log(`PTY onExit: exitCode=${info.exitCode} signal=${info.signal}`);
  });

  // Heartbeat so we can see progress live instead of only at the end.
  const heartbeat = setInterval(() => {
    const tail = stripAnsi(rawBuffer).replace(/\s+/g, ' ').slice(-160);
    log(`heartbeat bufferLen=${rawBuffer.length} tail="${tail}"`);
  }, 5000);

  // 1. Wait for the banner AND for the buffer to go quiet (this machine's
  // broken global SessionStart hooks + "N MCP servers need authentication"
  // check take a while to finish printing) before typing anything.
  await waitUntil(() => /claude code/i.test(stripAnsi(rawBuffer)) || /trust this folder/i.test(stripAnsi(rawBuffer)), 30000);
  if (/trust this folder/i.test(stripAnsi(rawBuffer))) {
    log('trust dialog detected — sending Enter to accept default (Yes, trust folder)');
    ptyProcess.write('\r');
    await wait(2000);
  }
  await waitUntil(() => /claude code/i.test(stripAnsi(rawBuffer)), 20000);
  const quiet = await waitForQuiet(2500, 60000);
  log(`buffer quiet before typing: ${quiet}`);
  await wait(1000);

  // 2. Send a trivial prompt that requires Bash — Bash is in permissions.ask,
  // so the CLI must either auto-resolve it (as the spike saw headless) or
  // present a real interactive approval UI (what we're testing for).
  const prompt = 'Rode via Bash o comando: echo notification-test-t009';
  log(`sending prompt: ${JSON.stringify(prompt)}`);
  ptyProcess.write(prompt);
  await wait(400);
  ptyProcess.write('\r');

  // 3. Confirm the prompt was actually registered (UserPromptSubmit hook)
  // before starting the real observation window — v1's bug was assuming
  // this happened instantly.
  const promptConfirmed = await waitUntil(
    () => events.some((e) => e.payload?.hook_event_name === 'UserPromptSubmit'),
    30000,
    500
  );
  log(`UserPromptSubmit confirmed: ${promptConfirmed}`);

  // 4. Now watch for up to 40s: Notification hook, PreToolUse/Stop (proof a
  // real turn happened), or interactive permission UI text in the buffer.
  const sawNotification = await waitUntil(
    () => events.some((e) => e.payload?.hook_event_name === 'Notification'),
    40000,
    500
  );
  const bufferStripped = stripAnsi(rawBuffer);
  const permissionUiPatterns = [/do you want to proceed/i, /permission to use/i, /1\.\s*yes/i, /allow this/i, /permissão/i];
  const sawPermissionUiText = permissionUiPatterns.some((re) => re.test(bufferStripped));
  const sawPreToolUse = events.some((e) => e.payload?.hook_event_name === 'PreToolUse');
  const sawPostToolUse = events.some((e) => e.payload?.hook_event_name === 'PostToolUse');
  const sawStop = events.some((e) => e.payload?.hook_event_name === 'Stop');

  log(
    `sawNotification=${sawNotification} sawPermissionUiText=${sawPermissionUiText} sawPreToolUse=${sawPreToolUse} sawPostToolUse=${sawPostToolUse} sawStop=${sawStop}`
  );
  log(`events so far: ${events.map((e) => e.payload?.hook_event_name ?? '?').join(', ')}`);

  // 5. If an interactive UI is showing, decline it so the session doesn't hang.
  if (sawPermissionUiText && !sawNotification) {
    log('permission UI text present without Notification hook — declining to unblock the session');
    ptyProcess.write('2');
    await wait(200);
    ptyProcess.write('\r');
    await wait(2000);
  }

  // 6. Graceful exit via `/exit` — also captures SessionEnd.reason for a
  // REPL exit (spike only saw reason="other" via headless `-p`).
  log('sending /exit for graceful shutdown');
  ptyProcess.write('/exit');
  await wait(400);
  ptyProcess.write('\r');

  const sawSessionEnd = await waitUntil(() => events.some((e) => e.payload?.hook_event_name === 'SessionEnd'), 15000, 500);
  log(`sawSessionEnd (graceful)=${sawSessionEnd}`);

  if (!ptyExited) {
    log('PTY still alive after /exit attempt — force killing');
    ptyProcess.kill();
    await wait(1000);
  }

  clearInterval(heartbeat);

  const sessionEndEvent = events.find((e) => e.payload?.hook_event_name === 'SessionEnd');
  const notificationEvent = events.find((e) => e.payload?.hook_event_name === 'Notification');

  fs.writeFileSync(RAW_LOG_PATH, stripAnsi(rawBuffer), 'utf8');

  const report = {
    sessionId,
    promptConfirmed,
    sawNotification,
    sawPermissionUiText,
    sawPreToolUse,
    sawPostToolUse,
    sawStop,
    sawSessionEndGraceful: sawSessionEnd,
    sessionEndReason: sessionEndEvent?.payload?.reason ?? null,
    ptyExited,
    ptyExitInfo,
    eventSequence: events.map((e) => e.payload?.hook_event_name ?? '?'),
    notificationPayload: notificationEvent?.payload ?? null,
    rawLogPath: RAW_LOG_PATH,
  };

  console.log('--- REPORT_JSON_START ---');
  console.log(JSON.stringify(report, null, 2));
  console.log('--- REPORT_JSON_END ---');

  server.close();
  setTimeout(() => process.exit(0), 500);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});

// Absolute safety net: never let this diagnostic hang the calling agent.
setTimeout(() => {
  console.error('HARD TIMEOUT — forcing exit');
  process.exit(1);
}, 170000);
