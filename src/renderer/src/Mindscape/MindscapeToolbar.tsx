import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import type { SessionRole } from '../../../shared/roles';
import { RoleMenu } from './RoleMenu';
import { DRAWING_STROKES, OWNER_COLORS, type BoardReach, type DrawingColor, type DrawingStroke, type MindscapeLink } from '../../../shared/mindscape/model';
import { TOOL_KEYS, type MindscapeTool } from '../../../shared/mindscape/shortcuts';
import { drawingInk } from './MindscapeDrawingLayer';
import styles from './Mindscape.module.css';

const TOOL_ORDER: readonly MindscapeTool[] = ['select', 'hand', 'arrow', 'line', 'rect', 'ellipse', 'pencil', 'eraser'];

export const TOOL_LABEL: Readonly<Record<MindscapeTool, string>> = {
  select: 'Seleção',
  hand: 'Mão',
  arrow: 'Seta',
  line: 'Linha',
  rect: 'Retângulo',
  ellipse: 'Elipse',
  pencil: 'Lápis',
  eraser: 'Borracha',
};

/** Same words as the owner's post-it palette. */
const COLOR_LABEL: Readonly<Record<DrawingColor, string>> = { none: 'Sem cor', accent: 'Azul', 'donel-accent': 'Dourado' };
const STROKE_LABEL: Readonly<Record<DrawingStroke, string>> = { thin: 'Fino', medium: 'Médio', thick: 'Grosso' };
/** Height of the stroke sample in the button (px). */
const STROKE_SAMPLE: Readonly<Record<DrawingStroke, number>> = { thin: 1, medium: 2, thick: 4 };

export interface DrawStyle {
  readonly color: DrawingColor;
  readonly stroke: DrawingStroke;
}

export interface MindscapeToolbarProps {
  readonly enabled: boolean;
  readonly tool: MindscapeTool;
  readonly onTool: (tool: MindscapeTool) => void;
  readonly style: DrawStyle;
  /** A color of the bar: style of the next drawing and of the selected drawings (fatia 03). */
  readonly onColor: (color: DrawingColor) => void;
  /** A stroke of the bar: style of the next drawing and of the selected drawings (fatia 03). */
  readonly onStroke: (stroke: DrawingStroke) => void;
  /** Fatia 03 — at least one drawing selected: "Trazer para frente" / "Mandar para trás". */
  readonly canRestack: boolean;
  readonly onBringToFront: () => void;
  readonly onSendToBack: () => void;
  readonly selectedLink?: MindscapeLink;
  readonly onToggleLinkArrow: () => void;
  readonly onRemoveLink: () => void;
  readonly onNewCard: () => void;
  /** Item 12a — the roles for "＋ Sessão com papel…". */
  readonly roles: readonly SessionRole[];
  /** Item 12a — a place that has not started yet, with the role picked (`undefined` = no role). */
  readonly onNewPlace: (roleId: string | undefined) => void;
  /** Item 12b — "Papéis…" opens the screen to create and edit roles. */
  readonly onManageRoles?: () => void;
  readonly canGoToTerminal: boolean;
  readonly onGoToTerminal: () => void;
  /** Lugar principal, rule 7 — lays the sessions out in columns (one undoable gesture). */
  readonly canOrganize: boolean;
  readonly onOrganize: () => void;
  /** Rule 3 — sessions closed for more than 7 days, folded away; 0 hides the button. */
  readonly oldCount: number;
  readonly showOld: boolean;
  readonly onToggleOld: () => void;
  /** `sessao_fechar` (owner 04/11) — the Líder of this board reaches only it, or every board. */
  readonly reach: BoardReach;
  readonly onToggleReach: () => void;
  /** Item 20 — the counter of the routines in shadow, before the hint. */
  readonly shadow?: ReactNode;
  readonly hint: string;
}

/**
 * Mindscape desenho, fatia 01 — the bar of the board: tools with their key
 * (the active one pressed), color and stroke of the next drawing (and, from
 * fatia 03, of the selected drawings), the layer of the selected drawings, the
 * actions of the selected link, "Novo post-it", "Ir ao terminal" and the hint strip.
 * No prototype for this delivery: the form follows the V1 bar.
 */
export function MindscapeToolbar({
  enabled,
  tool,
  onTool,
  style,
  onColor,
  onStroke,
  canRestack,
  onBringToFront,
  onSendToBack,
  selectedLink,
  onToggleLinkArrow,
  onRemoveLink,
  onNewCard,
  roles,
  onNewPlace,
  onManageRoles,
  canGoToTerminal,
  onGoToTerminal,
  canOrganize,
  onOrganize,
  oldCount,
  showOld,
  onToggleOld,
  reach,
  onToggleReach,
  shadow,
  hint,
}: MindscapeToolbarProps): React.JSX.Element {
  const [placeMenuOpen, setPlaceMenuOpen] = useState(false);
  const closePlaceMenu = useCallback(() => setPlaceMenuOpen(false), []);
  return (
    <div className={styles.tools} role="toolbar" aria-label="Quadro">
      <div className={styles.toolGroup} role="group" aria-label="Ferramentas">
        {TOOL_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.toolButton}
            disabled={!enabled}
            aria-pressed={option === tool}
            title={`${TOOL_LABEL[option]} (${TOOL_KEYS[option].toUpperCase()})`}
            data-tool={option}
            onClick={() => onTool(option)}
          >
            {TOOL_LABEL[option]} <kbd className={styles.toolKey}>{TOOL_KEYS[option].toUpperCase()}</kbd>
          </button>
        ))}
      </div>
      <div className={styles.toolGroup} role="group" aria-label="Cor do desenho">
        {OWNER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.drawSwatch}
            style={{ '--swatch': color === 'none' ? 'var(--text-primary)' : drawingInk(color) } as CSSProperties}
            disabled={!enabled}
            aria-pressed={color === style.color}
            aria-label={COLOR_LABEL[color]}
            title={COLOR_LABEL[color]}
            onClick={() => onColor(color)}
          />
        ))}
      </div>
      <div className={styles.toolGroup} role="group" aria-label="Espessura do desenho">
        {DRAWING_STROKES.map((stroke) => (
          <button
            key={stroke}
            type="button"
            className={styles.strokeButton}
            disabled={!enabled}
            aria-pressed={stroke === style.stroke}
            aria-label={STROKE_LABEL[stroke]}
            title={STROKE_LABEL[stroke]}
            onClick={() => onStroke(stroke)}
          >
            <span className={styles.strokeSample} style={{ height: STROKE_SAMPLE[stroke] }} />
          </button>
        ))}
      </div>
      {canRestack ? (
        <div className={styles.toolGroup} role="group" aria-label="Camada">
          <button type="button" className={styles.toolButton} title="Trazer para frente (Ctrl+Shift+])" onClick={onBringToFront}>
            Trazer para frente
          </button>
          <button type="button" className={styles.toolButton} title="Mandar para trás (Ctrl+Shift+[)" onClick={onSendToBack}>
            Mandar para trás
          </button>
        </div>
      ) : null}
      {selectedLink ? (
        <div className={styles.toolGroup} role="group" aria-label="Ligação selecionada">
          <button type="button" className={styles.toolButton} aria-pressed={selectedLink.arrow} onClick={onToggleLinkArrow}>
            Seta
          </button>
          <button type="button" className={styles.toolButton} onClick={onRemoveLink}>
            Remover ligação
          </button>
        </div>
      ) : null}
      <button type="button" className={styles.toolButton} disabled={!enabled} onClick={onNewCard}>
        Novo post-it
      </button>
      <span className={styles.roleMenuAnchor}>
        <button
          type="button"
          className={styles.toolButton}
          disabled={!enabled}
          aria-haspopup="menu"
          aria-expanded={placeMenuOpen}
          title="Um lugar com papel, que ainda não começou: duplo clique nele abre a sessão"
          onClick={() => setPlaceMenuOpen((open) => !open)}
          data-testid="mindscape-new-place"
        >
          ＋ Sessão com papel…
        </button>
        {placeMenuOpen ? (
          <RoleMenu
            label="Papel do lugar novo"
            roles={roles}
            onClose={closePlaceMenu}
            onPick={(roleId) => {
              setPlaceMenuOpen(false);
              onNewPlace(roleId);
            }}
            onManage={
              onManageRoles
                ? () => {
                    setPlaceMenuOpen(false);
                    onManageRoles();
                  }
                : undefined
            }
          />
        ) : null}
      </span>
      <button type="button" className={styles.toolButton} disabled={!canGoToTerminal} onClick={onGoToTerminal}>
        Ir ao terminal
      </button>
      <button
        type="button"
        className={styles.toolButton}
        disabled={!enabled || !canOrganize}
        title="Arruma as sessões em colunas: parada com pendência, terminou e você não viu, trabalhando, em espera e fechadas. Favoritas ficam onde estão (Ctrl+Z desfaz)"
        onClick={onOrganize}
        data-testid="mindscape-organize"
      >
        Organizar
      </button>
      {oldCount > 0 ? (
        <button
          type="button"
          className={styles.toolButton}
          aria-pressed={showOld}
          title="Sessões fechadas há mais de 7 dias"
          onClick={onToggleOld}
          data-testid="mindscape-old-toggle"
        >
          {showOld ? `Recolher antigas (${oldCount})` : `${oldCount} ${oldCount === 1 ? 'antiga' : 'antigas'}`}
        </button>
      ) : null}
      <button
        type="button"
        className={styles.toolButton}
        disabled={!enabled}
        aria-pressed={reach === 'all'}
        title="Até onde o Líder deste quadro manda: só nas sessões deste quadro, ou nas de todos os quadros (por exemplo, para fechar as que ele abriu). Dentro do quadro vale sempre a hierarquia das setas."
        onClick={onToggleReach}
        data-testid="mindscape-reach"
      >
        {reach === 'all' ? 'Alcance: todos os quadros' : 'Alcance: este quadro'}
      </button>
      {shadow}
      <span className={styles.toolHint} data-testid="mindscape-hint">
        {hint}
      </span>
    </div>
  );
}
