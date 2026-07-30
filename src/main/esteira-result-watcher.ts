import { promises as fs, watch, type FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';
import type { EsteiraPhase } from '../shared/devMode';
import type { EsteiraStateRoot } from './esteira-reader';

// T308 (003-modo-dev, Batch A) — CA-6: quando `<fase>-result.json` aparece
// com `status: "success"`, o app fecha a aba e registra o `session-id`. O
// GATILHO é o manifesto em disco, nunca "o processo terminou" — nada aqui lê
// o PTY, só o filesystem. Mesmo padrão de `transcript-watcher.ts`: vigia o
// DIRETÓRIO `handoffs/` (nunca o arquivo — ele nasce só quando a skill
// termina), com retry limitado para o diretório ainda não existir.
//
// CA-4 (009-modo-dev-v3) — a raiz saiu de `<repo>/.esteira/` para
// `~/.claude/esteira-state/<repo_slug>/<card_id>/<fase>/`, fora do repo
// (mesma raiz de `esteira-reader.ts` — ver o comentário de topo de lá sobre
// `repoSlug`). Implementar/Validar arquivam sob `handoffs/fase-<n>/` (D.0-bis
// do contrato); sem `faseNum` conhecido não há diretório correto a vigiar —
// o watcher fica inerte (nunca chuta `fase-1`; quem decide esse ponto de
// partida, documentado, é `discovery-tree.ts`/`main/index.ts`).
//
// Etapa que FALHOU (`status` ≠ "success") não arquiva sozinha — fica aberta
// (CA-6 literal). Reprocessamento (mesmo manifesto reescrito) não duplica
// evento: uma vez emitido, este watcher nunca emite de novo (a fase já foi
// arquivada — quem chama dá `dispose()` e cria um watcher novo se abrir a
// fase de novo).

export interface EsteiraResultEvent {
  readonly cardId: string;
  readonly fase: EsteiraPhase;
  readonly faseNum?: number | null;
  readonly manifestPath: string;
}

export interface EsteiraResultWatcherOptions extends EsteiraStateRoot {
  readonly fase: EsteiraPhase;
  readonly cardId: string;
  /** Só implementar/validar (D.0-bis) — sem valor, o watcher fica inerte (nunca observa `fase-1` por chute). */
  readonly faseNum?: number | null;
  readonly onArchived: (event: EsteiraResultEvent) => void;
  readonly retryMs?: number;
  readonly maxRetries?: number;
}

export interface EsteiraResultWatcherHandle {
  /** Fecha o `fs.watch` e cancela timers. Idempotente. */
  readonly dispose: () => void;
}

const DEFAULT_RETRY_MS = 1_000;
const DEFAULT_MAX_RETRIES = 30;
const PHASE_ARCHIVES_BY_FASE_NUM: readonly EsteiraPhase[] = ['implementar', 'validar'];

function manifestFileName(fase: EsteiraPhase): string {
  return `${fase}-result.json`;
}

/** `null` — implementar/validar sem `faseNum`: não há diretório correto a vigiar (degradação por omissão, CA-6). */
function resolveHandoffsDir(options: EsteiraResultWatcherOptions): string | null {
  const phaseDir = join(options.esteiraStateRoot, options.repoSlug, options.cardId, options.fase);
  if (PHASE_ARCHIVES_BY_FASE_NUM.includes(options.fase)) {
    if (options.faseNum === undefined || options.faseNum === null) return null;
    return join(phaseDir, 'handoffs', `fase-${options.faseNum}`);
  }
  return join(phaseDir, 'handoffs');
}

/** Nunca lança: ausente/ilegível devolve `null` — reprocessado no próximo evento do watch. */
async function readManifestStatus(manifestPath: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as { status?: unknown };
    return typeof parsed.status === 'string' ? parsed.status : null;
  } catch {
    return null;
  }
}

/**
 * Abre o watch e devolve o handle. Nunca lança: qualquer falha de I/O degrada
 * para "sem detecção automática" (a etapa falhou/travou fica visível pelo
 * estado de fase, CA-15 — o arquivamento só não acontece sozinho). Sem
 * `handoffsDir` resolvível (implementar/validar sem `faseNum`), o handle
 * volta inerte: nunca abre `fs.watch`, nunca emite, `dispose()` é no-op.
 */
export function watchEsteiraResult(options: EsteiraResultWatcherOptions): EsteiraResultWatcherHandle {
  const { fase, cardId, faseNum, onArchived, retryMs = DEFAULT_RETRY_MS, maxRetries = DEFAULT_MAX_RETRIES } = options;

  const resolvedHandoffsDir = resolveHandoffsDir(options);
  if (resolvedHandoffsDir === null) {
    return { dispose: () => undefined };
  }
  // Realocado para um `const` com tipo `string` explícito: closures aninhadas
  // (função `openWatch` abaixo) não retêm o narrowing de `resolvedHandoffsDir`
  // feito pelo `if` acima.
  const handoffsDir: string = resolvedHandoffsDir;

  const fileName = manifestFileName(fase);
  const manifestPath = join(handoffsDir, fileName);

  let watcher: FSWatcher | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let retries = 0;
  let disposed = false;
  let reading = false;
  /** Uma vez arquivado, este watcher nunca emite de novo (evita duplicar em reprocessamento). */
  let emitted = false;

  const dispose = (): void => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    watcher?.close();
    watcher = undefined;
  };

  async function readAndMaybeEmit(): Promise<void> {
    if (disposed || reading || emitted) return;
    reading = true;
    try {
      const status = await readManifestStatus(manifestPath);
      if (disposed || emitted) return;
      if (status !== 'success') return; // ausente, ilegível ou falhou/travou (CA-6): fica aberta

      emitted = true;
      onArchived({ cardId, fase, faseNum, manifestPath });
    } finally {
      reading = false;
    }
  }

  function openWatch(): void {
    if (disposed || watcher) return;
    try {
      watcher = watch(handoffsDir, (_event, changed) => {
        // `changed` vem `null` em alguns cenários do Windows — relê sem filtro (barato: 1 arquivo esperado).
        if (changed && basename(String(changed)) !== fileName) return;
        void readAndMaybeEmit();
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = undefined;
        scheduleRetry();
      });
    } catch {
      scheduleRetry();
    }
  }

  function scheduleRetry(): void {
    if (disposed || watcher || retryTimer) return;
    if (retries >= maxRetries) return; // desiste da detecção automática; a fase segue visível como "stuck" (CA-15)
    retries += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      openWatch();
      if (watcher) void readAndMaybeEmit(); // o manifesto pode ter nascido justamente entre duas tentativas
      else scheduleRetry();
    }, retryMs);
  }

  openWatch();
  // Leitura imediata: o manifesto pode já existir quando o watch abre (retomada do app com etapa concluída no meio-tempo).
  void readAndMaybeEmit();
  if (!watcher) scheduleRetry();

  return { dispose };
}
