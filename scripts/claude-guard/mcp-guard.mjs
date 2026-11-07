#!/usr/bin/env node
// MCP guard — PreToolUse hook that lets an MCP tool call run only when it is RECOGNIZED as safe, plus a
// sealed inventory of the MCP tools this machine trusts.
//
//   mcp-guard.mjs hook --system     PreToolUse (matcher "mcp__.*"), called by the root-owned hook.sh
//   mcp-guard.mjs seal --system     root/admin seals what the servers expose today (types SELAR)
//   mcp-guard.mjs check --system    root timer: relists the servers, marks tools whose description changed
//   mcp-guard.mjs list              prints what the servers expose (input for `seal --from` on Windows)
//
// Order of the hook: (1) no inventory, or one the Claude user could have written -> block every MCP call;
// (2) tool not in the inventory (new or renamed server, new tool) -> block; (3) description changed since
// the seal -> block; (4) the tool's RULE decides. The rule is fixed at seal time from the tool's name and
// description, with an allowlist: read, plain write, Slack through the letter gate, git write to a named
// feature branch, SQL/deploy on the staging project, private repo creation, dispatch of Composio slugs
// (each slug judged by the same rules). Anything not recognized is blocked, and so is executable code.
//
// System mode (`--system`): the files live in a root/admin-owned dir, MCP_GUARD_DIR is ignored, and on
// POSIX the hook refuses files the Claude user can write. That ownership, not any pattern match, is what
// keeps the agent from resealing or editing the rules.
// The hook always prints a JSON decision; hook.sh turns an empty output or a crash into a block.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const SYSTEM_DIR = process.platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\mcp-guard' : '/etc/claude-code/mcp-guard';

// ---------- policy ----------

export const DEFAULT_POLICY = {
  /** Targets that are NOT production; SQL and deploys run only there (Supabase staging shared by the squad). */
  nonProdTargets: ['fxjpnamoafzomqlncdyn'],
  /** Sending in the owner's name only on these channels and servers, where the Donel letter gate (carta_slack) decides. */
  letterGated: { slack: ['composio'] },
  /** Servers whose tools are all allowed: the Donel app (it decides hierarchy and letters) and the agent's own bot. */
  trustedServers: ['donel', 'theo-slack', 'theo-west-slack'],
  /** Explicit rule for a sealed tool, set by the owner: { "mcp__s__t": "write" }. */
  toolRules: {},
  /** Explicit rule for a Composio slug: { "GOOGLESHEETS_BATCH_UPDATE": "write" }. */
  slugRules: {},
  /** Per-session MCP configs the seal and the check also list (Donel: remote sessions, and local ones on the PC). */
  sessionMcpGlobs: ['~/.donel/s/*/mcp.json', '~/AppData/Roaming/donel-dev/browser-mcp/*.json'],
  sessionMaxAgeHours: 24,
  serverTimeoutMs: 8000,
};

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const values = (flag) => rest.flatMap((a, i) => (a === flag && rest[i + 1] !== undefined ? [rest[i + 1]] : []));
  return { mode, flags, values, value: (flag) => values(flag)[0] };
}

function contextOf(opts) {
  const system = opts.flags.has('--system');
  const dir = resolve(system ? (opts.value('--dir') ?? SYSTEM_DIR) : (opts.value('--dir') ?? process.env.MCP_GUARD_DIR ?? SYSTEM_DIR));
  return { system, dir, files: { inventory: join(dir, 'inventory.json'), drift: join(dir, 'drift.json'), policy: join(dir, 'policy.json') } };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJsonAtomic(ctx, file, value) {
  mkdirSync(ctx.dir, { recursive: true, mode: 0o755 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
  renameSync(tmp, file);
}
function loadPolicy(ctx) {
  const local = readJson(ctx.files.policy, {});
  return { ...DEFAULT_POLICY, ...local, letterGated: { ...DEFAULT_POLICY.letterGated, ...(local.letterGated || {}) } };
}

/** POSIX, system mode: every file the decision depends on must be root-owned and not group/other-writable. */
function ownershipProblem(ctx) {
  if (!ctx.system || process.platform === 'win32') return null;
  const must = [dirname(ctx.dir), ctx.dir, ctx.files.inventory, ctx.files.policy, ctx.files.drift, SELF];
  for (const p of must) {
    if (!existsSync(p)) continue;
    const st = statSync(realpathSync(p));
    if (st.uid !== 0 || (st.mode & 0o022) !== 0) return `${p} não é só do root (dono ${st.uid}, modo ${(st.mode & 0o777).toString(8)})`;
  }
  return null;
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

const set = (words) => new Set(words.trim().split(/\s+/));
const READ_WORDS = set('get list fetch search read find lookup describe show view count retrieve download ler listar buscar ver obter consultar');
const SAFE_WRITE_WORDS = set('create add update edit comment assign unassign label request open rename set mark submit react criar adicionar atualizar editar comentar marcar');
const SEND_WORDS = set('send post reply respond broadcast forward share upload publish schedule enviar mandar postar publicar responder encaminhar compartilhar agendar');
const RISKY_ACTION_WORDS = set(`delete deletes remove drop truncate destroy purge wipe erase trash archive unlink rm revoke ban kick disable
  merge force push commit rebase reset revert transfer deploy release invite approve dismiss
  apagar excluir deletar remover lixeira arquivar ${[...SEND_WORDS].join(' ')}`);
const RISKY_OBJECT_WORDS = set(`repository repositories repo repos visibility public private ref refs reference references secret secrets
  token tokens key keys credential credentials permission permissions collaborator collaborators member members role roles admin admins
  webhook webhooks workflow workflows billing payment payments protection ruleset rulesets owner owners org organization password`);
const RUN_WORDS = set('execute exec run eval');
const CODE_WORDS = set('workbench bash shell python terminal script eval exec');
const SQL_WORDS = set('sql migration migrations migrate');
const TARGET_OP_WORDS = set('deploy deploys publish release promote rollback restore pause');
const GIT_PUSH_WORDS = set('push commit commits');
const GIT_CONTEXT_WORDS = set('github gitlab git bitbucket repository repositories repo repos commit branch');
const ANY_VERB = new Set([...READ_WORDS, ...SAFE_WRITE_WORDS, ...RISKY_ACTION_WORDS, ...RUN_WORDS]);
/** Keys that also name a branch: when present next to `branch`, the server may honor them instead. */
const DECOY_BRANCH_KEYS = set('ref refs base base_branch baseBranch target_branch targetBranch branch_name branchName head head_ref default_branch');
/** Keys that also name a project or database: when present next to `project_id`, the server may honor them instead. */
const DECOY_TARGET_KEYS = set('project projectId project_ref projectRef ref db database env environment branch_id');
const MAIN_RE = /^(refs\/)?(heads\/)?(main|master)$/i;

const has = (toks, words) => toks.some((t) => words.has(t));

// ---------- rules ----------

/**
 * The rule of a tool (or a Composio slug), from its name and description. Allowlist: what is not
 * recognized with certainty is `blocked`.
 */
export function classify(server, tool, description = '', policy = DEFAULT_POLICY, { nested = false } = {}) {
  if (!nested && policy.trustedServers.includes(server)) return { rule: 'trusted' };
  const t = tokens(tool);
  const d = tokens(description);
  const ctxToks = [...t, ...tokens(server), ...d];
  const lead = t.find((x) => ANY_VERB.has(x));
  const descLead = d.find((x) => ANY_VERB.has(x));
  const riskyAction = t.find((x) => RISKY_ACTION_WORDS.has(x)) ?? (descLead && RISKY_ACTION_WORDS.has(descLead) ? descLead : undefined);
  const riskyObject = t.find((x) => RISKY_OBJECT_WORDS.has(x));

  if (has(t, RUN_WORDS) && (t.includes('tool') || t.includes('tools'))) return { rule: 'dispatch' };
  if (has(t, SQL_WORDS) || d.includes('sql')) return { rule: 'sql' };
  if (has(t, CODE_WORDS) || RUN_WORDS.has(lead)) return { rule: 'code', why: 'roda código ou comando, que não dá para julgar antes' };
  if (has(t, TARGET_OP_WORDS)) return { rule: 'target-op' };
  if (has(t, SEND_WORDS) && (t.includes('slack') || tokens(server).includes('slack'))) return { rule: 'slack-send' };
  const writesFile = t.includes('file') && (t.includes('update') || t.includes('create'));
  if ((has(t, GIT_PUSH_WORDS) || writesFile) && has(ctxToks, GIT_CONTEXT_WORDS) && !t.some((x) => RISKY_ACTION_WORDS.has(x) && !GIT_PUSH_WORDS.has(x))) return { rule: 'git-write' };
  if (lead === 'create' && (t.includes('repository') || t.includes('repo')) && !riskyAction) return { rule: 'repo-create' };
  if (READ_WORDS.has(lead) && !riskyAction) return { rule: 'read' };
  if (SAFE_WRITE_WORDS.has(lead) && !riskyAction && !riskyObject) return { rule: 'write' };
  if (riskyAction) return { rule: 'blocked', why: `faz "${riskyAction}"` };
  if (riskyObject) return { rule: 'blocked', why: `mexe em "${riskyObject}"` };
  return { rule: 'blocked', why: 'ação não reconhecida como segura' };
}

function walk(value, visit) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    visit(k, v);
    walk(v, visit);
  }
}

function dangerousFlags(input) {
  let why = null;
  walk(input, (k, v) => {
    const key = k.toLowerCase();
    if ((key === 'private' || key === 'is_private' || key === 'isprivate') && (v === false || v === 'false')) why = 'torna algo público';
    if ((key === 'visibility' || key === 'repo_visibility') && typeof v === 'string' && v.toLowerCase() !== 'private') why = 'muda visibilidade';
    if ((key === 'public' || key === 'is_public') && (v === true || v === 'true')) why = 'torna algo público';
    if (key === 'force' && v !== false && v !== 'false' && v !== undefined && v !== null) why = 'pede force';
  });
  return why;
}

function branchProblem(input) {
  const b = input?.branch;
  if (typeof b !== 'string' || !b.trim()) return 'escrita no repositório sem "branch": cai na branch padrão (main)';
  if (MAIN_RE.test(b.trim())) return 'escrita direto em main/master';
  const decoy = Object.keys(input).find((k) => DECOY_BRANCH_KEYS.has(k));
  if (decoy) return `"${decoy}" ao lado de "branch": o servidor pode usar o outro`;
  return null;
}

function targetProblem(input, policy) {
  const id = input?.project_id;
  if (typeof id !== 'string' || !policy.nonProdTargets.includes(id)) return 'SQL, migration ou deploy fora do projeto de staging';
  const decoy = Object.keys(input).find((k) => DECOY_TARGET_KEYS.has(k) && input[k] !== id);
  if (decoy) return `"${decoy}" aponta para outro alvo ao lado de "project_id"`;
  return null;
}

function dispatchedCalls(input) {
  const items = Array.isArray(input?.tools) ? input.tools : input && (input.tool_slug || input.slug) ? [input] : null;
  if (!items || items.length === 0) return null;
  const calls = [];
  for (const it of items) {
    const slug = it?.tool_slug ?? it?.slug;
    const args = it?.arguments ?? it?.args ?? {};
    if (typeof slug !== 'string' || !args || typeof args !== 'object') return null;
    calls.push({ slug, args });
  }
  return calls;
}

/** null = allowed; otherwise the reason it is blocked. */
export function judge(rule, why, server, input, policy, depth = 0) {
  const flags = () => dangerousFlags(input);
  switch (rule) {
    case 'trusted':
    case 'read':
      return null;
    case 'write':
      return flags();
    case 'slack-send':
      return (policy.letterGated.slack || []).includes(server) ? null : 'mensagem ao Slack em nome do dono fora do caminho com carta (Composio)';
    case 'git-write':
      return branchProblem(input) ?? flags();
    case 'repo-create':
      return input?.private === true ? flags() : 'repositório que não é explicitamente privado';
    case 'sql':
    case 'target-op':
      return targetProblem(input, policy) ?? flags();
    case 'dispatch': {
      if (depth > 0) return 'despacho dentro de despacho';
      const calls = dispatchedCalls(input);
      if (!calls) return 'não achei a ação despachada (tool_slug + arguments)';
      for (const c of calls) {
        const explicit = policy.slugRules[c.slug];
        const r = explicit ? { rule: explicit } : classify(server, c.slug, '', policy, { nested: true });
        if (r.rule === 'dispatch' || r.rule === 'code') return `${c.slug}: ${r.why ?? 'despacho ou código'}`;
        const v = judge(r.rule, r.why, server, c.args, policy, depth + 1);
        if (v) return `${c.slug}: ${v}`;
      }
      return null;
    }
    case 'code':
      return why ?? 'roda código ou comando, que não dá para julgar antes';
    default:
      return why ?? 'ação não reconhecida como segura';
  }
}

// ---------- hook ----------

const RESEAL = 'O Alexandre resela como root/admin: sudo node /etc/claude-code/mcp-guard/mcp-guard.mjs seal --system --user <usuário>';
const LIBERA = 'Se for trabalho legítimo, o Alexandre classifica em policy.json (toolRules/slugRules, arquivo do root) ou faz à mão. Não tente outro caminho.';
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Bloqueado pela trava de MCP (mcp-guard): ${reason}` } });
const ALLOW = { suppressOutput: true };

/** Pure decision for one hook payload: the JSON to print (ALLOW or a deny). */
export function decide(payload, state) {
  const name = payload?.tool_name;
  const input = payload?.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  if (typeof name !== 'string') return deny('chamada sem nome de ferramenta; na dúvida, nada passa.');
  const parts = splitToolName(name);
  if (!parts) return ALLOW;

  const { inventory, drift, policy, ownerProblem } = state;
  if (ownerProblem) return deny(`os arquivos da trava podem ter sido mexidos pelo usuário do Claude (${ownerProblem}); exige root. Nenhum MCP roda até o Alexandre corrigir a instalação.`);
  if (!inventory || !inventory.tools) return deny(`nenhum inventário de MCP selado nesta máquina, então nenhuma ferramenta MCP roda. ${RESEAL}`);
  const entry = inventory.tools[name];
  if (!entry) return deny(`${name} está fora do inventário selado (MCP novo, renomeado ou ferramenta nova). Se for de confiança: ${RESEAL}`);
  const changed = drift?.changed?.[name];
  if (changed && changed.hash !== entry.hash) return deny(`a descrição de ${name} mudou desde o selo (${changed.seenAt ?? 'data desconhecida'}). Fica barrada até o Alexandre conferir e reselar. ${RESEAL}`);

  const rule = policy.toolRules[name] ?? entry.rule ?? 'blocked';
  const why = judge(rule, policy.toolRules[name] ? undefined : entry.why, parts.server, input, policy);
  return why ? deny(`${name} — ${why}. ${LIBERA}`) : ALLOW;
}

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function runHook(_opts, ctx) {
  let payload = null;
  try {
    payload = JSON.parse(await readStdin());
  } catch {}
  const state = { ownerProblem: ownershipProblem(ctx), inventory: readJson(ctx.files.inventory, null), drift: readJson(ctx.files.drift, null), policy: loadPolicy(ctx) };
  process.stdout.write(JSON.stringify(decide(payload, state)) + '\n');
}

// ---------- the user whose MCP servers are listed ----------

/** Root lists the servers of `--user` with that user's uid, so a server never runs as root. */
function targetUser(opts) {
  const name = opts.value('--user');
  if (!name) return { home: homedir(), spawnAs: {} };
  if (process.platform === 'win32' || process.getuid?.() !== 0) throw new Error('--user só vale rodando como root (Linux)');
  const line = readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.split(':')[0] === name);
  if (!line) throw new Error(`usuário ${name} não existe`);
  const [, , uid, gid, , home] = line.split(':');
  return { home, spawnAs: { uid: Number(uid), gid: Number(gid), env: { HOME: home, USER: name, LOGNAME: name, PATH: `${home}/.local/bin:/usr/local/bin:/usr/bin:/bin` } } };
}

// ---------- MCP listing ----------

const expandWith = (home) => (s) => {
  let out = String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, k, d) => process.env[k] ?? d ?? '');
  if (process.platform === 'win32') out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, k) => process.env[k] ?? m);
  return out.replace(/^~(?=\/|\\|$)/, home);
};

const META = /([()\][%!^"`<>&|;, *?])/g;
function quoteWinArg(arg, doubleEscape) {
  let a = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  a = `"${a}"`.replace(META, '^$1');
  return doubleEscape ? a.replace(META, '^$1') : a;
}
/** Windows: an .exe runs directly; a .cmd/.bat goes through cmd.exe with every argument quoted and escaped (no shell: true). */
export function winSpawn(command, args, env = process.env) {
  let file = command;
  if (!extname(file)) {
    const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';');
    for (const dir of [dirname(file) !== '.' ? dirname(file) : null, ...(env.PATH || env.Path || '').split(delimiter)].filter(Boolean)) {
      const base = dirname(file) !== '.' ? file : join(dir, file);
      const hit = exts.map((e) => base + e.toLowerCase()).find((p) => existsSync(p));
      if (hit) {
        file = hit;
        break;
      }
    }
  }
  if (/\.(exe|com)$/i.test(file)) return { file, args, options: {} };
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
  const line = [String(file).replace(META, '^$1'), ...args.map((a) => quoteWinArg(a, doubleEscape))].join(' ');
  return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}

function listStdio(cfg, timeoutMs, who) {
  return new Promise((resolveP, reject) => {
    const expand = expandWith(who.home);
    const env = { ...(who.spawnAs.env ? who.spawnAs.env : process.env) };
    for (const [k, v] of Object.entries(cfg.env || {})) env[k] = expand(v);
    const command = expand(cfg.command);
    const args = (cfg.args || []).map(expand);
    const plan = process.platform === 'win32' ? winSpawn(command, args, env) : { file: command, args, options: {} };
    const child = spawn(plan.file, plan.args, { ...plan.options, env, cwd: who.home, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, ...(who.spawnAs.uid !== undefined ? { uid: who.spawnAs.uid, gid: who.spawnAs.gid } : {}) });
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
    child.stdin.on('error', () => {});
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
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-guard', version: '2' } } });
  });
}

async function listHttp(cfg, timeoutMs, who) {
  const expand = expandWith(who.home);
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
      let msg;
      try {
        msg = JSON.parse(c);
      } catch {
        continue;
      }
      if (msg.id === body.id) {
        if (msg.error) throw new Error(msg.error.message);
        return msg.result;
      }
    }
    throw new Error('resposta sem o resultado pedido');
  };
  await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-guard', version: '2' } } });
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

function listServer(cfg, timeoutMs, who) {
  const type = cfg.type || (cfg.url ? 'http' : 'stdio');
  if (type === 'stdio') return listStdio(cfg, timeoutMs, who);
  if (type === 'http') return listHttp(cfg, timeoutMs, who);
  return Promise.reject(new Error(`transporte ${type} não suportado pelo selo; sele por --from`));
}

const serversFromConfigFile = (file) => readJson(file, null)?.mcpServers ?? {};

/** Files matching a glob whose only wildcard is one `*` segment (or `*.json`), newest first. */
function globFiles(pattern, home, maxAgeMs) {
  const p = expandWith(home)(pattern).replace(/\\/g, '/');
  const parts = p.split('/');
  const star = parts.findIndex((s) => s.includes('*'));
  if (star < 0) return existsSync(p) ? [p] : [];
  const base = parts.slice(0, star).join('/') || '/';
  const re = new RegExp(`^${parts[star].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  let names = [];
  try {
    names = readdirSync(base).filter((n) => re.test(n));
  } catch {
    return [];
  }
  const now = Date.now();
  return names
    .map((n) => [base, n, ...parts.slice(star + 1)].join('/'))
    .filter((f) => existsSync(f))
    .map((f) => ({ f, m: statSync(f).mtimeMs }))
    .filter((x) => now - x.m < maxAgeMs)
    .sort((a, b) => b.m - a.m)
    .map((x) => x.f);
}

function discoverServers(opts, who, policy) {
  const servers = {};
  if (!opts.flags.has('--no-discover')) {
    const cwd = process.cwd();
    const claudeJson = readJson(join(who.home, '.claude.json'), {});
    Object.assign(servers, claudeJson.mcpServers || {});
    Object.assign(servers, claudeJson.projects?.[cwd]?.mcpServers || {});
    Object.assign(servers, serversFromConfigFile(join(cwd, '.mcp.json')));
    // Per-session configs: the newest file wins for each server name.
    for (const g of policy.sessionMcpGlobs) {
      for (const f of globFiles(g, who.home, policy.sessionMaxAgeHours * 3_600_000)) {
        for (const [n, c] of Object.entries(serversFromConfigFile(f))) if (!(n in servers)) servers[n] = c;
      }
    }
  }
  for (const f of opts.values('--mcp-config')) Object.assign(servers, serversFromConfigFile(expandWith(who.home)(f)));
  return servers;
}

async function gather(opts, ctx) {
  const who = targetUser(opts);
  const policy = loadPolicy(ctx);
  const servers = discoverServers(opts, who, policy);
  const names = Object.keys(servers);
  const results = await Promise.allSettled(names.map((n) => listServer(servers[n], policy.serverTimeoutMs, who)));
  const listed = Object.fromEntries(names.map((n, i) => [n, results[i].status === 'fulfilled' ? { tools: results[i].value } : { error: results[i].reason?.message ?? String(results[i].reason) }]));
  for (const f of opts.values('--from')) {
    const data = readJson(f, null);
    if (!data) throw new Error(`não consegui ler ${f}`);
    for (const s of Array.isArray(data) ? data : [data]) listed[s.server] = { tools: s.tools, imported: f };
  }
  return listed;
}

// ---------- seal ----------

async function confirm(ctx, opts) {
  if (!ctx.system && opts.flags.has('--yes')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((r) => {
    rl.question('Digite SELAR para gravar este inventário: ', r);
    rl.on('close', () => r(''));
  });
  rl.close();
  return String(answer).trim() === 'SELAR';
}

async function runSeal(opts, ctx) {
  if (ctx.system && process.platform !== 'win32' && process.getuid?.() !== 0) {
    process.stderr.write('Selar o inventário do sistema exige root (sudo). O usuário que roda o Claude não sela.\n');
    process.exitCode = 1;
    return;
  }
  const listed = await gather(opts, ctx);
  const policy = loadPolicy(ctx);
  const old = readJson(ctx.files.inventory, { tools: {} });
  const fresh = {};
  for (const [server, r] of Object.entries(listed)) {
    const s = normalizeName(server);
    if (r.error) {
      for (const [k, e] of Object.entries(old.tools || {})) if (e.server === s) fresh[k] = e;
      continue;
    }
    for (const t of r.tools) {
      const key = toolKey(server, t.name);
      const c = classify(s, t.name, t.description, policy);
      fresh[key] = { server: s, hash: sealHash(key, t.description), rule: c.rule, ...(c.why ? { why: c.why } : {}), description: String(t.description ?? '').slice(0, 400), source: r.imported ? `importado de ${r.imported}` : 'listado do servidor' };
    }
  }
  const listedServers = new Set(Object.keys(listed).map(normalizeName));
  if (!opts.flags.has('--replace')) for (const [k, e] of Object.entries(old.tools || {})) if (!(k in fresh) && !listedServers.has(e.server)) fresh[k] = e;

  const lines = [];
  for (const [server, r] of Object.entries(listed)) lines.push(r.error ? `  ! ${server}: não listou (${r.error}); fica o selo anterior` : `  ${server}: ${r.tools.length} ferramentas${r.imported ? ' (importadas)' : ''}`);
  for (const [k, e] of Object.entries(fresh)) {
    const before = old.tools?.[k];
    const tag = `[${e.rule}${e.why ? `: ${e.why}` : ''}]`;
    if (!before) lines.push(`  + ${k} ${tag} — ${e.description.slice(0, 120)}`);
    else if (before.hash !== e.hash) lines.push(`  ~ ${k} DESCRIÇÃO MUDOU ${tag}\n      antes: ${String(before.description).slice(0, 160)}\n      agora: ${e.description.slice(0, 160)}`);
  }
  for (const k of Object.keys(old.tools || {})) if (!(k in fresh)) lines.push(`  - ${k} (sai do inventário)`);
  process.stderr.write(`Inventário de MCP em ${ctx.files.inventory}\n${lines.join('\n')}\n`);

  if (!(await confirm(ctx, opts))) {
    process.stderr.write('Nada gravado.\n');
    process.exitCode = 1;
    return;
  }
  writeJsonAtomic(ctx, ctx.files.inventory, { version: 2, sealedAt: new Date().toISOString(), tools: fresh });
  const drift = readJson(ctx.files.drift, { changed: {} });
  for (const k of Object.keys(drift.changed || {})) if (fresh[k] && fresh[k].hash === drift.changed[k].hash) delete drift.changed[k];
  writeJsonAtomic(ctx, ctx.files.drift, drift);
  process.stderr.write(`Selado: ${Object.keys(fresh).length} ferramentas.\n`);
}

// ---------- check / list ----------

async function runCheck(opts, ctx) {
  const inventory = readJson(ctx.files.inventory, null);
  if (!inventory?.tools) return;
  const drift = readJson(ctx.files.drift, { changed: {} });
  drift.changed ||= {};
  const listed = await gather(opts, ctx);
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
  writeJsonAtomic(ctx, ctx.files.drift, drift);
  const changed = Object.keys(drift.changed);
  if (changed.length) process.stderr.write(`mcp-guard: ${changed.length} ferramenta(s) com descrição mudada, barradas até reselar: ${changed.join(', ')}\n`);
}

async function runList(opts, ctx) {
  const listed = await gather(opts, ctx);
  const dump = Object.entries(listed).filter(([, r]) => r.tools).map(([server, r]) => ({ server, tools: r.tools.map((t) => ({ name: t.name, description: t.description ?? '' })) }));
  for (const [server, r] of Object.entries(listed)) if (r.error) process.stderr.write(`  ! ${server}: não listou (${r.error})\n`);
  process.stdout.write(JSON.stringify(dump, null, 2) + '\n');
}

// ---------- main ----------

function isEntrypoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(SELF);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  const opts = parseArgs(process.argv.slice(2));
  const ctx = contextOf(opts);
  const runners = { seal: runSeal, check: runCheck, list: runList };
  const run = (runners[opts.mode] ?? runHook)(opts, ctx);
  run.catch((e) => {
    if (runners[opts.mode]) {
      process.stderr.write(`mcp-guard ${opts.mode}: ${e.message}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(JSON.stringify(deny(`erro interno da trava (${e.message}); na dúvida, nada passa.`)) + '\n');
    }
  });
}
