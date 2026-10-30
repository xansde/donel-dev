// B3 (backlog) — painel de PRs e checks por projeto na sidebar. Puro: o JSON
// que o `gh` devolve vira o modelo do indicador (estado agregado dos checks,
// sinal de review), a contagem de conversas não resolvidas e o texto do
// "Mandar pro Claude consertar". Quem spawna o `gh` é `src/main/github-reader.ts`
// (allowlist, só leitura); quem decide quando ler é `src/main/pull-request-status.ts`.
//
// Degradação por omissão (mesmo espírito de `githubFacts.ts`): JSON que não
// tem a forma esperada vira `null`, nunca um valor fabricado.

/** Estado de um check: passou, rodando (inclui na fila), falhou, ou pulado/neutro (não pesa no agregado). */
export type PrCheckState = 'pass' | 'pending' | 'fail' | 'skipped';

export interface PrCheck {
  /** `<workflow> / <job>` quando o GitHub informa o workflow; senão só o nome do check. */
  readonly name: string;
  readonly state: PrCheckState;
  /** Página do job/status no GitHub — só `https:`; `null` quando ausente ou com outro esquema. */
  readonly url: string | null;
}

/** Agregado dos checks do PR: vermelho vence amarelo, amarelo vence verde; sem check nenhum = `none`. */
export type PrChecksRollup = 'pass' | 'pending' | 'fail' | 'none';

/** O que o review pede agora. `none` = ninguém pediu nada (repo sem review obrigatório e sem review dado). */
export type PrReviewSignal = 'approved' | 'changes-requested' | 'review-required' | 'none';

export type PrReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export interface PrReview {
  readonly author: string;
  readonly state: PrReviewState;
}

export interface PullRequestStatus {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly checks: readonly PrCheck[];
  readonly rollup: PrChecksRollup;
  readonly review: PrReviewSignal;
  /** Último review de cada revisor (`latestReviews` do `gh`). */
  readonly reviews: readonly PrReview[];
  /** Conversas de review não resolvidas; `null` = não lido (só o painel pede esta leitura). */
  readonly unresolvedThreads: number | null;
}

// ------------------------------------------------------------------ helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Só `https:` sai do app como link (o painel abre no navegador). */
export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ checks

const CHECK_RUN_FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const CHECK_RUN_SKIPPED = new Set(['NEUTRAL', 'SKIPPED', 'STALE']);

/**
 * Um item de `statusCheckRollup`: `CheckRun` (GitHub Actions e apps) ou
 * `StatusContext` (status de commit à moda antiga). Forma desconhecida → `null`
 * (o item some da lista; não vira check inventado).
 */
export function parseCheck(raw: unknown): PrCheck | null {
  if (!isRecord(raw)) return null;
  if (raw.__typename === 'StatusContext') {
    const name = str(raw.context);
    const state = str(raw.state);
    if (!name || !state) return null;
    const mapped: PrCheckState | null =
      state === 'SUCCESS' ? 'pass' : state === 'FAILURE' || state === 'ERROR' ? 'fail' : state === 'PENDING' || state === 'EXPECTED' ? 'pending' : null;
    if (!mapped) return null;
    return { name, state: mapped, url: httpsUrlOrNull(raw.targetUrl) };
  }
  if (raw.__typename === 'CheckRun') {
    const job = str(raw.name);
    if (!job) return null;
    const status = str(raw.status) ?? '';
    const conclusion = str(raw.conclusion) ?? '';
    let mapped: PrCheckState;
    if (status !== 'COMPLETED') mapped = 'pending';
    else if (conclusion === 'SUCCESS') mapped = 'pass';
    else if (CHECK_RUN_FAIL.has(conclusion)) mapped = 'fail';
    else if (CHECK_RUN_SKIPPED.has(conclusion)) mapped = 'skipped';
    else return null;
    const workflow = str(raw.workflowName);
    return { name: workflow ? `${workflow} / ${job}` : job, state: mapped, url: httpsUrlOrNull(raw.detailsUrl) };
  }
  return null;
}

export function aggregateChecks(checks: readonly PrCheck[]): PrChecksRollup {
  if (checks.some((check) => check.state === 'fail')) return 'fail';
  if (checks.some((check) => check.state === 'pending')) return 'pending';
  if (checks.length === 0) return 'none';
  return 'pass';
}

// ------------------------------------------------------------------ reviews

const REVIEW_STATES = new Set<PrReviewState>(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']);

function parseReviews(raw: unknown): PrReview[] {
  if (!Array.isArray(raw)) return [];
  const out: PrReview[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const state = str(item.state) as PrReviewState | null;
    if (!state || !REVIEW_STATES.has(state)) continue;
    const author = isRecord(item.author) ? str(item.author.login) : null;
    out.push({ author: author ?? 'alguém', state });
  }
  return out;
}

/**
 * `reviewDecision` do GitHub quando ele decide (repo com review obrigatório);
 * senão, o que os reviews dados dizem — mudança pedida vence aprovação.
 */
export function reviewSignal(decision: unknown, reviews: readonly PrReview[]): PrReviewSignal {
  if (decision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'REVIEW_REQUIRED') return 'review-required';
  if (reviews.some((review) => review.state === 'CHANGES_REQUESTED')) return 'changes-requested';
  if (reviews.some((review) => review.state === 'APPROVED')) return 'approved';
  return 'none';
}

// ------------------------------------------------------------------ PR

/**
 * Saída de `gh pr view <branch> --json <PR_STATUS_FIELDS>` → modelo do
 * indicador. Só PR **aberto** interessa à sidebar: mergeado/fechado vira
 * `null` (a branch ficou para trás, nada a acompanhar).
 */
export function parsePullRequestStatus(raw: unknown): PullRequestStatus | null {
  if (!isRecord(raw)) return null;
  if (raw.state !== 'OPEN') return null;
  const number = raw.number;
  const url = httpsUrlOrNull(raw.url);
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0 || !url) return null;
  const checks = Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup.map(parseCheck).filter((c): c is PrCheck => c !== null) : [];
  const reviews = parseReviews(raw.latestReviews);
  return {
    number,
    title: str(raw.title) ?? '',
    url,
    isDraft: raw.isDraft === true,
    headRefName: str(raw.headRefName) ?? '',
    checks,
    rollup: aggregateChecks(checks),
    review: reviewSignal(raw.reviewDecision, reviews),
    reviews,
    unresolvedThreads: null,
  };
}

/** `https://github.com/<owner>/<repo>/pull/<n>` → dono e nome do repo (para a consulta das conversas). */
export function repoFromPullRequestUrl(url: string): { readonly owner: string; readonly name: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const [owner, name, kind] = parsed.pathname.split('/').filter((part) => part.length > 0);
  if (!owner || !name || kind !== 'pull') return null;
  if (!isSafeRepoPart(owner) || !isSafeRepoPart(name)) return null;
  return { owner, name };
}

/** Dono/nome de repo do GitHub: letras, números, `.`, `_`, `-`, e nunca começando por `-` (não vira flag). */
export function isSafeRepoPart(value: string): boolean {
  return /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(value);
}

/**
 * Resposta da consulta GraphQL fixa de conversas de review
 * (`REVIEW_THREADS_QUERY` em github-reader.ts) → quantas estão abertas.
 * Forma inesperada → `null` (o painel diz "não consegui ler", não "0").
 */
export function parseUnresolvedThreadCount(raw: unknown): number | null {
  if (!isRecord(raw) || !isRecord(raw.data)) return null;
  const repository = raw.data.repository;
  if (!isRecord(repository) || !isRecord(repository.pullRequest)) return null;
  const threads = repository.pullRequest.reviewThreads;
  if (!isRecord(threads) || !Array.isArray(threads.nodes)) return null;
  return threads.nodes.filter((node) => isRecord(node) && node.isResolved === false).length;
}

// ------------------------------------------------------------------ ações

/** O botão "Mandar pro Claude consertar" só faz sentido com check vermelho ou mudança pedida. */
export function needsFix(pr: PullRequestStatus): boolean {
  return pr.rollup === 'fail' || pr.review === 'changes-requested';
}

/** Polling só enquanto há check rodando: o resto muda por gesto (foco, troca de projeto). */
export function shouldPoll(pr: PullRequestStatus | null): boolean {
  return pr !== null && pr.rollup === 'pending';
}

/**
 * O prompt pronto que vai para a sessão do projeto. Nomeia o PR, cada check
 * vermelho com o link do job e, se houver, as mudanças pedidas — o suficiente
 * para o Claude começar por `gh` sem perguntar de volta.
 */
export function buildFixPrompt(pr: PullRequestStatus): string {
  const lines: string[] = [`O PR #${pr.number} (${pr.title}) precisa de conserto: ${pr.url}`];
  const failed = pr.checks.filter((check) => check.state === 'fail');
  if (failed.length > 0) {
    lines.push('', 'Checks que falharam:');
    for (const check of failed) lines.push(`- ${check.name}${check.url ? ` — ${check.url}` : ''}`);
  }
  if (pr.review === 'changes-requested') {
    const who = [...new Set(pr.reviews.filter((review) => review.state === 'CHANGES_REQUESTED').map((review) => review.author))];
    lines.push('', `Mudanças pedidas no review${who.length > 0 ? ` (${who.join(', ')})` : ''}.`);
  }
  if (typeof pr.unresolvedThreads === 'number' && pr.unresolvedThreads > 0) {
    lines.push(`Há ${pr.unresolvedThreads} ${pr.unresolvedThreads === 1 ? 'conversa não resolvida' : 'conversas não resolvidas'} no PR.`);
  }
  lines.push(
    '',
    'Investigue a causa (use o `gh`: `gh pr checks`, `gh run view --log-failed`, `gh pr view --comments`), corrija nesta branch, rode os testes e me diga o que mudou antes de fazer push.',
  );
  return lines.join('\n');
}
