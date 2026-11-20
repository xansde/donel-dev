// O aviso do vigia de travas, bem estruturado (t-0358187b; dono, 17/11: "essas cartas sem a data/hora da queda na
// primeira carta é uma falha" e "esse tipo de aviso tá mal estruturado ainda"). Pure: the words of every warning, the
// script that measures why a place fell once it answers again, and the reading of its answer. The service
// (src/main/vigia/vigia-service.ts) does the ssh and the ledger.
//
// - The title (the card's cover) says the place, the start and the end in Brasília time, and how long it lasted.
// - The body says what stopped (the place's sessions and their work in the Oráculo), the probable cause with the
//   reading behind it, and what the team did or will do, each with its owner.
// - A lock that passed by itself is a record that closes by itself; only a live lock, or one that came back 3 times in
//   24 h on the same place, asks the owner a real question.

import type { LedgerForOwner } from '../ledger/contract';
import type { TravaKind } from './travas';

/** The owner lives in Brasília: every time on a warning is told there, whatever the clock of the machine that writes. */
export const VIGIA_TIME_ZONE = 'America/Sao_Paulo';

const DAY_HOUR = new Intl.DateTimeFormat('pt-BR', { timeZone: VIGIA_TIME_ZONE, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY = new Intl.DateTimeFormat('pt-BR', { timeZone: VIGIA_TIME_ZONE, day: '2-digit', month: '2-digit' });
const HOUR = new Intl.DateTimeFormat('pt-BR', { timeZone: VIGIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "17/11 07:30" (Brasília). */
export function clockBr(at: number): string {
  return DAY_HOUR.format(at).replace(',', '');
}

/** "07:30" (Brasília). */
export function hourBr(at: number): string {
  return HOUR.format(at);
}

/** "17/11 07:30–08:08", or "17/11 23:50–18/11 00:30" across midnight (Brasília). */
export function spanBr(start: number, end: number): string {
  return DAY.format(start) === DAY.format(end) ? `${clockBr(start)}–${hourBr(end)}` : `${clockBr(start)}–${clockBr(end)}`;
}

/** "38 min", "1 h 05 min", "2 h" (at least 1 min). */
export function durationText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
}

/** What the place was, by kind ("VPS pessoal fora do ar"). */
export const KIND_STATE: Readonly<Record<TravaKind, string>> = {
  'vps-fora': 'fora do ar',
  'vps-login': 'pedindo login',
  cofre: 'com o cofre travado',
  sessoes: 'com sessões em laço',
};

const MAX_TITLE = 60;

function fit(candidates: readonly string[]): string {
  return candidates.find((candidate) => candidate.length <= MAX_TITLE) ?? candidates[candidates.length - 1]!.slice(0, MAX_TITLE);
}

/** The cover of a lock that passed: "VPS pessoal fora do ar 17/11 07:30–08:08 (38 min)". */
export function passedTitle(label: string, kind: TravaKind, start: number, end: number): string {
  const head = `${label} ${KIND_STATE[kind]}`;
  return fit([`${head} ${spanBr(start, end)} (${durationText(end - start)})`, `${head} ${spanBr(start, end)}`, `${label} ${spanBr(start, end)} (${durationText(end - start)})`, `${label} ${spanBr(start, end)}`]);
}

/** The cover of a live lock: "VPS pessoal fora do ar desde 17/11 07:30". */
export function liveTitle(label: string, kind: TravaKind, since: number): string {
  return fit([`${label} ${KIND_STATE[kind]} desde ${clockBr(since)}`, `${label} travada desde ${clockBr(since)}`]);
}

/** The cover of a lock that keeps coming back: "VPS pessoal caiu 3 vezes em 24 h". */
export function repeatTitle(label: string, kind: TravaKind, times: number): string {
  const verb = kind === 'vps-fora' ? 'caiu' : 'travou';
  return fit([`${label} ${verb} ${times} vezes em 24 h`, `${label}: ${times} travas em 24 h`]);
}

// ---------------------------------------------------------------------------------------------------------------
// The probable cause, measured on the place once it answers again.

/** What the place itself recorded of the window of the fall. `null` fields = not readable there. */
export interface PostMortem {
  readonly ncpu: number | null;
  /** When the place last booted (ms). */
  readonly bootAt: number | null;
  /** The highest 1-minute load average in the window (the place's `sar`), and the most processes blocked on I/O. */
  readonly maxLoad: number | null;
  readonly maxBlocked: number | null;
  /** The highest swap use in the window (%). */
  readonly maxSwapPct: number | null;
  /** The kernel's out-of-memory kills in the window (`null` = the kernel log is not readable). */
  readonly oomKills: number | null;
}

/** Margin of the window read from the place's own records (its `sar` samples every 10 min). */
const POST_MORTEM_MARGIN_S = 10 * 60;
const PM = 'DONEL_PM';

/**
 * Pure — the script that reads, on the place that fell, its own records of the window: boot time, the load and the
 * blocked processes and the swap from `sar` (when installed), and the kernel's out-of-memory kills. Only reads; the
 * kernel log via `sudo -n` when that needs no password, else as the user. Times are epoch seconds, so the place's
 * clock zone does not matter.
 */
export function buildPostMortemScript(start: number, end: number): string {
  const from = Math.floor(start / 1000) - POST_MORTEM_MARGIN_S;
  const to = Math.ceil(end / 1000) + POST_MORTEM_MARGIN_S;
  return [
    `printf '${PM}_OK\\n'`,
    `printf '${PM} ncpu %s\\n' "$(nproc 2>/dev/null)"`,
    `printf '${PM} boot %s\\n' "$(( $(date +%s) - $(cut -d. -f1 /proc/uptime 2>/dev/null || echo 0) ))"`,
    'if command -v sar >/dev/null 2>&1; then',
    `  d=$(date -d @${from} +%d); f=/var/log/sysstat/sa$d; [ -r "$f" ] || f=/var/log/sa/sa$d`,
    '  if [ -r "$f" ]; then',
    `    s=$(date -d @${from} +%H:%M:%S); e=$(date -d @${to} +%H:%M:%S); [ "$e" \\> "$s" ] || e=23:59:59`,
    `    S_TIME_FORMAT=ISO LC_ALL=C sar -q -f "$f" -s "$s" -e "$e" 2>/dev/null | awk '$1 ~ /^[0-9]/ && $2 ~ /^[0-9]/ {n++; if ($4+0 > l) l = $4+0; if ($7+0 > b) b = $7+0} END {if (n) print "${PM} load", l, b}'`,
    `    S_TIME_FORMAT=ISO LC_ALL=C sar -S -f "$f" -s "$s" -e "$e" 2>/dev/null | awk '$1 ~ /^[0-9]/ && $2 ~ /^[0-9]/ {n++; if ($4+0 > w) w = $4+0} END {if (n) print "${PM} swap", w}'`,
    '  fi',
    'fi',
    `k=$( (sudo -n journalctl -q -k --since @${from} --until @${to} 2>/dev/null || journalctl -q -k --since @${from} --until @${to} 2>/dev/null) | grep -ciE 'out of memory: kill|oom-kill:|invoked oom-killer'; true)`,
    `if sudo -n true 2>/dev/null || journalctl -q -k -n 1 2>/dev/null | grep -q .; then printf '${PM} oom %s\\n' "\${k:-0}"; fi`,
    '',
  ].join('\n');
}

function num(raw: string | undefined): number | null {
  const value = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(value) ? value : null;
}

/** Pure — reads the script's answer; `null` = the place did not answer it. */
export function parsePostMortem(stdout: string): PostMortem | null {
  const lines = stdout.split(/\r?\n/);
  if (!lines.includes(`${PM}_OK`)) return null;
  const field = (name: string): string[] | undefined => lines.find((line) => line.startsWith(`${PM} ${name} `))?.split(' ').slice(2);
  const ncpu = num(field('ncpu')?.[0]);
  const boot = num(field('boot')?.[0]);
  const load = field('load');
  return {
    ncpu: ncpu !== null && ncpu > 0 ? ncpu : null,
    bootAt: boot !== null && boot > 0 ? boot * 1000 : null,
    maxLoad: num(load?.[0]),
    maxBlocked: num(load?.[1]),
    maxSwapPct: num(field('swap')?.[0]),
    oomKills: num(field('oom')?.[0]),
  };
}

export type CauseKind = 'reinicio' | 'memoria' | 'carga' | 'rede-pc' | 'rede' | 'login' | 'cofre' | 'sessoes' | 'desconhecida';

export interface Cause {
  readonly kind: CauseKind;
  /** "carga extrema na máquina" — the line's head. */
  readonly name: string;
  /** The reading behind it ("carga até 287 em 4 CPUs, ..."), never anything that came from a secret. */
  readonly reading: string;
}

const CAUSE_NAME: Readonly<Record<CauseKind, string>> = {
  reinicio: 'a máquina reiniciou',
  memoria: 'falta de memória na máquina',
  carga: 'carga extrema na máquina',
  'rede-pc': 'a rede do PC (todas as máquinas caíram juntas)',
  rede: 'a rede ou o Tailscale no caminho até a máquina',
  login: 'o acesso pediu verificação',
  cofre: 'o cofre de senhas',
  sessoes: 'sessões repetindo uma chamada que falhou',
  desconhecida: 'sem leitura que explique',
};

function round1(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

/** The readings of the window, in words ("carga até 287 em 4 CPUs, 294 processos bloqueados, swap até 68%"). */
function readingsText(pm: PostMortem): string {
  const parts: string[] = [];
  if (pm.maxLoad !== null) parts.push(`carga até ${round1(pm.maxLoad)}${pm.ncpu ? ` em ${pm.ncpu} CPUs` : ''}`);
  if (pm.maxBlocked !== null && pm.maxBlocked > 0) parts.push(`${round1(pm.maxBlocked)} processos bloqueados esperando disco ou memória`);
  if (pm.maxSwapPct !== null) parts.push(`swap até ${Math.round(pm.maxSwapPct)}%`);
  if (pm.oomKills !== null) parts.push(pm.oomKills === 0 ? 'nenhum processo morto por falta de memória' : `${pm.oomKills} ${pm.oomKills === 1 ? 'processo morto' : 'processos mortos'} por falta de memória`);
  return parts.join(', ');
}

/**
 * Pure — the probable cause of a lock that passed, from what the place recorded (`pm`) and what the vigia saw of the
 * other places in the same window (`downTogether`: the other places that were down with it).
 */
export function probableCause(input: {
  readonly kind: TravaKind;
  readonly detail: string;
  readonly start: number;
  readonly end: number;
  readonly pm: PostMortem | null;
  readonly downTogether: readonly string[];
}): Cause {
  const cause = (kind: CauseKind, reading: string): Cause => ({ kind, name: CAUSE_NAME[kind], reading });
  if (input.kind === 'vps-login') return cause('login', `${input.detail}; a máquina respondia, mas o acesso pediu verificação ou login.`);
  if (input.kind === 'cofre') return cause('cofre', `${input.detail}.`);
  if (input.kind === 'sessoes') return cause('sessoes', `${input.detail}.`);
  const pm = input.pm;
  const measured = pm ? readingsText(pm) : '';
  const window = `entre ${hourBr(input.start - POST_MORTEM_MARGIN_S * 1000)} e ${hourBr(input.end + POST_MORTEM_MARGIN_S * 1000)}`;
  if (pm?.bootAt !== null && pm?.bootAt !== undefined && pm.bootAt >= input.start - POST_MORTEM_MARGIN_S * 1000 && pm.bootAt <= input.end + POST_MORTEM_MARGIN_S * 1000)
    return cause('reinicio', `a máquina ligou de novo às ${hourBr(pm.bootAt)}${measured ? `; ${measured}` : ''}.`);
  if (pm && pm.oomKills !== null && pm.oomKills > 0) return cause('memoria', `${measured}, no registro da máquina ${window}.`);
  const cpus = pm?.ncpu ?? null;
  const heavy = pm !== null && cpus !== null && ((pm.maxLoad !== null && pm.maxLoad >= 4 * cpus) || (pm.maxBlocked !== null && pm.maxBlocked >= 2 * cpus));
  if (heavy) return cause('carga', `${measured}, no registro da máquina ${window}.`);
  if (pm && pm.maxSwapPct !== null && pm.maxSwapPct >= 90) return cause('memoria', `${measured}, no registro da máquina ${window}.`);
  if (input.downTogether.length > 0) return cause('rede-pc', `${input.downTogether.join(', ')} também não respondia${input.downTogether.length > 1 ? 'm' : ''} no mesmo período${measured ? `; na máquina, ${measured}` : ''}.`);
  if (pm && pm.maxLoad !== null) return cause('rede', `a máquina seguiu de pé, sem reiniciar: ${measured} ${window}.`);
  return cause('desconhecida', pm ? 'a máquina não guarda leitura de carga do período (sem o sar instalado); não reiniciou.' : 'a máquina não respondeu à leitura depois de voltar.');
}

/** What the team did and will do about a lock that passed, each with its owner. */
export function teamActions(kind: TravaKind, cause: Cause, firstSeen: number, endedAt: number): string[] {
  const done = `Feito: o vigia viu ${kind === 'vps-fora' ? 'a queda' : 'a trava'} às ${hourBr(firstSeen)}, a volta às ${hourBr(endedAt)} e mediu a causa (dono: vigia de travas).`;
  const next: Readonly<Record<CauseKind, string>> = {
    reinicio: 'Próximo: o Líder do quadro reabre as sessões que o reinício fechou e retoma o trabalho delas (dono: Líder do quadro).',
    memoria: 'Próximo: o Líder do quadro confere quais sessões o sistema matou, reabre as que faltam e alivia a máquina (dono: Líder do quadro).',
    carga: 'Próximo: o Líder do quadro confere o que puxou a carga, segura o trabalho pesado e retoma o que parou (dono: Líder do quadro).',
    'rede-pc': 'Próximo: nada a fazer nas máquinas; o vigia segue lendo a cada 5 min (dono: vigia de travas).',
    rede: 'Próximo: nada a fazer na máquina; o vigia segue lendo a cada 5 min (dono: vigia de travas).',
    login: 'Próximo: o Líder do quadro confere se o acesso voltou sem pedir verificação (dono: Líder do quadro).',
    cofre: 'Próximo: o Líder do quadro confere se o cofre segue aberto (dono: Líder do quadro).',
    sessoes: 'Próximo: o Líder do quadro confere se as sessões retomaram o trabalho (dono: Líder do quadro).',
    desconhecida: 'Próximo: o Líder do quadro confere o que parou e retoma o trabalho (dono: Líder do quadro).',
  };
  return [done, next[cause.kind], `Se a mesma trava voltar ${REPEAT_TIMES} vezes em 24 h, chega uma carta para o dono decidir (dono: vigia de travas).`];
}

// ---------------------------------------------------------------------------------------------------------------
// What stopped.

export interface Affected {
  /** The names of the place's sessions at its last reading before the lock. */
  readonly sessions: readonly string[];
  /** Their work in the Oráculo that was running. */
  readonly tasks: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  /** When the sessions were read (ms); `null` = never read. */
  readonly readAt: number | null;
}

export const NO_AFFECTED: Affected = { sessions: [], tasks: [], readAt: null };

function list(items: readonly string[], max = 8): string {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} e mais ${items.length - max}` : shown;
}

function affectedLines(affected: Affected): string[] {
  const when = affected.readAt === null ? '' : `, lidas às ${hourBr(affected.readAt)}`;
  return [
    affected.sessions.length === 0
      ? '- Sessões: o vigia não tinha leitura das sessões dessa máquina antes da trava.'
      : `- Sessões na máquina (${affected.sessions.length}${when}): ${list(affected.sessions)}.`,
    affected.tasks.length === 0
      ? '- Trabalho em andamento delas no Oráculo: nenhum.'
      : `- Trabalho em andamento delas no Oráculo (${affected.tasks.length}): ${list(affected.tasks.map((task) => `«${task.title}» (${task.id})`))}.`,
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The three warnings.

/** A lock seen this many times in 24 h on the same place asks the owner a real question. */
export const REPEAT_TIMES = 3;
export const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PassedRecord {
  readonly title: string;
  /** One sentence: the delivery's note. */
  readonly note: string;
  /** The body: the record's text proof. */
  readonly body: string;
}

/** The line a record gets when it waited in the queue for the Oráculo. */
export const LATE_LINE = 'Este registro saiu depois, quando o Oráculo voltou a responder; os horários são os que o vigia viu na hora.';

/** The words of a cause kind (an unknown one, from an older state, reads as unknown). */
export function causeName(kind: string | null): string {
  return kind !== null && Object.hasOwn(CAUSE_NAME, kind) ? CAUSE_NAME[kind as CauseKind] : CAUSE_NAME.desconhecida;
}

/** A lock that passed by itself: a record, no question to the owner. */
export function passedRecord(input: {
  readonly label: string;
  readonly kind: TravaKind;
  readonly firstSeen: number;
  readonly endedAt: number;
  readonly cause: Cause;
  readonly affected: Affected;
}): PassedRecord {
  const { label, kind, firstSeen, endedAt, cause, affected } = input;
  const span = `de ${clockBr(firstSeen)} a ${DAY.format(firstSeen) === DAY.format(endedAt) ? hourBr(endedAt) : clockBr(endedAt)}`;
  const head = `${label} ${KIND_STATE[kind]} ${span} (${durationText(endedAt - firstSeen)}, horário de Brasília).`;
  const note = `${head} Passou sozinha: fica só no registro. Causa provável: ${cause.name}.`.slice(0, 280);
  const body = [
    `${head} Passou sozinha; não pede decisão, fica no registro.`,
    '',
    'O que parou',
    ...affectedLines(affected),
    '',
    `Causa provável: ${cause.name}`,
    `- Leitura: ${cause.reading}`,
    '',
    'O que o time fez e vai fazer',
    ...teamActions(kind, cause, firstSeen, endedAt).map((line) => `- ${line}`),
  ].join('\n');
  return { title: passedTitle(label, kind, firstSeen, endedAt), note, body };
}

const WHAT_TO_DO: Readonly<Record<TravaKind, string>> = {
  'vps-fora': 'Confira se a máquina está ligada e na rede; o vigia lê de novo a cada 5 min.',
  'vps-login': 'Faça no PC a verificação pedida no acesso (por exemplo, a do Tailscale).',
  cofre: 'Destranque o cofre à mão; o app não guarda nem envia a senha.',
  sessoes: 'Abra as sessões no quadro e veja o motivo de cada uma.',
};

/** A lock that is still there: the owner may be the one who unlocks it. */
export function liveCard(input: { readonly label: string; readonly kind: TravaKind; readonly firstSeen: number; readonly affected: Affected; readonly detail: string }): {
  readonly title: string;
  readonly forOwner: LedgerForOwner;
  readonly body: string;
} {
  const { label, kind, firstSeen, affected } = input;
  const title = liveTitle(label, kind, firstSeen);
  const stopped = affected.sessions.length === 0 ? '' : ` ${affected.sessions.length === 1 ? 'Uma sessão está parada' : `${affected.sessions.length} sessões estão paradas`} nela${affected.tasks.length ? `, com ${affected.tasks.length === 1 ? 'uma tarefa' : `${affected.tasks.length} tarefas`} em andamento` : ''}.`;
  return {
    title,
    forOwner: {
      title,
      question: `${label} ${KIND_STATE[kind]} desde ${clockBr(firstSeen)} (horário de Brasília). Já resolveu?`.slice(0, 160),
      summary: `${WHAT_TO_DO[kind]}${stopped}`.slice(0, 280),
      options: [
        { label: 'Já resolvi', effect: 'A carta fecha; se a trava voltar, chega outra.', closes: 'aceita', recommended: true },
        { label: 'Deixar assim', effect: 'A carta fecha sem mudar nada; quando a trava passar, o registro diz quanto durou e por quê.', closes: 'rejeitada' },
      ],
      why: 'Uma trava assim congela o trabalho das sessões até alguém agir.',
      risk: 'Enquanto a trava dura, as sessões dessa máquina ficam paradas ou esperando.',
    },
    body: [`${input.detail}. Vista pela primeira vez em ${clockBr(firstSeen)} (horário de Brasília), em leituras com 5 min entre elas.`, '', 'O que parou', ...affectedLines(affected)].join('\n'),
  };
}

/** The lock came back `REPEAT_TIMES` times in 24 h on the same place: a real question — investigate it or not. */
export function repeatCard(input: {
  readonly label: string;
  readonly kind: TravaKind;
  /** Oldest first; `cause` is each one's cause kind. */
  readonly passages: ReadonlyArray<{ readonly firstSeen: number; readonly endedAt: number; readonly cause: string | null }>;
}): { readonly title: string; readonly forOwner: LedgerForOwner; readonly body: string } {
  const { label, kind, passages } = input;
  const title = repeatTitle(label, kind, passages.length);
  const spans = passages.map((passage) => `${spanBr(passage.firstSeen, passage.endedAt)} (${durationText(passage.endedAt - passage.firstSeen)})`);
  const last = passages[passages.length - 1]!;
  const verb = kind === 'vps-fora' ? 'caiu' : 'travou';
  return {
    title,
    forOwner: {
      title,
      question: `${label} ${verb} ${passages.length} vezes em 24 h, a última de ${spanBr(last.firstSeen, last.endedAt)} (horário de Brasília). Mando investigar?`.slice(0, 160),
      summary: `Vezes: ${spans.join('; ')}. Causa provável da última: ${causeName(last.cause)}.`.slice(0, 280),
      options: [
        { label: 'Investigar', effect: 'O vigia abre uma tarefa ao Líder único para achar a causa e propor a correção.', closes: 'aceita', recommended: true },
        { label: 'Só registrar', effect: 'Nada muda; cada vez segue indo só ao registro.', closes: 'rejeitada' },
      ],
      why: 'Três vezes no mesmo dia deixa de ser acaso: a causa tende a voltar e a parar o trabalho de novo.',
      risk: 'Sem investigar, a máquina pode seguir travando e parando as sessões dela.',
    },
    body: [
      `${label} ${KIND_STATE[kind]} ${passages.length} vezes nas últimas 24 h (horário de Brasília):`,
      ...passages.map((passage, i) => `- ${spans[i]}: ${causeName(passage.cause)}`),
      '',
      'Cada vez tem o seu registro no Oráculo, com o que parou, a leitura da causa e o que o time fez.',
    ].join('\n'),
  };
}

/** The investigation the owner asked for on a repeat card. */
export function investigationTask(label: string, kind: TravaKind, cardId: string): { readonly title: string; readonly request: string; readonly doneWhen: string } {
  return {
    title: fit([`Investigar: ${label} ${kind === 'vps-fora' ? 'caindo' : 'travando'} 3 vezes em 24 h`, `Investigar as quedas de ${label}`]),
    request: `O dono pediu para investigar, na carta ${cardId} do vigia de travas: ${label} ${KIND_STATE[kind]} ${REPEAT_TIMES} vezes ou mais em 24 h.`,
    doneWhen: 'A causa das quedas está medida e a correção está aplicada ou proposta ao dono, com prova.',
  };
}
