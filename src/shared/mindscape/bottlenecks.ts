// Gargalos do ambiente (t-dda3571f, docs/refinamentos/mindscape-gargalos.md). Owner, 08/11: "Preciso que o mindscape
// me permita ver gargalos no ambiente de desenvolvimento. Além disso, saber quais sessões fechar."
//
// The "pulso" of a session: is it REALLY working, or only open? It is a separate reading from the three axes of the
// card (`sessionAxes.ts`, which keeps owning open/closed): the pulse never says whether a session is alive, only what
// an open one is doing, and it prefers what the place itself shows (pane + transcript, `remoteSessions.ts`) over the
// hooks that reached the app. Then the panel: the bottlenecks of the environment (stuck sessions grouped by cause,
// accounts out of quota, machines short of RAM, who waits for whom) and the sessions that can be closed.
// Pure: no React, no Electron.

import type { SemaphoreState } from '../index';
import { LEADER_ROLE_ID } from '../roles';
import type { RemoteSessionReading } from '../health/remoteSessions';

export type PulseState = 'trabalhando' | 'esperando-api' | 'travada' | 'precisa-dono' | 'ociosa' | 'pode-fechar' | 'desconhecido';

export interface SessionPulse {
  readonly state: PulseState;
  /** pt-BR, short: "sem cota (429) há 2 h", "rodando Bash", "terminou há 14 h". */
  readonly reason: string;
  /** Since when the session is in this state (epoch ms on the clock of the reading); `null` = unknown. */
  readonly since: number | null;
  /** Where the reading came from: the place itself, or the hooks the app heard. */
  readonly source: 'lugar' | 'app';
}

/** A session that ended its turn and sat this long without anyone picking it up "pode fechar". */
export const IDLE_CLOSE_MS = 60 * 60_000;
/** A request with no answer and no spinner for this long is no longer "esperando a API": it is stuck. */
export const SILENT_REQUEST_MS = 15 * 60_000;

/** The pt-BR label of each state, as the card and the panel show it. */
export const PULSE_LABEL: Readonly<Record<PulseState, string>> = {
  trabalhando: 'trabalhando',
  'esperando-api': 'esperando a API',
  travada: 'travada',
  'precisa-dono': 'precisa de você',
  ociosa: 'ociosa',
  'pode-fechar': 'pode fechar',
  desconhecido: 'sem sinal',
};

/** `12 min`, `3 h`, `2 d`. */
export function shortAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * The cause of a failed call, in the owner's words. `kind` is the CLI's code (`rate_limit`, `server_error`,
 * `authentication_failed`…), `text` its message. Ordered: the most specific match wins.
 */
export function apiFailureReason(kind: string, text: string): string {
  const t = text.toLowerCase();
  if (/all credentials|cooling down|no available credential/.test(t)) return 'gateway sem cota (429)';
  if (/weekly limit|usage limit|hit your limit|limit reached|resets /.test(t)) return 'conta no limite';
  if (kind === 'rate_limit' || /\b429\b|rate limit/.test(t)) return 'sem cota (429)';
  if (/econnrefused|connection refused/.test(t)) return 'gateway fora do ar';
  if (/econnreset|connection (dropped|lost)|socket hang up/.test(t)) return 'conexão caiu';
  if (/timed out|timeout/.test(t)) return 'API não respondeu (tempo esgotado)';
  if (/overloaded|\b529\b/.test(t)) return 'API sobrecarregada';
  if (kind === 'authentication_failed' || /login|oauth|invalid api key|\b401\b|unauthori[sz]ed/.test(t)) return 'login caído';
  if (/\b5\d\d\b|server error|internal/.test(t) || kind === 'server_error') return 'erro no servidor da API';
  return 'erro de API';
}

function idle(since: number | null, now: number, what: string, source: SessionPulse['source']): SessionPulse {
  const age = since === null ? null : now - since;
  if (age !== null && age >= IDLE_CLOSE_MS) return { state: 'pode-fechar', reason: `${what} há ${shortAge(age)}, ninguém retomou`, since, source };
  return { state: 'ociosa', reason: age === null ? what : `${what} há ${shortAge(age)}`, since, source };
}

/** The pulse of a session on a remote place, from the place's own reading. `now` is the place's clock. */
export function pulseOfRemote(reading: RemoteSessionReading, now: number): SessionPulse {
  const source = 'lugar';
  const since = reading.lastAt;
  if (reading.pane === 'permission') return { state: 'precisa-dono', reason: 'pedindo permissão na tela', since: reading.paneActivityAt, source };
  if (reading.pane === 'question') return { state: 'precisa-dono', reason: 'pergunta esperando resposta', since: reading.paneActivityAt, source };
  if (reading.pane === 'login') return { state: 'travada', reason: 'login caído (a tela pede /login)', since: reading.paneActivityAt, source };
  if (reading.pane === 'busy') {
    if (reading.retry) {
      const attempt = reading.retry.attempt ? ` (tentativa ${reading.retry.attempt})` : '';
      return { state: 'esperando-api', reason: `${apiFailureReason('', reading.retry.text)}, tentando de novo${attempt}`, since: reading.retry.at, source };
    }
    if (reading.last === 'tool') return { state: 'trabalhando', reason: reading.tool ? `rodando ${reading.tool}` : 'rodando uma ferramenta', since, source };
    if (reading.last === 'request') {
      const age = since === null ? null : now - since;
      return { state: 'esperando-api', reason: age === null ? 'esperando a resposta da API' : `esperando a resposta da API há ${shortAge(age)}`, since, source };
    }
    return { state: 'trabalhando', reason: 'escrevendo', since, source };
  }
  if (!reading.transcript) {
    const created = reading.paneActivityAt;
    return idle(created, now, 'aberta e nunca recebeu pedido', source);
  }
  if (reading.apiError && reading.last === 'error') {
    const at = reading.apiError.at ?? since;
    const age = at === null ? '' : ` há ${shortAge(now - at)}`;
    return { state: 'travada', reason: `${apiFailureReason(reading.apiError.kind, reading.apiError.text)}${age}`, since: at, source };
  }
  if (reading.turn === 'ended') return idle(since, now, 'terminou', source);
  // A turn still open with no spinner on the pane: the call or the tool died quietly, or the owner pressed Esc.
  if (reading.pane === 'idle') return idle(since, now, 'parou no meio do turno', source);
  // The pane could not be read: the transcript alone.
  const age = since === null ? null : now - since;
  if (age !== null && age < SILENT_REQUEST_MS) return { state: 'trabalhando', reason: 'conversa andando', since, source };
  return { state: 'desconhecido', reason: age === null ? 'sem leitura da tela' : `sem leitura da tela, nada novo há ${shortAge(age)}`, since, source };
}

/** What the app heard from a session through the hooks (the semaphore of its tab). */
export interface LocalPulseInput {
  readonly state: SemaphoreState;
  readonly stateEnteredAt: number;
  readonly unconfirmed?: boolean;
  readonly pendingKinds?: readonly string[];
  readonly turnFailure?: string;
}

/** The pulse of a session from the semaphore alone (the PC's own sessions, or a remote one the place did not read). */
export function pulseOfLocal(input: LocalPulseInput, now: number): SessionPulse {
  const source = 'app';
  const since = input.stateEnteredAt > 0 ? input.stateEnteredAt : null;
  if (input.unconfirmed) return { state: 'desconhecido', reason: 'nenhum sinal do CLI ainda', since, source };
  if (input.state === 'working') return { state: 'trabalhando', reason: 'trabalhando', since, source };
  if (input.state === 'permission') {
    const kinds = input.pendingKinds ?? [];
    const reason = kinds.includes('question') ? 'pergunta esperando resposta' : kinds.includes('plan') ? 'plano esperando aprovação' : 'pedindo permissão';
    return { state: 'precisa-dono', reason, since, source };
  }
  if (input.turnFailure) {
    const age = since === null ? '' : ` há ${shortAge(now - since)}`;
    return { state: 'travada', reason: `${apiFailureReason(input.turnFailure, '')}${age}`, since, source };
  }
  if (input.state === 'error') return { state: 'travada', reason: 'o processo saiu com erro', since, source };
  return idle(since, now, 'terminou', source);
}

/** CPU of a session between two reads of the place, in % of one core; `null` without two comparable reads. */
export function cpuPercent(previous: { readonly ticks: number; readonly at: number } | undefined, ticks: number, at: number, clkTck: number): number | null {
  if (!previous || at <= previous.at || ticks < previous.ticks || clkTck <= 0) return null;
  return Math.round(((ticks - previous.ticks) / clkTck / ((at - previous.at) / 1000)) * 100);
}

// ---------------------------------------------------------------------------------------------------------------
// The panel.

/** One session of the environment, as the panel lists it. */
export interface EnvSession {
  /** Stable key: the conversation id. */
  readonly sessionId: string;
  readonly name: string;
  /** The tab in the app; absent = the session lives on the place with no tab here (closing it is not offered). */
  readonly tabId?: string;
  /** Board (project) it belongs to, for the panel's line. */
  readonly projectName?: string;
  readonly roleId?: string;
  /** `pc` or the remote place's id. */
  readonly machineId: string;
  readonly pulse: SessionPulse;
  /** The account or gateway the session's calls go through; `null` = unknown. */
  readonly account: string | null;
  readonly rssBytes?: number;
  readonly cpuPct?: number | null;
}

export interface EnvMachine {
  readonly id: string;
  readonly label: string;
  readonly kind: 'pc' | 'vps' | 'homologacao';
  /** `false` = the last read got no answer ("sem sinal"). */
  readonly reachable: boolean;
  readonly ramUsedRatio: number | null;
  readonly swapUsedRatio: number | null;
  /** Load of the last minute per CPU (remote places only). */
  readonly loadPerCpu: number | null;
  /** The account (or gateway) this machine's sessions use. */
  readonly account: string | null;
}

export interface EnvAccount {
  readonly label: string;
  /** Highest of the 5 h, 7 d and Sonnet loads, in %; `null` = not read. */
  readonly loadPct: number | null;
  readonly available: boolean;
  readonly needsReconnect: boolean;
  /** Machines where it is the active account. */
  readonly activeOn: readonly string[];
}

/** An arrow mother → daughter between two sessions (the `sessao_abrir` arrow or one the owner drew). */
export interface EnvLink {
  readonly from: string;
  readonly to: string;
}

export interface EnvInput {
  readonly sessions: readonly EnvSession[];
  readonly machines: readonly EnvMachine[];
  readonly accounts: readonly EnvAccount[];
  readonly links: readonly EnvLink[];
}

export type Severity = 'alta' | 'media';

export interface Bottleneck {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  /** The sessions it holds (keys), for the panel to point at. */
  readonly sessionIds: readonly string[];
}

export interface WaitPair {
  readonly waiting: string;
  readonly waitingName: string;
  readonly on: string;
  readonly onName: string;
  /** `mae-espera-filha` / `filha-espera-mae`. */
  readonly kind: 'mae-espera-filha' | 'filha-espera-mae';
  /** The one waited on is stuck too: nobody moves. */
  readonly blocked: boolean;
  readonly text: string;
}

export interface EnvPanel {
  readonly total: number;
  readonly counts: Readonly<Record<PulseState, number>>;
  /** Per machine: the counts of its sessions and their summed memory. */
  readonly perMachine: readonly { readonly machine: EnvMachine; readonly counts: Readonly<Record<PulseState, number>>; readonly total: number; readonly rssBytes: number }[];
  readonly bottlenecks: readonly Bottleneck[];
  readonly waits: readonly WaitPair[];
  /** Sessions the owner can close, the "pode fechar" ones first (pre-marked), then idle and stuck ones. */
  readonly closable: readonly { readonly session: EnvSession; readonly premarked: boolean }[];
}

const STATES: readonly PulseState[] = ['trabalhando', 'esperando-api', 'travada', 'precisa-dono', 'ociosa', 'pode-fechar', 'desconhecido'];

function emptyCounts(): Record<PulseState, number> {
  return Object.fromEntries(STATES.map((state) => [state, 0])) as Record<PulseState, number>;
}

const MOVING: ReadonlySet<PulseState> = new Set(['trabalhando', 'esperando-api']);
const STOPPED: ReadonlySet<PulseState> = new Set(['ociosa', 'pode-fechar', 'travada', 'desconhecido']);

/**
 * May the panel offer to close this session? Never one that moves or waits for the owner, never the Líder (it
 * coordinates the board even idle), never one with no tab in the app (the close gesture goes through the tab).
 */
export function canOfferClose(session: EnvSession): boolean {
  if (!session.tabId || session.roleId === LEADER_ROLE_ID) return false;
  return session.pulse.state === 'pode-fechar' || session.pulse.state === 'ociosa' || session.pulse.state === 'travada';
}

const RAM_WARN = 0.85;
const RAM_CRITICAL = 0.92;
const LOAD_WARN = 1.5;

export function buildEnvPanel(input: EnvInput): EnvPanel {
  const counts = emptyCounts();
  for (const session of input.sessions) counts[session.pulse.state] += 1;

  const perMachine = input.machines.map((machine) => {
    const own = input.sessions.filter((session) => session.machineId === machine.id);
    const machineCounts = emptyCounts();
    for (const session of own) machineCounts[session.pulse.state] += 1;
    return { machine, counts: machineCounts, total: own.length, rssBytes: own.reduce((sum, session) => sum + (session.rssBytes ?? 0), 0) };
  });

  const bottlenecks: Bottleneck[] = [];

  // Stuck sessions, grouped by cause: "11 sessões travadas: gateway fora do ar".
  const byCause = new Map<string, EnvSession[]>();
  for (const session of input.sessions) {
    if (session.pulse.state !== 'travada') continue;
    const cause = session.pulse.reason.replace(/ há .*$/, '').replace(/ \(a tela pede \/login\)$/, '');
    byCause.set(cause, [...(byCause.get(cause) ?? []), session]);
  }
  for (const [cause, sessions] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const machines = [...new Set(sessions.map((session) => input.machines.find((machine) => machine.id === session.machineId)?.label ?? session.machineId))];
    bottlenecks.push({
      id: `travada:${cause}`,
      severity: 'alta',
      title: `${sessions.length} ${sessions.length === 1 ? 'sessão travada' : 'sessões travadas'}: ${cause}`,
      detail: `Em ${machines.join(', ')}. ${sessions.map((session) => session.name).slice(0, 6).join(' · ')}${sessions.length > 6 ? ' …' : ''}`,
      sessionIds: sessions.map((session) => session.sessionId),
    });
  }

  // Calls failing and being retried right now, same grouping (the gateway breathing hard).
  const retrying = input.sessions.filter((session) => session.pulse.state === 'esperando-api' && /tentando de novo/.test(session.pulse.reason));
  if (retrying.length > 0) {
    bottlenecks.push({
      id: 'tentando-de-novo',
      severity: 'media',
      title: `${retrying.length} ${retrying.length === 1 ? 'sessão repetindo' : 'sessões repetindo'} chamada que falhou`,
      detail: retrying.map((session) => `${session.name}: ${session.pulse.reason}`).slice(0, 4).join(' · '),
      sessionIds: retrying.map((session) => session.sessionId),
    });
  }

  const needOwner = input.sessions.filter((session) => session.pulse.state === 'precisa-dono');
  if (needOwner.length > 0) {
    bottlenecks.push({
      id: 'precisa-dono',
      severity: 'alta',
      title: `${needOwner.length} ${needOwner.length === 1 ? 'sessão parada esperando você' : 'sessões paradas esperando você'}`,
      detail: needOwner.map((session) => `${session.name}: ${session.pulse.reason}`).slice(0, 4).join(' · '),
      sessionIds: needOwner.map((session) => session.sessionId),
    });
  }

  for (const account of input.accounts) {
    const full = account.loadPct !== null && account.loadPct >= 100;
    if (!full && account.available && !account.needsReconnect) continue;
    const why = account.needsReconnect ? 'precisa reconectar' : full ? `sem cota (${account.loadPct}%)` : 'indisponível';
    const where = account.activeOn.length > 0 ? ` · ativa em ${account.activeOn.join(', ')}` : '';
    bottlenecks.push({
      id: `conta:${account.label}`,
      severity: account.activeOn.length > 0 ? 'alta' : 'media',
      title: `Conta ${account.label}: ${why}`,
      detail: `${account.activeOn.length > 0 ? 'As sessões dessa máquina param quando a cota acaba.' : 'Não está ativa em nenhuma máquina.'}${where}`,
      sessionIds: [],
    });
  }

  for (const machine of input.machines) {
    if (!machine.reachable) {
      bottlenecks.push({ id: `maquina:${machine.id}`, severity: 'alta', title: `${machine.label}: sem sinal`, detail: 'A última leitura não respondeu; os números são da anterior.', sessionIds: [] });
      continue;
    }
    const ram = machine.ramUsedRatio;
    const load = machine.loadPerCpu;
    const parts: string[] = [];
    if (ram !== null && ram >= RAM_WARN) parts.push(`RAM ${Math.round(ram * 100)}%`);
    if (machine.swapUsedRatio !== null && machine.swapUsedRatio >= 0.25) parts.push(`swap ${Math.round(machine.swapUsedRatio * 100)}%`);
    if (load !== null && load >= LOAD_WARN) parts.push(`carga ${load.toFixed(1).replace('.', ',')} por CPU`);
    if (parts.length === 0) continue;
    const own = perMachine.find((entry) => entry.machine.id === machine.id);
    const idleHere = own ? own.counts['pode-fechar'] + own.counts.ociosa : 0;
    bottlenecks.push({
      id: `maquina:${machine.id}`,
      severity: (ram !== null && ram >= RAM_CRITICAL) || (load !== null && load >= 2) ? 'alta' : 'media',
      title: `${machine.label}: ${parts.join(' · ')}`,
      detail: idleHere > 0 ? `${idleHere} ${idleHere === 1 ? 'sessão parada ocupa' : 'sessões paradas ocupam'} memória aqui.` : 'Nenhuma sessão parada para liberar aqui.',
      sessionIds: [],
    });
  }

  // Who waits for whom, along the arrows mother → daughter.
  const byId = new Map(input.sessions.map((session) => [session.sessionId, session]));
  const waits: WaitPair[] = [];
  for (const link of input.links) {
    const mother = byId.get(link.from);
    const daughter = byId.get(link.to);
    if (!mother || !daughter) continue;
    const m = mother.pulse.state;
    const d = daughter.pulse.state;
    if (STOPPED.has(m) && m !== 'travada' && (MOVING.has(d) || d === 'travada' || d === 'precisa-dono')) {
      const blocked = !MOVING.has(d);
      waits.push({
        waiting: mother.sessionId,
        waitingName: mother.name,
        on: daughter.sessionId,
        onName: daughter.name,
        kind: 'mae-espera-filha',
        blocked,
        text: blocked ? `${mother.name} espera ${daughter.name}, que está ${PULSE_LABEL[d]} (${daughter.pulse.reason})` : `${mother.name} espera ${daughter.name} (${PULSE_LABEL[d]})`,
      });
    } else if (STOPPED.has(d) && d !== 'travada' && (MOVING.has(m) || m === 'travada' || m === 'precisa-dono')) {
      const blocked = !MOVING.has(m);
      waits.push({
        waiting: daughter.sessionId,
        waitingName: daughter.name,
        on: mother.sessionId,
        onName: mother.name,
        kind: 'filha-espera-mae',
        blocked,
        text: blocked ? `${daughter.name} espera ${mother.name}, que está ${PULSE_LABEL[m]} (${mother.pulse.reason})` : `${daughter.name} espera ${mother.name} (${PULSE_LABEL[m]})`,
      });
    }
  }
  waits.sort((a, b) => Number(b.blocked) - Number(a.blocked));
  const blockedWaits = waits.filter((wait) => wait.blocked);
  if (blockedWaits.length > 0) {
    bottlenecks.push({
      id: 'espera-travada',
      severity: 'alta',
      title: `${blockedWaits.length} ${blockedWaits.length === 1 ? 'sessão esperando' : 'sessões esperando'} quem está parado`,
      detail: blockedWaits.slice(0, 3).map((wait) => wait.text).join(' · '),
      sessionIds: blockedWaits.flatMap((wait) => [wait.waiting, wait.on]),
    });
  }

  bottlenecks.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'alta' ? -1 : 1));

  const rank: Partial<Record<PulseState, number>> = { 'pode-fechar': 0, travada: 1, ociosa: 2 };
  const closable = input.sessions
    .filter(canOfferClose)
    .map((session) => ({ session, premarked: session.pulse.state === 'pode-fechar' }))
    .sort((a, b) => (rank[a.session.pulse.state] ?? 9) - (rank[b.session.pulse.state] ?? 9) || (a.session.pulse.since ?? 0) - (b.session.pulse.since ?? 0));

  return { total: input.sessions.length, counts, perMachine, bottlenecks, waits, closable };
}
