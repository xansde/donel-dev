// Mindscape de homologação V1, fatia 1 — "Números da factory": the panel over the board of the factory
// (docs/planos/mindscape-homologacao-v1.md). A mirror: it shows the `texto` and the `status` exactly as the
// factory wrote them, never computes a number and has no button that changes anything on the factory.

import { useCallback, useEffect, useState } from 'react';
import { FACTORY_METRICS_MAJOR, FACTORY_METRICS_FORMAT, FACTORY_METRICS_STALE_MS, type FactoryMetric, type FactoryMetricPoint, type MetricOrigin } from '../../../shared/homologacao/factoryMetrics';
import type { FactoryMetricsView } from '../../../shared/homologacao/ipc';
import styles from './FactoryNumbers.module.css';

/** The view of `metricas.json`, live; `null` = the `homologacao` key (or its `metricas`) is not in the config. */
export function useFactoryMetrics(): FactoryMetricsView | null {
  const [view, setView] = useState<FactoryMetricsView | null>(null);
  useEffect(() => {
    const api = window.donel.homologacao;
    let alive = true;
    void api.metricsGet().then((first) => {
      if (alive) setView(first);
    });
    const off = api.onMetricsChanged(setView);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return view;
}

const ORIGIN_LABEL: Record<MetricOrigin, string> = { medido: 'medido', estimado: 'estimado', 'sem-fonte': 'sem fonte' };
const ORIGIN_HINT: Record<MetricOrigin, string> = {
  medido: 'contado nos registros da factory',
  estimado: 'calculado com uma suposição',
  'sem-fonte': 'ninguém mede ainda',
};

function hhmm(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function FactoryNumbersButton({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button type="button" className={styles.openButton} aria-pressed={open} onClick={onToggle} data-testid="factory-numbers-open">
      Números da factory
    </button>
  );
}

interface PanelProps {
  readonly view: FactoryMetricsView;
  readonly onClose: () => void;
}

export function FactoryNumbersPanel({ view, onClose }: PanelProps): React.JSX.Element {
  const [now, setNow] = useState(Date.now);

  // Opening the panel reads now; the clock keeps "parado desde" honest while it stays open.
  useEffect(() => {
    void window.donel.homologacao.metricsRefresh();
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const { file } = view;
  const parsed = file.value;

  return (
    <section className={styles.panel} aria-label="Números da factory" data-testid="factory-numbers">
      <header className={styles.head}>
        <div className={styles.title}>
          <b>Números da factory</b>
          <span>
            lidos de {view.place}, só leitura · o Donel mostra o número como a factory escreveu
          </span>
        </div>
        <Freshness view={view} now={now} />
        <div className={styles.legend} aria-label="De onde vem cada número">
          {(['medido', 'estimado', 'sem-fonte'] as const).map((origin) => (
            <span key={origin} className={styles.legendItem}>
              <OriginTag origin={origin} />
              {ORIGIN_HINT[origin]}
            </span>
          ))}
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar os números" title="Fechar (Esc)">
          ×
        </button>
      </header>
      <Alerts view={view} now={now} />

      <div className={styles.body}>
        {!view.placeFound ? (
          <p className={styles.notice}>
            O lugar “{view.place}” da config não está entre os lugares remotos do Donel. Nada é lido até ele existir.
          </p>
        ) : !parsed ? (
          <p className={styles.notice}>{file.status === 'pending' ? 'Lendo os números…' : 'Nenhuma leitura boa ainda.'}</p>
        ) : parsed.kind === 'unsupported' ? (
          <p className={styles.notice} data-testid="factory-numbers-unsupported">
            formato {parsed.format}: este Donel lê até @{FACTORY_METRICS_MAJOR}
          </p>
        ) : parsed.kind === 'invalid' ? (
          <p className={styles.notice}>Arquivo fora do contrato {FACTORY_METRICS_FORMAT}@{FACTORY_METRICS_MAJOR}: {parsed.reason}.</p>
        ) : (
          <>
            <Groups metrics={parsed.metrics} />
            {parsed.outOfContract.length > 0 ? (
              <ul className={styles.outOfContract}>
                {parsed.outOfContract.map((id) => (
                  <li key={id}>item fora do contrato: {id}</li>
                ))}
              </ul>
            ) : null}
            <footer className={styles.sources}>
              <span>
                <b>Fontes lidas:</b>{' '}
                {parsed.sources
                  .filter((source) => source.exists)
                  .map((source) => (source.records === null ? source.id : `${source.id} (${source.records})`))
                  .join(' · ') || 'nenhuma'}
              </span>
              {parsed.sources.some((source) => !source.exists) ? (
                <span>
                  <b>Ninguém grava ainda:</b>{' '}
                  {parsed.sources
                    .filter((source) => !source.exists)
                    .map((source) => source.id)
                    .join(' · ')}
                </span>
              ) : null}
            </footer>
          </>
        )}
      </div>
    </section>
  );
}

interface FreshnessLine {
  readonly tone: 'ok' | 'stale' | 'down';
  readonly line: string;
  readonly generatedAt: number | null;
}

/** "sem sinal" (the place or the file did not answer), "parado" (the file is older than 2 h) or "atualizado". */
function freshnessOf(view: FactoryMetricsView, now: number): FreshnessLine | null {
  const { file } = view;
  const parsed = file.value;
  const generatedAt = parsed?.kind === 'ok' ? parsed.generatedAt : null;
  if (file.status === 'unreachable' || file.status === 'missing') {
    const why = file.status === 'missing' ? 'o arquivo não está lá' : `${view.place} não respondeu`;
    return { tone: 'down', generatedAt, line: file.lastOkAt === null ? `sem sinal: ${why}` : `sem sinal desde ${hhmm(file.lastOkAt)}: ${why}` };
  }
  if (generatedAt === null) return null;
  const stale = now - generatedAt > FACTORY_METRICS_STALE_MS;
  return { tone: stale ? 'stale' : 'ok', generatedAt, line: stale ? `parado desde ${hhmm(generatedAt)}` : `atualizado às ${hhmm(generatedAt)}` };
}

interface Alert {
  readonly level: 'problema' | 'atencao';
  readonly text: string;
  /** The card to bring into view. */
  readonly metricId?: string;
}

/** What is wrong, from what the factory wrote and from the read itself; the Donel judges no number. */
function alertsOf(view: FactoryMetricsView, now: number): Alert[] {
  const alerts: Alert[] = [];
  const fresh = freshnessOf(view, now);
  const parsed = view.file.value;
  if (!view.placeFound) alerts.push({ level: 'problema', text: `lugar “${view.place}” não encontrado` });
  if (fresh?.tone === 'down') alerts.push({ level: 'problema', text: fresh.line });
  if (parsed?.kind === 'unsupported') alerts.push({ level: 'problema', text: `formato ${parsed.format}: nenhum número mostrado` });
  if (parsed?.kind === 'invalid') alerts.push({ level: 'problema', text: 'arquivo fora do contrato: nenhum número mostrado' });
  if (parsed?.kind === 'ok') {
    for (const metric of parsed.metrics) if (metric.lockBroken) alerts.push({ level: 'problema', text: `trava rompida: ${metric.name}`, metricId: metric.id });
  }
  if (fresh?.tone === 'stale') alerts.push({ level: 'atencao', text: fresh.line });
  if (parsed?.kind === 'ok') {
    for (const metric of parsed.metrics) if (metric.unknownOrigin) alerts.push({ level: 'atencao', text: `origem desconhecida: ${metric.name}`, metricId: metric.id });
    if (parsed.outOfContract.length > 0) {
      const count = parsed.outOfContract.length;
      alerts.push({ level: 'atencao', text: `${count} ite${count === 1 ? 'm' : 'ns'} fora do contrato` });
    }
  }
  return alerts;
}

const ALERT_LABEL = { problema: 'problema', atencao: 'atenção' } as const;

/** The strip under the header: how many things are in problem and in attention, and which. */
function Alerts({ view, now }: { view: FactoryMetricsView; now: number }): React.JSX.Element {
  const alerts = alertsOf(view, now);
  const count = (level: Alert['level']) => alerts.filter((alert) => alert.level === level).length;
  const show = (metricId: string) => document.querySelector(`[data-metric="${CSS.escape(metricId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return (
    <div className={styles.alerts} data-testid="factory-numbers-alerts" data-level={count('problema') > 0 ? 'problema' : count('atencao') > 0 ? 'atencao' : 'bem'}>
      {(['problema', 'atencao'] as const).map((level) => (
        <span key={level} className={`${styles.alertCount} ${styles[`alert-${level}`]}`}>
          <b>{count(level)}</b> {ALERT_LABEL[level]}
        </span>
      ))}
      {alerts.length === 0 ? (
        <span className={styles.alertNone}>nenhum número em problema ou em atenção</span>
      ) : (
        <ul className={styles.alertList}>
          {alerts.map((alert) => (
            <li key={`${alert.level}:${alert.text}`} className={styles[`alert-${alert.level}`]}>
              {alert.metricId ? (
                <button type="button" onClick={() => show(alert.metricId as string)}>
                  {alert.text}
                </button>
              ) : (
                alert.text
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Freshness({ view, now }: { view: FactoryMetricsView; now: number }): React.JSX.Element | null {
  const fresh = freshnessOf(view, now);
  if (!fresh) return null;
  const { tone, line, generatedAt } = fresh;
  const down = tone === 'down';
  return (
    <div className={`${styles.fresh} ${styles[`fresh-${tone}`]}`} data-testid="factory-numbers-fresh" title={generatedAt ? `geradoEm ${new Date(generatedAt).toISOString()}` : undefined}>
      {line}
      {down && generatedAt !== null ? <span> · números gerados às {hhmm(generatedAt)}</span> : null}
    </div>
  );
}

const GROUPS: readonly { readonly rig: FactoryMetric['rig']; readonly title: string }[] = [
  { rig: null, title: 'Factory' },
  { rig: 'rig1', title: 'Rig 1 · Fábrica padrão' },
  { rig: 'rig2', title: 'Rig 2 · esteiras de agentes' },
];

function Groups({ metrics }: { metrics: readonly FactoryMetric[] }): React.JSX.Element {
  return (
    <>
      {GROUPS.map(({ rig, title }) => {
        const mine = metrics.filter((metric) => metric.rig === rig);
        if (mine.length === 0 && rig !== 'rig2') return null;
        return (
          <section key={title} className={styles.group} data-rig={rig ?? 'factory'}>
            <h3>
              {title}
              {mine.length === 0 ? <span className={styles.groupNote}>ainda não rodou: nenhum número do Rig 2 no arquivo</span> : null}
            </h3>
            {mine.length > 0 ? (
              <div className={styles.cards}>
                {mine.map((metric) => (
                  <MetricCard key={metric.id} metric={metric} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

function OriginTag({ origin, unknown = false }: { origin: MetricOrigin; unknown?: boolean }): React.JSX.Element {
  return (
    <span className={`${styles.tag} ${styles[`tag-${origin}`]}`} data-origin={origin}>
      {ORIGIN_LABEL[origin]}
      {unknown ? ' · origem desconhecida' : ''}
    </span>
  );
}

function MetricCard({ metric }: { metric: FactoryMetric }): React.JSX.Element {
  return (
    <article
      className={`${styles.card} ${metric.lockBroken ? styles.cardProblem : metric.unknownOrigin ? styles.cardAttention : ''}`}
      data-testid="factory-metric"
      data-metric={metric.id}
      data-health={metric.lockBroken ? 'problema' : metric.unknownOrigin ? 'atencao' : undefined}
    >
      {metric.lockBroken ? <div className={styles.cardFlag}>problema · trava rompida</div> : null}
      <div className={styles.cardHead}>
        <b className={styles.cardName}>{metric.name}</b>
        <OriginTag origin={metric.origin} unknown={metric.unknownOrigin} />
      </div>
      <div className={styles.value} data-testid="factory-metric-text">
        {metric.text}
      </div>
      {metric.unit ? <div className={styles.unit}>{metric.unit}</div> : null}
      {metric.lock || metric.displayOnly || metric.goal ? (
        <div className={styles.marks}>
          {metric.lock ? (
            <span className={styles.lock} title="Tem de ficar em zero ou subir" data-testid="factory-metric-lock">
              trava
            </span>
          ) : null}
          {metric.displayOnly ? (
            <span className={styles.shown} data-testid="factory-metric-shown">
              só mostrado: sem meta
            </span>
          ) : null}
          {metric.goal ? <span className={styles.goal}>{metric.goal}</span> : null}
        </div>
      ) : null}
      <p className={styles.question}>{metric.question}</p>
      {metric.series && metric.series.length > 0 ? <Series points={metric.series} name={metric.name} /> : null}
      <details className={styles.provenance}>
        <summary>de onde veio</summary>
        <p>{metric.provenance}</p>
        {metric.sources.length > 0 ? (
          <ul>
            {metric.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        ) : null}
      </details>
    </article>
  );
}

const SERIES_HEIGHT = 36;

/** The weeks of the file as thin bars on one baseline; the value of each week shows on hover. */
function Series({ points, name }: { points: readonly FactoryMetricPoint[]; name: string }): React.JSX.Element {
  const max = Math.max(0, ...points.map((point) => point.value));
  const last = points[points.length - 1];
  return (
    <figure className={styles.series} aria-label={`${name}, por semana`}>
      <div className={styles.bars} style={{ height: SERIES_HEIGHT }}>
        {points.map((point) => (
          <span key={point.week} className={styles.barSlot} title={`semana de ${point.week}: ${point.value.toLocaleString('pt-BR')}`}>
            <span className={styles.bar} style={{ height: max > 0 ? Math.max(2, (point.value / max) * SERIES_HEIGHT) : 2 }} />
          </span>
        ))}
      </div>
      <figcaption className={styles.weeks}>
        <span>{points[0].week}</span>
        <span>
          {last.week}: {last.value.toLocaleString('pt-BR')}
        </span>
      </figcaption>
      <table className={styles.srOnly}>
        <tbody>
          {points.map((point) => (
            <tr key={point.week}>
              <th>{point.week}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
