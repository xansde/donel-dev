'use strict';
// Scripted interactive driver for the Claude Code TUI: node-pty (ConPTY) + @xterm/headless screen model.
// Run (Electron-as-node, node-pty is built for Electron's ABI):
//   ELECTRON_RUN_AS_NODE=1 <donel-dev>/node_modules/electron/dist/electron.exe driver.js scen/<name>.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const pty = require('C:/Users/xansd/seazone/donel-dev/node_modules/node-pty');
const { Terminal } = require('@xterm/headless');

const ROOT = __dirname;
const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const CLAUDE_EXE = 'C:/Users/xansd/.local/bin/claude.exe';
const HOME = os.homedir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BP_ON = '\x1b[200~';
const BP_OFF = '\x1b[201~';
const sessions = [];

// ---------- helpers on screen lines (same structural idea as src/shared/cliInputBox.ts) ----------
function isRuler(line) {
  const t = line.trim();
  if (!t) return false;
  let n = 0;
  for (const ch of t) if (ch === '\u2500') n++;
  return n >= 10 && n * 2 >= t.length;
}
const PROMPT_RE = /^\s*[\u276F>!#&]\s?/;
const MENU_OPT_RE = /^\s*[\u276F>]?\s*\d+\.\s+\S/;

function readBox(lines) {
  let bottom = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (isRuler(lines[i])) { bottom = i; break; }
  if (bottom <= 0) return { kind: 'unreadable' };
  let top = -1;
  for (let i = bottom - 1; i >= 0; i--) if (isRuler(lines[i])) { top = i; break; }
  if (top < 0) return { kind: 'unreadable' };
  const inside = lines.slice(top + 1, bottom);
  if (!inside.length || inside.length > 14) return { kind: 'unreadable', top, bottom, inside };
  if (inside.some((l) => MENU_OPT_RE.test(l))) return { kind: 'menu', top, bottom, inside };
  const at = inside.findIndex((l) => PROMPT_RE.test(l));
  if (at < 0) return { kind: 'unreadable', top, bottom, inside };
  const first = inside[at].replace(PROMPT_RE, '');
  const rest = inside.slice(at + 1).map((l) => l.replace(/^ {2}/, ''));
  const textLines = [first, ...rest];
  const joined = textLines.join('\n');
  const mark = (inside[at].match(PROMPT_RE) || [''])[0].trim();
  return { kind: joined.trim() === '' ? 'empty' : 'typed', text: joined, textLines, mark, top, bottom, inside };
}

class Session {
  constructor(A, o) {
    this.A = A;
    this.o = o;
    this.name = o.name;
    this.cwd = o.cwd;
    this.cols = o.cols || 120;
    this.rows = o.rows || 40;
    this.logFile = path.join(LOGS, this.name + '.jsonl');
    this.txtFile = path.join(LOGS, this.name + '.txt');
    this.hookLog = path.join(LOGS, this.name + '.hooks.jsonl');
    fs.writeFileSync(this.logFile, '');
    fs.writeFileSync(this.txtFile, '');
    try { fs.unlinkSync(this.hookLog); } catch (e) { /* none */ }
    this.raw = '';
    this.rawChunks = [];
    this.writes = [];
    this.events = [];
    this.waiters = new Set();
    this.exited = null;
    this.firstDataAt = null;
    this.term = new Terminal({ cols: this.cols, rows: this.rows, scrollback: 5000, allowProposedApi: true });
    this.term.onData((d) => { this._log({ t: this.t(), k: 'termreply', d }); try { this.proc.write(d); } catch (e) { /* ignore */ } });
  }

  _spawn() {
    const o = this.o;
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^(CLAUDE|ANTHROPIC)/i.test(k)) continue;
      if (k === 'ELECTRON_RUN_AS_NODE') continue;
      env[k] = v;
    }
    for (const k of o.inheritEnv || []) if (process.env[k] !== undefined) env[k] = process.env[k];
    Object.assign(env, o.env || {});
    env.HOOK_LOG = this.hookLog;
    const args = [];
    if (o.model !== null) args.push('--model', o.model || 'haiku');
    if (o.permissionMode !== null) args.push('--permission-mode', o.permissionMode || 'default');
    if (o.settings !== null) args.push('--settings', o.settings || path.join(ROOT, 'settings-hook.json'));
    args.push(...(o.extraArgs || []));
    this.args = args;
    this.t0 = Date.now();
    this.proc = pty.spawn(CLAUDE_EXE, args, { name: 'xterm-256color', cols: this.cols, rows: this.rows, cwd: this.cwd, env });
    this.pid = this.proc.pid;
    this.mark('spawn', { pid: this.pid, args: args.join(' ') });
    this.proc.onData((d) => this._onData(d));
    this.proc.onExit((e) => { this.exited = e; this.mark('exit', e); this._tick(); });
    this.iv = setInterval(() => this._tick(), 20);
  }

  t() { return Date.now() - this.t0; }
  _log(o) { try { fs.appendFileSync(this.logFile, JSON.stringify(o) + '\n'); } catch (e) { /* ignore */ } }
  mark(name, extra) {
    const e = { t: this.t(), name, ...(extra || {}) };
    this.events.push(e);
    this._log({ t: e.t, k: 'mark', name, extra });
    if (!this.o.quiet) console.log(`[${this.name} +${String(e.t).padStart(5)}ms] ${name}${extra ? ' ' + JSON.stringify(extra) : ''}`);
    return e.t;
  }
  firstMark(name) { const e = this.events.find((x) => x.name === name); return e ? e.t : null; }

  _onData(d) {
    const t = this.t();
    if (this.firstDataAt == null) { this.firstDataAt = t; this.mark('first-data'); }
    this.raw += d;
    this.rawChunks.push({ t, d });
    this._log({ t, k: 'out', d });
    this.term.write(d, () => this._tick());
  }

  // ---- writing ----
  write(data, label) {
    const t = this.t();
    this.writes.push({ t, label, len: data.length });
    this._log({ t, k: 'in', label, len: data.length, d: data.length > 300 ? data.slice(0, 120) + `...<${data.length} chars>...` + data.slice(-60) : data });
    try { this.proc.write(data); } catch (e) { this.mark('write-error', { msg: String(e) }); }
    return t;
  }
  paste(text, label) { return this.write(BP_ON + text + BP_OFF, label || 'paste'); }
  enter() { return this.write('\r', 'enter'); }
  async type(str, gap = 25) { for (const ch of str) { this.write(ch, 'type'); await sleep(gap); } }

  // ---- screen ----
  screenLines() {
    const b = this.term.buffer.active;
    const out = [];
    for (let y = 0; y < this.term.rows; y++) { const l = b.getLine(b.baseY + y); out.push(l ? l.translateToString(true).replace(/\s+$/, '') : ''); }
    return out;
  }
  allLines() {
    const b = this.term.buffer.active;
    const out = [];
    for (let y = 0; y < b.length; y++) { const l = b.getLine(y); out.push(l ? l.translateToString(true).replace(/\s+$/, '') : ''); }
    return out;
  }
  screenText() { return this.screenLines().join('\n'); }
  allText() { return this.allLines().join('\n'); }
  box() { return readBox(this.screenLines()); }
  footer() { return this.screenLines().find((l) => /(manual|accept edits|plan|auto|bypass permissions?) mode on|shift\+tab to cycle|for shortcuts|esc to interrupt|bypass permissions on|accept edits on/i.test(l)) || ''; }
  isAltScreen() { return this.term.buffer.active.type === 'alternate'; }
  cursor() { const b = this.term.buffer.active; return { x: b.cursorX, y: b.cursorY }; }
  // attribute summary of cells in row y between x0..x1: dim/bold/inverse/fg
  cellAttrs(y, x0 = 0, x1 = 40) {
    const b = this.term.buffer.active;
    const line = b.getLine(b.baseY + y);
    const out = [];
    if (!line) return out;
    for (let x = x0; x < x1 && x < this.cols; x++) {
      const c = line.getCell(x);
      if (!c) break;
      out.push({ x, ch: c.getChars() || ' ', dim: c.isDim(), bold: c.isBold(), inv: c.isInverse(), ital: c.isItalic(), fg: c.isFgDefault() ? 'def' : (c.isFgPalette() ? 'p' + c.getFgColor() : 'rgb' + c.getFgColor().toString(16)) });
    }
    return out;
  }
  // box state with placeholder detection (dim text on the first prompt line)
  boxState() {
    const lines = this.screenLines();
    const b = readBox(lines);
    if (b.kind !== 'empty' && b.kind !== 'typed') return b;
    const promptRow = b.top + 1 + b.inside.findIndex((l) => PROMPT_RE.test(l));
    const attrs = this.cellAttrs(promptRow, 2, this.cols).filter((c) => c.ch.trim());
    const placeholder = b.kind === 'typed' && attrs.length > 0 && attrs.every((c) => c.dim);
    return { ...b, placeholder, kind: placeholder ? 'empty' : b.kind, text: placeholder ? '' : b.text, rawText: b.text, promptRow, cursor: this.cursor() };
  }
  hasRaw(s) { return this.raw.includes(s); }
  snap(label, o2 = {}) {
    const lines = this.screenLines();
    let last = lines.length - 1;
    while (last > 0 && !lines[last].trim()) last--;
    const b = this.term.buffer.active;
    const head = `=== [${this.name} +${this.t()}ms] ${label}  (cursor ${b.cursorX},${b.cursorY}; buffer=${b.type}) ===\n`;
    const body = lines.slice(0, last + 1).map((l, i) => String(i).padStart(2) + '|' + l).join('\n') + '\n';
    fs.appendFileSync(this.txtFile, head + body + '\n');
    if (o2.show) {
      const n = o2.show === true ? 14 : o2.show;
      console.log(head.trim());
      console.log(lines.slice(Math.max(0, last + 1 - n), last + 1).map((l, i) => '   |' + l).join('\n'));
    }
    return lines;
  }

  // ---- waiting ----
  _tick() {
    for (const w of [...this.waiters]) w();
  }
  waitFor(cond, o = {}) {
    const timeout = o.timeout == null ? 15000 : o.timeout;
    const test = typeof cond === 'function' ? () => cond(this)
      : cond instanceof RegExp ? () => cond.test(this.screenText())
        : () => this.screenText().includes(cond);
    return new Promise((resolve) => {
      const started = Date.now();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        this.waiters.delete(check);
        clearTimeout(to);
        resolve({ ok, t: this.t(), waited: Date.now() - started });
      };
      const check = () => {
        let ok = false;
        try { ok = !!test(); } catch (e) { ok = false; }
        if (ok) finish(true);
        else if (this.exited && !o.allowExit) finish(false);
      };
      const to = setTimeout(() => finish(false), timeout);
      this.waiters.add(check);
      check();
    });
  }
  // wait until no output has arrived for `ms`
  async quiet(ms = 400, max = 15000, minWait = 150) {
    const started = Date.now();
    await sleep(minWait); // give the reaction to the previous write time to start
    for (;;) {
      const last = this.rawChunks.length ? this.rawChunks[this.rawChunks.length - 1].t : 0;
      if (this.t() - last >= ms) return this.t();
      if (Date.now() - started > max) return -1;
      await sleep(20);
    }
  }

  // ---- hooks / transcript ----
  hooks() {
    try {
      return fs.readFileSync(this.hookLog, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { return []; }
  }
  hookTimes(event) { return this.hooks().filter((h) => h.event === event).map((h) => ({ rel: h.startedAt - this.t0, relDone: h.ts - this.t0, in: h.in })); }
  waitHook(event, o = {}) {
    const after = o.after == null ? -1e9 : o.after;
    return this.waitFor(() => this.hooks().some((h) => h.event === event && (h.startedAt - this.t0) > after && (!o.pred || o.pred(h))), { timeout: o.timeout == null ? 20000 : o.timeout });
  }
  transcriptPath() {
    const hs = this.hooks().filter((h) => h.in && h.in.transcript_path);
    return hs.length ? hs[hs.length - 1].in.transcript_path : null;
  }
  readTranscript(p) {
    p = p || this.transcriptPath();
    if (!p || !fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { _bad: l.slice(0, 200) }; } });
  }
  waitTranscript(pred, o = {}) {
    return this.waitFor(() => { const tr = this.readTranscript(o.path); return tr && tr.some(pred); }, { timeout: o.timeout == null ? 20000 : o.timeout });
  }

  // ---- lifecycle ----
  async kill() {
    clearInterval(this.iv);
    if (this.exited) return;
    try { this.proc.kill(); } catch (e) { /* ignore */ }
    try { cp.execSync(`taskkill /PID ${this.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { /* already gone */ }
    for (let i = 0; i < 40 && !this.exited; i++) await sleep(50);
  }

  // Wait until the TUI looks ready (optionally auto-accept the trust dialog). Returns a timeline object.
  async ready(o = {}) {
    const tl = { trustSeen: null, trustAccepted: null, bannerAt: null, boxAt: null, footerAt: null, readyAt: null };
    const deadline = Date.now() + (o.timeout || 40000);
    let acceptedWrite = false;
    for (;;) {
      if (this.exited) { tl.exited = true; break; }
      const text = this.screenText();
      const trust = /Enter to confirm/.test(text) && /trust this folder/.test(text);
      if (trust && tl.trustSeen == null) { tl.trustSeen = this.mark('trust-dialog-visible'); this.snap('trust-dialog', {}); }
      if (trust && o.autoTrust !== false && !acceptedWrite) {
        // v2.1.293: default selection is "No, exit"; "Yes, I trust this folder" is 2nd -> Down, then Enter.
        await sleep(o.trustDelay == null ? 150 : o.trustDelay);
        this.write('\x1b[B', 'trust-down');
        await sleep(o.trustGap == null ? 250 : o.trustGap);
        this.snap('trust-after-down');
        tl.trustAccepted = this.write('\r', 'trust-accept');
        this.mark('trust-accept-written');
        acceptedWrite = true;
      }
      if (tl.bannerAt == null && /Claude Code v\d/.test(text)) tl.bannerAt = this.mark('banner');
      const b = this.box();
      const f = this.footer();
      if (!trust && tl.boxAt == null && (b.kind === 'empty' || b.kind === 'typed')) tl.boxAt = this.mark('box-visible');
      if (!trust && tl.footerAt == null && f) tl.footerAt = this.mark('footer-visible', { footer: f.trim().slice(0, 90) });
      if (!trust && tl.boxAt != null && tl.footerAt != null) { tl.readyAt = this.t(); this.mark('ready'); break; }
      if (Date.now() > deadline) { this.mark('ready-timeout'); break; }
      await sleep(20);
    }
    return tl;
  }
}

// ---------- main ----------
process.on('uncaughtException', (e) => {
  const msg = 'UNCAUGHT ' + (e && e.code ? e.code + ' ' : '') + (e && e.message ? e.message : e);
  console.error(msg);
  for (const s of sessions) { try { s.mark('uncaught', { msg }); } catch (x) { /* ignore */ } }
});
const A = {
  ROOT, LOGS, sleep, BP_ON, BP_OFF, HOME, readBox, isRuler,
  dir: (n) => path.join(ROOT, n),
  start(o) {
    const s = new Session(A, { ...o });
    sessions.push(s);
    s._spawn();
    return s;
  },
  say: (...a) => console.log(...a),
  sh: (c) => cp.execSync(c, { encoding: 'utf8' }),
};

(async () => {
  const scen = process.argv[2];
  if (!scen) { console.error('usage: driver.js scen/<name>.js'); process.exit(2); }
  const hard = setTimeout(async () => { console.error('HARD TIMEOUT'); for (const s of sessions) await s.kill(); process.exit(3); }, (+process.env.MAX_S || 600) * 1000);
  try {
    await require(path.resolve(scen))(A);
  } catch (e) {
    console.error('SCENARIO ERROR', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    clearTimeout(hard);
    for (const s of sessions) await s.kill();
    process.exit();
  }
})();
