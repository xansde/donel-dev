import { Button, PhaseChip, PhaseStateGlyph, isEsteiraPhase } from '@donel-dev/design-system';
import type { MapDetailView } from './esteiraMapView';
import styles from './PhaseDetailsPanel.module.css';

// Spec 010 / batch B6 — o painel PRÓPRIO de 316px à direita (CA-7 do design v3):
// o mapa nunca carrega o detalhe dentro de si. A forma é a mesma; o conteúdo
// passou a vir do STORE.
//
// O que ele mostra, e por quê (itens M-09/M-10 e T-01/T-02 do inventário do B6):
//
//  - **O que dá para conferir** — `verifications[]`: PR, check, revisão e
//    conclusão (D-4). Estava no snapshot desde a fase 1 e nenhuma tela mostrava.
//  - **Artefatos declarados** — `artifacts[]`, com o ponteiro inteiro (D-8).
//  - **Não consegui ler** — o erro de ingestão, com caminho e código. É a
//    inversão da issue #35: ausência de leitura nunca vira "não realizada".
//  - **Trava** — dono, hora, sessão e a saída num gesto (D-11).
//  - **Espelho pendente** — o board atrasado nunca é trabalho parado (D-12).
//
// Cada seção degrada por OMISSÃO: sem dado, ela não aparece. Nenhum texto nasce
// aqui — tudo chega pronto de `esteiraMapView.ts`.
//
// `isEsteiraPhase` vem do design-system, não é mais um Set local: achado da
// captura do batch n8 (tutorial-e2e) — esta cópia e a de `DiscoveryMap.tsx`
// tinham cada uma seu próprio Set hardcoded, as duas esquecendo `design`
// quando a fase entrou no catálogo (E1). Vocabulário duplicado diverge; a
// fonte agora é uma só.

export interface PhaseDetailsPanelProps {
  /** `null` = não há card nenhum no histórico — o painel some por omissão. */
  readonly detail: MapDetailView | null;
  /** Libera a trava num gesto (D-11). */
  readonly onReleaseLock: () => void;
  /** Reenvia o que o board não recebeu (D-12) — gesto de cortesia, nunca desbloqueia nada local. */
  readonly onRetryMirror: () => void;
  readonly readOnly: boolean;
}

export function PhaseDetailsPanel({ detail, onReleaseLock, onRetryMirror, readOnly }: PhaseDetailsPanelProps): React.JSX.Element {
  if (!detail) {
    return (
      <aside className={styles.panel} aria-label="Detalhe da etapa" data-testid="devmode-details-panel">
        <p className={styles.empty} data-testid="devmode-details-empty">
          Nenhum card no histórico ainda — o detalhe aparece quando houver um.
        </p>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label="Detalhe da etapa" data-testid="devmode-details-panel">
      <div className={styles.header}>
        <span className={styles.label}>{detail.phase ? 'Etapa em foco' : 'Nó em foco'}</span>
        <div className={styles.summary}>
          {detail.phaseGlyph ? <PhaseStateGlyph status={detail.phaseGlyph} /> : null}
          {detail.phase && isEsteiraPhase(detail.phase) ? <PhaseChip phase={detail.phase} /> : null}
          {detail.phase && !isEsteiraPhase(detail.phase) ? <span className={styles.fase}>{detail.phase}</span> : null}
        </div>
        <p className={styles.summaryText} data-testid="devmode-details-title">
          {detail.title}
        </p>
        <p className={styles.summaryText} data-testid="devmode-details-summary">
          {detail.summary}
        </p>
      </div>

      {/* O erro de leitura vem PRIMEIRO: é a informação que o modelo antigo
          escondia, e a que muda o que o operador faz agora. */}
      {detail.ingestErrors.length > 0 ? (
        <section className={styles.section} aria-label="Não consegui ler" data-testid="devmode-details-ingest-errors">
          <div className={styles.sectionLabel}>Não consegui ler</div>
          {detail.ingestErrors.map((error) => (
            <div key={error.key} className={styles.kvRow}>
              <span className={styles.mono}>{error.path}</span>
              <span className={styles.kvValue}>{error.reason}</span>
            </div>
          ))}
          <p className={styles.garantiaDescricao}>{detail.ingestErrorNote}</p>
        </section>
      ) : null}

      {detail.lock ? (
        <section className={styles.section} aria-label="Trava da fase" data-testid="devmode-details-lock" data-state={detail.lock.state}>
          <div className={styles.sectionLabel}>{detail.lock.title}</div>
          <p className={styles.garantiaDescricao}>{detail.lock.line}</p>
          {detail.lock.nextStep ? (
            <>
              <p className={styles.garantiaDescricao}>{detail.lock.nextStep.explanation}</p>
              <div className={styles.mono}>{detail.lock.nextStep.command}</div>
            </>
          ) : null}
          <Button variant="ghost" onClick={onReleaseLock} disabled={readOnly} data-testid="devmode-details-release-lock">
            Liberar trava
          </Button>
        </section>
      ) : null}

      {detail.closureLine ? (
        <section className={styles.section} aria-label="Como o ciclo terminou" data-testid="devmode-details-closure">
          <div className={styles.sectionLabel}>Como este ciclo termina</div>
          <p className={styles.garantiaDescricao}>{detail.closureLine}</p>
        </section>
      ) : null}

      {detail.verifications.length > 0 ? (
        <section className={styles.section} aria-label={detail.verificationsTitle} data-testid="devmode-details-verifications">
          <div className={styles.sectionLabel}>{detail.verificationsTitle}</div>
          <div className={styles.kvList}>
            {detail.verifications.map((line) => (
              <div key={line.key} className={styles.kvRow}>
                <span className={line.failed ? styles.garantiaStatus : styles.kvValue}>
                  {/* O ponteiro (URL do PR, nome do check) vem SEPARADO da frase
                      de estado — é o que dá para ir conferir (D-4). */}
                  {line.detail === null ? line.text : `${line.text} · ${line.detail}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {detail.artifacts.length > 0 ? (
        <section className={styles.section} aria-label="Artefatos declarados" data-testid="devmode-details-artifacts">
          <div className={styles.sectionLabel}>Artefatos declarados</div>
          <div className={styles.artifactList}>
            {detail.artifacts.map((artifact) => (
              <div key={artifact.key} className={styles.artifactRow}>
                <span className={styles.artifactIcon} aria-hidden="true">
                  {artifact.icon}
                </span>
                <span className={styles.artifactPath} title={artifact.note}>
                  {artifact.path}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {detail.notes.length > 0 ? (
        <section className={styles.section} aria-label="Notas" data-testid="devmode-details-notes">
          <div className={styles.sectionLabel}>Notas</div>
          {detail.notes.map((note) => (
            <div key={note.key} className={styles.kvRow}>
              <span className={styles.kvKey}>{note.about}</span>
              <span className={styles.kvValue}>{note.text}</span>
            </div>
          ))}
        </section>
      ) : null}

      {detail.mirror.length > 0 ? (
        <section className={styles.section} aria-label={detail.mirrorTitle} data-testid="devmode-details-mirror">
          <div className={styles.sectionLabel}>{detail.mirrorTitle}</div>
          <p className={styles.garantiaDescricao}>{detail.mirrorHint}</p>
          {detail.mirror.map((line) => (
            <div key={line.key} className={styles.kvRow}>
              <span className={styles.kvValue}>
                {line.text} — {line.detail}
              </span>
            </div>
          ))}
          <Button variant="ghost" onClick={onRetryMirror} disabled={readOnly} data-testid="devmode-details-retry-mirror">
            Reenviar espelho
          </Button>
        </section>
      ) : null}
    </aside>
  );
}
