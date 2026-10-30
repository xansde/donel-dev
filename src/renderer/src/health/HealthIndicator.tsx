// Saúde do computador — the short line next to the status bar ("PC · RAM 96% · disco 85 GB"), colored by
// the worst finding, and the panel it opens: the numbers, what is wrong, who uses the most memory, and
// the two actions (end a process, open the temp folder). The main samples every minute; this only reads.

import { Button, Modal } from '@donel-dev/design-system';
import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '../../../shared/format-bytes';
import { formatHours } from '../../../shared/health/analyze';
import { formatHealthIndicator, formatKillRefusal } from '../../../shared/health/format';
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

export function HealthIndicator(): React.JSX.Element {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [killTarget, setKillTarget] = useState<KillTarget | null>(null);
  const [killing, setKilling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const health = window.donel?.health;
    if (!health) return undefined;
    let alive = true;
    void health.get().then((initial) => {
      if (alive && initial) setReport(initial);
    });
    const unsubscribe = health.onChanged((next) => setReport(next));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setKillTarget(null);
    setMessage(null);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await window.donel.health.refresh();
      if (next) setReport(next);
    } finally {
      setRefreshing(false);
    }
  }, []);

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
        onClick={() => setOpen(true)}
        data-testid="health-indicator"
        data-severity={report ? worst : undefined}
        title="Saúde do computador"
      >
        <span className={styles.dot} aria-hidden="true" />
        {formatHealthIndicator(report)}
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Saúde do computador"
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
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
