// CA-3/CA-5 (009-modo-dev-v3, lote 4) — canal IPC do GitHub reader
// (src/main/github-reader.ts). Espelho serializável de `GhReadCommand`
// (mesmo formato, discriminado por `kind`) — vive em shared/ (não em main/)
// pra o renderer conseguir montar um pedido válido sem importar código de
// main process; a MESMA garantia de allowlist (achado 13) se aplica aqui: um
// `kind` fora da união falha em `npm run typecheck` no renderer também.
//
// Nenhum canal aqui escreve em GitHub — só leitura (invariante 5/CA-19,
// mesmo espírito de PROJECT_BINDING_CHANNELS).

export const GITHUB_CHANNELS = {
  read: 'github:read',
  checkAvailability: 'github:checkAvailability',
} as const;

export type GithubReadRequest =
  | { readonly kind: 'spec-issue'; readonly repo: string; readonly number: number }
  | { readonly kind: 'sub-issues'; readonly repo: string; readonly number: number }
  | { readonly kind: 'phase-pull-request'; readonly repo: string; readonly number?: number | null; readonly head?: string | null };

/**
 * `status: 'unavailable'` cobre TODA degradação (gh ausente, não
 * autenticado, comando falhou, JSON malformado) — o renderer não precisa (e
 * não deve) distinguir a causa pra decidir o que mostrar (CA-6: degrada por
 * omissão, nunca fabrica). `data` é `unknown` no canal — o tipo concreto por
 * `kind` é responsabilidade de quem consome (mesmo padrão de `BoardFacts`
 * vindo tipado do main, mas aqui o shape muda por `kind`; ver
 * `src/shared/githubFacts.ts` pros tipos `SpecIssueFacts`/`SubIssueFacts[]`/
 * `PhasePullRequestFacts` que o main devolve dentro de `data`).
 */
export type GithubReadResponse = { readonly status: 'ok'; readonly data: unknown } | { readonly status: 'unavailable' };

export interface GhAvailabilityDto {
  readonly available: boolean;
  readonly reason: 'not_installed' | 'not_authenticated' | null;
}

/** Guarda defensiva de payload IPC — mesmo espírito de `isValidSaveProjectBindingIpcInput` (projectBinding.ts): o main nunca confia cegamente no que o renderer manda. */
export function isValidGithubReadRequest(input: unknown): input is GithubReadRequest {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.repo !== 'string' || !candidate.repo.trim()) return false;

  switch (candidate.kind) {
    case 'spec-issue':
    case 'sub-issues':
      return typeof candidate.number === 'number';
    case 'phase-pull-request':
      return (
        (candidate.number === undefined || candidate.number === null || typeof candidate.number === 'number') &&
        (candidate.head === undefined || candidate.head === null || typeof candidate.head === 'string')
      );
    default:
      return false;
  }
}

/**
 * API tipada exposta pelo preload em `window.donel.github`. `read` cobre os
 * 3 fatos do CA-3 (spec-issue/sub-issues/PR da fase); `checkAvailability` é
 * a degradação visível standalone (CA-6) pra UI que quiser mostrar "GitHub
 * indisponível" sem precisar de um `read` em mãos primeiro.
 */
export interface DonelGithubApi {
  read(request: GithubReadRequest): Promise<GithubReadResponse>;
  checkAvailability(): Promise<GhAvailabilityDto>;
}
