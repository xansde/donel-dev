/**
 * Donel Dev — design system
 *
 * Ponto de entrada único do pacote. Importar deste módulo carrega, como
 * efeito colateral, as fontes self-hosted (Inter 400/600, JetBrains Mono
 * 400) e os design tokens (`tokens.css`) — nenhum componente funciona
 * corretamente sem esses dois imports.
 */

// Só os subsets latin/latin-ext (o produto é pt-BR) — importar os arquivos
// "all subsets" (ex. `inter/400.css`) embutiria também cyrillic, greek,
// vietnamese etc. e infla o CSS final em ~10x sem necessidade.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import './tokens.css';

export { StateDot, SESSION_STATE_LABEL_PT } from './components/StateDot';
export type { StateDotProps, SessionState } from './components/StateDot';

export { SmartZoneMeter } from './components/SmartZoneMeter';
export type { SmartZoneMeterProps } from './components/SmartZoneMeter';

export { AccountBadge, getHeadroomTier } from './components/AccountBadge';
export type { AccountBadgeProps, HeadroomTier } from './components/AccountBadge';

export { PhaseChip, ESTEIRA_PHASE_LABEL_PT, ESTEIRA_PHASES, isEsteiraPhase } from './components/PhaseChip';
export type { PhaseChipProps, EsteiraPhase } from './components/PhaseChip';

export { Button, SplitButton } from './components/Button';
export type { ButtonProps, ButtonVariant, SplitButtonProps, SplitButtonMenuItem } from './components/Button';

export { TextInput } from './components/TextInput';
export type { TextInputProps } from './components/TextInput';

export { Select } from './components/Select';
export type { SelectProps, SelectOption } from './components/Select';

export { Toggle } from './components/Toggle';
export type { ToggleProps } from './components/Toggle';

export { SegmentedControl } from './components/SegmentedControl';
export type { SegmentedControlProps, SegmentedControlOption } from './components/SegmentedControl';

export { TAB_COLOR_LABEL_PT, TAB_COLOR_TOKENS, TerminalTab } from './components/TerminalTab';
export type { TabColorToken, TerminalTabProps } from './components/TerminalTab';

export { EditableLabel } from './components/EditableLabel';
export type { EditableLabelHandle, EditableLabelProps } from './components/EditableLabel';

export { PostItCard } from './components/PostItCard';
export type { PostItCardProps } from './components/PostItCard';

export { Modal } from './components/Modal';
export type { ModalProps } from './components/Modal';

export { Toast } from './components/Toast';
export type { ToastProps } from './components/Toast';

export { StatusBar } from './components/StatusBar';
export type { StatusBarProps, StatusBarSmartZone } from './components/StatusBar';

export {
  DEFAULT_MAX_TOKENS,
  getSmartZone,
  formatTokenCount,
  formatSmartZoneLabel,
  SMART_ZONE_COLOR_VAR,
} from './lib/smartZone';
export type { SmartZone } from './lib/smartZone';

// === Batch A2 (003-modo-dev, T331-T334) — extensões aprovadas em 27/07 ===

export { PhaseStateGlyph, PHASE_STATE_LABEL_PT } from './components/PhaseStateGlyph';
export type { PhaseStateGlyphProps, PhaseState } from './components/PhaseStateGlyph';

export { AnnotationTag } from './components/AnnotationTag';
export type { AnnotationTagProps, AnnotationTone } from './components/AnnotationTag';

export { WorktreeCard } from './components/WorktreeCard';
export type {
  WorktreeCardProps,
  WorktreeCardMarcoProps,
  WorktreeCardOrquestradorProps,
  WorktreeCardPhaseNode,
  WorktreeCardAnnotation,
} from './components/WorktreeCard';

// === Lote 6 (009-modo-dev-v3) — extensões 5, 6 e 8 do handoff v3 ===

export { LevelCarousel } from './components/LevelCarousel';
export type {
  LevelCarouselProps,
  LevelCarouselLevel,
  LevelCarouselCard,
  LevelCarouselCardContext,
} from './components/LevelCarousel';

export { HomologationClock } from './components/HomologationClock';
export type { HomologationClockProps } from './components/HomologationClock';

export {
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_CARD_GAP,
  CAROUSEL_CARD_STEP,
  CAROUSEL_LEVEL_GAP,
  CAROUSEL_FOCUS_Y,
  CAROUSEL_HEIGHT_FOCUSED_TALL,
  CAROUSEL_HEIGHT_FOCUSED,
  CAROUSEL_HEIGHT_UNFOCUSED,
  CAROUSEL_OPACITY_FOCUSED,
  CAROUSEL_OPACITY_LEVEL_FOCUSED,
  CAROUSEL_OPACITY_UNFOCUSED,
  levelHeight,
  computeLevelOffsets,
  verticalTranslate,
  horizontalTranslate,
  cardOpacity,
} from './lib/carouselGeometry';
export type { CarouselLevelInput } from './lib/carouselGeometry';

export { computeClockTier } from './lib/homologationClock';
export type { ClockTier, ClockTierResult } from './lib/homologationClock';

// === 014-chat, T050 — peças de leitura (design/chat-verificacao.md §4) ===

export { Kbd } from './components/Kbd';
export type { KbdProps } from './components/Kbd';

export { MessageHeader } from './components/MessageHeader';
export type { MessageHeaderProps } from './components/MessageHeader';

export { OwnerMessage } from './components/OwnerMessage';
export type { OwnerMessageProps, OwnerMessageSendState } from './components/OwnerMessage';

export { NoticeLine } from './components/NoticeLine';
export type { NoticeLineProps } from './components/NoticeLine';

export { ActionLine } from './components/ActionLine';
export type { ActionLineProps, ActionCategory, ActionStatus } from './components/ActionLine';

export { ActionGroup } from './components/ActionGroup';
export type { ActionGroupProps } from './components/ActionGroup';

export { WorkFold } from './components/WorkFold';
export type { WorkFoldProps, WorkFoldState } from './components/WorkFold';

export { CodeBlock } from './components/CodeBlock';
export type { CodeBlockProps } from './components/CodeBlock';

export { DiffBlock } from './components/DiffBlock';
export type { DiffBlockProps, DiffLine, DiffLineKind } from './components/DiffBlock';

export { CommandOutput } from './components/CommandOutput';
export type { CommandOutputProps, CommandOutputLine } from './components/CommandOutput';

export { Banner } from './components/Banner';
export type { BannerProps, BannerTone, BannerVariant } from './components/Banner';

export { SubagentRow, SUBAGENT_STATE_LABEL_PT } from './components/SubagentRow';
export type { SubagentRowProps, SubagentState } from './components/SubagentRow';

export {
  DETAIL_MAX_LINES,
  DETAIL_MAX_BYTES,
  clipLines,
  clipOutputText,
  formatHiddenLines,
} from './lib/clipLines';
export type { ClippedLines } from './lib/clipLines';
