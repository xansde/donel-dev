// PTY scenario driver for the 014-chat verification spike.
// run (via run.sh):  ELECTRON_RUN_AS_NODE=1 electron.exe driver.js scenarios/<name>.js
// node-pty in donel-dev is built for Electron's ABI, hence Electron-as-node.
const path = require('path');
const fs = require('fs');
const pty = require('C:/Users/xansd/seazone/donel-dev/node_modules/node-pty');
const { Terminal } = require('./xh/node_modules/@xterm/headless');

const B1 = __dirname.replace(/\\/g, '/');
const scPath = path.resolve(process.argv[2]);
const sc = require(scPath);
const name = sc.name || path.basename(scPath, '.js');

const logDir = B1 + '/logs';
const workDir = B1 + '/work';
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });
const cwd = workDir + '/' + (sc.cwdName || name);
fs.mkdirSync(cwd, { recursive: true });

const files = {
  screenLog: `${logDir}/${name}.screen.log`,
  hookLog: `${logDir}/${name}.hooks.jsonl`,
  policy: `${logDir}/${name}.policy.json`,
  settings: `${logDir}/${name}.settings.json`,
  debug: `${logDir}/${name}.debug.log`,
};
for (const f of [files.screenLog, files.hookLog]) fs.writeFileSync(f, '');
try { fs.unlinkSync(files.policy + '.state'); } catch {}
if (!fs.existsSync(files.policy)) fs.writeFileSync(files.policy, JSON.stringify({ rules: [] }));

const t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(1);
const append = (f, s) => fs.appendFileSync(f, s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const term = new Terminal({ cols: 120, rows: 40, scrollback: 2000, allowProposedApi: true });
const watchers = new Map(); // name -> {re, first, last, count, frame}

function viewport() {
  const b = term.buffer.active;
  const rows = [];
  for (let i = 0; i < term.rows; i++) {
    const ln = b.getLine(b.viewportY + i);
    rows.push(ln ? ln.translateToString(true) : '');
  }
  return rows;
}
function viewportText() {
  return viewport().join('\n').replace(/\n+$/g, '');
}
function fullText(lastN = 400) {
  const b = term.buffer.active;
  const lines = [];
  for (let i = Math.max(0, b.length - lastN); i < b.length; i++) {
    const ln = b.getLine(i);
    lines.push(ln ? ln.translateToString(true) : '');
  }
  return lines.join('\n');
}
function checkWatchers() {
  if (!watchers.size) return;
  const v = viewportText();
  for (const [n, w] of watchers) {
    if (w.re.test(v)) {
      w.count++;
      w.last = sec();
      if (w.first === null) {
        w.first = sec();
        w.frame = v;
        append(files.screenLog, `\n[${sec()}s ${new Date().toISOString().slice(11, 23)}] >>> WATCH '${n}' first seen. Viewport:\n${v}\n<<<\n`);
      }
    }
  }
}

const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) if (/^(CLAUDE|ANTHROPIC)/i.test(k)) delete cleanEnv[k];
delete cleanEnv.ELECTRON_RUN_AS_NODE;
cleanEnv.B1_HOOKLOG = files.hookLog;
cleanEnv.B1_POLICY = files.policy;
Object.assign(cleanEnv, sc.env || {});

const h = {
  B1, cwd, name, files, sec, sleep,
  log: (m) => append(files.screenLog, `[${sec()}s ${new Date().toISOString().slice(11, 23)}] ${m}\n`),
  iso: () => new Date().toISOString().slice(11, 23),
  writeSettings: (obj) => fs.writeFileSync(files.settings, JSON.stringify(obj, null, 2)),
  setPolicy: (rules) => fs.writeFileSync(files.policy, JSON.stringify({ rules }, null, 1)),
  viewport, viewportText, fullText,
  snap: (label) => append(files.screenLog, `\n[${sec()}s] --- SNAP ${label || ''} ---\n${viewportText()}\n--- end snap ---\n`),
  watch: (n, re) => watchers.set(n, { re, first: null, last: null, count: 0, frame: null }),
  unwatch: (n) => watchers.delete(n),
  seen: (n) => { const w = watchers.get(n); return w ? { first: w.first, last: w.last, count: w.count } : null; },
  resetWatch: (n) => { const w = watchers.get(n); if (w) { w.first = null; w.last = null; w.count = 0; w.frame = null; } },
  write: (s) => p.write(s),
  enter: () => p.write('\r'),
  key: { up: '\x1b[A', down: '\x1b[B', esc: '\x1b', tab: '\t', shiftTab: '\x1b[Z', ctrlC: '\x03', ctrlD: '\x04' },
  submit: async (text, { paste = false } = {}) => {
    if (paste) p.write('\x1b[200~' + text + '\x1b[201~');
    else p.write(text);
    await sleep(500);
    p.write('\r');
    h.log(`<<SUBMITTED ${JSON.stringify(text).slice(0, 160)}>>`);
  },
  hooks: () => fs.readFileSync(files.hookLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  hookStarts: (ev) => h.hooks().filter((e) => e.phase === 'start' && (!ev || e.ev === ev)),
  waitHook: async (pred, ms = 60000, label = '') => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const f = h.hooks().find(pred);
      if (f) return f;
      await sleep(250);
    }
    h.log(`!! waitHook TIMEOUT ${label}`);
    return null;
  },
  waitScreen: async (re, ms = 30000, label = '') => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (re.test(viewportText())) return true;
      await sleep(250);
    }
    h.log(`!! waitScreen TIMEOUT ${label} ${re}`);
    return false;
  },
  // wait until N Stop hooks have been recorded (turn finished)
  waitStops: async (n, ms = 90000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const c = h.hookStarts('Stop').length;
      if (c >= n) return true;
      await sleep(250);
    }
    h.log(`!! waitStops TIMEOUT (wanted ${n})`);
    return false;
  },
  transcriptDir: () => {
    const enc = cwd.replace(/\\/g, '/').replace(/[^A-Za-z0-9]/g, '-');
    return `C:/Users/xansd/.claude/projects/${enc}`;
  },
  kill: () => { if (exited) return; try { p.kill(); } catch {} },
};

let httpServer = null;
if (sc.http) {
  h.httpPort = sc.http.port || 47123;
  httpServer = require('./httphook')({ port: h.httpPort, policyFile: files.policy, hookLog: files.hookLog });
}
if (sc.setup) sc.setup(h);

const args = ['--model', sc.model || 'haiku', ...(sc.claudeArgs || [])];
if (sc.debug) args.push('--debug-file', files.debug);
args.push('--settings', files.settings);
h.log(`SPAWN claude ${args.join(' ')}  cwd=${cwd}`);
const p = pty.spawn('C:/Users/xansd/.local/bin/claude.exe', args, { name: 'xterm-256color', cols: 120, rows: 40, cwd, env: cleanEnv });
let exited = null;
p.onData((d) => { term.write(d, checkWatchers); });
p.onExit((e) => { exited = { ...e, at: sec() }; h.log('<<PROCESS EXIT ' + JSON.stringify(e) + '>>'); });
h.exited = () => exited;

(async () => {
  let trustState = 0; // 0 = not seen, 1 = down sent, 2 = enter sent
  let lastDown = 0;
  const trustTimer = setInterval(() => {
    const v = viewportText();
    if (/Allow external CLAUDE\.md file imports/i.test(v) && /Enter to confirm/i.test(v)) {
      if (Date.now() - lastDown > 1500) { lastDown = Date.now(); p.write('\r'); h.log('<<EXTERNAL-IMPORTS dialog: ENTER (default = No)>>'); }
      return;
    }
    if (/Bypass Permissions mode/i.test(v) && /Yes, I accept/i.test(v)) {
      if (Date.now() - lastDown > 1200) {
        lastDown = Date.now();
        if (/❯\s*Yes, I accept/i.test(v)) { p.write('\r'); h.log('<<BYPASS dialog: cursor on Yes -> ENTER>>'); } else { p.write('\x1b[B'); h.log('<<BYPASS dialog: DOWN>>'); }
      }
      return;
    }
    if (!/trust this folder/i.test(v) || !/Enter to confirm/i.test(v)) return;
    if (trustState === 2) return;
    if (/❯\s*Yes, I trust/i.test(v)) { trustState = 2; p.write('\r'); h.log('<<TRUST dialog: cursor on Yes -> ENTER>>'); return; }
    if (Date.now() - lastDown > 900) { lastDown = Date.now(); trustState = 1; p.write('\x1b[B'); h.log('<<TRUST dialog: DOWN>>'); }
  }, 300);
  const killer = setTimeout(() => { h.log('<<GLOBAL TIMEOUT KILL>>'); h.kill(); finish(1); }, (sc.maxSec || 240) * 1000);
  let done = false;
  const finish = (code) => {
    if (done) return; done = true;
    clearInterval(trustTimer); clearTimeout(killer);
    append(files.screenLog, `\n[${sec()}s] FINAL viewport:\n${viewportText()}\n`);
    const w = {};
    for (const [n, x] of watchers) w[n] = { first: x.first, last: x.last, count: x.count };
    append(files.screenLog, `WATCHERS: ${JSON.stringify(w)}\n`);
    setTimeout(() => process.exit(code), 300);
  };
  try {
    // wait for the prompt to be ready
    await h.waitScreen(/for shortcuts|to cycle|esc to interrupt/, 60000, 'initial prompt');
    await sleep(sc.startupWaitMs ?? 5000); // let SessionStart hooks settle
    await sc.run(h);
  } catch (e) {
    h.log('!! scenario error: ' + (e && e.stack || e));
  }
  h.kill();
  finish(0);
})();
