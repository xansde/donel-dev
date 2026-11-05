import { spawn } from 'node:child_process';
import { parsePullRequestStatus, parseUnresolvedThreadCount, isSafeRepoPart, type PullRequestStatus } from '../shared/pullRequestStatus';
import {
  parsePullRequest,
  parsePullRequestList,
  parseSpecIssue,
  parseSubIssues,
  type PhasePullRequestFacts,
  type SpecIssueFacts,
  type SpecIssueRef,
  type SubIssueFacts,
} from '../shared/githubFacts';

// CA-3/CA-5 (009-modo-dev-v3, lote 4) — leitura do GitHub por `gh` CLI via
// spawn ("GitHub responde 'o que existe pra fazer'": spec-issue, sub-issues
// nativas, PR da fase + etiquetas homologado/revertido-ciclo). Mesmo padrão
// de I/O de quota-headroom.ts (spawn com timeout, nunca lança, nunca trava o
// main process) e mesma garantia estrutural de taskdex-board-client.ts
// (`BoardReadTool`, achado 13): a allowlist de comandos É o tipo — chamar
// fora da união falha em `npm run typecheck`, nunca em produção.
//
// NENHUMA ESCRITA, em nenhuma circunstância (CA-3): os únicos dois lugares
// que montam argv de `gh` são o `switch` exaustivo de `buildGhArgs` (só os 4
// kinds abaixo, 6 desde o B3) e o literal fixo `['auth', 'status']` do probe de
// disponibilidade — não existe caminho de código que aceite argv livre.
//
// B3 (painel de PRs na sidebar) acrescentou dois kinds, no mesmo molde:
// `pr-view-branch` (o PR da branch atual de uma pasta, com checks e reviews;
// roda com `cwd` na pasta para o `gh` achar o repo pelo remote) e
// `pr-review-threads` (`gh api graphql` com uma consulta LITERAL fixa —
// `REVIEW_THREADS_QUERY`, só `query`, nunca `mutation` — e só dono/nome/número
// como variáveis).

/** União de literais — o allowlist em si (mesmo espírito de `BoardReadTool`). */
export type GhReadCommandKind = 'issue-view' | 'issue-sub-issues' | 'pr-view' | 'pr-list-by-head' | 'pr-view-branch' | 'pr-review-threads';

/** Cada `kind` carrega só os parâmetros que o comando real precisa — discriminação por `kind`, união de literais no discriminante. */
export type GhReadCommand =
  | { readonly kind: 'issue-view'; readonly repo: string; readonly number: number }
  | { readonly kind: 'issue-sub-issues'; readonly repo: string; readonly number: number }
  | { readonly kind: 'pr-view'; readonly repo: string; readonly number: number }
  | { readonly kind: 'pr-list-by-head'; readonly repo: string; readonly head: string }
  | { readonly kind: 'pr-view-branch'; readonly cwd: string; readonly branch: string }
  | { readonly kind: 'pr-review-threads'; readonly owner: string; readonly name: string; readonly number: number };

/** Os mesmos campos que o contrato v3 §F/§D documenta (spec-issue e PR) — fixos, nunca compostos a partir de entrada externa. */
const ISSUE_VIEW_FIELDS = 'number,title,state,url,labels';
const PR_FIELDS = 'number,url,state,mergedAt,baseRefName,labels';
/** B3 — o que o indicador e o painel da sidebar mostram (`parsePullRequestStatus`). */
export const PR_STATUS_FIELDS = 'number,title,url,state,isDraft,headRefName,statusCheckRollup,reviewDecision,latestReviews';
/**
 * B3 — conversas de review do PR. Literal fixo: só leitura (`query`), e as
 * únicas entradas são as variáveis tipadas abaixo. `first: 100` cobre PR de
 * repo pessoal com folga; passou disso, a contagem para nas 100 primeiras
 * conversas (raro o bastante para não valer paginação).
 */
export const REVIEW_THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}';

/** Único lugar que monta argv a partir de `GhReadCommand` — switch exaustivo sobre a união (TS recusa compilar um `kind` novo sem um `case`). */
function buildGhArgs(command: GhReadCommand): readonly string[] {
  switch (command.kind) {
    case 'issue-view':
      return ['issue', 'view', String(command.number), '--repo', command.repo, '--json', ISSUE_VIEW_FIELDS];
    case 'issue-sub-issues':
      // Rota REST do contrato §F.5 — `gh issue view/list` não expõe sub-issues nesta versão do gh (correção factual do próprio contrato).
      return ['api', `repos/${command.repo}/issues/${command.number}/sub_issues`];
    case 'pr-view':
      return ['pr', 'view', String(command.number), '--repo', command.repo, '--json', PR_FIELDS];
    case 'pr-list-by-head':
      // Achar o PR da fase quando o número ainda não é conhecido (ex.: PR
      // ainda não confirmado/mergeado) — busca pela branch (`ctx.md`
      // frontmatter). `--state all` inclui
      // aberto/fechado/mergeado; `--limit 1` porque uma branch tem no máximo
      // um PR aberto contra o repo.
      return ['pr', 'list', '--repo', command.repo, '--head', command.head, '--state', 'all', '--json', PR_FIELDS, '--limit', '1'];
    case 'pr-view-branch':
      // O `--` impede que a branch vire flag mesmo se a validação de cima falhar um dia.
      return ['pr', 'view', '--json', PR_STATUS_FIELDS, '--', command.branch];
    case 'pr-review-threads':
      // `-f` = string crua (dono numérico não vira Int); `-F` só no número, que É Int.
      return [
        'api',
        'graphql',
        '-f',
        `query=${REVIEW_THREADS_QUERY}`,
        '-f',
        `owner=${command.owner}`,
        '-f',
        `name=${command.name}`,
        '-F',
        `number=${command.number}`,
      ];
  }
}

/** Pasta de trabalho do spawn: só o `pr-view-branch` roda dentro do projeto (o `gh` acha o repo pelo remote). */
function cwdFor(command: GhReadCommand): string | undefined {
  return command.kind === 'pr-view-branch' ? command.cwd : undefined;
}

export type GhSpawnResult = { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly reason: 'not_found' | 'failed' | 'timeout' };

const DEFAULT_TIMEOUT_MS = 8_000; // mesmo teto de quota-headroom.ts — nunca trava o main process esperando rede/gh.

export interface RunGhReadCommandOptions {
  readonly timeoutMs?: number;
  /** Injetável pra teste — `runGhReadCommand`/`checkGhAvailability` nunca importam `spawn` fora daqui. */
  readonly spawnFn?: typeof spawn;
}

/**
 * I/O — spawna `gh` com o argv EXATO que `buildGhArgs`/o literal fixo de
 * `auth status` produzem, nunca argv livre de chamador nenhum. Nunca lança:
 * ENOENT síncrono, evento `error` do child, timeout e exit != 0 viram
 * `ok:false` com o motivo — o chamador decide como degradar (CA-6).
 */
function spawnGhRaw(args: readonly string[], spawnFn: typeof spawn, timeoutMs: number, cwd?: string): Promise<GhSpawnResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn('gh', args, cwd === undefined ? { windowsHide: true } : { windowsHide: true, cwd });
    } catch {
      resolve({ ok: false, reason: 'not_found' });
      return;
    }

    let stdout = '';
    let settled = false;
    const finish = (result: GhSpawnResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, reason: 'timeout' });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => finish({ ok: false, reason: 'not_found' }));
    child.on('close', (code) => {
      finish(code === 0 ? { ok: true, stdout } : { ok: false, reason: 'failed' });
    });
  });
}

/** CA-3 — spawna um dos comandos de leitura permitidos. Fora da união `GhReadCommand`, não compila (achado 13). */
export function runGhReadCommand(command: GhReadCommand, options?: RunGhReadCommandOptions): Promise<GhSpawnResult> {
  return spawnGhRaw(buildGhArgs(command), options?.spawnFn ?? spawn, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, cwdFor(command));
}

// ---------------------------------------------------------------------------
// Degradação (CA-6) — `gh` ausente/não autenticado vira "fonte indisponível",
// memoizada por sessão de app (module-level) pra não martelar spawn a cada
// render/leitura.
// ---------------------------------------------------------------------------

export type GhAvailability = { readonly available: true } | { readonly available: false; readonly reason: 'not_installed' | 'not_authenticated' };

let cachedAvailability: Promise<GhAvailability> | null = null;

async function probeGhAvailability(options?: RunGhReadCommandOptions): Promise<GhAvailability> {
  const result = await spawnGhRaw(['auth', 'status'], options?.spawnFn ?? spawn, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (result.ok) return { available: true };
  if (result.reason === 'not_found') return { available: false, reason: 'not_installed' };
  return { available: false, reason: 'not_authenticated' };
}

/**
 * `gh` instalado + autenticado, ou não — memoizado pra vida do processo main
 * (um probe só por sessão de app; `force: true` reprova e reprovoca, usado
 * só por um gesto explícito de "tentar de novo", se algum lote futuro
 * precisar). Nunca lança.
 */
export function checkGhAvailability(options?: RunGhReadCommandOptions & { readonly force?: boolean }): Promise<GhAvailability> {
  if (!options?.force && cachedAvailability) return cachedAvailability;
  cachedAvailability = probeGhAvailability(options);
  return cachedAvailability;
}

/** Só para teste — nenhum código de produção limpa este cache (memoização é a garantia, não um detalhe incidental). */
export function resetGhAvailabilityCacheForTest(): void {
  cachedAvailability = null;
}

// ---------------------------------------------------------------------------
// Cache de leitura, TTL curto (o app não pode martelar a API a cada render
// do mapa/painel — lotes 7/8). Mesmo espírito de `HeadroomCache`
// (quota-headroom.ts), TTL bem mais curto porque o dado aqui é "o que existe
// pra fazer agora", não uma cota que muda devagar.
// ---------------------------------------------------------------------------

const READ_CACHE_TTL_MS = 20_000;

interface GithubReadCacheEntry {
  readonly value: unknown;
  readonly cachedAt: number;
}

export class GithubReadCache {
  private readonly entries = new Map<string, GithubReadCacheEntry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.cachedAt > READ_CACHE_TTL_MS) return undefined;
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    this.entries.set(key, { value, cachedAt: this.now() });
  }
}

async function cached<T>(cache: GithubReadCache | undefined, key: string, read: () => Promise<T>): Promise<T> {
  if (!cache) return read();
  const hit = cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await read();
  cache.set(key, value);
  return value;
}

// ---------------------------------------------------------------------------
// Leituras compostas — spawn + parse (src/shared/githubFacts.ts) + cache
// opcional. Cada uma degrada por omissão (C4/CA-6): `gh` ausente/falho/JSON
// malformado vira `null`/`[]`, nunca lança, nunca fabrica valor.
// ---------------------------------------------------------------------------

export interface GithubReadOptions extends RunGhReadCommandOptions {
  readonly cache?: GithubReadCache;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** CA-3/CA-5 — a spec-issue apontada por `outputs.spec_issue` (achada em disco, CA-4, via `extractSpecIssueRef`). */
export function readSpecIssueFacts(ref: SpecIssueRef, options?: GithubReadOptions): Promise<SpecIssueFacts | null> {
  return cached(options?.cache, `issue-view:${ref.repo}#${ref.number}`, async () => {
    const result = await runGhReadCommand({ kind: 'issue-view', repo: ref.repo, number: ref.number }, options);
    if (!result.ok) return null;
    return parseSpecIssue(parseJsonSafe(result.stdout));
  });
}

/** CA-3 — sub-issues nativas da spec-issue. `[]` cobre tanto "sem sub-issues" quanto "gh indisponível" (mesma degradação por omissão do resto do reader de disco, ver `readDiscoveryPlanCards`). */
export function readSubIssueFacts(ref: SpecIssueRef, options?: GithubReadOptions): Promise<readonly SubIssueFacts[]> {
  return cached(options?.cache, `sub-issues:${ref.repo}#${ref.number}`, async () => {
    const result = await runGhReadCommand({ kind: 'issue-sub-issues', repo: ref.repo, number: ref.number }, options);
    if (!result.ok) return [];
    return parseSubIssues(parseJsonSafe(result.stdout));
  });
}

export interface PhasePullRequestRef {
  readonly repo: string;
  /** Conhecido (ex.: `validar-result.json.outputs.pr.number`, já confirmado por `esteira-validar`) — preferido quando presente. */
  readonly number?: number | null;
  /** Branch da fase (`ctx.md` frontmatter, `PhaseArtifacts.branch`) — usado só quando `number` ainda não é conhecido (PR não aberto/confirmado). */
  readonly head?: string | null;
}

/** CA-3 — PR da fase (estado mergeado/aberto + etiquetas homologado/revertido-ciclo). Sem `number` nem `head`: sem endereço, sem fonte — `null` sem sequer spawnar. */
export function readPhasePullRequestFacts(ref: PhasePullRequestRef, options?: GithubReadOptions): Promise<PhasePullRequestFacts | null> {
  if (typeof ref.number === 'number') {
    return cached(options?.cache, `pr-view:${ref.repo}#${ref.number}`, async () => {
      const result = await runGhReadCommand({ kind: 'pr-view', repo: ref.repo, number: ref.number as number }, options);
      if (!result.ok) return null;
      return parsePullRequest(parseJsonSafe(result.stdout));
    });
  }

  if (ref.head) {
    return cached(options?.cache, `pr-list-by-head:${ref.repo}@${ref.head}`, async () => {
      const result = await runGhReadCommand({ kind: 'pr-list-by-head', repo: ref.repo, head: ref.head as string }, options);
      if (!result.ok) return null;
      return parsePullRequestList(parseJsonSafe(result.stdout));
    });
  }

  return Promise.resolve(null);
}

// ---------------------------------------------------------------------------
// B3 — PR da branch atual de uma pasta (sidebar). Sem cache aqui: quem decide
// a validade é `src/main/pull-request-status.ts`, que guarda também o "não tem
// PR" (negativo) para não respawnar a cada foco da janela.
// ---------------------------------------------------------------------------

/** Nome de branch que pode ir para o argv: não vazio, sem espaço/controle, nunca começando por `-`. */
export function isSafeBranchName(branch: string): boolean {
  if (branch.length === 0 || branch.length > 255 || branch.startsWith('-')) return false;
  if ([...branch].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return false;
  return !/[\s~^:?*[\]\\]/.test(branch);
}

/** PR **aberto** da `branch` no repo da pasta `cwd`; `null` = sem PR aberto, `gh` indisponível ou resposta estranha. */
export async function readBranchPullRequestStatus(cwd: string, branch: string, options?: RunGhReadCommandOptions): Promise<PullRequestStatus | null> {
  if (!isSafeBranchName(branch)) return null;
  const result = await runGhReadCommand({ kind: 'pr-view-branch', cwd, branch }, options);
  if (!result.ok) return null;
  return parsePullRequestStatus(parseJsonSafe(result.stdout));
}

/** Conversas de review abertas do PR; `null` = não consegui ler (nunca "0" inventado). */
export async function readUnresolvedThreadCount(
  repo: { readonly owner: string; readonly name: string },
  number: number,
  options?: RunGhReadCommandOptions,
): Promise<number | null> {
  if (!isSafeRepoPart(repo.owner) || !isSafeRepoPart(repo.name) || !Number.isInteger(number) || number <= 0) return null;
  const result = await runGhReadCommand({ kind: 'pr-review-threads', owner: repo.owner, name: repo.name, number }, options);
  if (!result.ok) return null;
  return parseUnresolvedThreadCount(parseJsonSafe(result.stdout));
}
