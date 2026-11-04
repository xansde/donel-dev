// B33 — "Versão nova · Atualizar" beside the status bar. Reads the installers folder through the main (again
// whenever the window gets focus); the waiting for the sessions and the switch itself belong to App.

import { useEffect, useState } from 'react';
import type { AppUpdateStatus, UpdateReadiness } from '../../../shared/appUpdate';
import styles from './UpdateIndicator.module.css';

interface UpdateIndicatorProps {
  /** The owner asked to update and the sessions are not idle yet. */
  readonly waiting: UpdateReadiness | null;
  /** The app is closing to install. */
  readonly applying: boolean;
  /** The last update did not go through (the installer failed, or the switch could not start). */
  readonly error: string | null;
  readonly onUpdate: () => void;
  readonly onCancel: () => void;
  readonly onDismissError: () => void;
}

function waitingText(waiting: UpdateReadiness): string {
  const parts = [
    waiting.working > 0 ? `${waiting.working} trabalhando` : null,
    waiting.waitingOnYou > 0 ? `${waiting.waitingOnYou} esperando você` : null,
  ].filter(Boolean);
  return `Atualiza quando as sessões pararem${parts.length > 0 ? ` (${parts.join(' · ')})` : ''}`;
}

export function UpdateIndicator({ waiting, applying, error, onUpdate, onCancel, onDismissError }: UpdateIndicatorProps): React.JSX.Element | null {
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
        <span className={styles.text}>{waitingText(waiting)}</span>
        <button type="button" className={styles.link} onClick={onCancel}>
          Cancelar
        </button>
      </span>
    );
  }
  if (!status?.enabled) return null;
  if (status.available) {
    return (
      <button
        type="button"
        className={`${styles.indicator} ${styles.available}`}
        onClick={onUpdate}
        title={`Instala ${status.available.installerName} e reabre as abas abertas`}
        data-testid="app-update-available"
      >
        <span className={styles.dot} aria-hidden="true" />
        Versão nova · Atualizar
      </button>
    );
  }
  if (status.failure) {
    return (
      <button
        type="button"
        className={`${styles.indicator} ${styles.error}`}
        onClick={() => void window.donel.appUpdate.openLog()}
        title={status.failure.message || 'A build do alfa falhou'}
        data-testid="app-update-build-failed"
      >
        Build do alfa falhou · ver log
      </button>
    );
  }
  return null;
}
