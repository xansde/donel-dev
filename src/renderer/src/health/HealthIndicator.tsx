// Saúde do computador — the short line next to the status bar ("PC · RAM 96% · disco 85 GB"), colored by
// the worst finding, and the panel it opens: the numbers, what is wrong, who uses the most memory, and
// the two actions (end a process, open the temp folder). The main samples every minute; this only reads.
// Saúde das VPS — one more short line per remote place ("vps · RAM 40% · disco 30 GB" or "sem sinal") and
// its section in the same panel; opening the panel asks the main to read the places right away.

import { Button, Modal } from '@donel-dev/design-system';
import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '../../../shared/format-bytes';
import { formatHours } from '../../../shared/health/analyze';
import { formatHealthIndicator, formatKillRefusal } from '../../../shared/health/format';
import { formatLoad, formatRemoteIndicator, type RemoteHealthReport } from '../../../shared/health/remote';
import type { HealthAction, HealthFinding, HealthReport, HealthSeverity } from '../../../shared/health/types';
import styles from './HealthIndicator.module.css';

const SEVERITY_CLASS: Record<HealthSeverity, string | undefined> = {
  ok: styles.ok,
  warn: styles.warn,
  critical: styles.critical,
};

const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  ok: 'ok',
  warn: 'atenção',
  critical: 'crítico',
};

type KillTarget = { readonly finding: HealthFinding; readonly action: Extract<HealthAction, { kind: 'kill-process' }> };

function percentUsed(free: number, total: number): string {
  return total > 0 ? `${Math.round((1 - free / total) * 100)}%` : '—';
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Today: `14:32`; another day: `04/11 14:32`. */
function formatWhen(at: number): string {
  const date = new Date(at);
  if (date.toDateString() === new Date().toDateString()) return formatTime(at);
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${formatTime(at)}`;
}

function remoteClass(remote: RemoteHealthReport): string | undefined {
  if (remote.status === 'unreachable') return styles.warn;
  if (remote.status === 'pending' || !remote.reading) return styles.unknown;
  return SEVERITY_CLASS[remote.severity];
}

function RemoteSection({ remote }: { remote: RemoteHealthReport }): React.JSX.Element {
  const reading = remote.reading;
  const load = reading ? formatLoad(reading) : null;
  return (
    <section className={[styles.remote, remoteClass(remote)].filter(Boolean).join(' ')} data-testid={`health-remote-${remote.id}`}>
      <div className={styles.findingHead}>
        <span className={styles.dot} aria-hidden="true" />
        <strong>{remote.label}</strong>
        <span className={styles.badge}>
          {remote.status === 'unreachable' ? 'sem sinal' : remote.status === 'pending' ? 'lendo…' : SEVERITY_LABEL[remote.severity]}
        </span>
      </div>
      {remote.status === 'unreachable' ? (
        <span className={styles.detail}>
          Não respondeu por ssh{remote.checkedAt ? ` às ${formatTime(remote.checkedAt)}` : ''}.{' '}
          {remote.lastOkAt ? `Última leitura boa: ${formatWhen(remote.lastOkAt)}${reading ? ' (números abaixo são dela)' : ''}.` : 'Ainda sem nenhuma leitura boa.'}
        </span>
      ) : null}
      {reading ? (
        <dl className={styles.numbers}>
          {reading.ram ? (
            <>
              <dt>Memória</dt>
              <dd>
                {percentUsed(reading.ram.freeBytes, reading.ram.totalBytes)} em uso · {formatBytes(reading.ram.freeBytes)} livres de {formatBytes(reading.ram.totalBytes)}
              </dd>
            </>
          ) : null}
          {reading.disk ? (
            <>
              <dt>Disco</dt>
              <dd>
                {formatBytes(reading.disk.freeBytes)} livres de {formatBytes(reading.disk.totalBytes)}
              </dd>
            </>
          ) : null}
          {load ? (
            <>
              <dt>Carga</dt>
              <dd>{load}</dd>
            </>
          ) : null}
          {reading.sessions !== null ? (
            <>
              <dt>Sessões</dt>
              <dd>{reading.sessions === 1 ? '1 sessão do Donel' : `${reading.sessions} sessões do Donel`}</dd>
            </>
          ) : null}
          {remote.status === 'ok' && remote.lastOkAt ? (
            <>
              <dt>Leitura</dt>
              <dd>{formatTime(remote.lastOkAt)} · repete a cada minuto</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

export function HealthIndicator(): React.JSX.Element {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [killTarget, setKillTarget] = useState<KillTarget | null>(null);
  const [killing, setKilling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [remotes, setRemotes] = useState<readonly RemoteHealthReport[]>([]);

  useEffect(() => {
    const health = window.donel?.health;
    if (!health) return undefined;
    let alive = true;
    void health.get().then((initial) => {
      if (alive && initial) setReport(initial);
    });
    const unsubscribe = health.onChanged((next) => setReport(next));
    void health.remoteGet?.().then((initial) => {
      if (alive) setRemotes(initial);
    });
    const unsubscribeRemote = health.onRemoteChanged?.((next) => setRemotes(next));
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeRemote?.();
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setKillTarget(null);
    setMessage(null);
  }, []);

  /** Asks the main to read the VPS now; the answer also arrives by `onRemoteChanged`, so this never blocks the panel. */
  const refreshRemotes = useCallback(() => {
    void window.donel?.health?.remoteRefresh?.().then(setRemotes);
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    refreshRemotes();
  }, [refreshRemotes]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    refreshRemotes();
    try {
      const next = await window.donel.health.refresh();
      if (next) setReport(next);
    } finally {
      setRefreshing(false);
    }
  }, [refreshRemotes]);

  const openTemp = useCallback(async () => {
    const error = await window.donel.health.openTemp();
    setMessage(error ? `Não deu para abrir a pasta temporária: ${error}` : null);
  }, []);

  const confirmKill = useCallback(async () => {
    if (!killTarget) return;
    setKilling(true);
    try {
      const outcome = await window.donel.health.killProcess(killTarget.action.pid);
      setMessage(outcome.ok ? `${outcome.name} (pid ${outcome.pid}) foi encerrado.` : formatKillRefusal(outcome.reason));
    } finally {
      setKilling(false);
      setKillTarget(null);
    }
  }, [killTarget]);

  const worst = report?.worst ?? 'ok';
  const indicatorClass = [styles.indicator, report ? SEVERITY_CLASS[worst] : styles.unknown].filter(Boolean).join(' ');

  return (
    <>
      <button
        type="button"
        className={indicatorClass}
        onClick={openPanel}
        data-testid="health-indicator"
        data-severity={report ? worst : undefined}
        title="Saúde do computador"
      >
        <span className={styles.dot} aria-hidden="true" />
        {formatHealthIndicator(report)}
      </button>
      {remotes.map((remote) => (
        <button
          key={remote.id}
          type="button"
          className={[styles.indicator, remoteClass(remote)].filter(Boolean).join(' ')}
          onClick={openPanel}
          data-testid={`health-indicator-${remote.id}`}
          data-status={remote.status}
          title={
            remote.status === 'unreachable'
              ? `${remote.label}: sem sinal${remote.lastOkAt ? ` desde ${formatWhen(remote.lastOkAt)}` : ''}`
              : `Saúde de ${remote.label}`
          }
        >
          <span className={styles.dot} aria-hidden="true" />
          {formatRemoteIndicator(remote)}
        </button>
      ))}

      <Modal
        open={open}
        onClose={close}
        title={remotes.length > 0 ? 'Saúde do computador e das VPS' : 'Saúde do computador'}
        actions={
          killTarget ? (
            <>
              <Button variant="secondary" onClick={() => setKillTarget(null)} disabled={killing}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => void confirmKill()} disabled={killing}>
                {killing ? 'Encerrando…' : 'Encerrar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => void openTemp()}>
                Abrir pasta temporária
              </Button>
              <Button variant="secondary" onClick={() => void refresh()} disabled={refreshing}>
                {refreshing ? 'Lendo…' : 'Atualizar'}
              </Button>
              <Button onClick={close}>Fechar</Button>
            </>
          )
        }
      >
        <div className={styles.body} data-testid="health-panel">
          {report === null ? (
            <p className={styles.muted}>Ainda lendo o computador. A primeira leitura sai alguns segundos depois de abrir o app.</p>
          ) : killTarget ? (
            <div className={styles.confirm} data-testid="health-kill-confirm">
              <strong>
                Encerrar {killTarget.action.name} (pid {killTarget.action.pid})?
              </strong>
              <span>{killTarget.finding.detail}</span>
              <span className={styles.muted}>O que ele estiver fazendo para na hora, sem salvar.</span>
            </div>
          ) : (
            <>
              <dl className={styles.numbers}>
                <dt>Memória</dt>
                <dd>
                  {percentUsed(report.ram.freeBytes, report.ram.totalBytes)} em uso · {formatBytes(report.ram.freeBytes)} livres de {formatBytes(report.ram.totalBytes)}
                </dd>
                {report.disk ? (
                  <>
                    <dt>Disco {report.disk.path}</dt>
                    <dd>
                      {formatBytes(report.disk.freeBytes)} livres de {formatBytes(report.disk.totalBytes)}
                      {report.diskForecast && report.diskForecast.hoursToFull !== null && report.diskForecast.gbPerHour >= 0.1
                        ? ` · enchendo ${report.diskForecast.gbPerHour.toFixed(1).replace('.', ',')} GB/h, cheio em ${formatHours(report.diskForecast.hoursToFull)}`
                        : ''}
                    </dd>
                  </>
                ) : null}
                <dt>Leitura</dt>
                <dd>{formatTime(report.at)} · repete a cada minuto</dd>
              </dl>

              {message ? (
                <p className={styles.message} role="status">
                  {message}
                </p>
              ) : null}

              <ul className={styles.findings}>
                {report.findings.map((finding) => (
                  <li key={finding.id} className={[styles.finding, SEVERITY_CLASS[finding.severity]].filter(Boolean).join(' ')} data-severity={finding.severity}>
                    <div className={styles.findingHead}>
                      <span className={styles.dot} aria-hidden="true" />
                      <strong>{finding.title}</strong>
                      <span className={styles.badge}>{SEVERITY_LABEL[finding.severity]}</span>
                    </div>
                    <span className={styles.detail}>{finding.detail}</span>
                    {finding.action?.kind === 'kill-process' ? (
                      <div>
                        <Button
                          variant="danger"
                          onClick={() => {
                            const action = finding.action;
                            if (action?.kind === 'kill-process') {
                              setMessage(null);
                              setKillTarget({ finding, action });
                            }
                          }}
                        >
                          Encerrar
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>

              {report.topMemory.length > 0 ? (
                <section>
                  <h3 className={styles.heading}>Quem mais usa memória</h3>
                  <table className={styles.table}>
                    <tbody>
                      {report.topMemory.map((process) => (
                        <tr key={process.pid}>
                          <td>{process.name}</td>
                          <td className={styles.muted}>pid {process.pid}</td>
                          <td className={styles.number}>{formatBytes(process.workingSetBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}

              {remotes.length > 0 ? (
                <section className={styles.remotes}>
                  <h3 className={styles.heading}>VPS</h3>
                  {remotes.map((remote) => (
                    <RemoteSection key={remote.id} remote={remote} />
                  ))}
                </section>
              ) : null}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
