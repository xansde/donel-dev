import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProjectFolderName, type CreateProjectResult } from '../shared/newProject';

// CA-30 (009-modo-dev-v3, lote 9) — "lancar um projeto do zero pelo app"
// (US-15 do backlog.md, problema 10 do spec.md). Encanamento de disco de
// verdade: mkdir do diretorio + marcador `CLAUDE.md` (garante que o projeto
// aparece na lista mesmo sem git instalado — `scanProjects` exige `.git` OU
// `CLAUDE.md`) + `git init` BEST-EFFORT (mesmo padrao de I/O de
// github-reader.ts: spawn com timeout, nunca lanca, git ausente/falho/lento
// degrada por omissao — C4 — sem derrubar a criacao do projeto em si).
//
// Seguranca (path traversal / sobrescrita): o nome ja chega validado por
// `validateProjectFolderName` (shared/newProject.ts) — sem separador de
// caminho, sem `..`, sem caractere invalido no Windows — e o `root` precisa
// ser EXATAMENTE um dos `allowedRoots` (nunca um caminho digitado livre).
// `join(root, name)` de um segmento sem separadores nunca escapa do root;
// `existsSync` e checado ANTES do mkdir para nunca reusar/sobrescrever uma
// pasta existente.

export interface CreateProjectDeps {
  readonly existsSync: (path: string) => boolean;
  readonly mkdirSync: (path: string) => void;
  readonly writeClaudeMdSeed: (path: string, name: string) => void;
  /** Injetavel pra teste — `createNewProject` nunca importa `spawn` fora daqui. */
  readonly spawnFn?: typeof spawn;
}

const GIT_INIT_TIMEOUT_MS = 8_000; // mesmo teto de quota-headroom.ts/github-reader.ts — nunca trava o main process.

/**
 * `git init` best-effort no diretorio recem-criado. NUNCA lanca: ENOENT
 * sincrono (git nao instalado), evento `error` do child, timeout e exit != 0
 * viram `false` — a criacao do projeto em si ja aconteceu (mkdir + marcador),
 * git e só um extra.
 */
function runGitInit(cwd: string, spawnFn: typeof spawn): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn('git', ['init'], { cwd, windowsHide: true });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, GIT_INIT_TIMEOUT_MS);

    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

/**
 * Cria o projeto novo (CA-30): valida nome + root, mkdir, escreve o marcador
 * `CLAUDE.md`, tenta `git init` (best-effort). `allowedRoots` e SEMPRE
 * `appConfig.projectRoots` do chamador — nunca uma lista vinda do renderer.
 */
export async function createNewProject(
  input: { readonly name: string; readonly root: string },
  allowedRoots: readonly string[],
  deps: CreateProjectDeps,
): Promise<CreateProjectResult> {
  const nameResult = validateProjectFolderName(input.name);
  if (!nameResult.ok) {
    return { ok: false, reason: nameResult.reason };
  }

  if (!allowedRoots.includes(input.root)) {
    return { ok: false, reason: 'invalid-root' };
  }

  const path = join(input.root, nameResult.name);
  if (deps.existsSync(path)) {
    return { ok: false, reason: 'already-exists' };
  }

  try {
    deps.mkdirSync(path);
  } catch {
    return { ok: false, reason: 'mkdir-failed' };
  }

  // Marcador garantido independente do git — e ele que faz o projeto
  // aparecer na lista (`hasProjectMarker`, project-scanner.ts) mesmo em
  // `scanMode: 'markers'` (default) e mesmo se `git` nao estiver instalado.
  deps.writeClaudeMdSeed(path, nameResult.name);

  const gitInitialized = await runGitInit(path, deps.spawnFn ?? spawn);

  return { ok: true, path, name: nameResult.name, gitInitialized };
}

const CLAUDE_MD_SEED_TEMPLATE = (name: string): string => `# ${name}\n\nProjeto criado pelo Donel Dev.\n`;

/** Dependencias reais (filesystem/processo da maquina) — so o main process usa. */
export function createSystemCreateProjectDeps(): CreateProjectDeps {
  return {
    existsSync,
    mkdirSync: (path) => mkdirSync(path, { recursive: true }),
    writeClaudeMdSeed: (path, name) => writeFileSync(join(path, 'CLAUDE.md'), CLAUDE_MD_SEED_TEMPLATE(name), 'utf8'),
  };
}
