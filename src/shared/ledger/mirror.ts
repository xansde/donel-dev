// Espelho do Oráculo (pedido do dono, 06/11: "precisamos que as tasks sejam registradas em algum lugar") — what
// the main sends, after each change of the ledger, to a registry OUTSIDE this PC: one row per task, in words a
// person reads in a spreadsheet (the Supabase table editor, the phone). Pure: the main gives the place names and
// the clock; the destination (`src/main/ledger-mirror/`) only ships the rows.
//
// What never leaves: proof files (prints, videos, prototypes — size, and they can show sensitive data). A text
// proof and a link do go, after `maskSecrets` (tokens, keys, passwords, e-mails, CPF).

import { lastDecision, lastDelivery, waitsForOwner, type LedgerActor, type LedgerDoc, type LedgerTask, type LedgerTaskState } from './contract';
import { actorLabel, type PlaceNameOf } from './labels';

/** One row of the table `demandas` (docs/oraculo-espelho/supabase.sql). Dates are ISO, `null` = not yet. */
export interface DemandaRow {
  readonly id: string;
  readonly quadro: string;
  readonly titulo: string;
  readonly pedido: string;
  readonly quem_pediu: string;
  readonly estado: string;
  readonly esperando_dono: boolean;
  readonly risco: string;
  readonly dono: string;
  readonly prazo: string;
  readonly criada_em: string;
  readonly entregue_em: string | null;
  readonly decidida_em: string | null;
  readonly decisao: string | null;
  readonly motivo: string | null;
  readonly prova: string | null;
  readonly prova_link: string | null;
}

const STATE_LABELS: Readonly<Record<LedgerTaskState, string>> = {
  aberta: 'aberta',
  'em-execucao': 'em execução',
  entregue: 'entregue',
  aceita: 'aceita',
  rejeitada: 'rejeitada',
};

/** A proof text in a table cell: the gist, not a 20 000-character log. */
export const MAX_ROW_PROOF_CHARS = 2000;

// ---------------------------------------------------------------------------------------------------------------
// Secret scan — before anything leaves the PC. A hit is replaced in place and reported (never its value).

export interface MaskHit {
  readonly kind: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp; keep?: (match: string, ...groups: string[]) => string }> = [
  { kind: 'chave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'token GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: 'chave Anthropic/OpenAI', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g },
  { kind: 'token Supabase', re: /\b(?:sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{10,})/g },
  { kind: 'token Slack', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'chave AWS', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'chave Google', re: /\bAIza[A-Za-z0-9_-]{30,}/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'Bearer', re: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, keep: (_m, word) => `${word} [segredo]` },
  {
    kind: 'senha',
    re: /\b(password|passwd|senha|secret|token|api[_-]?key)(\s*[:=]\s*)(["']?)[^\s"',;]{4,}\3/gi,
    keep: (_m, word, sep) => `${word}${sep}[segredo]`,
  },
  { kind: 'e-mail', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, keep: () => '[e-mail]' },
  { kind: 'CPF', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, keep: () => '[cpf]' },
];

/** Replaces every secret-looking piece of `text`; `hits` says what was found (never the value). */
export function maskSecrets(text: string): { text: string; hits: MaskHit[] } {
  const hits: MaskHit[] = [];
  let out = text;
  for (const { kind, re, keep } of SECRET_PATTERNS) {
    out = out.replace(re, (...args: unknown[]) => {
      hits.push({ kind });
      const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : ''));
      return keep ? keep(String(args[0]), ...groups) : '[segredo]';
    });
  }
  return { text: out, hits };
}

// ---------------------------------------------------------------------------------------------------------------
// Rows

/** A masked field, noted in `masked` (task id + field + kind) for the log. */
export interface MaskNote {
  readonly taskId: string;
  readonly field: string;
  readonly kinds: readonly string[];
}

function who(actor: LedgerActor | undefined, projectPath: string, placeName: PlaceNameOf | undefined): string {
  if (actor?.kind === 'dono') return 'Dono';
  return actorLabel(actor, projectPath, placeName);
}

const iso = (ms: number | undefined): string | null => (ms === undefined ? null : new Date(ms).toISOString());

/** The board's name: the project folder's last segment ("Donel Dev"). */
export function boardName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

export function demandaRow(doc: LedgerDoc, task: LedgerTask, placeName: PlaceNameOf | undefined, masked: MaskNote[]): DemandaRow {
  const mask = (field: string, value: string): string => {
    const result = maskSecrets(value);
    if (result.hits.length > 0) masked.push({ taskId: task.id, field, kinds: [...new Set(result.hits.map((hit) => hit.kind))] });
    return result.text;
  };
  const created = task.events.find((event) => event.kind === 'criada');
  const delivery = lastDelivery(task);
  const decision = lastDecision(task);
  const texts = (delivery?.proofs ?? []).flatMap((proof) => (proof.kind === 'texto' ? [proof.text] : []));
  const link = (delivery?.proofs ?? []).find((proof) => proof.kind === 'link');
  const files = (delivery?.proofs ?? []).filter((proof) => proof.kind === 'arquivo').length;
  const proofText = [...texts, ...(files > 0 ? [`(${files === 1 ? '1 arquivo' : `${files} arquivos`} de prova só no app)`] : [])].join('\n\n');
  const decisionLabel = decision ? [decision.kind, decision.option ? `· ${decision.option}` : '', `(${who(decision.by, task.projectPath, placeName)})`].filter(Boolean).join(' ') : null;
  const reason = decision?.text ?? decision?.option ?? null;
  return {
    id: task.id,
    quadro: boardName(task.projectPath),
    titulo: mask('titulo', task.title ?? task.request.split('\n')[0]!.slice(0, 60)),
    pedido: mask('pedido', task.request),
    quem_pediu: who(created?.by, task.projectPath, placeName),
    estado: STATE_LABELS[task.state],
    esperando_dono: waitsForOwner(doc, task),
    risco: task.risk,
    dono: who({ kind: 'lugar', placeId: task.ownerPlaceId, ...(placeRole(task) ? { roleId: placeRole(task) } : {}) }, task.projectPath, placeName),
    prazo: task.due,
    criada_em: iso(task.createdAt)!,
    entregue_em: iso(delivery?.at),
    decidida_em: iso(decision?.at),
    decisao: decisionLabel,
    motivo: reason === null ? null : mask('motivo', reason),
    prova: proofText ? mask('prova', proofText.length > MAX_ROW_PROOF_CHARS ? `${proofText.slice(0, MAX_ROW_PROOF_CHARS)}…` : proofText) : null,
    prova_link: link?.kind === 'link' ? mask('prova_link', link.url) : null,
  };
}

/** The owner's role, read from its own steps (who took or delivered it). */
function placeRole(task: LedgerTask): string | undefined {
  for (const event of task.events) if (event.by.kind === 'lugar' && event.by.placeId === task.ownerPlaceId && event.by.roleId) return event.by.roleId;
  return undefined;
}

/** Every task, oldest first. `masked` lists what the scan replaced (for the log). */
export function demandaRows(doc: LedgerDoc, placeName?: PlaceNameOf): { rows: DemandaRow[]; masked: MaskNote[] } {
  const masked: MaskNote[] = [];
  const rows = Object.values(doc.tasks)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((task) => demandaRow(doc, task, placeName, masked));
  return { rows, masked };
}

// ---------------------------------------------------------------------------------------------------------------
// Preferences ↔ main

export const LEDGER_MIRROR_CHANNELS = {
  getState: 'ledger-mirror:get-state',
  configure: 'ledger-mirror:configure',
  disable: 'ledger-mirror:disable',
  syncNow: 'ledger-mirror:sync-now',
} as const;

/** What the Preferences show. The key never leaves the main: only whether it is in the vault. */
export interface LedgerMirrorState {
  readonly enabled: boolean;
  readonly url: string | null;
  readonly keyConfigured: boolean;
  /** ISO of the last registry that went out; `null` = never. */
  readonly lastSyncAt: string | null;
  /** A change is waiting to go (the wait, or no network). */
  readonly pending: boolean;
  readonly lastError: string | null;
}

export type LedgerMirrorConfigureResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface DonelLedgerMirrorApi {
  getState(): Promise<LedgerMirrorState>;
  /** `key` empty = keep the one in the vault. */
  configure(url: string, key: string): Promise<LedgerMirrorConfigureResult>;
  disable(): Promise<LedgerMirrorState>;
  syncNow(): Promise<LedgerMirrorState>;
}

/** `https://<ref>.supabase.co` — the only shape accepted (no path, no query). */
export function isSupabaseUrl(value: string): boolean {
  return /^https:\/\/[a-z0-9-]{6,40}\.supabase\.co$/.test(value.trim().replace(/\/+$/, ''));
}
