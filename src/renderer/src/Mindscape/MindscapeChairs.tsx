// Cadeiras, fatia 1 — the "Cadeiras" lens of the Mindscape (prototype F2a, owner 06/11): the rig as a frame with
// its name written, one round node per chair (big name, "N sentados", border = health), the path of the work as
// arrows, the band that counts chairs by health (a click highlights them) and the drawer that opens on a click.
// Everything here is read from the board; nothing is written (the lens adds no field to `mindscape.json`).

import { useEffect, useState } from 'react';
import type { SessionState } from '@donel-dev/design-system';
import { CHAIR_HEALTHS, CHAIR_NODE, type Chair, type ChairEdge, type ChairHealth, type ChairsLayout, type PodShape } from '../../../shared/mindscape/chairs';
import type { LedgerViewState } from '../../../shared/ledger/contract';
import styles from './Chairs.module.css';

export type OwnerLayerMode = 'over' | 'dim' | 'hidden';

export const HEALTH_LABEL: Readonly<Record<ChairHealth, string>> = {
  problema: 'problema',
  atencao: 'atenção',
  bem: 'bem',
  'sem-sinal': 'sem sinal',
};

const HEALTH_HINT: Readonly<Record<ChairHealth, string>> = {
  problema: 'alguém sentado com erro ou no limite de uso',
  atencao: 'alguém sentado precisa de você',
  bem: 'gente sentada, nada esperando você',
  'sem-sinal': 'ninguém sentado agora',
};

const STATE_VAR: Readonly<Record<SessionState, string>> = {
  working: 'var(--state-working)',
  waiting: 'var(--state-waiting)',
  permission: 'var(--state-permission)',
  done: 'var(--state-done)',
  error: 'var(--state-error)',
};

const TASK_LABEL: Readonly<Record<LedgerViewState, string>> = {
  aberta: 'aberta',
  'em-execucao': 'em execução',
  entregue: 'entregue',
  aceita: 'aceita',
  rejeitada: 'rejeitada',
  cancelada: 'cancelada',
};

/** What a chair node shows: its role seal and name. */
export interface ChairFace {
  readonly name: string;
  /** CSS color of the role seal. */
  readonly color: string;
}

export function seatedLabel(chair: Chair): string {
  if (chair.seated.length > 0) return `${chair.seated.length} sentado${chair.seated.length > 1 ? 's' : ''}`;
  return chair.closed.length > 0 ? 'dormindo' : 'vaga';
}

// ---------------------------------------------------------------------------
// On the board (inside the world: board units)
// ---------------------------------------------------------------------------

export interface ChairsLayerProps {
  readonly boardName: string;
  readonly chairs: readonly Chair[];
  readonly edges: readonly ChairEdge[];
  readonly layout: ChairsLayout;
  readonly faceOf: (chair: Chair) => ChairFace;
  /** The state of each seated place (the small dots around the node). */
  readonly seatState: (placeId: string) => SessionState | undefined;
  readonly showArrows: boolean;
  readonly highlight: ChairHealth | null;
  readonly selected: string | null;
  readonly onOpenChair: (chairId: string) => void;
  readonly onOpenRig: () => void;
  /** Cadeiras, fatia 4 — the pods (name, mission, chairs); their boxes come in `layout.pods`. */
  readonly pods?: readonly PodShape[];
  /** The board's zoom (a pod drag is measured on screen). */
  readonly zoom?: number;
  /** Absent = the pods do not move (a source the owner does not edit, or the hidden layer). */
  readonly onMovePod?: (podId: string, x: number, y: number) => void;
  readonly onOpenPod?: (podId: string) => void;
}

/** The `selected` value of a pod. */
export function podSelection(podId: string): string {
  return `\u0000pod:${podId}`;
}

/** A press on a pod header that moves less than this (px) is a click. */
const DRAG_SLOP_PX = 3;

const RADIUS = CHAIR_NODE / 2;
/** At most this many seat dots around a node (the rest are counted in "N sentados"). */
const MAX_SEAT_DOTS = 6;

/** How far a curved arrow bows out, so it never runs under a chair it skips (Líder → Revisor past Dev). */
const BOW = 90;

function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * The arrow from one chair to another, cut at the node borders. A pair that points both ways is drawn as two
 * parallel arrows (`offset`); an arrow that would cross another chair bows out instead.
 */
export function arrowPath(from: { x: number; y: number }, to: { x: number; y: number }, offset: number, others: readonly { x: number; y: number }[]): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const crosses = others.some((other) => distanceToSegment(other, from, to) < RADIUS + 8);
  if (!crosses) {
    const ux = dx / length;
    const uy = dy / length;
    const ox = nx * offset;
    const oy = ny * offset;
    return `M${from.x + ux * (RADIUS + 6) + ox},${from.y + uy * (RADIUS + 6) + oy} L${to.x - ux * (RADIUS + 10) + ox},${to.y - uy * (RADIUS + 10) + oy}`;
  }
  // Bow to the side with the normal pointing up (or left), the same for every skipped chair.
  const side = ny < 0 || (ny === 0 && nx < 0) ? 1 : -1;
  const control = { x: (from.x + to.x) / 2 + nx * (BOW * 2 + offset) * side, y: (from.y + to.y) / 2 + ny * (BOW * 2 + offset) * side };
  const toward = (a: { x: number; y: number }, b: { x: number; y: number }, cut: number): { x: number; y: number } => {
    const length2 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: a.x + ((b.x - a.x) / length2) * cut, y: a.y + ((b.y - a.y) / length2) * cut };
  };
  const start = toward(from, control, RADIUS + 6);
  const end = toward(to, control, RADIUS + 10);
  return `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`;
}

export function ChairsLayer({
  boardName,
  chairs,
  edges,
  layout,
  faceOf,
  seatState,
  showArrows,
  highlight,
  selected,
  onOpenChair,
  onOpenRig,
  pods = [],
  zoom = 1,
  onMovePod,
  onOpenPod,
}: ChairsLayerProps): React.JSX.Element {
  const { rig } = layout;
  // A pod in flight: its frame and its chairs follow the pointer; the drop writes the new corner (one history entry).
  const [drag, setDrag] = useState<{ readonly podId: string; readonly dx: number; readonly dy: number } | null>(null);
  const draggedChairs = new Set(drag ? (pods.find((pod) => pod.id === drag.podId)?.chairIds ?? []) : []);
  const centers: Record<string, { x: number; y: number }> = {};
  for (const [id, center] of Object.entries(layout.centers)) centers[id] = drag && draggedChairs.has(id) ? { x: center.x + drag.dx, y: center.y + drag.dy } : center;
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, podId: string, box: { x: number; y: number }): void => {
    if (event.button !== 0) return;
    // The board never sees this press (no lasso, no selection).
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (next: PointerEvent): void => {
      const dx = (next.clientX - startX) / zoom;
      const dy = (next.clientY - startY) / zoom;
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) < DRAG_SLOP_PX) return;
      moved = true;
      if (onMovePod) setDrag({ podId, dx, dy });
    };
    const up = (next: PointerEvent): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) {
        onOpenPod?.(podId);
        return;
      }
      if (next.type === 'pointerup' && onMovePod) onMovePod(podId, box.x + (next.clientX - startX) / zoom, box.y + (next.clientY - startY) / zoom);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const seatedTotal = chairs.reduce((sum, chair) => sum + chair.seated.length, 0);
  const pairs = new Set(edges.map((edge) => `${edge.from}\u0000${edge.to}`));
  return (
    <>
      <section className={styles.rig} style={{ left: rig.x, top: rig.y, width: rig.w, height: rig.h }} data-testid="mindscape-rig">
        <div className={styles.frameHead}>
          <button type="button" className={selected === RIG_SELECTION ? `${styles.frameName} ${styles.frameNameOn}` : styles.frameName} onClick={onOpenRig}>
            <span className={styles.kind}>Rig</span>
            <span className={styles.rigName}>{boardName}</span>
          </button>
          <span className={styles.frameCount}>
            {chairs.length} cadeira{chairs.length === 1 ? '' : 's'} · {seatedTotal} sentado{seatedTotal === 1 ? '' : 's'} agora
          </span>
        </div>
      </section>
      {layout.pods.map((box) => {
        const pod = pods.find((candidate) => candidate.id === box.id);
        if (!pod) return null;
        const shown = drag?.podId === box.id ? { ...box, x: box.x + drag.dx, y: box.y + drag.dy } : box;
        const on = selected === podSelection(box.id);
        return (
          <section key={box.id} className={drag?.podId === box.id ? `${styles.pod} ${styles.podDragging}` : styles.pod} style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }} data-testid="mindscape-pod" data-pod={box.id}>
            <div className={styles.podHead}>
              <button
                type="button"
                className={on ? `${styles.frameName} ${styles.podName} ${styles.frameNameOn}` : `${styles.frameName} ${styles.podName}`}
                onPointerDown={(event) => startDrag(event, box.id, box)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onOpenPod?.(box.id);
                }}
                title={onMovePod ? 'Clique para ver o pod; arraste para mover' : 'Clique para ver o pod'}
              >
                <span className={`${styles.kind} ${styles.kindPod}`}>Pod</span>
                <span className={styles.podTitle}>{pod.name}</span>
              </button>
              {pod.mission ? <span className={styles.podMission}>{pod.mission}</span> : null}
            </div>
            {pod.chairIds.length === 0 ? <span className={styles.podEmpty}>Sem cadeiras: escolha o pod na gaveta de uma cadeira.</span> : null}
          </section>
        );
      })}
      {showArrows ? (
        <svg className={styles.arrows} aria-hidden="true">
          <defs>
            <marker id="chair-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--state-done)" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = centers[edge.from];
            const to = centers[edge.to];
            if (!from || !to) return null;
            const both = pairs.has(`${edge.to}\u0000${edge.from}`);
            const others = chairs.filter((chair) => chair.id !== edge.from && chair.id !== edge.to).flatMap((chair) => centers[chair.id] ?? []);
            return (
              <path
                key={`${edge.from}>${edge.to}`}
                d={arrowPath(from, to, both ? 7 : 0, others)}
                className={highlight ? styles.arrowDim : undefined}
                fill="none"
                stroke="var(--state-done)"
                strokeWidth={1.6}
                markerEnd={edge.arrow ? 'url(#chair-arrow)' : undefined}
              >
                <title>{`${edge.count} ligaç${edge.count === 1 ? 'ão' : 'ões'}`}</title>
              </path>
            );
          })}
        </svg>
      ) : null}
      {chairs.map((chair) => {
        const center = centers[chair.id];
        if (!center) return null;
        const face = faceOf(chair);
        const dim = highlight !== null && chair.health !== highlight;
        const classes = [styles.node, styles[`h-${chair.health}`], selected === chair.id ? styles.nodeOn : '', dim ? styles.dim : ''].filter(Boolean).join(' ');
        const dots = chair.seated.slice(0, MAX_SEAT_DOTS);
        return (
          <button
            key={chair.id}
            type="button"
            className={classes}
            style={{ left: center.x - RADIUS, top: center.y - RADIUS, width: CHAIR_NODE, height: CHAIR_NODE }}
            onClick={() => onOpenChair(chair.id)}
            aria-label={`Cadeira ${face.name}, ${HEALTH_LABEL[chair.health]}, ${seatedLabel(chair)}`}
            data-testid="mindscape-chair"
            data-chair={chair.id}
            data-health={chair.health}
          >
            {dots.map((placeId, index) => {
              const angle = -Math.PI / 2 + (index - (dots.length - 1) / 2) * 0.4;
              const state = seatState(placeId) ?? 'done';
              return (
                <span
                  key={placeId}
                  className={styles.seatDot}
                  style={{ left: RADIUS + 74 * Math.cos(angle) - 6, top: RADIUS + 74 * Math.sin(angle) - 6, background: STATE_VAR[state] }}
                />
              );
            })}
            <span className={styles.seal} style={{ background: face.color }} />
            <b className={styles.nodeName}>{face.name}</b>
            <span className={styles.nodeCount}>{seatedLabel(chair)}</span>
          </button>
        );
      })}
    </>
  );
}

/** The `selected` value of the rig (a chair is selected by its id). */
export const RIG_SELECTION = '\u0000rig';

// ---------------------------------------------------------------------------
// The band: the motto, the owner's layer, the arrows and the count by health
// ---------------------------------------------------------------------------

export interface ChairsBandProps {
  readonly placeCount: number;
  readonly chairCount: number;
  /** Replaces the line under the motto (the factory's board says where its chairs come from). */
  readonly detail?: string;
  readonly counts: Readonly<Record<ChairHealth, number>>;
  readonly highlight: ChairHealth | null;
  readonly onHighlight: (health: ChairHealth | null) => void;
  readonly ownerMode: OwnerLayerMode;
  readonly onOwnerMode: (mode: OwnerLayerMode) => void;
  readonly showArrows: boolean;
  readonly onShowArrows: (show: boolean) => void;
  /** Cadeiras, fatia 4 — "+ Pod"; absent = no new pod now (the owner's layer is hidden). */
  readonly onAddPod?: () => void;
}

function Segmented<T extends string | boolean>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void }): React.JSX.Element {
  return (
    <span className={styles.toolGroup}>
      <span className={styles.toolLabel}>{label}</span>
      <span className={styles.segmented} role="group" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={String(option)} type="button" aria-pressed={option === value} className={option === value ? styles.segOn : undefined} onClick={() => onChange(option)}>
            {text}
          </button>
        ))}
      </span>
    </span>
  );
}

const OWNER_OPTIONS: ReadonlyArray<readonly [OwnerLayerMode, string]> = [
  ['over', 'Por cima'],
  ['dim', 'Esmaecido'],
  ['hidden', 'Oculto'],
];
const ARROW_OPTIONS: ReadonlyArray<readonly [boolean, string]> = [
  [true, 'Caminho do trabalho'],
  [false, 'Ocultas'],
];

export function ChairsBand({ placeCount, chairCount, detail, counts, highlight, onHighlight, ownerMode, onOwnerMode, showArrows, onShowArrows, onAddPod }: ChairsBandProps): React.JSX.Element {
  return (
    <div className={styles.band} data-testid="chairs-band">
      <div className={styles.motto}>
        <b>Os agentes mudam. As cadeiras ficam.</b>
        <span>
          {detail ?? `${placeCount} lugar${placeCount === 1 ? '' : 'es'} no quadro → ${chairCount} cadeira${chairCount === 1 ? '' : 's'}, uma por papel. Quem já sentou está dentro delas.`}
        </span>
      </div>
      <div className={styles.tools}>
        <Segmented label="Seu desenho" value={ownerMode} options={OWNER_OPTIONS} onChange={onOwnerMode} />
        <Segmented label="Setas" value={showArrows} options={ARROW_OPTIONS} onChange={onShowArrows} />
        {onAddPod ? (
          <button type="button" className={styles.button} onClick={onAddPod} data-testid="chairs-add-pod" title="Um pod agrupa cadeiras; ele mesmo arruma as cadeiras dentro">
            + Pod
          </button>
        ) : null}
      </div>
      {CHAIR_HEALTHS.map((health) => (
        <button
          key={health}
          type="button"
          className={highlight === health ? `${styles.num} ${styles.numOn}` : styles.num}
          aria-pressed={highlight === health}
          title={`Destacar as cadeiras com ${HEALTH_LABEL[health]}: ${HEALTH_HINT[health]}`}
          onClick={() => onHighlight(highlight === health ? null : health)}
          data-testid="chairs-count"
          data-health={health}
        >
          <span className={styles.numValue}>{counts[health]}</span>
          <span className={styles.numLabel}>
            <span className={`${styles.healthDot} ${styles[`d-${health}`]}`} />
            {HEALTH_LABEL[health]}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

export interface SeatedRow {
  readonly placeId: string;
  readonly name: string;
  readonly state: SessionState;
  /** "trabalhando", "parada", "precisa de você · pergunta". */
  readonly label: string;
  readonly since: number;
  readonly onOpen: () => void;
}

export interface PastRow {
  readonly placeId: string;
  readonly name: string;
  readonly when: string;
  readonly onOpen?: () => void;
}

export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly state: LedgerViewState;
}

export interface ChairDetails {
  readonly chair: Chair;
  readonly face: ChairFace;
  readonly address: string;
  readonly boardName: string;
  readonly seated: readonly SeatedRow[];
  readonly past: readonly PastRow[];
  readonly notes: number;
  readonly lastNote?: { readonly text: string; readonly by: string; readonly at: number };
  readonly configuredModel?: string;
  readonly configuredEffort?: string;
  readonly observedEngines: readonly string[];
  readonly liveTasks: readonly TaskRow[];
  readonly closedTasks: number;
}

/** Cadeiras, fatia 4 — the pod a chair sits in, chosen in its drawer. */
export interface PodChoice {
  readonly current: string | null;
  readonly pods: readonly { readonly id: string; readonly name: string }[];
  readonly onPick: (podId: string | null) => void;
}

export interface PodDetails {
  readonly podId: string;
  readonly name: string;
  readonly mission?: string;
  readonly boardName: string;
  readonly chairs: readonly { readonly chair: Chair; readonly face: ChairFace }[];
  /** Chairs of the board in no pod or in another one (what "+ cadeira" offers). */
  readonly others: readonly { readonly chair: Chair; readonly face: ChairFace }[];
  /** Absent = read-only (the owner's layer is hidden). */
  readonly edit?: {
    readonly onRename: (name: string) => void;
    readonly onMission: (mission: string) => void;
    readonly onAddChair: (chairId: string) => void;
    readonly onRemoveChair: (chairId: string) => void;
    readonly onDelete: () => void;
  };
}

export interface RigDetails {
  readonly boardName: string;
  readonly projectPath: string;
  readonly placeCount: number;
  readonly chairs: readonly { readonly chair: Chair; readonly face: ChairFace }[];
}

/** The long list of who sat before is cut here (the rest is counted). */
const MAX_PAST_ROWS = 40;

function clock(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ago(since: number, now: number): string {
  if (!since) return '';
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `há ${hours} h` : `há ${Math.round(hours / 24)} d`;
}

/** The note as plain text: the drawer has no Markdown, so the marks of emphasis and code go away. */
function plainNote(text: string): string {
  return text.replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '');
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <li className={styles.rowEmpty}>
      <span>{text}</span>
    </li>
  );
}

export interface ChairDrawerProps {
  readonly details: ChairDetails | RigDetails | PodDetails | null;
  readonly onClose: () => void;
  readonly onOpenChair: (chairId: string) => void;
  /** "Definir cadeira ▸" — the chair screen (B1) of the chair's role. */
  readonly onDefine?: (roleId: string) => void;
  /** Cadeiras, fatia 4 — the pod of the chair open in the drawer. */
  readonly podChoice?: PodChoice;
}

function isRig(details: ChairDetails | RigDetails | PodDetails): details is RigDetails {
  return 'projectPath' in details;
}

function isPod(details: ChairDetails | RigDetails | PodDetails): details is PodDetails {
  return 'podId' in details;
}

export function ChairDrawer({ details, onClose, onOpenChair, onDefine, podChoice }: ChairDrawerProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const close = (
    <button type="button" className={styles.close} aria-label="Fechar" onClick={onClose}>
      ✕
    </button>
  );
  return (
    <aside className={details ? `${styles.drawer} ${styles.drawerOpen}` : styles.drawer} aria-hidden={!details} data-testid="chair-drawer">
      {details && isRig(details) ? (
        <>
          <header className={styles.drawerHead}>
            {close}
            <div className={styles.headRow}>
              <span className={styles.kind}>Rig</span>
              <b className={styles.drawerTitle}>{details.boardName}</b>
            </div>
            <div className={styles.mono}>{details.projectPath}</div>
            <div className={styles.caption}>
              {details.chairs.length} cadeiras · {details.placeCount} lugares · {details.chairs.reduce((sum, entry) => sum + entry.chair.seated.length, 0)} sentados agora
            </div>
            <p className={styles.caption}>O rig é o quadro do projeto. Use "+ Pod" para agrupar cadeiras; a missão e a folha de instruções do rig chegam depois.</p>
          </header>
          <div className={styles.drawerBody}>
            <h4>Cadeiras</h4>
            <ul className={styles.list}>
              {details.chairs.map(({ chair, face }) => (
                <li key={chair.id} className={styles.rowGo} onClick={() => onOpenChair(chair.id)}>
                  <span className={styles.seal} style={{ background: face.color }} />
                  <span>
                    <b>{face.name}</b> <span className={styles.muted}>· {seatedLabel(chair)}</span>
                  </span>
                  <span className={styles.chip}>
                    <span className={`${styles.healthDot} ${styles[`d-${chair.health}`]}`} /> {HEALTH_LABEL[chair.health]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : details && isPod(details) ? (
        <PodBody key={details.podId} details={details} close={close} onOpenChair={onOpenChair} />
      ) : details ? (
        <ChairBody details={details} close={close} now={now} onDefine={onDefine} podChoice={podChoice} />
      ) : null}
    </aside>
  );
}

function PodBody({ details, close, onOpenChair }: { details: PodDetails; close: React.ReactNode; onOpenChair: (chairId: string) => void }): React.JSX.Element {
  const [name, setName] = useState(details.name);
  const [mission, setMission] = useState(details.mission ?? '');
  useEffect(() => setName(details.name), [details.name]);
  useEffect(() => setMission(details.mission ?? ''), [details.mission]);
  const { edit } = details;
  return (
    <>
      <header className={styles.drawerHead}>
        {close}
        <div className={styles.headRow}>
          <span className={`${styles.kind} ${styles.kindPod}`}>Pod</span>
          <b className={styles.drawerTitle}>{details.name}</b>
        </div>
        <div className={styles.caption}>
          Rig {details.boardName} · {details.chairs.length} cadeira{details.chairs.length === 1 ? '' : 's'} ·{' '}
          {details.chairs.reduce((sum, entry) => sum + entry.chair.seated.length, 0)} sentados agora
        </div>
        {edit ? (
          <div className={styles.form}>
            <label>
              <span>Nome</span>
              <input
                className={styles.input}
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => edit.onRename(name)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') edit.onRename(name);
                }}
              />
            </label>
            <label>
              <span>Missão</span>
              <input
                className={styles.input}
                value={mission}
                maxLength={200}
                placeholder="Uma linha: o que este pod entrega"
                onChange={(event) => setMission(event.target.value)}
                onBlur={() => edit.onMission(mission)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') edit.onMission(mission);
                }}
              />
            </label>
          </div>
        ) : details.mission ? (
          <div className={styles.kv}>
            <span>Missão</span>
            <span>{details.mission}</span>
          </div>
        ) : null}
        <p className={styles.caption}>O pod arruma as próprias cadeiras; arraste o pod pelo nome para movê-lo.</p>
      </header>
      <div className={styles.drawerBody}>
        <h4>Cadeiras</h4>
        <ul className={styles.list}>
          {details.chairs.length === 0 ? <Empty text="Nenhuma ainda." /> : null}
          {details.chairs.map(({ chair, face }) => (
            <li key={chair.id}>
              <span className={styles.seal} style={{ background: face.color }} />
              <span className={styles.rowGo} onClick={() => onOpenChair(chair.id)}>
                <b>{face.name}</b> <span className={styles.muted}>· {seatedLabel(chair)}</span>
              </span>
              {edit ? (
                <button type="button" className={styles.linkButton} onClick={() => edit.onRemoveChair(chair.id)}>
                  tirar do pod
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
        {edit && details.others.length > 0 ? (
          <select
            className={styles.select}
            value=""
            aria-label="Pôr uma cadeira neste pod"
            onChange={(event) => {
              if (event.target.value) edit.onAddChair(event.target.value);
            }}
          >
            <option value="">+ pôr uma cadeira neste pod…</option>
            {details.others.map(({ chair, face }) => (
              <option key={chair.id} value={chair.id}>
                {face.name}
              </option>
            ))}
          </select>
        ) : null}
        {edit ? (
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={edit.onDelete}>
              Apagar o pod
            </button>
            <span className={styles.caption}>As cadeiras ficam no quadro, sem pod. Ctrl+Z desfaz.</span>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ChairBody({ details, close, now, onDefine, podChoice }: { details: ChairDetails; close: React.ReactNode; now: number; onDefine?: (roleId: string) => void; podChoice?: PodChoice }): React.JSX.Element {
  const { chair, face } = details;
  const observed = details.observedEngines.length > 0 ? details.observedEngines.join(', ') : '—';
  const pastShown = details.past.slice(0, MAX_PAST_ROWS);
  return (
    <>
      <header className={styles.drawerHead}>
        {close}
        <div className={styles.headRow}>
          <span className={styles.seal} style={{ background: face.color }} />
          <b className={styles.drawerTitle}>{face.name}</b>
          <span className={styles.kind}>Cadeira</span>
        </div>
        <div className={styles.mono}>{details.address}</div>
        <div className={styles.caption}>Rig {details.boardName}</div>
        <div className={styles.kv}>
          <span>Saúde</span>
          <span>
            <span className={`${styles.healthDot} ${styles[`d-${chair.health}`]}`} /> {HEALTH_LABEL[chair.health]}
          </span>
          <span>Estado</span>
          <span>
            {seatedLabel(chair)}
            {chair.pending.length > 0 ? ` · ${chair.pending.length} lugar${chair.pending.length > 1 ? 'es' : ''} sem começar` : ''}
          </span>
          <span>Histórico</span>
          <span>
            {chair.placeIds.length} lugar{chair.placeIds.length === 1 ? '' : 'es'} · {details.notes} nota{details.notes === 1 ? '' : 's'}
          </span>
          {podChoice && chair.roleId ? (
            <>
              <span>Pod</span>
              <span>
                <select className={styles.select} value={podChoice.current ?? ''} aria-label="Pod da cadeira" onChange={(event) => podChoice.onPick(event.target.value || null)}>
                  <option value="">sem pod</option>
                  {podChoice.pods.map((pod) => (
                    <option key={pod.id} value={pod.id}>
                      {pod.name}
                    </option>
                  ))}
                </select>
              </span>
            </>
          ) : null}
        </div>
        {onDefine && chair.roleId ? (
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => chair.roleId && onDefine(chair.roleId)}>
              Definir cadeira ▸
            </button>
          </div>
        ) : null}
      </header>
      <div className={styles.drawerBody}>
        <h4>Configurado × observado</h4>
        <div className={styles.cmp}>
          <span />
          <span className={styles.muted}>configurado</span>
          <span className={styles.muted}>observado</span>
          <span>Modelo</span>
          <span>{details.configuredModel ?? 'conta ativa'}</span>
          <span>{observed}</span>
          <span>Esforço</span>
          <span>{details.configuredEffort ?? '—'}</span>
          <span className={styles.muted}>não medido</span>
        </div>

        <h4>Onde parou</h4>
        {details.lastNote ? (
          <div className={styles.stop}>
            <div className={styles.stopText}>{plainNote(details.lastNote.text)}</div>
            <div className={styles.caption}>
              nota de {details.lastNote.by} · {clock(details.lastNote.at)}
            </div>
          </div>
        ) : (
          <div className={styles.stop}>
            <span className={styles.muted}>Nenhuma nota escrita por quem sentou aqui.</span>
          </div>
        )}

        <h4>Oráculo (presas à cadeira)</h4>
        <ul className={styles.list}>
          {details.liveTasks.length === 0 ? <Empty text="Nenhuma tarefa viva." /> : null}
          {details.liveTasks.map((task) => (
            <li key={task.id}>
              <span className={styles.mono}>{task.id}</span>
              <span>{task.title}</span>
              <span className={`${styles.chip} ${styles[`t-${task.state}`] ?? ''}`}>{TASK_LABEL[task.state]}</span>
            </li>
          ))}
        </ul>
        {details.closedTasks > 0 ? <div className={styles.caption}>e {details.closedTasks} fechada{details.closedTasks > 1 ? 's' : ''}</div> : null}

        <h4>Sentados agora</h4>
        <ul className={styles.list}>
          {details.seated.length === 0 ? <Empty text="Ninguém sentado agora." /> : null}
          {details.seated.map((row) => (
            <li key={row.placeId} className={styles.rowGo} onClick={row.onOpen} title="Ir ao terminal">
              <span className={styles.stateDot} style={{ background: STATE_VAR[row.state] }} />
              <span>
                {row.name}
                <br />
                <span className={styles.caption}>{[row.label, ago(row.since, now)].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={styles.chip}>{row.label.startsWith('precisa') ? 'precisa de você' : row.label}</span>
            </li>
          ))}
        </ul>

        <h4>Quem já sentou ({details.past.length})</h4>
        <ul className={styles.list}>
          {details.past.length === 0 ? <Empty text="Ninguém." /> : null}
          {pastShown.map((row) => (
            <li key={row.placeId} className={row.onOpen ? styles.rowGo : undefined} onClick={row.onOpen} title={row.onOpen ? 'Retomar a conversa' : undefined}>
              <span className={styles.stateDot} style={{ background: 'var(--state-done)' }} />
              <span>
                {row.name}
                <br />
                <span className={styles.caption}>{row.when}</span>
              </span>
              <span />
            </li>
          ))}
        </ul>
        {details.past.length > pastShown.length ? <div className={styles.caption}>e mais {details.past.length - pastShown.length}</div> : null}
      </div>
    </>
  );
}
