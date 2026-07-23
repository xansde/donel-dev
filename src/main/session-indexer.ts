import { createReadStream, promises as fs, type Dirent } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

// T012 — SessionIndexer (FR-004, plan.md ponto 4). Indexa as sessões
// anteriores do Claude Code para um projeto sem nunca carregar o transcript
// inteiro: stat (mtime/size) + streaming das primeiras linhas até achar a
// primeira mensagem de usuário genuína, mais uma leitura de cauda (tail)
// opcional/best-effort para a última atividade.
//
// Formato real inspecionado em `~/.claude/projects/<slug>/*.jsonl` (sessões
// deste e de outros projetos na máquina, anonimizadas nas fixtures de
// teste — ver tests/fixtures/sessions/):
// - Cada linha é um registro JSON solto (JSON Lines), não um array.
// - O transcript quase sempre ABRE com registros de controle antes da
//   primeira mensagem de usuário — `type: "custom-title"`, `type: "mode"`,
//   `type: "attachment"` (erros de hook não-bloqueantes, deltas de tools
//   deferidas) — nenhum deles tem `type: "user"`.
// - Mensagens de slash-command aparecem como `type: "user"` com o texto
//   `<command-name>...</command-name>` (o aviso que normalmente vem antes,
//   `<local-command-caveat>`, já é filtrado por vir com `isMeta: true`).
//   Nenhuma das duas é "mensagem de usuário genuína" pela regra do FR-004.
// - `message.content` de uma linha `type: "user"` pode ser uma string
//   (mensagem digitada) OU um array de blocos de conteúdo — inclui blocos
//   `tool_result` (resposta injetada de uma tool call, nunca digitada pelo
//   usuário) e blocos `text` (mensagem real, às vezes ao lado de imagem).
//   Só um bloco `text` conta como "genuína"; um array sem bloco `text`
//   (ex.: só `tool_result`) é tratado como não-genuíno e o scan continua —
//   regra inferida da inspeção do formato real, não literal no FR-004, mas
//   necessária para não confundir uma resposta de tool com uma mensagem do
//   usuário.

export interface SessionSummary {
  /** Session id — nome do arquivo sem a extensão `.jsonl` (spec: "nome do arquivo"). */
  readonly id: string;
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly size: number;
  /** Primeira mensagem de usuário genuína (FR-004), ou um dos fallbacks abaixo. */
  readonly preview: string;
  /** true quando o transcript não tinha NENHUMA linha JSON válida (corrompido/truncado). */
  readonly corrupted: boolean;
  /** Timestamp (ms) da última atividade lido por tail; null se indisponível. */
  readonly lastActivityAt: number | null;
}

export interface IndexSessionsOptions {
  /** Raiz `~/.claude` a usar — injetável para testes; default = `defaultClaudeHome()`. */
  readonly claudeHome?: string;
}

// Fallback do FR-004: transcript bem-formado (linhas JSON válidas), mas sem
// nenhuma mensagem de usuário genuína entre elas.
const NO_USER_MESSAGE_FALLBACK = '(sem mensagem de usuário)';
// Fallback do ui-spec §5 (edge case): transcript corrompido/truncado — nenhuma
// linha pôde ser parseada como JSON.
const UNREADABLE_FALLBACK = '(ilegível)';

export const MAX_PREVIEW_LENGTH = 160;
const PREVIEW_ELLIPSIS = '…';

/** Bound de segurança: nunca varre mais que isso, mesmo num transcript patológico. */
const MAX_SCAN_LINES = 1000;

/** Cauda lida para achar a última atividade — nunca o arquivo inteiro. */
const TAIL_READ_BYTES = 8192;

/**
 * Slug real observado nos diretórios de `~/.claude/projects/`: todo
 * caractere não-alfanumérico do path absoluto vira `-`, um por um, sem
 * colapsar repetições — confirmado contra um diretório real da máquina
 * (`.no-mistakes-worktrees` → `--no-mistakes-worktrees`, o `:` do drive e
 * cada `\` também viram `-`).
 */
export function slugifyProjectPath(absoluteProjectPath: string): string {
  return absoluteProjectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function defaultClaudeHome(): string {
  return join(homedir(), '.claude');
}

export function resolveProjectSessionsDir(projectPath: string, claudeHome: string): string {
  return join(claudeHome, 'projects', slugifyProjectPath(projectPath));
}

function truncatePreview(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) return text;
  return text.slice(0, MAX_PREVIEW_LENGTH - PREVIEW_ELLIPSIS.length) + PREVIEW_ELLIPSIS;
}

/** Casa `<command-name>`, `<command-args>`, `<local-command-caveat>`, `<local-command-stdout>`... */
const COMMAND_PAYLOAD_PATTERN = /<(local-)?command-[a-z-]+>/i;

/**
 * Extrai o texto "genuíno" de `message.content` de uma linha `type: user`
 * já filtrada por `isMeta`. Retorna `null` quando o conteúdo não é uma
 * mensagem de usuário genuína (payload de slash-command, bloco só de
 * `tool_result`, ou texto vazio após normalizar espaços).
 */
function extractGenuineText(content: unknown): string | null {
  let raw: string | null = null;

  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        raw = (block as { text: string }).text;
        break;
      }
    }
  }

  if (raw === null) return null;
  if (COMMAND_PAYLOAD_PATTERN.test(raw)) return null;

  const normalized = raw.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

interface RawTranscriptLine {
  readonly type?: unknown;
  readonly isMeta?: unknown;
  readonly message?: { readonly content?: unknown };
}

interface PreviewResult {
  readonly preview: string;
  readonly corrupted: boolean;
}

/**
 * Lê as primeiras linhas do transcript por streaming (nunca o arquivo
 * inteiro) até achar a primeira mensagem de usuário genuína (FR-004).
 * Tolera linhas JSON inválidas — uma linha corrompida não derruba o índice,
 * só é pulada; o transcript inteiro só vira "(ilegível)" quando NENHUMA
 * linha pôde ser parseada.
 *
 * `sizeHint` é o tamanho (bytes) já obtido via `stat` pelo chamador — um
 * arquivo de 0 bytes é tratado como "sem mensagem de usuário" (transcript
 * válido, só ainda vazio), não como corrompido.
 */
export async function readSessionPreview(filePath: string, sizeHint?: number): Promise<PreviewResult> {
  if (sizeHint === 0) {
    return { preview: NO_USER_MESSAGE_FALLBACK, corrupted: false };
  }

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let sawAnyValidJsonLine = false;
  let linesScanned = 0;
  let genuine: string | null = null;

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (line.length === 0) continue;

      linesScanned += 1;

      let parsed: RawTranscriptLine | undefined;
      try {
        parsed = JSON.parse(line) as RawTranscriptLine;
        sawAnyValidJsonLine = true;
      } catch {
        parsed = undefined;
      }

      if (parsed && parsed.type === 'user' && parsed.isMeta !== true) {
        const text = extractGenuineText(parsed.message?.content);
        if (text !== null) {
          genuine = text;
          break;
        }
      }

      if (linesScanned >= MAX_SCAN_LINES) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (genuine !== null) {
    return { preview: truncatePreview(genuine), corrupted: false };
  }
  if (sawAnyValidJsonLine) {
    return { preview: NO_USER_MESSAGE_FALLBACK, corrupted: false };
  }
  return { preview: UNREADABLE_FALLBACK, corrupted: true };
}

interface TailLine {
  readonly timestamp?: unknown;
}

/**
 * Best-effort: lê só a cauda do arquivo (nunca o arquivo inteiro) buscando o
 * `timestamp` da última linha válida. Retorna `null` em qualquer falha —
 * nunca lança (plan.md ponto 4: "tail opcional para última atividade").
 */
export async function readLastActivity(filePath: string, size: number): Promise<number | null> {
  if (size <= 0) return null;

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const start = Math.max(0, size - TAIL_READ_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const chunk = buffer.toString('utf8');

    const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]) as TailLine;
        if (typeof parsed.timestamp === 'string') {
          const ms = Date.parse(parsed.timestamp);
          if (!Number.isNaN(ms)) return ms;
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Índice das sessões anteriores de um projeto (FR-004, CA-2). Lista
 * `~/.claude/projects/<slug>/*.jsonl` só no nível raiz do diretório —
 * transcripts de subagentes vivem aninhados em `<session-id>/subagents/` e
 * nunca entram na lista. Um projeto que nunca abriu sessão retorna `[]` sem
 * lançar. Ordenado por `mtimeMs` decrescente (mais recente primeiro, CA-2:
 * "as 3 sessões aparecem ordenadas por data").
 */
export async function indexProjectSessions(
  projectPath: string,
  opts: IndexSessionsOptions = {},
): Promise<SessionSummary[]> {
  const claudeHome = opts.claudeHome ?? defaultClaudeHome();
  const dir = resolveProjectSessionsDir(projectPath, claudeHome);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

  const summaries = await Promise.all(
    jsonlFiles.map(async (entry): Promise<SessionSummary> => {
      const filePath = join(dir, entry.name);
      const stats = await fs.stat(filePath);
      const [{ preview, corrupted }, lastActivityAt] = await Promise.all([
        readSessionPreview(filePath, stats.size),
        readLastActivity(filePath, stats.size),
      ]);
      return {
        id: entry.name.slice(0, -'.jsonl'.length),
        filePath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        preview,
        corrupted,
        lastActivityAt,
      };
    }),
  );

  return summaries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
