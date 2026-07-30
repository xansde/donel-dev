import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  mergeRepoEntry,
  readProjectBinding,
  readRepoBoard,
  readRepoGithub,
  readRepoGithubExtra,
  type ProjectBindingDto,
} from '../shared/projectBinding';

// CA-23 (009-modo-dev-v3, lote 3) — encanamento de disco da engrenagem de
// configuração por projeto: os dois JSONs externos que hoje só as SKILLS da
// esteira liam (`~/.claude/esteira-config/donel-board-credential.json` e
// `repos.json`, contrato v3 §D.0-bis/§I) e que eram editados à mão, fora do
// app (spec.md problema 8). A lógica de merge é PURA
// (src/shared/projectBinding.ts, testada sem fs); este módulo só resolve
// paths (com override de ambiente pro smoke, mesmo padrão de
// `DONEL_ESTEIRA_STATE_ROOT`/`DONEL_DEVMODE_BOARD_FIXTURE`) e faz a escrita
// ATÔMICA (mesmo padrão temp+rename+fsync de `config-store.ts`
// `writeFileText`/`writeAppConfig`).
//
// REGRA DURA: nunca lê/loga `token`/`baseUrl` da credencial — só passa o
// texto cru pro merge PURO, que preserva esses campos sem os inspecionar.

/** Isola o smoke do `~/.claude/esteira-config` REAL da máquina (mesmo espírito de `DONEL_ESTEIRA_STATE_ROOT`/`DONEL_DEVMODE_BOARD_FIXTURE`). */
export const ESTEIRA_CONFIG_DIR_ENV_VAR = 'DONEL_ESTEIRA_CONFIG_DIR';

/** `env`/`homedirFn` injetados (mesmo padrão de `resolveBoardReader`) — testável sem depender do processo real. */
export function esteiraConfigDir(env: Record<string, string | undefined>, homedirFn: () => string): string {
  const override = env[ESTEIRA_CONFIG_DIR_ENV_VAR];
  return override && override.trim() ? override : join(homedirFn(), '.claude', 'esteira-config');
}

export function boardCredentialPath(dir: string): string {
  return join(dir, 'donel-board-credential.json');
}

export function reposConfigPath(dir: string): string {
  return join(dir, 'repos.json');
}

/** Mesmo contrato de `ConfigIoDeps` (config-store.ts) — injetável pra testar sem fs real. */
export interface EsteiraConfigIoDeps {
  existsSync: (path: string) => boolean;
  /** `null` = ausente/ilegível — nunca lança. */
  readFileText: (path: string) => string | null;
  writeFileText: (path: string, content: string) => void;
  renameFile: (fromPath: string, toPath: string) => void;
  mkdirSync: (path: string) => void;
  unlinkFile: (path: string) => void;
}

export function createSystemEsteiraConfigIoDeps(): EsteiraConfigIoDeps {
  return {
    existsSync,
    readFileText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    // Mesma garantia de `config-store.ts createSystemConfigIoDeps.writeFileText`:
    // fsync do arquivo temp antes do rename (durável contra power-loss), rename
    // atômico (nunca um JSON truncado pra quem lê no meio da escrita).
    writeFileText: (path, content) => {
      const fd = openSync(path, 'w');
      try {
        writeSync(fd, content, null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    renameFile: (fromPath, toPath) => renameSync(fromPath, toPath),
    mkdirSync: (path) => mkdirSync(path, { recursive: true }),
    unlinkFile: (path) => {
      try {
        unlinkSync(path);
      } catch {
        // best-effort — mesmo espírito de config-store.ts.
      }
    },
  };
}

/** Escrita atômica (temp + rename + fsync) — mesmo padrão de `writeAppConfig` (config-store.ts). */
function writeJsonAtomic(filePath: string, data: Record<string, unknown>, io: EsteiraConfigIoDeps): void {
  const dir = dirname(filePath);
  if (!io.existsSync(dir)) io.mkdirSync(dir);

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  io.writeFileText(tmpPath, JSON.stringify(data, null, 2));
  try {
    io.renameFile(tmpPath, filePath);
  } catch (error) {
    io.unlinkFile(tmpPath);
    throw error;
  }
}

/** O que a engrenagem lê ao abrir — degrada por omissão (arquivo ausente/corrompido = campos vazios, nunca erro na tela). */
export function readProjectBindingFromDisk(dir: string, repoSlug: string, io: EsteiraConfigIoDeps): ProjectBindingDto {
  const boardText = io.readFileText(boardCredentialPath(dir));
  const reposText = io.readFileText(reposConfigPath(dir));
  return readProjectBinding(boardText, reposText, repoSlug);
}

export interface SaveProjectBindingInput {
  readonly workspaceId: string;
  readonly teamId: string;
  readonly github: string;
  /** Repos ADITIVOS além do principal (`github`) — grava em `repos.<repoSlug>.github_extra`, contrato §I ignora esse campo. */
  readonly githubExtra: readonly string[];
}

/**
 * Grava repo (principal + aditivos) e board NUM SÓ ARQUIVO — `repos.json`
 * (`repos.<repoSlug>.{github,github_extra,board}`), decisão do orquestrador
 * (frente 2, rodada de feedback 30/07, item 1): "board é POR PROJETO agora".
 * `donel-board-credential.json` deixa de ser escrito por este caminho — ele
 * continua existindo como fallback GLOBAL só-leitura (`readProjectBinding`
 * cai pra lá quando o projeto não tem board próprio) e como único lugar do
 * `token`/`baseUrl` (regra dura, nunca tocada aqui). `repos.json` só é
 * REESCRITO se algo relevante de fato mudou (mesma preservação byte a byte
 * de antes). Devolve o estado persistido, derivado do merge em memória — sem
 * reler o `repos.json` do disco (o `donel-board-credential.json` É relido,
 * pro fallback global entrar no DTO devolvido).
 */
export function saveProjectBindingToDisk(
  dir: string,
  repoSlug: string,
  repoPath: string,
  next: SaveProjectBindingInput,
  io: EsteiraConfigIoDeps,
): ProjectBindingDto {
  const workspaceId = next.workspaceId.trim();
  const teamId = next.teamId.trim();
  const github = next.github.trim();
  const githubExtra = next.githubExtra.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  const reposPath = reposConfigPath(dir);
  const reposText = io.readFileText(reposPath);
  const currentGithub = readRepoGithub(reposText, repoSlug);
  const currentGithubExtra = readRepoGithubExtra(reposText, repoSlug);
  const currentBoard = readRepoBoard(reposText, repoSlug);

  const githubChanged = currentGithub !== (github || null);
  const githubExtraChanged = JSON.stringify(currentGithubExtra) !== JSON.stringify(githubExtra);
  const boardChanged = currentBoard.workspaceId !== (workspaceId || null) || currentBoard.teamId !== (teamId || null);

  let finalReposText = reposText;
  if (githubChanged || githubExtraChanged || boardChanged) {
    const merged = mergeRepoEntry(reposText, { repoSlug, repoPath, github, githubExtra, workspaceId, teamId });
    writeJsonAtomic(reposPath, merged, io);
    finalReposText = JSON.stringify(merged);
  }

  const boardText = io.readFileText(boardCredentialPath(dir));
  return readProjectBinding(boardText, finalReposText, repoSlug);
}
