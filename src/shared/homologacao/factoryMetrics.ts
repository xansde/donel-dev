// Mindscape de homologação V1, fatia 1 — the reader of `metricas.json`, format `metricas-factory@1`
// (docs/planos/mindscape-homologacao-v1.md, "Contrato de leitura"). Pure and tested
// (tests/factory-metrics-parse.test.ts).
//
// The Donel recomputes nothing: it shows the `texto` and the `status` as they came. An unknown status never becomes
// "medido"; an item out of the contract is dropped and named, the others stay; an unknown major shows no number.

export const FACTORY_METRICS_FORMAT = 'metricas-factory';
export const FACTORY_METRICS_MAJOR = 1;
/** Past this the numbers are "parado desde". */
export const FACTORY_METRICS_STALE_MS = 2 * 60 * 60 * 1000;

export type MetricOrigin = 'medido' | 'estimado' | 'sem-fonte';
const ORIGINS: readonly MetricOrigin[] = ['medido', 'estimado', 'sem-fonte'];

export interface FactoryMetricPoint {
  readonly week: string;
  readonly value: number;
}

export interface FactoryMetric {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  /** `sem-fonte` also for a status this Donel does not know (`unknownOrigin`). */
  readonly origin: MetricOrigin;
  readonly unknownOrigin: boolean;
  /** The value exactly as the factory wrote it. */
  readonly text: string;
  readonly unit: string | null;
  /** "de onde veio". */
  readonly provenance: string;
  readonly sources: readonly string[];
  /** Has to stay at zero or go up. */
  readonly lock: boolean;
  /** The factory says the lock broke (`travaRompida: true`): the card is a problem. Never deduced here. */
  readonly lockBroken: boolean;
  /** "só mostrado: sem meta". */
  readonly displayOnly: boolean;
  readonly series: readonly FactoryMetricPoint[] | null;
  /** `null` = the whole factory. */
  readonly rig: 'rig1' | 'rig2' | null;
  /** "meta: 1 por semana", as the factory wrote it. */
  readonly goal: string | null;
  /**
   * Fatia 4 — `faixa: true`: the factory wants this number on the board's band (e.g. how long the team waits for the
   * factory, the sign of a bottleneck). Optional, no version bump; the Donel never picks a number by its id.
   */
  readonly band: boolean;
}

export interface FactorySource {
  readonly id: string;
  readonly exists: boolean;
  readonly records: number | null;
}

export type FactoryMetricsParse =
  | {
      readonly kind: 'ok';
      readonly generatedAt: number;
      readonly sources: readonly FactorySource[];
      readonly metrics: readonly FactoryMetric[];
      /** Ids (or positions, "#3") of the items left out because they broke the contract. */
      readonly outOfContract: readonly string[];
    }
  /** A format this Donel does not read: no number is shown. */
  | { readonly kind: 'unsupported'; readonly format: string }
  /** Not JSON, or the top of the file is out of the contract. */
  | { readonly kind: 'invalid'; readonly reason: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function series(value: unknown): FactoryMetricPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points: FactoryMetricPoint[] = [];
  for (const point of value) {
    if (!isObject(point) || typeof point.semana !== 'string' || typeof point.valor !== 'number' || !Number.isFinite(point.valor)) return null;
    points.push({ week: point.semana, value: point.valor });
  }
  return points;
}

function metric(item: Json): FactoryMetric | null {
  const id = str(item.id);
  const name = str(item.nome);
  const question = str(item.pergunta);
  const status = str(item.status);
  const text = str(item.texto);
  const provenance = str(item.origem);
  if (!id || name === null || question === null || status === null || text === null || provenance === null) return null;
  const known = (ORIGINS as readonly string[]).includes(status);
  return {
    id,
    name,
    question,
    origin: known ? (status as MetricOrigin) : 'sem-fonte',
    unknownOrigin: !known,
    text,
    unit: str(item.unidade),
    provenance,
    sources: Array.isArray(item.fontes) ? item.fontes.filter((source): source is string => typeof source === 'string') : [],
    lock: item.trava === true,
    lockBroken: item.travaRompida === true,
    displayOnly: item.soMostrado === true,
    series: series(item.serie),
    rig: item.rig === 'rig1' || item.rig === 'rig2' ? item.rig : null,
    goal: isObject(item.meta) ? str(item.meta.texto) : null,
    band: item.faixa === true,
  };
}

function source(item: unknown): FactorySource | null {
  if (!isObject(item) || typeof item.id !== 'string' || typeof item.existe !== 'boolean') return null;
  const records = item.registros;
  if (records !== null && !(typeof records === 'number' && Number.isFinite(records))) return null;
  return { id: item.id, exists: item.existe, records };
}

export function parseFactoryMetrics(text: string): FactoryMetricsParse {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: 'o arquivo não é JSON' };
  }
  if (!isObject(doc)) return { kind: 'invalid', reason: 'o arquivo não é um objeto' };

  const format = str(doc.formato) ?? '';
  const match = /^([a-z0-9-]+)@(\d+)$/.exec(format);
  if (!match || match[1] !== FACTORY_METRICS_FORMAT || Number(match[2]) !== FACTORY_METRICS_MAJOR) {
    return { kind: 'unsupported', format: format || 'sem formato' };
  }

  const generatedAt = typeof doc.geradoEm === 'string' ? Date.parse(doc.geradoEm) : Number.NaN;
  if (!Number.isFinite(generatedAt)) return { kind: 'invalid', reason: 'geradoEm ausente ou fora do contrato' };
  if (!Array.isArray(doc.metricas)) return { kind: 'invalid', reason: 'metricas ausente ou fora do contrato' };

  const outOfContract: string[] = [];
  const seen = new Set<string>();
  const metrics: FactoryMetric[] = [];
  doc.metricas.forEach((item, index) => {
    const parsed = isObject(item) ? metric(item) : null;
    const label = isObject(item) && typeof item.id === 'string' && item.id ? item.id : `#${index + 1}`;
    if (!parsed || seen.has(parsed.id)) outOfContract.push(label);
    else {
      seen.add(parsed.id);
      metrics.push(parsed);
    }
  });

  const sources: FactorySource[] = [];
  if (Array.isArray(doc.fontesLidas)) {
    doc.fontesLidas.forEach((item, index) => {
      const parsed = source(item);
      if (parsed) sources.push(parsed);
      else outOfContract.push(`fontesLidas #${index + 1}`);
    });
  } else outOfContract.push('fontesLidas');

  return { kind: 'ok', generatedAt, sources, metrics, outOfContract };
}
