import { readFileSync } from 'node:fs';
import { checkGhAvailability, readBranchPullRequestStatus, readUnresolvedThreadCount } from './github-reader';
import {
  httpsUrlOrNull,
  parsePullRequestStatus,
  parseUnresolvedThreadCount,
  repoFromPullRequestUrl,
  type PullRequestStatus,
} from '../shared/pullRequestStatus';
import type { PullRequestRequestOptions, PullRequestStatusResult } from '../shared/workspace';

// B3 — o PR da branch atual de cada pasta da sidebar, com checks e reviews.
// Leitura só pelo `gh` (github-reader.ts, allowlist); o app nunca vê token.
//
// Quando ler é decisão do renderer (foco da janela, troca de projeto, polling
// de 90 s só com check rodando — `usePullRequests.ts`). Aqui fica o que impede
// martelar o `gh`: cache curto por pasta+branch (inclusive do "não tem PR"),
// uma leitura em voo por chave (sessão e favorito da mesma pasta pedem juntos)
// e o `gh` ausente/deslogado memoizado — sem `gh`, nada aparece e nada spawna.

/** Cache do PR de uma pasta+branch. Menor que o polling (90 s) para o polling sempre ler fresco. */
export const PR_STATUS_TTL_MS = 30_000;

export interface PullRequestStatusDeps {
  /** Branch atual da pasta (o mesmo leitor da sidebar, com o cache dele); `null` = sem git, HEAD destacado ou pasta inválida. */
  readonly gitBranch: (path: unknown) => Promise<string | null>;
  /** `gh` instalado e logado (memoizado no github-reader). */
  readonly ghAvailable: () => Promise<boolean>;
  readonly readPullRequest: (cwd: string, branch: string) => Promise<PullRequestStatus | null>;
  readonly readUnresolvedThreads: (repo: { readonly owner: string; readonly name: string }, number: number) => Promise<number | null>;
  readonly now: () => number;
}

export interface PullRequestStatusService {
  get(path: unknown, options?: PullRequestRequestOptions): Promise<PullRequestStatusResult>;
}

interface Entry<T> {
  readonly at: number;
  readonly value: Promise<T>;
}

export function createPullRequestStatusService(deps: PullRequestStatusDeps): PullRequestStatusService {
  const prCache = new Map<string, Entry<PullRequestStatus | null>>();
  const threadCache = new Map<string, Entry<number | null>>();

  const fresh = <T>(cache: Map<string, Entry<T>>, key: string, read: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < PR_STATUS_TTL_MS) return hit.value;
    // Falha de leitura vira `null` e fica no cache pelo TTL: sem rajada de retry.
    const value = read().catch(() => null as T);
    cache.set(key, { at: deps.now(), value });
    return value;
  };

  return {
    async get(path, options) {
      if (typeof path !== 'string') return { pr: null };
      const branch = await deps.gitBranch(path);
      if (!branch) return { pr: null };
      if (!(await deps.ghAvailable())) return { pr: null };

      const pr = await fresh(prCache, `${path}\n${branch}`, () => deps.readPullRequest(path, branch));
      if (!pr || !options?.details) return { pr };

      const repo = repoFromPullRequestUrl(pr.url);
      if (!repo) return { pr };
      const unresolvedThreads = await fresh(threadCache, `${repo.owner}/${repo.name}#${pr.number}`, () => deps.readUnresolvedThreads(repo, pr.number));
      return { pr: { ...pr, unresolvedThreads } };
    },
  };
}

/** Só `https:` vai para `shell.openExternal` (link do PR e dos jobs). Devolve se abriu. */
export async function openPullRequestUrl(url: unknown, openExternal: (url: string) => Promise<void>): Promise<boolean> {
  const safe = httpsUrlOrNull(url);
  if (!safe) return false;
  try {
    await openExternal(safe);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ dependências reais

/**
 * SEAM DE TESTE (mesmo espírito de `DONEL_CLAUDE_EXECUTABLE_FIXTURE`): aponta
 * para um JSON `{ "pullRequest": <saída de gh pr view --json>, "reviewThreads":
 * <saída da consulta GraphQL> }`. Com ele o app não spawna `gh` nenhum: toda
 * pasta numa branch vê esse PR, passando pelos MESMOS parsers da leitura real.
 */
export const PR_FIXTURE_ENV_VAR = 'DONEL_GH_PR_FIXTURE';

function fixtureDeps(fixturePath: string): Pick<PullRequestStatusDeps, 'ghAvailable' | 'readPullRequest' | 'readUnresolvedThreads'> {
  const read = (): { pullRequest?: unknown; reviewThreads?: unknown } => {
    try {
      return JSON.parse(readFileSync(fixturePath, 'utf8')) as { pullRequest?: unknown; reviewThreads?: unknown };
    } catch {
      return {};
    }
  };
  return {
    ghAvailable: async () => true,
    readPullRequest: async () => parsePullRequestStatus(read().pullRequest),
    readUnresolvedThreads: async () => parseUnresolvedThreadCount(read().reviewThreads),
  };
}

export function createSystemPullRequestStatusDeps(
  gitBranch: PullRequestStatusDeps['gitBranch'],
  env: NodeJS.ProcessEnv = process.env,
): PullRequestStatusDeps {
  const fixturePath = env[PR_FIXTURE_ENV_VAR];
  const sources = fixturePath
    ? fixtureDeps(fixturePath)
    : {
        ghAvailable: async () => (await checkGhAvailability()).available,
        readPullRequest: (cwd: string, branch: string) => readBranchPullRequestStatus(cwd, branch),
        readUnresolvedThreads: (repo: { readonly owner: string; readonly name: string }, number: number) => readUnresolvedThreadCount(repo, number),
      };
  return { gitBranch, now: () => Date.now(), ...sources };
}
