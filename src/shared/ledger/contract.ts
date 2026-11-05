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
// - cartas forma A (spec `docs/specs/cartas-forma-a.md`, Parte C): a delivery carries the "para o dono" block
//   (`forOwner`), required on high risk; every text the owner reads is refused when it has code (`findCode`);
//   a decision by the owner records the named option it picked.
//
// Consumers (e.g. "Rotinas em sombra", item 20) read the document with `parseLedgerDoc` and the numbers with
// `ledgerStrip`; they never write the file — a write goes through the main (`LedgerService.apply`).

/**
 * Bump on any new field: the parse drops what it does not know and `userData` is shared by the channels.
 * 2 — `requestId` on a decision (the phone's request id: a retry after a restart never records twice).
 * 3 — cartas forma A: `title` on a task; `forOwner` on a delivery; `option` on a decision; the `comentada` event
 *     (the owner writing on the card) with `deliveredTo`.
 */
export const LEDGER_SCHEMA_VERSION = 3;

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

export type LedgerEventKind = 'criada' | 'assumida' | 'entregue' | 'aceita' | 'rejeitada' | 'conferida' | 'comentada';

/** v3 — one named path of the owner's decision. */
export interface LedgerOption {
  /** The option's name, the owner's button ("Aceitar com ressalva", "Esperar o limite voltar"). */
  readonly label: string;
  /** What happens if the owner picks it. */
  readonly effect: string;
  /** What can go wrong on this path. */
  readonly risk?: string;
  /** How the task closes when the owner picks it. */
  readonly closes: 'aceita' | 'rejeitada';
  readonly recommended?: true;
}

export interface LedgerCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly sentence: string;
}

/** v3 — the visual on the front of the card. Proof indexes are 0-based positions in the same delivery's proofs. */
export type LedgerVisual =
  | { readonly kind: 'prova'; readonly proof: number }
  | { readonly kind: 'antes-depois'; readonly before: number; readonly after: number }
  | { readonly kind: 'checagens'; readonly checks: readonly LedgerCheck[] };

/** v3 — the "para o dono" block of a delivery: what the card shows so the owner decides without opening a link. */
export interface LedgerForOwner {
  /** Overrides the task's title on this card. */
  readonly title?: string;
  readonly question: string;
  readonly summary: string;
  readonly options: readonly LedgerOption[];
  /** Why the recommended option. */
  readonly why: string;
  readonly risk: string;
  readonly visual?: LedgerVisual;
}

/** v3 — where the owner's writing on a card went: the place that owns the task, the Líder único, or nobody open. */
export type LedgerDeliveredTo = { readonly placeId: string } | 'lider' | null;

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
  /** v3 — `entregue`: the "para o dono" block; missing = the old card (low risk, or an older delivery). */
  readonly forOwner?: LedgerForOwner;
  /** v3 — `aceita` / `rejeitada` by the owner: the label of the option picked. */
  readonly option?: string;
  /** v3 — `comentada`: where the message went. */
  readonly deliveredTo?: LedgerDeliveredTo;
}

export interface LedgerTask {
  readonly id: string;
  /** The board (project folder) where the task was born; the strip of that board counts it. */
  readonly projectPath: string;
  /** v3 — a human name for the task (up to 60 characters). */
  readonly title?: string;
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
/** Cartas forma A — a prototype is a self-contained HTML (CSS, JS and images inside it): 2 MB at most. */
export const MAX_PROOF_HTML_BYTES = 2 * 1024 * 1024;
export const HTML_MEDIA_TYPE = 'text/html';

/** The biggest file a proof of `mediaType` may be. */
export function maxProofBytes(mediaType: string): number {
  return mediaType === HTML_MEDIA_TYPE ? MAX_PROOF_HTML_BYTES : MAX_PROOF_FILE_BYTES;
}
export const MAX_TITLE_CHARS = 60;
/** The limits of the "para o dono" block: the owner reads the front in 5 seconds. */
export const FOR_OWNER_LIMITS = { question: 160, summary: 280, label: 40, effect: 200, optionRisk: 160, why: 200, risk: 200, checkName: 40, checkSentence: 200 } as const;
/** What the owner writes on a card (dictation included). */
export const MAX_COMMENT_CHARS = 2000;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_CHECKS = 10;
/** D2 — the owner gets a daily sample of the Revisor's accepts during the first week. */
export const SAMPLE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SAMPLE_PER_DAY = 3;

/** Extension → media type of a proof file (print, video, or a prototype in HTML that the card runs isolated). */
export const PROOF_FILE_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html',
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
      readonly title?: string;
      readonly request: string;
      readonly doneWhen: string;
      readonly due: string;
      readonly ownerPlaceId: string;
      readonly risk: LedgerRisk;
    }
  | { readonly op: 'assumir'; readonly id: string }
  | { readonly op: 'entregar'; readonly id: string; readonly proofs: readonly LedgerProof[]; readonly note?: string; readonly forOwner?: LedgerForOwner }
  /** `option`: the label of an option of the current delivery's block, closing as `aceita`; `text`: the owner's words with it. */
  | { readonly op: 'aceitar'; readonly id: string; readonly requestId?: string; readonly option?: string; readonly text?: string }
  /** The owner writes on the card (forma A, Parte B): recorded, and sent by the main to whoever reads it (`deliveredTo`). */
  | { readonly op: 'comentar'; readonly id: string; readonly text: string; readonly requestId?: string; readonly deliveredTo: LedgerDeliveredTo }
  /** `option`: the label of an option closing as `rejeitada`; then `reason` may be empty (the option is a reason). */
  | { readonly op: 'rejeitar'; readonly id: string; readonly reason: string; readonly requestId?: string; readonly option?: string };

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
    const title = op.title?.trim();
    if (title) {
      const why = textRefusal('titulo', title, MAX_TITLE_CHARS);
      if (why) return fail(why);
    }
    const task: LedgerTask = {
      id: ctx.newId(),
      projectPath: op.projectPath,
      ...(title ? { title } : {}),
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
      // Answering what the owner wrote on the card is a new delivery (a new card), without taking the task again.
      if (task.state !== 'em-execucao' && !(task.state === 'entregue' && ownerWroteSinceDelivery(task)))
        return fail(
          task.state === 'entregue'
            ? 'A tarefa já está entregue; só se entrega de novo para responder ao que o dono escreveu na carta.'
            : `A tarefa está "${task.state}"; assuma antes de entregar.`,
        );
      if (!isOwnerPlace) return fail(`Só o lugar dono (${task.ownerPlaceId}) entrega esta tarefa.`);
      if (op.proofs.length === 0) return fail('Entrega sem prova é recusada: anexe um print, a saída de um comando ou o link do CI.');
      if (op.proofs.length > MAX_PROOFS) return fail(`No máximo ${MAX_PROOFS} provas por entrega.`);
      for (const proof of op.proofs) if (!validProof(proof)) return fail('Prova inválida: arquivo copiado pelo app, texto não vazio ou link http(s).');
      if (!op.forOwner && task.risk === 'alto')
        return fail('Risco alto espera o dono: a entrega precisa do bloco "paraODono" (pergunta, 2 a 4 opções com efeito, uma recomendada, porquê e risco).');
      if (op.forOwner) {
        const why = forOwnerRefusal(op.forOwner, op.proofs);
        if (why) return fail(`"paraODono" recusado: ${why}`);
      }
      return done(
        step(task, 'entregue', {
          kind: 'entregue',
          at: ctx.now,
          by: actor,
          proofs: op.proofs,
          ...(op.note?.trim() ? { text: op.note.trim() } : {}),
          ...(op.forOwner ? { forOwner: op.forOwner } : {}),
        }),
      );

    case 'aceitar': {
      // The owner confirming an accept the Revisor made (D2 sample) is recorded, not a second accept.
      if (task.state === 'aceita' && actor.kind === 'dono' && acceptedWithoutOwner(task)) {
        if (ownerChecked(task)) return fail('Você já conferiu este aceite.');
        return done(step(task, 'aceita', { kind: 'conferida', at: ctx.now, by: actor, ...requestOf(op) }));
      }
      if (task.state !== 'entregue') return fail(`A tarefa está "${task.state}"; só se aceita uma entregue.`);
      const why = cannotDecide(task, actor) ?? optionRefusal(task, op.option, 'aceita');
      if (why) return fail(`Não aceitei: ${why}`);
      return done(
        step(task, 'aceita', { kind: 'aceita', at: ctx.now, by: actor, ...requestOf(op), ...(op.option ? { option: op.option } : {}), ...(op.text?.trim() ? { text: op.text.trim() } : {}) }),
      );
    }

    case 'comentar': {
      const why = commentRefusal(task, actor, op.text);
      if (why) return fail(why);
      // A retry of the same request (the phone resent it) records nothing new.
      if (op.requestId && task.events.some((event) => event.kind === 'comentada' && event.requestId === op.requestId)) return { ok: true, doc, task };
      return done(step(task, task.state, { kind: 'comentada', at: ctx.now, by: actor, text: op.text.trim(), ...requestOf(op), deliveredTo: op.deliveredTo }));
    }

    case 'rejeitar': {
      // An option closing as `rejeitada` is already a reason: "<label>", plus the owner's words if any.
      const reason = op.option ? [op.option, op.reason.trim()].filter(Boolean).join(': ') : op.reason.trim();
      if (!reason) return fail('"motivo" é obrigatório para rejeitar.');
      // The owner may overturn an accept the owner did not make (D2 sample).
      const overturn = task.state === 'aceita' && actor.kind === 'dono' && acceptedWithoutOwner(task);
      if (task.state !== 'entregue' && !overturn) return fail(`A tarefa está "${task.state}"; só se rejeita uma entregue.`);
      const why = cannotDecide(task, actor) ?? (op.option ? optionRefusal(task, op.option, 'rejeitada') : null);
      if (why) return fail(`Não rejeitei: ${why}`);
      return done(step(task, 'rejeitada', { kind: 'rejeitada', at: ctx.now, by: actor, text: reason, ...requestOf(op), ...(op.option ? { option: op.option } : {}) }));
    }
  }
}

/** The owner wrote on the card after the current delivery: the owner place may deliver again (its answer). */
export function ownerWroteSinceDelivery(task: LedgerTask): boolean {
  const deliveredAt = lastDelivery(task)?.at ?? -Infinity;
  return task.events.some((event) => event.kind === 'comentada' && event.by.kind === 'dono' && event.at >= deliveredAt);
}

/** Why `actor` may not write `text` on the card of `task`; `null` = may. Only the owner, and not on a closed task. */
export function commentRefusal(task: LedgerTask, actor: LedgerActor, text: string): string | null {
  if (actor.kind !== 'dono') return 'só o dono escreve na carta.';
  if (!text.trim()) return 'escreva alguma coisa antes de enviar.';
  if (text.length > MAX_COMMENT_CHARS) return `texto longo demais (máximo ${MAX_COMMENT_CHARS} caracteres).`;
  if (task.state === 'aceita' && !(acceptedWithoutOwner(task) && !ownerChecked(task))) return 'a tarefa já foi aceita e fechada.';
  return null;
}

/** The note the owner wrote on the card with a given request id (a retry), if any. */
export function commentOfRequest(task: LedgerTask, requestId: string): LedgerEvent | undefined {
  return task.events.find((event) => event.kind === 'comentada' && event.requestId === requestId);
}

/** Why the owner may not pick `option` (closing as `closes`) on the current delivery; `null` = may (or no option). */
function optionRefusal(task: LedgerTask, option: string | undefined, closes: LedgerOption['closes']): string | null {
  if (option === undefined) return null;
  const found = lastDelivery(task)?.forOwner?.options.find((candidate) => candidate.label === option);
  if (!found) return `a entrega não tem a opção "${option}".`;
  if (found.closes !== closes) return `a opção "${option}" fecha a tarefa como ${found.closes}.`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// For the owner — plain language and the rules of a complete "para o dono" block

const CODE_PATTERNS: readonly RegExp[] = [
  /`[^`]*`?/,
  /\bhttps?:\/\/\S+/i,
  /\bt-[0-9a-f]{6,}\b/i,
  /\b(?:place|session|lugar|pty):[0-9a-z-]{6,}/i,
  /\b(?:feature|feat|fix|hotfix|proto|docs|chore|refactor|release|origin)\/[\w.-]+(?:\/[\w.-]+)*/i,
  /\/pull\/\d+|(?:\bPR\s*)?#\d+\b/i,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i,
  /\b[A-Z]:\\[^\s]*|[\w-]+\/[\w./-]+\.\w{1,5}\b|(?:^|\s)(?:~|\/(?:home|usr|tmp|etc|var|Users|opt|mnt))\/[^\s]*/,
];

/** The first piece of code in a text meant for the owner (id, branch, hash, PR, path, backticks, link), or `null`. */
export function findCode(text: string): string | null {
  for (const pattern of CODE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

/** Why `field` cannot go to the owner: empty, too long, or code (the message says what to write instead). */
function textRefusal(field: string, value: string, max: number): string | null {
  if (!value.trim()) return `"${field}" é obrigatório.`;
  if (value.length > max) return `"${field}" longo demais (máximo ${max} caracteres): o dono lê a frente em 5 segundos.`;
  const code = findCode(value);
  if (code)
    return `"${field}": Escreva para um humano: "${code.slice(0, 60)}" é código. Chame pelo nome (ex.: "a fase 2 da VPS", "o Dev do painel"). O código vai nas provas, que ficam em "Detalhes técnicos".`;
  return null;
}

function isFileProof(proof: LedgerProof | undefined): boolean {
  return proof?.kind === 'arquivo';
}

/** Why `forOwner` cannot go with a delivery of `proofs`; `null` = it can. Every message names the field (pt-BR). */
export function forOwnerRefusal(forOwner: LedgerForOwner, proofs: readonly LedgerProof[]): string | null {
  const L = FOR_OWNER_LIMITS;
  if (forOwner.options.length < MIN_OPTIONS || forOwner.options.length > MAX_OPTIONS)
    return `"opcoes": de ${MIN_OPTIONS} a ${MAX_OPTIONS} caminhos com nome e efeito. Se só um é defensável, decida você e registre o porquê na nota.`;
  const texts: [string, string, number][] = [
    ['pergunta', forOwner.question, L.question],
    ['resumo', forOwner.summary, L.summary],
    ['porque', forOwner.why, L.why],
    ['risco', forOwner.risk, L.risk],
  ];
  if (forOwner.title !== undefined) texts.unshift(['titulo', forOwner.title, MAX_TITLE_CHARS]);
  forOwner.options.forEach((option, i) => {
    texts.push([`opcoes[${i + 1}].rotulo`, option.label, L.label], [`opcoes[${i + 1}].efeito`, option.effect, L.effect]);
    if (option.risk !== undefined) texts.push([`opcoes[${i + 1}].risco`, option.risk, L.optionRisk]);
  });
  const visual = forOwner.visual;
  if (visual?.kind === 'checagens') {
    if (visual.checks.length === 0 || visual.checks.length > MAX_CHECKS) return `"visual.checagens": de 1 a ${MAX_CHECKS} itens.`;
    visual.checks.forEach((check, i) => {
      texts.push([`visual.checagens[${i + 1}].nome`, check.name, L.checkName], [`visual.checagens[${i + 1}].frase`, check.sentence, L.checkSentence]);
    });
  }
  for (const [field, value, max] of texts) {
    const why = textRefusal(field, value, max);
    if (why) return why;
  }
  const recommended = forOwner.options.filter((option) => option.recommended).length;
  if (recommended !== 1) return `"opcoes": exatamente 1 recomendada (veio ${recommended}).`;
  if (new Set(forOwner.options.map((option) => option.label)).size !== forOwner.options.length) return '"opcoes": dois caminhos com o mesmo nome.';
  if (visual?.kind === 'prova' && !isFileProof(proofs[visual.proof])) return `"visual.prova": a prova ${visual.proof + 1} desta entrega não é um arquivo (print, vídeo ou protótipo).`;
  if (visual?.kind === 'antes-depois' && (!isFileProof(proofs[visual.before]) || !isFileProof(proofs[visual.after]) || visual.before === visual.after))
    return '"visual": "antes" e "depois" são dois arquivos diferentes desta entrega.';
  if (!visual && proofs.some(isFileProof)) return '"visual" é obrigatório quando a entrega tem print, vídeo ou protótipo: diga qual mostrar ({"prova": n}) ou o par {"antes": n, "depois": m}.';
  return null;
}

/** The recommended option of a block (a complete block has exactly one). */
export function recommendedOption(forOwner: LedgerForOwner): LedgerOption | undefined {
  return forOwner.options.find((option) => option.recommended);
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

const EVENT_KINDS: readonly LedgerEventKind[] = ['criada', 'assumida', 'entregue', 'aceita', 'rejeitada', 'conferida', 'comentada'];

function parseVisual(raw: unknown): LedgerVisual | null {
  const index = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_PROOFS;
  if (!isRecord(raw)) return null;
  if (raw.kind === 'prova' && index(raw.proof)) return { kind: 'prova', proof: raw.proof };
  if (raw.kind === 'antes-depois' && index(raw.before) && index(raw.after)) return { kind: 'antes-depois', before: raw.before, after: raw.after };
  if (raw.kind === 'checagens' && Array.isArray(raw.checks)) {
    const checks = raw.checks.filter(isRecord).filter((check) => str(check.name) && typeof check.ok === 'boolean' && str(check.sentence));
    return checks.length ? { kind: 'checagens', checks: checks.map((check) => ({ name: check.name as string, ok: check.ok as boolean, sentence: check.sentence as string })) } : null;
  }
  return null;
}

/**
 * The block as stored. A broken field is dropped, never the delivery: a broken visual or option risk goes away;
 * without question, summary, why, risk or 2+ valid options the whole block goes (the card falls back to the old one).
 */
function parseForOwner(raw: unknown, proofs: readonly LedgerProof[]): LedgerForOwner | null {
  if (!isRecord(raw) || !Array.isArray(raw.options)) return null;
  const { title, question, summary, why, risk } = raw;
  if (!str(question) || !str(summary) || !str(why) || !str(risk)) return null;
  const options: LedgerOption[] = [];
  for (const option of raw.options) {
    if (!isRecord(option) || !str(option.label) || !str(option.effect) || (option.closes !== 'aceita' && option.closes !== 'rejeitada')) continue;
    options.push({
      label: option.label,
      effect: option.effect,
      ...(str(option.risk) ? { risk: option.risk } : {}),
      closes: option.closes,
      ...(option.recommended === true ? { recommended: true as const } : {}),
    });
  }
  if (options.length < MIN_OPTIONS) return null;
  const visual = parseVisual(raw.visual);
  const usableVisual = visual && (visual.kind === 'checagens' || (visual.kind === 'prova' ? proofs[visual.proof] : proofs[visual.before] && proofs[visual.after])) ? visual : null;
  return { ...(str(title) ? { title } : {}), question, summary, options, why, risk, ...(usableVisual ? { visual: usableVisual } : {}) };
}

function parseDeliveredTo(raw: unknown): LedgerDeliveredTo | undefined {
  if (raw === null || raw === 'lider') return raw;
  if (isRecord(raw) && str(raw.placeId) && raw.placeId) return { placeId: raw.placeId };
  return undefined;
}
const STATES: readonly LedgerTaskState[] = ['aberta', 'em-execucao', 'entregue', 'aceita', 'rejeitada'];

function parseEvent(raw: unknown): LedgerEvent | null {
  if (!isRecord(raw) || !EVENT_KINDS.includes(raw.kind as LedgerEventKind) || !num(raw.at)) return null;
  const by = parseActor(raw.by);
  if (!by) return null;
  const proofs = Array.isArray(raw.proofs) ? raw.proofs.map(parseProof).filter((proof): proof is LedgerProof => proof !== null) : undefined;
  if (raw.kind === 'entregue' && !proofs?.length) return null;
  const forOwner = raw.kind === 'entregue' ? parseForOwner(raw.forOwner, proofs ?? []) : null;
  const deliveredTo = raw.kind === 'comentada' ? parseDeliveredTo(raw.deliveredTo) : undefined;
  return {
    kind: raw.kind as LedgerEventKind,
    at: raw.at,
    by,
    ...(raw.kind === 'entregue' ? { proofs } : {}),
    ...(str(raw.text) ? { text: raw.text } : {}),
    ...(isRequestId(raw.requestId) ? { requestId: raw.requestId } : {}),
    ...(forOwner ? { forOwner } : {}),
    ...((raw.kind === 'aceita' || raw.kind === 'rejeitada') && str(raw.option) ? { option: raw.option } : {}),
    ...(deliveredTo !== undefined ? { deliveredTo } : {}),
  };
}

function parseTask(id: string, raw: unknown): LedgerTask | null {
  if (!isRecord(raw)) return null;
  const { projectPath, request, doneWhen, due, ownerPlaceId, risk, state, createdAt } = raw;
  if (!str(projectPath) || !str(request) || !str(doneWhen) || !str(due) || !isDueDate(due) || !str(ownerPlaceId)) return null;
  if ((risk !== 'baixo' && risk !== 'alto') || !STATES.includes(state as LedgerTaskState) || !num(createdAt)) return null;
  const events = Array.isArray(raw.events) ? raw.events.map(parseEvent).filter((event): event is LedgerEvent => event !== null) : [];
  const title = str(raw.title) && raw.title.trim() ? { title: raw.title } : {};
  return { id, projectPath, ...title, request, doneWhen, due, ownerPlaceId, risk, state: state as LedgerTaskState, createdAt, events };
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
