import { STROKE_WIDTH } from '../../../shared/mindscape/drawings';
import { drawingBounds, type Rect, type ResizeHandle } from '../../../shared/mindscape/geometry';
import type { MindscapeDrawing } from '../../../shared/mindscape/model';
import styles from './Mindscape.module.css';

/** Gap between an item and its selection outline, in px of screen. */
const OUTLINE_GAP_PX = 4;
/** Side of a handle, in px of screen. */
const HANDLE_PX = 9;

function normalized(rect: Rect): Rect {
  return { x: rect.w < 0 ? rect.x + rect.w : rect.x, y: rect.h < 0 ? rect.y + rect.h : rect.y, w: Math.abs(rect.w), h: Math.abs(rect.h) };
}

/** Where each handle of a drawing sits (corners of a box, ends of a loose line; a pencil stroke has none). */
function handlesOf(drawing: MindscapeDrawing): { readonly handle: ResizeHandle; readonly x: number; readonly y: number }[] {
  if (drawing.kind === 'pencil') return [];
  if (drawing.kind === 'line') {
    return [
      { handle: 'start', x: drawing.x1, y: drawing.y1 },
      { handle: 'end', x: drawing.x2, y: drawing.y2 },
    ];
  }
  const { x, y, w, h } = drawing;
  return [
    { handle: 'nw', x, y },
    { handle: 'ne', x: x + w, y },
    { handle: 'sw', x, y: y + h },
    { handle: 'se', x: x + w, y: y + h },
  ];
}

export interface MindscapeSelectionLayerProps {
  /** Live rects of the selected owner post-its and post-its written by the session (the session post-it has its own outline). */
  readonly cards: readonly (Rect & { readonly id: string })[];
  /** The selected drawings, as drawn now (previews applied). */
  readonly drawings: readonly MindscapeDrawing[];
  /** Handles only with exactly one drawing selected (and nothing else). */
  readonly withHandles: boolean;
  /** The lasso being drawn, in board units. */
  readonly lasso: Rect | null;
  readonly zoom: number;
}

/**
 * Mindscape desenho, fatia 03 — the outline of the selection, the handles of
 * the single selected drawing and the lasso, in an SVG over the cards. Only
 * the handles take the pointer (the board reads `data-handle` on pressing).
 */
export function MindscapeSelectionLayer({ cards, drawings, withHandles, lasso, zoom }: MindscapeSelectionLayerProps): React.JSX.Element {
  const gap = OUTLINE_GAP_PX / zoom;
  const side = HANDLE_PX / zoom;
  return (
    <svg className={styles.selectionLayer} data-testid="mindscape-selection">
      {cards.map((card) => (
        <rect
          key={card.id}
          className={styles.selectionOutline}
          x={card.x - gap}
          y={card.y - gap}
          width={card.w + gap * 2}
          height={card.h + gap * 2}
          data-testid="mindscape-selection-outline"
          data-item-id={card.id}
        />
      ))}
      {drawings.map((drawing) => {
        const box = drawingBounds(drawing);
        const pad = gap + STROKE_WIDTH[drawing.stroke] / 2;
        return (
          <rect
            key={drawing.id}
            className={styles.selectionOutline}
            x={box.x - pad}
            y={box.y - pad}
            width={box.w + pad * 2}
            height={box.h + pad * 2}
            data-testid="mindscape-selection-outline"
            data-item-id={drawing.id}
          />
        );
      })}
      {withHandles && drawings.length === 1
        ? handlesOf(drawings[0]!).map(({ handle, x, y }) => (
            <rect
              key={handle}
              className={styles.selectionHandle}
              x={x - side / 2}
              y={y - side / 2}
              width={side}
              height={side}
              data-testid="mindscape-handle"
              data-handle={handle}
              data-drawing-id={drawings[0]!.id}
            />
          ))
        : null}
      {lasso ? (() => {
        const box = normalized(lasso);
        return <rect className={styles.lasso} x={box.x} y={box.y} width={box.w} height={box.h} data-testid="mindscape-lasso" />;
      })() : null}
    </svg>
  );
}
