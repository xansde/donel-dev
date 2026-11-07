#!/usr/bin/env node
// MCP guard — PreToolUse hook that blocks MCP tool calls by CAPABILITY (what the
// call does), not by a list of names, plus a sealed inventory of the MCP tools
// this machine trusts.
//
//   node mcp-guard.mjs hook    PreToolUse (matcher "mcp__.*|Bash|Write|Edit|MultiEdit|NotebookEdit")
//   node mcp-guard.mjs check   SessionStart: relists the MCP servers, marks tools whose description changed
//   node mcp-guard.mjs seal    a PERSON at a terminal seals what the servers expose today
//
// Rules of the hook, in order:
//   1. an MCP tool that is not in the sealed inventory (new or renamed server, new tool) is blocked;
//   2. a sealed tool whose description changed since the seal (seen by `check`) is blocked;
//   3. a call is blocked when it would: write to production, send a message in the owner's name,
//      delete, push/merge into main, or make a repository public. The capability comes from the tool
//      name, its sealed description and the call's input (Composio slugs included), never from a list
//      of server names.
// Exit 0 always; a block is the JSON `permissionDecision: "deny"` on stdout.
// Zero dependencies: runs with the Node that already exists on the PC and on the VPSs.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

// ---------- policy ----------

export const DEFAULT_POLICY = {
  /** Targets that are NOT production: a write there is allowed (Supabase staging shared by the squad). */
  nonProdTargets: ['fxjpnamoafzomqlncdyn'],
  /** Sending in the owner's name is allowed only on these channels and servers, where the Donel letter gate (carta_slack) decides. */
  letterGated: { slack: ['composio'] },
  /** Servers that talk as the agent's own bot, never as the owner. */
  agentBotServers: ['theo-slack', 'theo-west-slack'],
  /** Extra MCP configs to relist at SessionStart; {session_id} comes from the hook input. */
  sessionMcpConfigs: ['~/.donel/s/{session_id}/mcp.json'],
  /** Explicit capabilities for a tool, when the inference is wrong ("mcp__s__t": ["delete"] or []). */
  capOverrides: {},
  checkTtlMinutes: 10,
  serverTimeoutMs: 8000,
};

export function guardDir() {
  return process.env.MCP_GUARD_DIR ? resolve(process.env.MCP_GUARD_DIR) : join(homedir(), '.claude', 'mcp-guard');
}
const defaultGuardDir = () => join(homedir(), '.claude', 'mcp-guard');
const paths = () => ({ inventory: join(guardDir(), 'inventory.json'), drift: join(guardDir(), 'drift.json'), policy: join(guardDir(), 'policy.json') });

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJsonAtomic(file, value) {
  mkdirSync(guardDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}
function loadPolicy() {
  const local = readJson(paths().policy, {});
  return { ...DEFAULT_POLICY, ...local, letterGated: { ...DEFAULT_POLICY.letterGated, ...(local.letterGated || {}) } };
}

// ---------- names, hashes, tokens ----------

/** Same normalization Claude Code applies to server and tool names in `mcp__<server>__<tool>`. */
export const normalizeName = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
export const toolKey = (server, tool) => `mcp__${normalizeName(server)}__${normalizeName(tool)}`;
export const sealHash = (key, description) => createHash('sha256').update(`${key}\n${description ?? ''}`).digest('hex');

export function splitToolName(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
  const rest = name.slice(5);
  const i = rest.indexOf('__');
  return i < 0 ? { server: rest, tool: '' } : { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

export function tokens(text) {
  return String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9áàâãéêíóôõúç]+/)
    .filter(Boolean);
}

const set = (words) => new Set(words.split(/\s+/));
const DELETE_WORDS = set('delete deletes deleting remove removes drop drops truncate destroy destroys purge wipe erase rm unlink apagar apaga excluir exclui deletar deleta remover remove');
const SEND_WORDS = set('send sends post posts reply respond publish publishes broadcast forward forwards schedule enviar envia mandar manda postar posta publicar publica responder responde encaminhar agendar');
const MESSAGE_WORDS = set('message messages msg email emails mail dm dms chat mensagem mensagens sms');
const READ_WORDS = set('get list fetch search read find lookup describe show view count retrieve ler listar buscar ver');
const INTERNAL_WORDS = set('sessão sessao sessões sessoes session sessions agent agents agente agentes subagent subagente');
const CHANNEL_WORDS = set('slack gmail email mail outlook whatsapp telegram teams discord sms twilio linkedin twitter');
const GIT_WRITE_WORDS = set('push commit commits merge merges rebase');
const PROD_OP_WORDS = set('deploy deploys pause restore rollback promote migration migrations migrate');
const SQL_WORDS = set('sql migration migrations migrate');
const GIT_CONTEXT_WORDS = set('github gitlab git bitbucket repository repositories repo repos commit branch');
const REPO_WORDS = set('repo repos repository repositories visibility');
const CODE_WORDS = set('workbench code exec execute run bash python script shell');
const BRANCH_KEYS = set('branch ref base base_branch target_branch targetBranch baseBranch branch_name branchName');
const TARGET_KEYS = set('project_id projectId project_ref projectRef project database db');
const SQL_KEYS = set('query sql statement statements');
const MAIN_RE = /^(refs\/heads\/)?(main|master)$/i;
const SQL_WRITE_RE = /\b(insert|update|delete|merge|upsert|alter|create|grant|revoke|copy|call|vacuum|reindex|cluster|refresh)\b/i;
const SQL_DESTROY_RE = /\b(drop|truncate)\b/i;
const SLUG_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/g;

const has = (toks, words) => toks.some((t) => words.has(t));

// ---------- capability inference ----------

/** Capabilities a tool has by its name and sealed description alone (stored in the inventory at seal time). */
export function staticCaps(server, tool, description = '') {
  const nameToks = tokens(tool);
  const descToks = tokens(description);
  const all = [...nameToks, ...tokens(server), ...descToks];
  // A name that starts with a read verb (get_thread_replies, SLACK_FETCH_...) only reads.
  const readsOnly = READ_WORDS.has(nameToks[0]) || READ_WORDS.has(nameToks[1]);
  const leads = (words) => !readsOnly && (has(nameToks, words) || (descToks.length > 0 && words.has(descToks[0])));
  const caps = new Set();
  if (leads(DELETE_WORDS)) caps.add('delete');
  // A message to another session or agent is internal; one to a person's channel is in the owner's name.
  if (leads(SEND_WORDS) && (has(all, CHANNEL_WORDS) || (has(all, MESSAGE_WORDS) && !has(all, INTERNAL_WORDS)))) caps.add('send-as-owner');
  const writesFile = nameToks.includes('file') && (nameToks.includes('update') || nameToks.includes('create'));
  if ((has(nameToks, GIT_WRITE_WORDS) || writesFile) && has(all, GIT_CONTEXT_WORDS)) caps.add('git-write');
  if (has(nameToks, SQL_WORDS) || descToks.includes('sql')) caps.add('sql');
  if (has(nameToks, PROD_OP_WORDS)) caps.add('prod-op');
  if (has(nameToks, REPO_WORDS)) caps.add('repo');
  if (has(nameToks, CODE_WORDS)) caps.add('code');
  return [...caps].sort();
}

function walk(value, visit, key = '') {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit, key));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    visit(k, v);
    walk(v, visit, k);
  }
}

/** Nested tool calls inside an input (Composio: { tool_slug, arguments }), plus slugs named in free code. */
function nestedCalls(input, freeText) {
  const calls = [];
  const visitNode = (node) => {
    if (Array.isArray(node)) return node.forEach(visitNode);
    if (!node || typeof node !== 'object') return;
    const slug = node.tool_slug ?? node.toolSlug ?? node.slug ?? node.action ?? node.action_name;
    if (typeof slug === 'string') {
      const args = node.arguments ?? node.args ?? node.params ?? node.input;
      calls.push({ slug, input: args && typeof args === 'object' ? args : {} });
    }
    Object.values(node).forEach(visitNode);
  };
  visitNode(input);
  if (freeText) walk(input, (_k, v) => {
    if (typeof v === 'string') for (const m of v.match(SLUG_RE) || []) calls.push({ slug: m, input: {} });
  });
  return calls;
}

function targetIsNonProd(input, policy) {
  let nonProd = false;
  walk(input, (k, v) => {
    if (TARGET_KEYS.has(k) && typeof v === 'string' && policy.nonProdTargets.includes(v)) nonProd = true;
  });
  return nonProd;
}

function sqlClass(input) {
  let text = null;
  walk(input, (k, v) => {
    if (SQL_KEYS.has(k) && typeof v === 'string') text = `${text ?? ''}\n${v}`;
  });
  if (text === null) return 'write';
  const noStrings = text.replace(/'(?:[^']|'')*'/g, "''");
  if (SQL_DESTROY_RE.test(noStrings)) return 'destroy';
  if (SQL_WRITE_RE.test(noStrings)) return 'write';
  return 'read';
}

function branchTargets(input) {
  const found = [];
  walk(input, (k, v) => {
    if (BRANCH_KEYS.has(k) && typeof v === 'string') found.push(v);
  });
  return found;
}

function makesPublic(input) {
  let pub = false;
  walk(input, (k, v) => {
    const key = k.toLowerCase();
    if ((key === 'private' || key === 'is_private' || key === 'isprivate') && (v === false || v === 'false')) pub = true;
    if ((key === 'visibility' || key === 'repo_visibility') && typeof v === 'string' && v.toLowerCase() === 'public') pub = true;
    if ((key === 'public' || key === 'is_public') && (v === true || v === 'true')) pub = true;
  });
  return pub;
}

/**
 * Violations of one call: [{ cap, why }]. `caps` are the sealed static caps of the tool;
 * nested calls (Composio slugs) are judged as if they were tools of the same server.
 */
export function violations(server, tool, input, caps, policy, depth = 0) {
  const out = [];
  const add = (cap, why) => out.push({ cap, why });
  const c = new Set(caps);
  const isBot = policy.agentBotServers.includes(server);
  const nameToks = tokens(tool);
  const channel = has(nameToks, new Set(['slack'])) || tokens(server).includes('slack') ? 'slack' : 'other';
  const nonProd = targetIsNonProd(input, policy);

  if (c.has('send-as-owner') && !isBot) {
    const gated = policy.letterGated[channel] || [];
    if (!gated.includes(server)) add('send-as-owner', channel === 'slack' ? 'mensagem ao Slack em nome do dono fora do caminho com carta (Composio)' : 'mensagem em nome do dono (e-mail, chat ou outro canal sem carta)');
  }
  if (c.has('delete')) add('delete', 'apaga dado, arquivo, branch ou repositório');
  if (c.has('sql')) {
    const k = sqlClass(input);
    if (k === 'destroy' && !nonProd) add('delete', 'SQL com DROP/TRUNCATE fora do staging');
    else if (k !== 'read' && !nonProd) add('prod-write', 'SQL que grava num banco que não é o staging');
  }
  if (c.has('prod-op') && !nonProd) add('prod-write', 'deploy, migração ou operação num projeto que não é o staging');
  if (c.has('git-write')) {
    if (has(nameToks, new Set(['merge', 'merges']))) add('push-main', 'merge por MCP (a base não aparece na chamada; use gh pr merge, que a trava do Bash confere)');
    else {
      const branches = branchTargets(input);
      if (branches.length === 0) add('push-main', 'escrita no repositório sem branch: cai na branch padrão (main)');
      else if (branches.some((b) => MAIN_RE.test(b))) add('push-main', 'escrita direto em main/master');
    }
  }
  if ((c.has('repo') || has(nameToks, REPO_WORDS)) && makesPublic(input)) add('repo-visibility', 'torna repositório público');

  if (depth === 0) {
    for (const n of nestedCalls(input, c.has('code'))) {
      out.push(...violations(server, n.slug, n.input, staticCaps(server, n.slug, ''), policy, 1));
    }
  }
  const seen = new Set();
  return out.filter((v) => (seen.has(v.cap + v.why) ? false : seen.add(v.cap + v.why)));
}

// ---------- hook ----------

const LIBERA = 'O Alexandre libera com pedido literal; com ele, peça que ele faça a ação à mão. Não tente outro caminho.';
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Bloqueado pela trava de MCP (~/.claude/hooks/mcp-guard.mjs): ${reason}` } });

function isInside(file, dir) {
  const norm = (p) => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const f = process.platform === 'win32' ? norm(file).toLowerCase() : norm(file);
  const d = process.platform === 'win32' ? norm(dir).toLowerCase() : norm(dir);
  return f === d || f.startsWith(d + '/');
}

/** Pure decision for one hook payload: null = allow, otherwise the deny output. */
export function decide(payload, state) {
  const name = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  if (typeof name !== 'string') return deny('chamada sem nome de ferramenta.');

  if (name === 'Bash') {
    const cmd = String(input.command ?? '');
    if (/mcp-guard/i.test(cmd) && (/\bseal\b/i.test(cmd) || /(>|\btee\b|\brm\b|\bmv\b|\bcp\b|\bsed\s+-i|\bchmod\b|\bln\b|\btruncate\b|writeFile|unlink)/.test(cmd))) {
      return deny('selar ou mexer no inventário de MCP é ato do dono, num terminal dele. Peça ao Alexandre.');
    }
    return null;
  }
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    const file = input.file_path ?? input.notebook_path;
    if (typeof file === 'string' && (isInside(file, guardDir()) || isInside(file, SELF))) return deny('o inventário e a própria trava de MCP só mudam pela mão do dono.');
    return null;
  }
  const parts = splitToolName(name);
  if (!parts) return null;

  const { inventory, drift, policy } = state;
  if (!inventory || !inventory.tools) return deny(`nenhum inventário de MCP selado nesta máquina, então nenhuma ferramenta MCP roda. O Alexandre sela num terminal: node ~/.claude/hooks/mcp-guard.mjs seal`);
  const entry = inventory.tools[name];
  if (!entry) return deny(`${name} está fora do inventário selado (MCP novo, renomeado ou ferramenta nova). Se for de confiança, o Alexandre resela num terminal: node ~/.claude/hooks/mcp-guard.mjs seal`);
  const changed = drift?.changed?.[name];
  if (changed && changed.hash !== entry.hash) return deny(`a descrição de ${name} mudou desde o selo (${changed.seenAt ?? 'data desconhecida'}). Fica barrada até o Alexandre conferir e reselar: node ~/.claude/hooks/mcp-guard.mjs seal`);

  const caps = policy.capOverrides[name] ?? entry.caps ?? [];
  const v = violations(parts.server, parts.tool, input, caps, policy);
  if (v.length) return deny(`${v.map((x) => `${x.cap} (${x.why})`).join('; ')}. ${LIBERA}`);
  return null;
}

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function runHook() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  const p = paths();
  const out = decide(payload, { inventory: readJson(p.inventory, null), drift: readJson(p.drift, null), policy: loadPolicy() });
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
}

// ---------- MCP listing (seal / check) ----------

const expand = (s) => String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, k, d) => process.env[k] ?? d ?? '').replace(/^~(?=\/|\\|$)/, homedir());

function listStdio(cfg, timeoutMs) {
  return new Promise((resolveP, reject) => {
    const env = { ...process.env };
    for (const [k, v] of Object.entries(cfg.env || {})) env[k] = expand(v);
    const child = spawn(expand(cfg.command), (cfg.args || []).map(expand), { env, stdio: ['pipe', 'pipe', 'ignore'], shell: process.platform === 'win32', windowsHide: true });
    const tools = [];
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      err ? reject(err) : resolveP(tools);
    };
    const timer = setTimeout(() => finish(new Error(`sem resposta em ${timeoutMs} ms`)), timeoutMs);
    const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    child.on('error', finish);
    child.on('exit', () => finish(new Error('o servidor encerrou antes de listar')));
    createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id === 1) {
        if (msg.error) return finish(new Error(msg.error.message));
        send({ method: 'notifications/initialized' });
        send({ id: 2, method: 'tools/list', params: {} });
      } else if (typeof msg.id === 'number' && msg.id >= 2) {
        if (msg.error) return finish(new Error(msg.error.message));
        tools.push(...(msg.result?.tools || []));
        if (msg.result?.nextCursor) send({ id: msg.id + 1, method: 'tools/list', params: { cursor: msg.result.nextCursor } });
        else finish();
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-guard', version: '1' } } });
  });
}

async function listHttp(cfg, timeoutMs) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  for (const [k, v] of Object.entries(cfg.headers || {})) headers[k] = expand(v);
  const url = expand(cfg.url);
  const signal = AbortSignal.timeout(timeoutMs);
  let session = null;
  const rpc = async (body) => {
    const res = await fetch(url, { method: 'POST', headers: session ? { ...headers, 'mcp-session-id': session } : headers, body: JSON.stringify({ jsonrpc: '2.0', ...body }), signal });
    session = res.headers.get('mcp-session-id') ?? session;
    if (body.id === undefined) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const candidates = (res.headers.get('content-type') || '').includes('text/event-stream')
      ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
      : [text];
    for (const c of candidates) {
      try {
        const msg = JSON.parse(c);
        if (msg.id === body.id) {
          if (msg.error) throw new Error(msg.error.message);
          return msg.result;
        }
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
    throw new Error('resposta sem o resultado pedido');
  };
  await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-guard', version: '1' } } });
  await rpc({ method: 'notifications/initialized' });
  const tools = [];
  let cursor;
  for (let id = 2; id < 50; id++) {
    const r = await rpc({ id, method: 'tools/list', params: cursor ? { cursor } : {} });
    tools.push(...(r?.tools || []));
    if (!r?.nextCursor) break;
    cursor = r.nextCursor;
  }
  return tools;
}

function listServer(cfg, timeoutMs) {
  const type = cfg.type || (cfg.url ? 'http' : 'stdio');
  if (type === 'stdio') return listStdio(cfg, timeoutMs);
  if (type === 'http') return listHttp(cfg, timeoutMs);
  return Promise.reject(new Error(`transporte ${type} não suportado pelo selo; sele por --from`));
}

function serversFromConfigFile(file) {
  const json = readJson(expand(file), null);
  return json?.mcpServers ?? {};
}

function discoverServers(cwd) {
  const servers = {};
  const claudeJson = readJson(join(homedir(), '.claude.json'), {});
  Object.assign(servers, claudeJson.mcpServers || {});
  const project = claudeJson.projects?.[cwd] || claudeJson.projects?.[cwd?.replace(/\\/g, '/')];
  Object.assign(servers, project?.mcpServers || {});
  if (cwd) Object.assign(servers, serversFromConfigFile(join(cwd, '.mcp.json')));
  return servers;
}

/** { server: { tools:[{name,description}] } | { error } } for every server in the configs. */
async function listAll(servers, timeoutMs) {
  const names = Object.keys(servers);
  const results = await Promise.allSettled(names.map((n) => listServer(servers[n], timeoutMs)));
  return Object.fromEntries(names.map((n, i) => [n, results[i].status === 'fulfilled' ? { tools: results[i].value } : { error: results[i].reason?.message ?? String(results[i].reason) }]));
}

function argValues(args, flag) {
  const out = [];
  args.forEach((a, i) => {
    if (a === flag && args[i + 1]) out.push(args[i + 1]);
  });
  return out;
}

async function gather(args, extraConfigs = []) {
  const cwd = process.cwd();
  const servers = args.includes('--no-discover') ? {} : discoverServers(cwd);
  for (const f of [...argValues(args, '--mcp-config'), ...extraConfigs]) Object.assign(servers, serversFromConfigFile(f));
  const listed = await listAll(servers, loadPolicy().serverTimeoutMs);
  for (const f of argValues(args, '--from')) {
    const data = readJson(expand(f), null);
    if (!data) throw new Error(`não consegui ler ${f}`);
    for (const s of Array.isArray(data) ? data : [data]) listed[s.server] = { tools: s.tools, imported: f };
  }
  return listed;
}

// ---------- seal ----------

function buildEntries(listed) {
  const tools = {};
  for (const [server, r] of Object.entries(listed)) {
    if (!r.tools) continue;
    for (const t of r.tools) {
      const key = toolKey(server, t.name);
      tools[key] = { server: normalizeName(server), hash: sealHash(key, t.description), caps: staticCaps(normalizeName(server), t.name, t.description), description: String(t.description ?? '').slice(0, 400), source: r.imported ? `importado de ${r.imported}` : 'listado do servidor' };
    }
  }
  return tools;
}

async function confirmAtTerminal() {
  const isDefault = resolve(guardDir()) === resolve(defaultGuardDir());
  if (process.argv.includes('--yes') && !isDefault) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write('Selar o inventário real exige uma pessoa num terminal (o agente não sela sozinho). Rode este comando no seu terminal, fora do Claude.\n');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((r) => rl.question('Digite SELAR para gravar este inventário: ', r));
  rl.close();
  return answer.trim() === 'SELAR';
}

async function runSeal(args) {
  const listed = await gather(args);
  const p = paths();
  const old = readJson(p.inventory, { tools: {} });
  const fresh = buildEntries(listed);
  // A server that failed to list keeps what was sealed for it before.
  for (const [server, r] of Object.entries(listed)) {
    if (r.error) for (const [k, e] of Object.entries(old.tools || {})) if (e.server === normalizeName(server)) fresh[k] = e;
  }
  if (!args.includes('--replace')) for (const [k, e] of Object.entries(old.tools || {})) if (!(k in fresh) && !Object.keys(listed).map(normalizeName).includes(e.server)) fresh[k] = e;

  const lines = [];
  for (const [server, r] of Object.entries(listed)) lines.push(r.error ? `  ! ${server}: não listou (${r.error}); fica o selo anterior` : `  ${server}: ${r.tools.length} ferramentas${r.imported ? ' (importadas)' : ''}`);
  for (const [k, e] of Object.entries(fresh)) {
    const before = old.tools?.[k];
    if (!before) lines.push(`  + ${k} [${e.caps.join(', ') || 'sem capacidade de risco'}] — ${e.description.slice(0, 120)}`);
    else if (before.hash !== e.hash) lines.push(`  ~ ${k} DESCRIÇÃO MUDOU [${e.caps.join(', ')}]\n      antes: ${String(before.description).slice(0, 160)}\n      agora: ${e.description.slice(0, 160)}`);
  }
  for (const k of Object.keys(old.tools || {})) if (!(k in fresh)) lines.push(`  - ${k} (sai do inventário)`);
  process.stderr.write(`Inventário de MCP em ${p.inventory}\n${lines.join('\n')}\n`);

  if (!(await confirmAtTerminal())) {
    process.stderr.write('Nada gravado.\n');
    process.exitCode = 1;
    return;
  }
  writeJsonAtomic(p.inventory, { version: 1, sealedAt: new Date().toISOString(), tools: fresh });
  const drift = readJson(p.drift, { changed: {} });
  for (const k of Object.keys(drift.changed || {})) if (fresh[k] && fresh[k].hash === drift.changed[k].hash) delete drift.changed[k];
  writeJsonAtomic(p.drift, drift);
  process.stderr.write(`Selado: ${Object.keys(fresh).length} ferramentas.\n`);
}

// ---------- check ----------

async function runCheck(args) {
  const p = paths();
  const inventory = readJson(p.inventory, null);
  if (!inventory?.tools) return;
  const drift = readJson(p.drift, { changed: {} });
  drift.changed ||= {};
  const policy = loadPolicy();
  const fresh = drift.checkedAt && Date.now() - Date.parse(drift.checkedAt) < policy.checkTtlMinutes * 60_000;
  let sessionId = null;
  if (!process.stdin.isTTY) {
    try {
      sessionId = JSON.parse(await readStdin()).session_id ?? null;
    } catch {}
  }
  if (fresh && !args.includes('--force')) return report(drift);
  const extra = sessionId ? policy.sessionMcpConfigs.map((t) => t.replace('{session_id}', sessionId)).filter((f) => existsSync(expand(f))) : [];
  const listed = await gather(args.filter((a) => a !== '--from'), extra);
  const now = new Date().toISOString();
  const unverified = [];
  for (const [server, r] of Object.entries(listed)) {
    if (r.error) {
      unverified.push(`${server} (${r.error})`);
      continue;
    }
    const s = normalizeName(server);
    for (const k of Object.keys(drift.changed)) if (drift.changed[k].server === s) delete drift.changed[k];
    for (const t of r.tools) {
      const key = toolKey(server, t.name);
      const sealed = inventory.tools[key];
      const hash = sealHash(key, t.description);
      if (sealed && sealed.hash !== hash) drift.changed[key] = { server: s, hash, seenAt: now, description: String(t.description ?? '').slice(0, 400) };
    }
  }
  drift.checkedAt = now;
  drift.unverified = unverified;
  writeJsonAtomic(p.drift, drift);
  report(drift);
}

function report(drift) {
  const changed = Object.keys(drift.changed || {});
  if (changed.length === 0) return;
  const msg = `Trava de MCP: ${changed.length} ferramenta(s) MCP mudaram de descrição desde o selo e estão barradas até o Alexandre conferir e reselar: ${changed.join(', ')}.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg } }) + '\n');
  process.stderr.write(msg + '\n');
}

// ---------- main ----------

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePath(resolve(process.argv[1]), SELF)) {
  const [mode, ...args] = process.argv.slice(2);
  const run = mode === 'seal' ? runSeal(args) : mode === 'check' ? runCheck(args) : runHook();
  run.catch((e) => {
    if (mode === 'seal' || mode === 'check') {
      process.stderr.write(`mcp-guard ${mode}: ${e.message}\n`);
      process.exitCode = mode === 'seal' ? 1 : 0;
    } else {
      process.stdout.write(JSON.stringify(deny(`erro interno da trava (${e.message}); na dúvida, nada passa.`)) + '\n');
    }
  });
}
