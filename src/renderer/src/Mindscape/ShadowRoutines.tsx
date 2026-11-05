import { useEffect, useState } from 'react';
import type { ShadowDecision, ShadowEntry } from '../../../shared/rotinas/contract';
import styles from './Mindscape.module.css';

// Item 20 — the routines in shadow, discreet on the board: "em sombra: N hoje" and, on click, what they would have
// woken today on this board. Read only: the routines live in the main.

const DECISION_LABEL: Readonly<Record<ShadowDecision, string>> = {
  acordaria: 'acordaria o Líder',
  adiada: 'adiada (teto)',
  descartada: 'descartada',
  'fonte-desligada': 'rotina desligada',
};

function hour(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export interface ShadowRoutinesProps {
  readonly projectPath: string | undefined;
  /** The name the card of a place shows; `undefined` = the place id. */
  readonly placeName: (placeId: string) => string | undefined;
}

export function ShadowRoutines({ projectPath, placeName }: ShadowRoutinesProps): React.JSX.Element {
  const [entries, setEntries] = useState<readonly ShadowEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const api = window.donel.rotinas;
    let alive = true;
    const load = (): void => {
      void api
        .today()
        .then((list) => {
          if (alive) setEntries(list);
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = api.onChanged(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const mine = entries.filter((entry) => entry.projectPath === projectPath || entry.decision === 'fonte-desligada');
  const count = mine.filter((entry) => entry.decision === 'acordaria').length;

  return (
    <span className={styles.roleMenuAnchor}>
      <button
        type="button"
        className={styles.shadowButton}
        aria-expanded={open}
        title="Rotinas em sombra: só observam e anotam o que teriam feito. Ninguém é acordado."
        onClick={() => setOpen((value) => !value)}
        data-testid="mindscape-shadow-routines"
      >
        em sombra: {count} {count === 1 ? 'achado' : 'achados'} hoje
      </button>
      {open ? (
        <div className={styles.shadowList} role="dialog" aria-label="Rotinas em sombra">
          {mine.length === 0 ? (
            <div className={styles.shadowEmpty}>Nada hoje neste quadro. A rotina "sessão parada" olha a cada 5 min.</div>
          ) : (
            [...mine].reverse().map((entry, index) => (
              <div key={`${entry.at}-${entry.key ?? index}`} className={styles.shadowItem}>
                <span className={styles.shadowTime}>{hour(entry.at)}</span>
                <span>
                  {entry.placeId ? <strong>{placeName(entry.placeId) ?? entry.placeId}</strong> : null} {entry.summary}
                  <span className={styles.shadowDecision}> · {DECISION_LABEL[entry.decision]}</span>
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </span>
  );
}
