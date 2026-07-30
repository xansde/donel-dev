import { PhaseChip, PhaseStateGlyph, type EsteiraPhase as ChipPhase } from '@donel-dev/design-system';
import type { EsteiraPhase } from '../../../shared/devMode';
import type { PhaseStatus } from '../../../shared/phaseState';
import styles from './PhaseDetailsPanel.module.css';

// Lote 7 (009-modo-dev-v3), CA-7 — o painel PRÓPRIO de 316px à direita: o
// mapa (`DiscoveryMap.tsx`) NUNCA carrega o detalhe dentro de si (a
// ESTRUTURA de 3 colunas nasce neste lote — 480 / flex:1 / 316). O CONTEÚDO
// rico (garantia, PR desta fase, artefatos declarados, recibos de
// conhecimento — mockup linhas 236-312) é do lote 8: aqui fica só o
// esqueleto que degrada por omissão, nunca um "em construção" ou erro.

const CHIP_PHASES: ReadonlySet<string> = new Set<ChipPhase>(['discovery', 'plano', 'implementar', 'validar', 'concluir', 'documentar']);

function isChipPhase(phase: EsteiraPhase): phase is ChipPhase {
  return CHIP_PHASES.has(phase);
}

export interface PhaseDetailsSelection {
  readonly cardId: string;
  readonly phase: EsteiraPhase;
  readonly faseNum?: number | null;
  readonly status: PhaseStatus;
}

export interface PhaseDetailsPanelProps {
  /** `null` = nenhuma etapa selecionada ainda — o painel some por omissão, nunca um erro. */
  readonly selection: PhaseDetailsSelection | null;
}

/**
 * Esqueleto do painel de detalhe (CA-7). Breadcrumb completo, garantia, PR,
 * artefatos e recibos de conhecimento (mockup linhas 236-312) chegam no
 * lote 8 — este componente só prova que a coluna de 316px existe e mostra o
 * mínimo (chip + fase + estado) do que já foi selecionado no mapa.
 */
export function PhaseDetailsPanel({ selection }: PhaseDetailsPanelProps): React.JSX.Element {
  return (
    <aside className={styles.panel} aria-label="Detalhe da etapa" data-testid="devmode-details-panel">
      {selection ? (
        <div className={styles.header}>
          <span className={styles.label}>Etapa em foco</span>
          <div className={styles.summary}>
            <PhaseStateGlyph status={selection.status} />
            {isChipPhase(selection.phase) ? <PhaseChip phase={selection.phase} /> : null}
            {selection.faseNum ? <span className={styles.fase}>fase {selection.faseNum}</span> : null}
          </div>
          <p className={styles.placeholder} data-testid="devmode-details-placeholder">
            Garantia, PR, artefatos e recibos de conhecimento chegam no próximo lote.
          </p>
        </div>
      ) : (
        <p className={styles.empty} data-testid="devmode-details-empty">
          Selecione uma etapa no mapa para ver o detalhe.
        </p>
      )}
    </aside>
  );
}
