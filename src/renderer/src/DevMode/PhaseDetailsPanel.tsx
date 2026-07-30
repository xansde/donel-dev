import { PhaseChip, PhaseStateGlyph, type EsteiraPhase as ChipPhase } from '@donel-dev/design-system';
import type { EsteiraPhase } from '../../../shared/devMode';
import type { PhaseDetailsViewModel } from '../../../shared/phaseDetailsView';
import styles from './PhaseDetailsPanel.module.css';

// Lote 7 (009-modo-dev-v3), CA-7 — o painel PRÓPRIO de 316px à direita: o
// mapa (`DiscoveryMap.tsx`) NUNCA carrega o detalhe dentro de si.
//
// Lote 8, CA-18/CA-20 — o CONTEÚDO rico (breadcrumb, garantia, PR desta
// fase, artefatos declarados, recibos de conhecimento — mockup linhas
// 236-312) chega aqui. Cada seção degrada por OMISSÃO (C4/CA-6): sem dado,
// a seção simplesmente não aparece — nunca um "em construção" nem um erro.
// O view-model inteiro é montado por `buildPhaseDetailsView`
// (shared/phaseDetailsView.ts, puro/testado) — este componente só renderiza.

const CHIP_PHASES: ReadonlySet<string> = new Set<ChipPhase>(['discovery', 'plano', 'implementar', 'validar', 'concluir', 'documentar']);

function isChipPhase(phase: EsteiraPhase): phase is ChipPhase {
  return CHIP_PHASES.has(phase);
}

export interface PhaseDetailsPanelProps {
  /** `null` = nenhuma etapa selecionada ainda — o painel some por omissão, nunca um erro. */
  readonly selection: PhaseDetailsViewModel | null;
}

export function PhaseDetailsPanel({ selection }: PhaseDetailsPanelProps): React.JSX.Element {
  if (!selection) {
    return (
      <aside className={styles.panel} aria-label="Detalhe da etapa" data-testid="devmode-details-panel">
        <p className={styles.empty} data-testid="devmode-details-empty">
          Selecione uma etapa no mapa para ver o detalhe.
        </p>
      </aside>
    );
  }

  const { breadcrumb, garantia, pr, artifacts, receipts, showReceipts } = selection;

  return (
    <aside className={styles.panel} aria-label="Detalhe da etapa" data-testid="devmode-details-panel">
      {/* Breadcrumb do nó focado (mockup linhas 176-188): discovery › card de
          plano › fase. Sem ação própria — é orientação, não navegação nova
          (a navegação já vive no mapa/trilha, CA-16 "cada fato num lugar só"). */}
      <div className={styles.breadcrumb} data-testid="devmode-details-breadcrumb">
        <span className={styles.breadcrumbId}>{breadcrumb.discoveryCardId}</span>
        <span className={styles.breadcrumbSep} aria-hidden="true">
          ›
        </span>
        <span className={styles.breadcrumbId}>{breadcrumb.planCardId}</span>
        <span className={styles.breadcrumbTitle}>{breadcrumb.planCardTitle}</span>
        {breadcrumb.faseNum ? (
          <>
            <span className={styles.breadcrumbSep} aria-hidden="true">
              ›
            </span>
            <span className={styles.breadcrumbFase}>fase {breadcrumb.faseNum}</span>
          </>
        ) : null}
      </div>

      <div className={styles.header}>
        <span className={styles.label}>Etapa em foco</span>
        <div className={styles.summary}>
          <PhaseStateGlyph status={selection.status} />
          {isChipPhase(selection.phase) ? <PhaseChip phase={selection.phase} /> : null}
          {selection.faseNum ? <span className={styles.fase}>fase {selection.faseNum}</span> : null}
        </div>
        <p className={styles.summaryText} data-testid="devmode-details-summary">
          {selection.summary}
        </p>
        {/* CA-25 — a conta em que a sessão ARQUIVADA desta etapa rodou; some
            duas entradas da mesma sessão em contas diferentes (CA-24) nunca
            indistinguíveis. */}
        {selection.archivedAccount ? (
          <span
            className={[styles.accountTag, selection.archivedAccount.mismatch ? styles.accountTagWarn : ''].join(' ')}
            data-testid="devmode-details-account"
          >
            {selection.archivedAccount.label}
          </span>
        ) : null}
      </div>

      {garantia ? (
        <section className={styles.section} aria-label="Garantia da fase" data-testid="devmode-details-garantia">
          <div className={styles.sectionLabel}>Garantia da fase</div>
          <div className={styles.garantiaRow}>
            <span className={styles.garantiaTipo}>{garantia.tipo}</span>
            <span className={styles.garantiaStatus}>{garantia.statusLabel}</span>
          </div>
          {garantia.descricao ? <p className={styles.garantiaDescricao}>{garantia.descricao}</p> : null}
          {garantia.roteiroPath ? <div className={styles.mono}>{garantia.roteiroPath}</div> : null}
        </section>
      ) : null}

      {pr ? (
        <section className={styles.section} aria-label="PR desta fase" data-testid="devmode-details-pr">
          <div className={styles.sectionLabel}>PR desta fase</div>
          <div className={styles.kvList}>
            {pr.map((row) => (
              <div key={row.label} className={styles.kvRow}>
                <span className={styles.kvKey}>{row.label}</span>
                <span className={styles.kvValue}>{row.value}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {artifacts.length > 0 ? (
        <section className={styles.section} aria-label="Artefatos declarados" data-testid="devmode-details-artifacts">
          <div className={styles.sectionLabel}>Artefatos declarados</div>
          <div className={styles.artifactList}>
            {artifacts.map((artifact) => (
              <div key={artifact.path} className={styles.artifactRow}>
                <span className={styles.artifactIcon} aria-hidden="true">
                  {artifact.icon}
                </span>
                <span className={styles.artifactPath}>{artifact.path}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showReceipts ? (
        <section className={styles.section} aria-label="Recibos de conhecimento" data-testid="devmode-details-receipts">
          <div className={styles.sectionLabel}>Recibos de conhecimento</div>
          {receipts.length > 0 ? (
            <div className={styles.receiptList}>
              {receipts.map((receipt) => (
                <div key={receipt.source} className={styles.receiptRow} data-testid="devmode-details-receipt">
                  {receipt.source}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.receiptEmpty} data-testid="devmode-details-receipts-empty">
              sem registro
            </p>
          )}
        </section>
      ) : null}
    </aside>
  );
}
