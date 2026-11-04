import { useEffect, useRef, type CSSProperties } from 'react';
import { roleColorVar, type SessionRole } from '../../../shared/roles';
import styles from './Mindscape.module.css';

export interface RoleMenuProps {
  readonly roles: readonly SessionRole[];
  /** The role picked; `undefined` = "Sem papel". */
  readonly onPick: (roleId: string | undefined) => void;
  readonly onClose: () => void;
  /** Role already chosen (marked). */
  readonly current?: string;
  /** Item 12b — "Papéis…": the screen to create and edit roles. */
  readonly onManage?: () => void;
  readonly label: string;
}

/**
 * Item 12a — the list of roles (seal in its color + name) under a button: "＋ Sessão com papel…"
 * on the board, and the seal of a place that has not started. Click outside or Esc closes it.
 */
export function RoleMenu({ roles, onPick, onClose, current, onManage, label }: RoleMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className={styles.roleMenu}
      role="menu"
      aria-label={label}
      data-testid="mindscape-role-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {roles.map((role) => (
        <button
          key={role.id}
          type="button"
          role="menuitemradio"
          aria-checked={role.id === current}
          className={styles.roleMenuItem}
          onClick={() => onPick(role.id)}
        >
          <span className={styles.roleDot} style={{ '--role': roleColorVar(role.color) } as CSSProperties} aria-hidden="true" />
          {role.name}
        </button>
      ))}
      <button type="button" role="menuitemradio" aria-checked={current === undefined} className={styles.roleMenuItem} onClick={() => onPick(undefined)}>
        <span className={`${styles.roleDot} ${styles.roleDotEmpty}`} aria-hidden="true" />
        Sem papel
      </button>
      {onManage ? (
        <button type="button" role="menuitem" className={`${styles.roleMenuItem} ${styles.roleMenuManage}`} onClick={onManage}>
          Papéis…
        </button>
      ) : null}
    </div>
  );
}
