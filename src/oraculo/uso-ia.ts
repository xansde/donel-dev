// t-1c683858 — the phone's "Uso de IA" screen (`GET /api/v2/uso-ia`, contract v1 in
// ~/seazone/_scratch/celular-tailnet/contrato-uso-ia.md). Each of the 10 criteria of the AI-usage grade is a skill
// (perícia) with a belt per week (Branca..Preta, the TeamZone panel's cuts) and a proficiency built from the closed
// weeks of the total (`todas`). The server computes everything; the screen only draws.
//
// Sources, read only: `<dir>/AAAA-MM-DD/maquina-<nome>.json` (each machine's own collector, written by the
// faixa-preta-dia routine) and `<dir>/painel/<semana>-*.json` (the TeamZone panel = machine `todas`). State, written
// here: `<estado>/fechadas.json` (the belt of a closed week, frozen the first time its final reading is seen, never
// rewritten) and `<estado>/feitos.json` (each level reached, append only). A bad file is skipped; a failed write never fails the read.
//
// Known gap (20/11): no routine writes `painel/` yet; the faixa-preta-dia routine only reads it. A closed week freezes
// only once a panel reading taken after its end lands there (today by hand, through the Donel browser), so until a
// weekly routine (Friday after 17:00) writes it, every later week stays null and the proficiency stops at the last
// frozen week. A partial reading of a closed week is answered with `parcial: true` and never counts.

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const USO_IA_FLAG = 'celular-uso-ia';
export const USO_IA_PATH = 'uso-ia';

export const FAIXAS = ['Branca', 'Amarela', 'Verde', 'Azul', 'Roxa', 'Marrom', 'Preta'] as const;
export const CRITERIOS = [
  'sessoes_iniciadas', 'mensagens', 'tarefas_operacionais', 'tarefas_internas', 'skills_novas',
  'linhas_sistema', 'linhas_agente', 'cron_jobs', 'workflows', 'organizacao',
] as const;
export type Criterio = (typeof CRITERIOS)[number];

export interface Nivel {
  readonly nome: string;
  /** The lowest belt index that keeps the streak; null for the starting level. */
  readonly min: number | null;
  /** Closed weeks in a row the level asks for. */
  readonly semanas: number;
}
export const NIVEIS: readonly Nivel[] = [
  { nome: 'Destreinado', min: null, semanas: 0 },
  { nome: 'Treinado', min: 4, semanas: 2 },
  { nome: 'Expert', min: 5, semanas: 3 },
  { nome: 'Mestre', min: 6, semanas: 4 },
  { nome: 'Lendário', min: 6, semanas: 8 },
  { nome: 'Mítico', min: 6, semanas: 12 },
];

/** TeamZone `faixasDaRegua`: the fixed Branca of three criteria; the others have none (Branca = 0). */
const WHITE: Readonly<Partial<Record<Criterio, number>>> = { sessoes_iniciadas: 21, mensagens: 200, organizacao: 61 };
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** The week turns on Friday 17:00 at -03:00 (20:00Z). */
const BRT_OFFSET_MS = 3 * 3_600_000;
const SEMANA = /^(\d{4})-W(\d{2})$/;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const MACHINE_FILE = /^maquina-(.+)\.json$/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const LATEST_WEEKS = 8;

// ---------------------------------------------------------------- pure

/** The 7 cuts of a week for a criterion from its Preta (`faixasDaRegua`), or null when the Preta is not usable. */
export function cortesDaPreta(criterio: Criterio, preta: number): number[] | null {
  const white = WHITE[criterio];
  if (!Number.isFinite(preta) || preta <= 0 || preta < (white ?? 1) || (criterio === 'organizacao' && preta > 100)) return null;
  const cuts: number[] = [];
  for (let i = 0; i < FAIXAS.length; i++) {
    if (i === 6) {
      cuts.push(preta);
      continue;
    }
    if (i === 0 && white === undefined) {
      cuts.push(0);
      continue;
    }
    const raw = criterio === 'organizacao' ? white! + (preta - white!) * i / 6
      : white === undefined ? Math.pow(preta, (i - 1) / 5) : white * Math.pow(preta / white, i / 6);
    cuts.push(Math.ceil(Number(raw.toFixed(9))));
  }
  return cuts;
}

/** The cut up to today: organization is a rate (whole minimum); the rest is pro rata of the closed days. */
export function metaToDate(minimo: number, criterio: string, dias: number): number {
  return criterio === 'organizacao' ? minimo : Math.ceil(minimo * Math.max(0, Math.min(7, dias)) / 7);
}

/** The highest belt index whose cut the value reaches; -1 below Branca. */
export function faixaDe(valor: number, cortes: readonly number[]): number {
  let faixa = -1;
  for (let i = 0; i < cortes.length; i++) if (valor >= cortes[i]!) faixa = i;
  return faixa;
}

/** The overall belt: the lowest of the 10, only when all 10 have one. */
export function faixaGeral(faixas: Readonly<Record<string, number>>): number | null {
  const all = CRITERIOS.map((c) => faixas[c]);
  return all.every((f): f is number => typeof f === 'number') ? Math.min(...all) : null;
}

function parseSemana(semana: string): { year: number; week: number } | null {
  const m = SEMANA.exec(semana);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  return week >= 1 && week <= 53 ? { year, week } : null;
}

/** Orders ISO weeks (`2026-W47`) by year and number, never by a short label. */
export function compareSemana(a: string, b: string): number {
  const pa = parseSemana(a);
  const pb = parseSemana(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  return pa.year - pb.year || pa.week - pb.week;
}

/** Start of the week in ms: Monday of the ISO week minus 3 days, 17:00 -03:00. Null for a bad label. */
export function semanaInicioMs(semana: string): number | null {
  const p = parseSemana(semana);
  if (!p) return null;
  const jan4 = Date.UTC(p.year, 0, 4);
  const mondayW1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  const monday = mondayW1 + (p.week - 1) * WEEK_MS;
  return monday - 3 * DAY_MS + 17 * 3_600_000 + BRT_OFFSET_MS;
}

/** The week label a moment belongs to (the inverse of `semanaInicioMs`). */
export function semanaDe(ms: number): string {
  // Shift so that Friday 17:00 -03:00 lands on Monday 00:00, then take the ISO week of that day.
  const d = new Date(ms - BRT_OFFSET_MS + 2 * DAY_MS + 7 * 3_600_000);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (new Date(day).getUTCDay() + 6) % 7;
  const thursday = day - dow * DAY_MS + 3 * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / WEEK_MS);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** `2026-11-13T17:00:00-03:00` for a week boundary. */
function brtIso(ms: number): string {
  return `${new Date(ms - BRT_OFFSET_MS).toISOString().slice(0, 19)}-03:00`;
}

const rotuloDe = (semana: string): string => semana.slice(5);

export interface ProficienciaCalc {
  readonly nivel: number;
  /** seq[k] = current streak of level k (k = 0 always 0). */
  readonly seq: number[];
  /** For each level reached, the history index of the week it was reached in. */
  readonly alcancado: { readonly nivel: number; readonly indice: number }[];
}

/**
 * Walks the closed weeks in order. `null` (no reading) neither counts nor breaks; a belt below a level's minimum zeroes
 * that level's streak; the level goes up while the next level's streak is long enough, and never goes down.
 */
export function proficiencia(historico: readonly (number | null)[]): ProficienciaCalc {
  const seq = NIVEIS.map(() => 0);
  const alcancado: { nivel: number; indice: number }[] = [];
  let nivel = 0;
  historico.forEach((faixa, indice) => {
    if (faixa === null) return;
    for (let k = 1; k < NIVEIS.length; k++) seq[k] = faixa >= NIVEIS[k]!.min! ? seq[k]! + 1 : 0;
    while (nivel + 1 < NIVEIS.length && seq[nivel + 1]! >= NIVEIS[nivel + 1]!.semanas) {
      nivel++;
      alcancado.push({ nivel, indice });
    }
  });
  return { nivel, seq, alcancado };
}

// ---------------------------------------------------------------- sources

export interface UsoIaPaths {
  /** The faixa-preta-dia root (`DONEL_USO_IA_DIR`, else `~/.donel/faixa-preta-dia`). */
  readonly dir: string;
  /** Where the frozen weeks and the feats live (`DONEL_USO_IA_ESTADO`, else `~/.donel/uso-ia`). */
  readonly estado: string;
}

interface Leitura {
  readonly semana: string;
  readonly maquina: string;
  readonly medidoMs: number;
  readonly medidoEm: string;
  readonly fonte: string;
  /** The closed days the source says (null = it did not say). */
  readonly dias: number | null;
  readonly valores: Partial<Record<Criterio, number>>;
  readonly pretas: Partial<Record<Criterio, number>>;
}

const KNOWN_MACHINES: readonly { readonly id: string; readonly nome: string }[] = [
  { id: 'todas', nome: 'Todas' },
  { id: 'pc', nome: 'PC' },
  { id: 'vps', nome: 'VPS pessoal' },
  { id: 'homolog', nome: 'Homologações' },
];

export function maquinaId(nome: string): string {
  if (nome === 'vps-alexandrelentz') return 'vps';
  if (nome === 'vps-time-homologacoes') return 'homolog';
  if (nome.toLowerCase().includes('pc')) return 'pc';
  return nome;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCriterio = (v: unknown): v is Criterio => typeof v === 'string' && (CRITERIOS as readonly string[]).includes(v);

function readJson(file: string): unknown {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return undefined;
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function machineReading(raw: unknown, nome: string): Leitura | null {
  if (!isRecord(raw) || typeof raw.semana !== 'string' || !parseSemana(raw.semana)) return null;
  if (typeof raw.medido_em !== 'string' || !Number.isFinite(Date.parse(raw.medido_em))) return null;
  if (!Array.isArray(raw.criterios)) return null;
  const valores: Partial<Record<Criterio, number>> = {};
  const pretas: Partial<Record<Criterio, number>> = {};
  for (const item of raw.criterios) {
    if (!isRecord(item) || !isCriterio(item.criterio)) continue;
    if (typeof item.valor === 'number' && Number.isFinite(item.valor)) valores[item.criterio] = item.valor;
    if (typeof item.meta_preta_semana === 'number' && Number.isFinite(item.meta_preta_semana)) pretas[item.criterio] = item.meta_preta_semana;
  }
  const dias = typeof raw.dias_fechados === 'number' && Number.isFinite(raw.dias_fechados) ? Math.max(0, Math.min(7, raw.dias_fechados)) : null;
  return { semana: raw.semana, maquina: maquinaId(nome), medidoMs: Date.parse(raw.medido_em), medidoEm: raw.medido_em, fonte: 'coletor da máquina', dias, valores, pretas };
}

function panelReading(raw: unknown): Leitura | null {
  if (!isRecord(raw) || typeof raw.semana !== 'string' || !parseSemana(raw.semana)) return null;
  if (typeof raw.atualizado_em !== 'string' || !Number.isFinite(Date.parse(raw.atualizado_em))) return null;
  if (!isRecord(raw.valores)) return null;
  const valores: Partial<Record<Criterio, number>> = {};
  for (const [k, v] of Object.entries(raw.valores)) if (isCriterio(k) && typeof v === 'number' && Number.isFinite(v)) valores[k] = v;
  const dias = typeof raw.dias_com_envio === 'number' && Number.isFinite(raw.dias_com_envio) ? Math.max(0, Math.min(7, raw.dias_com_envio)) : null;
  const fonte = typeof raw.fonte === 'string' && raw.fonte.trim() ? raw.fonte.trim() : 'painel do TeamZone';
  return { semana: raw.semana, maquina: 'todas', medidoMs: Date.parse(raw.atualizado_em), medidoEm: raw.atualizado_em, fonte, dias, valores, pretas: {} };
}

/** Every reading on disk, the newest per (week, machine). */
export function lerLeituras(dir: string): Leitura[] {
  const best = new Map<string, Leitura>();
  const keep = (l: Leitura | null): void => {
    if (!l) return;
    const key = `${l.semana}\u0000${l.maquina}`;
    const prev = best.get(key);
    if (!prev || l.medidoMs > prev.medidoMs) best.set(key, l);
  };
  for (const day of listDir(dir)) {
    if (!DATE_DIR.test(day)) continue;
    for (const file of listDir(join(dir, day))) {
      const m = MACHINE_FILE.exec(file);
      if (m) keep(machineReading(readJson(join(dir, day, file)), m[1]!));
    }
  }
  for (const file of listDir(join(dir, 'painel'))) {
    if (!/^\d{4}-W\d{2}-.*\.json$/.test(file)) continue;
    keep(panelReading(readJson(join(dir, 'painel', file))));
  }
  return [...best.values()];
}

// ---------------------------------------------------------------- state

type Fechadas = Record<string, Partial<Record<Criterio, number>>>;
interface Feito {
  readonly criterio: Criterio;
  readonly nivel: number;
  readonly semana: string;
  readonly em: string;
}

/** A state file: `null` = it exists and cannot be read (then it is never overwritten); missing = empty. */
function readState<T>(file: string, empty: T, valid: (v: unknown) => v is T): T | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? empty : null;
  }
  try {
    const value = JSON.parse(text) as unknown;
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

const isFechadas = (v: unknown): v is Fechadas => isRecord(v) && Object.values(v).every(isRecord);
const isFeitos = (v: unknown): v is Feito[] => Array.isArray(v);
const validFeito = (v: unknown): v is Feito =>
  isRecord(v) && isCriterio(v.criterio) && typeof v.nivel === 'number' && Number.isInteger(v.nivel) && v.nivel >= 1
  && v.nivel < NIVEIS.length && typeof v.semana === 'string' && !!parseSemana(v.semana) && typeof v.em === 'string';

function writeAtomic(file: string, value: unknown, log?: (line: string) => void): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (error) {
    log?.(`[uso-ia] não gravei ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------- answer

/** Builds the answer of `GET /api/v2/uso-ia` (freezes newly closed weeks and records new feats on the way). */
export function montarUsoIa(paths: UsoIaPaths, nowMs: number, log?: (line: string) => void): Record<string, unknown> {
  const leituras = lerLeituras(paths.dir);
  const currentWeek = semanaDe(nowMs);

  // The Preta of each week and criterion: any machine of that week; without one, the newest week that has one.
  const pretasPorSemana = new Map<string, Partial<Record<Criterio, number>>>();
  for (const l of leituras) {
    const p = pretasPorSemana.get(l.semana) ?? {};
    for (const c of CRITERIOS) if (p[c] === undefined && l.pretas[c] !== undefined) p[c] = l.pretas[c];
    pretasPorSemana.set(l.semana, p);
  }
  const weeksNewestFirst = [...new Set(leituras.map((l) => l.semana))].sort((a, b) => compareSemana(b, a));
  const cortesDa = (semana: string): Partial<Record<Criterio, number[]>> => {
    const out: Partial<Record<Criterio, number[]>> = {};
    for (const c of CRITERIOS) {
      let preta = pretasPorSemana.get(semana)?.[c];
      if (preta === undefined) for (const w of weeksNewestFirst) if ((preta = pretasPorSemana.get(w)?.[c]) !== undefined) break;
      const cuts = preta === undefined ? null : cortesDaPreta(c, preta);
      if (cuts) out[c] = cuts;
    }
    return out;
  };

  const fechadaDe = (semana: string): boolean => {
    const inicio = semanaInicioMs(semana);
    return inicio !== null && nowMs >= inicio + WEEK_MS;
  };

  /**
   * A final reading: taken at or after the end of its week, or one whose source says all 7 days. Only a final reading
   * of a closed week counts 7 days and may be frozen; a reading taken mid-week keeps its own days even after the week
   * closes (a 1-day panel stretched to 7 days would freeze a wrong belt for good).
   */
  const finalDe = (l: Leitura): boolean => l.dias === 7 || l.medidoMs >= semanaInicioMs(l.semana)! + WEEK_MS;

  /** The belts of one reading: the days its source says (else the days elapsed when it was taken); 7 when final. */
  const avaliar = (l: Leitura, cortes: Partial<Record<Criterio, number[]>>) => {
    const inicio = semanaInicioMs(l.semana)!;
    const elapsed = Math.max(0, Math.min(7, Math.floor((Math.min(nowMs, l.medidoMs) - inicio) / DAY_MS)));
    const dias = finalDe(l) ? 7 : l.dias ?? elapsed;
    const cortesAteHoje: Partial<Record<Criterio, number[]>> = {};
    const faixas: Partial<Record<Criterio, number>> = {};
    for (const c of CRITERIOS) {
      const cuts = cortes[c];
      if (!cuts) continue;
      cortesAteHoje[c] = cuts.map((n) => metaToDate(n, c, dias));
      const v = l.valores[c];
      if (v !== undefined) faixas[c] = faixaDe(v, cortesAteHoje[c]!);
    }
    return { dias, cortesAteHoje, faixas, faixaGeral: faixaGeral(faixas) };
  };

  // Freeze a closed week the first time its final `todas` reading is seen; a frozen week is never rewritten. Until the
  // final reading arrives the week stays out (its history entry is null: it neither counts nor breaks a streak).
  const fechadasFile = join(paths.estado, 'fechadas.json');
  const fechadasLidas = readState<Fechadas>(fechadasFile, {}, isFechadas);
  const fechadas: Fechadas = { ...(fechadasLidas ?? {}) };
  let fechadasNovas = false;
  for (const l of leituras) {
    if (l.maquina !== 'todas' || !fechadaDe(l.semana) || !finalDe(l) || Object.hasOwn(fechadas, l.semana)) continue;
    fechadas[l.semana] = avaliar(l, cortesDa(l.semana)).faixas;
    fechadasNovas = true;
  }
  if (fechadasNovas) {
    if (fechadasLidas) writeAtomic(fechadasFile, fechadas, log);
    else log?.('[uso-ia] fechadas.json ilegível: não regravo (semanas congeladas ficam como estão)');
  }

  // History: from the oldest frozen week to the last closed week; a week in between without a record is null.
  const frozenWeeks = Object.keys(fechadas).filter((w) => parseSemana(w) && fechadaDe(w)).sort(compareSemana);
  const historicoSemanas: string[] = [];
  if (frozenWeeks.length) {
    const currentStart = semanaInicioMs(currentWeek)!;
    for (let t = semanaInicioMs(frozenWeeks[0]!)!; t < currentStart; t += WEEK_MS) historicoSemanas.push(semanaDe(t + 3_600_000));
  }

  const feitosFile = join(paths.estado, 'feitos.json');
  const feitosLidos = readState<Feito[]>(feitosFile, [], isFeitos);
  const feitos: Feito[] = (feitosLidos ?? []).filter(validFeito);
  const feitosNovos: Feito[] = [];
  const geradoEm = new Date(nowMs).toISOString();
  const proficienciaOut: Record<string, unknown> = {};
  for (const c of CRITERIOS) {
    const historico = historicoSemanas.map((semana) => {
      const f = fechadas[semana]?.[c];
      return { semana, rotulo: rotuloDe(semana), faixa: typeof f === 'number' && Number.isFinite(f) ? f : null };
    });
    const calc = proficiencia(historico.map((h) => h.faixa));
    for (const { nivel, indice } of calc.alcancado) {
      if (feitos.some((f) => f.criterio === c && f.nivel === nivel) || feitosNovos.some((f) => f.criterio === c && f.nivel === nivel)) continue;
      feitosNovos.push({ criterio: c, nivel, semana: historico[indice]!.semana, em: geradoEm });
    }
    const gravado = Math.max(0, ...feitos.concat(feitosNovos).filter((f) => f.criterio === c).map((f) => f.nivel));
    proficienciaOut[c] = { nivel: Math.max(calc.nivel, gravado), seq: calc.seq, historico };
  }
  if (feitosNovos.length) {
    if (feitosLidos) writeAtomic(feitosFile, [...feitosLidos, ...feitosNovos], log);
    else log?.('[uso-ia] feitos.json ilegível: não regravo (feitos ficam como estão)');
  }

  const semanas = weeksNewestFirst.slice(0, LATEST_WEEKS).map((semana) => {
    const inicio = semanaInicioMs(semana)!;
    const cortes = cortesDa(semana);
    const porMaquina: Record<string, unknown> = {};
    for (const l of leituras) {
      if (l.semana !== semana) continue;
      const a = avaliar(l, cortes);
      porMaquina[l.maquina] = {
        // parcial = the week closed but this reading was taken before the end: belts on its own days, not counted.
        medido_em: l.medidoEm, fonte: l.fonte, dias: a.dias, parcial: fechadaDe(semana) && !finalDe(l), valores: l.valores,
        cortes_ate_hoje: a.cortesAteHoje, faixas: a.faixas, faixa_geral: a.faixaGeral,
      };
    }
    return { semana, rotulo: rotuloDe(semana), inicio: brtIso(inicio), fim: brtIso(inicio + WEEK_MS), fechada: fechadaDe(semana), cortes, leituras: porMaquina };
  });

  const extra = [...new Set(leituras.map((l) => l.maquina))].filter((id) => !KNOWN_MACHINES.some((m) => m.id === id)).sort();
  const todosFeitos = feitos.concat(feitosNovos)
    .sort((a, b) => compareSemana(b.semana, a.semana) || b.nivel - a.nivel || (a.criterio < b.criterio ? -1 : 1))
    .map((f) => ({ criterio: f.criterio, nivel: f.nivel, semana: f.semana, rotulo: rotuloDe(f.semana), em: f.em }));

  return {
    versao: 1,
    gerado_em: geradoEm,
    faixas: [...FAIXAS],
    criterios: [...CRITERIOS],
    niveis: NIVEIS,
    maquinas: [...KNOWN_MACHINES, ...extra.map((id) => ({ id, nome: id }))],
    semanas,
    proficiencia: proficienciaOut,
    feitos: todosFeitos,
  };
}
