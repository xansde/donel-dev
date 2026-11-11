// Proxy da vez (specs/018-proxy-da-vez) — the program that runs ON a machine (this computer through the app's own
// node, a remote place through `ssh … node -`) to read, import or switch the proxy its sessions use. Same rules as
// `accounts/remote-claude-state.ts` (ADR 0005, ADR 0008):
//
// - The key only travels inside the program text (stdin of the node/ssh) and, on `export-key`, in the one JSON line
//   the program prints. Never in argv, never in a log, never in an error message.
// - Only `env.ANTHROPIC_BASE_URL`, `env.NO_PROXY`/`no_proxy` (the proxy host is added when the list exists),
//   `env.ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` (removed, as the rollout scripts do) and `apiKeyHelper` change;
//   every other key of `settings.json` stays as it was. Atomic write, original mode kept.
// - Switch = check, write, check again: the machine itself calls `GET /v1/models` with the key through its own
//   outbound proxy before writing (nothing changes without a 200), and again through the `apiKeyHelper` just written;
//   if that second call fails, the previous `settings.json` comes back (`rolled-back`).
// - Sessions already running are not touched: the CLI reads `settings.json` when it starts.

export const PROXY_KEY_PATTERN = /^[\x21-\x7e]{8,512}$/;

export type MachineProgramInput =
  | { readonly op: 'read'; readonly claudeDir: string | null }
  | { readonly op: 'export-key'; readonly claudeDir: string | null; readonly expectBaseUrl: string }
  | {
      readonly op: 'switch';
      readonly claudeDir: string | null;
      readonly proxyId: string;
      readonly baseUrl: string;
      readonly key: string;
      readonly userAgent: string;
      readonly timeoutSec: number;
    };

/**
 * The program text. `input` goes in as a JSON literal (valid JS, nothing from the network is evaluated). Output: ONE
 * JSON line on stdout. Exported so the test runs the same text against a temporary HOME.
 */
export function buildMachineProgram(input: MachineProgramInput): string {
  return `'use strict';
const INPUT = ${JSON.stringify(input)};
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const home = os.homedir();
const claudeDir = INPUT.claudeDir || path.join(home, '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const proxyDir = path.join(home, '.donel', 'proxy');
const KEY_RE = ${PROXY_KEY_PATTERN.toString()};
function readSettings() {
  let text = null;
  try { text = fs.readFileSync(settingsPath, 'utf8'); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
  if (text === null) return { text: null, obj: {} };
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('settings');
  return { text, obj: parsed };
}
function envOf(obj) { return obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env) ? obj.env : {}; }
function norm(u) { return typeof u === 'string' && u.trim() ? u.trim().replace(/\\/+$/, '') : null; }
function writeAtomic(p, text, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-donel-' + process.pid + '-' + Date.now();
  const fd = fs.openSync(tmp, 'w', mode);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.chmodSync(tmp, mode); } catch {}
  try { fs.renameSync(tmp, p); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
}
function fileMode(p, fallback) { try { return fs.statSync(p).mode & 0o777; } catch { return fallback; }
}
function keyPath(id) { return path.join(proxyDir, id + '.key'); }
function helperFor(p) { return process.platform === 'win32' ? 'type "' + p + '"' : "cat '" + p.replace(/'/g, "'\\\\''") + "'"; }
function donelProxyOf(helper) {
  if (typeof helper !== 'string') return null;
  const m = helper.replace(/\\\\/g, '/').match(/\\.donel\\/proxy\\/([a-z0-9][a-z0-9-]{0,31})\\.key/);
  return m ? m[1] : null;
}
function runHelper(helper) {
  if (typeof helper !== 'string' || !helper.trim()) return null;
  try {
    const out = cp.execSync(helper, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const key = String(out).trim();
    return KEY_RE.test(key) ? key : null;
  } catch { return null; }
}
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'];
function check(baseUrl, key, env) {
  const childEnv = Object.assign({}, process.env);
  for (const k of PROXY_VARS) if (typeof env[k] === 'string') childEnv[k] = env[k];
  const headers = 'x-api-key: ' + key + '\\nauthorization: Bearer ' + key + '\\nanthropic-version: 2023-06-01\\nuser-agent: ' + INPUT.userAgent + '\\n';
  const r = cp.spawnSync('curl', ['-sS', '-m', String(INPUT.timeoutSec), '-o', os.devNull, '-w', '%{http_code}', '-H', '@-', baseUrl + '/v1/models'], {
    input: headers, encoding: 'utf8', env: childEnv, windowsHide: true, timeout: (INPUT.timeoutSec + 5) * 1000,
  });
  const code = parseInt(String(r.stdout || '').trim(), 10);
  return Number.isFinite(code) && code > 0 ? code : null;
}
function addHost(list, host) {
  const parts = list.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.includes(host) ? list : parts.concat([host]).join(',');
}
let out;
try {
  if (INPUT.op === 'read') {
    const s = readSettings();
    out = { kind: 'ok', baseUrl: norm(envOf(s.obj).ANTHROPIC_BASE_URL), donelProxyId: donelProxyOf(s.obj.apiKeyHelper) };
  } else if (INPUT.op === 'export-key') {
    const s = readSettings();
    if (norm(envOf(s.obj).ANTHROPIC_BASE_URL) !== INPUT.expectBaseUrl) out = { kind: 'not-found' };
    else {
      const key = runHelper(s.obj.apiKeyHelper);
      out = key ? { kind: 'ok', key } : { kind: 'not-found' };
    }
  } else if (INPUT.op === 'switch') {
    if (!KEY_RE.test(INPUT.key) || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(INPUT.proxyId)) throw new Error('input');
    const s = readSettings();
    const before = norm(envOf(s.obj).ANTHROPIC_BASE_URL);
    const next = JSON.parse(JSON.stringify(s.obj));
    const env = Object.assign({}, envOf(next));
    env.ANTHROPIC_BASE_URL = INPUT.baseUrl;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    const host = new URL(INPUT.baseUrl).hostname;
    for (const k of ['NO_PROXY', 'no_proxy']) if (typeof env[k] === 'string') env[k] = addHost(env[k], host);
    next.env = env;
    const pre = check(INPUT.baseUrl, INPUT.key, env);
    if (pre !== 200) out = { kind: 'precheck-failed', httpStatus: pre };
    else {
      const kp = keyPath(INPUT.proxyId);
      writeAtomic(kp, INPUT.key, 0o600);
      next.apiKeyHelper = helperFor(kp);
      if (s.text !== null) writeAtomic(path.join(proxyDir, 'settings-antes.json'), s.text, 0o600);
      const mode = fileMode(settingsPath, 0o600);
      writeAtomic(settingsPath, JSON.stringify(next, null, 2) + '\\n', mode);
      const written = readSettings();
      const helperKey = runHelper(written.obj.apiKeyHelper);
      const post = helperKey ? check(norm(envOf(written.obj).ANTHROPIC_BASE_URL), helperKey, envOf(written.obj)) : null;
      if (post === 200) out = { kind: 'switched', from: before };
      else {
        if (s.text === null) { try { fs.unlinkSync(settingsPath); } catch {} }
        else writeAtomic(settingsPath, s.text, mode);
        out = { kind: 'rolled-back', httpStatus: post };
      }
    }
  } else {
    out = { kind: 'io' };
  }
} catch (error) {
  out = { kind: 'io' };
}
process.stdout.write(JSON.stringify(out) + '\\n');
`;
}

export type MachineReadResult =
  | { readonly kind: 'ok'; readonly baseUrl: string | null; readonly donelProxyId: string | null }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'io' };

export type MachineExportResult = { readonly kind: 'ok'; readonly key: string } | { readonly kind: 'not-found' } | { readonly kind: 'unreachable' } | { readonly kind: 'io' };

export type MachineSwitchResult =
  | { readonly kind: 'switched'; readonly from: string | null }
  | { readonly kind: 'precheck-failed'; readonly httpStatus: number | null }
  | { readonly kind: 'rolled-back'; readonly httpStatus: number | null }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'io' };

function parseLastJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split(/\r?\n/);
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const httpStatusOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** Pure — the program's answer to a read. `stdout: null` = the runner could not reach the machine. */
export function parseReadOutput(stdout: string | null): MachineReadResult {
  if (stdout === null) return { kind: 'unreachable' };
  const out = parseLastJsonLine(stdout);
  if (out?.kind !== 'ok') return { kind: 'io' };
  return { kind: 'ok', baseUrl: stringOrNull(out.baseUrl), donelProxyId: stringOrNull(out.donelProxyId) };
}

export function parseExportOutput(stdout: string | null): MachineExportResult {
  if (stdout === null) return { kind: 'unreachable' };
  const out = parseLastJsonLine(stdout);
  if (out?.kind === 'ok' && typeof out.key === 'string' && PROXY_KEY_PATTERN.test(out.key)) return { kind: 'ok', key: out.key };
  if (out?.kind === 'not-found') return { kind: 'not-found' };
  return { kind: 'io' };
}

export function parseSwitchOutput(stdout: string | null): MachineSwitchResult {
  if (stdout === null) return { kind: 'unreachable' };
  const out = parseLastJsonLine(stdout);
  if (out?.kind === 'switched') return { kind: 'switched', from: stringOrNull(out.from) };
  if (out?.kind === 'precheck-failed') return { kind: 'precheck-failed', httpStatus: httpStatusOf(out.httpStatus) };
  if (out?.kind === 'rolled-back') return { kind: 'rolled-back', httpStatus: httpStatusOf(out.httpStatus) };
  return { kind: 'io' };
}
