// T064 (014-chat) - sinais de aceite do envio (contracts/send-protocol.md §5/§7).
// Puro: extrai sinais de entradas do transcript, guarda o anel dos ultimos
// `UserPromptSubmit` de uma aba e responde ao `chat:ack-lookup` (aceite tardio).

import type { PromptSignalKind } from '../../shared/chat/ipc';
import { matchesPrompt, normalizePrompt } from '../../shared/chat/promptMatch';
import type { TranscriptEntry } from '../../shared/chat/rows';

export interface PromptSignal {
  readonly signal: PromptSignalKind;
  readonly text?: string;
  /** ISO-8601. */
  readonly at: string;
  /** `hook` = UserPromptSubmit da ponte; `transcript` = linha do transcript. */
  readonly origin: 'hook' | 'transcript';
}

export interface SubmitRecord {
  readonly text: string;
  readonly at: string;
}

export interface AckResult {
  readonly matched: boolean;
  readonly via?: string;
}

/** Canonical comparison form: the shared `promptMatch` (014-F3). */
export const normalizeForMatch = normalizePrompt;

const sameText = (a: string, b: string): boolean => matchesPrompt(a, b);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function tagText(text: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return m === null ? undefined : m[1]!;
}

/** Texto de uma linha `user`; `null` quando carrega `tool_result` (nao e prompt). */
function userText(data: Json): string | null {
  const content = obj(data.message).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const blocks = content.map(obj);
  if (blocks.some((b) => b.type === 'tool_result')) return null;
  return blocks.filter((b) => b.type === 'text').map((b) => str(b.text) ?? '').join('\n');
}

const UNKNOWN_COMMAND = /Unknown command:?\s*(\S+)?/i;

/** Sinais de aceite contidos em entradas NOVAS do transcript (nunca de paginas para tras). */
export function signalsFromEntries(entries: readonly TranscriptEntry[], fallbackAt: string = new Date().toISOString()): PromptSignal[] {
  const out: PromptSignal[] = [];
  const push = (signal: PromptSignalKind, at: string, text?: string): void => {
    out.push({ signal, ...(text !== undefined ? { text } : {}), at: at === '' ? fallbackAt : at, origin: 'transcript' });
  };

  for (const entry of entries) {
    if (entry.k === 'meta') {
      if (entry.type !== 'queue-operation') continue;
      const p = obj(entry.payload);
      if (p.operation === 'enqueue') push('enqueue', str(p.timestamp) ?? '', str(p.content));
      continue;
    }
    if (entry.k !== 'node') continue;
    const d = entry.data;
    if (entry.role === 'attachment') {
      const a = obj(d.attachment);
      if (a.type === 'queued_command' && a.commandMode === 'prompt') {
        const prompt = typeof a.prompt === 'string' ? a.prompt : Array.isArray(a.prompt) ? a.prompt.map((b) => str(obj(b).text) ?? '').join('\n') : undefined;
        push('deliver', entry.at, prompt);
      }
    } else if (entry.role === 'user') {
      if (d.isMeta === true) continue;
      const text = userText(d);
      if (text === null) continue;
      const name = tagText(text, 'command-name');
      const bash = tagText(text, 'bash-input');
      if (name !== undefined) {
        const args = tagText(text, 'command-args')?.trim();
        push('command', entry.at, args ? `${name.trim()} ${args}` : name.trim());
      } else if (bash !== undefined) {
        push('shell', entry.at, bash.trim());
      } else if (/^<(local-command|bash-stdout|bash-stderr|task-notification)/.test(text.trim())) {
        continue;
      } else if (d.turnOrigin === 'human' || d.promptSource === 'typed' || d.promptSource === 'queued') {
        push('submit', entry.at, text);
      }
    } else if (entry.role === 'system') {
      const sub = d.subtype;
      if (sub === 'local_command') {
        const run = obj(d.commandRun);
        const cmd = str(run.command);
        const args = str(run.args)?.trim();
        push('local', entry.at, cmd === undefined ? undefined : args ? `${cmd} ${args}` : cmd);
      } else if (sub === 'compact_boundary') {
        push('compact', entry.at);
      } else if (sub === 'informational') {
        const content = str(d.content) ?? '';
        const m = UNKNOWN_COMMAND.exec(content);
        if (m !== null) push('unknown-command', entry.at, m[1] ?? content);
      }
    }
  }
  return out;
}

/** Anel dos ultimos N `UserPromptSubmit` de uma aba (contrato §5: 20). */
export function createSubmitRing(limit: number): { push(r: SubmitRecord): void; items(): readonly SubmitRecord[] } {
  const list: SubmitRecord[] = [];
  return {
    push(r) {
      list.push(r);
      if (list.length > limit) list.splice(0, list.length - limit);
    },
    items: () => list,
  };
}

const CLEAR_ALIASES: ReadonlySet<string> = new Set(['/clear', '/new', '/reset']);
const stripSlash = (s: string): string => s.trim().replace(/^\//, '');
const firstWord = (s: string): string => s.trim().split(/\s+/)[0] ?? '';

function signalMatches(sig: PromptSignal, text: string): boolean {
  const t = text.trim();
  switch (sig.signal) {
    case 'submit':
    case 'enqueue':
    case 'deliver':
      return sig.text !== undefined && sameText(sig.text, t);
    case 'command':
      return sig.text !== undefined && sameText(sig.text, t);
    case 'shell':
      return sig.text !== undefined && t.startsWith('!') && sameText(sig.text, t.slice(1));
    case 'local':
      return sig.text !== undefined && t.startsWith('/') && stripSlash(firstWord(sig.text)) === stripSlash(firstWord(t));
    case 'unknown-command':
      return sig.text !== undefined && t.startsWith('/') && firstWord(sig.text) === firstWord(t);
    case 'compact':
      return firstWord(t) === '/compact';
    case 'session-switch':
      return CLEAR_ALIASES.has(firstWord(t));
  }
}

/** Aceite tardio: o texto casa com algum `UserPromptSubmit` guardado ou sinal de transcript desde `since`. */
export function lookupAck(submits: readonly SubmitRecord[], signals: readonly PromptSignal[], text: string, since: string): AckResult {
  const cutoff = Date.parse(since);
  const after = (at: string): boolean => Number.isNaN(cutoff) || Date.parse(at) >= cutoff || Number.isNaN(Date.parse(at));
  for (const s of submits) {
    if (after(s.at) && sameText(s.text, text)) return { matched: true, via: 'UserPromptSubmit' };
  }
  for (const sig of signals) {
    if (after(sig.at) && signalMatches(sig, text)) return { matched: true, via: sig.signal };
  }
  return { matched: false };
}
