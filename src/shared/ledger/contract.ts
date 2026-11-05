// Ledger com prova (PDA mindscape-openrig, item 19; decisions D1/D2 of the owner, 04/11) — THE contract.
//
// What it is: one registry of the tasks between places (sessions with a role), in `<userData>/ledger.json`,
// written ONLY by the main (`src/main/ledger-store.ts`). Sessions reach it through the MCP server `donel`
// (`tarefa_*`, `tools.ts`); the owner through the app (the strip on top of the Mindscape) and, next, the phone
// (an HTTP port of the main on the Tailscale network). Every port calls the same pure `applyLedgerOp` below,
// so the rules never depend on who is asking.
//
// Rules that live here, in code, never in a prompt:
// - a task walks aberta → em-execucao → entregue → aceita | rejeitada; a rejected task may be taken again
//   (rework: rejeitada → em-execucao), the history keeps every round;
// - `entregue` needs at least one proof (`LedgerProof`): a file COPIED into `<userData>/ledger-provas/`
//   (print or video; only its file name is stored, never a path pointing outside), a command output (text)
//   or a link (the CI run);
// - whoever delivered never accepts nor rejects that delivery;
// - who accepts: the owner ("dono") any task; a place with the Revisor role only low risk (D2);
// - every decision records its author (`LedgerActor`), so an accept by the owner on the phone counts as human
//   validation and "validadas sem você" can be measured.
//
// Consumers (e.g. "Rotinas em sombra", item 20) read the document with `parseLedgerDoc` and the numbers with
// `ledgerStrip`; they never write the file — a write goes through the main (`LedgerService.apply`).

/**
 * Bump on any new field: the parse drops what it does not know and `userData` is shared by the channels.
 * 2 — `requestId` on a decision (the phone's request id: a retry after a restart never records twice).
 */
export const LEDGER_SCHEMA_VERSION = 2;

export type LedgerTaskState = 'aberta' | 'em-execucao' | 'entregue' | 'aceita' | 'rejeitada';
export type LedgerRisk = 'baixo' | 'alto';

/** Who did something: the owner (any port the owner uses: the app, the phone) or a place of a board. */
export type LedgerActor =
  | { readonly kind: 'dono' }
  | { readonly kind: 'lugar'; readonly placeId: string; readonly roleId?: string };

/** A delivery's proof. A file is only a name inside `<userData>/ledger-provas/` (`isProofFileName`). */
export type LedgerProof =
  | { readonly kind: 'arquivo'; readonly file: string; readonly mediaType: string }
  | { readonly kind: 'texto'; readonly text: string }
  | { readonly kind: 'link'; readonly url: string };

export type LedgerEventKind = 'criada' | 'assumida' | 'entregue' | 'aceita' | 'rejeitada' | 'conferida';

export interface LedgerEvent {
  readonly kind: LedgerEventKind;
  readonly at: number;
  readonly by: LedgerActor;
  /** `entregue`: what was delivered. */
  readonly proofs?: readonly LedgerProof[];
  /** `entregue`: optional note of who delivered; `rejeitada`: the reason (required). */
  readonly text?: string;
  /** v2 — a decision sent by a port that retries (the phone): its request id, to answer a retry from the ledger. */
  readonly requestId?: string;
}

export interface LedgerTask {
  readonly id: string;
  /** The board (project folder) where the task was born; the strip of that board counts it. */
  readonly projectPath: string;
  /** The literal sentence of who asked. */
  readonly request: string;
  /** Done when… */
  readonly doneWhen: string;
  /** `AAAA-MM-DD`. */
  readonly due: string;
  /** The place that owns the work (only it takes and delivers). */
  readonly ownerPlaceId: string;
  readonly risk: LedgerRisk;
  readonly state: LedgerTaskState;
  readonly createdAt: number;
  /** Every step, oldest first; the current delivery and decision are the last ones of their kind. */
  readonly events: readonly LedgerEvent[];
}

export interface LedgerDoc {
  readonly schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  /** First task ever (ms); starts the first week of D2 (daily sample). `null` = empty ledger. */
  readonly startedAt: number | null;
  readonly tasks: Readonly<Record<string, LedgerTask>>;
}

export function emptyLedgerDoc(): LedgerDoc {
  return { schemaVersion: LEDGER_SCHEMA_VERSION, startedAt: null, tasks: {} };
}

// ---------------------------------------------------------------------------------------------------------------
// Limits and helpers

export const MAX_REQUEST_CHARS = 4000;
export const MAX_PROOF_TEXT_CHARS = 20_000;
export const MAX_PROOFS = 5;
export const MAX_PROOF_FILE_BYTES = 50 * 1024 * 1024;
/** D2 — the owner gets a daily sample of the Revisor's accepts during the first week. */
export const SAMPLE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SAMPLE_PER_DAY = 3;

/** Extension → media type of a proof file (print or video). */
export const PROOF_FILE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** A name the main gave inside `ledger-provas/`: no folder, no `..`, a known extension. */
export function isProofFileName(name: string): boolean {
  const match = /^[a-z0-9-]{8,80}\.([a-z0-9]{2,5})$/.exec(name);
  return match !== null && match[1]! in PROOF_FILE_TYPES;
}

export function isDueDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isReviewerRole(roleId: string | undefined): boolean {
  return roleId === 'revisor' || (roleId?.startsWith('revisor-') ?? false);
}

export function sameActor(a: LedgerActor | undefined, b: LedgerActor | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'dono' || (b.kind === 'lugar' && a.placeId === b.placeId);
}

function lastEvent(task: LedgerTask, kinds: readonly LedgerEventKind[]): LedgerEvent | undefined {
  for (let i = task.events.length - 1; i >= 0; i -= 1) if (kinds.includes(task.events[i]!.kind)) return task.events[i];
  return undefined;
}

/** The current delivery (the last `entregue`), with its proofs and its author. */
export function lastDelivery(task: LedgerTask): LedgerEvent | undefined {
  return lastEvent(task, ['entregue']);
}

/** The decision on the current delivery (`aceita` or `rejeitada`), if any. */
export function lastDecision(task: LedgerTask): LedgerEvent | undefined {
  return task.state === 'aceita' || task.state === 'rejeitada' ? lastEvent(task, ['aceita', 'rejeitada']) : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Operations — the ONE place the rules live. Pure: the caller gives the clock and the new id.

export type LedgerOp =
  | {
      readonly op: 'criar';
      readonly projectPath: string;
      readonly request: string;
      readonly doneWhen: string;
      readonly due: string;
      readonly ownerPlaceId: string;
      readonly risk: LedgerRisk;
    }
  | { readonly op: 'assumir'; readonly id: string }
  | { readonly op: 'entregar'; readonly id: string; readonly proofs: readonly LedgerProof[]; readonly note?: string }
  | { readonly op: 'aceitar'; readonly id: string; readonly requestId?: string }
  | { readonly op: 'rejeitar'; readonly id: string; readonly reason: string; readonly requestId?: string };

export interface LedgerOpContext {
  readonly now: number;
  readonly newId: () => string;
}

export type LedgerOpResult = { readonly ok: true; readonly doc: LedgerDoc; readonly task: LedgerTask } | { readonly ok: false; readonly reason: string };

function withTask(doc: LedgerDoc, task: LedgerTask): LedgerDoc {
  return { ...doc, startedAt: doc.startedAt ?? task.createdAt, tasks: { ...doc.tasks, [task.id]: task } };
}

function step(task: LedgerTask, state: LedgerTaskState, event: LedgerEvent): LedgerTask {
  return { ...task, state, events: [...task.events, event] };
}

/** Why `actor` may not decide (accept / reject) the current delivery of `task`; `null` = may. */
export function cannotDecide(task: LedgerTask, actor: LedgerActor): string | null {
  if (sameActor(lastDelivery(task)?.by, actor)) return 'quem entregou não aceita nem rejeita a própria entrega.';
  if (actor.kind === 'dono') return null;
  if (!isReviewerRole(actor.roleId)) return 'só o dono ou um lugar com papel Revisor decide uma entrega.';
  if (task.risk !== 'baixo') return 'risco alto: só o dono decide (fica em "esperando você").';
  return null;
}

/** An accept that the owner did not make, still to be looked at by the owner (D2, first week). */
function acceptedWithoutOwner(task: LedgerTask): boolean {
  return task.state === 'aceita' && lastDecision(task)?.by.kind === 'lugar';
}

function ownerChecked(task: LedgerTask): boolean {
  const decision = lastDecision(task);
  return decision !== undefined && task.events.some((event) => event.kind === 'conferida' && event.at >= decision.at);
}

export function applyLedgerOp(doc: LedgerDoc, actor: LedgerActor, op: LedgerOp, ctx: LedgerOpContext): LedgerOpResult {
  const fail = (reason: string): LedgerOpResult => ({ ok: false, reason });
  if (op.op === 'criar') {
    if (!op.request.trim()) return fail('"pedido" é obrigatório: a frase literal de quem pediu.');
    if (!op.doneWhen.trim()) return fail('"criterio" é obrigatório: quando a tarefa está pronta.');
    if (!isDueDate(op.due)) return fail('"prazo" tem de ser uma data AAAA-MM-DD.');
    if (!op.ownerPlaceId.trim()) return fail('"dono" é obrigatório: o lugar que faz o trabalho.');
    const task: LedgerTask = {
      id: ctx.newId(),
      projectPath: op.projectPath,
      request: op.request,
      doneWhen: op.doneWhen,
      due: op.due,
      ownerPlaceId: op.ownerPlaceId,
      risk: op.risk,
      state: 'aberta',
      createdAt: ctx.now,
      events: [{ kind: 'criada', at: ctx.now, by: actor }],
    };
    return { ok: true, doc: withTask(doc, task), task };
  }

  const task = doc.tasks[op.id];
  if (!task) return fail(`Não existe tarefa "${op.id}" (veja tarefa_listar).`);
  const done = (next: LedgerTask): LedgerOpResult => ({ ok: true, doc: withTask(doc, next), task: next });
  const isOwnerPlace = actor.kind === 'lugar' && actor.placeId === task.ownerPlaceId;

  switch (op.op) {
    case 'assumir':
      if (task.state !== 'aberta' && task.state !== 'rejeitada') return fail(`A tarefa está "${task.state}"; só se assume uma aberta ou rejeitada.`);
      if (!isOwnerPlace) return fail(`Só o lugar dono (${task.ownerPlaceId}) assume esta tarefa.`);
      return done(step(task, 'em-execucao', { kind: 'assumida', at: ctx.now, by: actor }));

    case 'entregar':
      if (task.state !== 'em-execucao') return fail(`A tarefa está "${task.state}"; assuma antes de entregar.`);
      if (!isOwnerPlace) return fail(`Só o lugar dono (${task.ownerPlaceId}) entrega esta tarefa.`);
      if (op.proofs.length === 0) return fail('Entrega sem prova é recusada: anexe um print, a saída de um comando ou o link do CI.');
      if (op.proofs.length > MAX_PROOFS) return fail(`No máximo ${MAX_PROOFS} provas por entrega.`);
      for (const proof of op.proofs) if (!validProof(proof)) return fail('Prova inválida: arquivo copiado pelo app, texto não vazio ou link http(s).');
      return done(step(task, 'entregue', { kind: 'entregue', at: ctx.now, by: actor, proofs: op.proofs, ...(op.note?.trim() ? { text: op.note.trim() } : {}) }));

    case 'aceitar': {
      // The owner confirming an accept the Revisor made (D2 sample) is recorded, not a second accept.
      if (task.state === 'aceita' && actor.kind === 'dono' && acceptedWithoutOwner(task)) {
        if (ownerChecked(task)) return fail('Você já conferiu este aceite.');
        return done(step(task, 'aceita', { kind: 'conferida', at: ctx.now, by: actor, ...requestOf(op) }));
      }
      if (task.state !== 'entregue') return fail(`A tarefa está "${task.state}"; só se aceita uma entregue.`);
      const why = cannotDecide(task, actor);
      if (why) return fail(`Não aceitei: ${why}`);
      return done(step(task, 'aceita', { kind: 'aceita', at: ctx.now, by: actor, ...requestOf(op) }));
    }

    case 'rejeitar': {
      if (!op.reason.trim()) return fail('"motivo" é obrigatório para rejeitar.');
      // The owner may overturn an accept the owner did not make (D2 sample).
      const overturn = task.state === 'aceita' && actor.kind === 'dono' && acceptedWithoutOwner(task);
      if (task.state !== 'entregue' && !overturn) return fail(`A tarefa está "${task.state}"; só se rejeita uma entregue.`);
      const why = cannotDecide(task, actor);
      if (why) return fail(`Não rejeitei: ${why}`);
      return done(step(task, 'rejeitada', { kind: 'rejeitada', at: ctx.now, by: actor, text: op.reason.trim(), ...requestOf(op) }));
    }
  }
}

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

function requestOf(op: { readonly requestId?: string }): { requestId?: string } {
  return isRequestId(op.requestId) ? { requestId: op.requestId } : {};
}

/** The decision a request already recorded on `task` (a retry), if any. */
export function decisionOfRequest(task: LedgerTask, requestId: string): LedgerEvent | undefined {
  return task.events.find((event) => event.requestId === requestId && (event.kind === 'aceita' || event.kind === 'rejeitada' || event.kind === 'conferida'));
}

function validProof(proof: LedgerProof): boolean {
  switch (proof.kind) {
    case 'arquivo':
      return isProofFileName(proof.file) && Object.values(PROOF_FILE_TYPES).includes(proof.mediaType);
    case 'texto':
      return proof.text.trim().length > 0 && proof.text.length <= MAX_PROOF_TEXT_CHARS;
    case 'link':
      return isHttpUrl(proof.url);
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What waits for the owner, and the strip of numbers on top of the board

/** D2 — the Revisor's accepts the owner gets to look at: in the first week, up to 3 per day, not checked yet. */
export function inDailySample(doc: LedgerDoc, task: LedgerTask): boolean {
  if (doc.startedAt === null || !acceptedWithoutOwner(task) || ownerChecked(task)) return false;
  const decidedAt = lastDecision(task)!.at;
  if (decidedAt - doc.startedAt >= SAMPLE_WEEK_MS) return false;
  const day = Math.floor((decidedAt - doc.startedAt) / (24 * 60 * 60 * 1000));
  const sameDay = Object.values(doc.tasks)
    .filter((other) => acceptedWithoutOwner(other))
    .map((other) => ({ id: other.id, at: lastDecision(other)!.at }))
    .filter((other) => Math.floor((other.at - doc.startedAt!) / (24 * 60 * 60 * 1000)) === day)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(0, SAMPLE_PER_DAY);
  return sameDay.some((other) => other.id === task.id);
}

/** "Esperando você": high-risk deliveries, and the daily sample of the Revisor's accepts. */
export function waitsForOwner(doc: LedgerDoc, task: LedgerTask): boolean {
  return (task.state === 'entregue' && task.risk === 'alto') || inDailySample(doc, task);
}

/** Since when the task waits for the owner (the delivery, or the accept under sample). */
export function waitingSince(task: LedgerTask): number {
  return task.state === 'aceita' ? (lastDecision(task)?.at ?? task.createdAt) : (lastDelivery(task)?.at ?? task.createdAt);
}

export interface LedgerStrip {
  readonly total: number;
  readonly open: number;
  readonly running: number;
  /** Delivered, no decision yet (any risk). */
  readonly deliveredUnaccepted: number;
  readonly waitingForOwner: number;
  /** When the oldest one waiting for the owner started waiting (ms); `null` = none. */
  readonly oldestWaitingSince: number | null;
  /** Accepted tasks whose accept was not the owner's, 0–100; `null` = nothing accepted yet. */
  readonly validatedWithoutOwnerPct: number | null;
}

/** The numbers of one board (`projectPath`), or of every board when `projectPath` is `null`. */
export function ledgerStrip(doc: LedgerDoc, projectPath: string | null): LedgerStrip {
  const tasks = Object.values(doc.tasks).filter((task) => projectPath === null || task.projectPath === projectPath);
  const waiting = tasks.filter((task) => waitsForOwner(doc, task));
  const accepted = tasks.filter((task) => task.state === 'aceita');
  return {
    total: tasks.length,
    open: tasks.filter((task) => task.state === 'aberta').length,
    running: tasks.filter((task) => task.state === 'em-execucao').length,
    deliveredUnaccepted: tasks.filter((task) => task.state === 'entregue').length,
    waitingForOwner: waiting.length,
    oldestWaitingSince: waiting.length ? Math.min(...waiting.map(waitingSince)) : null,
    validatedWithoutOwnerPct: accepted.length ? Math.round((100 * accepted.filter(acceptedWithoutOwner).length) / accepted.length) : null,
  };
}

/** The tasks waiting for the owner, oldest first (the list the strip opens; the phone feed, next). */
export function ownerQueue(doc: LedgerDoc, projectPath: string | null): LedgerTask[] {
  return Object.values(doc.tasks)
    .filter((task) => (projectPath === null || task.projectPath === projectPath) && waitsForOwner(doc, task))
    .sort((a, b) => waitingSince(a) - waitingSince(b));
}

// ---------------------------------------------------------------------------------------------------------------
// Parse — what the disk (or another channel) hands back. Drops what it does not know.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): value is string {
  return typeof value === 'string';
}

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseActor(raw: unknown): LedgerActor | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'dono') return { kind: 'dono' };
  if (raw.kind === 'lugar' && str(raw.placeId) && raw.placeId) return { kind: 'lugar', placeId: raw.placeId, ...(str(raw.roleId) ? { roleId: raw.roleId } : {}) };
  return null;
}

function parseProof(raw: unknown): LedgerProof | null {
  if (!isRecord(raw)) return null;
  const proof: LedgerProof | null =
    raw.kind === 'arquivo' && str(raw.file) && str(raw.mediaType)
      ? { kind: 'arquivo', file: raw.file, mediaType: raw.mediaType }
      : raw.kind === 'texto' && str(raw.text)
        ? { kind: 'texto', text: raw.text }
        : raw.kind === 'link' && str(raw.url)
          ? { kind: 'link', url: raw.url }
          : null;
  return proof && validProof(proof) ? proof : null;
}

const EVENT_KINDS: readonly LedgerEventKind[] = ['criada', 'assumida', 'entregue', 'aceita', 'rejeitada', 'conferida'];
const STATES: readonly LedgerTaskState[] = ['aberta', 'em-execucao', 'entregue', 'aceita', 'rejeitada'];

function parseEvent(raw: unknown): LedgerEvent | null {
  if (!isRecord(raw) || !EVENT_KINDS.includes(raw.kind as LedgerEventKind) || !num(raw.at)) return null;
  const by = parseActor(raw.by);
  if (!by) return null;
  const proofs = Array.isArray(raw.proofs) ? raw.proofs.map(parseProof).filter((proof): proof is LedgerProof => proof !== null) : undefined;
  if (raw.kind === 'entregue' && !proofs?.length) return null;
  return {
    kind: raw.kind as LedgerEventKind,
    at: raw.at,
    by,
    ...(raw.kind === 'entregue' ? { proofs } : {}),
    ...(str(raw.text) ? { text: raw.text } : {}),
    ...(isRequestId(raw.requestId) ? { requestId: raw.requestId } : {}),
  };
}

function parseTask(id: string, raw: unknown): LedgerTask | null {
  if (!isRecord(raw)) return null;
  const { projectPath, request, doneWhen, due, ownerPlaceId, risk, state, createdAt } = raw;
  if (!str(projectPath) || !str(request) || !str(doneWhen) || !str(due) || !isDueDate(due) || !str(ownerPlaceId)) return null;
  if ((risk !== 'baixo' && risk !== 'alto') || !STATES.includes(state as LedgerTaskState) || !num(createdAt)) return null;
  const events = Array.isArray(raw.events) ? raw.events.map(parseEvent).filter((event): event is LedgerEvent => event !== null) : [];
  return { id, projectPath, request, doneWhen, due, ownerPlaceId, risk, state: state as LedgerTaskState, createdAt, events };
}

export function parseLedgerDoc(raw: unknown): LedgerDoc {
  const doc = emptyLedgerDoc();
  if (!isRecord(raw) || !isRecord(raw.tasks)) return doc;
  const tasks: Record<string, LedgerTask> = {};
  for (const [id, taskRaw] of Object.entries(raw.tasks)) {
    const task = parseTask(id, taskRaw);
    if (task) tasks[id] = task;
  }
  return { ...doc, startedAt: num(raw.startedAt) ? raw.startedAt : null, tasks };
}

/** Another (newer) channel wrote the file: read it, never write over it. */
export function isNewerLedger(raw: unknown): boolean {
  return isRecord(raw) && num(raw.schemaVersion) && raw.schemaVersion > LEDGER_SCHEMA_VERSION;
}
