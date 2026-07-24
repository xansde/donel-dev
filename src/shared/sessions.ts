// T013 — tipos IPC do domínio de sessões anteriores (FR-004, plan.md
// "sessions:list") + funções PURAS de apresentação (formatação/filtro) usadas
// pela UI (ui-spec §5). SessionIndexer (src/main/session-indexer.ts, T012,
// TDD já fechado) é quem de fato lê `~/.claude/projects/<slug>/*.jsonl` e
// define a forma real dos dados — este arquivo só espelha o contrato pro
// preload/renderer (mesmo padrão de src/shared/projects.ts pro
// ProjectScanner). Os campos batem 1:1 de propósito com `SessionSummary`
// (session-indexer.ts) — compatibilidade estrutural, sem mapeamento manual
// no handler do main (main/index.ts devolve o array de `indexProjectSessions`
// direto, tipado como `SessionSummaryDto[]`).
//
// Campo "modelo" do ui-spec §5 ("nome ou preview · data relativa · tamanho ·
// modelo") fica DE FORA de propósito: o SessionIndexer (T012, módulo
// congelado — instrução explícita de não reescrever) não extrai qual modelo
// foi usado numa sessão anterior (exigiria parsear mensagens do assistant no
// transcript, fora do escopo desta task). Ver "Não verificado" no dossiê da
// T013.

export const SESSION_CHANNELS = {
  list: 'sessions:list',
} as const;

export interface SessionSummaryDto {
  /** Session id — nome do arquivo sem `.jsonl` (spec: "nome do arquivo"). */
  readonly id: string;
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly size: number;
  /** Primeira mensagem de usuário genuína (FR-004), ou um dos fallbacks do SessionIndexer ("(sem mensagem de usuário)"/"(ilegível)"). */
  readonly preview: string;
  readonly corrupted: boolean;
  readonly lastActivityAt: number | null;
  /** T403 (004-nomear-sessoes) — último `custom-title` do transcript (nome dado por `/rename` no CLI); null se nunca renomeada. Entra na resolução do nome exibido (`resolveSessionName`, ./sessionName.ts); o `preview` acima continua sendo o fallback. */
  readonly customTitle: string | null;
}

/** API tipada exposta pelo preload em `window.donel.sessions`. */
export interface DonelSessionsApi {
  /** Índice das sessões anteriores do projeto (FR-004, CA-2), ordenado por mtime desc; [] se o projeto nunca abriu sessão ou em erro de disco (SessionIndexer nunca lança). */
  list(projectPath: string): Promise<SessionSummaryDto[]>;
}

const TAB_NAME_MAX_LENGTH = 40;

/**
 * Nome curto pra aba/dot da barra (ui-spec §2 zona 3) a partir do preview de
 * uma sessão anterior — o preview do índice já vem truncado a
 * `MAX_PREVIEW_LENGTH` (160, session-indexer.ts), mas isso ainda é longo
 * demais pra uma aba.
 */
export function sessionTabName(session: Pick<SessionSummaryDto, 'preview'>): string {
  const trimmed = session.preview.trim();
  if (trimmed.length <= TAB_NAME_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, TAB_NAME_MAX_LENGTH - 1)}…`;
}

/**
 * Busca simples por substring (ui-spec §5: "Busca simples por nome no topo,
 * full-text é P1") — casa contra o preview OU o id da sessão, sem
 * case/acento sensível ao case (acento fica pro P1 de full-text). Query vazia
 * devolve a lista inteira (cópia, nunca a referência original).
 */
export function filterSessionsByQuery(
  sessions: readonly SessionSummaryDto[],
  query: string,
): SessionSummaryDto[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...sessions];
  return sessions.filter(
    (session) => session.preview.toLowerCase().includes(normalized) || session.id.toLowerCase().includes(normalized),
  );
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Data relativa em pt-BR (ui-spec §5: "data relativa") pra uma linha da
 * lista. `nowMs` é injetável pra testar determinístico (default = `Date.now()`
 * no ponto de chamada real). Timestamps futuros (relógio do sistema girou,
 * ou `lastActivityAt` levemente à frente de `mtimeMs`) são tratados como
 * "agora" em vez de um valor negativo sem sentido pro usuário.
 */
export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const diffMs = Math.max(0, nowMs - timestampMs);

  if (diffMs < MINUTE_MS) return 'agora';
  if (diffMs < HOUR_MS) {
    const minutes = Math.floor(diffMs / MINUTE_MS);
    return `há ${minutes} min`;
  }
  if (diffMs < DAY_MS) {
    const hours = Math.floor(diffMs / HOUR_MS);
    return `há ${hours}h`;
  }

  const days = Math.floor(diffMs / DAY_MS);
  if (days < 30) return `há ${days} dia${days === 1 ? '' : 's'}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;

  const years = Math.floor(months / 12);
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`;
}

const SIZE_UNITS = ['KB', 'MB', 'GB'] as const;

/** Tamanho legível (ui-spec §5: "tamanho") a partir dos bytes do SessionIndexer (`stat().size`). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${SIZE_UNITS[unitIndex]}`;
}
