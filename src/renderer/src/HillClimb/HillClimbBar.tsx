import { useMemo, useState } from 'react';
import { AnnotationTag, Button, LevelCarousel, type AnnotationTone, type LevelCarouselLevel } from '@donel-dev/design-system';
import {
  CLOSE_REASON_LABEL,
  extraRodadasLeft,
  HILL_CLIMB_RULES,
  lowestScore,
  rodadaSample,
  roundsOf,
  type HillClimbMission,
  type MissionRound,
  type MissionState,
  type OwnerGesture,
} from '../../../shared/hillClimb/contract';
import type { HillClimbGestureResult, HillClimbSnapshot } from '../../../shared/hillClimb/channels';
import styles from './HillClimbBar.module.css';

// Hill climbing — the left bar that took the place of the Modo Dev (owner, 05/11). Only the visual of the old
// bar stays: the trail (here: the rounds, with a divider at each rodada) and the two-axis carousel (here:
// rodadas × versions, with the judge × criterion scores inside the focused card). No right bar.
// The loop itself runs in the main; this bar only shows the snapshot and sends the owner's three gestures.

const STATE_LABEL: Readonly<Record<MissionState, string>> = {
  proposta: 'proposta · esperando você no Oráculo',
  rodando: 'rodando',
  pausada: 'rodada fechada · esperando você',
  aceita: 'aceita',
  recusada: 'recusada',
};

/** What waits for the owner comes first: a closed rodada, then a running one, then a proposal. */
const STATE_ORDER: Readonly<Record<MissionState, number>> = { pausada: 0, rodando: 1, proposta: 2, aceita: 3, recusada: 4 };

const STATE_TONE: Readonly<Record<MissionState, AnnotationTone>> = {
  proposta: 'warn',
  rodando: 'accent',
  pausada: 'warn',
  aceita: 'ok',
  recusada: 'muted',
};

const STATE_ACCENT: Readonly<Record<MissionState, string>> = {
  proposta: 'var(--state-waiting)',
  rodando: 'var(--state-working)',
  pausada: 'var(--state-waiting)',
  aceita: 'var(--zone-ok)',
  recusada: 'var(--text-muted)',
};

export interface HillClimbBarProps {
  snapshot: HillClimbSnapshot | null;
  onGesture: (missionId: string, gesture: OwnerGesture) => Promise<HillClimbGestureResult>;
}

function scoreColor(score: number): string {
  if (score >= HILL_CLIMB_RULES.cut) return 'var(--zone-ok)';
  if (score >= 6) return 'var(--state-waiting)';
  return 'var(--state-permission)';
}

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function HillClimbBar({ snapshot, onGesture }: HillClimbBarProps): React.JSX.Element {
  const missions = useMemo(
    () => Object.values(snapshot?.doc.missions ?? {}).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.createdAt - a.createdAt),
    [snapshot],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mission = missions.find((item) => item.id === selectedId) ?? missions[0] ?? null;

  return (
    <aside className={styles.bar} aria-label="Hill climbing" data-testid="hillclimb-bar">
      <header className={styles.header}>
        <span className={styles.headerLabel}>Hill climbing</span>
        <span className={styles.headerTitle}>{mission?.title ?? '—'}</span>
        <div className={styles.headerSpacer} />
        {snapshot?.council.ready ? (
          <AnnotationTag tone={snapshot.council.fake ? 'warn' : 'ok'}>
            <span title={snapshot.council.judges.map((judge) => `${judge.label}: ${judge.model}`).join('\n')}>
              {snapshot.council.fake ? 'juízes falsos' : `${snapshot.council.judges.length} juízes`}
            </span>
          </AnnotationTag>
        ) : null}
      </header>

      {snapshot && !snapshot.council.ready ? (
        <p className={styles.notice} data-testid="hillclimb-missing-key">
          {snapshot.council.reason}
        </p>
      ) : null}
      {snapshot?.warning ? <p className={styles.notice}>{snapshot.warning}</p> : null}

      {missions.length > 1 ? (
        <div className={styles.missionTabs} role="tablist" aria-label="Missões">
          {missions.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === mission?.id}
              className={[styles.missionTab, item.id === mission?.id ? styles.missionTabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setSelectedId(item.id)}
              title={STATE_LABEL[item.state]}
            >
              <span className={styles.missionDot} style={{ background: STATE_ACCENT[item.state] }} aria-hidden="true" />
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      {!snapshot ? null : mission === null ? (
        <p className={styles.empty} data-testid="hillclimb-empty">
          Nenhuma missão ainda. Uma sessão do quadro propõe a missão (alvo e critérios); ela vira carta no Oráculo e só roda depois do seu aceite.
        </p>
      ) : (
        <MissionView key={mission.id} mission={mission} readOnly={snapshot.readOnly} onGesture={onGesture} />
      )}
    </aside>
  );
}

interface MissionViewProps {
  mission: HillClimbMission;
  readOnly: boolean;
  onGesture: HillClimbBarProps['onGesture'];
}

function MissionView({ mission, readOnly, onGesture }: MissionViewProps): React.JSX.Element {
  const lastRodada = Math.max(0, mission.rodadas.length - 1);
  const [focusedRodada, setFocusedRodada] = useState(lastRodada);
  const [focusedRound, setFocusedRound] = useState<Record<number, number>>({});
  const rodadaIndex = Math.min(focusedRodada, lastRodada);

  const focusRound = (round: MissionRound): void => {
    setFocusedRodada(round.rodada);
    setFocusedRound((prev) => ({ ...prev, [round.rodada]: roundsOf(mission, round.rodada).indexOf(round) }));
  };

  const levels = useMemo((): LevelCarouselLevel<MissionRound>[] => {
    return mission.rodadas
      .map((rodada) => {
        const rounds = roundsOf(mission, rodada.index);
        const focusedCardIndex = Math.min(focusedRound[rodada.index] ?? rounds.length - 1, Math.max(0, rounds.length - 1));
        const move = (index: number): void => {
          setFocusedRodada(rodada.index);
          setFocusedRound((prev) => ({ ...prev, [rodada.index]: Math.max(0, Math.min(rounds.length - 1, index)) }));
        };
        return {
          key: `rodada-${rodada.index}`,
          label: `Rodada ${rodada.index + 1}${rodada.direction ? ' · redirecionada' : ''}`,
          tall: true,
          focusedCardIndex: Math.max(0, focusedCardIndex),
          cards: rounds.map((round) => ({ id: `round-${round.index}`, accent: scoreColor(lowestScore(round, mission.criteria)), content: round })),
          onFocusLevel: () => setFocusedRodada(rodada.index),
          onFocusCard: move,
          onPrevCard: () => move(focusedCardIndex - 1),
          onNextCard: () => move(focusedCardIndex + 1),
        };
      })
      .filter((level) => level.cards.length > 0);
  }, [mission, focusedRound]);
  const focusedLevelIndex = Math.max(0, levels.findIndex((level) => level.key === `rodada-${rodadaIndex}`));
  const focusedRoundIndex = levels[focusedLevelIndex]?.cards[levels[focusedLevelIndex]!.focusedCardIndex]?.content.index ?? null;

  return (
    <div className={styles.mission} data-testid="hillclimb-mission" data-state={mission.state}>
      <section className={styles.summary}>
        <div className={styles.summaryTop}>
          <AnnotationTag tone={STATE_TONE[mission.state]}>{STATE_LABEL[mission.state]}</AnnotationTag>
          <span className={styles.summaryCount}>
            {mission.rounds.length} round(s) · rodada {Math.max(1, mission.rodadas.length)} de {1 + HILL_CLIMB_RULES.maxExtraRodadas}
          </span>
        </div>
        <p className={styles.target} title={mission.target}>
          <span className={styles.label}>Alvo</span> {excerpt(mission.target, 200)}
        </p>
        <p className={styles.criteria}>
          <span className={styles.label}>Critérios</span> {mission.criteria.join(' · ')}
          {mission.measure ? ` · ${mission.measure.label} ${mission.measure.direction === 'menor' ? '≤' : '≥'} ${mission.measure.target}` : ''}
        </p>
      </section>

      <Trail mission={mission} focusedRound={focusedRoundIndex} onFocusRound={focusRound} />

      {mission.state === 'pausada' ? <Sample mission={mission} readOnly={readOnly} onGesture={onGesture} onFocusRound={focusRound} /> : null}

      {levels.length > 0 ? (
        <div className={styles.carousel}>
          <LevelCarousel<MissionRound>
            levels={levels}
            focusedLevelIndex={focusedLevelIndex}
            renderCard={(round, context) => <RoundCard mission={mission} round={round} focused={context.focused} />}
          />
        </div>
      ) : null}
    </div>
  );
}

interface TrailProps {
  mission: HillClimbMission;
  focusedRound: number | null;
  onFocusRound: (round: MissionRound) => void;
}

/** The rounds, oldest first, with a divider where a rodada closed (the pause) and a new one opened. */
function Trail({ mission, focusedRound, onFocusRound }: TrailProps): React.JSX.Element {
  return (
    <div className={styles.trilha} data-testid="hillclimb-trilha">
      {mission.rodadas.map((rodada) => {
        const rounds = roundsOf(mission, rodada.index);
        const pending = rodada.closed ? 0 : Math.max(0, rodada.maxRounds - rounds.length);
        return (
          <div key={rodada.index}>
            <div className={styles.divider} data-testid="hillclimb-divisor">
              <span>Rodada {rodada.index + 1}</span>
              <span className={styles.dividerMeta}>
                {rodada.maxRounds} rounds{rodada.closed ? ` · ${CLOSE_REASON_LABEL[rodada.closed.reason]}` : ''}
              </span>
            </div>
            {rodada.direction ? <p className={styles.direction}>Novo rumo: {rodada.direction}</p> : null}
            {rounds.map((round, i) => {
              const low = lowestScore(round, mission.criteria);
              const last = i === rounds.length - 1 && pending === 0;
              return (
                <div
                  key={round.index}
                  className={[styles.trilhaRow, focusedRound === round.index ? styles.trilhaRowSelected : ''].filter(Boolean).join(' ')}
                  onClick={() => onFocusRound(round)}
                  data-testid="hillclimb-round"
                  title={round.note ?? excerpt(round.version)}
                >
                  <span className={styles.trilhaRail} aria-hidden="true">
                    {last ? '└' : '├'}
                  </span>
                  <span className={styles.trilhaGlyph} style={{ color: scoreColor(low), borderColor: scoreColor(low) }} aria-hidden="true">
                    {low >= HILL_CLIMB_RULES.cut ? '✓' : '●'}
                  </span>
                  <span className={styles.trilhaFase}>round {round.index}</span>
                  <span className={styles.trilhaNote}>{round.note ?? excerpt(round.version, 60)}</span>
                  <span className={styles.trilhaState}>menor {low}</span>
                </div>
              );
            })}
            {Array.from({ length: pending }, (_, i) => (
              <div key={`pending-${i}`} className={[styles.trilhaRow, styles.trilhaRowPending].join(' ')}>
                <span className={styles.trilhaRail} aria-hidden="true">
                  {i === pending - 1 ? '└' : '├'}
                </span>
                <span className={styles.trilhaGlyph} aria-hidden="true">
                  ○
                </span>
                <span className={styles.trilhaFase}>round {rounds.length + i + 1 + mission.rounds.filter((r) => r.rodada < rodada.index).length}</span>
                <span className={styles.trilhaState}>{i === 0 && mission.state === 'rodando' ? 'esperando a versão' : ''}</span>
              </div>
            ))}
          </div>
        );
      })}
      {mission.rodadas.length === 0 ? (
        <p className={styles.emptyTrail}>
          {mission.state === 'proposta'
            ? `A primeira rodada (${HILL_CLIMB_RULES.firstRounds} rounds) começa quando você aceitar a carta no Oráculo.`
            : 'A missão não rodou.'}
        </p>
      ) : null}
    </div>
  );
}

function RoundCard({ mission, round, focused }: { mission: HillClimbMission; round: MissionRound; focused: boolean }): React.JSX.Element {
  const low = lowestScore(round, mission.criteria);
  return (
    <div className={styles.cardBody} data-testid="hillclimb-card" data-round={round.index} data-focused={focused ? 'true' : 'false'}>
      <div className={styles.cardTop}>
        <span className={styles.cardIcon}>◆</span>
        <span className={styles.cardTitle}>Round {round.index}</span>
        <span className={styles.cardStatus} style={{ color: scoreColor(low) }}>
          menor nota {low}
        </span>
      </div>
      <p className={styles.cardPlain}>{excerpt(round.version, focused ? 220 : 90)}</p>
      {focused ? (
        <>
          <table className={styles.scores} data-testid="hillclimb-notas">
            <thead>
              <tr>
                <th />
                {round.verdicts.map((verdict) => (
                  <th key={verdict.judge} title={verdict.model}>
                    {verdict.judge}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mission.criteria.map((criterion) => (
                <tr key={criterion}>
                  <th scope="row">{criterion}</th>
                  {round.verdicts.map((verdict) => {
                    const score = verdict.scores[criterion] ?? 0;
                    return (
                      <td key={verdict.judge} style={{ color: scoreColor(score) }}>
                        {score}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {round.measured !== undefined && mission.measure ? (
            <p className={styles.cardFooterMeta}>
              {mission.measure.label}: {round.measured} (alvo {mission.measure.direction === 'menor' ? '≤' : '≥'} {mission.measure.target})
            </p>
          ) : null}
          {round.note ? <p className={styles.cardFooterMeta}>O que mudou: {round.note}</p> : null}
        </>
      ) : null}
    </div>
  );
}

interface SampleProps {
  mission: HillClimbMission;
  readOnly: boolean;
  onGesture: HillClimbBarProps['onGesture'];
  onFocusRound: (round: MissionRound) => void;
}

/** The end-of-rodada sample: best version, the lowest-score curve, 2–3 in-between versions, why it closed, three gestures. */
function Sample({ mission, readOnly, onGesture, onFocusRound }: SampleProps): React.JSX.Element | null {
  const sample = rodadaSample(mission, mission.rodadas.length - 1);
  const [redirecting, setRedirecting] = useState(false);
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!sample) return null;
  const extras = extraRodadasLeft(mission);
  const send = (gesture: OwnerGesture): void => {
    setBusy(true);
    setError(null);
    void onGesture(mission.id, gesture)
      .then((result) => {
        if (!result.ok) setError(result.reason);
      })
      .catch(() => setError('Não consegui enviar o gesto; tente de novo.'))
      .finally(() => setBusy(false));
  };
  const max = 10;
  const width = 180;
  const height = 40;
  const step = sample.curve.length > 1 ? width / (sample.curve.length - 1) : 0;
  const points = sample.curve.map((point, i) => `${(i * step).toFixed(1)},${(height - (point.low / max) * height).toFixed(1)}`).join(' ');
  const cutY = height - (HILL_CLIMB_RULES.cut / max) * height;

  return (
    <section className={styles.sample} data-testid="hillclimb-amostra" aria-label="Amostra da rodada">
      <div className={styles.sampleHead}>
        <span className={styles.label}>Amostra da rodada {sample.rodada + 1}</span>
        <AnnotationTag tone={sample.reason === 'corte' ? 'ok' : 'warn'}>{CLOSE_REASON_LABEL[sample.reason]}</AnnotationTag>
      </div>
      <button type="button" className={styles.best} onClick={() => onFocusRound(sample.best)}>
        <span className={styles.label}>Melhor versão · round {sample.best.index} · menor nota {lowestScore(sample.best, mission.criteria)}</span>
        <span className={styles.bestText}>{excerpt(sample.best.version, 240)}</span>
      </button>
      <div className={styles.curveRow}>
        <svg className={styles.curve} viewBox={`-4 -4 ${width + 8} ${height + 8}`} role="img" aria-label="Menor nota por round">
          <line x1={0} x2={width} y1={cutY} y2={cutY} className={styles.cutLine} />
          <polyline points={points} className={styles.curveLine} />
          {sample.curve.map((point, i) => (
            <circle key={point.round} cx={i * step} cy={height - (point.low / max) * height} r={2.5} className={styles.curveDot} />
          ))}
        </svg>
        <span className={styles.curveLegend}>menor nota por round · linha = corte {HILL_CLIMB_RULES.cut}</span>
      </div>
      {sample.intermediates.length > 0 ? (
        <ul className={styles.intermediates}>
          {sample.intermediates.map((round) => (
            <li key={round.index}>
              <button type="button" onClick={() => onFocusRound(round)}>
                <span className={styles.trilhaFase}>round {round.index}</span> · menor {lowestScore(round, mission.criteria)} · {excerpt(round.version, 70)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {redirecting ? (
        <div className={styles.redirect}>
          <textarea
            className={styles.redirectInput}
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            placeholder="Para onde a próxima rodada vai? O Escalador recebe este texto."
            rows={3}
            aria-label="Novo rumo"
          />
          <div className={styles.gestures}>
            <Button variant="primary" disabled={busy || readOnly || !direction.trim()} onClick={() => send({ kind: 'redirecionar', text: direction })}>
              Redirecionar ({HILL_CLIMB_RULES.extraRounds} rounds)
            </Button>
            <Button variant="ghost" onClick={() => setRedirecting(false)}>
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.gestures} data-testid="hillclimb-gestos">
          <Button variant="primary" disabled={busy || readOnly} onClick={() => send({ kind: 'aceitar' })}>
            Parar e aceitar
          </Button>
          <Button variant="secondary" disabled={busy || readOnly || extras === 0} onClick={() => send({ kind: 'mais-uma' })}>
            Mais uma rodada
          </Button>
          <Button variant="secondary" disabled={busy || readOnly || extras === 0} onClick={() => setRedirecting(true)}>
            Redirecionar
          </Button>
        </div>
      )}
      <p className={styles.cardFooterMeta}>
        {extras > 0 ? `Restam ${extras} rodada(s) extra(s) de ${HILL_CLIMB_RULES.extraRounds} rounds.` : 'Não restam rodadas extras: só parar e aceitar.'}
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
