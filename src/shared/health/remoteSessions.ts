// Gargalos do ambiente (t-dda3571f) — what each Donel session on a remote place is REALLY doing, read from the place
// itself in the same ssh round as the health read (src/shared/health/remote.ts): the tmux pane (is the spinner on?
// is a permission prompt open?), the tail of the transcript (did the turn end? did the last call fail, and why?) and
// the weight of its process tree. Owner, 08/11: "Tenho a impressão que as 48 sessões nas VPSs não estão de fato
// trabalhando por conta" — the hooks that reach the app can be lost; the place cannot lie about its own files.
//
// Read-only on the place: `tmux ls`, `tmux capture-pane`, `/proc` and the tail of `~/.claude/projects/*/<sid>.jsonl`.
// Nothing secret leaves it: from `meta.json` only `name`, `openedBy` and `roleId` (never the tokens); from the
// settings only the host and port of `ANTHROPIC_BASE_URL` (never a key). Pure: no I/O here; the parser is tested.

export const SESSION_MARK = 'DONEL_HEALTH';

/** What the pane of the session shows right now. `unknown` = could not read it. */
export type PaneState = 'busy' | 'permission' | 'question' | 'login' | 'idle' | 'unknown';

/** The last thing of the conversation: a request waiting for the API, a tool running, a reply, or a failed call. */
export type LastEntryKind = 'request' | 'tool' | 'reply' | 'error';

export interface RemoteSessionReading {
  readonly sid: string;
  readonly name: string;
  /** Place of the session that opened this one (`sessao_abrir`); absent = the owner. */
  readonly openedBy?: string;
  readonly roleId?: string;
  /** Resident memory of the process tree of the pane. */
  readonly rssBytes: number;
  /** utime + stime of the tree, in clock ticks (`clkTck` per second); the CPU % comes from two reads. */
  readonly cpuTicks: number;
  readonly clkTck: number;
  readonly pane: PaneState;
  /** Epoch ms of tmux's last activity on the session (any output). */
  readonly paneActivityAt: number | null;
  /** The transcript was found. Without it, the rest of the transcript fields are `null`. */
  readonly transcript: boolean;
  /** Epoch ms of the last entry of the conversation (or the file's mtime when no entry had a time). */
  readonly lastAt: number | null;
  /** `ended` = the CLI closed the turn (`turn_duration`); `open` = a turn is running or was cut. */
  readonly turn: 'open' | 'ended' | null;
  readonly last: LastEntryKind | null;
  /** The tool of the last `tool_use`, when `last` is `tool`. */
  readonly tool: string | null;
  /** The last call failed and nothing answered after it. */
  readonly apiError: { readonly kind: string; readonly text: string; readonly at: number | null } | null;
  /** The CLI is retrying a call that failed (`system/api_error`) and nothing answered after it. */
  readonly retry: { readonly text: string; readonly attempt: number | null; readonly at: number | null } | null;
  /**
   * Work under the CLI after its turn: processes it started after its own boot (a background command, a build in the
   * verify queue, a `claude -p`, a `sleep`; the MCP servers it starts at boot are left out), and background tasks it
   * launched whose end the conversation has not recorded yet.
   */
  readonly background: { readonly procs: number; readonly names: readonly string[]; readonly pendingTasks: number };
}

/** Host and port of the gateway the place's CLI talks to (`ANTHROPIC_BASE_URL`); `null` = straight to the API. */
export interface RemoteGateway {
  readonly host: string;
  readonly port: number | null;
}

/**
 * The program, run by `python3 -` on the place. Prints `DONEL_HEALTH now <ms>`, `DONEL_HEALTH gateway {…}` and one
 * `DONEL_HEALTH sess {…}` per `donel-*` tmux session. Any failure prints nothing for that session (never a guess).
 */
export const REMOTE_SESSIONS_PY = String.raw`
import os, sys, json, glob, re, subprocess, time
from datetime import datetime
M = 'DONEL_HEALTH'
H = os.path.expanduser('~')
TAIL = 384 * 1024
def out(key, value):
    sys.stdout.write(M + ' ' + key + ' ' + json.dumps(value, separators=(',', ':'), ensure_ascii=True) + '\n')
def ms(ts):
    try:
        return int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return None
out('now', int(time.time() * 1000))
try:
    url = (json.load(open(H + '/.claude/settings.json')).get('env') or {}).get('ANTHROPIC_BASE_URL') or os.environ.get('ANTHROPIC_BASE_URL')
    if url:
        from urllib.parse import urlsplit
        parts = urlsplit(url)
        if parts.hostname:
            out('gateway', {'host': parts.hostname, 'port': parts.port})
except Exception:
    pass
kids, stat, born, comm = {}, {}, {}, {}
try:
    page = os.sysconf('SC_PAGE_SIZE')
    clk = os.sysconf('SC_CLK_TCK')
except Exception:
    page, clk = 4096, 100
for entry in os.listdir('/proc'):
    if not entry.isdigit():
        continue
    try:
        raw = open('/proc/' + entry + '/stat').read()
        rest = raw[raw.rindex(')') + 2:].split()
        stat[int(entry)] = (int(rest[11]) + int(rest[12]), int(rest[21]) * page)
        born[int(entry)] = int(rest[19])
        comm[int(entry)] = raw[raw.index('(') + 1:raw.rindex(')')]
        kids.setdefault(int(rest[1]), []).append(int(entry))
    except Exception:
        pass
def tree(pid):
    ticks, rss, todo, seen = 0, 0, [pid], set()
    while todo:
        p = todo.pop()
        if p in seen:
            continue
        seen.add(p)
        if p in stat:
            ticks += stat[p][0]
            rss += stat[p][1]
        todo.extend(kids.get(p, []))
    return ticks, rss
BOOT_GRACE = 120
try:
    BTIME = int([line.split()[1] for line in open('/proc/stat') if line.startswith('btime ')][0])
except Exception:
    BTIME = None
def started_ms(pid):
    # When the process was born (epoch ms); None when unknown.
    if BTIME is None or pid not in born:
        return None
    return int((BTIME + born[pid] / clk) * 1000)
def background(pid):
    # Descendants the CLI started after its own boot: a background command, a build waiting on the verify queue, a
    # claude -p, a sleep. What it starts at boot (MCP servers, its helpers) is left out by the grace.
    if pid not in born:
        return 0, []
    limit = born[pid] + BOOT_GRACE * clk
    found, todo, seen = [], list(kids.get(pid, [])), set()
    while todo:
        p = todo.pop()
        if p in seen:
            continue
        seen.add(p)
        todo.extend(kids.get(p, []))
        if born.get(p, 0) > limit:
            found.append(p)
    names = []
    for p in sorted(found, key=lambda q: born.get(q, 0)):
        name = comm.get(p, '')
        if name and name not in names:
            names.append(name)
    return len(found), names[:3]
# Only the CLI's own answer to a launch, at the START of a tool result (a result that merely quotes it does not count).
TASK_STARTED = re.compile(r'^\s*(?:Command running in background with ID|Workflow launched in background\. Task ID|Async agent launched successfully\.[\s\S]*?agentId): ([A-Za-z0-9_-]{5,})')
TASK_ENDED = re.compile(r'<task-id>([A-Za-z0-9_-]+)</task-id>')
def pane_state(name):
    try:
        text = subprocess.run(['tmux', '-L', 'donel', 'capture-pane', '-p', '-t', name], capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return 'unknown'
    lines = [line for line in text.splitlines() if line.strip()][-25:]
    tail = '\n'.join(lines)
    if not tail:
        return 'unknown'
    if re.search(r'…\s*\(\d|esc to interrupt', tail):
        return 'busy'
    if re.search(r'Do you want to|Would you like to proceed|❯\s*1\.\s*Yes', tail):
        return 'permission'
    if re.search(r'Enter to select|Type something', tail):
        return 'question'
    if re.search(r'Please run /login|Invalid API key|OAuth token has expired|Not logged in', tail, re.I):
        return 'login'
    return 'idle' if '❯' in tail or '>' in tail else 'unknown'
def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get('type') == 'text':
                return str(part.get('text') or '')
    return ''
def read_transcript(sid, alive_since):
    files = glob.glob(H + '/.claude/projects/*/' + sid + '.jsonl')
    if not files:
        return {'transcript': False, 'lastAt': None, 'turn': None, 'last': None, 'tool': None, 'apiError': None, 'retry': None, 'pendingTasks': 0}
    path = max(files, key=os.path.getmtime)
    size = os.path.getsize(path)
    with open(path, 'rb') as handle:
        handle.seek(max(0, size - TAIL))
        chunk = handle.read().decode('utf-8', 'ignore').split('\n')
    if size > TAIL:
        chunk = chunk[1:]
    d = {'transcript': True, 'lastAt': None, 'turn': None, 'last': None, 'tool': None, 'apiError': None, 'retry': None}
    started, ended = [], set()
    for line in chunk:
        line = line.strip()
        if not line:
            continue
        if '<task-id>' in line and '<status>' in line:
            ended.update(TASK_ENDED.findall(line))
        try:
            j = json.loads(line)
        except Exception:
            continue
        kind = j.get('type')
        if kind not in ('user', 'assistant', 'system'):
            continue
        at = ms(j.get('timestamp') or '')
        if kind == 'user':
            if j.get('isMeta'):
                continue
            content = (j.get('message') or {}).get('content')
            for part in content if isinstance(content, list) else []:
                if isinstance(part, dict) and part.get('type') == 'tool_result':
                    match = TASK_STARTED.match(text_of(part.get('content')))
                    # A task launched before this CLI process was born died with the previous one (app restart).
                    if match and (alive_since is None or at is None or at >= alive_since):
                        started.append(match.group(1))
            d.update(turn='open', last='request', tool=None, apiError=None, retry=None)
        elif kind == 'assistant':
            message = j.get('message') or {}
            if j.get('isApiErrorMessage'):
                d.update(last='error', tool=None, retry=None, apiError={'kind': str(j.get('error') or ''), 'text': text_of(message.get('content'))[:200], 'at': at})
            else:
                content = message.get('content') if isinstance(message.get('content'), list) else []
                tools = [part for part in content if isinstance(part, dict) and part.get('type') == 'tool_use']
                d.update(last='tool' if tools else 'reply', tool=str(tools[-1].get('name') or '') if tools else None, apiError=None, retry=None)
        else:
            subtype = j.get('subtype')
            if subtype == 'turn_duration':
                d['turn'] = 'ended'
            elif subtype == 'api_error':
                err = j.get('error') if isinstance(j.get('error'), dict) else {}
                attempt = j.get('retryAttempt')
                d['retry'] = {'text': str(err.get('message') or '')[:200], 'attempt': attempt if isinstance(attempt, int) else None, 'at': at}
            else:
                continue
        if at is not None:
            d['lastAt'] = at
    if d['lastAt'] is None:
        d['lastAt'] = int(os.path.getmtime(path) * 1000)
    d['pendingTasks'] = len(set(started) - ended)
    return d
try:
    listing = subprocess.run(['tmux', '-L', 'donel', 'ls', '-F', '#S\t#{pane_pid}\t#{session_activity}'], capture_output=True, text=True, timeout=3).stdout
except Exception:
    listing = ''
for row in listing.splitlines():
    cols = row.split('\t')
    if len(cols) < 3 or not cols[0].startswith('donel-'):
        continue
    try:
        name, sid = cols[0], cols[0][6:]
        meta = {}
        try:
            meta = json.load(open(H + '/.donel/s/' + sid + '/meta.json'))
        except Exception:
            pass
        ticks, rss = tree(int(cols[1])) if cols[1].isdigit() else (0, 0)
        bg_count, bg_names = background(int(cols[1])) if cols[1].isdigit() else (0, [])
        record = {'sid': sid, 'name': str(meta.get('name') or ''), 'rss': rss, 'ticks': ticks, 'clk': clk, 'pane': pane_state(name),
                  'activity': int(cols[2]) * 1000 if cols[2].isdigit() else None, 'bgProcs': bg_count, 'bgNames': bg_names}
        if isinstance(meta.get('openedBy'), str):
            record['openedBy'] = meta['openedBy']
        if isinstance(meta.get('roleId'), str):
            record['roleId'] = meta['roleId']
        record.update(read_transcript(sid, started_ms(int(cols[1])) if cols[1].isdigit() else None))
        out('sess', record)
    except Exception:
        pass
`;

/** The bash lines of the remote health script that run the program (skipped, silently, without `python3`). */
export function remoteSessionsScriptLines(): string[] {
  return [`if command -v python3 >/dev/null 2>&1; then timeout 10 python3 - <<'DONEL_PY'`, REMOTE_SESSIONS_PY.trim(), 'DONEL_PY', 'fi'];
}

const PANE_STATES: readonly PaneState[] = ['busy', 'permission', 'question', 'login', 'idle', 'unknown'];
const LAST_KINDS: readonly LastEntryKind[] = ['request', 'tool', 'reply', 'error'];

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** One `sess` line → a reading; `null` when it is not one (bad JSON, no sid). */
export function parseSessionLine(json: string): RemoteSessionReading | null {
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const sid = str(raw.sid, 64);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(sid)) return null;
  const transcript = raw.transcript === true;
  const apiErrorRaw = raw.apiError as Record<string, unknown> | null | undefined;
  const retryRaw = raw.retry as Record<string, unknown> | null | undefined;
  return {
    sid,
    name: str(raw.name),
    ...(typeof raw.openedBy === 'string' && raw.openedBy !== '' ? { openedBy: str(raw.openedBy, 120) } : {}),
    ...(typeof raw.roleId === 'string' && raw.roleId !== '' ? { roleId: str(raw.roleId, 120) } : {}),
    rssBytes: Math.max(0, finite(raw.rss) ?? 0),
    cpuTicks: Math.max(0, finite(raw.ticks) ?? 0),
    clkTck: Math.max(1, finite(raw.clk) ?? 100),
    pane: PANE_STATES.includes(raw.pane as PaneState) ? (raw.pane as PaneState) : 'unknown',
    paneActivityAt: finite(raw.activity),
    transcript,
    lastAt: transcript ? finite(raw.lastAt) : null,
    turn: transcript && (raw.turn === 'open' || raw.turn === 'ended') ? raw.turn : null,
    last: transcript && LAST_KINDS.includes(raw.last as LastEntryKind) ? (raw.last as LastEntryKind) : null,
    tool: transcript && typeof raw.tool === 'string' ? str(raw.tool, 80) : null,
    apiError:
      transcript && apiErrorRaw && typeof apiErrorRaw === 'object'
        ? { kind: str(apiErrorRaw.kind, 60), text: str(apiErrorRaw.text), at: finite(apiErrorRaw.at) }
        : null,
    retry:
      transcript && retryRaw && typeof retryRaw === 'object'
        ? { text: str(retryRaw.text), attempt: finite(retryRaw.attempt), at: finite(retryRaw.at) }
        : null,
    background: {
      procs: Math.max(0, Math.floor(finite(raw.bgProcs) ?? 0)),
      names: Array.isArray(raw.bgNames) ? raw.bgNames.filter((name): name is string => typeof name === 'string').map((name) => name.slice(0, 40)).slice(0, 3) : [],
      pendingTasks: transcript ? Math.max(0, Math.floor(finite(raw.pendingTasks) ?? 0)) : 0,
    },
  };
}

/** The `gateway` line → host and port; `null` when it is not one. */
export function parseGatewayLine(json: string): RemoteGateway | null {
  try {
    const raw = JSON.parse(json) as { host?: unknown; port?: unknown };
    if (typeof raw.host !== 'string' || raw.host === '') return null;
    return { host: raw.host.slice(0, 120), port: finite(raw.port) };
  } catch {
    return null;
  }
}
