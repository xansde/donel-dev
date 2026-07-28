import { AnnotationTag, PhaseStateGlyph, PHASE_STATE_LABEL_PT, SESSION_STATE_LABEL_PT, StateDot, WorktreeCard } from '@donel-dev/design-system';
import type { WorktreeCardPhaseNode } from '@donel-dev/design-system';
import type { DiscoveryTree, MarcoNode, PhaseNode } from '../../../main/discovery-tree';
import type { EsteiraPhase, PhaseDefaultsTable } from '../../../shared/devMode';
import type { PhaseStatus } from '../../../shared/phaseState';
import styles from './DiscoveryMap.module.css';

// T316/T317/T318 (003-modo-dev, Batch B) — Zona 3, o mapa do discovery em
// foco (CA-7/CA-8/CA-9/CA-10/CA-17/CA-18/CA-19).
//
// Tudo o que aparece aqui vem de `devMode:readTree` (disco) — **nenhuma**
// chamada a git, nenhuma varredura de diretório, nenhuma escrita (CA-19).
// Artefato exibido é só o que o `<fase>-result.json` DECLAROU
// (`artifact_paths`/`e2e_path`/`documents`) mais `ctx.md` e o próprio
// `result.json` (CA-8).
//
// A composição é só design system (CA-25): `WorktreeCard` (marco e
// orquestrador), `PhaseStateGlyph` (estado de FASE), `StateDot` (estado de
// SESSÃO, só na legenda) e `AnnotationTag`. A legenda do rodapé distinguindo
// os dois eixos é item verificável (achado de acessibilidade da verificação
// de design).

const ALL_PHASES: readonly EsteiraPhase[] = ['discovery', 'plano', 'implementar', 'validar', 'concluir'];

export interface SelectedPhaseNode {
  readonly marcoId: string;
  readonly phase: EsteiraPhase;
}

export interface DiscoveryMapProps {
  tree: DiscoveryTree;
  phaseDefaults: PhaseDefaultsTable;
  focusedMarcoId: string | null;
  selectedNode: SelectedPhaseNode | null;
  /** Perfil de conta ATIVO agora — usado para o aviso do CA-22 na etapa arquivada. */
  activeProfileSlug: string;
  onFocusMarco: (marcoId: string) => void;
  onSelectPhase: (marcoId: string, phase: EsteiraPhase) => void;
}

/** A skill de cada fase é DADO FIXO da tabela do CA-4 — nunca um campo novo do manifesto (plan.md). */
function skillOf(defaults: PhaseDefaultsTable, phase: EsteiraPhase): string {
  return defaults[phase].commandTemplate.split(' ')[0];
}

/** CA-8/CA-10 — só o que a fase DECLAROU, mais `ctx.md` e o próprio manifesto. Nunca varredura. */
function declaredArtifacts(node: PhaseNode): readonly string[] {
  const outputs = node.artifacts.result?.outputs;
  const declared = [...(outputs?.artifact_paths ?? []), ...(outputs?.documents ?? [])];
  if (outputs?.e2e_path) declared.push(outputs.e2e_path);
  if (node.artifacts.ctxExists) declared.push(node.artifacts.ctxPath);
  if (node.artifacts.result) declared.push(node.artifacts.resultPath);
  return declared;
}

function marcoStatusSummary(marco: MarcoNode): PhaseStatus {
  const running = ALL_PHASES.find((phase) => marco.phases[phase].status === 'running');
  if (running) return 'running';
  const failed = ALL_PHASES.find((phase) => marco.phases[phase].status === 'failed');
  if (failed) return 'failed';
  return marco.phases.concluir.status;
}

export function DiscoveryMap({
  tree,
  phaseDefaults,
  focusedMarcoId,
  selectedNode,
  activeProfileSlug,
  onFocusMarco,
  onSelectPhase,
}: DiscoveryMapProps): React.JSX.Element {
  const selectedMarco = selectedNode ? tree.marcos.find((marco) => marco.marcoId === selectedNode.marcoId) : undefined;
  const selectedPhaseNode = selectedMarco && selectedNode ? selectedMarco.phases[selectedNode.phase] : undefined;

  return (
    <aside className={styles.map} aria-label="Mapa do discovery" data-testid="devmode-map">
      {/* Topo = o discovery (papel orquestrador): sem worktree e sem nós de
          fase — ele não roda etapas próprias (variante do T333). */}
      <WorktreeCard
        variant="orquestrador"
        id={tree.discoveryCardId}
        title="Discovery em foco"
        summary={`${tree.marcos.length} marco(s) na frente. O mapa mostra a fase em que cada um está.`}
        status={tree.allMarcosComplete ? 'todos os marcos concluídos' : undefined}
        statusTone="ok"
      />

      <div className={styles.marcos} data-testid="devmode-map-marcos">
        {tree.marcos.map((marco) => {
          const phases: WorktreeCardPhaseNode[] = ALL_PHASES.map((phase) => ({
            phase,
            state: marco.phases[phase].status,
            onSelect: () => onSelectPhase(marco.marcoId, phase),
          }));

          return (
            <div
              key={marco.marcoId}
              className={marco.marcoId === focusedMarcoId ? styles.marcoFocused : styles.marco}
              data-testid={`devmode-map-marco-${marco.marcoId}`}
              data-focused={marco.marcoId === focusedMarcoId ? 'true' : 'false'}
            >
              <WorktreeCard
                variant="marco"
                id={marco.marcoId}
                title={marco.cardId}
                summary={`Fatia vertical do discovery — uma branch, um PR. Estado agregado: ${PHASE_STATE_LABEL_PT[marcoStatusSummary(marco)]}.`}
                worktreePath={marco.phases.implementar.artifacts.worktreePath ?? undefined}
                branch={marco.phases.implementar.artifacts.branch ?? undefined}
                phases={phases}
                onFocus={() => onFocusMarco(marco.marcoId)}
              />
            </div>
          );
        })}
        {tree.marcos.length === 0 ? (
          <p className={styles.empty} data-testid="devmode-map-empty">
            Nenhum marco ainda — o fanout de marcos nasce no `discovery-result.json`.
          </p>
        ) : null}
      </div>

      {/* T317 — nó expandido: skill fixa da fase, artefatos DECLARADOS e recibos de conhecimento. */}
      {selectedNode && selectedPhaseNode ? (
        <section className={styles.details} data-testid="devmode-node-details">
          <header className={styles.detailsHeader}>
            <PhaseStateGlyph status={selectedPhaseNode.status} />
            <span>
              [{selectedNode.marcoId}] · {selectedNode.phase}
            </span>
          </header>

          <h3 className={styles.detailsTitle}>Skill rodada</h3>
          <p className={styles.mono} data-testid="devmode-node-skill">
            {skillOf(phaseDefaults, selectedNode.phase)}
          </p>

          <h3 className={styles.detailsTitle}>Artefatos declarados</h3>
          <ul className={styles.artifacts} data-testid="devmode-node-artifacts">
            {declaredArtifacts(selectedPhaseNode).map((path) => (
              <li key={path} className={styles.mono} data-testid="devmode-node-artifact">
                {path}
              </li>
            ))}
            {declaredArtifacts(selectedPhaseNode).length === 0 ? (
              <li className={styles.muted}>Nenhum artefato declarado ainda.</li>
            ) : null}
          </ul>

          {/* CA-18 — indicador DISCRETO quando não há recibo; nada de "incompleto".
              Sem `registrations` no manifesto (nenhum vault no circuito), a seção
              inteira some: silêncio, não insistência. */}
          {selectedPhaseNode.artifacts.result?.registrations ? (
            <>
              <h3 className={styles.detailsTitle}>Recibos de conhecimento</h3>
              <div data-testid="devmode-node-receipts">
                {selectedPhaseNode.artifacts.result.registrations.vault?.path ? (
                  <span className={styles.mono}>{selectedPhaseNode.artifacts.result.registrations.vault.path}</span>
                ) : (
                  <AnnotationTag tone="muted">
                    <span data-testid="devmode-node-no-receipt">sem registro</span>
                  </AnnotationTag>
                )}
              </div>
            </>
          ) : null}

          {/* CA-22 — etapa arquivada num perfil diferente do ativo: avisa qual conta, nunca bloqueia. */}
          {selectedPhaseNode.archivedSession && selectedPhaseNode.archivedSession.profileSlug !== activeProfileSlug ? (
            <p className={styles.warning} data-testid="devmode-node-profile-warning">
              Essa etapa rodou na conta {selectedPhaseNode.archivedSession.profileSlug}.
            </p>
          ) : null}

          {selectedPhaseNode.artifacts.resultUnreadable ? (
            <p className={styles.muted} data-testid="devmode-node-unreadable">
              Manifesto ilegível — o que dá para ler está acima.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Legenda dos DOIS eixos (item verificável): estado de FASE × estado de SESSÃO. */}
      <footer className={styles.legend} data-testid="devmode-map-legend">
        <div className={styles.legendRow}>
          <span className={styles.legendTitle}>Fase</span>
          {(['not-started', 'running', 'done', 'failed', 'stuck'] as const).map((status) => (
            <PhaseStateGlyph key={status} status={status} label={PHASE_STATE_LABEL_PT[status]} />
          ))}
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendTitle}>Sessão</span>
          {(['working', 'waiting', 'permission', 'done'] as const).map((state) => (
            <span key={state} className={styles.legendItem}>
              <StateDot state={state} />
              {SESSION_STATE_LABEL_PT[state]}
            </span>
          ))}
        </div>
      </footer>
    </aside>
  );
}
