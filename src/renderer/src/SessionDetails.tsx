import { Button, SegmentedControl } from '@donel-dev/design-system';
import type { SegmentedControlOption } from '@donel-dev/design-system';
import type { SemaphoreState } from '../../shared';
import type { EffortLevel, ModelAlias } from '../../shared/commandBuilder';
import { canInjectLiveCommand } from '../../shared/liveSessionInjection';
import styles from './SessionDetails.module.css';

// T011 — Controle de Modelo/Esforço em sessão viva (FR-011). Vive na
// TOOLBAR da aba ativa (acima do terminal), não no painel direito: o painel
// direito (Launcher, ui-spec §4) já é exercitado por vários smokes
// existentes (T008 CA-1, T009 semáforo, T010 6-sessões) assumindo que ele
// SEMPRE mostra `[data-testid="launcher"]` — inclusive quando a aba ativa é
// uma sessão claude (a aba "Sessão" default, claude, já é a ativa no boot).
// A leitura literal do ui-spec §2 ("Launcher quando nada selecionado;
// detalhes da sessão quando houver") trocaria o Launcher pra este painel
// sempre que uma aba claude estivesse em foco — o que quebraria esses
// smokes já mergeados (não dá pra abrir uma 2ª/3ª sessão pelo Launcher com
// uma sessão claude focada). A própria task T011 permite a alternativa "na
// aba/toolbar" — usada aqui pra não regredir o trilho já validado.
//
// Só renderiza pra abas 'claude' (App.tsx decide isso) — terminal livre
// (FR-008) não tem modelo/esforço.

const MODEL_OPTIONS: SegmentedControlOption[] = [
  { value: 'fable', label: 'fable' },
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
];

const EFFORT_OPTIONS: SegmentedControlOption[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'med' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];

export interface SessionDetailsProps {
  model: ModelAlias;
  effort: EffortLevel;
  /** Estado do semáforo da aba ativa (T009) — só `'waiting'` libera a injeção (FR-011: "só injeta quando o prompt está ocioso"). */
  semaphoreState: SemaphoreState | undefined;
  /** Processo vivo (T010 `aliveTabs`) — sem isso não há stdin pra injetar; é o caso que dispara a degradação FR-011. */
  alive: boolean;
  onSelectModel: (model: ModelAlias) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  /** Degradação FR-011 ("reiniciar a sessão com a flag") — só relevante/visível quando `alive` é `false`. */
  onRestartWithConfig: () => void;
  /**
   * T013 (correção herdada) — 'model'/'effort' quando App.tsx já escreveu a
   * injeção no stdin mas AINDA não viu a confirmação real do CLI no ring
   * buffer (App.tsx `watchLiveInjection`); `undefined` = nenhuma injeção em
   * voo. Desabilita os dois controles enquanto pendente (nunca empilha uma
   * 2ª injeção sobre uma ainda não confirmada) e troca o hint — ver
   * shared/liveSessionInjection.ts pro porquê da correção.
   */
  pendingKind?: 'model' | 'effort';
  /**
   * FIX (feedback E2E rodada 5) — `true` quando a aba está viva mas
   * nenhum evento de hook chegou ainda depois de ~20s (App.tsx calcula a
   * partir de `aliveSinceRef`/`semaphoreStates`) — troca o hint genérico
   * "Conectando…" por um diagnóstico acionável. Default `false` (sem essa
   * defesa, os testes/consumidores existentes que não passam a prop
   * continuam vendo o comportamento de antes).
   */
  possiblyBlockedOnPrompt?: boolean;
}

/** Texto do aviso ao lado dos segmented — explica POR QUE o controle está desabilitado (ui-spec §4: "tooltip explica"), ou a dica de uso quando está liberado. */
function statusHint(
  state: SemaphoreState | undefined,
  alive: boolean,
  pendingKind: 'model' | 'effort' | undefined,
  possiblyBlockedOnPrompt: boolean
): string {
  if (pendingKind) return 'Aguardando o CLI confirmar a troca…';
  if (!alive) return 'Sessão sem processo vivo — troque e clique em "Reiniciar com essa config".';
  // FIX (feedback E2E rodada 5) — App.tsx só liga `possiblyBlockedOnPrompt`
  // quando a sessão está viva há mais de ~20s sem NENHUM evento de hook
  // (nem um) — o hint genérico "Conectando…" (default abaixo) escondia o
  // caso real (ex.: diálogo de confiança de pasta bloqueando o CLI antes do
  // REPL, ver TerminalPane.tsx) atrás de um texto que soa transitório.
  if (possiblyBlockedOnPrompt) {
    return 'O CLI pode estar aguardando resposta no terminal (ex.: confiança de pasta) — clique no terminal e responda.';
  }
  switch (state) {
    case 'working':
      return 'Sessão trabalhando — aguarde o turno terminar pra trocar.';
    case 'permission':
      return 'Permissão pendente — resolva o prompt antes de trocar.';
    case 'waiting':
      return 'Aplica na sessão em andamento, sem perder o histórico.';
    default:
      return 'Conectando…';
  }
}

export function SessionDetails({
  model,
  effort,
  semaphoreState,
  alive,
  onSelectModel,
  onSelectEffort,
  onRestartWithConfig,
  pendingKind,
  possiblyBlockedOnPrompt = false,
}: SessionDetailsProps): React.JSX.Element {
  const disabled = pendingKind !== undefined || !canInjectLiveCommand(semaphoreState, alive);
  const hint = statusHint(semaphoreState, alive, pendingKind, possiblyBlockedOnPrompt);

  return (
    <div className={styles.toolbar} data-testid="session-details" aria-label="Modelo e esforço da sessão">
      <span className={styles.label}>Modelo</span>
      <SegmentedControl options={MODEL_OPTIONS} value={model} onChange={(value) => onSelectModel(value as ModelAlias)} ariaLabel="Modelo (sessão viva)" disabled={disabled} />

      <span className={styles.label}>Esforço</span>
      <SegmentedControl
        options={EFFORT_OPTIONS}
        value={effort}
        onChange={(value) => onSelectEffort(value as EffortLevel)}
        ariaLabel="Esforço (sessão viva)"
        disabled={disabled}
      />

      <span className={styles.hint} data-testid="session-details-hint">
        {hint}
      </span>

      {!alive ? (
        <Button variant="secondary" onClick={onRestartWithConfig}>
          Reiniciar com essa config
        </Button>
      ) : null}
    </div>
  );
}
