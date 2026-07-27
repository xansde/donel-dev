import { AnnotationTag, ESTEIRA_PHASE_LABEL_PT, PhaseStateGlyph, PHASE_STATE_LABEL_PT } from '@donel-dev/design-system';
import type { AnnotationTone } from '@donel-dev/design-system';
import type { EsteiraPhase } from '../../../shared/devMode';
import type { PhaseStatus } from '../../../shared/phaseState';
import styles from './PhaseButton.module.css';

// T314/T319/T320 (003-modo-dev, Batch B) — botão da fase na Zona 2.
//
// **CA-5 / invariante 4:** o botão é SEMPRE clicável. Não existe `disabled`
// nesta peça de propósito — travar a UI seria fingir um gate que ela não é (o
// único gate real é o `preflight.py`, e o espelho pode estar segundos
// atrasado). O que existe é um SLOT de aviso.
//
// **D1:** a trava é a etiqueta `esteira:em-andamento:<fase>` do card no
// BOARD, nunca um arquivo `.lock` em disco — nada aqui lê ou escreve arquivo
// nenhum. Na Fatia 1 não há fonte para esse fato, então `lockAnnotation`
// chega `null` e o slot fica vazio: comportamento esperado (plan.md §"Nota —
// CA-5"), o dado real é ligado na Fatia 2 (T327).
//
// **CA-15:** o estado de FASE aparece via `PhaseStateGlyph` (5 estados,
// dupla codificação) — eixo diferente do `StateDot` (sessão), que continua
// vivendo na aba/sidebar.

export interface PhaseButtonProps {
  phase: EsteiraPhase;
  status: PhaseStatus;
  /** CA-5 (Fatia 2) — conteúdo do slot de aviso de trava. `null` na Fatia 1: não há fonte de dado. */
  lockAnnotation?: string | null;
  /** CA-22 — "essa etapa rodou na conta X"; avisa, nunca bloqueia. */
  profileWarning?: string | null;
  /** C4 — marcador discreto de manifesto ilegível; nunca vira um 6º estado. */
  resultUnreadable?: boolean;
  active?: boolean;
  onClick: () => void;
}

const STATUS_TONE: Record<PhaseStatus, AnnotationTone> = {
  'not-started': 'muted',
  running: 'accent',
  done: 'ok',
  failed: 'error',
  stuck: 'warn',
};

export function PhaseButton({
  phase,
  status,
  lockAnnotation = null,
  profileWarning = null,
  resultUnreadable = false,
  active = false,
  onClick,
}: PhaseButtonProps): React.JSX.Element {
  return (
    <div className={styles.wrapper} data-testid={`devmode-phase-${phase}`}>
      <button
        type="button"
        className={[styles.button, active ? styles.active : ''].filter(Boolean).join(' ')}
        onClick={onClick}
        data-testid={`devmode-phase-button-${phase}`}
        data-status={status}
      >
        <PhaseStateGlyph status={status} />
        <span className={styles.label}>{ESTEIRA_PHASE_LABEL_PT[phase]}</span>
        <span className={styles.state}>{PHASE_STATE_LABEL_PT[status]}</span>
      </button>

      {/* Slot de aviso (CA-5). Vazio na Fatia 1 — ver comentário de topo. */}
      <div className={styles.slot} data-testid={`devmode-phase-slot-${phase}`}>
        {lockAnnotation ? <AnnotationTag tone="lock">{lockAnnotation}</AnnotationTag> : null}
        {profileWarning ? (
          <AnnotationTag tone="warn">
            <span data-testid={`devmode-phase-profile-warning-${phase}`}>{profileWarning}</span>
          </AnnotationTag>
        ) : null}
        {resultUnreadable ? <AnnotationTag tone={STATUS_TONE.stuck}>manifesto ilegível</AnnotationTag> : null}
      </div>
    </div>
  );
}
