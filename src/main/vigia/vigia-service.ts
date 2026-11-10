// Vigia de travas, fase 1 (t-f15b71a7; docs/planos/vigia-travas.md). Every 5 min: one short ssh per remote place
// (reached? the vault's state), the sessions from the remote health, and the rules of `shared/vigia/travas.ts`. A
// lock seen in two rounds in a row opens ONE urgent card for the owner (high risk: the Oráculo sends the push with the
// highest urgency); when it passes, the card is cancelled. The state lives in a file, so a restart neither repeats
// a card nor its push. No password is read or sent: curing the vault is the owner's decision (phase 2).

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { RemoteHealthReport } from '../../shared/health/remote';
import type { VigiaCofrePrefs } from '../../shared/vigia/config';
import { SERVICE_PLACE_PREFIX, SERVICE_ROLE, type LedgerActor, type LedgerForOwner, type LedgerOp, type LedgerTask } from '../../shared/ledger/contract';
import {
  buildVigiaProbeScript,
  classifySshFailure,
  detectTravas,
  parseVigiaProbe,
  parseVigiaState,
  planRound,
  VIGIA_ROUND_MS,
  type PlaceProbe,
  type Trava,
  type VigiaEntry,
  type VigiaState,
} from '../../shared/vigia/travas';

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
  /** Where the card is filed (any board path; the owner sees it in the Oráculo and on the phone). */
  readonly projectPath: () => string | null;
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
const VIGIA_PLACE = `${SERVICE_PLACE_PREFIX}vigia`;
const ACTOR: LedgerActor = { kind: 'lugar', placeId: VIGIA_PLACE, roleId: SERVICE_ROLE };

const DONE_WHEN = 'A trava passou (o vigia cancela a carta sozinho) ou o dono decidiu.';
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

const CLOCK = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
/** "08/11, 14:32" — when the lock was first seen (the card may be made later, when the Oráculo answers again). */
export function vigiaClock(at: number): string {
  return CLOCK.format(at);
}

const KIND_TITLE: Record<Trava['kind'], string> = {
  'vps-fora': 'VPS fora do ar',
  'vps-login': 'VPS pedindo login',
  cofre: 'Cofre de senhas travado',
  sessoes: 'Sessões paradas em laço',
};

const KIND_WHAT_TO_DO: Record<Trava['kind'], string> = {
  'vps-fora': 'Confira se a máquina está ligada e na rede; o app volta a ler sozinho.',
  'vps-login': 'Faça a verificação pedida no ssh (por exemplo, a do Tailscale) no PC.',
  cofre: 'Destranque o cofre à mão; o app não guarda nem envia a senha.',
  sessoes: 'Abra as sessões no quadro e veja o motivo de cada uma.',
};

/** The owner's card: only the kind and the place's name, never a session's name (it may carry a code the card refuses). */
export function vigiaCard(trava: Pick<Trava, 'kind' | 'label'>, firstSeen: number, endedAt: number | null = null): LedgerForOwner {
  if (endedAt !== null) {
    return {
      title: `Trava que passou: ${KIND_TITLE[trava.kind]}`.slice(0, 60),
      question: `${KIND_TITLE[trava.kind]} em ${trava.label}, de ${vigiaClock(firstSeen)} a ${vigiaClock(endedAt)}. Já viu?`.slice(0, 160),
      summary: `A trava passou sozinha. A carta não pôde sair na hora, porque o Oráculo não respondia; o aviso foi só no PC.`,
      options: [
        { label: 'Já vi', effect: 'A carta fecha; fica no registro do Oráculo.', closes: 'aceita', recommended: true },
        { label: 'Quero entender', effect: 'A carta volta como pendência para alguém investigar.', closes: 'rejeitada' },
      ],
      why: 'A trava já passou; a carta só registra quando aconteceu.',
      risk: 'Se voltar a acontecer, chega outra carta.',
    };
  }
  return {
    title: `Trava: ${KIND_TITLE[trava.kind]}`.slice(0, 60),
    question: `${KIND_TITLE[trava.kind]}. Já resolveu?`,
    summary: `${KIND_TITLE[trava.kind]} em ${trava.label}, desde ${vigiaClock(firstSeen)}. ${KIND_WHAT_TO_DO[trava.kind]}`.slice(0, 280),
    options: [
      { label: 'Já resolvi', effect: 'A carta fecha; se a trava voltar, chega outra.', closes: 'aceita', recommended: true },
      { label: 'Deixar assim', effect: 'A carta fecha sem mudar nada; se a trava seguir, ela some só quando passar.', closes: 'rejeitada' },
    ],
    why: 'Uma trava assim congela o trabalho das sessões até alguém agir.',
    risk: 'Enquanto a trava dura, as sessões dessa máquina ficam paradas ou esperando.',
  };
}

export function createVigiaService(deps: VigiaServiceDeps): VigiaService {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((): void => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  function readState(): VigiaState {
    try {
      return parseVigiaState(JSON.parse(readFileSync(deps.statePath, 'utf8')));
    } catch {
      return { open: {} };
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

  async function openCard(trava: Trava, projectPath: string, at: number, firstSeen: number, endedAt: number | null = null): Promise<string | null> {
    const created = await deps.apply(ACTOR, {
      op: 'criar',
      projectPath,
      title: `Trava: ${KIND_TITLE[trava.kind]}`.slice(0, 60),
      request: `vc tem que saber quando isso acontece e, travamentos assim que congelam tudo, deve ser avisado no oráculo ou com máxima prioridade (dono, 06/11)`,
      // A record (the lock already passed) is no live card: nobody adopts it.
      doneWhen: doneWhenOf(endedAt === null ? trava.key : null),
      due: today(at),
      ownerPlaceId: VIGIA_PLACE,
      risk: 'alto',
      requestedBy: 'vigia de travas',
    });
    if (!created.ok) {
      log(`[vigia] o Oráculo recusou a carta (${trava.kind}): ${created.reason}`);
      return null;
    }
    const id = created.task.id;
    const taken = await deps.apply(ACTOR, { op: 'assumir', id });
    if (!taken.ok) {
      log(`[vigia] o Oráculo recusou assumir a carta (${trava.kind}): ${taken.reason}`);
      await deps.apply(ACTOR, { op: 'cancelar', id, reason: 'a carta do vigia não pôde ser entregue' });
      return null;
    }
    const delivered = await deps.apply(ACTOR, {
      op: 'entregar',
      id,
      proofs: [
        {
          kind: 'texto',
          text: `${trava.detail}. Vista pela primeira vez em ${vigiaClock(firstSeen)}${endedAt === null ? '' : `; passou em ${vigiaClock(endedAt)}`}, em leituras com 5 min entre elas.`,
        },
      ],
      forOwner: vigiaCard(trava, firstSeen, endedAt),
    });
    if (delivered.ok) return id;
    // A card the owner cannot see is no warning: drop it and try again next round.
    log(`[vigia] o Oráculo recusou a entrega da carta (${trava.kind}): ${delivered.reason}`);
    await deps.apply(ACTOR, { op: 'cancelar', id, reason: 'a carta do vigia não pôde ser entregue' });
    return null;
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
        const detected = detectTravas({ probes, reports: deps.reports(), now: at });
        // A lock that is still there but now belongs to the daemon is handed over, not closed: its card stays alive
        // for the daemon to adopt. Only a lock that is gone is closed ("a trava passou sozinha").
        const handedOver = new Set(detected.filter(isDelegated).map((trava) => trava.key));
        const kept = Object.fromEntries(Object.entries(readState().open).filter(([key]) => !handedOver.has(key)));
        let tasks: readonly LedgerTask[] | null = null;
        try {
          tasks = deps.tasks ? deps.tasks() : null;
        } catch {
          tasks = null;
        }
        const checked = tasks ? reconcileCards(kept, tasks) : kept;
        const plan = planRound({ open: checked }, detected.filter((trava) => !isDelegated(trava)), at);
        const open = { ...plan.state.open };
        const projectPath = deps.projectPath();
        for (const { trava, firstSeen } of plan.toOpen) {
          const adopted = tasks ? liveVigiaCard(tasks, trava.key) : null;
          const id = adopted ?? (projectPath === null ? null : await openCard(trava, projectPath, at, firstSeen));
          if (id !== null) {
            open[trava.key] = { ...open[trava.key]!, cartaId: id };
          } else if (!open[trava.key]!.notified) {
            // No card (the Oráculo did not answer): the PC itself warns, once; the card follows when it answers.
            deps.notify(`Trava: ${KIND_TITLE[trava.kind]}`, `${KIND_TITLE[trava.kind]} em ${trava.label}, desde ${vigiaClock(firstSeen)}. O Oráculo não respondeu; a carta sai quando ele voltar.`);
            open[trava.key] = { ...open[trava.key]!, notified: true };
          }
        }
        for (const { key, trava, firstSeen, endedAt } of plan.toRecord) {
          const id = projectPath === null ? null : await openCard(trava, projectPath, at, firstSeen, endedAt);
          if (id !== null) delete open[key];
        }
        for (const closed of plan.toClose) {
          // Also any other live card of the same lock (another vigia's), so none is left alive after the lock passed.
          for (const id of new Set([closed.cartaId, ...(tasks ? liveVigiaCards(tasks, closed.key) : [])])) {
            const result = await deps.apply(ACTOR, { op: 'cancelar', id, reason: 'a trava passou sozinha' });
            if (!result.ok) log(`[vigia] não cancelou a carta de uma trava que passou: ${result.reason}`);
          }
        }
        writeState({ open });
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
