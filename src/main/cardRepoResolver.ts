import { basename, join } from 'node:path';
import type { RepoEntry } from '../shared/projectBinding';

// Issue #34 (P0) — a fase disparava no repo EM FOCO na sidebar em vez do
// repo-alvo do card (achado real: card do board AGENTESUPO com repo-alvo
// `dalton` abriu a sessão em `spotsys`). Raiz: `App.tsx` usava
// `activeBoardRepoPath` (o repo do DROPDOWN de board) como se fosse o repo do
// card, e caía num fallback silencioso pro projeto em foco quando o dropdown
// vinha vazio. `repos.json` pode ter DOIS repos com o MESMO board
// (`workspaceId`+`teamId`) — "board → repo" é ambíguo nesse caso, e o app
// resolvia sempre para o `default_repo`.
//
// Este módulo decide, de forma DETERMINÍSTICA e por CARD (nunca por board em
// foco): o rastro em disco é a fonte de verdade — se o card já tem estado
// gravado (raiz v3 `esteira-state/<repoSlug>/<cardId>/`, ou o legado
// `<repoPath>/.esteira/discovery/<cardId>-ctx.md`) em QUALQUER repo
// conhecido, o repo é AQUELE, sem opinião do board. Sem rastro nenhum, cai
// para o board escolhido — que só resolve sozinho se ele for dono de UM único
// repo; dois ou mais repos com o mesmo board viram pergunta (`ambiguous`),
// nunca um palpite.
//
// Puro/testável sem Electron: `existsSync` é injetado (mesmo padrão de
// `esteira-config.ts`).

export interface CardRepoResolverIoDeps {
  existsSync: (path: string) => boolean;
}

export interface RepoCandidate {
  readonly repoSlug: string;
  readonly repoPath: string;
}

export type CardRepoResolution =
  | { readonly kind: 'resolved'; readonly repoPath: string; readonly repoSlug: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly RepoCandidate[] }
  | { readonly kind: 'unknown' };

export interface ResolveCardRepoInput {
  readonly cardId: string;
  /** Raiz v3 do handoff (`~/.claude/esteira-state`) — onde a esteira 2.x arquiva. */
  readonly esteiraStateRoot: string;
  /** TODOS os repos conhecidos (`readAllRepoEntries`, `shared/projectBinding.ts`) — a lista inteira, nunca só o repo em foco. */
  readonly repos: readonly RepoEntry[];
  /** O repo por trás do dropdown "Board" do modal — só usado como ÚLTIMO recurso, sem rastro em disco nenhum. `null` sem board selecionado. */
  readonly boardRepoPath: string | null;
}

/** Issue #38 — mesmo input de `resolveCardRepo`, mas para VÁRIOS cards de uma vez (a lista inteira da porta de entrada). */
export interface ResolveCardReposInput {
  readonly cardIds: readonly string[];
  readonly esteiraStateRoot: string;
  readonly repos: readonly RepoEntry[];
  readonly boardRepoPath: string | null;
}

function candidateOf(repo: RepoEntry): RepoCandidate {
  return { repoSlug: repo.repoSlug, repoPath: repo.repoPath };
}

/** Rastro em disco de UM card, em UM repo — raiz v3 (diretório do card sob `esteira-state/<repoSlug>/`) OU o handoff legado dentro do próprio checkout. */
function hasDiskTrace(repo: RepoEntry, cardId: string, esteiraStateRoot: string, io: CardRepoResolverIoDeps): boolean {
  const v3Dir = join(esteiraStateRoot, repo.repoSlug, cardId);
  if (io.existsSync(v3Dir)) return true;

  const legacyCtx = join(repo.repoPath, '.esteira', 'discovery', `${cardId}-ctx.md`);
  return io.existsSync(legacyCtx);
}

/**
 * `input.repos` vem de `repos.json` — um projeto pode estar selecionado no
 * dropdown "Board" sem NUNCA ter sido registrado ali (bootstrap, "nenhum
 * board configurado" — `DevModeEntry.tsx` lista o catálogo inteiro de
 * projetos nesse caso). Sem essa entrada sintética, um clique nesse projeto
 * viraria `unknown` mesmo sendo uma escolha explícita e sem ambiguidade
 * nenhuma para checar — a lista de candidatos SEMPRE inclui o repo do
 * dropdown, mesmo desconhecido de `repos.json` (`workspaceId`/`teamId`
 * `null`, igual a qualquer repo sem board próprio).
 */
function allCandidateRepos(input: ResolveCardRepoInput): readonly RepoEntry[] {
  if (!input.boardRepoPath) return input.repos;
  const slug = basename(input.boardRepoPath);
  if (input.repos.some((repo) => repo.repoSlug === slug)) return input.repos;
  return [...input.repos, { repoSlug: slug, repoPath: input.boardRepoPath, workspaceId: null, teamId: null }];
}

/**
 * A decisão inteira (issue #34): rastro em disco vence sempre, mesmo com
 * outro repo em foco na sidebar; sem rastro, o board decide SE for dono de
 * um repo só (ou se o repo escolhido não tem board próprio nenhum — nesse
 * caso não há o que desambiguar, a escolha do dropdown já é explícita); dois+
 * repos (rastro OU board) nunca colapsam num palpite — viram `ambiguous`, e a
 * UI pergunta.
 */
export function resolveCardRepo(input: ResolveCardRepoInput, io: CardRepoResolverIoDeps): CardRepoResolution {
  const repos = allCandidateRepos(input);

  const withTrace = repos.filter((repo) => hasDiskTrace(repo, input.cardId, input.esteiraStateRoot, io));
  if (withTrace.length === 1) {
    const repo = withTrace[0];
    return { kind: 'resolved', repoPath: repo.repoPath, repoSlug: repo.repoSlug };
  }
  if (withTrace.length > 1) {
    return { kind: 'ambiguous', candidates: withTrace.map(candidateOf) };
  }

  if (!input.boardRepoPath) return { kind: 'unknown' };
  const boardRepo = repos.find((repo) => repo.repoSlug === basename(input.boardRepoPath as string));
  if (!boardRepo) return { kind: 'unknown' };

  // Repo sem board próprio configurado: nada compartilha nada com ele —
  // a escolha do dropdown já é a resposta, sem ambiguidade a checar.
  if (!boardRepo.workspaceId || !boardRepo.teamId) {
    return { kind: 'resolved', repoPath: boardRepo.repoPath, repoSlug: boardRepo.repoSlug };
  }

  const sameBoard = repos.filter((repo) => repo.workspaceId === boardRepo.workspaceId && repo.teamId === boardRepo.teamId);
  if (sameBoard.length === 1) {
    const repo = sameBoard[0];
    return { kind: 'resolved', repoPath: repo.repoPath, repoSlug: repo.repoSlug };
  }
  if (sameBoard.length > 1) {
    return { kind: 'ambiguous', candidates: sameBoard.map(candidateOf) };
  }

  return { kind: 'unknown' };
}

/**
 * Issue #38 — a lista da porta de entrada tem dezenas de cards; um
 * `devMode:resolveCardRepo` por LINHA (dentro do loop de render) seria uma
 * rodada de IPC por card. Este é o mesmo `resolveCardRepo`, só que chamado
 * uma vez por card DENTRO de uma única invocação de main (um IPC, uma leitura
 * de `repos.json`) — o consumidor (`devMode:resolveCardRepos`, plural, em
 * `main/index.ts`) devolve um mapa `cardId -> CardRepoResolution` pronto pra
 * lista inteira.
 */
export function resolveCardRepos(input: ResolveCardReposInput, io: CardRepoResolverIoDeps): Record<string, CardRepoResolution> {
  const result: Record<string, CardRepoResolution> = {};
  for (const cardId of input.cardIds) {
    result[cardId] = resolveCardRepo(
      { cardId, esteiraStateRoot: input.esteiraStateRoot, repos: input.repos, boardRepoPath: input.boardRepoPath },
      io,
    );
  }
  return result;
}
