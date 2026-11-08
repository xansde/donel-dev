// Espelho do Oráculo (pedido do dono, 06/11: "precisamos que as tasks sejam registradas em algum lugar") — what
// the main sends, after each change of the ledger, to a registry OUTSIDE this PC: one row per task, in words a
// person reads in a spreadsheet (the Supabase table editor, the phone). Pure: the main gives the places and the
// owner's name; the destination (`src/main/ledger-mirror/`) only ships the rows.
//
// 07/11 — the owner opened the table and read "quem pediu: Dev": "Como você vai entender pra quem é?". So a row
// names PEOPLE (who asked: the owner, someone from Slack, the source of a signal) and PLACES by their name
// ("Dev · Mindscape de cadeiras"), never a role alone nor an id; the id is the last column.
//
// What never leaves: proof files (prints, videos, prototypes — size, and they can show sensitive data). A text
// proof and a link do go, after `maskSecrets` (tokens, keys, passwords, e-mails, CPF).

import {
  ASKED_BY_OWNER,
  awaitsSend,
  doneByOf,
  eventNote,
  isAgentBotRecord,
  isCancelled,
  lastDecision,
  lastDelivery,
  requestedByOf,
  slackDestinationLabel,
  transfersOf,
  viewState,
  waitsForOwner,
  type LedgerActor,
  type LedgerDoc,
  type LedgerTask,
  type LedgerViewState,
} from './contract';
import { CLOSING_LABELS, closingOf, withoutMarks } from './closing';
import { deliveryNote } from './labels';
import { LEADER_OF_ALL } from '../mindscape/leader';

/**
 * One row of the table `tarefas` (docs/oraculo-espelho/supabase.sql), in the order a person reads it. Dates are
 * ISO, `null` = not yet. The table has the same columns in the same order.
 */
export interface TarefaRow {
  readonly quadro: string;
  readonly titulo: string;
  /** In Portuguese: aberta, em execução, entregue, aceita, aceita, esperando envio, rejeitada, cancelada. */
  readonly estado: string;
  readonly esperando_dono: boolean;
  /** A person: the owner's name, "Fulano (Slack)", "sinal do Curador: <fonte>"; "não registrado" when nobody said. */
  readonly quem_pediu: string;
  /** The literal sentence of who asked. */
  readonly pedido: string;
  /** The place that owns the task, by its name ("Dev · Mindscape de cadeiras"). */
  readonly quem_faz_agora: string;
  readonly quem_criou: string;
  readonly risco: string;
  readonly prazo: string;
  /** The gist of the last delivery: the card's summary, the note, or the start of the text proof. */
  readonly ultima_entrega: string | null;
  readonly link_da_prova: string | null;
  /** "aceita por Alexandre · Mandar o rascunho", "rejeitada por Revisor · PR 276", "cancelada por …". */
  readonly decisao: string | null;
  readonly motivo: string | null;
  readonly criada_em: string;
  readonly entregue_em: string | null;
  readonly decidida_em: string | null;
  /** The whole text proof (masked, cut), and how many files stayed in the app. */
  readonly prova_texto: string | null;
  readonly id: string;
}

const STATE_LABELS: Readonly<Record<LedgerViewState, string>> = {
  aberta: 'aberta',
  'em-execucao': 'em execução',
  entregue: 'entregue',
  aceita: 'aceita',
  rejeitada: 'rejeitada',
  cancelada: 'cancelada',
};

/** A proof text in a table cell: the gist, not a 20 000-character log. */
export const MAX_ROW_PROOF_CHARS = 2000;
/** The last delivery in one cell: a sentence or two. */
export const MAX_ROW_SUMMARY_CHARS = 300;
/** How the owner is named when the main does not say. */
export const DEFAULT_OWNER_NAME = 'Dono';

// ---------------------------------------------------------------------------------------------------------------
// Secret scan — before anything leaves the PC. A hit is replaced in place and reported (never its value).

export interface MaskHit {
  readonly kind: string;
}

// Order matters: whole-token shapes first, then the connection string (before the e-mail, which would eat
// `senha@host`), then a secret-looking name with its value, then personal data.
const SECRET_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp; keep?: (match: string, ...groups: string[]) => string }> = [
  { kind: 'chave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'token GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: 'chave Anthropic/OpenAI', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g },
  { kind: 'token Supabase', re: /\b(?:sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{10,})/g },
  { kind: 'chave Stripe', re: /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{16,})/g },
  { kind: 'token Slack', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  {
    kind: 'webhook Slack',
    re: /\b(https?:\/\/hooks\.slack\.com\/)(?:services|workflows|triggers)\/[A-Za-z0-9_/-]+/g,
    keep: (_m, base) => `${base}[segredo]`,
  },
  { kind: 'chave AWS', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'chave Google', re: /\bAIza[A-Za-z0-9_-]{30,}/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'Bearer', re: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, keep: (_m, word) => `${word} [segredo]` },
  // `postgres://app:p4ss!word@10.0.0.5/db` — any host (IP or name), any character but `@`, `/` and space.
  { kind: 'senha', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, keep: (_m, head) => `${head}[segredo]@` },
  // `PGPASSWORD=…`, `DB_PASSWORD=…`, `"password": "…"`, `"apiKey": "…"`, `senha: …`: the name stays, the value goes.
  {
    kind: 'senha',
    re: /\b([A-Za-z0-9_.-]*(?:password|passwd|senha|secret|token|api[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(?!["']?\[segredo\])("[^"\n]+"|'[^'\n]+'|[^\s"',;&]{4,})/gi,
    keep: (_m, name, sep, value) => {
      const quote = value!.startsWith('"') || value!.startsWith("'") ? value![0] : '';
      return `${name}${sep}${quote}[segredo]${quote}`;
    },
  },
  { kind: 'e-mail', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, keep: () => '[e-mail]' },
  // With or without the dots: `123.456.789-00` and `12345678900`.
  { kind: 'CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, keep: () => '[cpf]' },
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
// Places — by name, never by id. The session registry forgets a closed session (it keeps the last few), so the
// mirror remembers every name it has seen (`withPlaceMemory`): a task of a place closed yesterday keeps its name.

/** What the board says of a place: its role (the card) and its name (its session's name), when known. */
export interface PlaceInfo {
  readonly roleId?: string;
  readonly name?: string;
}

export type PlaceInfoOf = (projectPath: string, placeId: string) => PlaceInfo | undefined;

/**
 * `live` (read once per push) completed by `memory` (placeId → the last name and role seen), which it also feeds.
 * `onLearn` runs when the memory changed, for the caller to save it.
 */
export function withPlaceMemory(live: () => PlaceInfoOf | undefined, memory: Map<string, PlaceInfo>, onLearn?: () => void): () => PlaceInfoOf {
  return () => {
    const now = live();
    return (projectPath, placeId) => {
      const seen = now?.(projectPath, placeId);
      const kept = memory.get(placeId);
      const merged: PlaceInfo = {
        ...((seen?.roleId ?? kept?.roleId) ? { roleId: seen?.roleId ?? kept?.roleId } : {}),
        ...((seen?.name?.trim() || kept?.name) ? { name: seen?.name?.trim() || kept?.name } : {}),
      };
      if (merged.name !== kept?.name || merged.roleId !== kept?.roleId) {
        if (merged.name || merged.roleId) {
          memory.set(placeId, merged);
          onLearn?.();
        }
      }
      return merged.name || merged.roleId ? merged : undefined;
    };
  };
}

/**
 * Ledger v5, fatia 3 — the names of the places a ledger mentions, as plain data for the renderer (the table of the
 * Oráculo names them as the mirror does): projectPath → placeId → what the board, or the mirror's memory, says.
 */
export type LedgerPlacesMap = Readonly<Record<string, Readonly<Record<string, PlaceInfo>>>>;

/** Every place `doc` mentions (owner, authors, transfers, who did a delivery), looked up once each. */
export function placesOfDoc(doc: LedgerDoc, places: PlaceInfoOf): LedgerPlacesMap {
  const out: Record<string, Record<string, PlaceInfo>> = {};
  const add = (projectPath: string, placeId: string | undefined): void => {
    if (!placeId) return;
    const board = (out[projectPath] ??= {});
    if (placeId in board) return;
    const info = places(projectPath, placeId);
    if (info) board[placeId] = { ...(info.roleId ? { roleId: info.roleId } : {}), ...(info.name ? { name: info.name } : {}) };
  };
  for (const task of Object.values(doc.tasks)) {
    add(task.projectPath, task.ownerPlaceId);
    for (const event of task.events) {
      if (event.by.kind === 'lugar') add(task.projectPath, event.by.placeId);
      add(task.projectPath, doneByOf(event));
    }
    for (const transfer of transfersOf(task)) {
      add(task.projectPath, transfer.from);
      add(task.projectPath, transfer.to);
    }
  }
  return out;
}

/** The lookup over a `LedgerPlacesMap`; `liveName` (the renderer's own session names) fills a name the map lacks. */
export function placeInfoOfMap(map: LedgerPlacesMap, liveName?: (projectPath: string, placeId: string) => string | undefined): PlaceInfoOf {
  return (projectPath, placeId) => {
    const kept = map[projectPath]?.[placeId];
    const name = kept?.name ?? liveName?.(projectPath, placeId)?.trim();
    if (!kept?.roleId && !name) return undefined;
    return { ...(kept?.roleId ? { roleId: kept.roleId } : {}), ...(name ? { name } : {}) };
  };
}

const ROLE_NAMES: Readonly<Record<string, string>> = {
  dev: 'Dev',
  revisor: 'Revisor',
  pesquisa: 'Pesquisa',
  lider: 'Líder',
  curador: 'Curador',
};

/** "dev" → "Dev", "revisor-2" → "Revisor", "theo-west" → "Theo West". */
function roleName(roleId: string | undefined): string | undefined {
  const role = roleId?.trim();
  if (!role) return undefined;
  const known = ROLE_NAMES[role] ?? ROLE_NAMES[role.split('-')[0]!];
  if (known) return known;
  return role
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

/** "Dev · Mindscape de cadeiras": the role, then the name (once, when the name already starts with the role). */
export function placeLabel(projectPath: string, placeId: string, roleHint: string | undefined, places: PlaceInfoOf | undefined): string {
  if (placeId === LEADER_OF_ALL) return 'Líder único';
  const info = places?.(projectPath, placeId);
  const role = roleName(info?.roleId ?? roleHint);
  const name = info?.name?.trim();
  // A generic role says nothing alone ("Dev" was the complaint); an agent's own role is already its name ("Theo West").
  if (!name) return !role ? 'lugar sem nome' : Object.values(ROLE_NAMES).includes(role) ? `${role} (sem nome)` : role;
  if (!role || name.toLowerCase().startsWith(role.toLowerCase())) return name;
  return `${role} · ${name}`;
}

export function actorName(actor: LedgerActor | undefined, projectPath: string, places: PlaceInfoOf | undefined, ownerName: string): string {
  if (!actor) return 'não registrado';
  if (actor.kind === 'dono') return ownerName;
  return placeLabel(projectPath, actor.placeId, actor.roleId, places);
}

/** The owner place's role, read from its own steps (who took or delivered it). */
function ownerRoleFromSteps(task: LedgerTask): string | undefined {
  for (const event of task.events) if (event.by.kind === 'lugar' && event.by.placeId === task.ownerPlaceId && event.by.roleId) return event.by.roleId;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Who asked — a person, declared, never guessed (owner, 07/11). What the creator said (`quemPediu`) wins; for the
// tasks before it, only what the ledger states: the owner created it, the Slack letter's person, a Curador signal.
// A quote "(dono, 05/11)" anywhere in a request is the source of a rule, not who asked; a role is never a person;
// and a task the Líder created without `quemPediu` is "não registrado", not "the owner".

const QUOTE_SOURCES = 'dono|Revisor|Líder|Lider|Curador|Pesquisa|Dev';

/** The source a Curador signal quotes: "(Revisor, PR #219, Ressalva 1)" → "Revisor, PR #219". */
function signalSource(request: string): string | null {
  const match = new RegExp(`\\((${QUOTE_SOURCES})\\b[\\s,;:·]*([^)]*)\\)`, 'i').exec(request);
  if (!match) return null;
  const who = match[1]!.toLowerCase() === 'dono' ? 'dono' : (roleName(match[1]!.toLowerCase()) ?? match[1]!);
  const source = match[2]!.split(/[;:"«]| — /)[0]!.split(',')[0]!.trim();
  const short = source.length > 60 ? `${source.slice(0, 59)}…` : source;
  return [who, short].filter(Boolean).join(', ');
}

/** The person a Slack letter answers: the person of a DM, «Fulano: assunto», "thread do Fulano". */
function slackPerson(task: LedgerTask): string {
  const slack = task.slack!;
  const label = slackDestinationLabel(slack).trim();
  // A DM names the person in full ("Gabriel Horst (DM)"); the «topic» may carry a nickname («Horst: …»).
  if (!label.startsWith('#') && !/^[CGUD][A-Z0-9]{6,}$/.test(label)) return `${label.replace(/\s*\(DM\)\s*$/, '').trim()} (Slack)`;
  const topic = /«([^:»]{2,60}):/.exec(slack.reason);
  if (topic) return `${topic[1]!.trim()} (Slack)`;
  const thread = /thread d[aoe]s? ([^(),]+?)(?: de \d|[(),]|$)/.exec(label);
  if (thread) return `${thread[1]!.trim()} (Slack)`;
  return `Slack: ${label}`;
}

export function whoAsked(task: LedgerTask, places: PlaceInfoOf | undefined, ownerName: string): string {
  const said = requestedByOf(task);
  if (said) return said === ASKED_BY_OWNER ? ownerName : said;
  const creator = task.events.find((event) => event.kind === 'criada')?.by;
  if (creator?.kind === 'dono') return ownerName;
  if (task.slack) return slackPerson(task);
  if (isAgentBotRecord(task)) return 'ninguém: post do bot do agente';
  const creatorRole = creator?.kind === 'lugar' ? (creator.roleId ?? places?.(task.projectPath, creator.placeId)?.roleId) : undefined;
  if (creatorRole?.split('-')[0] === 'curador') {
    const source = signalSource(task.request);
    return source ? `sinal do Curador: ${source}` : 'sinal do Curador';
  }
  return 'não registrado';
}

// ---------------------------------------------------------------------------------------------------------------
// Rows

/** A masked field, noted in `masked` (task id + field + kind) for the log. */
export interface MaskNote {
  readonly taskId: string;
  readonly field: string;
  readonly kinds: readonly string[];
}

const iso = (ms: number | undefined): string | null => (ms === undefined ? null : new Date(ms).toISOString());

const clipCell = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The board's name: the project folder's last segment ("Donel Dev"). */
export function boardName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

export interface TarefaRowOptions {
  /** How the owner is named ("Alexandre"); default `DEFAULT_OWNER_NAME`. */
  readonly ownerName?: string;
}

export function tarefaRow(doc: LedgerDoc, task: LedgerTask, places: PlaceInfoOf | undefined, masked: MaskNote[], options: TarefaRowOptions = {}): TarefaRow {
  const ownerName = options.ownerName?.trim() || DEFAULT_OWNER_NAME;
  const mask = (field: string, value: string): string => {
    const result = maskSecrets(value);
    if (result.hits.length > 0) masked.push({ taskId: task.id, field, kinds: [...new Set(result.hits.map((hit) => hit.kind))] });
    return result.text;
  };
  const project = task.projectPath;
  const created = task.events.find((event) => event.kind === 'criada');
  const delivery = lastDelivery(task);
  const decision = lastDecision(task);
  const proofs = delivery?.proofs ?? [];
  const texts = proofs.flatMap((proof) => (proof.kind === 'texto' ? [proof.text] : []));
  const link = proofs.find((proof) => proof.kind === 'link');
  const files = proofs.filter((proof) => proof.kind === 'arquivo').length;
  const proofText = [...texts, ...(files > 0 ? [`(${files === 1 ? '1 arquivo' : `${files} arquivos`} de prova só no app)`] : [])].join('\n\n');
  const nameOf = (projectPath: string, placeId: string): string | undefined => places?.(projectPath, placeId)?.name;
  const gist = delivery ? (delivery.forOwner?.summary ?? deliveryNote(delivery, project, nameOf) ?? texts[0] ?? null) : null;
  const decidedBy = decision ? actorName(decision.by, project, places, ownerName) : null;
  // Ledger v5, fatia 4: a "cancel" that was really done, sent or replaced says so (read from the reason, never written).
  const closing = closingOf(task);
  const decisionLabel = decision
    ? closing && closing.kind !== 'cancelada'
      ? `${closing.kind === 'substituida' && closing.replacedBy ? `substituída pela ${closing.replacedBy}` : CLOSING_LABELS[closing.kind]} · fechada por ${decidedBy}`
      : isCancelled(task)
        ? `cancelada por ${decidedBy}`
        : `${decision.kind} por ${decidedBy}${decision.option ? ` · ${decision.option}` : ''}`
    : null;
  const reason = decision ? (eventNote(decision) ?? null) : null;
  const state = viewState(task);
  return {
    quadro: boardName(project),
    titulo: mask('titulo', task.title ?? task.request.split('\n')[0]!.slice(0, 60)),
    estado: awaitsSend(task) ? 'aceita, esperando envio' : closing ? CLOSING_LABELS[closing.kind] : STATE_LABELS[state],
    esperando_dono: waitsForOwner(doc, task),
    quem_pediu: mask('quem_pediu', whoAsked(task, places, ownerName)),
    pedido: mask('pedido', withoutMarks(task.request)),
    quem_faz_agora: placeLabel(project, task.ownerPlaceId, ownerRoleFromSteps(task), places),
    quem_criou: actorName(created?.by, project, places, ownerName),
    risco: task.risk,
    prazo: task.due,
    ultima_entrega: gist ? mask('ultima_entrega', clipCell(gist.replace(/\s+/g, ' ').trim(), MAX_ROW_SUMMARY_CHARS)) : null,
    link_da_prova: link?.kind === 'link' ? mask('link_da_prova', link.url) : null,
    decisao: decisionLabel,
    motivo: reason === null ? null : mask('motivo', reason),
    criada_em: iso(task.createdAt)!,
    entregue_em: iso(delivery?.at),
    decidida_em: iso(decision?.at),
    prova_texto: proofText ? mask('prova_texto', clipCell(proofText, MAX_ROW_PROOF_CHARS)) : null,
    id: task.id,
  };
}

/** Every task, oldest first. `masked` lists what the scan replaced (for the log). */
export function tarefaRows(doc: LedgerDoc, places?: PlaceInfoOf, options: TarefaRowOptions = {}): { rows: TarefaRow[]; masked: MaskNote[] } {
  const masked: MaskNote[] = [];
  const rows = Object.values(doc.tasks)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((task) => tarefaRow(doc, task, places, masked, options));
  return { rows, masked };
}

// ---------------------------------------------------------------------------------------------------------------
// Preferences ↔ main

export const LEDGER_MIRROR_CHANNELS = {
  getState: 'ledger-mirror:get-state',
  configure: 'ledger-mirror:configure',
  disable: 'ledger-mirror:disable',
  syncNow: 'ledger-mirror:sync-now',
  /** Ledger v5, fatia 3 — read only: the names of the places of the ledger and the owner's name (`LedgerPlacesSnapshot`). */
  places: 'ledger-mirror:places',
} as const;

/** What the table of the Oráculo needs to name people and places as the mirror does. */
export interface LedgerPlacesSnapshot {
  /** The owner's name set in the mirror ("Alexandre"); `null` = `DEFAULT_OWNER_NAME`. */
  readonly ownerName: string | null;
  readonly places: LedgerPlacesMap;
}

/** What the Preferences show. The key never leaves the main: only whether it is in the vault. */
export interface LedgerMirrorState {
  readonly enabled: boolean;
  readonly url: string | null;
  /** How the owner is named in "quem pediu" and "decisão" ("Alexandre"); `null` = `DEFAULT_OWNER_NAME`. */
  readonly ownerName: string | null;
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
  /** `key` empty = keep the one in the vault; `ownerName` empty = "Dono". */
  configure(url: string, key: string, ownerName?: string): Promise<LedgerMirrorConfigureResult>;
  disable(): Promise<LedgerMirrorState>;
  syncNow(): Promise<LedgerMirrorState>;
  /** Ledger v5, fatia 3 — read only; works with the mirror off too. */
  places(): Promise<LedgerPlacesSnapshot>;
}

/** `https://<ref>.supabase.co` — the only shape accepted (no path, no query). */
export function isSupabaseUrl(value: string): boolean {
  return /^https:\/\/[a-z0-9-]{6,40}\.supabase\.co$/.test(value.trim().replace(/\/+$/, ''));
}
