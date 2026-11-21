import { useEffect, useState } from 'react';
import type { RoutineRunStats, ShadowDecision, ShadowEntry } from '../../../shared/rotinas/contract';
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

/** "última rodada 14:05 · 12 quietas desde que o app abriu", or why nothing ran: separates quiet from stopped. */
function runLine(stats: RoutineRunStats | null): string {
  if (!stats || stats.lastRoundAt === undefined) return 'nenhuma rodada ainda desde que o app abriu (a primeira sai 1 min depois)';
  const quiet = `${stats.quiet} ${stats.quiet === 1 ? 'quieta' : 'quietas'} desde que o app abriu`;
  if (stats.lastFailure) return `a última rodada falhou às ${hour(stats.lastFailure.at)}: ${stats.lastFailure.message} · ${quiet}`;
  if (stats.lastSkipped) return `última rodada ${hour(stats.lastRoundAt)} não avaliou: ${stats.lastSkipped} · ${quiet}`;
  return `última rodada ${hour(stats.lastRoundAt)} · ${quiet}`;
}

export interface ShadowRoutinesProps {
  readonly projectPath: string | undefined;
  /** The name the card of a place shows; `undefined` = the place id. */
  readonly placeName: (placeId: string) => string | undefined;
}

export function ShadowRoutines({ projectPath, placeName }: ShadowRoutinesProps): React.JSX.Element {
  const [entries, setEntries] = useState<readonly ShadowEntry[]>([]);
  const [stats, setStats] = useState<RoutineRunStats | null>(null);
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
      void api
        .stats()
        .then((value) => {
          if (alive) setStats(value);
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
  const failed = stats?.lastFailure !== undefined;
  const runInfo = runLine(stats);

  return (
    <span className={styles.roleMenuAnchor}>
      <button
        type="button"
        className={styles.shadowButton}
        aria-expanded={open}
        title={`Rotinas em sombra: só observam e anotam o que teriam feito. Ninguém é acordado.\n${runInfo}`}
        onClick={() => setOpen((value) => !value)}
        data-testid="mindscape-shadow-routines"
      >
        em sombra: {count} {count === 1 ? 'achado' : 'achados'} hoje{failed ? ' · última rodada falhou' : ''}
      </button>
      {open ? (
        <div className={styles.shadowList} role="dialog" aria-label="Rotinas em sombra">
          <div className={styles.shadowEmpty}>{runInfo}</div>
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
