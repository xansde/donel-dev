import { Bot, Check } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { Button } from '../Button';
import styles from './PendingPanel.module.css';

export interface PendingOrigin {
  /** Description of the subagent that asked ("Mapear usos de arredondamento"). */
  name: string;
  /** Opens the subagent side panel; without it the name is plain text. */
  onOpen?: () => void;
}

export interface PendingFrameProps {
  ariaLabel: string;
  icon: ReactNode;
  /** "O Claude pergunta", "O Claude quer rodar", "Plano proposto". */
  title: ReactNode;
  /** Right after the title: a subtitle or the mono chip of the object. */
  headerExtra?: ReactNode;
  /** Right side of the header, before the counter (e.g. the collapse button). */
  aside?: ReactNode;
  /** "mais N esperando"; `null` hides it. */
  waiting?: string | null;
  /** Source strip for a subagent request. */
  origin?: PendingOrigin;
  /** Scrolling middle. */
  children?: ReactNode;
  /** Fixed bottom strip (buttons). */
  footer?: ReactNode;
  /** Replaces the scrolling middle (the plan collapsed to its title). */
  bodyOverride?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * Frame of the pending panel (014-chat T078, handoff T03/T04/T05): coral border at 40%, 36 px header with
 * icon, title and the "mais N esperando" counter, scrolling middle, fixed footer, max height 62% of the area.
 */
export function PendingFrame({
  ariaLabel,
  icon,
  title,
  headerExtra,
  aside,
  waiting,
  origin,
  children,
  footer,
  bodyOverride,
  className,
  'data-testid': testId,
}: PendingFrameProps) {
  return (
    <section aria-label={ariaLabel} className={[styles.frame, className].filter(Boolean).join(' ')} data-testid={testId}>
      {origin ? (
        <div className={styles.origin} data-testid="pending-origin">
          <Bot className={styles.originIcon} size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>pedido do subagente</span>
          {origin.onOpen ? (
            <Button variant="link" onClick={origin.onOpen}>
              {origin.name}
            </Button>
          ) : (
            <strong>{origin.name}</strong>
          )}
        </div>
      ) : null}
      <div className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.title}>{title}</span>
        {headerExtra}
        <span className={styles.spacer} />
        {aside}
        {waiting ? (
          <span className={styles.counter} data-testid="pending-waiting-count">
            {waiting}
          </span>
        ) : null}
      </div>
      {bodyOverride ?? <div className={styles.body}>{children}</div>}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );
}

/** Small muted text for the footer or the header (`aside` slot). */
export function PendingNote({ children }: { children: ReactNode }) {
  return <span className={styles.footerNote}>{children}</span>;
}

/** Pushes the following footer items to the right. */
export function PendingSpacer() {
  return <span className={styles.spacer} />;
}

/* ---------------------------------------------------------------- question */

export interface ChoiceCardProps {
  /** `radio` = single choice (round mark); `checkbox` = multiple (square mark). */
  kind: 'radio' | 'checkbox';
  checked: boolean;
  /** Label WITHOUT the "(Recomendado)" suffix. */
  label: string;
  description?: string;
  /** Draws the "(Recomendado)" suffix in green; the caller still sends the original label. */
  recommended?: boolean;
  /** 38 px single-line card of the multiple-choice grid. */
  compact?: boolean;
  /** Roving tabindex for radiogroups. */
  tabIndex?: number;
  onSelect: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  'data-testid'?: string;
}

function Mark({ kind, checked }: { kind: 'radio' | 'checkbox'; checked: boolean }) {
  return (
    <span className={[styles.mark, kind === 'radio' ? styles.round : styles.square].join(' ')} aria-hidden="true">
      {kind === 'radio' ? (
        checked ? (
          <span className={styles.dot} />
        ) : null
      ) : checked ? (
        <Check className={styles.check} strokeWidth={3.5} />
      ) : null}
    </span>
  );
}

/** One option of a pending question (T03): label, description and a radio/checkbox mark. */
export const ChoiceCard = forwardRef<HTMLButtonElement, ChoiceCardProps>(function ChoiceCard(
  { kind, checked, label, description, recommended, compact, tabIndex, onSelect, onKeyDown, 'data-testid': testId },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role={kind}
      aria-checked={checked}
      tabIndex={tabIndex}
      className={[styles.choice, compact ? styles.compact : '', checked ? styles.on : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      <Mark kind={kind} checked={checked} />
      <span className={styles.choiceText}>
        <span className={styles.choiceLabel}>
          {label}
          {recommended ? <span className={styles.recommended}> (Recomendado)</span> : null}
        </span>
        {description ? <span className={styles.choiceDesc}>{description}</span> : null}
      </span>
    </button>
  );
});

export interface OtherChoiceProps {
  kind: 'radio' | 'checkbox';
  /** The free text is non-blank, so "Outra" is the answer. */
  active: boolean;
  /** The `TextInput`. */
  children: ReactNode;
  className?: string;
}

/** "Outra": always last, with the input embedded. */
export function OtherChoice({ kind, active, children, className }: OtherChoiceProps) {
  return (
    <div className={[styles.otherBox, active ? styles.on : '', className].filter(Boolean).join(' ')}>
      <Mark kind={kind} checked={active} />
      <span className={styles.otherLabel}>Outra</span>
      <div className={styles.otherInput}>{children}</div>
    </div>
  );
}

export interface QuestionBlockProps {
  number: number;
  title: string;
  /** "escolha uma" / "escolha uma ou mais". */
  hint: string;
  multiple: boolean;
  /** The option cards (already wrapped in the group element is NOT needed: the block does it). */
  options: ReactNode;
  other: ReactNode;
  /** Preview column (single choice with previews). */
  preview?: ReactNode;
  titleId: string;
  'data-testid'?: string;
}

/** One question: header (number, title, hint), options (column / 3-col grid), "Outra" last, optional preview. */
export function QuestionBlock({
  number,
  title,
  hint,
  multiple,
  options,
  other,
  preview,
  titleId,
  'data-testid': testId,
}: QuestionBlockProps) {
  return (
    <div data-testid={testId}>
      <div className={styles.qHead}>
        <span className={styles.qNumber}>{number}</span>
        <span id={titleId} className={styles.qTitle}>
          {title}
        </span>
        <span className={styles.spacer} />
        <span className={styles.qHint}>{hint}</span>
      </div>
      <div className={preview ? styles.qWithPreview : undefined}>
        <div>
          <div
            role={multiple ? 'group' : 'radiogroup'}
            aria-labelledby={titleId}
            className={multiple ? styles.grid3 : styles.stack}
          >
            {options}
          </div>
          <div className={styles.otherSpacing}>{other}</div>
        </div>
        {preview}
      </div>
    </div>
  );
}

/** Preview column of the picked option. */
export function PreviewPane({ children }: { children: ReactNode | null }) {
  return (
    <div className={styles.preview}>
      <div className={styles.previewHead}>Prévia</div>
      {children ? (
        <div className={styles.previewBody}>{children}</div>
      ) : (
        <div className={styles.previewEmpty}>Esta opção não tem prévia.</div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- permission */

/** Mono chip of the object of a permission request ("npm install decimal.js"). */
export function MonoChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={styles.chip} title={title}>
      {children}
    </span>
  );
}

/** Claude-written `description` of the tool call, verbatim and marked as his (D-C12). */
export function ClaudeNote({ children }: { children: ReactNode }) {
  return (
    <div className={styles.claudeNote}>
      <span className={styles.claudeNoteTag}>descrição do Claude</span>
      <span className={styles.claudeNoteText}>{children}</span>
    </div>
  );
}

/** "+12 −3" line counts of an edit. */
export function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className={styles.diffStat}>
      <span className={styles.statAdd}>+{added}</span>
      <span className={styles.statDel}>−{removed}</span>
    </span>
  );
}

/** Left indent of the permission body (aligned under the title, 26 px). */
export function PendingIndent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.indented, className].filter(Boolean).join(' ')}>{children}</div>;
}

/** Row of action buttons. */
export function PendingActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

/** "Motivo (opcional)" row: field + "Negar e enviar". */
export function DenyForm({ children }: { children: ReactNode }) {
  return <div className={styles.denyForm}>{children}</div>;
}

export function DenyField({ children }: { children: ReactNode }) {
  return <div className={styles.denyField}>{children}</div>;
}

/* -------------------------------------------------------------------- plan */

export function PlanTitle({ children }: { children: ReactNode }) {
  return <h3 className={styles.planTitle}>{children}</h3>;
}

export function PlanBody({ children }: { children: ReactNode }) {
  return <div className={styles.planBody}>{children}</div>;
}

/** The plan reduced to its title line (after "Pedir ajuste"). */
export function PlanCollapsedTitle({ children }: { children: ReactNode }) {
  return <div className={styles.planCollapsedTitle}>{children}</div>;
}

/** Icon-only 28 px button (collapse / expand). */
export function PendingIconButton({
  label,
  expanded,
  onClick,
  children,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} aria-expanded={expanded} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** Footer content stacked in rows (buttons, then the deny reason form). */
export function PendingFooterStack({ children }: { children: ReactNode }) {
  return <div className={styles.footerStack}>{children}</div>;
}
