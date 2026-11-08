// Mindscape de homologação, fatia 2 — the "Cadeiras" lens of the factory's board, drawn from the factory's own
// `rigs.json` (decision D1: the rig describes itself, the Donel only mirrors). Two rig frames with their pods, the
// chairs between them ("fora das duas cadeias"), "Você" who only receives, and the arrows typed in words.
// Read only: nothing here writes the board, the config or the factory.

import { CHAIR_NODE, type ChairHealth } from '../../../shared/mindscape/chairs';
import { OWNER_TARGET, type RigLinkKind, type RigsShape } from '../../../shared/homologacao/rigs';
import type { RigsLayout } from '../../../shared/homologacao/rigsLayout';
import type { RigChairView } from '../../../shared/homologacao/rigsView';
import { arrowPath, HEALTH_LABEL } from './MindscapeChairs';
import chairStyles from './Chairs.module.css';
import styles from './Rigs.module.css';

/** The arrows' kinds in words: the legend names every one, the color only reinforces. */
export const LINK_LABEL: Readonly<Record<RigLinkKind, string>> = {
  delega: 'delega',
  verifica: 'verifica',
  escala: 'escala a você',
  acorda: 'rotina acorda',
};

const LINK_STROKE: Readonly<Record<RigLinkKind, { readonly color: string; readonly dash?: string }>> = {
  delega: { color: 'var(--text-muted)' },
  verifica: { color: 'var(--phase-plano)', dash: '7 5' },
  escala: { color: 'var(--state-waiting)' },
  acorda: { color: 'var(--text-muted)', dash: '2 5' },
};

const KIND_WORD = { codigo: 'código', fila: 'fila' } as const;

const RADIUS = CHAIR_NODE / 2;

/** What a chair says under its name: "N sentados", "vaga", "código" or "fila". */
export function rigChairCount(chair: RigChairView): string {
  if (chair.tipo !== 'agente') return KIND_WORD[chair.tipo];
  if (!chair.papel) return 'vaga';
  if (chair.seated.length > 0) return `${chair.seated.length} sentado${chair.seated.length > 1 ? 's' : ''}`;
  return 'ninguém sentado';
}

export interface RigsLayerProps {
  readonly shape: RigsShape;
  readonly chairs: readonly RigChairView[];
  readonly layout: RigsLayout;
  readonly showArrows: boolean;
  readonly highlight: ChairHealth | null;
  readonly selected: string | null;
  readonly onOpenChair: (chairId: string) => void;
}

export function RigsLayer({ shape, chairs, layout, showArrows, highlight, selected, onOpenChair }: RigsLayerProps): React.JSX.Element {
  const byId = new Map(chairs.map((chair) => [chair.id, chair]));
  const nodes = Object.entries(layout.centers);
  const kinds = [...new Set(shape.ligacoes.map((link) => link.tipo))];
  return (
    <>
      {shape.rigs.map((rig, index) => {
        const box = layout.rigs[index];
        if (!box) return null;
        return (
          <section key={rig.id} className={`${chairStyles.rig} ${styles.rigFrame}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} data-testid="mindscape-factory-rig">
            <header className={styles.rigHead}>
              <b className={styles.rigTitle}>
                Rig {index + 1} · {rig.nome}
              </b>
              <span className={styles.rigMission}>{rig.missao ?? (rig.pods.length === 0 ? 'Ainda não rodou' : '')}</span>
            </header>
            {rig.pods.length === 0 ? <p className={styles.rigEmpty}>Nenhuma cadeira desenhada ainda: este rig não rodou.</p> : null}
          </section>
        );
      })}
      {/* The pods, drawn like the owner's pods of the lens; here they come from the file, so they never move. */}
      {layout.rigs.flatMap((box, index) =>
        box.pods.map((podBox) => {
          const pod = layout.pods[index]?.find((candidate) => candidate.id === podBox.id);
          if (!pod) return null;
          return (
            <section key={`${box.id}/${pod.id}`} className={chairStyles.pod} style={{ left: podBox.x, top: podBox.y, width: podBox.w, height: podBox.h }} data-testid="mindscape-pod" data-pod={pod.id}>
              <div className={chairStyles.podHead}>
                <span className={`${chairStyles.kind} ${chairStyles.kindPod}`}>Pod</span>
                <span className={chairStyles.podTitle}>{pod.name}</span>
                {pod.mission ? <span className={chairStyles.podMission}>{pod.mission}</span> : null}
              </div>
              {pod.chairIds.length === 0 ? <span className={chairStyles.podEmpty}>Sem cadeiras no rigs.json.</span> : null}
            </section>
          );
        }),
      )}
      <div className={styles.middle} style={{ left: layout.middle.x, top: layout.middle.y, width: layout.middle.w, height: layout.middle.h }}>
        <span className={styles.middleLabel}>Fora das duas cadeias</span>
      </div>

      {kinds.length > 0 ? (
        <div className={styles.legend} style={{ left: layout.bounds.x, top: layout.bounds.y - 44 }} data-testid="mindscape-rigs-legend">
          {kinds.map((kind) => (
            <span key={kind} className={styles.legendItem}>
              <svg width="34" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="33" y2="4" stroke={LINK_STROKE[kind].color} strokeWidth="2" strokeDasharray={LINK_STROKE[kind].dash} />
              </svg>
              {LINK_LABEL[kind]}
            </span>
          ))}
        </div>
      ) : null}

      {showArrows ? (
        <svg className={chairStyles.arrows} aria-hidden="true">
          <defs>
            {(Object.keys(LINK_STROKE) as RigLinkKind[]).map((kind) => (
              <marker key={kind} id={`rig-arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill={LINK_STROKE[kind].color} />
              </marker>
            ))}
          </defs>
          {shape.ligacoes.map((link) => {
            const from = layout.centers[link.de];
            const to = layout.centers[link.para];
            if (!from || !to) return null;
            const others = nodes.filter(([id]) => id !== link.de && id !== link.para).map(([, point]) => point);
            const path = arrowPath(from, to, 0, others);
            const stroke = LINK_STROKE[link.tipo];
            const dim = highlight !== null && byId.get(link.de)?.health !== highlight;
            return (
              <g key={`${link.de}>${link.para}>${link.tipo}`} className={dim ? chairStyles.arrowDim : undefined}>
                <path d={path} fill="none" stroke={stroke.color} strokeWidth={1.8} strokeDasharray={stroke.dash} markerEnd={`url(#rig-arrow-${link.tipo})`}>
                  <title>{`${LINK_LABEL[link.tipo]}${link.rotulo ? `: ${link.rotulo}` : ''}`}</title>
                </path>
                {link.rotulo ? <ArrowLabel path={path} text={link.rotulo} color={stroke.color} /> : null}
              </g>
            );
          })}
        </svg>
      ) : null}

      {layout.centers[OWNER_TARGET] ? (
        <div
          className={styles.owner}
          style={{ left: layout.centers[OWNER_TARGET].x - RADIUS, top: layout.centers[OWNER_TARGET].y - RADIUS, width: CHAIR_NODE, height: CHAIR_NODE }}
          data-testid="mindscape-rigs-owner"
          title="Você só recebe: nenhuma seta sai daqui"
        >
          <b className={chairStyles.nodeName}>Você</b>
          <span className={chairStyles.nodeCount}>dono · só recebe</span>
        </div>
      ) : null}

      {chairs.map((chair) => {
        const center = layout.centers[chair.id];
        if (!center) return null;
        const dim = highlight !== null && chair.health !== highlight;
        const classes = [
          chairStyles.node,
          chairStyles[`h-${chair.health}`],
          styles[`k-${chair.tipo}`],
          selected === chair.id ? chairStyles.nodeOn : '',
          dim ? chairStyles.dim : '',
        ]
          .filter(Boolean)
          .join(' ');
        const count = rigChairCount(chair);
        return (
          <div key={chair.id}>
            <button
              type="button"
              className={classes}
              style={{ left: center.x - RADIUS, top: center.y - RADIUS, width: CHAIR_NODE, height: CHAIR_NODE }}
              onClick={() => onOpenChair(chair.id)}
              aria-label={`Cadeira ${chair.nome}, ${count}, ${HEALTH_LABEL[chair.health]}`}
              data-testid="mindscape-chair"
              data-chair={chair.id}
              data-health={chair.health}
              data-kind={chair.tipo}
            >
              <b className={`${chairStyles.nodeName} ${styles.rigNodeName}`}>{chair.nome}</b>
              <span className={chair.tipo === 'agente' ? chairStyles.nodeCount : styles.kindWord}>{count}</span>
            </button>
            {chair.line ? (
              <span className={`${styles.nodeLine} ${dim ? chairStyles.dim : ''}`} style={{ left: center.x - 95, top: center.y + RADIUS + 8, width: 190 }}>
                {chair.line}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** The label stands at the middle of the arrow, a little off the line; a long one is cut (the whole one is in the tooltip). */
const LABEL_MAX = 26;

function ArrowLabel({ path, text, color }: { path: string; text: string; color: string }): React.JSX.Element | null {
  // The middle of the drawn arrow: of the segment, or of the curve when it bows around a chair (`arrowPath`).
  const n = (path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  if (n.length < 4) return null;
  const [x0, y0] = [n[0]!, n[1]!];
  const curved = n.length >= 6;
  const [x1, y1] = curved ? [n[4]!, n[5]!] : [n[2]!, n[3]!];
  const mid = curved ? { x: 0.25 * x0 + 0.5 * n[2]! + 0.25 * x1, y: 0.25 * y0 + 0.5 * n[3]! + 0.25 * y1 } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  // Off the line by its normal, the one that points up on screen, so the label sits above a flat arrow.
  const flip = dx > 0 ? -1 : 1;
  const x = mid.x + (-dy / length) * 12 * flip;
  const y = mid.y + (dx / length) * 12 * flip;
  const shown = text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
  return (
    <text x={x} y={y} className={styles.arrowLabel} fill={color} textAnchor="middle" dominantBaseline="middle">
      {shown}
    </text>
  );
}

/** The notice of a factory board whose shape could not be read: the lens of today stays, with why. */
export function RigsNotice({ text }: { text: string }): React.JSX.Element {
  return (
    <div className={styles.notice} role="status" data-testid="mindscape-rigs-notice">
      {text}
    </div>
  );
}
