// Faxineiro com gatilhos (t-b3b26e60, plan docs/planos/faxineiro-gatilhos.md) — owner, 07/11: "ISso deveria ser papel
// de uma cadeira de faxineiro dentro de cada mindscape, com gatilhos específicos pow".
//
// The trigger is code, the judgement is the Faxineiro's. This module is the code half: it reads the machines (PC and
// remote places), the open sessions of every board and the clock, and says which board's Faxineiro the app wakes, why,
// and which idle Faxineiro the app closes. Pure: the renderer gathers the sessions, the main adds the machines, the
// config and the memory (`<userData>/rotinas/`), and the bridge does the waking.
//
// Brakes, so a full machine does not get a crowd of Faxineiros: the same machine (or the same board, for stopped
// sessions) does not wake again within `cooldownMinutes`; a machine wakes one board at a time, the next only once the
// first Faxineiro stopped working; at most `maxWakesPerHour` wakes in the whole app; a Faxineiro working is never
// woken again (the trigger waits for the next round).

import { formatBytes } from '../format-bytes';
import { FAXINEIRO_ROLE_ID, LEADER_ROLE_ID } from '../roles';

/** `openedBy` of the Faxineiro tabs the app opens: only those the app also closes when they sit idle. */
export const FAXINEIRO_OPENER = 'faxineiro:app';
/** The machine id of this computer (the remote places use their own ids). */
export const PC_MACHINE_ID = 'pc';

const STATE_SCHEMA_VERSION = 1;
const MIN = 60_000;

export interface FaxineiroConfig {
  readonly enabled: boolean;
  /** RAM free under this percent → trigger. */
  readonly ramFreeMinPct: number;
  /**
   * Swap paging (pages in or out per second, the `si`/`so` of `vmstat`) over this → trigger. Swap in use alone is not
   * one (t-e3e8698a, 08/11): Linux leaves pages parked in swap on a machine with RAM to spare, and a cleanup barely moves
   * them (swap at 18% with si/so 0 and 3,6 GB free woke the Faxineiro every read; the round freed 35 MB).
   */
  readonly swapActiveMinPagesPerSec: number;
  /** Swap in use and RAM available under this many MB → trigger (the next session would push the machine into paging). */
  readonly swapRamAvailableMinMb: number;
  /** Load average of 5 min per CPU over this → trigger (remote places only: Windows has no load average). */
  readonly loadPerCpuMax: number;
  /** Reads in a row without answer before "sem sinal" is a trigger. */
  readonly unreachableReads: number;
  /** A session stopped (nothing for the owner) this long → trigger. */
  readonly stalledMinutes: number;
  /** Disk used over this percent → trigger. */
  readonly diskUsedMaxPct: number;
  /** The daily round runs on the first round at or after this local hour. */
  readonly dailyHour: number;
  readonly cooldownMinutes: number;
  readonly maxWakesPerHour: number;
  /** A Faxineiro the app opened, stopped this long, is closed by the app. */
  readonly idleCloseMinutes: number;
}

export const DEFAULT_FAXINEIRO_CONFIG: FaxineiroConfig = {
  enabled: true,
  ramFreeMinPct: 15,
  // 0: any paging in the one-second window counts, while the RAM available is under `swapRamAvailableMinMb` (paging
  // with RAM to spare never counts). A parked swap reads 0 exactly; a machine choking pages for seconds on end. The
  // owner raises it in config.json if a stray page now and then wakes the Faxineiro.
  swapActiveMinPagesPerSec: 0,
  // 1 GB: room for two or three more Claude sessions (each takes 300 to 500 MB), so the Faxineiro wakes before the
  // paging starts. The 08/11 reading (3,6 GB) stays out. Absolute, not a percent: the RAM trigger above already is one.
  swapRamAvailableMinMb: 1024,
  loadPerCpuMax: 2,
  unreachableReads: 2,
  stalledMinutes: 30,
  diskUsedMaxPct: 85,
  dailyHour: 6,
  cooldownMinutes: 30,
  maxWakesPerHour: 4,
  idleCloseMinutes: 10,
};

/** The pt-BR keys of the `faxineiro` section of `<userData>/rotinas/config.json` (the owner edits it by hand). */
const CONFIG_KEYS: Readonly<Record<Exclude<keyof FaxineiroConfig, 'enabled'>, string>> = {
  ramFreeMinPct: 'ramLivreMinimaPct',
  swapActiveMinPagesPerSec: 'trocaAtivaMinimaPaginasPorSeg',
  swapRamAvailableMinMb: 'swapRamDisponivelMinimaMb',
  loadPerCpuMax: 'cargaMaximaPorCpu',
  unreachableReads: 'leiturasSemSinal',
  stalledMinutes: 'minutosParada',
  diskUsedMaxPct: 'discoMaximoPct',
  dailyHour: 'horaDaRonda',
  cooldownMinutes: 'minutosEntreAcordas',
  maxWakesPerHour: 'acordasPorHora',
  idleCloseMinutes: 'minutosParaFecharFaxineiro',
};

/** The `faxineiro` section as written to the file (the defaults, on the first round). */
export function faxineiroConfigSection(config: FaxineiroConfig = DEFAULT_FAXINEIRO_CONFIG): Record<string, unknown> {
  const out: Record<string, unknown> = { ligado: config.enabled };
  for (const [key, name] of Object.entries(CONFIG_KEYS)) out[name] = config[key as keyof typeof CONFIG_KEYS];
  return out;
}

/** The section read back: anything missing or not a sane number falls back to the default. */
export function readFaxineiroConfig(section: unknown): FaxineiroConfig {
  const raw = typeof section === 'object' && section !== null ? (section as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { enabled: typeof raw.ligado === 'boolean' ? raw.ligado : DEFAULT_FAXINEIRO_CONFIG.enabled };
  for (const [key, name] of Object.entries(CONFIG_KEYS)) {
    const value = raw[name];
    const fallback = DEFAULT_FAXINEIRO_CONFIG[key as keyof typeof CONFIG_KEYS];
    out[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  return out as unknown as FaxineiroConfig;
}

/** One machine as the main last read it. A number the machine did not give is `null`. */
export interface MachineReading {
  readonly id: string;
  readonly label: string;
  /** The last read answered. `false` = "sem sinal"; the numbers are then stale and never count. */
  readonly reachable: boolean;
  /** When the last read finished: a read seen twice counts once. */
  readonly checkedAt: number | null;
  readonly ramFreeRatio: number | null;
  /** RAM available (`MemAvailable`), in bytes. */
  readonly ramAvailableBytes: number | null;
  readonly swapUsedRatio: number | null;
  /** Pages swapped in and out per second, read over one second. */
  readonly swapInPerSec: number | null;
  readonly swapOutPerSec: number | null;
  readonly load5PerCpu: number | null;
  readonly diskUsedRatio: number | null;
}

/** One open session tab of a board, as the renderer sees it. */
export interface SessionView {
  readonly projectPath: string;
  readonly placeId: string;
  readonly name: string;
  readonly roleId?: string;
  /** `pc` or the id of the remote place the session runs on. */
  readonly machineId: string;
  /** Working, or not known yet (the birth guess counts as working: never judged stopped by mistake). */
  readonly working: boolean;
  /** Permission, question, plan, usage limit or error: the owner's, never the Faxineiro's. */
  readonly needsOwner: boolean;
  readonly stateEnteredAt: number;
  /** Another session (or the app) opened this tab; `false` = the owner opened it by hand. */
  readonly openedBySession: boolean;
  readonly openedBy?: string;
}

export interface FaxineiroInput {
  readonly config: FaxineiroConfig;
  readonly machines: readonly MachineReading[];
  readonly sessions: readonly SessionView[];
}

/** The memory of the trigger between rounds (`<userData>/rotinas/faxineiro-estado.json`). */
export interface FaxineiroState {
  readonly schemaVersion: number;
  /** Trigger key (`maquina:<id>`, `parada:<board>`) → when it last woke someone. */
  readonly lastFired: Readonly<Record<string, number>>;
  /** When each wake of the last hour happened. */
  readonly wakes: readonly number[];
  /** Machine → the last read seen and how many reads in a row did not answer. */
  readonly unreachable: Readonly<Record<string, { readonly checkedAt: number; readonly streak: number }>>;
  /** `board\nplace` → the `stateEnteredAt` of the stop already told to the Faxineiro. */
  readonly reported: Readonly<Record<string, number>>;
  /** `machine\nboard` → when a machine trigger last woke that board (the next wake goes to another one first). */
  readonly boardWokenAt: Readonly<Record<string, number>>;
  /** Machine → the board its last trigger woke: a Faxineiro still working there holds the next one. */
  readonly machineBoard: Readonly<Record<string, string>>;
  /** Local day (`AAAA-MM-DD`) of the last daily round started, and the boards still to visit. */
  readonly dailyDay: string | null;
  readonly dailyPending: readonly string[];
  /**
   * Machine full for opening sessions → reads in a row below the limits since (it leaves at 2), and why it is full.
   * Disk is not in it: a full disk is cleaned, it does not hold an opening.
   */
  readonly fullHealthy: Readonly<Record<string, number>>;
  readonly fullReasons: Readonly<Record<string, readonly string[]>>;
}

/** Reads in a row below the limits before a full machine takes new sessions again. */
export const FULL_RELEASE_READS = 2;

export function emptyFaxineiroState(): FaxineiroState {
  return { schemaVersion: STATE_SCHEMA_VERSION, lastFired: {}, wakes: [], unreachable: {}, reported: {}, boardWokenAt: {}, machineBoard: {}, dailyDay: null, dailyPending: [], fullHealthy: {}, fullReasons: {} };
}

/** The state read back from the file. `null` = written by a newer channel: this round neither runs nor writes. */
export function readFaxineiroState(raw: unknown): FaxineiroState | null {
  if (typeof raw !== 'object' || raw === null) return emptyFaxineiroState();
  const value = raw as Partial<FaxineiroState>;
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > STATE_SCHEMA_VERSION) return null;
  const record = <T>(field: unknown): Record<string, T> => (typeof field === 'object' && field !== null && !Array.isArray(field) ? (field as Record<string, T>) : {});
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    lastFired: record<number>(value.lastFired),
    wakes: Array.isArray(value.wakes) ? value.wakes.filter((at): at is number => typeof at === 'number') : [],
    unreachable: record(value.unreachable),
    reported: record<number>(value.reported),
    boardWokenAt: record<number>(value.boardWokenAt),
    machineBoard: record<string>(value.machineBoard),
    dailyDay: typeof value.dailyDay === 'string' ? value.dailyDay : null,
    dailyPending: Array.isArray(value.dailyPending) ? value.dailyPending.filter((path): path is string => typeof path === 'string') : [],
    fullHealthy: record<number>(value.fullHealthy),
    fullReasons: record<readonly string[]>(value.fullReasons),
  };
}

export interface FaxineiroWake {
  readonly projectPath: string;
  /** pt-BR, one per trigger: "VPS: RAM livre 9% (limite 15%)". */
  readonly reasons: readonly string[];
  /** The machine in trouble: the Faxineiro runs somewhere else. */
  readonly avoidMachine?: string;
  /** The message the Faxineiro gets (its first one, when the app opens it). */
  readonly text: string;
}

/** One line of `<userData>/rotinas/faxineiro.log` (JSON Lines). */
export interface FaxineiroLogEntry {
  readonly at: number;
  readonly kind: 'acordou' | 'segurou' | 'fechou-faxineiro' | 'fechar' | 'recusou-fechar' | 'falhou' | 'fila' | 'abriu-da-fila' | 'saiu-da-fila';
  readonly projectPath?: string;
  readonly placeId?: string;
  readonly summary: string;
}

export interface FaxineiroRound {
  readonly wakes: readonly FaxineiroWake[];
  readonly closeIdle: readonly { readonly projectPath: string; readonly placeId: string }[];
  /** The holds of this round (cap, interval, Faxineiro busy), for the log. The wakes are logged by whoever delivers them. */
  readonly held: readonly FaxineiroLogEntry[];
  /** Machines where `sessao_abrir` waits for room (machine id → why), with the release hysteresis applied. */
  readonly fullMachines: Readonly<Record<string, readonly string[]>>;
  /** t-d1f072fd — how many new sessions each machine's last read has room for (machine id → room). */
  readonly openingRoom: Readonly<Record<string, OpeningRoom>>;
  readonly state: FaxineiroState;
}

/**
 * t-d1f072fd — sessions that fit on a machine before its RAM free falls under `ramFreeMinPct`, by its last read. The
 * read is every 60 s, so whoever opens sessions counts what it opened since `checkedAt` against `sessions`: four opens
 * in the same minute, starting near 1,2 GiB available, used to push the personal VPS into swap before the next read.
 */
export interface OpeningRoom {
  readonly sessions: number;
  readonly checkedAt: number;
}

/** RAM one new Claude session takes, for the room (300 to 500 MB each; 356 MB the mean measured on the personal VPS). */
export const OPENING_SESSION_RAM_MB = 400;

/** The room of one machine; `null` = no signal or no RAM read (nothing to count against). */
export function openingRoomOf(machine: MachineReading, config: FaxineiroConfig): OpeningRoom | null {
  if (!machine.reachable || machine.checkedAt === null || machine.ramAvailableBytes === null || machine.ramFreeRatio === null || machine.ramFreeRatio <= 0) return null;
  const totalBytes = machine.ramAvailableBytes / machine.ramFreeRatio;
  const spare = machine.ramAvailableBytes - (totalBytes * config.ramFreeMinPct) / 100;
  return { sessions: Math.max(0, Math.floor(spare / (OPENING_SESSION_RAM_MB * 1024 * 1024))), checkedAt: machine.checkedAt };
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function decimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The message of a wake, read by the Faxineiro as its turn begins. */
export function faxineiroWakeText(reasons: readonly string[]): string {
  return [
    `◆ Gatilho do Faxineiro (o app te acordou): ${reasons.join('; ')}.`,
    'Siga a seção "Gatilhos" do seu papel: feche neste quadro só o que terminou, limpe e meça, e termine com o relatório curto. Depois pare: o app fecha esta sessão quando ela ficar parada.',
  ].join('\n');
}

function isFaxineiro(session: SessionView): boolean {
  return session.roleId === FAXINEIRO_ROLE_ID;
}

/** The trouble of one machine, in pt-BR; `[]` = healthy. Stale numbers of a machine without signal never count. */
export function machineReasons(machine: MachineReading, streak: number, config: FaxineiroConfig, withDisk = true): string[] {
  const reasons: string[] = [];
  if (!machine.reachable) {
    if (streak >= config.unreachableReads) reasons.push(`${machine.label}: sem sinal (${streak} leituras seguidas sem resposta)`);
    return reasons;
  }
  if (machine.ramFreeRatio !== null && machine.ramFreeRatio * 100 < config.ramFreeMinPct)
    reasons.push(`${machine.label}: RAM livre ${pct(machine.ramFreeRatio)} (limite ${config.ramFreeMinPct}%)`);
  const swapIn = machine.swapInPerSec ?? 0;
  const swapOut = machine.swapOutPerSec ?? 0;
  const swapUsed = machine.swapUsedRatio !== null ? ` (swap em uso ${pct(machine.swapUsedRatio)})` : '';
  // t-89f14324 — paging with RAM to spare is the kernel moving cold pages, not a full machine: six openings waited on
  // a 31 GB remote with 22 to 25 GB free. Active swap counts only when the RAM available is also under the swap
  // limit (or unknown).
  const ramShort = machine.ramAvailableBytes === null || machine.ramAvailableBytes < config.swapRamAvailableMinMb * 1024 * 1024;
  if (ramShort && (swapIn > config.swapActiveMinPagesPerSec || swapOut > config.swapActiveMinPagesPerSec))
    reasons.push(`${machine.label}: troca ativa com o swap, ${swapIn} páginas/s entrando e ${swapOut} saindo${swapUsed} (limite ${config.swapActiveMinPagesPerSec})`);
  else if (machine.swapUsedRatio !== null && machine.swapUsedRatio > 0 && machine.ramAvailableBytes !== null && machine.ramAvailableBytes < config.swapRamAvailableMinMb * 1024 * 1024)
    reasons.push(`${machine.label}: swap em uso ${pct(machine.swapUsedRatio)} com só ${formatBytes(machine.ramAvailableBytes)} de RAM disponível (limite ${config.swapRamAvailableMinMb} MB)`);
  if (machine.load5PerCpu !== null && machine.load5PerCpu > config.loadPerCpuMax)
    reasons.push(`${machine.label}: carga de 5 min ${decimal(machine.load5PerCpu)} por CPU (limite ${decimal(config.loadPerCpuMax)})`);
  if (withDisk && machine.diskUsedRatio !== null && machine.diskUsedRatio * 100 > config.diskUsedMaxPct)
    reasons.push(`${machine.label}: disco ${pct(machine.diskUsedRatio)} usado (limite ${config.diskUsedMaxPct}%)`);
  return reasons;
}

interface Planned {
  readonly projectPath: string;
  readonly reasons: string[];
  avoidMachine?: string;
  readonly commits: ((state: Draft) => void)[];
}

type Draft = { -readonly [K in keyof FaxineiroState]: FaxineiroState[K] extends readonly (infer T)[] ? T[] : FaxineiroState[K] extends Readonly<Record<string, infer V>> ? Record<string, V> : FaxineiroState[K] };

function draftOf(state: FaxineiroState): Draft {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    lastFired: { ...state.lastFired },
    wakes: [...state.wakes],
    unreachable: { ...state.unreachable },
    reported: { ...state.reported },
    boardWokenAt: { ...state.boardWokenAt },
    machineBoard: { ...state.machineBoard },
    dailyDay: state.dailyDay,
    dailyPending: [...state.dailyPending],
    fullHealthy: { ...state.fullHealthy },
    fullReasons: { ...state.fullReasons },
  };
}

export function evaluateFaxineiro(input: FaxineiroInput, previous: FaxineiroState, now: number): FaxineiroRound {
  const config = input.config;
  if (!config.enabled) return { wakes: [], closeIdle: [], held: [], fullMachines: {}, openingRoom: {}, state: previous };
  const draft = draftOf(previous);
  const held: FaxineiroLogEntry[] = [];
  const cooldown = config.cooldownMinutes * MIN;
  const cooled = (key: string): boolean => now - (draft.lastFired[key] ?? -Infinity) >= cooldown;

  // Reads in a row without answer, counted once per read.
  for (const machine of input.machines) {
    const seen = draft.unreachable[machine.id];
    if (machine.checkedAt === null || seen?.checkedAt === machine.checkedAt) continue;
    const streak = machine.reachable ? 0 : (seen?.streak ?? 0) + 1;
    draft.unreachable[machine.id] = { checkedAt: machine.checkedAt, streak };
    // Full for opening, per read: in at once, out only after FULL_RELEASE_READS reads in a row below the limits.
    const trouble = machineReasons(machine, streak, config, false);
    if (trouble.length > 0) {
      draft.fullHealthy[machine.id] = 0;
      draft.fullReasons[machine.id] = trouble;
    } else if (machine.id in draft.fullHealthy) {
      const healthy = (draft.fullHealthy[machine.id] ?? 0) + 1;
      if (healthy >= FULL_RELEASE_READS) {
        delete draft.fullHealthy[machine.id];
        delete draft.fullReasons[machine.id];
      } else draft.fullHealthy[machine.id] = healthy;
    }
  }
  const fullMachines: Record<string, readonly string[]> = {};
  const present = new Set(input.machines.map((machine) => machine.id));
  for (const id of Object.keys(draft.fullHealthy)) {
    if (!present.has(id)) continue; // a place that left the config, or not read yet this run
    const reasons = draft.fullReasons[id] ?? [];
    fullMachines[id] = (draft.fullHealthy[id] ?? 0) > 0 ? [...reasons, 'esperando mais uma leitura abaixo dos limites'] : reasons;
  }

  const workers = input.sessions.filter((session) => !isFaxineiro(session));
  const busyBoards = new Set(input.sessions.filter((session) => isFaxineiro(session) && (session.working || session.needsOwner)).map((session) => session.projectPath));
  const planned = new Map<string, Planned>();
  const plan = (projectPath: string, reason: string, commit: (state: Draft) => void, avoidMachine?: string): void => {
    const entry = planned.get(projectPath) ?? { projectPath, reasons: [], commits: [] };
    entry.reasons.push(reason);
    entry.commits.push(commit);
    if (avoidMachine !== undefined && entry.avoidMachine === undefined) entry.avoidMachine = avoidMachine;
    planned.set(projectPath, entry);
  };

  // 1. Machines: RAM, swap, load, disk, no signal.
  for (const machine of input.machines) {
    const reasons = machineReasons(machine, draft.unreachable[machine.id]?.streak ?? 0, config);
    if (reasons.length === 0) continue;
    const key = `maquina:${machine.id}`;
    if (!cooled(key)) continue;
    const last = draft.machineBoard[machine.id];
    if (last !== undefined && busyBoards.has(last)) {
      held.push({ at: now, kind: 'segurou', projectPath: last, summary: `${reasons.join('; ')}: o Faxineiro acordado antes ainda está trabalhando` });
      continue;
    }
    const counts = new Map<string, number>();
    for (const session of workers) if (session.machineId === machine.id) counts.set(session.projectPath, (counts.get(session.projectPath) ?? 0) + 1);
    const candidates = [...counts.entries()]
      .filter(([projectPath]) => !busyBoards.has(projectPath))
      .sort(([pathA, countA], [pathB, countB]) => {
        const wokenA = draft.boardWokenAt[`${machine.id}\n${pathA}`] ?? 0;
        const wokenB = draft.boardWokenAt[`${machine.id}\n${pathB}`] ?? 0;
        return wokenA - wokenB || countB - countA || pathA.localeCompare(pathB);
      });
    const chosen = candidates[0]?.[0];
    if (chosen === undefined) {
      held.push({ at: now, kind: 'segurou', summary: `${reasons.join('; ')}: nenhum quadro com sessão livre nessa máquina` });
      continue;
    }
    for (const reason of reasons) {
      plan(
        chosen,
        reason,
        (state) => {
          state.lastFired[key] = now;
          state.boardWokenAt[`${machine.id}\n${chosen}`] = now;
          state.machineBoard[machine.id] = chosen;
        },
        machine.id,
      );
    }
  }

  // 2. Sessions stopped past the limit, each stop told once.
  const stalledLimit = config.stalledMinutes * MIN;
  const stalledByBoard = new Map<string, SessionView[]>();
  for (const session of workers) {
    if (session.working || session.needsOwner || !session.openedBySession || session.roleId === LEADER_ROLE_ID) continue;
    if (now - session.stateEnteredAt < stalledLimit) continue;
    if (draft.reported[`${session.projectPath}\n${session.placeId}`] === session.stateEnteredAt) continue;
    stalledByBoard.set(session.projectPath, [...(stalledByBoard.get(session.projectPath) ?? []), session]);
  }
  for (const [projectPath, stalled] of stalledByBoard) {
    const key = `parada:${projectPath}`;
    if (busyBoards.has(projectPath) || !cooled(key)) continue;
    const list = stalled.map((session) => `${session.name} (${session.placeId}, ${Math.floor((now - session.stateEnteredAt) / MIN)} min)`).join(', ');
    plan(projectPath, `sessões paradas há ${config.stalledMinutes} min ou mais: ${list}`, (state) => {
      state.lastFired[key] = now;
      for (const session of stalled) state.reported[`${session.projectPath}\n${session.placeId}`] = session.stateEnteredAt;
    });
  }

  // 3. The daily round: every board with open sessions, one at a time.
  const today = localDay(now);
  if (draft.dailyDay !== today && new Date(now).getHours() >= config.dailyHour) {
    draft.dailyDay = today;
    draft.dailyPending = [...new Set(workers.map((session) => session.projectPath))].sort();
  }
  if (draft.dailyPending.length > 0 && busyBoards.size === 0) {
    const next = draft.dailyPending[0]!;
    plan(next, 'ronda diária', (state) => {
      state.dailyPending = state.dailyPending.filter((path) => path !== next);
    });
  }

  // The cap of the hour, then the commits of what goes out.
  draft.wakes = draft.wakes.filter((at) => now - at < 60 * MIN);
  const wakes: FaxineiroWake[] = [];
  for (const entry of planned.values()) {
    if (draft.wakes.length >= config.maxWakesPerHour) {
      held.push({ at: now, kind: 'segurou', projectPath: entry.projectPath, summary: `${entry.reasons.join('; ')}: teto de ${config.maxWakesPerHour} acordas por hora` });
      continue;
    }
    draft.wakes.push(now);
    for (const commit of entry.commits) commit(draft);
    wakes.push({
      projectPath: entry.projectPath,
      reasons: entry.reasons,
      ...(entry.avoidMachine !== undefined ? { avoidMachine: entry.avoidMachine } : {}),
      text: faxineiroWakeText(entry.reasons),
    });
  }

  // 4. The Faxineiros the app opened that finished their round.
  const woken = new Set(wakes.map((wake) => wake.projectPath));
  const closeIdle = input.sessions
    .filter(
      (session) =>
        isFaxineiro(session) &&
        session.openedBy === FAXINEIRO_OPENER &&
        !session.working &&
        !session.needsOwner &&
        !woken.has(session.projectPath) &&
        now - session.stateEnteredAt >= config.idleCloseMinutes * MIN,
    )
    .map((session) => ({ projectPath: session.projectPath, placeId: session.placeId }));

  const openingRoom: Record<string, OpeningRoom> = {};
  for (const machine of input.machines) {
    const room = openingRoomOf(machine, config);
    if (room !== null) openingRoom[machine.id] = room;
  }
  return { wakes, closeIdle, held, fullMachines, openingRoom, state: draft };
}
