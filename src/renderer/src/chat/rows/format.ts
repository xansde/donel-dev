// Pure presentation logic of the conversation rows (T052/T053). No React, no IPC.
import type { ActionCategory as DsActionCategory, ActionStatus as DsActionStatus } from '@donel-dev/design-system';
import type { ActionCategory, ActionStatus, NoticeKind, SubagentStatus } from '../../../../shared/chat/rows';
import type { RowDetailPart } from '../../../../shared/chat/ipc';

/** "14:05" in the user's zone (a zone can be passed for tests). */
export function formatClock(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** "0,3 s" · "6,4 s" · "42 s" · "1 min" · "2 min 41 s". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) {
    const tenths = Math.round(ms / 100);
    if (tenths < 100) {
      return tenths % 10 === 0 ? `${tenths / 10} s` : `${String(tenths / 10).replace('.', ',')} s`;
    }
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

const IRREGULAR_GERUND: Readonly<Record<string, string>> = { Viu: 'Vendo' };

/**
 * Gerund of the first word of a past-tense summary verb, for the action that is
 * still running (D-C4): "Leu" -> "Lendo", "Rodou em segundo plano" -> "Rodando
 * em segundo plano". The rest of the phrase is kept; an unknown shape too.
 */
export function progressiveVerb(verb: string): string {
  const space = verb.indexOf(' ');
  const first = space === -1 ? verb : verb.slice(0, space);
  const rest = space === -1 ? '' : verb.slice(space);
  const irregular = IRREGULAR_GERUND[first];
  if (irregular) return irregular + rest;
  if (first.endsWith('ou')) return `${first.slice(0, -2)}ando${rest}`;
  if (first.endsWith('eu')) return `${first.slice(0, -2)}endo${rest}`;
  if (first.endsWith('iu')) return `${first.slice(0, -2)}indo${rest}`;
  return verb;
}

export interface SplitStats {
  readonly added?: number;
  readonly removed?: number;
  readonly text?: string;
}

/** `"+12 −3"` -> numbers for the colored counters; anything else stays text. */
export function splitStats(stats: string | undefined): SplitStats {
  if (!stats) return {};
  const match = /^\+(\d+)\s*[−-](\d+)$/.exec(stats.trim());
  if (match) return { added: Number(match[1]), removed: Number(match[2]) };
  return { text: stats };
}

/**
 * D-C3: the exit code is shown ONLY when the result starts with "Exit code N".
 * The first line is then stripped from the body; nothing else is inferred.
 */
export function parseExitCode(text: string): { exitCode?: number; body: string } {
  const match = /^Exit code (\d+)(?:\r?\n|$)/.exec(text);
  if (!match) return { body: text };
  return { exitCode: Number(match[1]), body: text.slice(match[0].length) };
}

/** The adapter turns `[Image #n]` into thumbnails; the marker must not show twice. */
export function stripImageMarkers(text: string): string {
  return text
    .replace(/[ \t]*\[Image #\d+\][ \t]*/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

/** D-C11: a message that starts with `/` or `!` is set in mono. */
export function isCommandText(text: string): boolean {
  return /^\s*[/!]/.test(text);
}

export function dsActionCategory(category: ActionCategory): DsActionCategory {
  switch (category) {
    case 'read':
      return 'read';
    case 'edit':
    case 'write':
      return 'edit';
    case 'bash':
      return 'command';
    case 'search':
      return 'search';
    case 'skill':
      return 'skill';
    default:
      return 'tool';
  }
}

export function dsActionStatus(status: ActionStatus): DsActionStatus {
  return status === 'ok' ? 'done' : status === 'error' ? 'failed' : status;
}

/** Detail fetched when an action expands (conversation-rows.md §4); null = nothing to expand. */
export function actionDetailPart(category: ActionCategory): RowDetailPart | null {
  switch (category) {
    case 'edit':
    case 'write':
      return 'diff';
    case 'bash':
      return 'output';
    case 'search':
      return 'files';
    case 'web':
    case 'agent':
    case 'mcp':
    case 'task':
    case 'other':
      return 'raw';
    default:
      return null;
  }
}

export type NoticeIcon =
  | 'compact'
  | 'limit'
  | 'api-error'
  | 'interrupted'
  | 'account-switch'
  | 'conversation-switch'
  | 'informational'
  | 'generated-file'
  // B36 — the divider above which the tab's chat keeps the conversation a renewal replaced.
  | 'session-renewed';

export interface NoticeContent {
  readonly icon: NoticeIcon;
  /** G3: amber only when it asks for a decision. */
  readonly tone: 'muted' | 'warn';
  readonly text: string;
  /** `generated-file`: the file name (mono) and the path for "abrir". */
  readonly fileName?: string;
  readonly filePath?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

const PREVIOUS_CONVERSATION = 'a anterior está em Sessões anteriores';

/** Text, tone and icon of a `notice` row (conversation-rows.md §7, G3). */
export function noticeContent(kind: NoticeKind, params: Readonly<Record<string, unknown>>): NoticeContent {
  switch (kind) {
    case 'compact': {
      const before = asNumber(params.preTokens);
      const after = asNumber(params.postTokens);
      const text =
        before !== undefined && after !== undefined
          ? `conversa compactada · ${formatTokens(before)} → ${formatTokens(after)}`
          : 'conversa compactada';
      return { icon: 'compact', tone: 'muted', text };
    }
    case 'limit':
      return { icon: 'limit', tone: 'warn', text: 'Limite da conta atingido' };
    case 'api-error':
      return { icon: 'api-error', tone: 'warn', text: 'Erro da API — a rodada parou' };
    case 'interrupted':
      return { icon: 'interrupted', tone: 'muted', text: 'Interrompido' };
    case 'account-switch': {
      // Label only — never an e-mail (FR-031).
      const label = asString(params.label);
      const safe = label !== undefined && !label.includes('@') ? label : undefined;
      return { icon: 'account-switch', tone: 'muted', text: safe ? `Conta trocada para ${safe}` : 'Conta trocada' };
    }
    case 'conversation-switch': {
      const lead = params.reason === 'resume' ? 'Conversa retomada' : 'Conversa nova';
      return { icon: 'conversation-switch', tone: 'muted', text: `${lead} — ${PREVIOUS_CONVERSATION}` };
    }
    case 'informational':
      return {
        icon: 'informational',
        tone: params.level === 'warning' ? 'warn' : 'muted',
        text: asString(params.text) ?? 'Aviso',
      };
    case 'generated-file':
      return {
        icon: 'generated-file',
        tone: 'muted',
        text: 'Gerou',
        ...(asString(params.name) ? { fileName: asString(params.name) } : {}),
        ...(asString(params.path) ? { filePath: asString(params.path) } : {}),
      };
    case 'session-renewed':
      // B36 — the conversation above is the one the renewal replaced; "abrir" opens the handoff.
      return {
        icon: 'session-renewed',
        tone: 'muted',
        text: 'Sessão renovada em voo (contexto cheio) · passagem:',
        ...(asString(params.name) ? { fileName: asString(params.name) } : {}),
        ...(asString(params.path) ? { filePath: asString(params.path) } : {}),
      };
  }
}

/** "Falhou em 12 s" when the duration is known; otherwise the DS default label. */
export function subagentStateText(status: SubagentStatus, durationMs: number | undefined): string | undefined {
  if (status !== 'failed') return undefined;
  const duration = formatDuration(durationMs);
  return duration ? `Falhou em ${duration}` : undefined;
}
