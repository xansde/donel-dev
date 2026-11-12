// B33 — the update beside the status bar: download progress, then "Versão nova pronta · Reiniciar". The waiting
// for the sessions and the restart itself belong to App.

import { useEffect, useState } from 'react';
import type { AppUpdateStatus, UpdateReadiness } from '../../../shared/appUpdate';
import styles from './UpdateIndicator.module.css';

interface UpdateIndicatorProps {
  /** The owner asked to update and the sessions are not idle yet. */
  readonly waiting: UpdateReadiness | null;
  /** Until it restarts anyway (sessão durável, 12/11); `null` while the deadline is being read. */
  readonly remainingMs: number | null;
  /** The app is closing to install. */
  readonly applying: boolean;
  /** The last update did not go through (the installer failed, or the switch could not start). */
  readonly error: string | null;
  readonly onUpdate: () => void;
  readonly onCancel: () => void;
  readonly onDismissError: () => void;
}

function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function waitingText(waiting: UpdateReadiness, remainingMs: number | null): string {
  const parts = [
    waiting.working > 0 ? `${waiting.working} trabalhando` : null,
    waiting.waitingOnYou > 0 ? `${waiting.waitingOnYou} esperando você` : null,
  ].filter(Boolean);
  const who = parts.length > 0 ? ` (${parts.join(' · ')})` : '';
  if (remainingMs === null) return `Atualiza quando as sessões pararem${who}`;
  return `Reinicia em ${clock(remainingMs)} ou quando as sessões pararem${who}`;
}

export function UpdateIndicator({ waiting, remainingMs, applying, error, onUpdate, onCancel, onDismissError }: UpdateIndicatorProps): React.JSX.Element | null {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);

  useEffect(() => {
    const api = window.donel?.appUpdate;
    if (!api) return undefined;
    let alive = true;
    const read = (): void => {
      void api
        .get()
        .then((next) => {
          if (alive) setStatus(next);
        })
        .catch(() => undefined);
    };
    read();
    const unsubscribe = api.onChanged((next) => setStatus(next));
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('focus', read);
    };
  }, []);

  if (error) {
    return (
      <span className={`${styles.indicator} ${styles.error}`} title={error} data-testid="app-update-error">
        <span className={styles.text}>Atualização não concluída: {error}</span>
        <button type="button" className={styles.link} onClick={onDismissError} aria-label="Dispensar aviso">
          ×
        </button>
      </span>
    );
  }
  if (applying) {
    return <span className={styles.indicator}>Fechando para atualizar…</span>;
  }
  if (waiting) {
    return (
      <span className={styles.indicator} data-testid="app-update-waiting">
        <span
          className={styles.text}
          title="As sessões trabalhando foram avisadas para fechar o turno e salvar o estado. No fim do prazo o app reinicia mesmo assim e cada uma volta na mesma conversa."
        >
          {waitingText(waiting, remainingMs)}
        </span>
        <button type="button" className={styles.link} onClick={onCancel}>
          Cancelar
        </button>
      </span>
    );
  }
  if (!status?.enabled) return null;
  const available = status.available;
  if (available?.ready) {
    return (
      <button
        type="button"
        className={`${styles.indicator} ${styles.available}`}
        onClick={onUpdate}
        title={`Versão ${available.version} baixada. Avisa as sessões trabalhando, reinicia quando elas pararem (ou no fim do prazo) e reabre as mesmas abas, na mesma conversa.`}
        data-testid="app-update-available"
      >
        <span className={`${styles.dot} ${styles.pulse}`} aria-hidden="true" />
        Versão nova pronta · Reiniciar
      </button>
    );
  }
  if (available) {
    const percent = available.percent ?? 0;
    return (
      <span className={styles.indicator} title={`Baixando a versão ${available.version} em segundo plano`} data-testid="app-update-downloading">
        <span className={styles.text}>Baixando versão nova</span>
        <span className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span className={styles.barFill} style={{ width: `${percent}%` }} />
        </span>
        <span className={styles.percent}>{percent}%</span>
      </span>
    );
  }
  if (status.failure) {
    return (
      <button
        type="button"
        className={styles.indicator}
        onClick={() => void window.donel.appUpdate.check()}
        title={`Atualização: ${status.failure}. Clique para tentar de novo.`}
        data-testid="app-update-failure"
      >
        <span className={styles.text}>Atualização indisponível · tentar de novo</span>
      </button>
    );
  }  return null;
}
