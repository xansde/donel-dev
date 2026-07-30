// CA-23 (009-modo-dev-v3, lote 3) — engrenagem de configuração por projeto:
// ID do board TaskDex (`workspaceId`/`teamId`) e o repo do GitHub
// (`repos.json → repos.<repoSlug>.github`), hoje editados à mão fora do app
// (spec.md problema 8). Lógica PURA de leitura/mesclagem dos dois JSONs
// externos — nenhum fs aqui (mesmo espírito de tabAppearance.ts/devMode.ts):
// o encanamento de disco (paths reais, override de ambiente pro smoke,
// escrita atômica) vive em src/main/esteira-config.ts.
//
// REGRA DURA DE CREDENCIAL: `donel-board-credential.json`
// (`~/.claude/esteira-config/`) pode conter `token`/`baseUrl` além de
// `workspaceId`/`teamId` (contrato v3 `handoff-v3.md`). Este módulo NUNCA lê
// esses outros campos para exibição — só os preserva, intocados, em todo
// merge (nunca substituição do objeto inteiro). Mesma regra para `repos.json`
// (§I do contrato): `integration_branch`/`help_channel`/`promotion`/outros
// repos sobrevivem a qualquer merge feito aqui.

export const PROJECT_BINDING_CHANNELS = {
  get: 'projectBinding:get',
  save: 'projectBinding:save',
} as const;

/**
 * Frente 2 (rodada de feedback 30/07, item 1) — "vários repositórios GitHub" +
 * "board por projeto". O contrato do `repos.json` (`handoff-v3.md` §I) exige
 * `github` SINGULAR por entrada — não é renegociável (as skills da esteira
 * leem esse campo). Decisão do orquestrador: o PRIMEIRO repo da lista grava
 * em `github` (o campo que o contrato conhece); os demais vão num campo
 * ADITIVO `github_extra: string[]` que as skills ignoram e o merge deste
 * módulo preserva sempre. O board (`workspaceId`/`teamId`) também vira
 * ADITIVO em `repos.<repoSlug>.board` — POR PROJETO agora, em vez de só o
 * default global de `donel-board-credential.json`. A leitura (`readProjectBinding`)
 * PREFERE o board do projeto e cai pro global (`readBoardIds`, arquivo de
 * credencial) quando o projeto não tem o seu próprio — nunca os dois juntos,
 * nunca um campo pela metade (mesma regra "tudo ou nada" de `mergeBoardIds`).
 * O TOKEN da credencial nunca é lido/escrito por este módulo em lugar
 * nenhum — regra dura inalterada.
 */

/** Estado hoje conhecido pelo app para ESTE projeto. String vazia = campo ausente/não configurado — nunca `null`/`undefined` chegando à UI (C4, degradação por omissão). `githubExtra` é sempre um array (nunca ausente) — vazio é o caso comum (só um repo, ou nenhum). */
export interface ProjectBindingDto {
  readonly workspaceId: string;
  readonly teamId: string;
  readonly github: string;
  readonly githubExtra: readonly string[];
}

export interface SaveProjectBindingIpcInput {
  readonly repoPath: string;
  readonly workspaceId: string;
  readonly teamId: string;
  readonly github: string;
  readonly githubExtra: readonly string[];
}

/** Guarda defensiva de payload IPC — mesmo espírito de `isValidOpenDiscoveryIpcInput` (devMode.ts): o main nunca confia cegamente no que o renderer manda. */
export function isValidSaveProjectBindingIpcInput(input: unknown): input is SaveProjectBindingIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<SaveProjectBindingIpcInput>;
  return (
    typeof candidate.repoPath === 'string' &&
    candidate.repoPath.trim().length > 0 &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.teamId === 'string' &&
    typeof candidate.github === 'string' &&
    Array.isArray(candidate.githubExtra) &&
    candidate.githubExtra.every((entry) => typeof entry === 'string')
  );
}

/**
 * API tipada exposta pelo preload em `window.donel.projectBinding`. Nenhum
 * canal escreve em TaskDex ou GitHub — só nos dois arquivos de config locais
 * que a esteira já lia (invariante 5/CA-19 preservada: a Esteira em si
 * continua só lida; o app é DONO destes dois arquivos de config, não da
 * Esteira).
 */
export interface DonelProjectBindingApi {
  get(repoPath: string): Promise<ProjectBindingDto>;
  save(input: SaveProjectBindingIpcInput): Promise<ProjectBindingDto>;
}

// ---------------------------------------------------------------------------
// Leitura/mesclagem PURA dos dois JSONs crus (texto → objeto). Nunca lança —
// arquivo ausente/corrompido/campo de tipo errado degrada por omissão (C4),
// mesmo espírito de `sanitizeDevModeBoardConfig` (config-store.ts) e
// `toBoardFacts` (taskdex-board-client.ts).
// ---------------------------------------------------------------------------

function parseJsonObject(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `workspaceId`/`teamId` do arquivo de credencial — `null` por campo ausente/tipo errado, nunca fabricado. */
export function readBoardIds(text: string | null): { readonly workspaceId: string | null; readonly teamId: string | null } {
  const raw = parseJsonObject(text);
  return {
    workspaceId: typeof raw.workspaceId === 'string' && raw.workspaceId ? raw.workspaceId : null,
    teamId: typeof raw.teamId === 'string' && raw.teamId ? raw.teamId : null,
  };
}

/**
 * Funde `workspaceId`/`teamId` no JSON cru da credencial, preservando
 * QUALQUER outro campo (`token`, `baseUrl`, `_comentario`, futuro) intocado —
 * merge, nunca substituição. `ids.workspaceId`/`ids.teamId` já devem chegar
 * TRIMADOS. Se QUALQUER um dos dois vier vazio, os DOIS campos são REMOVIDOS
 * juntos — nunca um board pela metade (sem os dois, ele não identifica board
 * nenhum): "desligar o board" apaga os dois, nunca deixa um valor sozinho.
 */
export function mergeBoardIds(text: string | null, ids: { readonly workspaceId: string; readonly teamId: string }): Record<string, unknown> {
  const raw = parseJsonObject(text);
  const merged = { ...raw };
  if (ids.workspaceId && ids.teamId) {
    merged.workspaceId = ids.workspaceId;
    merged.teamId = ids.teamId;
  } else {
    delete merged.workspaceId;
    delete merged.teamId;
  }
  return merged;
}

/** `repos.<repoSlug>.github` — aceita a forma legada (string = só `path`, sem `github`) e a forma objeto (contrato §I). `null` = ausente. */
export function readRepoGithub(text: string | null, repoSlug: string): string | null {
  const raw = parseJsonObject(text);
  const repos = isPlainObject(raw.repos) ? raw.repos : {};
  const entry = repos[repoSlug];
  if (isPlainObject(entry) && typeof entry.github === 'string' && entry.github) return entry.github;
  return null;
}

export interface RepoGithubUpdate {
  readonly repoSlug: string;
  /** Path local do projeto — só usado se `repoSlug` ainda NÃO existir em `repos` (entrada nova precisa de `path`, único campo obrigatório do contrato §I). */
  readonly repoPath: string;
  /** Já deve chegar TRIMADO. Vazio remove o campo `github` (nunca grava string vazia — projeto sem GitHub configurado é um estado válido, C4). */
  readonly github: string;
}

/**
 * Funde `github` na entrada `repos.<repoSlug>`, preservando qualquer outro
 * campo (`integration_branch`, `help_channel`, `promotion`, futuro) e o
 * `path` já existente. Entrada em forma legada (string) vira objeto
 * `{ path, github }` — o `path` sobrevive. Entrada ausente nasce com o
 * `repoPath` do projeto (contrato §I: `path` é o único campo obrigatório).
 * `default_repo`, os demais repos e `round_limit_by_board` sobrevivem
 * intocados — só a entrada de `repoSlug` é tocada.
 */
export function mergeRepoGithub(text: string | null, update: RepoGithubUpdate): Record<string, unknown> {
  const raw = parseJsonObject(text);
  const repos = isPlainObject(raw.repos) ? { ...raw.repos } : {};
  const existing = repos[update.repoSlug];

  const existingObject: Record<string, unknown> = isPlainObject(existing)
    ? { ...existing }
    : typeof existing === 'string' && existing
      ? { path: existing }
      : { path: update.repoPath };

  if (update.github) {
    existingObject.github = update.github;
  } else {
    delete existingObject.github;
  }

  return { ...raw, repos: { ...repos, [update.repoSlug]: existingObject } };
}

/** `repos.<repoSlug>.github_extra` — repositórios ADITIVOS além do principal (`github`). `[]` por ausente/tipo errado/entradas não-string (nunca lança, C4). */
export function readRepoGithubExtra(text: string | null, repoSlug: string): string[] {
  const raw = parseJsonObject(text);
  const repos = isPlainObject(raw.repos) ? raw.repos : {};
  const entry = repos[repoSlug];
  if (!isPlainObject(entry) || !Array.isArray(entry.github_extra)) return [];
  return entry.github_extra.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** `repos.<repoSlug>.board.{workspaceId,teamId}` — board POR PROJETO (aditivo). `null` por campo ausente/tipo errado, nunca fabricado — mesma disciplina de `readBoardIds`. */
export function readRepoBoard(text: string | null, repoSlug: string): { readonly workspaceId: string | null; readonly teamId: string | null } {
  const raw = parseJsonObject(text);
  const repos = isPlainObject(raw.repos) ? raw.repos : {};
  const entry = repos[repoSlug];
  const board = isPlainObject(entry) && isPlainObject(entry.board) ? entry.board : {};
  return {
    workspaceId: typeof board.workspaceId === 'string' && board.workspaceId ? board.workspaceId : null,
    teamId: typeof board.teamId === 'string' && board.teamId ? board.teamId : null,
  };
}

export interface RepoEntryUpdate {
  readonly repoSlug: string;
  /** Path local do projeto — só usado se `repoSlug` ainda NÃO existir em `repos` (entrada nova precisa de `path`, único campo obrigatório do contrato §I). */
  readonly repoPath: string;
  /** Já deve chegar TRIMADO. Vazio remove o campo `github` (nunca grava string vazia). */
  readonly github: string;
  /** Já devem chegar TRIMADOS e sem entradas vazias. `[]` remove o campo `github_extra` (nunca grava array vazio — ausente é o estado C4). */
  readonly githubExtra: readonly string[];
  /** Já devem chegar TRIMADOS. Só grava `board` quando os DOIS vierem preenchidos — mesma regra "tudo ou nada" de `mergeBoardIds` (nunca um board pela metade). */
  readonly workspaceId: string;
  readonly teamId: string;
}

/**
 * Funde `github`/`github_extra`/`board` na entrada `repos.<repoSlug>` NUM SÓ
 * PASSO (evita reler o objeto intermediário três vezes) — preserva qualquer
 * outro campo (`integration_branch`, `help_channel`, `promotion`, futuro) e o
 * `path` já existente, mesma normalização de forma legada→objeto de
 * `mergeRepoGithub`.
 */
export function mergeRepoEntry(text: string | null, update: RepoEntryUpdate): Record<string, unknown> {
  const raw = parseJsonObject(text);
  const repos = isPlainObject(raw.repos) ? { ...raw.repos } : {};
  const existing = repos[update.repoSlug];

  const existingObject: Record<string, unknown> = isPlainObject(existing)
    ? { ...existing }
    : typeof existing === 'string' && existing
      ? { path: existing }
      : { path: update.repoPath };

  if (update.github) {
    existingObject.github = update.github;
  } else {
    delete existingObject.github;
  }

  if (update.githubExtra.length > 0) {
    existingObject.github_extra = [...update.githubExtra];
  } else {
    delete existingObject.github_extra;
  }

  if (update.workspaceId && update.teamId) {
    existingObject.board = { workspaceId: update.workspaceId, teamId: update.teamId };
  } else {
    delete existingObject.board;
  }

  return { ...raw, repos: { ...repos, [update.repoSlug]: existingObject } };
}

/**
 * Estado combinado hoje conhecido para `repoSlug`, a partir do texto cru dos
 * dois arquivos — o que a engrenagem lê ao abrir. O board PREFERE o do
 * PROJETO (`repos.<repoSlug>.board`, tudo-ou-nada); só cai pro global
 * (`donel-board-credential.json`) quando o projeto não tem os dois campos.
 */
export function readProjectBinding(boardText: string | null, reposText: string | null, repoSlug: string): ProjectBindingDto {
  const globalIds = readBoardIds(boardText);
  const projectBoard = readRepoBoard(reposText, repoSlug);
  const projectHasBoard = Boolean(projectBoard.workspaceId && projectBoard.teamId);

  const github = readRepoGithub(reposText, repoSlug);
  const githubExtra = readRepoGithubExtra(reposText, repoSlug);

  return {
    workspaceId: (projectHasBoard ? projectBoard.workspaceId : globalIds.workspaceId) ?? '',
    teamId: (projectHasBoard ? projectBoard.teamId : globalIds.teamId) ?? '',
    github: github ?? '',
    githubExtra,
  };
}
