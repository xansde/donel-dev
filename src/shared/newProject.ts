// CA-30 (009-modo-dev-v3, lote 9) - "lancar um projeto do zero pelo app"
// (US-15 do backlog.md, problema 10 do spec.md). Logica PURA de validacao do
// nome da pasta do projeto novo - mesmo espirito de projects.ts/
// transcriptCopy.ts: sem `node:fs`/`node:path` aqui, pra continuar seguro de
// importar do RENDERER (o formulario "Novo projeto" valida antes de mandar o
// IPC). O encanamento de disco de verdade (mkdir, seed do marcador
// CLAUDE.md, `git init` best-effort) vive em src/main/project-creator.ts -
// so ele importa `node:fs`/`node:path`/`node:child_process`.
//
// Design: a pasta final e SEMPRE `join(root, name)`, com `root` restrito a
// um dos `projectRoots` ja configurados (nunca um caminho digitado livre) e
// `name` validado para nunca conter separador de caminho nem `..` - ou seja,
// a contencao dentro do root e garantida POR CONSTRUCAO (join de um segmento
// sem separadores nunca escapa do root), sem precisar resolver `..`/links
// simbolicos a mao. Decisao nomeada no report do lote.

const MAX_PROJECT_NAME_LENGTH = 100;

/** Caracteres invalidos em nome de arquivo/pasta no Windows + separadores de caminho (o nome e sempre UM segmento) + caracteres de controle. Espaco e hifen sao validos. */
const FORBIDDEN_NAME_CHAR_CODES = new Set<number>([
  60, // <
  62, // >
  58, // :
  34, // "
  47, // /
  92, // \
  124, // |
  63, // ?
  42, // *
]);

function hasInvalidChar(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code <= 31) return true; // caracteres de controle
    if (FORBIDDEN_NAME_CHAR_CODES.has(code)) return true;
  }
  return false;
}

/** Nomes reservados pelo Windows (case-insensitive, comparacao EXATA - "console" nao e "CON"). */
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

export type ProjectFolderNameErrorReason = 'empty' | 'invalid-chars' | 'reserved-name' | 'too-long';

export type ProjectFolderNameValidation =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: ProjectFolderNameErrorReason };

/**
 * Valida o NOME da pasta do projeto novo (CA-30) - sem path traversal
 * (`.`/`..`/separadores), sem caractere invalido no Windows, sem nome
 * reservado do device (CON/PRN/AUX/NUL/COM1-9/LPT1-9), sem terminar em ponto
 * (Windows trunca silenciosamente). Nunca toca disco - so string.
 */
export function validateProjectFolderName(rawName: string): ProjectFolderNameValidation {
  const name = rawName.trim();

  if (!name) return { ok: false, reason: 'empty' };
  if (name === '.' || name === '..') return { ok: false, reason: 'invalid-chars' };
  if (hasInvalidChar(name)) return { ok: false, reason: 'invalid-chars' };
  if (name.endsWith('.')) return { ok: false, reason: 'invalid-chars' };
  if (RESERVED_WINDOWS_NAMES.has(name.toUpperCase())) return { ok: false, reason: 'reserved-name' };
  if (name.length > MAX_PROJECT_NAME_LENGTH) return { ok: false, reason: 'too-long' };

  return { ok: true, name };
}

/** Canal IPC de criacao - some ao lado de `PROJECT_CHANNELS.list`/`.favorite` em src/shared/projects.ts. */
export const NEW_PROJECT_CHANNEL = 'projects:create' as const;

/** Modo de origem do codigo do projeto novo (Select "De onde vem o codigo", `SOURCE_OPTIONS` em ProjectSwitcher.tsx). `'local'` (pasta existente) fica fora do escopo de #31 — so 'vazio'/'clone' tem encanamento real. */
export type ProjectSourceMode = 'vazio' | 'clone';

/**
 * Payload que o formulario "Novo projeto" manda: nome cru (validado dos dois
 * lados) + root ESCOLHIDO entre os ja configurados (nunca um caminho livre).
 * FIX (#31) — `source`/`cloneUrl` sao ADITIVOS e OPCIONAIS (compatibilidade
 * com quem ja chamava sem eles): payload sem `source` vira `'vazio'` por
 * omissao em `createNewProject` (main/project-creator.ts). `cloneUrl` so e
 * exigido (guarda abaixo) quando `source === 'clone'` — ja deve chegar
 * resolvido pro formato que o `git clone` aceita (`resolveGithubCloneUrl`,
 * este arquivo), o renderer computa a partir do mesmo campo "Repositorio
 * GitHub" que #32 corrigiu (o valor tambem vira `repos.<slug>.github`).
 */
export interface CreateProjectIpcInput {
  readonly name: string;
  readonly root: string;
  readonly source?: ProjectSourceMode;
  readonly cloneUrl?: string;
}

/** Guarda defensiva de payload IPC - mesmo espirito de `isValidSaveProjectBindingIpcInput` (projectBinding.ts): o main nunca confia cegamente no que o renderer manda. */
export function isValidCreateProjectIpcInput(input: unknown): input is CreateProjectIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<CreateProjectIpcInput>;
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) return false;
  if (typeof candidate.root !== 'string' || candidate.root.trim().length === 0) return false;

  if (candidate.source !== undefined && candidate.source !== 'vazio' && candidate.source !== 'clone') return false;
  if (candidate.source === 'clone') {
    if (typeof candidate.cloneUrl !== 'string' || candidate.cloneUrl.trim().length === 0) return false;
  }

  return true;
}

/**
 * FIX (#31) — o campo "Repositorio GitHub" (ProjectConfigForm.tsx, #32)
 * aceita tanto o shorthand `org/repo` (contrato `repos.json` §I) quanto uma
 * URL ja completa. `git clone` so entende URL/scp-syntax — o shorthand sem
 * `:` seria tratado como PATH LOCAL relativo (git falharia com um erro
 * confuso). Aqui: se o valor ja parece uma URL/scp-syntax (tem um esquema
 * conhecido ou o padrao `usuario@host:`), passa direto; senao, assume
 * shorthand `org/repo` e compoe a URL https do GitHub (mesmo host que o
 * contrato de `repos.json` sempre assumiu implicitamente).
 */
const CLONABLE_URL_PATTERN = /^(https?:\/\/|ssh:\/\/|git:\/\/|[^/\s]+@[^/\s]+:)/i;

export function resolveGithubCloneUrl(rawRepoRef: string): string {
  const trimmed = rawRepoRef.trim();
  if (CLONABLE_URL_PATTERN.test(trimmed)) return trimmed;
  return `https://github.com/${trimmed}.git`;
}

export type CreateProjectErrorReason =
  | ProjectFolderNameErrorReason
  | 'invalid-root'
  | 'already-exists'
  | 'mkdir-failed'
  | 'clone-url-empty'
  | 'clone-failed';

/**
 * Resultado da criacao (src/main/project-creator.ts `createNewProject`).
 * `gitInitialized: false` e degradacao por omissao (C4) - `git` ausente/falho
 * nunca derruba a criacao em si no modo 'vazio' (o marcador `CLAUDE.md` ja
 * garante que o projeto aparece na lista). FIX (#31) — `clone-failed` e o
 * UNICO motivo com mensagem DINAMICA (`message`): ao contrario do resto
 * (nome invalido, root fora da allowlist, etc — sempre o MESMO texto fixo em
 * pt-BR), falha de clone precisa mostrar o que o `git` de fato disse (URL
 * invalida, sem auth, rede fora) — nunca degrada em silencio como o
 * `git init` do modo 'vazio' degrada.
 */
export type CreateProjectResult =
  | { readonly ok: true; readonly path: string; readonly name: string; readonly gitInitialized: boolean }
  | { readonly ok: false; readonly reason: Exclude<CreateProjectErrorReason, 'clone-failed'> }
  | { readonly ok: false; readonly reason: 'clone-failed'; readonly message: string };

/** O que o handler `projects:create` devolve - resultado + lista de projetos JA atualizada (evita round-trip extra, mesmo idioma de `projects:favorite`). Mesmo shape mutável de `DonelProjectsApi.list()` (ProjectInfo[]) — os consumidores do renderer passam isso direto pro `setProjects` do App.tsx. */
export interface CreateProjectResponse {
  readonly result: CreateProjectResult;
  readonly projects: import('./projects').ProjectInfo[];
}

/** API tipada exposta pelo preload em `window.donel.projects.create`. */
export interface DonelNewProjectApi {
  create(input: CreateProjectIpcInput): Promise<CreateProjectResponse>;
}
