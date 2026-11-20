// Vigia de travas, fase 1 (t-f15b71a7; docs/planos/vigia-travas.md). Every 5 min: one short ssh per remote place
// (reached? the vault's state), the sessions from the remote health, and the rules of `shared/vigia/travas.ts`. A
// lock seen in two rounds in a row opens ONE urgent card for the owner (high risk: the Oráculo sends the push with the
// highest urgency); when it passes, the card is cancelled. The state lives in a file, so a restart neither repeats
// a card nor its push. No password is read or sent: curing the vault is the owner's decision (phase 2).

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { RemoteHealthReport } from '../../shared/health/remote';
import type { VigiaCofrePrefs } from '../../shared/vigia/config';
import { SERVICE_PLACE_PREFIX, SERVICE_ROLE, VIGIA_SERVICE, type LedgerActor, type LedgerForOwner, type LedgerOp, type LedgerTask } from '../../shared/ledger/contract';
import {
  buildVigiaProbeScript,
  classifySshFailure,
  detectTravas,
  parseVigiaProbe,
  parseVigiaState,
  planRound,
  VIGIA_ROUND_MS,
  type KnownSessions,
  type Passage,
  type PassedLock,
  type PendingRecord,
  type PlaceProbe,
  type RepeatCard,
  type Trava,
  type VigiaEntry,
  type VigiaState,
} from '../../shared/vigia/travas';
import {
  buildPostMortemScript,
  clockBr,
  investigationTask,
  KIND_STATE,
  liveCard,
  liveTitle,
  NO_AFFECTED,
  parsePostMortem,
  passedRecord,
  probableCause,
  REPEAT_TIMES,
  REPEAT_WINDOW_MS,
  repeatCard,
  LATE_LINE,
  type Affected,
} from '../../shared/vigia/aviso';

/** The probe's own budget: the vault command's `status` may take up to 25 s on a slow vault, plus the ssh. */
export const VIGIA_PROBE_TIMEOUT_MS = 45_000;
/** The first round waits for the app (and the remote health's first read) to settle. */
export const VIGIA_FIRST_DELAY_MS = 3 * 60_000;

export interface VigiaPlace {
  readonly id: string;
  readonly label: string;
  readonly sshTarget: string;
}

type ApplyResult = { readonly ok: true; readonly task: { readonly id: string } } | { readonly ok: false; readonly reason: string };

export interface VigiaServiceDeps {
  readonly places: () => readonly VigiaPlace[];
  readonly run: (sshTarget: string, script: string, timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;
  /** The remote health's latest reports (the sessions of each place). */
  readonly reports: () => readonly RemoteHealthReport[];
  readonly apply: (actor: LedgerActor, op: LedgerOp) => Promise<ApplyResult>;
  /**
   * The Oráculo's tasks, to adopt the live card another vigia (the PC's or the daemon's) already opened for the same
   * lock instead of opening a second one (t-ffbf8e7d). Absent or throwing = nothing to adopt.
   */
  readonly tasks?: () => readonly LedgerTask[];
  /** The board of the cards (`vigiaBoardOf`); `null` = no board: no card, the native warning only. */
  readonly projectPath: () => string | null;
  /** The board (its name) of a session, for the card of a loop. */
  readonly boardOfSession?: (sid: string) => string | undefined;
  /**
   * The place (on its board) of a session, to tell which work in the Oráculo stopped with it (t-0358187b). Absent =
   * the warning names the sessions only.
   */
  readonly placeOfSession?: (sid: string) => { readonly projectPath: string; readonly placeId: string } | undefined;
  /** The optional vault adapter (`vigia.cofre` in the config); `null` = no vault check at all. */
  readonly cofre: () => VigiaCofrePrefs | null;
  /**
   * A native notification on the PC. Used when the card cannot be made — above all when the place that hosts the
   * Oráculo is the one that fell: then neither the card nor the phone's push can leave it.
   */
  readonly notify: (title: string, body: string) => void;
  readonly statePath: string;
  /**
   * The place whose vault and sessions the Oráculo's daemon watches itself (t-ffbf8e7d: it warns with the PC off), so
   * the PC does not open the same card twice. The PC still tells when that place falls or asks for a login: the daemon
   * cannot see its own death. `null` or absent = the PC watches everything.
   */
  readonly delegated?: () => string | null;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface VigiaService {
  start(): void;
  stop(): void;
  /** One round now (tests; the timer calls it every 5 min). */
  round(): Promise<void>;
}

/** A service's place: its card never turns orphan, and it may cancel what it opened. */
const VIGIA_PLACE = `${SERVICE_PLACE_PREFIX}${VIGIA_SERVICE}`;
const ACTOR: LedgerActor = { kind: 'lugar', placeId: VIGIA_PLACE, roleId: SERVICE_ROLE };

const DONE_WHEN = 'A trava passou (o vigia cancela a carta sozinho) ou o dono decidiu.';
const RECORD_DONE_WHEN = 'Registro de uma trava que passou sozinha: fecha sozinho, não pede decisão.';
const REPEAT_DONE_WHEN = 'O dono decidiu se a trava que se repete vai ser investigada.';
const REQUEST = 'vc tem que saber quando isso acontece e, travamentos assim que congelam tudo, deve ser avisado no oráculo ou com máxima prioridade (dono, 06/11)';
const KEY_OF_DONE_WHEN = /\(chave da trava: ([^()\n]+)\)$/;

/** The criterion of a live lock's card carries the lock's key, so the PC and the daemon find the same card. */
function doneWhenOf(key: string | null): string {
  return key === null ? DONE_WHEN : `${DONE_WHEN} (chave da trava: ${key})`;
}

function isLive(task: LedgerTask): boolean {
  return task.state === 'aberta' || task.state === 'em-execucao' || task.state === 'entregue';
}

/** The vigia's live cards for this lock (any vigia's: the PC and the daemon share the service place). */
function liveVigiaCards(tasks: readonly LedgerTask[], key: string): string[] {
  return tasks
    .filter((task) => task.ownerPlaceId === VIGIA_PLACE && isLive(task) && KEY_OF_DONE_WHEN.exec(task.doneWhen)?.[1] === key)
    .map((task) => task.id);
}

/** The vigia's live card for this lock, or `null`. */
export function liveVigiaCard(tasks: readonly LedgerTask[], key: string): string | null {
  return liveVigiaCards(tasks, key)[0] ?? null;
}

/**
 * The owner's decision on this lock: the most recent vigia card of the key, if the owner closed it (accepted or
 * rejected). A vigia that takes the lock over keeps it as its card instead of opening another one, while the lock
 * lasts — the same as when there is no handover (`planRound` keeps a card the owner closed).
 */
function ownerDecidedCard(tasks: readonly LedgerTask[], key: string): LedgerTask | null {
  let latest: LedgerTask | null = null;
  for (const task of tasks) {
    if (task.ownerPlaceId !== VIGIA_PLACE || KEY_OF_DONE_WHEN.exec(task.doneWhen)?.[1] !== key) continue;
    if (latest === null || task.createdAt > latest.createdAt) latest = task;
  }
  const last = latest?.events[latest.events.length - 1];
  return last && (last.kind === 'aceita' || last.kind === 'rejeitada') && last.by.kind === 'dono' ? latest : null;
}

/** The PC's clock and the Oráculo's (on the VPS) may differ a little. */
const CLOCK_SKEW_MS = 60_000;

/**
 * The card in the state is checked against the Oráculo each round (the state may come from another ledger: during
 * the Oráculo's return to the PC the daemon reads a stale copy). A dead card is swapped for the live one of the same
 * lock; with none, a card the vigia itself cancelled is dropped, so the normal flow adopts or opens one. A card the
 * owner closed stays: his decision holds while the lock lasts. An unknown card with no live one stays too.
 */
function reconcileCards(open: Readonly<Record<string, VigiaEntry>>, tasks: readonly LedgerTask[]): Record<string, VigiaEntry> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return Object.fromEntries(
    Object.entries(open).map(([key, entry]) => {
      if (entry.cartaId === null || entry.endedAt !== null) return [key, entry];
      const card = byId.get(entry.cartaId);
      if (card && isLive(card)) return [key, entry];
      const live = liveVigiaCard(tasks, key);
      if (live !== null) return [key, { ...entry, cartaId: live }];
      const last = card?.events[card.events.length - 1];
      const cancelledByVigia = last?.kind === 'rejeitada' && last.by.kind === 'lugar' && last.by.placeId === VIGIA_PLACE;
      return [key, cancelledByVigia ? { ...entry, cartaId: null } : entry];
    }),
  );
}

function lastLine(text: string): string {
  const lines = text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? '';
}

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** "17/11 14:32" in Brasília time — when the lock was first seen (the card may be made later, when the Oráculo answers). */
export function vigiaClock(at: number): string {
  return clockBr(at);
}

/** The post-mortem's own budget: `sar` and the kernel log answer in seconds. */
export const VIGIA_POST_MORTEM_TIMEOUT_MS = 30_000;
/** The queue of records waiting for the Oráculo never grows past this (the oldest go first). */
const MAX_PENDING_RECORDS = 50;
const MAX_KNOWN_SESSIONS = 30;

export function createVigiaService(deps: VigiaServiceDeps): VigiaService {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((): void => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  /** `existed: false` = this vigia never watched (or its state is unreadable). */
  function readState(): { state: VigiaState; existed: boolean } {
    try {
      return { state: parseVigiaState(JSON.parse(readFileSync(deps.statePath, 'utf8'))), existed: true };
    } catch {
      return { state: { open: {} }, existed: false };
    }
  }

  function writeState(state: VigiaState): void {
    const tmp = `${deps.statePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tmp, deps.statePath);
  }

  async function probe(place: VigiaPlace): Promise<PlaceProbe> {
    try {
      const result = await deps.run(place.sshTarget, buildVigiaProbeScript(deps.cofre()), VIGIA_PROBE_TIMEOUT_MS);
      const parsed = parseVigiaProbe(result.stdout);
      if (parsed.reached) return { placeId: place.id, label: place.label, reached: true, ...(parsed.cofre ? { cofre: parsed.cofre } : {}) };
      return { placeId: place.id, label: place.label, reached: false, failure: classifySshFailure(lastLine(result.stderr), result.timedOut) };
    } catch {
      return { placeId: place.id, label: place.label, reached: false, failure: 'fora' };
    }
  }

  /** create → take → deliver; a delivery the Oráculo refuses is cancelled (a card nobody sees is no warning). */
  async function deliverTask(input: {
    readonly what: string;
    readonly projectPath: string;
    readonly at: number;
    readonly title: string;
    readonly doneWhen: string;
    readonly risk: 'alto' | 'baixo';
    readonly body: string;
    readonly note?: string;
    readonly forOwner?: LedgerForOwner;
    readonly closeAlone?: true;
  }): Promise<string | null> {
    const created = await deps.apply(ACTOR, {
      op: 'criar',
      projectPath: input.projectPath,
      title: input.title,
      request: REQUEST,
      doneWhen: input.doneWhen,
      due: today(input.at),
      ownerPlaceId: VIGIA_PLACE,
      risk: input.risk,
      requestedBy: 'vigia de travas',
    });
    if (!created.ok) {
      log(`[vigia] o Oráculo recusou ${input.what}: ${created.reason}`);
      return null;
    }
    const id = created.task.id;
    const taken = await deps.apply(ACTOR, { op: 'assumir', id });
    if (!taken.ok) {
      log(`[vigia] o Oráculo recusou assumir ${input.what}: ${taken.reason}`);
      await deps.apply(ACTOR, { op: 'cancelar', id, reason: 'a carta do vigia não pôde ser entregue' });
      return null;
    }
    const delivery = {
      op: 'entregar' as const,
      id,
      proofs: [{ kind: 'texto' as const, text: input.body }],
      ...(input.note ? { note: input.note } : {}),
      ...(input.forOwner ? { forOwner: input.forOwner } : {}),
    };
    let delivered = await deps.apply(ACTOR, input.closeAlone ? { ...delivery, closeAlone: true } : delivery);
    if (!delivered.ok && input.closeAlone) {
      // An Oráculo older than this rule refuses a service closing its own delivery: the record still goes, closed as
      // a cancelled record, so it never waits for anybody.
      log(`[vigia] o Oráculo não fechou o registro sozinho (${delivered.reason}); entrego e encerro como registro.`);
      delivered = await deps.apply(ACTOR, delivery);
      if (delivered.ok) await deps.apply(ACTOR, { op: 'cancelar', id, reason: 'registro do vigia: a trava passou sozinha e não pede decisão' });
    }
    if (delivered.ok) return id;
    log(`[vigia] o Oráculo recusou a entrega de ${input.what}: ${delivered.reason}`);
    await deps.apply(ACTOR, { op: 'cancelar', id, reason: 'a carta do vigia não pôde ser entregue' });
    return null;
  }

  /** The place's sessions before the lock and their work in the Oráculo that was running. */
  function affectedOf(placeId: string, known: Readonly<Record<string, KnownSessions>>, tasks: readonly LedgerTask[] | null): Affected {
    const seen = known[placeId];
    if (!seen) return NO_AFFECTED;
    const places = new Set<string>();
    for (const session of seen.sessions) {
      const place = deps.placeOfSession?.(session.sid);
      if (place) places.add(`${place.projectPath}\u0000${place.placeId}`);
    }
    const running = (tasks ?? []).filter((task) => task.state === 'em-execucao' && places.has(`${task.projectPath}\u0000${task.ownerPlaceId}`));
    return {
      sessions: seen.sessions.map((session) => session.name || session.sid),
      tasks: running.map((task) => ({ id: task.id, title: task.title ?? task.request.split('\n')[0]!.slice(0, 60) })),
      readAt: seen.at,
    };
  }

  /** The record of a lock that passed: the cause measured on the place now that it answers again. */
  async function recordOf(lock: PassedLock, input: { readonly known: Readonly<Record<string, KnownSessions>>; readonly tasks: readonly LedgerTask[] | null; readonly downTogether: readonly string[] }): Promise<{ record: PendingRecord; cause: string }> {
    const { trava, firstSeen, endedAt } = lock;
    let pm = null;
    if (trava.kind === 'vps-fora' || trava.kind === 'vps-login') {
      const place = deps.places().find((candidate) => candidate.id === trava.placeId);
      if (place) {
        try {
          pm = parsePostMortem((await deps.run(place.sshTarget, buildPostMortemScript(firstSeen, endedAt), VIGIA_POST_MORTEM_TIMEOUT_MS)).stdout);
        } catch {
          pm = null;
        }
      }
    }
    const cause = probableCause({ kind: trava.kind, detail: trava.detail, start: firstSeen, end: endedAt, pm, downTogether: input.downTogether });
    const words = passedRecord({ label: trava.label, kind: trava.kind, firstSeen, endedAt, cause, affected: affectedOf(trava.placeId, input.known, input.tasks) });
    return { record: { key: lock.key, trava, firstSeen, endedAt, ...words, late: false }, cause: cause.kind };
  }

  async function round(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const places = deps.places();
        const probes = await Promise.all(places.map((place) => probe(place)));
        const at = now();
        const delegated = deps.delegated?.() ?? null;
        const isDelegated = (trava: Trava): boolean => trava.placeId === delegated && (trava.kind === 'cofre' || trava.kind === 'sessoes');
        const reports = deps.reports();
        const detected = detectTravas({ probes, reports, now: at, ...(deps.boardOfSession ? { boardOfSession: deps.boardOfSession } : {}) });
        // A lock that is still there but now belongs to the daemon is handed over, not closed: its card stays alive
        // for the daemon to adopt. Only a lock that is gone is closed ("a trava passou sozinha"). The PC still sees
        // the handed-over lock, so it keeps when it first saw it (with no card): if the lock comes back to it, it can
        // tell the owner's decision on this same lock from an older one. Its passage is the daemon's to record.
        const { state: stored, existed } = readState();
        const handedOver: Record<string, VigiaEntry> = Object.fromEntries(
          detected.filter(isDelegated).map((trava) => {
            const before = stored.open[trava.key];
            const firstSeen = before && before.endedAt === null ? before.firstSeen : at;
            return [trava.key, { firstSeen, rounds: (before?.rounds ?? 0) + 1, cartaId: null, notified: false, endedAt: null, handedOver: true as const, trava }];
          }),
        );
        const kept = Object.fromEntries(Object.entries(stored.open).filter(([key]) => !(key in handedOver)));
        let tasks: readonly LedgerTask[] | null = null;
        try {
          tasks = deps.tasks ? deps.tasks() : null;
        } catch {
          tasks = null;
        }
        const checked = tasks ? reconcileCards(kept, tasks) : kept;
        const plan = planRound({ open: checked }, detected.filter((trava) => !isDelegated(trava)), at);
        const open = { ...plan.state.open };
        if (!existed && tasks) {
          // This vigia never watched before (a daemon that just got its setup): a lock it finds may be older than it,
          // and only another vigia's card can tell. The owner's decision on it holds.
          for (const [key, entry] of Object.entries(open)) {
            const decided = entry.cartaId === null ? ownerDecidedCard(tasks, key) : null;
            if (decided) open[key] = { ...entry, cartaId: decided.id };
          }
        }

        // What each place had running, read while it has no lock (a lock freezes the picture of before it).
        const locked = new Set([...detected.map((trava) => trava.placeId), ...Object.values(stored.open).filter((entry) => entry.endedAt === null).map((entry) => entry.trava.placeId)]);
        const known: Record<string, KnownSessions> = { ...(stored.sessions ?? {}) };
        for (const report of reports) {
          const reading = report.status === 'ok' ? report.reading : null;
          if (locked.has(report.id) || !reading?.sessionDetails || reading.readAt === null || reading.readAt === undefined) continue;
          known[report.id] = { at: reading.readAt, sessions: reading.sessionDetails.slice(0, MAX_KNOWN_SESSIONS).map((session) => ({ sid: session.sid, name: session.name })) };
        }

        const projectPath = deps.projectPath();
        for (const { trava, firstSeen } of plan.toOpen) {
          if (open[trava.key]!.cartaId !== null) continue;
          const decided = tasks ? ownerDecidedCard(tasks, trava.key) : null;
          // A card made after this vigia began seeing the lock is of this same lock (it never saw the lock pass since).
          const decidedHere = decided !== null && decided.createdAt >= firstSeen - CLOCK_SKEW_MS ? decided.id : null;
          const adopted = tasks ? (liveVigiaCard(tasks, trava.key) ?? decidedHere) : null;
          const card = liveCard({ label: trava.label, kind: trava.kind, firstSeen, affected: affectedOf(trava.placeId, known, tasks), detail: trava.detail });
          const id =
            adopted ??
            (projectPath === null
              ? null
              : await deliverTask({ what: `a carta (${trava.kind})`, projectPath, at, title: card.title, doneWhen: doneWhenOf(trava.key), risk: 'alto', body: card.body, forOwner: card.forOwner }));
          if (id !== null) {
            open[trava.key] = { ...open[trava.key]!, cartaId: id };
          } else if (!open[trava.key]!.notified) {
            // No card (the Oráculo did not answer): the PC itself warns, once; the card follows when it answers.
            deps.notify(liveTitle(trava.label, trava.kind, firstSeen), `${trava.label} ${KIND_STATE[trava.kind]} desde ${clockBr(firstSeen)} (horário de Brasília). O Oráculo não respondeu; o aviso sai quando ele voltar, com este horário.`);
            open[trava.key] = { ...open[trava.key]!, notified: true };
          }
        }
        for (const closed of plan.toClose) {
          // Also any other live card of the same lock (another vigia's), so none is left alive after the lock passed.
          for (const id of new Set([closed.cartaId, ...(tasks ? liveVigiaCards(tasks, closed.key) : [])])) {
            const result = await deps.apply(ACTOR, { op: 'cancelar', id, reason: 'a trava passou sozinha' });
            if (!result.ok) log(`[vigia] não cancelou a carta de uma trava que passou: ${result.reason}`);
          }
        }

        // Every lock that passed becomes a record (no question), queued until the Oráculo takes it.
        let history: Passage[] = (stored.history ?? []).filter((passage) => passage.endedAt >= at - REPEAT_WINDOW_MS);
        const records: PendingRecord[] = [...(stored.records ?? [])];
        const labelOf = (placeId: string): string => places.find((place) => place.id === placeId)?.label ?? placeId;
        for (const lock of plan.passed) {
          if (records.some((record) => record.key === lock.key && record.firstSeen === lock.firstSeen) || history.some((passage) => passage.key === lock.key && passage.firstSeen === lock.firstSeen)) continue;
          const overlaps = (start: number, end: number): boolean => start <= lock.endedAt && end >= lock.firstSeen;
          const downTogether = [
            ...history.filter((passage) => passage.kind === 'vps-fora' && passage.placeId !== lock.trava.placeId && overlaps(passage.firstSeen, passage.endedAt)).map((passage) => passage.placeId),
            ...plan.passed.filter((other) => other !== lock && other.trava.kind === 'vps-fora' && other.trava.placeId !== lock.trava.placeId && overlaps(other.firstSeen, other.endedAt)).map((other) => other.trava.placeId),
            ...Object.values(open).filter((entry) => entry.trava.kind === 'vps-fora' && entry.trava.placeId !== lock.trava.placeId && entry.rounds >= 2 && overlaps(entry.firstSeen, at)).map((entry) => entry.trava.placeId),
          ];
          const { record, cause } = await recordOf(lock, { known, tasks, downTogether: [...new Set(downTogether)].map(labelOf) });
          records.push(record);
          history = [...history, { key: lock.key, placeId: lock.trava.placeId, kind: lock.trava.kind, firstSeen: lock.firstSeen, endedAt: lock.endedAt, cause }];
        }
        const pending: PendingRecord[] = [];
        for (const record of records.slice(-MAX_PENDING_RECORDS)) {
          const body = record.late ? `${record.body}\n\n${LATE_LINE}` : record.body;
          const id = projectPath === null ? null : await deliverTask({ what: `o registro (${record.trava.kind})`, projectPath, at, title: record.title, doneWhen: RECORD_DONE_WHEN, risk: 'baixo', body, note: record.note, closeAlone: true });
          if (id === null && projectPath !== null) pending.push({ ...record, late: true });
        }

        // The same lock 3 times in 24 h on the same place: one card with a real question.
        const repeats: Record<string, RepeatCard> = Object.fromEntries(Object.entries(stored.repeats ?? {}).filter(([, card]) => !card.done || card.at >= at - REPEAT_WINDOW_MS));
        for (const lock of plan.passed) {
          const passages = history.filter((passage) => passage.key === lock.key).sort((x, y) => x.firstSeen - y.firstSeen);
          const already = repeats[lock.key];
          if (passages.length < REPEAT_TIMES || (already && already.at >= at - REPEAT_WINDOW_MS) || projectPath === null) continue;
          const card = repeatCard({ label: lock.trava.label, kind: lock.trava.kind, passages });
          const id = await deliverTask({ what: `a carta de repetição (${lock.trava.kind})`, projectPath, at, title: card.title, doneWhen: REPEAT_DONE_WHEN, risk: 'alto', body: card.body, forOwner: card.forOwner });
          if (id !== null) repeats[lock.key] = { cartaId: id, at, done: false };
        }
        // The owner's answer to a repeat card: "Investigar" opens the investigation for the Líder único.
        for (const [key, card] of Object.entries(repeats)) {
          if (card.done || !tasks || projectPath === null) continue;
          const task = tasks.find((candidate) => candidate.id === card.cartaId);
          const last = task?.events[task.events.length - 1];
          if (!task || task.state === 'entregue' || task.state === 'aberta' || task.state === 'em-execucao') continue;
          if (last?.kind === 'aceita' && last.by.kind === 'dono') {
            const entry = history.find((passage) => passage.key === key);
            const what = investigationTask(entry ? labelOf(entry.placeId) : key, entry?.kind ?? 'vps-fora', card.cartaId);
            const made = await deps.apply(ACTOR, { op: 'criar', projectPath, title: what.title, request: what.request, doneWhen: what.doneWhen, due: today(at), ownerPlaceId: 'lider', risk: 'baixo', requestedBy: 'vigia de travas, a pedido do dono na carta' });
            if (!made.ok) {
              log(`[vigia] o Oráculo recusou a investigação: ${made.reason}`);
              continue;
            }
          }
          repeats[key] = { ...card, done: true };
        }

        writeState({ open: { ...open, ...handedOver }, records: pending, history, sessions: known, repeats });
      } catch (error) {
        log(`[vigia] rodada falhou: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function schedule(ms: number): void {
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      void round().finally(() => schedule(VIGIA_ROUND_MS));
    }, ms);
    timer.unref?.();
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(VIGIA_FIRST_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    round,
  };
}
