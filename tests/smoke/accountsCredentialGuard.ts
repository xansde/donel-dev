import { homedir } from 'node:os';
import path from 'node:path';

// G2 (batch n3, achado da issue 08/CLAUDE.md) — cinto de segurança dos
// smokes de conta. `accounts-switch.spec.ts` já registra o incidente real no
// comentário de topo: "até 04/08/2026 [o claudeHome de teste] saía direto de
// homedir()", e o smoke — que nunca tinha rodado até então — teria apagado o
// `oauthAccount` do `~/.claude.json` REAL da máquina, derrubando o login do
// CLI de quem o rodasse. Hoje cada spec já deriva `claudeHome` de um
// `mkdtempSync` isolado, mas nada IMPEDIA uma regressão futura (edit
// descuidado, helper novo que esquece o isolamento) de reintroduzir o mesmo
// bug. Esta guarda é essa rede: chamada logo depois de resolver o
// `claudeHome` de teste e ANTES de qualquer IPC que grave nele, recusa rodar
// com mensagem clara em vez de arriscar escrever na credencial real.
//
// Puro/injetável (mesmo padrão do resto do projeto — ConfigIoDeps,
// ClaudeStateIoDeps etc.): `homedir`/`platform` entram por parâmetro, então
// o teste unitário não depende da máquina real onde roda.

export interface CredentialGuardDeps {
  readonly homedir: () => string;
  readonly platform: NodeJS.Platform;
}

export function createSystemCredentialGuardDeps(): CredentialGuardDeps {
  return { homedir, platform: process.platform };
}

/** `path.resolve` + lower-case no Windows (filesystem case-insensitive) — nunca uma comparação de string crua, que um separador ou uma letra maiúscula diferentes já derrotariam. */
function normalizeForComparison(candidate: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(candidate);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * `true` quando `candidate` resolve para a pasta `.claude` REAL desta
 * máquina (`<homedir>/.claude`) OU para o próprio `homedir()` — as duas
 * formas do bug histórico (ver comentário de topo). Comparação por
 * IGUALDADE (nunca "startsWith" contra `homedir()` sozinho): o próprio
 * `os.tmpdir()` do Windows mora dentro de `homedir()`
 * (`...\AppData\Local\Temp`), então um prefixo pegaria todo tmpdir legítimo
 * como falso positivo e a guarda nunca deixaria um smoke rodar.
 */
export function isRealClaudeHome(candidate: string, deps: CredentialGuardDeps = createSystemCredentialGuardDeps()): boolean {
  const realHome = deps.homedir();
  const realClaudeHome = path.join(realHome, '.claude');
  const normalizedCandidate = normalizeForComparison(candidate, deps.platform);

  return (
    normalizedCandidate === normalizeForComparison(realHome, deps.platform) ||
    normalizedCandidate === normalizeForComparison(realClaudeHome, deps.platform)
  );
}

/**
 * G2 — chamar no `beforeAll` de todo smoke de conta, logo após resolver
 * `claudeHome`/`claudeHomeDir` e ANTES de `electron.launch`/qualquer
 * `setConfig`/`connectMod`/`switch`. Lança (nunca retorna) quando o
 * candidato é a pasta `.claude` real — falha o arquivo de spec inteiro em vez
 * de deixar o teste prosseguir e arriscar escrever na credencial real.
 */
export function refuseIfRealClaudeHome(candidate: string, deps: CredentialGuardDeps = createSystemCredentialGuardDeps()): void {
  if (!isRealClaudeHome(candidate, deps)) return;
  throw new Error(
    `recusando: este teste escreveria na sua credencial real (claudeHome resolvido = "${candidate}"). ` +
      'Smokes de conta só podem apontar para um tmpdir isolado (mkdtempSync) — nunca para homedir()/~/.claude reais.',
  );
}
