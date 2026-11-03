// CA-3/CA-5 (009-modo-dev-v3, lote 4) — parser PURO dos payloads crus do `gh`
// CLI: dado o JSON já parseado (ou qualquer `unknown`), extrai os fatos que a
// spec pede ("GitHub responde 'o que existe pra fazer'": spec-issue,
// sub-issues nativas, PR da fase + etiquetas `homologado`/`revertido-ciclo`,
// contrato handoff-v3.md §A/§C). NENHUM spawn aqui — só transformação de
// dado, testável sem tocar processo/rede (ver src/main/github-reader.ts pro
// I/O, que chama estas funções depois de ler o stdout do `gh`).
//
// Mesma disciplina do resto do repo (C4/CA-6, ver taskdex-board-client.ts
// `toBoardFacts`): shape inesperado
// degrada pra `null`/`[]`, campo desconhecido é ignorado, NUNCA lança. Um
// payload malformado não pode derrubar o mapa — só faz o fato faltar.

export interface SpecIssueRef {
  readonly repo: string; // "owner/repo"
  readonly number: number;
}

export interface SpecIssueFacts {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly url: string;
  readonly labels: readonly string[];
}

/** Sub-issue nativa do GitHub (contrato §A) — `repo` é `null` quando a resposta não informa de onde ela vem (nunca fabricado). */
export interface SubIssueFacts {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly repo: string | null;
  readonly url: string;
}

/** Etiquetas do contrato §C — os únicos dois nomes que a v3 lê no PR. */
export const HOMOLOGADO_LABEL = 'homologado';
export const REVERTIDO_CICLO_LABEL = 'revertido-ciclo';

export interface PhasePullRequestFacts {
  readonly number: number;
  readonly url: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly merged: boolean;
  readonly mergedAt: string | null;
  readonly baseRefName: string | null;
  readonly homologado: boolean;
  readonly revertidoCiclo: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `gh --json labels` devolve array de `{name, color, id, description}` (confirmado ao vivo) — aceita também string solta, por tolerância. */
function toLabelNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      names.push(entry);
    } else if (isPlainObject(entry) && typeof entry.name === 'string') {
      names.push(entry.name);
    }
  }
  return names;
}

/** `gh --json state` devolve MAIÚSCULO (`OPEN`/`CLOSED`/`MERGED`, confirmado ao vivo) — normaliza pra comparação, tolera minúsculo (payload REST cru usa minúsculo). */
function normalizeState(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/** CA-3 — spec-issue, a partir de `gh issue view --json number,title,state,url,labels`. */
export function parseSpecIssue(raw: unknown): SpecIssueFacts | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.number !== 'number') return null;

  return {
    number: raw.number,
    title: typeof raw.title === 'string' ? raw.title : '',
    state: normalizeState(raw.state) === 'closed' ? 'closed' : 'open',
    url: typeof raw.url === 'string' ? raw.url : '',
    labels: toLabelNames(raw.labels),
  };
}

/** `repository_url` é o campo REST confirmado ao vivo (`https://api.github.com/repos/<owner>/<repo>`); `repository.full_name` é a variante GraphQL-enriquecida que o contrato §F.5 lê via `--jq`. Aceita as duas, nunca fabrica um repo que a resposta não informou. */
function repoFromSubIssueEntry(entry: Record<string, unknown>): string | null {
  if (isPlainObject(entry.repository) && typeof entry.repository.full_name === 'string') {
    return entry.repository.full_name;
  }
  if (typeof entry.repository_url === 'string') {
    const match = /repos\/([^/]+\/[^/]+)$/.exec(entry.repository_url);
    if (match) return match[1];
  }
  return null;
}

/** CA-3 — sub-issues nativas, a partir de `gh api repos/<o>/<r>/issues/<n>/sub_issues` (array de objetos de issue REST completos, contrato §F.5). Item sem `number` é descartado; itens vizinhos válidos sobrevivem. */
export function parseSubIssues(raw: unknown): readonly SubIssueFacts[] {
  if (!Array.isArray(raw)) return [];

  const facts: SubIssueFacts[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.number !== 'number') continue;
    facts.push({
      number: entry.number,
      title: typeof entry.title === 'string' ? entry.title : '',
      state: normalizeState(entry.state) === 'closed' ? 'closed' : 'open',
      repo: repoFromSubIssueEntry(entry),
      url: typeof entry.html_url === 'string' ? entry.html_url : typeof entry.url === 'string' ? entry.url : '',
    });
  }
  return facts;
}

function parsePullRequestObject(raw: Record<string, unknown>): PhasePullRequestFacts | null {
  if (typeof raw.number !== 'number') return null;

  const state = normalizeState(raw.state);
  const mergedAt = typeof raw.mergedAt === 'string' ? raw.mergedAt : null;
  const labels = toLabelNames(raw.labels);

  return {
    number: raw.number,
    url: typeof raw.url === 'string' ? raw.url : '',
    state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'open',
    // `mergedAt` é o sinal primário (mais confiável que `state`, que em
    // teoria pode chegar sem normalização de fonte diferente); `state ===
    // 'merged'` é reserva defensiva pro mesmo fato.
    merged: mergedAt !== null || state === 'merged',
    mergedAt,
    baseRefName: typeof raw.baseRefName === 'string' ? raw.baseRefName : null,
    homologado: labels.includes(HOMOLOGADO_LABEL),
    revertidoCiclo: labels.includes(REVERTIDO_CICLO_LABEL),
  };
}

/** CA-3 — PR da fase, a partir de `gh pr view --json number,url,state,mergedAt,baseRefName,labels` (objeto único). */
export function parsePullRequest(raw: unknown): PhasePullRequestFacts | null {
  if (!isPlainObject(raw)) return null;
  return parsePullRequestObject(raw);
}

/** Mesmo fato, a partir de `gh pr list --json ... --limit 1` (ARRAY, quando o número do PR ainda não é conhecido e a busca é por branch — ver `pr-list-by-head` em github-reader.ts). Lista vazia = nenhum PR encontrado pro head buscado, `null`, nunca lança. */
export function parsePullRequestList(raw: unknown): PhasePullRequestFacts | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return parsePullRequest(raw[0]);
}

/**
 * CA-5 — a ponte entre CA-4 (disco: `plano-result.json` já lido por
 * do manifesto) e CA-3 (GitHub): "o app acha a spec-issue por
 * `outputs.spec_issue`". Shape esperado é o do contrato §D.3 (`{repo,
 * number, id, node_id, url}`); só `repo`+`number` interessam pra endereçar a
 * leitura no `gh`. `null` quando o plano ainda não gravou spec-issue (fase
 * discovery, ou plano falhou antes de criar a issue) — nunca fabrica ref
 * parcial (repo sem number, ou vice-versa).
 */
export function extractSpecIssueRef(planoOutputs: unknown): SpecIssueRef | null {
  if (!isPlainObject(planoOutputs)) return null;
  const specIssue = planoOutputs.spec_issue;
  if (!isPlainObject(specIssue)) return null;
  if (typeof specIssue.repo !== 'string' || !specIssue.repo) return null;
  if (typeof specIssue.number !== 'number') return null;

  return { repo: specIssue.repo, number: specIssue.number };
}
