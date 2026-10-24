import { useLayoutEffect, useState, type RefObject } from 'react';
import type { MindscapeLink } from '../../../shared/mindscape/model';
import { cardOutlinePath, linkPath, type Rect } from './roughShapes';
import styles from './Mindscape.module.css';

export type CardSizes = Readonly<Record<string, { readonly w: number; readonly h: number }>>;

function sameSizes(a: CardSizes, b: CardSizes): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => b[key] && b[key]!.w === a[key]!.w && b[key]!.h === a[key]!.h);
}

/**
 * Mindscape, fatia 05 — the rendered size of each card (`data-card-id`) inside
 * `container`, read after every render. The state only changes when a size
 * does, so a drag (position only) costs no extra render.
 */
export function useCardSizes(container: RefObject<HTMLElement>): CardSizes {
  const [sizes, setSizes] = useState<CardSizes>({});
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const next: Record<string, { w: number; h: number }> = {};
    root.querySelectorAll<HTMLElement>('[data-card-id]').forEach((element) => {
      const id = element.dataset.cardId;
      if (id) next[id] = { w: element.offsetWidth, h: element.offsetHeight };
    });
    setSizes((previous) => (sameSizes(previous, next) ? previous : next));
  });
  return sizes;
}

export interface MindscapeLinkLayerProps {
  readonly links: readonly MindscapeLink[];
  /** Live rect of a card in the plane; `undefined` while it is not measured (the link waits). */
  readonly rectOf: (cardId: string) => Rect | undefined;
  readonly selectedLinkId?: string;
  readonly onSelect: (linkId: string) => void;
}

/** The links, under the cards: hand-made line, arrow head at the destination, a wide invisible stroke to click. */
export function MindscapeLinkLayer({ links, rectOf, selectedLinkId, onSelect }: MindscapeLinkLayerProps): React.JSX.Element {
  return (
    <svg className={styles.linkLayer} data-testid="mindscape-links">
      {links.map((link) => {
        const from = rectOf(link.from);
        const to = rectOf(link.to);
        const shape = from && to ? linkPath(link.id, from, to, link.arrow) : null;
        if (!shape) return null;
        const selected = link.id === selectedLinkId;
        return (
          <g
            key={link.id}
            className={selected ? `${styles.link} ${styles.linkSelected}` : styles.link}
            data-testid="mindscape-link"
            data-link-id={link.id}
            data-from={link.from}
            data-to={link.to}
            data-arrow={link.arrow ? 'true' : 'false'}
            data-selected={selected ? 'true' : 'false'}
          >
            <path
              className={styles.linkHit}
              d={shape.line}
              data-no-drag
              data-testid="mindscape-link-hit"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(link.id);
              }}
            />
            <path className={styles.linkStroke} d={shape.line} data-testid="mindscape-link-line" />
            {shape.head ? <path className={styles.linkStroke} d={shape.head} data-testid="mindscape-link-head" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export interface MindscapeOutlineLayerProps {
  readonly cardIds: readonly string[];
  readonly rectOf: (cardId: string) => Rect | undefined;
}

/** The hand-made outline of the cards, over them and transparent to the pointer. */
export function MindscapeOutlineLayer({ cardIds, rectOf }: MindscapeOutlineLayerProps): React.JSX.Element {
  return (
    <svg className={styles.outlineLayer} aria-hidden="true">
      {cardIds.map((id) => {
        const rect = rectOf(id);
        if (!rect || rect.w < 4 || rect.h < 4) return null;
        return <path key={id} className={styles.outline} transform={`translate(${rect.x} ${rect.y})`} d={cardOutlinePath(id, rect.w, rect.h)} />;
      })}
    </svg>
  );
}
