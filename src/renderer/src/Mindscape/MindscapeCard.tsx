import { SESSION_STATE_LABEL_PT, type SessionState } from '@donel-dev/design-system';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { backgroundCountLabel } from '../../../shared/chat/backgroundTasks';
import type { SessionHighlight } from '../../../shared/mindscape/highlight';
import { OWNER_COLORS, type OwnerCardColor } from '../../../shared/mindscape/model';
import type { TabColorToken } from '../../../shared/tabAppearance';
import styles from './Mindscape.module.css';

/** Same glyphs as `TerminalTab` (`SESSION_STATE_ICON`, not exported by the design system). */
const STATE_GLYPH: Record<SessionState, string> = {
  working: '▶',
  waiting: '◐',
  permission: '!',
  done: '■',
  error: '✕',
};

export const STRIPE_BY_TOKEN: Record<TabColorToken, string> = {
  none: 'var(--border)',
  accent: 'var(--accent)',
  'donel-accent': 'var(--donel-accent)',
  permission: 'var(--state-permission)',
};

/** The seal of the role of the place (item 12a): its name in its color. */
export interface PlaceRoleSeal {
  readonly name: string;
  /** A CSS color (`roleColorVar`). */
  readonly color: string;
}

export interface MindscapeSessionCardProps {
  /** The place (`data-card-id`). */
  readonly cardId: string;
  /** Its conversation of the moment; absent while the place has not started. */
  readonly sessionId?: string;
  readonly name: string;
  readonly state: SessionState;
  readonly color: TabColorToken;
  /** `/color` of the CLI wins over the token, as in the tab. */
  readonly cliColorHex?: string | null;
  readonly x: number;
  readonly y: number;
  /** News since the owner's last visit (fatia 02): highlighted, normal while working, dimmed. */
  readonly highlight: SessionHighlight;
  /** In the board selection (desenho, fatia 03: the board selects on pressing, with V). */
  readonly selected: boolean;
  /** Double click (or Enter) — go to the terminal of the session in the Uso geral (a dormant one is resumed). */
  readonly onOpen: () => void;
  /**
   * Lugar principal, rule 4 — the tab of the session is closed: the card is dormant and this is
   * its state line ("Fechada · 31/10 13:06"). `state` and `highlight` are ignored then.
   */
  readonly closedLabel?: string;
  /** Rule 6 — favorite of the owner (pinned in the 007 registry): ★ and never moved by "Organizar". */
  readonly favorite?: boolean;
  /** Segundo plano visível — how many tasks the session has running in the background (0 = none). */
  readonly background?: number;
  /** Item 12a — the role of the place, as a seal at the top right. */
  readonly role?: PlaceRoleSeal;
  /** Item 12a — the place has no conversation yet: a double click opens the session with its role. */
  readonly notStarted?: boolean;
  /** Item 12b — click on the seal of a place that has not started: choose another role. */
  readonly onRoleClick?: () => void;
}

/** Glyph of a dormant session (tab closed). */
const DORMANT_GLYPH = '☾';
/** Glyph of a place that has not started yet. */
const NOT_STARTED_GLYPH = '○';
const NOT_STARTED_LABEL = 'Ainda não começou';

/** Mindscape V1 — the post-it of a live session: "SESSÃO" seal, state glyph, mono name, tab color stripe. */
export function MindscapeSessionCard({
  cardId,
  sessionId,
  name,
  state,
  color,
  cliColorHex,
  x,
  y,
  highlight,
  selected,
  onOpen,
  closedLabel: closedLabelText,
  favorite = false,
  background = 0,
  role,
  notStarted = false,
  onRoleClick,
}: MindscapeSessionCardProps): React.JSX.Element {
  // A place that has not started reads like a dormant one, with its own glyph and words.
  const closedLabel = notStarted ? `${NOT_STARTED_LABEL} · duplo clique abre` : closedLabelText;
  const dormant = closedLabel !== undefined;
  const style = {
    left: x,
    top: y,
    '--stripe': cliColorHex ?? STRIPE_BY_TOKEN[color],
    ...(role ? { '--role': role.color } : {}),
  } as CSSProperties;
  const stateText = dormant ? closedLabel : SESSION_STATE_LABEL_PT[state];
  return (
    <article
      className={[
        styles.sessionCard,
        dormant ? styles.dormant : styles[`st-${state}`],
        notStarted ? styles.notStarted : '',
        dormant ? '' : styles[highlight],
        selected ? styles.selected : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      tabIndex={0}
      data-testid="mindscape-session-card"
      data-card-id={cardId}
      data-session-id={sessionId}
      data-state={notStarted ? 'not-started' : dormant ? 'closed' : state}
      data-highlight={dormant ? 'dimmed' : highlight}
      data-favorite={favorite ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      aria-label={`Sessão ${name}${role ? `, papel ${role.name}` : ''}${favorite ? ' (favorita)' : ''}: ${stateText}`}
      title={notStarted ? 'Duplo clique abre a sessão com o papel' : dormant ? 'Duplo clique retoma a sessão' : undefined}
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest('button')) onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) onOpen();
      }}
    >
      <span className={styles.seal}>Sessão</span>
      {role ? (
        onRoleClick ? (
          <button
            type="button"
            className={`${styles.roleSeal} ${styles.roleSealButton}`}
            title="Trocar o papel (só antes de começar)"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRoleClick}
            data-testid="mindscape-role-seal"
          >
            {role.name}
          </button>
        ) : (
          <span className={styles.roleSeal} data-testid="mindscape-role-seal">
            {role.name}
          </span>
        )
      ) : notStarted && onRoleClick ? (
        <button
          type="button"
          className={`${styles.roleSeal} ${styles.roleSealButton} ${styles.roleSealEmpty}`}
          title="Escolher um papel (só antes de começar)"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onRoleClick}
          data-testid="mindscape-role-seal"
        >
          ＋ papel
        </button>
      ) : null}
      <div className={styles.sessionHead}>
        <span className={styles.glyph} aria-hidden="true">
          {notStarted ? NOT_STARTED_GLYPH : dormant ? DORMANT_GLYPH : STATE_GLYPH[state]}
        </span>
        <span className={styles.sessionName} title={name} data-testid="mindscape-session-name">
          {name}
        </span>
        {favorite ? (
          <span className={styles.favorite} aria-hidden="true" data-testid="mindscape-session-favorite">
            ★
          </span>
        ) : null}
      </div>
      <div className={styles.sessionState} data-testid="mindscape-session-state">
        {dormant ? closedLabel : SESSION_STATE_LABEL_PT[state]}
        {!dormant && background > 0 ? ` · ⟳ ${backgroundCountLabel(background)}` : ''}
      </div>
    </article>
  );
}

export interface MindscapeNoteCardProps {
  readonly sessionId: string;
  readonly sessionName: string;
  readonly text: string;
  readonly writtenAt: number;
  /** Color of the live session tab; `undefined` once the tab is closed (neutral stripe). */
  readonly stripe?: string;
  readonly x: number;
  readonly y: number;
  readonly onArchive: () => void;
}

function formatHour(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Mindscape, fatia 03 — the post-it written by the session: last answer of the turn and the hour. Stays after the tab closes, until archived. */
export function MindscapeNoteCard({ sessionId, sessionName, text, writtenAt, stripe, x, y, onArchive }: MindscapeNoteCardProps): React.JSX.Element {
  const style = { left: x, top: y, '--stripe': stripe ?? 'var(--border)' } as CSSProperties;
  return (
    <article className={styles.noteCard} style={style} data-testid="mindscape-note-card" data-card-id={`note:${sessionId}`} data-session-id={sessionId} aria-label={`Post-it escrito pela sessão ${sessionName}`}>
      <span className={styles.noteAuthor} title={sessionName}>
        {sessionName}
      </span>
      <p className={styles.noteText} title={text} data-testid="mindscape-note-text">
        {text}
      </p>
      <div className={styles.noteMeta}>
        <span>escrito pela sessão</span>
        <span data-testid="mindscape-note-time">{formatHour(writtenAt)}</span>
      </div>
      <button type="button" className={styles.noteArchive} onClick={onArchive}>
        Arquivar
      </button>
    </article>
  );
}

/** Labels of the owner palette (same words as `TAB_COLOR_LABEL_PT` in the tab). */
const OWNER_COLOR_LABEL: Record<OwnerCardColor, string> = { none: 'Sem cor', accent: 'Azul', 'donel-accent': 'Dourado' };

export interface MindscapeOwnerCardProps {
  readonly id: string;
  readonly text: string;
  readonly color: OwnerCardColor;
  readonly createdAt: number;
  readonly x: number;
  readonly y: number;
  /** A card just created opens already in edit mode, with the focus in the text. */
  readonly startEditing: boolean;
  readonly onEdit: (text: string) => void;
  readonly onColor: (color: OwnerCardColor) => void;
  readonly onArchive: () => void;
}

/**
 * Mindscape, fatia 04 — the owner's post-it: "✎ você", folded corner, inline
 * text (double click edits; leaving the field saves), Sem cor/Azul/Dourado and
 * "Arquivar".
 */
export function MindscapeOwnerCard({ id, text, color, createdAt, x, y, startEditing, onEdit, onColor, onArchive }: MindscapeOwnerCardProps): React.JSX.Element {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(text);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) fieldRef.current?.focus();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    onEdit(draft);
  };

  const style = { left: x, top: y, '--stripe': STRIPE_BY_TOKEN[color] } as CSSProperties;
  return (
    <article
      className={`${styles.noteCard} ${styles.ownerCard}`}
      style={style}
      data-testid="mindscape-owner-card"
      data-card-id={id}
      data-color={color}
      aria-label="Post-it seu"
      onDoubleClick={(event) => {
        if (!editing && !(event.target as HTMLElement).closest('button')) {
          setDraft(text);
          setEditing(true);
        }
      }}
    >
      {editing ? (
        <textarea
          ref={fieldRef}
          className={styles.ownerField}
          value={draft}
          aria-label="Texto do post-it"
          placeholder="Escreva aqui"
          rows={4}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <p className={styles.noteText} title={text} data-testid="mindscape-owner-text">
          {text || <span className={styles.ownerPlaceholder}>Duplo clique para escrever</span>}
        </p>
      )}
      <div className={styles.noteMeta}>
        <span className={styles.you}>✎ você</span>
        <span>{formatHour(createdAt)}</span>
      </div>
      {/* The buttons do not take the focus from the text field: a blur there
          would swap the field for the text and shift the layout between
          mousedown and mouseup, losing the click. */}
      <div className={styles.ownerActions} onMouseDown={(event) => event.preventDefault()}>
        <div className={styles.ownerColors} role="group" aria-label="Cor do post-it">
          {OWNER_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              className={styles.ownerSwatch}
              style={{ '--swatch': STRIPE_BY_TOKEN[option] } as CSSProperties}
              aria-pressed={option === color}
              aria-label={OWNER_COLOR_LABEL[option]}
              title={OWNER_COLOR_LABEL[option]}
              onClick={() => onColor(option)}
            />
          ))}
        </div>
        <button type="button" className={styles.noteArchive} onClick={onArchive}>
          Arquivar
        </button>
      </div>
    </article>
  );
}
