import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// FIX (auditoria rodada 5, achado media "playwright.config.ts" — suíte não
// verde por vazamento de estado real) — CAUSA RAIZ confirmada pela
// auditoria: todo smoke deste diretório roda o app buildado contra o
// userData REAL da máquina (`%APPDATA%\donel-dev`), então o ConfigStore
// persistente (T015) vaza entre execuções e entre arquivos de spec —
// `launcherDefaults` flagrado com valor de uma run anterior (não o default
// que os testes assumem) foi a causa raiz real de `terminal.spec.ts:153` e
// `model-injection.spec.ts:44` falharem, sem relação nenhuma com o código
// sob teste. Cada spec que chama `createIsolatedUserDataDir` abaixo ganha um
// `--user-data-dir` do Electron próprio (temp, descartável), nascendo sempre
// limpo — nunca herda nem contamina o estado real do Alexandre nem o de
// outro arquivo de spec.
//
// SEM EXCEÇÃO desde 13/09/2026: `config-persistence.spec.ts` era o único
// smoke contra o userData real, para provar o path de produção. Desde a Fase 1
// das contas (011, etapa 3) o boot faz faxina do cofre e varredura de
// `accounts-login-*` no userData — e aquele spec limpou o cofre real do dono
// no meio da suíte. Hoje ele também usa isto, e confere o path de produção
// pelo nome do app e pelo `appData`, sem gravar lá. Nenhum smoke novo deve
// subir o app sem `--user-data-dir`.

/** Cria um diretório temp único (`os.tmpdir()`) pra servir de `--user-data-dir` de UM arquivo de spec — nunca compartilhado entre specs. */
export function createIsolatedUserDataDir(specName: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `donel-dev-smoke-${specName}-`));
}

/** Remove o diretório temp criado por `createIsolatedUserDataDir` — chamar sempre no `afterAll`, mesmo se o teste falhou. */
export function removeIsolatedUserDataDir(dir: string): void {
  removeTempDir(dir);
}

// Windows keeps file handles open for a moment after Electron exits (the
// renderer, GPU and crashpad children close after the main process), so an
// immediate `rmSync` in `afterAll` failed with EPERM/EBUSY while the test
// itself was green. Node retries those codes when `maxRetries` is set; 10
// tries 200 ms apart (linear backoff) give the OS ~11 s to let go.
const TEMP_DIR_RM_RETRIES = 10;
const TEMP_DIR_RM_RETRY_DELAY_MS = 200;

/**
 * Teardown removal of a throwaway temp dir (userData, fake home, scratch
 * repo). Retries while Windows still holds files, and if it still cannot
 * remove the dir it only warns: a leftover folder under `os.tmpdir()` is not
 * a test failure. Never use it for a removal the test depends on — there the
 * error must surface.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: TEMP_DIR_RM_RETRIES, retryDelay: TEMP_DIR_RM_RETRY_DELAY_MS });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    console.warn(`[smoke] could not remove temp dir ${dir} (${code}); leaving it behind.`);
  }
}
