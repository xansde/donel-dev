import { SESSION_STATE_LABEL_PT, type SessionState } from '@donel-dev/design-system';
import type { CSSProperties } from 'react';
import type { SessionHighlight } from '../../../shared/mindscape/highlight';
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

const STRIPE_BY_TOKEN: Record<TabColorToken, string> = {
  none: 'var(--border)',
  accent: 'var(--accent)',
  'donel-accent': 'var(--donel-accent)',
  permission: 'var(--state-permission)',
};

export interface MindscapeSessionCardProps {
  readonly sessionId: string;
  readonly name: string;
  readonly state: SessionState;
  readonly color: TabColorToken;
  /** `/color` of the CLI wins over the token, as in the tab. */
  readonly cliColorHex?: string | null;
  readonly x: number;
  readonly y: number;
  /** News since the owner's last visit (fatia 02): highlighted, normal while working, dimmed. */
  readonly highlight: SessionHighlight;
  readonly selected: boolean;
  readonly onSelect: () => void;
  /** Double click (or Enter) — go to the terminal of the session in the Uso geral. */
  readonly onOpen: () => void;
}

/** Mindscape V1 — the post-it of a live session: "SESSÃO" seal, state glyph, mono name, tab color stripe. */
export function MindscapeSessionCard({
  sessionId,
  name,
  state,
  color,
  cliColorHex,
  x,
  y,
  highlight,
  selected,
  onSelect,
  onOpen,
}: MindscapeSessionCardProps): React.JSX.Element {
  const style = {
    left: x,
    top: y,
    '--stripe': cliColorHex ?? STRIPE_BY_TOKEN[color],
  } as CSSProperties;
  return (
    <article
      className={[styles.sessionCard, styles[`st-${state}`], styles[highlight], selected ? styles.selected : ''].filter(Boolean).join(' ')}
      style={style}
      tabIndex={0}
      data-testid="mindscape-session-card"
      data-session-id={sessionId}
      data-state={state}
      data-highlight={highlight}
      data-selected={selected ? 'true' : 'false'}
      aria-label={`Sessão ${name}: ${SESSION_STATE_LABEL_PT[state]}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
    >
      <span className={styles.seal}>Sessão</span>
      <div className={styles.sessionHead}>
        <span className={styles.glyph} aria-hidden="true">
          {STATE_GLYPH[state]}
        </span>
        <span className={styles.sessionName} title={name} data-testid="mindscape-session-name">
          {name}
        </span>
      </div>
      <div className={styles.sessionState} data-testid="mindscape-session-state">
        {SESSION_STATE_LABEL_PT[state]}
      </div>
    </article>
  );
}
