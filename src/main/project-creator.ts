import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProjectFolderName, type CreateProjectResult, type ProjectSourceMode } from '../shared/newProject';

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
//
// FIX (#31) — "Clonar do GitHub" nao clonava de verdade: a opcao so existia
// no Select, desabilitada com uma nota. Modo `source: 'clone'` acrescenta
// `git clone <url> .` na pasta ja criada — ao CONTRARIO do `git init` do modo
// 'vazio' (best-effort, nunca derruba a criacao), aqui o clone E o proprio
// proposito da operacao: falhar precisa aparecer com mensagem legivel (nunca
// degradar em silencio) e nunca deixar a pasta pela metade — se o clone falha
// depois do mkdir, o diretorio criado NESTA operacao e removido (best-effort;
// se a limpeza tambem falhar, a mensagem de erro diz o que sobrou). No modo
// clone, `CLAUDE.md`/`git init` NUNCA rodam — o clone ja traz o `.git`.

export interface CreateProjectDeps {
  readonly existsSync: (path: string) => boolean;
  readonly mkdirSync: (path: string) => void;
  readonly writeClaudeMdSeed: (path: string, name: string) => void;
  /** FIX (#31) — limpeza best-effort do diretorio criado NESTA operacao quando o clone falha. Só é chamada depois de um `mkdirSync` que a própria chamada fez (nunca em cima de pasta pré-existente — essa já teria caído em `already-exists` antes). */
  readonly rmdirRecursive: (path: string) => void;
  /** Injetavel pra teste — `createNewProject` nunca importa `spawn` fora daqui. */
  readonly spawnFn?: typeof spawn;
}

const GIT_INIT_TIMEOUT_MS = 8_000; // mesmo teto de quota-headroom.ts/github-reader.ts — nunca trava o main process.
const GIT_CLONE_TIMEOUT_MS = 120_000; // clone pode ser bem mais lento que init (rede, tamanho do repo) — teto bem maior, mas ainda finito (nunca trava o main process pra sempre).

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

type GitCloneOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** `ENOENT` (git ausente) vira mensagem legivel; qualquer outro erro de spawn devolve `error.message` (ou um texto generico se nem isso existir). */
function describeSpawnError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return 'git não está instalado ou não foi encontrado no PATH.';
  return error instanceof Error ? error.message : 'Falha desconhecida ao iniciar o git.';
}

/**
 * `git clone <url> .` dentro do diretorio JA criado (mkdir feito por quem
 * chama) — ao contrario do `runGitInit`, ISSO NUNCA degrada em silencio:
 * qualquer desfecho que não seja "saiu com codigo 0" vira `{ ok: false,
 * message }` com o stderr do proprio git (URL invalida, sem auth, rede fora
 * — o usuario precisa ver o motivo real).
 */
function runGitClone(cwd: string, url: string, spawnFn: typeof spawn): Promise<GitCloneOutcome> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn('git', ['clone', url, '.'], { cwd, windowsHide: true });
    } catch (error) {
      resolve({ ok: false, message: describeSpawnError(error) });
      return;
    }

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    let settled = false;
    const finish = (outcome: GitCloneOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, message: 'O clone demorou demais (mais de 120s) e foi cancelado — confira a URL e a rede.' });
    }, GIT_CLONE_TIMEOUT_MS);

    child.on('error', (error) => finish({ ok: false, message: describeSpawnError(error) }));
    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      finish({ ok: false, message: stderr.trim() || `git clone terminou com código ${code}.` });
    });
  });
}

/** Limpeza best-effort da pasta criada nesta operação quando o clone falha — nunca lança; devolve um sufixo de mensagem quando a própria limpeza falha (a pasta pode ter sobrado pela metade). */
function tryCleanupCreatedDir(path: string, deps: CreateProjectDeps): string {
  try {
    deps.rmdirRecursive(path);
    return '';
  } catch {
    return ` A pasta "${path}" pode ter ficado parcialmente criada — confira e apague manualmente se precisar.`;
  }
}

/**
 * Cria o projeto novo (CA-30/#31): valida nome + root, mkdir, e então ou (a)
 * modo 'vazio' — escreve o marcador `CLAUDE.md`, tenta `git init`
 * (best-effort) — ou (b) modo 'clone' — roda `git clone` de verdade, falha
 * aparece, pasta pela metade é limpa. `allowedRoots` e SEMPRE
 * `appConfig.projectRoots` do chamador — nunca uma lista vinda do renderer.
 */
export async function createNewProject(
  input: { readonly name: string; readonly root: string; readonly source?: ProjectSourceMode; readonly cloneUrl?: string },
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

  const source: ProjectSourceMode = input.source ?? 'vazio';
  const cloneUrl = input.cloneUrl?.trim() ?? '';
  if (source === 'clone' && !cloneUrl) {
    return { ok: false, reason: 'clone-url-empty' };
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

  if (source === 'clone') {
    const cloneOutcome = await runGitClone(path, cloneUrl, deps.spawnFn ?? spawn);
    if (!cloneOutcome.ok) {
      const cleanupNote = tryCleanupCreatedDir(path, deps);
      return { ok: false, reason: 'clone-failed', message: `${cloneOutcome.message}${cleanupNote}` };
    }
    // O clone já traz o `.git` — nem marcador `CLAUDE.md` nem `git init` rodam aqui.
    return { ok: true, path, name: nameResult.name, gitInitialized: true };
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
    rmdirRecursive: (path) => rmSync(path, { recursive: true, force: true }),
  };
}
