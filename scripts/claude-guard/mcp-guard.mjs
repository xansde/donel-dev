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
  /** Rule for a Composio slug, on top of DEFAULT_SLUG_RULES: { "GOOGLESHEETS_BATCH_UPDATE": "write" }, or "blocked". */
  slugRules: {},
  /** E-mail domains that count as the owner's: an invite or recipient outside them is a message in his name. */
  ownerDomains: [],
  /** Branches no MCP writes to directly (staging takes changes by PR). */
  protectedBranches: ['main', 'master', 'staging'],
  /** Repos (owner/name) no MCP writes to: the public stable channel. */
  protectedRepos: ['xansde/donel'],
  /** Per-session MCP configs the seal and the check also list (Donel: remote sessions, and local ones on the PC). */
  sessionMcpGlobs: ['~/.donel/s/*/mcp.json', '~/AppData/Roaming/donel-dev/browser-mcp/*.json'],
  sessionMaxAgeHours: 24,
  serverTimeoutMs: 8000,
};

/**
 * Composio slugs allowed with no policy: an explicit list per toolkit, because the catalog is open and a slug's
 * name does not say all it does. Anything else is blocked until the owner adds it to `slugRules`. Names that do
 * not exist in the catalog only fail closed.
 */
export const DEFAULT_SLUG_RULES = Object.freeze({
  // Slack: reads, and the two sends the Donel letter gate (carta_slack) decides.
  SLACK_FETCH_CONVERSATION_HISTORY: 'read',
  SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION: 'read',
  SLACK_LIST_ALL_CHANNELS: 'read',
  SLACK_LIST_ALL_USERS: 'read',
  SLACK_FIND_USERS: 'read',
  SLACK_SEARCH_MESSAGES: 'read',
  SLACK_RETRIEVE_CONVERSATION_INFORMATION: 'read',
  SLACK_RETRIEVE_DETAILED_USER_INFORMATION: 'read',
  SLACK_RETRIEVE_DETAILED_INFORMATION_ABOUT_A_FILE: 'read',
  SLACK_SEND_MESSAGE: 'slack-send',
  SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK: 'slack-send',
  // Gmail: reads only (sending, labels and trash need the owner).
  GMAIL_FETCH_EMAILS: 'read',
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: 'read',
  GMAIL_FETCH_MESSAGE_BY_THREAD_ID: 'read',
  GMAIL_LIST_THREADS: 'read',
  GMAIL_LIST_LABELS: 'read',
  GMAIL_GET_ATTACHMENT: 'read',
  // Google Calendar, Drive, Sheets: reads only.
  GOOGLECALENDAR_EVENTS_LIST: 'read',
  GOOGLECALENDAR_FIND_EVENT: 'read',
  GOOGLECALENDAR_FIND_FREE_SLOTS: 'read',
  GOOGLECALENDAR_LIST_CALENDARS: 'read',
  GOOGLEDRIVE_FIND_FILE: 'read',
  GOOGLEDRIVE_DOWNLOAD_FILE: 'read',
  GOOGLESHEETS_BATCH_GET: 'read',
  GOOGLESHEETS_GET_SPREADSHEET_INFO: 'read',
});

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
const TARGET_OP_STEMS = ['deploy', 'publish', 'releas', 'promot', 'rollback', 'restor', 'paus'];
const RISKY_ACTION_STEMS = ['deploy', 'shar', 'archiv', 'trash', 'delet', 'remov', 'publish', 'invit', 'destroy', 'purg', 'revok', 'transfer', 'merg', 'forc', 'releas', 'truncat', 'eras', 'wipe', 'unlink', 'upload', 'broadcast', 'forward', 'schedul'];
const RISKY_OBJECT_STEMS = ['permiss', 'visib', 'public', 'privat', 'collaborat', 'secret', 'credential', 'password', 'webhook', 'acl', 'sharing'];
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
  // A write is judged by word stems too: "sharing", "deployment", "archived" are the same risk as share, deploy, archive.
  const riskyStem = t.find((x) => RISKY_ACTION_STEMS.some((st) => x.startsWith(st))) ?? t.find((x) => RISKY_OBJECT_STEMS.some((st) => x.startsWith(st)));
  const riskyObject = t.find((x) => RISKY_OBJECT_WORDS.has(x));

  if (has(t, RUN_WORDS) && (t.includes('tool') || t.includes('tools'))) return { rule: 'dispatch' };
  if (has(t, SQL_WORDS) || d.includes('sql')) return { rule: 'sql' };
  if (has(t, CODE_WORDS) || RUN_WORDS.has(lead)) return { rule: 'code', why: 'roda código ou comando, que não dá para julgar antes' };
  if (t.some((x) => TARGET_OP_STEMS.some((st) => x.startsWith(st)))) return { rule: 'target-op' };
  if (has(t, SEND_WORDS) && (t.includes('slack') || tokens(server).includes('slack'))) return { rule: 'slack-send' };
  const writesFile = t.includes('file') && (t.includes('update') || t.includes('create'));
  if ((has(t, GIT_PUSH_WORDS) || writesFile) && has(ctxToks, GIT_CONTEXT_WORDS) && !t.some((x) => RISKY_ACTION_WORDS.has(x) && !GIT_PUSH_WORDS.has(x))) return { rule: 'git-write' };
  if (lead === 'create' && (t.includes('repository') || t.includes('repo')) && !riskyAction) return { rule: 'repo-create' };
  if (READ_WORDS.has(lead) && !riskyAction) return { rule: 'read' };
  if (SAFE_WRITE_WORDS.has(lead) && !riskyAction && !riskyObject && !riskyStem) return { rule: 'write' };
  if (riskyAction) return { rule: 'blocked', why: `faz "${riskyAction}"` };
  if (riskyObject || riskyStem) return { rule: 'blocked', why: `mexe em "${riskyObject ?? riskyStem}"` };
  return { rule: 'blocked', why: 'ação não reconhecida como segura' };
}

function walk(value, visit) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    visit(k, v);
    walk(v, visit);
  }
}

const stringsIn = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(stringsIn) : v && typeof v === 'object' ? Object.values(v).flatMap(stringsIn) : []);
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
const EMAIL_RE = /[^\s<>"',;:]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const RECIPIENT_KEYS = set('to cc bcc recipient recipients recipient_email recipient_emails attendees attendee invitees invitee guests guest emails email_addresses emailAddress');

/** Parameters that change what an otherwise plain write does: publish, trash/archive, production, force, invite outside. */
function effectProblem(input, policy) {
  let why = null;
  const outside = (text) => [...String(text).matchAll(EMAIL_RE)].some((m) => !policy.ownerDomains.some((dom) => m[1].toLowerCase() === dom.toLowerCase() || m[1].toLowerCase().endsWith(`.${dom.toLowerCase()}`)));
  walk(input, (k, v) => {
    const key = k.toLowerCase();
    const sv = typeof v === 'string' ? v.toLowerCase() : null;
    if ((key === 'private' || key === 'is_private' || key === 'isprivate') && (v === false || v === 'false')) why = 'torna algo público';
    if ((key === 'visibility' || key === 'repo_visibility') && sv !== null && sv !== 'private') why = 'muda visibilidade';
    if ((key === 'public' || key === 'is_public' || key === 'publish' || key === 'published') && truthy(v)) why = 'torna algo público';
    if (key === 'type' && (sv === 'anyone' || sv === 'domain')) why = 'compartilha com qualquer um ou com o domínio';
    if ((key === 'allowfilediscovery' || key === 'allow_file_discovery') && truthy(v)) why = 'deixa o arquivo achável';
    if (key === 'force' && v !== false && v !== 'false' && v !== undefined && v !== null) why = 'pede force';
    if (['archived', 'is_archived', 'archive', 'in_trash', 'trashed', 'trash', 'is_trashed', 'deleted'].includes(key) && truthy(v)) why = 'arquiva ou manda para a lixeira';
    if (/label/.test(key) && (Array.isArray(v) ? v : [v]).some((x) => typeof x === 'string' && /^(trash|spam)$/i.test(x))) why = 'manda para a lixeira ou o spam';
    if (['environment', 'env', 'target', 'target_env', 'stage', 'deploy_target'].includes(key) && sv !== null && /^prod(uction)?$/.test(sv)) why = 'mexe em produção';
    if ((key === 'production' || key === 'is_production') && truthy(v)) why = 'mexe em produção';
    if (RECIPIENT_KEYS.has(k) || RECIPIENT_KEYS.has(key)) {
      if (stringsIn(v).some(outside)) why = 'convida ou escreve para endereço fora dos domínios do dono';
    }
    if (['send_updates', 'sendupdates', 'send_notifications', 'sendnotifications', 'notify', 'notify_attendees'].includes(key) && v !== false && v !== 'false' && v !== 'none' && v !== undefined && v !== null) {
      if (policy.ownerDomains.length === 0) why = 'avisa convidados em nome do dono';
    }
  });
  return why;
}

function protectedRepo(input, policy) {
  const owner = input?.owner;
  const repo = input?.repo ?? input?.repository ?? input?.name;
  if (typeof owner !== 'string' || typeof repo !== 'string') return null;
  const full = `${owner}/${repo}`.toLowerCase();
  return policy.protectedRepos.some((r) => r.toLowerCase() === full) ? `escrita no repositório protegido ${full}` : null;
}

function branchProblem(input, policy) {
  const b = input?.branch;
  if (typeof b !== 'string' || !b.trim()) return 'escrita no repositório sem "branch": cai na branch padrão (main)';
  const bare = b.trim().replace(/^(refs\/)?(heads\/)?/i, '').toLowerCase();
  if (MAIN_RE.test(b.trim()) || policy.protectedBranches.some((p) => p.toLowerCase() === bare)) return `escrita direto na branch protegida ${bare}`;
  const decoy = Object.keys(input).find((k) => DECOY_BRANCH_KEYS.has(k));
  if (decoy) return `"${decoy}" ao lado de "branch": o servidor pode usar o outro`;
  return protectedRepo(input, policy);
}

function targetProblem(input, policy) {
  const id = input?.project_id;
  if (typeof id !== 'string' || !policy.nonProdTargets.includes(id)) return 'SQL, migration ou deploy fora do projeto de staging';
  const decoy = Object.keys(input).find((k) => DECOY_TARGET_KEYS.has(k) && input[k] !== id);
  if (decoy) return `"${decoy}" aponta para outro alvo ao lado de "project_id"`;
  return null;
}

/** A plain write that names a project goes only to a non-production one (e.g. a Supabase setting). */
function projectProblem(input, policy) {
  for (const k of ['project_id', 'projectId', 'project_ref', 'projectRef']) {
    if (input && Object.hasOwn(input, k) && !policy.nonProdTargets.includes(input[k])) return `escreve no projeto ${String(input[k]).slice(0, 40)}, que não é o staging`;
  }
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

/** The rule of a Composio slug: only an explicit one (owner's policy, then the default list). Never inferred. */
function slugRule(slug, policy) {
  if (Object.hasOwn(policy.slugRules, slug)) return policy.slugRules[slug];
  if (Object.hasOwn(DEFAULT_SLUG_RULES, slug)) return DEFAULT_SLUG_RULES[slug];
  return null;
}

/** null = allowed; otherwise the reason it is blocked. */
export function judge(rule, why, server, input, policy, depth = 0) {
  const effects = () => effectProblem(input, policy);
  switch (rule) {
    case 'trusted':
    case 'read':
      return null;
    case 'write':
      return projectProblem(input, policy) ?? protectedRepo(input, policy) ?? effects();
    case 'slack-send':
      return (policy.letterGated.slack || []).includes(server) ? null : 'mensagem ao Slack em nome do dono fora do caminho com carta (Composio)';
    case 'git-write':
      return branchProblem(input, policy) ?? effects();
    case 'repo-create':
      return input?.private === true ? effects() : 'repositório que não é explicitamente privado';
    case 'sql':
    case 'target-op':
      return targetProblem(input, policy) ?? effects();
    case 'dispatch': {
      if (depth > 0) return 'despacho dentro de despacho';
      const calls = dispatchedCalls(input);
      if (!calls) return 'não achei a ação despachada (tool_slug + arguments)';
      for (const c of calls) {
        const r = slugRule(c.slug, policy);
        if (!r) return `${c.slug}: fora da lista de ações do Composio permitidas (o dono libera em slugRules)`;
        if (r === 'dispatch' || r === 'code') return `${c.slug}: despacho ou código`;
        const v = judge(r, undefined, server, c.args, policy, depth + 1);
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
  const serverDrift = drift?.servers?.[entry.server];
  if (serverDrift) return deny(`a config do servidor ${entry.server} mudou desde o selo (${serverDrift.reason}); outro servidor com o mesmo nome não herda a regra. Fica barrado até o Alexandre conferir e reselar. ${RESEAL}`);
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

/** Stable identity of a server config: what it runs, or where it connects. No headers or env (tokens rotate);
 *  a loopback URL drops its port, which the Donel app picks anew each run. */
export function configHash(cfg) {
  const type = cfg?.type || (cfg?.url ? 'http' : 'stdio');
  let ident;
  if (type === 'stdio') ident = [type, String(cfg?.command ?? ''), ...(Array.isArray(cfg?.args) ? cfg.args : []).map(String)];
  else {
    let url = String(cfg?.url ?? '');
    try {
      const u = new URL(url);
      if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) u.port = '';
      u.search = '';
      u.hash = '';
      url = u.toString();
    } catch {}
    ident = [type, url];
  }
  return createHash('sha256').update(JSON.stringify(ident)).digest('hex').slice(0, 32);
}

/** Every server config the CLI could load for this user: user scope, EVERY project (local scope and its .mcp.json),
 *  the current folder, Donel session configs and --mcp-config. One entry per config, newest session first. */
function discoverConfigs(opts, who, policy) {
  const out = [];
  const add = (servers, source) => {
    for (const [name, cfg] of Object.entries(servers || {})) if (cfg && typeof cfg === 'object') out.push({ name: normalizeName(name), cfg, source, hash: configHash(cfg) });
  };
  if (!opts.flags.has('--no-discover')) {
    const claudeJson = readJson(join(who.home, '.claude.json'), {});
    add(claudeJson.mcpServers, '~/.claude.json');
    const projectDirs = new Set();
    for (const [dir, proj] of Object.entries(claudeJson.projects || {})) {
      add(proj?.mcpServers, `~/.claude.json projects[${dir}]`);
      projectDirs.add(dir);
    }
    projectDirs.add(process.cwd());
    for (const dir of projectDirs) {
      const f = join(dir, '.mcp.json');
      if (existsSync(f)) add(serversFromConfigFile(f), f);
    }
    for (const g of policy.sessionMcpGlobs) for (const f of globFiles(g, who.home, policy.sessionMaxAgeHours * 3_600_000)) add(serversFromConfigFile(f), f);
  }
  for (const f of opts.values('--mcp-config')) {
    const file = expandWith(who.home)(f);
    add(serversFromConfigFile(file), file);
  }
  return out;
}

/** Lists each distinct (server, config) once. `listed[name]` = { tools } from the first config that answered, or { error }. */
async function gather(opts, ctx) {
  const who = targetUser(opts);
  const policy = loadPolicy(ctx);
  const configs = discoverConfigs(opts, who, policy);
  const distinct = [];
  const seen = new Set();
  for (const c of configs) if (!seen.has(`${c.name}\0${c.hash}`)) seen.add(`${c.name}\0${c.hash}`) && distinct.push(c);
  const results = await Promise.allSettled(distinct.map((c) => listServer(c.cfg, policy.serverTimeoutMs, who)));
  const listed = {};
  distinct.forEach((c, i) => {
    const r = results[i];
    const prev = listed[c.name];
    if (r.status === 'fulfilled') {
      if (!prev?.tools) listed[c.name] = { tools: r.value };
      else for (const t of r.value) if (!prev.tools.some((x) => x.name === t.name)) prev.tools.push(t);
    } else if (!prev) listed[c.name] = { error: r.reason?.message ?? String(r.reason) };
  });
  for (const f of opts.values('--from')) {
    const data = readJson(f, null);
    if (!data) throw new Error(`não consegui ler ${f}`);
    for (const s of Array.isArray(data) ? data : [data]) listed[normalizeName(s.server)] = { tools: s.tools, imported: f };
  }
  return { listed, configs };
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
  const { listed, configs } = await gather(opts, ctx);
  const policy = loadPolicy(ctx);
  const old = readJson(ctx.files.inventory, { tools: {}, servers: {} });
  const fresh = {};
  const servers = {};
  for (const [s, r] of Object.entries(listed)) {
    if (r.error) {
      for (const [k, e] of Object.entries(old.tools || {})) if (e.server === s) fresh[k] = e;
      if (old.servers?.[s]) servers[s] = old.servers[s];
      continue;
    }
    for (const t of r.tools) {
      const key = toolKey(s, t.name);
      const c = classify(s, t.name, t.description, policy);
      fresh[key] = { server: s, hash: sealHash(key, t.description), rule: c.rule, ...(c.why ? { why: c.why } : {}), description: String(t.description ?? '').slice(0, 400), source: r.imported ? `importado de ${r.imported}` : 'listado do servidor' };
    }
    const mine = configs.filter((c) => c.name === s);
    servers[s] = { configHashes: [...new Set(mine.map((c) => c.hash))], sources: [...new Set(mine.map((c) => c.source))], ...(r.imported ? { imported: true } : {}) };
  }
  const listedServers = new Set(Object.keys(listed));
  if (!opts.flags.has('--replace')) {
    for (const [k, e] of Object.entries(old.tools || {})) if (!(k in fresh) && !listedServers.has(e.server)) fresh[k] = e;
    for (const [s, e] of Object.entries(old.servers || {})) if (!(s in servers)) servers[s] = e;
  }

  const lines = [];
  for (const [s, r] of Object.entries(listed)) {
    const hashes = servers[s]?.configHashes ?? [];
    const cfgNote = hashes.length > 1 ? `; ATENÇÃO: ${hashes.length} configs diferentes com este nome (${servers[s].sources.join(', ')})` : hashes.length === 0 ? '; sem config local (só pelo que foi importado)' : '';
    lines.push(r.error ? `  ! ${s}: não listou (${r.error}); fica o selo anterior` : `  ${s}: ${r.tools.length} ferramentas${r.imported ? ' (importadas)' : ''}${cfgNote}`);
  }
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
  writeJsonAtomic(ctx, ctx.files.inventory, { version: 3, sealedAt: new Date().toISOString(), tools: fresh, servers });
  const drift = readJson(ctx.files.drift, { changed: {}, servers: {} });
  for (const k of Object.keys(drift.changed || {})) if (fresh[k] && fresh[k].hash === drift.changed[k].hash) delete drift.changed[k];
  for (const s of Object.keys(drift.servers || {})) if (listed[s] && !listed[s].error) delete drift.servers[s];
  writeJsonAtomic(ctx, ctx.files.drift, drift);
  process.stderr.write(`Selado: ${Object.keys(fresh).length} ferramentas.\n`);
}

// ---------- check / status / list ----------

async function runCheck(opts, ctx) {
  const inventory = readJson(ctx.files.inventory, null);
  if (!inventory?.tools) return;
  const drift = readJson(ctx.files.drift, {});
  drift.changed ||= {};
  drift.servers ||= {};
  const { listed, configs } = await gather(opts, ctx);
  const now = new Date().toISOString();
  const unverified = [];
  const sealedServers = new Set([...Object.keys(inventory.servers || {}), ...Object.values(inventory.tools).map((e) => e.server)]);

  // 1. Config: another config under a sealed name blocks the whole server.
  for (const s of sealedServers) {
    const sealed = inventory.servers?.[s];
    const found = configs.filter((c) => c.name === s);
    const known = new Set(sealed?.configHashes ?? []);
    const stranger = found.find((c) => !known.has(c.hash));
    if (stranger) drift.servers[s] = { seenAt: now, reason: `config diferente da selada em ${stranger.source}` };
    else delete drift.servers[s];
    if (found.length === 0) unverified.push(`${s} (${sealed?.imported ? 'importado no selo; daqui não dá para reconferir' : 'não achei a config dele em lugar nenhum'})`);
  }
  // 2. Description: what the servers expose today against the seal.
  for (const [s, r] of Object.entries(listed)) {
    if (r.imported) continue;
    if (r.error) {
      unverified.push(`${s} (${r.error})`);
      continue;
    }
    for (const k of Object.keys(drift.changed)) if (drift.changed[k].server === s) delete drift.changed[k];
    for (const t of r.tools) {
      const key = toolKey(s, t.name);
      const sealed = inventory.tools[key];
      const hash = sealHash(key, t.description);
      if (sealed && sealed.hash !== hash) drift.changed[key] = { server: s, hash, seenAt: now, description: String(t.description ?? '').slice(0, 400) };
    }
  }
  drift.checkedAt = now;
  drift.unverified = unverified;
  writeJsonAtomic(ctx, ctx.files.drift, drift);
  process.stderr.write(statusText(inventory, drift));
}

function statusText(inventory, drift) {
  const lines = [`mcp-guard: inventário selado em ${inventory?.sealedAt ?? 'nunca'}; reconferido em ${drift?.checkedAt ?? 'nunca'}.`];
  const changed = Object.keys(drift?.changed || {});
  const servers = Object.entries(drift?.servers || {});
  if (changed.length) lines.push(`Barradas por descrição mudada (até reselar): ${changed.join(', ')}`);
  for (const [s, e] of servers) lines.push(`Servidor barrado por config mudada: ${s} — ${e.reason}`);
  if (drift?.unverified?.length) lines.push(`Não reconferidos (a trava não olhou estes): ${drift.unverified.join('; ')}`);
  return lines.join('\n') + '\n';
}

async function runStatus(_opts, ctx) {
  process.stdout.write(statusText(readJson(ctx.files.inventory, null), readJson(ctx.files.drift, null)));
}

async function runList(opts, ctx) {
  const { listed } = await gather(opts, ctx);
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
  const runners = { seal: runSeal, check: runCheck, list: runList, status: runStatus };
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
