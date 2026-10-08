'use strict';
// Reference implementation of the recommended send protocol (validated by scen/q-protocol.js).
// All screen reading goes through the xterm buffer of the hidden PTY (alt-screen or inline layout).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BP_ON = '\x1b[200~';
const BP_OFF = '\x1b[201~';

// ---- text preparation ----
function sanitize(t) {
  return String(t)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, '') // C0 (keeps \t \n), ESC, DEL, C1 -> would corrupt/terminate the paste
    .replace(/^\n+|\s+$/g, ''); // leading blank lines / trailing whitespace
}
// What the CLI shows/records for small pastes: tab -> 4 spaces
const cliView = (t) => t.replace(/\t/g, '    ');
const COLLAPSE_LINES = 5;      // >= 5 lines (4 newlines) collapses to "[Pasted text #N +M lines]"
const COLLAPSE_CHARS = 800;    // single line: 500 chars stays literal, 1000 collapses to "[Pasted text #N]"
const willCollapse = (t) => (t.match(/\n/g) || []).length >= COLLAPSE_LINES - 1 || t.length > COLLAPSE_CHARS;

// ---- screen detectors ----
const D = {
  trust: (txt) => /Quick safety check/.test(txt) && /Enter to confirm/.test(txt),
  externalImports: (txt) => /disable external imports/.test(txt),
  rewind: (txt) => /Rewind/.test(txt) && /Esc to cancel/.test(txt),
  working: (footer) => /esc to interrupt/.test(footer),
  emptyFooter: (footer) => /\? for shortcuts/.test(footer),          // only when the input is really empty (placeholder or ghost suggestion)
  transcriptOff: (txt) => /Transcript saving is off/.test(txt),
  unknownCommand: (txt) => /Unknown command: \//.test(txt),
  exitArmed: (txt) => /Press Ctrl-C again to exit/.test(txt),
  queuedHint: (txt) => /Press up to edit queued messages/.test(txt),
  interrupted: (txt) => /Interrupted · What should Claude do instead\?/.test(txt),
};

function readState(s) {
  const txt = s.screenText();
  const lines = s.screenLines();
  const box = s.boxState();
  const footer = s.footer();
  const st = { footer: footer.trim(), working: D.working(footer) };
  if (D.trust(txt)) return { ...st, phase: 'dialog', dialog: 'trust' };
  if (D.externalImports(txt)) return { ...st, phase: 'dialog', dialog: 'external-imports' };
  if (box.kind === 'unreadable' || box.kind === 'menu') {
    const title = lines.filter((l) => /^\s*▔{6,}/.test(l)).length ? 'heavy-bar-dialog' : 'unknown-or-transition';
    return { ...st, phase: 'dialog', dialog: title, rewind: D.rewind(txt) };
  }
  // box present
  const aboveTop = lines.slice(Math.max(0, box.top - 12), box.top);
  const slashMenuOpen = aboveTop.some((l) => /^\s{2}❯\s+\/\S+/.test(l));
  return {
    ...st, phase: 'box', mark: box.mark, text: box.text || '', placeholder: !!box.placeholder, nLines: box.textLines ? box.textLines.length : 0,
    emptyByFooter: D.emptyFooter(footer), slashMenuOpen, shell: box.mark === '!',
    // really empty = no real (non-dim) text; in shell mode an empty text is still "mode armed" (not clean)
    empty: box.kind === 'empty' && box.mark === '❯',
  };
}

// ---- readiness gate (after spawn / resume) ----
async function waitReady(s, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (s.exited) return { ok: false, reason: 'exited' };
    const st = readState(s);
    if (st.phase === 'box' && st.footer) return { ok: true, ms: s.t(), st };
    if (st.phase === 'dialog' && (st.dialog === 'trust' || st.dialog === 'external-imports')) return { ok: false, reason: 'dialog:' + st.dialog };
    await sleep(20);
  }
  return { ok: false, reason: 'timeout' };
}

async function until(s, pred, timeout, step = 15) {
  const t0 = s.t();
  for (;;) {
    const st = readState(s);
    if (pred(st)) return { ok: true, ms: s.t() - t0, st };
    if (s.t() - t0 > timeout) return { ok: false, ms: s.t() - t0, st };
    await sleep(step);
  }
}

// ---- clear leftover REAL text (never on an empty box: Esc Esc there opens Rewind) ----
async function clearLeftover(s) {
  for (let i = 0; i < 2; i++) {
    const st = readState(s);
    if (st.phase !== 'box') return { ok: false, reason: 'dialog' };
    if (st.empty) return { ok: true };
    if (st.working) return { ok: false, reason: 'working' }; // Esc would interrupt the turn
    if (st.shell && !st.text) { s.write('\x1b'); await sleep(250); continue; } // leave shell mode: ONE Esc
    s.write('\x1b\x1b'); // double Esc in a single write: clears every shape tested (1-line, multi-line, wrapped, [Pasted text], [Image])
    await sleep(350);
  }
  const st = readState(s);
  return { ok: st.phase === 'box' && st.empty, reason: 'still-not-empty' };
}

// ---- send ----
async function send(s, raw, o = {}) {
  const r = { steps: [] };
  const log = (k, v) => r.steps.push({ t: s.t(), k, ...(v || {}) });
  const text = sanitize(raw);
  const expectShell = text.startsWith('!');
  if (!text) return { ok: false, reason: 'empty-message' };

  let st = readState(s);
  if (st.phase !== 'box') return { ok: false, reason: 'blocked-by-screen:' + st.dialog };
  if (!st.empty) {
    const c = await clearLeftover(s);
    log('clearLeftover', c);
    if (!c.ok) return { ok: false, reason: 'leftover:' + c.reason, ...r };
  }

  const expectBoxText = cliView(text);
  const collapsed = willCollapse(text);
  const nl = (text.match(/\n/g) || []).length;
  const pasteAt = s.paste(text, 'paste');
  const showTimeout = o.firstPaste ? 12000 : 3000 + Math.ceil(text.length / 15);
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  const shown = await until(s, (x) => {
    if (x.phase !== 'box') return false;
    if (expectShell) return x.shell && norm(x.text) === norm(expectBoxText.slice(1));
    if (collapsed) return /\[Pasted text #\d+( \+\d+ lines)?\]/.test(x.text);
    return norm(x.text) === norm(expectBoxText);
  }, showTimeout);
  log('pasteShown', { ok: shown.ok, ms: shown.ms });
  if (!shown.ok) return { ok: false, reason: 'paste-not-visible', ...r, last: shown.st && shown.st.text && shown.st.text.slice(0, 80) };
  if (collapsed) {
    const m = shown.st.text.match(/\+(\d+) lines/);
    if (m && nl >= COLLAPSE_LINES - 1 && +m[1] !== nl) return { ok: false, reason: 'collapsed-line-count-mismatch:' + m[1] + '!=' + nl, ...r };
  }
  if (expectShell !== shown.st.shell) return { ok: false, reason: 'mode-mismatch', ...r };

  // slash menu open -> Enter would run the highlighted suggestion instead of the literal text
  if (shown.st.slashMenuOpen) {
    s.write('\x1b'); await sleep(300);
    const x = readState(s);
    log('closeSlashMenu', { menuStillOpen: x.slashMenuOpen, textIntact: norm(x.text) === norm(expectBoxText) });
    if (x.phase !== 'box' || norm(x.text) !== norm(expectBoxText)) return { ok: false, reason: 'text-changed-after-esc', ...r };
  }

  await sleep(o.enterGapMs == null ? 80 : o.enterGapMs);
  const enterAt = s.write('\r', 'enter'); // ALWAYS its own write
  log('enter');

  // UI-level confirmation: box emptied (message echoed / command executed / dialog opened)
  let ui = await until(s, (x) => x.phase !== 'box' || (x.empty && x.mark === '❯') || x.working, 3000);
  if (!ui.ok) {
    // text still sitting in the box -> Enter swallowed. Safe to retry ONCE: nothing was submitted.
    const x = readState(s);
    if (x.phase === 'box' && norm(x.text) === norm(expectBoxText.slice(expectShell ? 1 : 0))) {
      s.write('\r', 'enter-retry'); log('enterRetry');
      ui = await until(s, (y) => y.phase !== 'box' || (y.empty && y.mark === '❯') || y.working, 3000);
    }
  }
  log('uiConfirm', { ok: ui.ok, ms: ui.ok ? s.t() - enterAt : null });
  r.enterAt = enterAt;
  r.ok = ui.ok;
  r.reason = ui.ok ? 'entered' : 'enter-not-accepted';
  return r;
}

module.exports = { sanitize, cliView, willCollapse, D, readState, waitReady, until, clearLeftover, send, BP_ON, BP_OFF };
