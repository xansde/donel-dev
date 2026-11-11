// Roteador de lugar (t-89f14324): the machine a `sessao_abrir` runs on is
// chosen by a fixed rule from the config, never by the model. Measured 06–10/11: 10 of 14 overflows went over an
// explicit `onde`, and 24 of 59 openings without `onde` landed where the owner did not want them.
//
// Pure: no React, IPC or fs. It never throws; a rule that names a place that does not exist says so in `reason` and
// falls to the default.
//
// Order:
//   R1. explicit place → that machine; full → queue. Never overflows.
//   H.  with or without config (owner's rule, 11/11): the remote whose name says homologação takes only homologação
//       work (project name or folder with "homolog", or a `homol-*` role), and that work goes there. Other work that
//       would land there goes to the first remote not reserved; it never overflows there either.
//   R2. no rules (or disabled) → where the caller runs (after H); full and the role is "lugar: qualquer" → the first
//       other remote with room that is not reserved; else queue.
//   R3. `pcWhenRequestHas` matches the request (any case) → the PC; full → queue.
//   R4. `projects[].match` matches the project name or a piece of its path → that rule's place.
//   R5. else `defaultPlace`; without it, where the caller runs.
//   R6. the R4/R5 machine full and the role "lugar: qualquer" → the remote with no wait reasons and the most room,
//       never the PC, a place that `projects[]` reserves to another project, or one without a memory read; none →
//       queue (the owner's rule: a place full waits, it never spills into another project's machine).

import { PC_MACHINE_ID } from './faxineiro/triggers';

export interface RoutingProjectRule {
  /** Matched against the project name or a piece of its path (any case, accents ignored). */
  readonly match: string;
  /** A place label or id ("VPS", "lab"), or "este computador". */
  readonly place: string;
}

/** `team.routing` in `config.json`. Absent = off. */
export interface RoutingRules {
  readonly enabled: boolean;
  readonly defaultPlace?: string;
  readonly projects?: readonly RoutingProjectRule[];
  readonly pcWhenRequestHas?: readonly string[];
}

export interface RouteMachine {
  /** `pc` or a remote id. */
  readonly id: string;
  readonly label: string;
  /** Why a new session waits there; absent = it has room. */
  readonly waitReasons?: readonly string[];
  /** How many more sessions the last memory read left room for; absent = unknown. */
  readonly roomSessions?: number;
}

export interface RouteInput {
  /** The place the caller asked for, already resolved; `undefined` for absent, "aqui" or "auto". */
  readonly explicit?: string;
  /** Where the caller runs (`pc` or a remote id). */
  readonly callerMachine: string;
  readonly roleAnyPlace: boolean;
  /** The role id of the new session: `homol-*` is homologação work. */
  readonly roleId?: string;
  readonly projectPath: string;
  readonly projectName?: string;
  readonly request: string;
  readonly machines: readonly RouteMachine[];
  readonly rules: RoutingRules | null;
}

export interface RouteResult {
  /** `pc` or a remote id. */
  readonly machine: string;
  /** The machine is full: the session waits for room there. */
  readonly queue: boolean;
  /** Why this machine, in pt-BR, for the answer of `sessao_abrir`. */
  readonly reason: string;
  /** The label of the machine that was full when the session went elsewhere. */
  readonly overflowFrom?: string;
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const PC_WORDS = new Set(['este computador', 'local', 'pc']);

/** The word that marks homologação work and its machine (folded: no case, no accents). */
const HOMOLOGATION = 'homolog';

function labelOf(machines: readonly RouteMachine[], id: string): string {
  if (id === PC_MACHINE_ID) return 'este computador';
  return machines.find((machine) => machine.id === id)?.label ?? id;
}

/** A place written in the config → the machine id, or `undefined` when no machine has that name. */
function resolvePlace(machines: readonly RouteMachine[], place: unknown): string | undefined {
  if (typeof place !== 'string') return undefined;
  const wanted = fold(place);
  if (!wanted) return undefined;
  if (PC_WORDS.has(wanted)) return PC_MACHINE_ID;
  return machines.find((machine) => fold(machine.id) === wanted || fold(machine.label) === wanted)?.id;
}

function isFull(machines: readonly RouteMachine[], id: string): readonly string[] | undefined {
  const reasons = machines.find((machine) => machine.id === id)?.waitReasons;
  return reasons && reasons.length > 0 ? reasons : undefined;
}

function stay(machines: readonly RouteMachine[], id: string, why: string): RouteResult {
  const full = isFull(machines, id);
  return full
    ? { machine: id, queue: true, reason: `${why}; ${labelOf(machines, id)} está cheia, a sessão espera vaga lá` }
    : { machine: id, queue: false, reason: why };
}

/** The remote whose label or id says homologação ("Homologações", `homologacao-1`): it takes only homologação work. */
function homologationPlace(machines: readonly RouteMachine[]): string | undefined {
  return machines.find((machine) => machine.id !== PC_MACHINE_ID && (fold(machine.label).includes(HOMOLOGATION) || fold(machine.id).includes(HOMOLOGATION)))?.id;
}

function routeUnsafe(input: RouteInput): RouteResult {
  const { machines } = input;

  // R1 — an explicit place is kept, full or not.
  if (input.explicit !== undefined) return stay(machines, input.explicit, `você pediu ${labelOf(machines, input.explicit)}`);

  const name = fold(input.projectName ?? '');
  const path = fold(input.projectPath);
  const homologPlace = homologationPlace(machines);
  const homologWork = name.includes(HOMOLOGATION) || path.includes(HOMOLOGATION) || (input.roleId ?? '').toLowerCase().startsWith('homol-');
  const warnings: string[] = [];
  // Places that never take another project's work, nor its overflow: the homologação one (H) and `projects[]` ones.
  const reserved = new Set<string>();
  if (homologPlace !== undefined && !homologWork) reserved.add(homologPlace);
  let target: string | undefined;
  let why = '';
  /** The target is this work's own place (its `projects[]` rule, or homologação work on the homologação place). */
  let own = false;

  const rules = input.rules && input.rules.enabled === true ? input.rules : null;
  if (rules) {
    // R3 — the request needs the PC.
    const request = input.request.toLowerCase();
    const word = (rules.pcWhenRequestHas ?? []).find((piece) => typeof piece === 'string' && piece.trim() !== '' && request.includes(piece.trim().toLowerCase()));
    if (word !== undefined) return stay(machines, PC_MACHINE_ID, `o pedido fala em «${word.trim()}», que só existe neste computador`);

    for (const rule of rules.projects ?? []) {
      const place = typeof rule?.place === 'string' ? resolvePlace(machines, rule.place) : undefined;
      if (place !== undefined) reserved.add(place);
    }
    // R4 — the project has its own place.
    for (const rule of rules.projects ?? []) {
      if (typeof rule?.match !== 'string' || !fold(rule.match)) continue;
      const match = fold(rule.match);
      if (!name.includes(match) && !path.includes(match)) continue;
      const place = resolvePlace(machines, rule.place);
      if (place === undefined) {
        warnings.push(`a regra do projeto «${rule.match}» aponta «${String(rule.place)}», que não existe`);
        break;
      }
      target = place;
      own = true;
      why = `regra do projeto «${rule.match}»: ${labelOf(machines, place)}`;
      break;
    }
  }

  // H — homologação work goes to the homologação place, with or without config.
  if (target === undefined && homologWork && homologPlace !== undefined) {
    target = homologPlace;
    own = true;
    why = `trabalho de homologação: ${labelOf(machines, homologPlace)}`;
  }

  // R5 — the default place; R2 (no config) and R5 without one: where the caller runs.
  if (target === undefined && rules?.defaultPlace !== undefined) {
    const place = resolvePlace(machines, rules.defaultPlace);
    if (place === undefined) warnings.push(`o lugar padrão «${String(rules.defaultPlace)}» não existe`);
    else {
      target = place;
      why = `lugar padrão da config: ${labelOf(machines, place)}`;
    }
  }
  if (target === undefined) {
    target = input.callerMachine;
    why = rules ? `sem regra que case: onde você roda (${labelOf(machines, target)})` : `sem regra de lugar na config: onde você roda (${labelOf(machines, target)})`;
  }

  // H — a place reserved to other work never takes this one: the first remote free of reservation instead.
  if (!own && reserved.has(target)) {
    const from = labelOf(machines, target);
    const whose = target === homologPlace ? 'trabalho de homologação' : 'o projeto da regra dele';
    const other = machines.find((machine) => machine.id !== PC_MACHINE_ID && !reserved.has(machine.id));
    if (other) {
      target = other.id;
      why = `${why}; ${from} só recebe ${whose}, então ${labelOf(machines, other.id)}`;
    } else warnings.push(`${from} só recebe ${whose}, e não há outro lugar remoto`);
  }
  if (warnings.length > 0) why = `${why} (aviso: ${warnings.join('; ')})`;

  // Full, and the role is "lugar: qualquer": another remote, never the PC nor a reserved place.
  if (isFull(machines, target) && input.roleAnyPlace) {
    let best: RouteMachine | undefined;
    for (const machine of machines) {
      if (machine.id === PC_MACHINE_ID || machine.id === target || isFull(machines, machine.id) || reserved.has(machine.id)) continue;
      if (!rules) {
        // R2 — as before: the first other remote with room.
        best = machine;
        break;
      }
      // R6 — the one with the most room, by a memory read.
      if (machine.roomSessions === undefined || machine.roomSessions <= 0) continue;
      if (!best || machine.roomSessions > (best.roomSessions ?? 0)) best = machine;
    }
    if (best) {
      const from = labelOf(machines, target);
      const how = rules ? `foi para ${best.label}, a de mais vaga` : 'o papel permite outro lugar';
      return { machine: best.id, queue: false, reason: `${why}; ${from} estava cheia, ${how}`, overflowFrom: from };
    }
  }
  return stay(machines, target, why);
}

/** Chooses the machine of a new session. Never throws: on a surprise, where the caller runs. */
export function routePlace(input: RouteInput): RouteResult {
  try {
    return routeUnsafe(input);
  } catch {
    return { machine: input.callerMachine, queue: false, reason: 'o roteador falhou; abri onde você roda' };
  }
}

const ROUTING_KEYS = new Set(['enabled', 'defaultPlace', 'projects', 'pcWhenRequestHas']);

/** `team.routing` from `config.json`: keeps what is valid, drops the rest; anything else → `undefined` (off). */
export function sanitizeRoutingRules(value: unknown): RoutingRules | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const text = (item: unknown): item is string => typeof item === 'string' && item.trim() !== '';
  const projects = Array.isArray(raw.projects)
    ? raw.projects
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
        .filter((item) => text(item.match) && text(item.place))
        .map((item) => ({ match: item.match as string, place: item.place as string }))
    : undefined;
  const pcWhenRequestHas = Array.isArray(raw.pcWhenRequestHas) ? raw.pcWhenRequestHas.filter(text) : undefined;
  // Keys a newer version may add are kept, so this one saving the prefs never drops them.
  const unknownKeys = Object.fromEntries(Object.entries(raw).filter(([key]) => !ROUTING_KEYS.has(key)));
  return {
    ...unknownKeys,
    enabled: raw.enabled === true,
    ...(text(raw.defaultPlace) ? { defaultPlace: raw.defaultPlace } : {}),
    ...(projects ? { projects } : {}),
    ...(pcWhenRequestHas ? { pcWhenRequestHas } : {}),
  };
}
