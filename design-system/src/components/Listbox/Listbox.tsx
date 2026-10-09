import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import styles from './Listbox.module.css';

export interface ListboxItem {
  /** Stable key of the row (not necessarily a valid DOM id: the DOM id is index-based). */
  id: string;
  /** Main text of the row (mono, e.g. the command name or the path). */
  primary: ReactNode;
  /** Muted line next to the main text (a description). Rows with it use the taller density. */
  secondary?: ReactNode;
  /** Small tag on the right edge (origin of the entry). */
  badge?: ReactNode;
  /** Icon before the main text. */
  leading?: ReactNode;
}

export interface ListboxProps {
  /** Accessible name of the list. */
  label: string;
  /** Left side of the header ("Skills e comandos"). */
  title: string;
  /** Right side of the header, mono ("5 de 31 · /co"). */
  meta?: string;
  items: readonly ListboxItem[];
  /** Highlighted row (`null` = none). */
  activeId: string | null;
  onActiveChange?: (id: string) => void;
  onSelect: (id: string) => void;
  /** Key hints in the footer, e.g. `<span>Tab escolhe</span>`. */
  footer?: ReactNode;
  /** Width (px) reserved for the main text so the secondary texts line up. */
  primaryWidth?: number;
  /** DOM id prefix; rows are `${id}-opt-${index}` (see `listboxOptionId`). */
  id: string;
  className?: string;
}

/** DOM id of the row at `index`: what a text field points `aria-activedescendant` at. */
export function listboxOptionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}

/**
 * Filterable pick list with a header and a footer of key hints (014-chat, extension 8: the `/` and `@` menus
 * of the composer). It never takes the focus: the field that owns it keeps typing, and the owner drives
 * `activeId` from the arrow keys. A mouse press picks without blurring the field.
 */
export function Listbox({
  label,
  title,
  meta,
  items,
  activeId,
  onActiveChange,
  onSelect,
  footer,
  primaryWidth,
  id,
  className,
}: ListboxProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || activeId === null) return;
    const index = items.findIndex((item) => item.id === activeId);
    if (index < 0) return;
    body.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId, items]);

  const keepFocus = (event: MouseEvent) => event.preventDefault();

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} onMouseDown={keepFocus}>
      <div className={styles.header}>
        <span>{title}</span>
        <span className={styles.spacer} />
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>
      <div ref={bodyRef} role="listbox" id={id} aria-label={label} className={styles.body}>
        {items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            id={listboxOptionId(id, index)}
            data-index={index}
            aria-selected={item.id === activeId}
            className={[styles.option, item.secondary ? styles.tall : styles.compact, item.id === activeId ? styles.active : '']
              .filter(Boolean)
              .join(' ')}
            // Mouse MOVE, not enter: a menu that opens under a still pointer must not steal the highlight.
            onMouseMove={() => (item.id === activeId ? undefined : onActiveChange?.(item.id))}
            onClick={() => onSelect(item.id)}
          >
            {item.leading ? <span className={styles.leading}>{item.leading}</span> : null}
            <span
              className={[styles.primary, item.secondary ? styles.primaryFixed : ''].filter(Boolean).join(' ')}
              style={item.secondary && primaryWidth ? { width: primaryWidth } : undefined}
            >
              {item.primary}
            </span>
            {item.secondary ? <span className={styles.secondary}>{item.secondary}</span> : null}
            {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
          </div>
        ))}
      </div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}
