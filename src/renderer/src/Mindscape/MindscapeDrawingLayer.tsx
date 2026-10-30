import type { DrawingColor, InkDrawing, MindscapeDrawing } from '../../../shared/mindscape/model';
import { STRIPE_BY_TOKEN } from './MindscapeCard';
import { drawingShape } from './roughShapes';
import type { MindscapeImageEntry } from './useMindscapeImage';
import styles from './Mindscape.module.css';

/** Ink of a drawing: "Sem cor" follows the theme (`currentColor`), the others are the post-it tokens. */
export function drawingInk(color: DrawingColor): string {
  return color === 'none' ? 'currentColor' : STRIPE_BY_TOKEN[color];
}

function InkItem({ drawing, draft, selected }: { readonly drawing: InkDrawing; readonly draft?: boolean; readonly selected?: boolean }): React.JSX.Element | null {
  const shape = drawingShape(drawing);
  if (!shape) return null;
  return (
    <g
      transform={shape.transform}
      stroke={drawingInk(drawing.color)}
      strokeWidth={shape.strokeWidth}
      className={styles.drawing}
      data-testid={draft ? 'mindscape-drawing-draft' : 'mindscape-drawing'}
      data-drawing-id={drawing.id}
      data-kind={drawing.kind}
      data-color={drawing.color}
      data-stroke={drawing.stroke}
      data-arrow={drawing.kind === 'line' ? String(drawing.arrow) : undefined}
      data-selected={draft ? undefined : selected ? 'true' : 'false'}
    >
      <path d={shape.d} />
      {shape.head ? <path d={shape.head} /> : null}
    </g>
  );
}

/**
 * Fatia 06 — a print: an `<image>` with the `blob:` URL of its file (inside
 * the SVG, so it obeys the layer order), placed by `transform` like the other
 * drawings. A file the main cannot give → the dashed "imagem não encontrada"
 * box, which the owner can select and delete.
 */
function ImageItem({
  drawing,
  entry,
  selected,
}: {
  readonly drawing: Extract<MindscapeDrawing, { kind: 'image' }>;
  readonly entry: MindscapeImageEntry;
  readonly selected?: boolean;
}): React.JSX.Element {
  const { w, h } = drawing;
  return (
    <g
      transform={`translate(${drawing.x} ${drawing.y})`}
      data-testid="mindscape-drawing"
      data-drawing-id={drawing.id}
      data-kind="image"
      data-image-id={drawing.imageId}
      data-image-status={entry.status}
      data-selected={selected ? 'true' : 'false'}
    >
      {entry.status === 'ready' ? (
        <image href={entry.url} width={w} height={h} preserveAspectRatio="none" />
      ) : entry.status === 'missing' ? (
        <>
          <rect className={styles.imageMissing} width={w} height={h} />
          <text className={styles.imageMissingText} x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="middle">
            imagem não encontrada
          </text>
        </>
      ) : (
        <rect className={styles.imageLoading} width={w} height={h} />
      )}
    </g>
  );
}

export interface MindscapeDrawingLayerProps {
  readonly drawings: readonly MindscapeDrawing[];
  /** The drawing in progress (local preview, not saved yet). */
  readonly draft?: InkDrawing;
  /** Fatia 03 — ids of the selected drawings (`data-selected`). */
  readonly selectedIds?: readonly string[];
  /** Fatia 06 — the files of the prints, by imageId (`useMindscapeImages`). */
  readonly images?: Readonly<Record<string, MindscapeImageEntry>>;
}

const LOADING: MindscapeImageEntry = { status: 'loading' };

/**
 * Mindscape desenho, fatia 01 — the owner's drawings in an SVG under the links
 * and the cards, in array order (layer). Transparent to the pointer: the
 * selection (fatia 03) hit-tests the drawings in pure code (`hitTestDrawings`).
 */
export function MindscapeDrawingLayer({ drawings, draft, selectedIds = [], images = {} }: MindscapeDrawingLayerProps): React.JSX.Element {
  return (
    <svg className={styles.drawingLayer} data-testid="mindscape-drawings" aria-hidden="true">
      {drawings.map((drawing) =>
        drawing.kind === 'image' ? (
          <ImageItem key={drawing.id} drawing={drawing} entry={images[drawing.imageId] ?? LOADING} selected={selectedIds.includes(drawing.id)} />
        ) : (
          <InkItem key={drawing.id} drawing={drawing} selected={selectedIds.includes(drawing.id)} />
        ),
      )}
      {draft ? <InkItem drawing={draft} draft /> : null}
    </svg>
  );
}
