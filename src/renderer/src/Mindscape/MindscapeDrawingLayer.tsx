import type { DrawingColor, MindscapeDrawing } from '../../../shared/mindscape/model';
import { STRIPE_BY_TOKEN } from './MindscapeCard';
import { drawingShape } from './roughShapes';
import styles from './Mindscape.module.css';

/** Ink of a drawing: "Sem cor" follows the theme (`currentColor`), the others are the post-it tokens. */
export function drawingInk(color: DrawingColor): string {
  return color === 'none' ? 'currentColor' : STRIPE_BY_TOKEN[color];
}

function DrawingItem({ drawing, draft }: { readonly drawing: MindscapeDrawing; readonly draft?: boolean }): React.JSX.Element | null {
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
    >
      <path d={shape.d} />
      {shape.head ? <path d={shape.head} /> : null}
    </g>
  );
}

export interface MindscapeDrawingLayerProps {
  readonly drawings: readonly MindscapeDrawing[];
  /** The drawing in progress (local preview, not saved yet). */
  readonly draft?: MindscapeDrawing;
}

/**
 * Mindscape desenho, fatia 01 — the owner's drawings in an SVG under the links
 * and the cards, in array order (layer). Transparent to the pointer: selecting
 * a drawing comes in fatia 03.
 */
export function MindscapeDrawingLayer({ drawings, draft }: MindscapeDrawingLayerProps): React.JSX.Element {
  return (
    <svg className={styles.drawingLayer} data-testid="mindscape-drawings" aria-hidden="true">
      {drawings.map((drawing) => (
        <DrawingItem key={drawing.id} drawing={drawing} />
      ))}
      {draft ? <DrawingItem drawing={draft} draft /> : null}
    </svg>
  );
}
