import {
  Button,
  formatSmartZoneLabel,
  Kbd,
  Modal,
  SegmentedControl,
  SESSION_STATE_LABEL_PT,
  SplitButton,
  StateDot,
  StatusBar,
  TerminalTab,
  Toast,
  Toggle,
} from '@donel-dev/design-system';
import { DEFAULT_TEAM_PREFS } from '../../shared/teamPrefs';
import type { LedgerTurnRecorded } from '../../shared/ledger/channels';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  AccountsViewDto,
  AppConfigDto,
  NotificationPreference,
  ProjectInfo,
  ProjectScanMode,
  ProviderSummaryDto,
  SemaphoreStateInfo,
  SessionSummaryDto,
  TabColorToken,
} from '../../shared';
// Fix #19 — mapa nome de cor do CLI → CSS (módulo puro, ver src/shared/cliColor.ts).
import { cliColorNameToHex } from '../../shared/cliColor';
// CA-26 (009-modo-dev-v3, lote 1) — reordenação pura da lista de abas por arraste.
import { isTabColorToken, reorderTabs } from '../../shared/tabAppearance';
// B33 — atualizar de dentro do app: esperar as sessões pararem e reabrir as abas depois.
import { DEFAULT_FORCE_AFTER_MINUTES, sessionsToWarn, updateGo, updateReadiness, type ResumeRemote, type ResumeTab } from '../../shared/appUpdate';
import { withResumeArgs } from '../../shared/terminalScreen';
import { UpdateIndicator } from './appUpdate/UpdateIndicator';
import {
  buildClaudeArgs,
  DEFAULT_EFFORT_LEVEL,
  DEFAULT_MODEL_ALIAS,
  parseModelEffortFromArgs,
} from '../../shared/commandBuilder';
import type { EffortLevel, ModelAlias } from '../../shared/commandBuilder';
// T1317 (011-contas-e-provedores, etapa 3, C18/D7) — decide se --model/--effort
// entram no argv (sem provider) ou são omitidos (com provider); commandBuilder.ts
// (buildClaudeArgs acima) continua intocado.
import { buildLauncherArgs } from './launchArgsForProvider';
import { cliWorktreeBranch, WORKTREE_TAB_MARK, worktreeNameFor, worktreeNameFromArgs } from '../../shared/sessionWorktree';
import { projectOfFolders } from '../../shared/projectYolo';
import type { WorktreeKeptPayload } from '../../shared/workspace';
import { useWorkspaceInfo } from './useWorkspaceInfo';
// CA-22 (009) — só o DENOMINADOR do `%` de contexto vem daqui (`min(500k,
// janela do modelo)`, decisão de 24/07); a formatação e as faixas de cor são do
// `SmartZoneMeter` do design-system. Issue #21 — e o rótulo do modelo do rodapé,
// ambos pelo modelo REAL da sessão (transcript), não só pelo do launch.
import { resolveSessionModel } from '../../shared/sessionModel';
// Ponte da statusline — leitura oficial do CLI por aba (rodapé e cota da sessão).
import { resolveSessionMeter, statusLineForSession, statusLineRateLimitPercents, type StatusLineSnapshot } from '../../shared/statusLine';
import { sortProjects } from '../../shared';
// T710 (007/CA-11 2º momento) — o sinal de "a retomada falhou" é o exit code do
// PTY (medido em specs/008-fechar-pendencias/medicao-t710.md), não texto de CLI.
import { resumedSessionIdFromArgs, shouldForgetOnResumeFailure } from '../../shared/resumeFailure';
import { computeSessionAccountLabel } from '../../shared/sessionAccountLabel';
// T709 (007) — pior estado do grupo (CA-6), mesma precedência de sortSessions.
import { sortSessions, worstState } from '../../shared/sessionOrdering';
// 007-favoritos-sessoes (T707/T709) — decisão pura de gravar uma visita
// (debounce de ~10s) e seleção do que aparece sob cada projeto favoritado
// (CA-2/CA-3); a UI só chama, a regra mora no shared.
import { selectProjectSessions, selectRegisteredIds, shouldRecordVisit } from '../../shared/sessionRegistry';
import { nextAttentionSessionId, sessionIdAtPosition } from '../../shared/sessionShortcuts';
// 004-nomear-sessoes (T401/T406/T408) — a regra de qual nome aparece e a
// validação do nome digitado moram no shared, iguais para main e renderer.
import {
  SESSION_NAME_MAX_LENGTH,
  normalizeSessionName,
  reconcileStoredName,
  resolveSessionName,
} from '../../shared/sessionName';
import { sessionTabName } from '../../shared/sessions';
// T021 (015-jobu-pet) — tab <-> PTY map and the `pet:tabs` payload (pure, tested in tests/pet-tab-pty-map.test.ts).
import { buildChatFocusState, buildPetTabsPayload, tabPtyMap, type TabPtyMap } from '../../shared/pet/tabPtyMap';
import styles from './App.module.css';
import { Launcher } from './Launcher';
import { RolesEditor } from './RolesEditor';
import { ChairScreen } from './ChairScreen';
import type { LauncherLaunchOptions } from './Launcher';
import { HillClimbBar } from './HillClimb/HillClimbBar';
import { useHillClimb } from './HillClimb/useHillClimb';
// Mindscape V1 — third mode of the shell (docs/design/mindscape.md).
import { MindscapeScreen, type MindscapeLiveSession } from './Mindscape/MindscapeScreen';
import { sameSemaphoreInfo } from './sameSemaphoreInfo';
import { useMindscapeDoc } from './Mindscape/useMindscapeDoc';
import { AgentBridge, type AgentBridgePorts, type ReturnExpectation } from './Mindscape/agentBridge';
import type { FaxineiroLogEntry } from '../../shared/faxineiro/triggers';
import { SpawnAskPanel, type SpawnAsk } from './Mindscape/SpawnAskPanel';
import { appendConversation, findSessionBoard, placeSessionCards, roleOfSession, setBoardView, setPlaceConversation, writeSessionNote, type MindscapeDoc } from '../../shared/mindscape/model';
import type { SessionRole } from '../../shared/roles';
// Sessão renovada em voo (B36) — limit crossed at the end of a turn → handoff → new session in the same tab.
import { DEFAULT_SESSION_RENEWAL_PREFS, RENEWAL_HANDOFF_WAIT_MS, renewalHandoffDeliveryNotice, renewalLaunchArgs, type SessionRenewalPrefs } from '../../shared/sessionRenewal';
import { useSessionRenewal, type RenewalTabInput } from './sessionRenewal/useSessionRenewal';
import { RenewalDeliveryStrip, RenewalStrip } from './sessionRenewal/RenewalStrip';
import type { BoardView } from '../../shared/mindscape/view';
import {
  AUTO_START_NOT_READY_MESSAGE,
  autoStartGiveUpMessage,
  autoStartWriteSteps,
  classifyAutoStartSubmission,
  isReadyForAutoStart,
  isSafeToSendEnter,
  nextAutoStartEnterAction,
} from './Esteira/esteiraSession';
import type { EsteiraSnapshotDto } from '../../shared/esteira/ipc';
import { Preferences } from './Preferences';
import { PreviousSessions } from './PreviousSessions';
import { AccountsPanel } from './AccountsPanel';
import { ProviderForm } from './ProviderForm';
import { ProjectSidebar } from './ProjectSidebar';
import { usePullRequests } from './usePullRequests';
import type { FavoriteProjectGroup, FavoriteSessionRow, SidebarSession } from './ProjectSidebar';
// CA-30 (009-modo-dev-v3, lote 9) — seletor de projetos no titlebar + modal de criação.
import { ProjectSwitcher } from './ProjectSwitcher';
import { ChatView, type ChatViewActions } from './chat/ChatView';
import { getChatStore } from './chat/ChatStore';
import { BackgroundIndicator, type BackgroundSession } from './chat/BackgroundTasks';
import { revealRow } from './chat/revealRow';
import { runningCount } from '../../shared/chat/backgroundTasks';
import { effectiveTabView, hasChatView, nextTabView, shouldHandleViewShortcut } from './chat/tabView';
import { disposeTabSend, ownerTerminalInput, sendDriverFor, sendToTab, pendingSendReason, sendToTabAndWait, tabTookMessage } from './chat/composer/tabSend';
import { blockingScreen, readInputText } from '../../shared/chat/screen';
import { LEADER_DENY_REASON, permissionPorts } from './Mindscape/permissionPorts';
import { withNoPipelineTag } from '../../shared/chat/noPipeline';
import { LIDER_ROLE_ID, type LiderReport, type LiderSendResult } from '../../shared/lider/ipc';
import { isLeaderOfAllTab } from '../../shared/mindscape/leader';
import { DEFAULT_LEADER_PREFS, leaderCwd, leaderRemoteId } from '../../shared/leaderPrefs';
import { planLeaderDelivery, startLeaderMove, type LeaderMove } from '../../shared/lider/move';
import type { ChatView as ChatViewMode } from '../../shared/chat/rows';
import { TerminalPane } from './TerminalPane';
import { PatchNotes } from './patchnotes/PatchNotes';
import { HealthIndicator } from './health/HealthIndicator';
import { ProxyIndicator } from './proxies/ProxyIndicator';
import { BrowserPanel, BrowserToggleButton } from './browser/BrowserPanel'; // navegador interno
import { LeaderBrowserPanel } from './browser/LeaderBrowserPanel';
import type { BrowserDirectorySession } from '../../shared/browser/directory';
import { OracleCenter } from './OracleCenter';
import { DEFAULT_LAYOUT_PREFS, showsOracle, toggleCenterView, type LayoutPrefs } from '../../shared/layoutPrefs';
import type { PlaceNameOf } from '../../shared/ledger/labels';
import type { TerminalPaneHandle } from './TerminalPane';

// FIX (feedback E2E, batch 3 achado "notificar toda transição vira spam") —
// default conservador local, usado enquanto `appConfig` ainda não chegou de
// `window.donel.config.get()` (mesmo valor de config-store.ts
// `DEFAULT_NOTIFICATION_PREFERENCE`, duplicado aqui só como fallback de
// PRIMEIRO paint — nunca persistido a partir daqui).
const FALLBACK_NOTIFICATION_PREFERENCE: NotificationPreference = 'permission-only';

// T007 — sidebar real ligada ao ProjectScanner (FR-001, US-1): abrir um
// projeto pela sidebar cria (ou foca, se já aberta) uma aba de sessão claude
// com `cwd` no projeto. Todas as abas ficam montadas (visibilidade via CSS,
// não unmount) pra o PTY continuar vivo ao trocar de aba.
//
// T009 — o dot de estado (antes fixo em 'working') agora vem de verdade do
// semáforo (FR-010): cada TerminalPane assina `semaphore.onUpdate` pro seu
// próprio ptyId (só ele conhece esse id) e levanta o estado pra cá via
// `onStateChange`, indexado por `tab.id` (ver TerminalPane.tsx).
//
// T010 — ciclo de vida real (FR-006) + terminal livre (FR-008): fechar uma
// aba de verdade REMOVE ela de `tabs` (o unmount do TerminalPane cuida do
// teardown do PTY + dispose do xterm, ver TerminalPane.tsx); se o processo
// da aba estiver vivo (`aliveTabs`, sinal levantado por `onAliveChange`),
// pede confirmação antes (modal, ui-spec §2 "fechar aba com sessão ativa").
// Aba de terminal livre é só mais um `TabState` com `sessionType: 'shell'`.

interface TabState {
  id: string;
  /**
   * FALLBACK do nome da aba (004-nomear-sessoes, T408) — nome do projeto
   * quando aberta pela sidebar, `sessionTabName(preview)` quando reaberta.
   * Deixou de ser "o nome": o label exibido é `resolveSessionName(...)`, que
   * pode preferir o `custom-title` do CLI ou o nome dado na UI. Para aba
   * `shell` (sem sessão do Claude) este campo continua sendo o nome de fato,
   * só em memória (decisão C4).
   */
  name: string;
  /** cwd do PTY; undefined = home (aba inicial, sem projeto associado). */
  cwd?: string;
  projectName?: string;
  pinned: boolean;
  /** Argv do CommandBuilder (T008 — Launcher); undefined = sessão sem flags (abertura direta pela sidebar). */
  launchArgs?: string[];
  /** 'claude' (default) = sessão claude direta no PTY; 'shell' = terminal livre (FR-008, powershell.exe). */
  sessionType: 'claude' | 'shell';
  /**
   * T1320 (011-contas-e-provedores, etapa 3, C13) — provider classe A
   * escolhido no Launcher para ESTA sessão; `undefined` = sessão de conta
   * (comportamento de hoje). Fixo por aba, igual `launchArgs` — passado ao
   * `pty:create` pelo TerminalPane (T1318).
   */
  providerId?: string;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — login isolado em andamento
   * nesta aba (`accounts:beginLogin`); `undefined` = aba normal (comportamento
   * de hoje). Fixo por aba, mesmo espírito de `providerId`: passado ao
   * `pty:create` pelo TerminalPane, nunca muda no meio da sessão viva.
   */
  accountLoginId?: string;
  /**
   * Papéis de sessão (item 12a) — role this tab was opened with (Launcher, or a place of the
   * Mindscape that had not started). Memory only: on a resume the main reads the role of the
   * place that holds the conversation.
   */
  roleId?: string;
  /** Item 12a — the place of the Mindscape this tab was opened from, until its conversation binds to it. */
  placeId?: string;
  /**
   * Só os Líderes nas abas (04/11) — opened by another session (`sessao_abrir`). It runs normally but stays out
   * of the tab bar and the sidebar; the owner follows it through its place in the Mindscape.
   */
  openedBySession?: boolean;
  /** Place of the session that opened this one: saved on an update (and on the remote), so it comes back out of the tab bar. */
  openedBy?: string;
  /** The owner brought a tab of `openedBySession` to the tab bar (double click on its place, a notice); closing it hides it again. */
  shown?: boolean;
  /** Líder único (ADR 0007) — set ONLY when the Jobu opens it (`liderDeliverRef`) and kept on an update (B33). */
  leaderOfAll?: boolean;
  /** Sessões remotas — remote place (`accounts.remotes`) where this tab's CLI runs; `undefined` = this computer. */
  remoteId?: string;
  /**
   * T404/T408 — id da sessão do Claude desta aba (o mesmo que nomeia o
   * `.jsonl`), devolvido por `pty.create` e levantado pelo TerminalPane. É a
   * chave de persistência do nome (CA-6). `undefined` em aba `shell` e antes
   * da promise do create resolver.
   */
  claudeSessionId?: string;
  /**
   * T403/T408 — último `custom-title` conhecido desta sessão (o nome dado por
   * `/rename` no CLI). Vem do `SessionSummaryDto` quando a aba nasce de uma
   * sessão anterior; `null` numa sessão nova. É um dos insumos de
   * `resolveSessionName` e o que se carimba como `seenTitle` ao renomear.
   */
  customTitle?: string | null;
  /**
   * CA-27 (009-modo-dev-v3) — faixa de cor escolhida pelo operador para esta
   * aba. Default 'none' (aplicado na renderização, não aqui — mesmo espírito
   * opcional de `cwd`/`launchArgs` acima). Persiste por `claudeSessionId`
   * (ver `window.donel.tabs.setColor`); aba `shell` colore só em memória,
   * mesmo motivo do nome dela ser só em memória (C4, 004-nomear-sessoes).
   */
  color?: TabColorToken;
  /**
   * Fix #19 — nome cru da última cor definida por `/color` no CLI desta
   * sessão (ex. `'blue'`); `null`/`undefined` quando a sessão nunca rodou
   * `/color`. SÓ EM MEMÓRIA (igual `semaphoreStates`) — não é persistido: a
   * fonte de verdade é sempre o transcript, relido a cada `transcript:changed`
   * e na primeira leitura ao assinar o watcher (`transcript-watcher.ts`), então
   * reabrir a sessão redescobre a cor sozinho, sem precisar guardar nada aqui.
   * Precedência sobre `color` (token) na renderização — ver `TerminalTab`.
   */
  cliColorName?: string | null;
  /**
   * T056 (014-chat) — vista escolhida para a aba (Chat | Terminal). Sem valor,
   * vale o padrão de `effectiveTabView`: chat numa aba `claude` (que não é de
   * login) com `chat.enabled`, terminal em qualquer outro caso.
   */
  view?: ChatViewMode;
}

/** Último lançamento do Launcher — CA-1 (comando exato) + reaproveitado pelo corpo do "＋ Nova sessão" (ui-spec §2, zona 1). */
interface LastLaunch {
  args: string[];
  cwd: string;
  name: string;
}

// FIX (feedback E2E, decisão do Alexandre 2026-07-23, rodada 5 — "opção A") —
// antes havia uma aba "default" (id fixo, sem `cwd`) que spawnava `claude`
// direto em `os.homedir()` no boot do app. Causa raiz do bug reaberto no
// feedback-e2e.md (2 rodadas reprovadas): o CLI mostra o diálogo pré-REPL
// "Quick safety check" TODA vez que roda em `os.homedir()` (trust de pasta
// nunca é persistido pelo binário pra esse cwd), travando o semáforo em
// `undefined` até alguém responder o diálogo. A opção A elimina a causa raiz
// na raiz: o app nasce SEM nenhuma sessão aberta — zero PTY, zero CLI, zero
// diálogo — e mostra um empty state (ver `styles.emptyState` mais abaixo)
// com call-to-action pra abrir um projeto pela sidebar ou lançar uma sessão
// nova. Efeito colateral desejado: economiza cota/RAM a cada boot (nenhuma
// sessão claude sobe sem o usuário pedir). O MESMO empty state já cobria
// "todas as abas fechadas" (T010) — este caso deixa de ser um estado
// alcançável só por fechamento manual e passa a ser também o estado INICIAL.
const INITIAL_TABS: TabState[] = [];

/** Só os Líderes nas abas — the tab is in the tab bar and the sidebar (a session opened by another one only after the owner opens it). */
function isTabListed(tab: TabState): boolean {
  return !tab.openedBySession || tab.shown === true;
}

/** The tab that takes the focus when `leavingId` leaves the tab bar: the listed neighbour before it, else the first listed one. */
function listedFallback(tabs: readonly TabState[], leavingId: string): TabState | undefined {
  const index = tabs.findIndex((tab) => tab.id === leavingId);
  const before = tabs.slice(0, Math.max(0, index)).filter((tab) => tab.id !== leavingId && isTabListed(tab));
  return before[before.length - 1] ?? tabs.find((tab) => tab.id !== leavingId && isTabListed(tab));
}


// 003-modo-dev/T312 — teto de espera pelo sinal de "pronto para receber
// input" antes de pré-digitar (plan.md, tabela de riscos: "se não voltar a
// 'waiting' num teto, o app para no 1º passo e deixa a retomada manual —
// nunca força o 2º"). Mesma ordem de grandeza (e o mesmo motivo: rede de
// segurança de um sinal que pode nunca chegar) de `LIVE_INJECTION_TIMEOUT_MS`
// acima; separado de propósito porque são esperas de coisas diferentes.
const PRE_TYPE_READY_TIMEOUT_MS = 30_000;

/** Intervalo do re-teste da prontidão. Não é um "delay fixo até digitar": o gatilho continua sendo o SINAL (semáforo/buffer), este tick só garante reavaliar quando o sinal chega sem um chunk novo de PTY junto. */
const PRE_TYPE_POLL_MS = 250;

// wi-esteira4-enter-confirmado (13/08) — `AUTO_START_ENTER_DELAY_MS` morava
// aqui; migrou para `Esteira/esteiraSession.ts` junto com as outras constantes
// do auto-start, porque virou insumo de uma decisão PURA
// (`nextAutoStartEnterAction`) em vez de um prazo que este arquivo aplicava
// sozinho. O docstring de lá também corrige a explicação: o prazo nunca foi a
// cura (a varredura 50/150/400/1000/2000 ms reprovou a hipótese) — ele é só
// higiene de stdin, e o conserto é confirmar no buffer renderizado.
/** Slot curto da aba: papel (item 12a), marca de worktree e "⟳ 2" (segundo plano visível), lado a lado. */
/** Slot curto da aba: marca de worktree e "⟳ 2" (segundo plano visível), lado a lado. */
function tabMarks(roleName: string | undefined, worktreeMark: string | undefined, backgroundRunning: number): string | undefined {
  const marks = [roleName ? `◆ ${roleName}` : undefined, worktreeMark, backgroundRunning > 0 ? `⟳ ${backgroundRunning}` : undefined].filter(Boolean);
  return marks.length > 0 ? marks.join(' ') : undefined;
}

/** How long the statusline readings of all tabs wait to land together (one render for all of them). */
const STATUS_LINE_FLUSH_MS = 300;

/** Remove uma chave de um record sem mutar o original — usado ao limpar `semaphoreStates`/`aliveTabs` no fechamento de aba. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** Líder único na VPS — how long the Líder on the new place has to take the first message (a cold CLI on a busy VPS). */
const LIDER_MOVE_WAIT_MS = 240_000;

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [tabs, setTabs] = useState<TabState[]>(INITIAL_TABS);
  // '' = nenhuma aba em foco — estado válido agora que o boot pode nascer
  // sem nenhuma aba (decisão A, ver comentário de `INITIAL_TABS`); mesmo
  // sentinela que `closeTabImmediately` já usava pro caso "fechou a última
  // aba restante" (`remaining[0]` undefined -> `''`), reaproveitado aqui em
  // vez de introduzir um segundo significado pra "sem aba".
  const [activeTabId, setActiveTabId] = useState('');
  // "Herdado da seleção da sidebar" (ui-spec §4) — default do campo
  // Projeto-alvo do Launcher; segue o último projeto aberto pela sidebar.
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | undefined>(undefined);
  const [lastLaunch, setLastLaunch] = useState<LastLaunch | null>(null);
  // FIX (feedback E2E rodada 3 — "painel lateral 'Lançar sessão' fixo rouba
  // espaço e não parece produtivo") — o painel do Launcher deixa de ser
  // fixo: fechado por default (espaço vai pro terminal, ver
  // `styles.bodyPanelClosed`), abre só sob demanda (item "Sessão Claude" do
  // menu do "＋ Nova sessão", ver SplitButton abaixo), fecha ao lançar
  // (`handleLaunch`) ou Esc (efeito dedicado mais abaixo). O corpo do "＋
  // Nova sessão" CONTINUA lançando direto com a última config (T010,
  // `handleQuickNewClaudeSession`) sem depender do painel — isso não muda
  // (CA-1/smoke `profiles.spec.ts` já cobrem esse caminho).
  const [launcherOpen, setLauncherOpen] = useState(false);
  // Teste manual 27/07 — colapso das laterais pra focar no terminal: sidebar
  // (projetos/porta de entrada) e, no Modo Dev, o mapa da direita. Estado de
  // UI puro (não persiste no config de propósito).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // CA-26 (009-modo-dev-v3) — índice de origem do arraste em andamento na
  // barra de abas; `null` fora de um arraste. Estado de UI puro (mesmo
  // espírito de `sidebarCollapsed` acima), a reordenação de verdade é
  // `reorderTabs` (src/shared/tabAppearance.ts).
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  // T015 — ConfigStore (FR-007): roots/notificação/defaults do launcher.
  // `null` até `window.donel.config.get()` resolver no boot (mesmo padrão de
  // `projects`/`loadingProjects` acima) — os consumidores abaixo caem em
  // fallbacks locais enquanto isso.
  const [appConfig, setAppConfig] = useState<AppConfigDto | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // T056 (014-chat) — `chat.enabled` só vale depois de reiniciar o app (os
  // handlers do chat só existem no main se estava ligado no boot): a UI usa o
  // valor LIDO NA ABERTURA, nunca o que o interruptor das Preferências acabou de
  // gravar. `null` até a config chegar (= chat desligado, o app de sempre).
  const [chatEnabledAtLaunch, setChatEnabledAtLaunch] = useState<boolean | null>(null);
  const chatEnabled = chatEnabledAtLaunch === true;
  // ptyId mais recente de cada aba (o chat se liga por ele; sobrevive à saída do processo).
  const [chatPtyIds, setChatPtyIds] = useState<Record<string, string>>({});
  // Aba cujo processo saiu (FR-034): alimenta a barra "Sessão encerrada" do chat.
  const [tabExits, setTabExits] = useState<Record<string, { exitCode: number | null }>>({});
  // Sessões remotas — ptyIds whose ssh dropped while the session lives on the place ("sem ligação"; main/remote-link.ts).
  const [linkLostPtys, setLinkLostPtys] = useState<Record<string, true>>({});
  useEffect(
    () =>
      window.donel.pty.onLink?.((ptyId, linked) => {
        setLinkLostPtys((prev) => (linked ? omitKey(prev, ptyId) : prev[ptyId] ? prev : { ...prev, [ptyId]: true }));
      }),
    [],
  );
  const tabLinkLost = (tabId: string): boolean => {
    const ptyId = chatPtyIds[tabId];
    return tabExits[tabId] === undefined && ptyId !== undefined && linkLostPtys[ptyId] === true;
  };
  const tabIdCounter = useRef(0);
  // T1221 (011-contas-e-provedores, etapa 2) — `AccountsPanel` substitui o
  // `ProfileSwitcher` (dropdown de perfis) como fonte da statusbar/badge:
  // este estado é a MESMA leitura que `AccountsPanel` já faz
  // (`window.donel.accounts.list()`/`onChanged`), só que também precisa
  // estar disponível aqui pro rótulo global de fallback e pra cota (uma
  // unidade só, C25) da conta em foco.
  const [accountsView, setAccountsView] = useState<AccountsViewDto>({
    mod: null,
    state: 'inert',
    unavailableReason: null,
    accounts: [],
    activeAccountId: null,
    autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 },
    lastReadAt: null,
    // 011-contas-e-provedores, etapa 3, Fase 2 (D5) — campos novos da view;
    // o consumo deles na statusbar é do Bloco 2 (fora do escopo deste bloco).
    autoSwitchState: 'idle',
    lastAutoSwitch: null,
    lastSwitchOverwritten: null,
    remotes: [],
  });
  // T009 — estado do semáforo por aba (chave = tab.id), alimentado pelo
  // callback que cada TerminalPane levanta via onStateChange.
  const [semaphoreStates, setSemaphoreStates] = useState<Record<string, SemaphoreStateInfo>>({});
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // T412 (004) — a assinatura do evento de transcript é ÚNICA e montada uma vez
  // só; sem esta ref ela leria o `appConfig` do primeiro render pra sempre.
  const appConfigRef = useRef(appConfig);
  appConfigRef.current = appConfig;
  // Oráculo no centro (owner, 06/11) — the center of "Uso geral" shows the Oráculo, and the terminals are one click
  // away. Applied here at once and remembered by the main (`layout`, config.json). `revealTerminals` is what every
  // gesture of the owner that brings a session to the front calls (tab, sidebar, notification, Jobu, new session):
  // he asked for that session, so it shows. It reads a ref, so the listeners registered once can call it.
  const layoutPrefs: LayoutPrefs = appConfig?.layout ?? DEFAULT_LAYOUT_PREFS;
  const layoutPrefsRef = useRef(layoutPrefs);
  layoutPrefsRef.current = layoutPrefs;
  const changeLayoutPrefs = (patch: Partial<LayoutPrefs>): void => {
    setAppConfig((prev) => (prev ? { ...prev, layout: { ...prev.layout, ...patch } } : prev));
    void window.donel.config.setLayoutPrefs(patch).then(setAppConfig).catch(() => undefined);
  };
  const revealTerminals = (): void => {
    if (showsOracle(layoutPrefsRef.current)) changeLayoutPrefs({ centerView: 'terminals' });
  };
  /** Ctrl+Shift+O — Oráculo ⇄ Terminais; `false` where the switch does not exist (old layout, Modo Dev). Set below. */
  const toggleCenterViewRef = useRef<() => boolean>(() => false);
  /** The owner brings a session to the front: activate it and, in the Oráculo, show the terminals. */
  const focusTab = (tabId: string): void => {
    setActiveTabId(tabId);
    revealTerminals();
  };
  // T707 (007) — mesma razão da ref acima: a assinatura de onTranscriptChanged
  // (gatilho 3 da visita, deps vazias) precisa do `tabs` ATUAL pra achar o cwd
  // da sessão que mudou, não o do primeiro render.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // T707 — debounce de ~10s POR SESSÃO (chave = claudeSessionId): última
  // gravação (epoch ms) + o que foi gravado, pra `shouldRecordVisit` decidir
  // sem reler o ConfigStore inteiro a cada turn.
  const visitWriteStateRef = useRef<Record<string, { lastWriteMs: number; label: string; projectPath: string }>>({});
  // T010 — FR-006: "aba ativa" (processo vivo) por tab.id, alimentado por
  // `onAliveChange` (TerminalPane.tsx). Decide se fechar a aba pede
  // confirmação (true) ou fecha direto (false/ausente — connecting sem PTY
  // ainda, ou já 'ended'/'claude-not-found').
  const [aliveTabs, setAliveTabs] = useState<Record<string, boolean>>({});
  /** 07/11 — why a tab's terminal never started (read by the board's `startTrouble`). */
  const startFailuresRef = useRef<Record<string, string>>({});
  // Líder único na VPS — per new Líder tab of a move, what ends the wait for it (its start failed or its process left).
  const liderTabDiedRef = useRef<Record<string, () => void>>({});
  // FIX (feedback E2E rodada 5) — epoch ms de quando cada aba ficou `alive`
  // pela ÚLTIMA vez (ref, não state — só alimenta o diagnóstico abaixo,
  // nunca o gate real de injeção). Usado por `possiblyBlockedOnPrompt` pra
  // saber "há quanto tempo esta sessão está viva sem NENHUM evento de hook
  // ainda" (ex.: diálogo de confiança de pasta bloqueando o CLI antes do
  // REPL — TerminalPane.tsx). Limpo em `closeTabImmediately` (mesmo padrão
  // de `semaphoreStates`/`aliveTabs`).
  const aliveSinceRef = useRef<Record<string, number>>({});
  // FIX (feedback E2E rodada 5) — perfil de NASCIMENTO de cada aba claude
  // (chave = tab.id), alimentado por `TerminalPane.onProfileResolved` uma
  // única vez por sessão (`PtyCreateResult.profile`, main/index.ts). Nunca
  // reescrito depois — trocar o perfil ATIVO global (ProfileSwitcher,
  // `accountLabel` abaixo) não deve alterar o que já está aqui (FR-005:
  // "afeta só sessões novas"). `undefined` = aba 'shell' OU ainda não
  // resolvido (`computeSessionAccountLabel` decide o rótulo pros dois
  // casos). Limpo em `closeTabImmediately` (mesmo padrão de `sessionModelEffort`).
  const [sessionAccounts, setSessionAccounts] = useState<Record<string, { id: string; label: string } | undefined>>({});
  // T010 — aba com fechamento pendente de confirmação (modal "Fechar sessão?", ui-spec §2); null = nenhum modal aberto.
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  // T011 — modelo/esforço "atual" de cada aba claude (chave = tab.id), pro
  // controle da toolbar (SessionDetails) mostrar o valor certo pré-selecionado
  // e refletir a troca depois de uma injeção bem-sucedida. Semeado no
  // `addTab` (parseModelEffortFromArgs do launchArgs, se houver, senão os
  // defaults do Brief 3) — nunca undefined pra uma aba 'claude' já criada.
  // FIX (decisão A, 2026-07-23) — `INITIAL_TABS` nasce vazio agora (nenhuma
  // aba 'default' fora do `addTab`), então não há mais nenhum seed pra fazer
  // aqui: toda aba 'claude' passa por `addTab`, que já cuida disso sozinho.
  const [sessionModelEffort, setSessionModelEffort] = useState<Record<string, { model: ModelAlias; effort: EffortLevel }>>({});
  // T011 — handle imperativo de cada TerminalPane viva (ver TerminalPaneHandle):
  // ref callback comum, não state (não precisa re-render quando muda; o
  // próprio React já nula a entrada no unmount da aba).
  const terminalRefs = useRef<Record<string, TerminalPaneHandle | null>>({});
  // T610 (006) — tokens de contexto do último turn, chaveados por
  // **`sessionId`** (não `tab.id`): o watcher do main cobre TODA aba `claude`
  // viva, não existe "aba observada", e a mesma sessão retomada pode aparecer em
  // mais de uma aba — as duas mostram o mesmo número sem estado duplicado.
  // Preenchido pela assinatura ÚNICA de `onTranscriptChanged` (a mesma da 004,
  // logo abaixo); `undefined`/`null` = sem leitura ainda → a toolbar mostra `—`
  // (CA-4), nunca `0%`.
  const [contextTokens, setContextTokens] = useState<Record<string, number | null>>({});
  // Issue #21 — id do modelo da última resposta do assistente, mesmo evento e
  // mesma chave (`sessionId`) do `contextTokens` acima. É o modelo que a sessão
  // usa DE FATO (segue um `/model` digitado no CLI); sem entrada, o rodapé usa
  // o modelo do launch (`sessionModelEffort`) como ponto de partida.
  const [sessionModels, setSessionModels] = useState<Record<string, string | null>>({});
  // Ponte da statusline — última leitura oficial do CLI de cada aba, por ptyId
  // (main → renderer, `statusline:changed`). Sem a ponte na sessão, fica vazio.
  const [statusLines, setStatusLines] = useState<Record<string, StatusLineSnapshot>>({});
  // Quando a conta ativa trocou pela última vez (epoch ms): cota lida antes disso é da conta anterior.
  const lastAccountSwitchAtRef = useRef(0);
  const lastActiveAccountIdRef = useRef<string | null | undefined>(undefined);

  // T013 — PARTE PRINCIPAL (FR-004, CA-2): projeto cujo painel "Sessões
  // anteriores" está aberto (null = painel fechado); dispara o fetch via
  // `window.donel.sessions.list` no useEffect abaixo. Gatilho é um ícone
  // dedicado por linha da sidebar (ProjectSidebar `onShowPreviousSessions`),
  // não o clique no NOME do projeto — esse clique já tem um significado
  // fixo e testado (T007 smoke: abre uma sessão claude NOVA direto,
  // `handleOpenProject` abaixo) que este painel não pode sobrescrever.
  const [previousSessionsProject, setPreviousSessionsProject] = useState<ProjectInfo | null>(null);
  const [previousSessions, setPreviousSessions] = useState<SessionSummaryDto[]>([]);
  const [loadingPreviousSessions, setLoadingPreviousSessions] = useState(false);

  // === 003-modo-dev (Batch B) — estado da UI do Modo Dev ===================
  // Nada aqui é PERSISTIDO: o estado próprio do app (discoveries, foco,
  // arquivadas, defaults) vive no ConfigStore via `devMode:*` (CA-21). O que
  // está abaixo é só estado de TELA (modo ligado, o que está expandido, o
  // comando armado) — some no restart, e deve mesmo.
  // Mindscape V1 — the mode selector has three values. Hill climbing took the place of the Modo Dev (05/11):
  // only the left bar's look stayed; the right bar and the old flow left.
  const [appMode, setAppMode] = useState<'geral' | 'hill' | 'mindscape'>('geral');
  const hillOn = appMode === 'hill';
  const hillClimb = useHillClimb();
  const mindscape = useMindscapeDoc();
  /**
   * Spec 010 / B6 — o mapa é PROJEÇÃO do store: o snapshot chega pronto do main
   * (macro etapa já derivada, D-13) e é empurrado a cada mudança. O renderer
   * nunca lê disco nem calcula etapa.
   */
  const [esteiraState, setEsteiraState] = useState<EsteiraSnapshotDto | null>(null);
  /** D4 — Toast informativo (o que o gesto fez, por que foi recusado); nunca tem desfazer. */
  const [devModeToast, setDevModeToast] = useState<string | null>(null);
  /** B36 — tabs whose new session did not confirm it got the handoff (until the owner dismisses it). */
  const [renewalDeliveryNotices, setRenewalDeliveryNotices] = useState<Record<string, string>>({});
  // "Isolar em worktree" — a aba fechou e a worktree ficou por ter trabalho não enviado: aviso discreto com "Abrir pasta".
  const [worktreeKept, setWorktreeKept] = useState<WorktreeKeptPayload | null>(null);
  /** Cleanup do watcher de prontidão em voo por aba (mesmo padrão de `pendingInjectionWatchersRef`). */
  const armWatchersRef = useRef<Record<string, (() => void) | undefined>>({});
  /**
   * Spec 010 / batch B1 — `tab.id` → id da sessão da esteira que aquela aba
   * está tocando. É por este mapa que dois fatos voltam ao histórico: a sessão
   * ASSUMIDA (quando o CLI devolve o id) e a sessão ENCERRADA (quando a aba
   * fecha sem a fase concluir). Sem ele, a aba fechada deixaria o card travado
   * com uma trava sem dono — a trava órfã da evidência 3 da spec.
   */
  const esteiraTabSessionsRef = useRef<Record<string, string | undefined>>({});
  const semaphoreStatesRef = useRef<Record<string, SemaphoreStateInfo>>({});
  semaphoreStatesRef.current = semaphoreStates;
  /** Mesma razão de `appConfigRef`/`tabsRef`: a assinatura de `onPhaseArchived` tem deps vazias e precisa do valor ATUAL. */
  const sessionAccountsRef = useRef<Record<string, { id: string; label: string } | undefined>>({});
  sessionAccountsRef.current = sessionAccounts;

  // Peso do renderer (08/11) — the bridge repeats the same state on every hook of a working session; an equal
  // state keeps the record, so the whole app does not render again for nothing.
  const handleSemaphoreChange = useCallback((tabId: string, info: SemaphoreStateInfo): void => {
    setSemaphoreStates((prev) => (sameSemaphoreInfo(prev[tabId], info) ? prev : { ...prev, [tabId]: info }));
  }, []);

  const handleAliveChange = useCallback((tabId: string, alive: boolean): void => {
    // FIX (feedback E2E rodada 5) — marca/limpa o instante em que a aba
    // ficou viva, pro diagnóstico `possiblyBlockedOnPrompt` abaixo (ver
    // `aliveSinceRef` acima). `if (alive)` sem checar valor anterior: uma
    // aba só transiciona pra `alive` a partir de 'connecting'/'ended', nunca
    // de 'running' pra 'running' de novo sem passar por um novo `spawnSession`
    // (TerminalPane useEffect [status.kind]), então não há risco de
    // sobrescrever um timestamp mais antigo com um mais novo indevidamente.
    if (alive) {
      aliveSinceRef.current[tabId] = Date.now();
    } else {
      delete aliveSinceRef.current[tabId];
    }
    setAliveTabs((prev) => (prev[tabId] === alive ? prev : { ...prev, [tabId]: alive }));
  }, []);

  // FIX (feedback E2E rodada 5) — grava o perfil de NASCIMENTO da aba uma
  // única vez (TerminalPane chama isto só uma vez por `spawnSession`, ver
  // comentário do prop) — nunca sobrescrito por uma troca de perfil ATIVO
  // global depois (isso é `accountLabel`/ProfileSwitcher, estado separado).
  const handleAccountResolved = useCallback((tabId: string, account: { id: string; label: string } | undefined): void => {
    setSessionAccounts((prev) => ({ ...prev, [tabId]: account }));
  }, []);

  // T1232 (011-contas-e-provedores, etapa 2, achado da regressão final) —
  // ANTES este efeito abria a SUA PRÓPRIA assinatura de
  // `window.donel.accounts.list()`/`onChanged`, duplicando a que
  // `AccountsPanel` já mantém — dois round-trips de IPC no boot estouraram
  // a cerca de regressão do CA-7 (250 ms → ~330 ms medidos). Agora
  // `AccountsPanel` reporta a mesma leitura pra cima via `onViewChange`
  // (prop nova), uma assinatura só, no lugar de duas.
  const handleAccountsViewChange = useCallback((view: AccountsViewDto): void => {
    setAccountsView(view);
  }, []);

  /**
   * T707 (007-favoritos-sessoes) — grava uma visita no registro (D9: "mantenha
   * registro durante o trabalho") quando `shouldRecordVisit` decidir que vale a
   * pena. `label`/`projectPath` já vêm resolvidos pelo chamador (`resolveTabName`/
   * `resolveSessionName`) — esta função só decide SE grava e faz o IPC. É o
   * ÚNICO escritor do registro (plan.md §Fatia 2) — o main só valida o payload.
   */
  const maybeRegisterVisit = useCallback((sessionId: string, projectPath: string, label: string): void => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return;

    const nowMs = Date.now();
    const previousWrite = visitWriteStateRef.current[sessionId];
    const shouldWrite = shouldRecordVisit({
      lastWriteMs: previousWrite?.lastWriteMs,
      nowMs,
      previous: previousWrite ? { label: previousWrite.label, projectPath: previousWrite.projectPath } : null,
      next: { label: trimmedLabel, projectPath },
    });
    if (!shouldWrite) return;

    visitWriteStateRef.current[sessionId] = { lastWriteMs: nowMs, label: trimmedLabel, projectPath };
    void window.donel.sessions.registerVisit(sessionId, projectPath, trimmedLabel).then(setAppConfig).catch(() => undefined);
  }, []);

  // T708/CA-8 — semeadura única por projeto: `seedAttemptedRef` garante UMA
  // tentativa por projeto NESTA sessão do app, mesmo que `indexProjectSessions`
  // devolva `[]` de novo (projeto genuinamente sem sessão nenhuma) — sem isso,
  // o efeito abaixo tentaria de novo a cada render enquanto o registro
  // continuasse vazio. `seedingProjects` é só o estado de "carregando" da linha.
  const seedAttemptedRef = useRef<Set<string>>(new Set());
  const [seedingProjects, setSeedingProjects] = useState<ReadonlySet<string>>(new Set());

  const maybeSeedFavoriteProject = useCallback((projectPath: string): void => {
    if (seedAttemptedRef.current.has(projectPath)) return;
    seedAttemptedRef.current.add(projectPath);
    setSeedingProjects((prev) => new Set(prev).add(projectPath));
    void window.donel.sessions
      .seedProject(projectPath)
      .then(setAppConfig)
      .catch(() => undefined)
      .finally(() => {
        setSeedingProjects((prev) => {
          if (!prev.has(projectPath)) return prev;
          const next = new Set(prev);
          next.delete(projectPath);
          return next;
        });
      });
  }, []);

  // T708/CA-8 — dispara a semeadura pra todo projeto favoritado EXPANDIDO que
  // ainda não tem nenhuma entrada no registro (guarda dura real vive no main,
  // ver session-seed.ts — este efeito só evita a chamada óbvia).
  useEffect(() => {
    if (!appConfig) return;
    const collapsedSet = new Set(appConfig.collapsedFavorites);
    for (const project of projects) {
      if (!project.favorite || collapsedSet.has(project.path)) continue;
      const hasEntry = Object.values(appConfig.sessionRegistry).some((entry) => entry.projectPath === project.path);
      if (!hasEntry) maybeSeedFavoriteProject(project.path);
    }
  }, [projects, appConfig, maybeSeedFavoriteProject]);

  /** Cria uma aba nova, foca ela e devolve o id — usado por todo caminho de criação (sidebar, Launcher, "＋ Nova sessão", Terminal). */
  const addTab = (partial: Omit<TabState, 'id'>, focus = true): string => {
    tabIdCounter.current += 1;
    const id = `tab-${tabIdCounter.current}`;
    setTabs((prev) => [...prev, { id, ...partial }]);
    // Quadro por MCP — a session opened by another session does not take the owner's focus.
    if (focus) focusTab(id);
    // T011 — semeia o valor inicial da toolbar de Modelo/Esforço só pra
    // abas claude (terminal livre não tem os dois campos): lê de volta
    // `launchArgs` (Launcher, T008) quando a aba nasceu configurada; sem
    // isso (ex.: clique direto na sidebar), cai nos defaults do Brief 3.
    if (partial.sessionType === 'claude') {
      // FIX (#21, e2e-30-07 onda 2) — sem `--model`/`--effort` no `launchArgs`
      // (aba nascida fora do Launcher: clique direto na sidebar, Retomar/Fork
      // de "Sessões anteriores", Reiniciar, ou fase da esteira no Modo Dev), o
      // fallback ERA o literal `DEFAULT_MODEL_ALIAS`/`DEFAULT_EFFORT_LEVEL`
      // ('fable'/'high', hardcoded) — a StatusBar acabava mostrando sempre o
      // mesmo valor fixo pra qualquer uma dessas abas, ignorando inclusive o
      // default que o PRÓPRIO usuário configurou no Launcher
      // (`appConfig.launcherDefaults`, persistido por T015). Cai agora no
      // default configurado; só na ausência de qualquer config (`appConfig`
      // ainda não carregou) usa o literal como último fallback.
      const parsed = parseModelEffortFromArgs(partial.launchArgs);
      setSessionModelEffort((prev) => ({
        ...prev,
        [id]: {
          model: parsed.model ?? appConfig?.launcherDefaults.model ?? DEFAULT_MODEL_ALIAS,
          effort: parsed.effort ?? appConfig?.launcherDefaults.effort ?? DEFAULT_EFFORT_LEVEL,
        },
      }));
    }
    return id;
  };

  // T010 — FR-006: fecha a aba de verdade (remove de `tabs`; o unmount do
  // TerminalPane cuida de matar o PTY + dispose do xterm, TerminalPane.tsx
  // `useEffect` cleanup). Se a aba fechada era a ativa, foca a vizinha
  // anterior (ou a próxima, se era a primeira); sem abas restantes, nenhuma
  // fica em foco.
  const closeTabImmediately = (tabId: string): void => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;
    // t-e753b554 — the place of this tab, if it does not come back, passes its live tasks on (read before it leaves).
    agentBridgeRef.current?.placeClosed(tabId);
    // Functional on purpose: "Fechar marcadas" (gargalos) closes several tabs in one render.
    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    if (activeTabId === tabId) {
      // A hidden session (opened by another one) never takes the focus: it would come back to the tab bar.
      const fallback = listedFallback(tabs, tabId);
      setActiveTabId(fallback ? fallback.id : '');
    }
    setSemaphoreStates((prev) => omitKey(prev, tabId));
    setAliveTabs((prev) => omitKey(prev, tabId));
    delete startFailuresRef.current[tabId];
    delete aliveSinceRef.current[tabId]; // FIX (feedback E2E rodada 5) — mesmo padrão de limpeza dos maps acima.
    setSessionAccounts((prev) => omitKey(prev, tabId)); // FIX (feedback E2E rodada 5) — idem.
    setSessionModelEffort((prev) => omitKey(prev, tabId));
    setChatPtyIds((prev) => omitKey(prev, tabId));
    setTabExits((prev) => omitKey(prev, tabId));
    delete terminalRefs.current[tabId];
    disposeTabSend(tabId); // 014/T065 — driver de envio e rascunho do chat morrem com a aba
    sessionRenewal.forget(tabId); // B36 — a renewal in flight dies with the tab
    // 003-modo-dev/T312 — nenhum watcher de prontidão sobrevive à aba que ele
    // vigiava (senão tentaria escrever num PTY que já não existe).
    armWatchersRef.current[tabId]?.();
    delete armWatchersRef.current[tabId];
    // Spec 010 / B1 — a aba era de uma fase da esteira: a sessão acabou. O main
    // encerra a sessão E solta a trava; se a fase já tinha concluído, o gesto
    // não grava nada (o reducer já a encerrou). Fechar a aba nunca pode deixar
    // o card preso num estado sem saída.
    const esteiraSessionId = esteiraTabSessionsRef.current[tabId];
    if (esteiraSessionId) {
      delete esteiraTabSessionsRef.current[tabId];
      void window.donel.esteira.endSession({ sessionId: esteiraSessionId, reason: 'tab-closed' }).catch(() => undefined);
    }
  };

  /**
   * 003-modo-dev/T315 — a assinatura de `devMode:phaseArchived` é montada uma
   * vez só (deps vazias) e precisa da versão ATUAL de `closeTabImmediately`
   * (que lê `tabs`/`activeTabId` do render corrente). Mesmo padrão de
   * `appConfigRef`/`tabsRef`.
   */
  /**
   * Gargalos do ambiente — "Fechar marcadas": the same close as `sessao_fechar` (the remote session ends with its tab),
   * for several tabs at once. When the tab in focus is among them, the focus goes to one that stays.
   */
  const handleMindscapeCloseSessions = (tabIds: readonly string[]): void => {
    const closing = new Set(tabIds);
    for (const tabId of tabIds) closeTabImmediately(tabId);
    if (closing.has(activeTabId)) setActiveTabId(tabs.find((tab) => !closing.has(tab.id) && (!tab.openedBySession || tab.shown))?.id ?? '');
  };

  const closeTabImmediatelyRef = useRef(closeTabImmediately);
  closeTabImmediatelyRef.current = closeTabImmediately;

  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — o painel iniciou um login
   * isolado: abre a aba `claude` cru no diretório efêmero do login (o main
   * resolve `cwd`/`CLAUDE_CONFIG_DIR` pelo `accountLoginId`, ver
   * `pty:create`). Sem `cwd` nem `launchArgs` de propósito — o main escolhe
   * o diretório, esta aba não é uma sessão de projeto.
   */
  const handleStartLogin = (loginId: string, label: string): void => {
    addTab({ name: `Login · ${label}`, pinned: false, sessionType: 'claude', accountLoginId: loginId });
  };

  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — o login isolado concluiu
   * (added/replaced/cancelled/failed): o main já matou o PTY sozinho (o
   * colhedor mata a aba antes de emitir o status), então só falta fechar a
   * aba na UI — sem confirmação (não há processo vivo esperando resposta).
   * `tabsRef` (não `tabs`): o `AccountsPanel` guarda esta função numa ref
   * própria (assinatura de `onLoginChanged` montada uma vez, mount-only), e
   * ler `tabs` do escopo do render aqui congelaria a lista no momento em que
   * aquela ref foi criada.
   */
  const handleLoginEnded = (loginId: string): void => {
    const tab = tabsRef.current.find((candidate) => candidate.accountLoginId === loginId);
    if (tab) closeTabImmediatelyRef.current(tab.id);
  };

  // T010 — FR-006: "se a sessão estiver ativa (processo vivo), pede
  // confirmação" — senão fecha direto (ex.: aba já em 'ended'/'claude-not-found').
  // Função simples (não useCallback) de propósito: lê `aliveTabs`/`tabs`/
  // `activeTabId` direto do escopo do render, mesmo padrão de
  // `handleOpenProject`/`handleLaunch` logo acima.
  const handleRequestCloseTab = (tabId: string): void => {
    // Só os Líderes nas abas — a live session opened by another one goes back to the Mindscape; it keeps running.
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (tab?.openedBySession && aliveTabs[tabId]) {
      setTabs((prev) => prev.map((candidate) => (candidate.id === tabId ? { ...candidate, shown: false } : candidate)));
      if (activeTabId === tabId) setActiveTabId(listedFallback(tabs, tabId)?.id ?? '');
      return;
    }
    if (aliveTabs[tabId]) {
      setPendingCloseTabId(tabId);
      return;
    }
    closeTabImmediately(tabId);
  };

  const handleConfirmCloseTab = (): void => {
    if (pendingCloseTabId) closeTabImmediately(pendingCloseTabId);
    setPendingCloseTabId(null);
  };

  const handleCancelCloseTab = (): void => {
    setPendingCloseTabId(null);
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingProjects(true);
    window.donel.projects
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        // Scan/config falhando não pode travar o shell — sidebar mostra a
        // seção "Projetos" vazia (mesmo texto do caso "nenhum projeto
        // encontrado"); T017 cobre o "Não verificado" de erro real de disco.
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // T1320 (011-contas-e-provedores, etapa 3) — registry de providers classe
  // A; `[]` (registry inerte, C14/D6) faz o Launcher renderizar sem o campo
  // "Provedor" — comportamento de hoje intocado. `refreshProviders` é
  // passado ao `ProviderForm` (titlebar) pra repor a lista depois de
  // criar/editar/remover uma entrada, sem duplicar a leitura aqui.
  const [providers, setProviders] = useState<readonly ProviderSummaryDto[]>([]);
  const refreshProviders = useCallback((): void => {
    void window.donel.providers.list().then(setProviders).catch(() => undefined);
  }, []);
  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  // T015 — carrega o ConfigStore uma vez no boot (roots/notificação/defaults
  // do launcher). Falha de IPC aqui não trava o shell (mesmo espírito do
  // catch de `projects.list` acima) — os consumidores seguem nos fallbacks
  // locais até uma próxima mutação bem-sucedida repor `appConfig`.
  useEffect(() => {
    let cancelled = false;
    window.donel.config
      .get()
      .then((config) => {
        if (cancelled) return;
        setAppConfig(config);
        setChatEnabledAtLaunch((previous) => previous ?? config.chat.enabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenProject = (project: ProjectInfo): void => {
    setSelectedProjectPath(project.path);
    const existing = tabs.find((tab) => tab.cwd === project.path);
    if (existing) {
      focusTab(existing.id);
      return;
    }
    addTab({ name: project.name, cwd: project.path, projectName: project.name, pinned: false, sessionType: 'claude' });
  };

  // T013 — PARTE PRINCIPAL (FR-004, CA-2, ui-spec §5): abre o painel
  // "Sessões anteriores" pro projeto clicado; o fetch de verdade acontece no
  // useEffect abaixo (dispara em CIMA de `previousSessionsProject`, não
  // duplicado aqui) — mesmo padrão do fetch de `projects` no useEffect de
  // boot logo acima.
  const handleShowPreviousSessions = (project: ProjectInfo): void => {
    setPreviousSessionsProject(project);
  };

  const handleClosePreviousSessions = (): void => {
    setPreviousSessionsProject(null);
  };

  useEffect(() => {
    if (!previousSessionsProject) {
      setPreviousSessions([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingPreviousSessions(true);
    window.donel.sessions
      .list(previousSessionsProject.path)
      .then((list) => {
        if (!cancelled) setPreviousSessions(list);
      })
      .catch(() => {
        // SessionIndexer (main) nunca lança pra caso normal (projeto sem
        // sessão vira `[]`) — um catch aqui só cobre uma falha de IPC de
        // verdade; o painel mostra o empty state em vez de travar (mesmo
        // espírito do catch de `projects.list` no boot).
        if (!cancelled) setPreviousSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreviousSessions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previousSessionsProject]);

  /**
   * B39 — Retomar (and fork) opens the conversation where it lives: a session born on a remote place resumes
   * there, without the owner choosing anything. When it is not here and a place does not answer, the app says
   * so and opens nothing (an empty session on this computer would hide where the conversation is).
   */
  const resumingRef = useRef(new Set<string>());
  /** `onFail` (t-1293c818, `sessao_retomar`): the caller hears why instead of the owner's toast. */
  const openWhereItLives = (sessionId: string, projectPath: string, open: (remote: { remoteId?: string }) => void, onFail?: (reason: string) => void): void => {
    if (resumingRef.current.has(sessionId)) {
      onFail?.('ela já está sendo retomada');
      return;
    }
    resumingRef.current.add(sessionId);
    // The answer from this disk is instant; a slower one means the app is asking the remote places by ssh
    // (up to 20 s each). Without a word the click looked dead.
    const places = accountsView.remotes.map((remote) => `«${remote.label}»`).join(' e ');
    const waiting = `Procurando a conversa em ${places || 'outro lugar'}… pode levar até 20 s.`;
    const waitingTimer = places ? window.setTimeout(() => setDevModeToast(waiting), 600) : null;
    void window.donel.sessions
      .whereLives(sessionId, projectPath)
      .then(
        (where) => {
          if (where.kind === 'unreachable') {
            const many = where.labels.length > 1;
            const names = where.labels.map((label) => `«${label}»`).join(' e ');
            const why = `a conversa não está neste computador, e ${many ? 'os lugares remotos' : 'o lugar remoto'} ${names} não ${many ? 'responderam' : 'respondeu'}`;
            if (onFail) onFail(why);
            else setDevModeToast(`Não consegui retomar: ${why}. Confira se está ligado e tente de novo.`);
            return;
          }
          open(where.kind === 'remote' ? { remoteId: where.remoteId } : {});
        },
        () => open({}),
      )
      .finally(() => {
        resumingRef.current.delete(sessionId);
        if (waitingTimer !== null) window.clearTimeout(waitingTimer);
        setDevModeToast((current) => (current === waiting ? null : current));
      });
  };

  // T013 — Retomar (ui-spec §5, primário): `-r <session-id>` via
  // CommandBuilder (já testado no T006/CommandBuilder.test.ts, tabela
  // FR-003) — CONTINUA a mesma sessão (mesmo id). Nome da aba vem do
  // preview (sessionTabName, shared/sessions.ts) — mais informativo que só
  // o uuid do arquivo.
  const handleResumeSession = (session: SessionSummaryDto): void => {
    if (!previousSessionsProject) return;
    const project = previousSessionsProject;
    const args = buildClaudeArgs({ continuation: { type: 'resume', sessionId: session.id } });
    setPreviousSessionsProject(null);
    openWhereItLives(session.id, project.path, (remote) => {
      addTab({
        name: sessionTabName(session),
        cwd: project.path,
        projectName: project.name,
        pinned: false,
        launchArgs: args,
        sessionType: 'claude',
        ...remote,
        // T403/T408 (004) — o `/rename` que esta sessão levou no CLI já veio no
        // índice; semeado aqui, `resolveSessionName` prefere ele ao preview (CA-1).
        customTitle: session.customTitle,
      });
      setSelectedProjectPath(project.path);
    });
  };

  // T013 — Fork (ui-spec §5, secundário, "nova sessão a partir desta"):
  // `-r <session-id> --fork-session` — confirmado em `claude --help` (flag
  // real: "When resuming, create a new session ID instead of reusing the
  // original (use with --resume or --continue)") — cria uma sessão com ID
  // NOVO a partir do histórico da original, que continua intacta.
  const handleForkSession = (session: SessionSummaryDto): void => {
    if (!previousSessionsProject) return;
    const project = previousSessionsProject;
    const args = buildClaudeArgs({ continuation: { type: 'fork', sessionId: session.id } });
    setPreviousSessionsProject(null);
    openWhereItLives(session.id, project.path, (remote) => {
      addTab({
        name: sessionTabName(session),
        cwd: project.path,
        projectName: project.name,
        pinned: false,
        launchArgs: args,
        sessionType: 'claude',
        ...remote,
        // T403/T408 (004) — o `/rename` que esta sessão levou no CLI já veio no
        // índice; semeado aqui, `resolveSessionName` prefere ele ao preview (CA-1).
        customTitle: session.customTitle,
      });
      setSelectedProjectPath(project.path);
    });
  };

  // T008 — Launcher (ui-spec §4, FR-003, CA-1): monta o argv via
  // buildClaudeArgs (CommandBuilder puro, T006) e abre uma aba NOVA (o
  // Launcher é lançamento configurado, distinto do clique direto no nome do
  // projeto acima, que reaproveita/foca uma aba existente com defaults).
  const handleLaunch = (options: LauncherLaunchOptions): void => {
    // T1317 (011-contas-e-provedores, etapa 3, C18/D7) — com provider classe
    // A selecionado, --model/--effort são omitidos do argv (o modelo vem do
    // env da entrada); buildClaudeArgs (commandBuilder.ts) continua intocado,
    // buildLauncherArgs só decide quais opções passar pra ela.
    // "Isolar em worktree" — nome curto (sessão ou data) que nenhuma aba aberta usa: o CLI reabriria a mesma worktree.
    const worktree = options.worktree
      ? worktreeNameFor(options.sessionName, new Date(), tabs.flatMap((tab) => worktreeNameFromArgs(tab.launchArgs) ?? []))
      : undefined;
    const args = buildLauncherArgs({
      providerId: options.providerId ?? undefined,
      model: options.model,
      effort: options.effort,
      permissionMode: options.permissionMode,
      sessionName: options.sessionName,
      worktree,
    });
    const name = options.sessionName || options.projectName;
    addTab({
      name,
      cwd: options.projectPath,
      projectName: options.projectName,
      pinned: false,
      launchArgs: args,
      sessionType: 'claude',
      providerId: options.providerId ?? undefined,
      ...(options.remoteId ? { remoteId: options.remoteId } : {}),
      // Item 12a — the role goes with the spawn; the place born from this conversation keeps it.
      ...(options.roleId ? { roleId: options.roleId } : {}),
    });
    setSelectedProjectPath(options.projectPath);
    setLastLaunch({ args, cwd: options.projectPath, name });
    // T015 (FR-007 "defaults do launcher") — cada lançamento configurado vira
    // o default do PRÓXIMO Launcher aberto (mesmo espírito de "lembra a
    // última config" que o corpo do "＋ Nova sessão" já tinha via
    // `lastLaunch` em memória — agora persistido, sobrevive a restart).
    void window.donel.config
      .setLauncherDefaults({
        model: options.model,
        effort: options.effort,
        permissionMode: options.permissionMode,
        ...(options.worktree ? { worktree: true } : {}),
        where: options.remoteId ?? 'local',
      })
      .then(setAppConfig)
      .catch(() => undefined);
    // FIX (feedback E2E rodada 3) — painel colapsável: "fecha ao lançar".
    setLauncherOpen(false);
  };

  // T010 — corpo do "＋ Nova sessão" (ui-spec §2, zona 1): "clique no corpo
  // abre direto com a última configuração de sessão Claude usada" (também o
  // item de menu "Sessão Claude" — mesma ação, dois gatilhos). Sem
  // lançamento anterior nesta sessão do app, cai pros defaults do Launcher
  // (sem args explícitos = CommandBuilder omite tudo, T006) no projeto
  // selecionado.
  //
  // FIX (auditoria rodada 6 ciclo 2, achado media "CTA do titlebar reproduz
  // o bug do empty state em 1 clique") — ANTES este era o handler "cru": sem
  // `lastLaunch` e sem `selectedProjectPath` (exatamente o estado de boot),
  // caía em `cwd: undefined` -> `pty-manager.ts` `options.cwd ??
  // os.homedir()` -> o "Quick safety check" preso, semáforo `undefined` pra
  // sempre. Só o CTA do empty state (`handleEmptyStateNewSession`, agora
  // removido) tinha o guard — o botão do titlebar, visível na MESMA tela e
  // fisicamente ao lado do empty state, continuava reproduzindo o defeito
  // original a um clique. Guard movido pra CÁ: os dois gatilhos (corpo do
  // "＋ Nova sessão" do titlebar E o CTA "Nova sessão" do empty state, que
  // agora chama esta mesma função) passam a abrir o Launcher quando não há
  // nenhum lançamento/projeto anterior, em vez de spawnar em home sem
  // confiança de pasta — um handler só, sem cenário travado alcançável por
  // nenhum caminho da UI. `terminal.spec.ts`/`profiles.spec.ts`/
  // `shell.spec.ts` foram atualizados pra escolher um projeto no Launcher
  // (não reproduzem mais o cenário "sessão em home sem projeto", que deixou
  // de ser alcançável de propósito).
  const handleQuickNewClaudeSession = (): void => {
    if (!lastLaunch && !selectedProjectPath) {
      setLauncherOpen(true);
      return;
    }
    if (lastLaunch) {
      addTab({
        name: lastLaunch.name,
        cwd: lastLaunch.cwd,
        projectName: projects.find((project) => project.path === lastLaunch.cwd)?.name,
        pinned: false,
        launchArgs: lastLaunch.args,
        sessionType: 'claude',
      });
      return;
    }
    const project = projects.find((candidate) => candidate.path === selectedProjectPath);
    addTab({
      name: project?.name ?? 'Nova sessão',
      cwd: selectedProjectPath,
      projectName: project?.name,
      pinned: false,
      sessionType: 'claude',
    });
  };

  // T010 — FR-008: aba de terminal comum (powershell.exe) no diretório do
  // projeto selecionado — item "Terminal" do menu do "＋ Nova sessão".
  const handleNewFreeTerminal = (): void => {
    const project = projects.find((candidate) => candidate.path === selectedProjectPath);
    addTab({ name: 'Terminal', cwd: selectedProjectPath, projectName: project?.name, pinned: false, sessionType: 'shell' });
  };

  // FIX (feedback E2E rodada 3 — "favoritar projeto só reflete após
  // reiniciar o app") — causa raiz: `listProjectsWithFavorites` (main)
  // refaz um `scanProjects` SÍNCRONO do filesystem a cada toggle (não só a
  // primeira vez); com vários repos sob os roots configurados, esse
  // round-trip pode não ser instantâneo o bastante pra parecer "reflete na
  // hora" — mesmo a lógica de merge/ordenação (`mergeFavorites`/
  // `sortProjects`) já estando correta e testada (não era bug de lógica).
  // Fix: atualiza `projects` OTIMISTICAMENTE aqui — mesma função
  // `sortProjects` que o main usa (agora compartilhada, `shared/projects.ts`)
  // — a estrela e a reordenação já aparecem no próprio clique, sem esperar
  // o IPC. `setProjects` no `.then()` continua reconciliando com a resposta
  // autoritativa do main (persistência real, `missing`/favoritos de outros
  // projetos que só o scan do main conhece).
  //
  // `favoriteRequestIdRef` — achado do PRÓPRIO smoke deste fix
  // (tests/smoke/sidebar-favorites.spec.ts, 2 cliques em sequência rápida:
  // favoritar → desfavoritar): sem isso, dois `setFavorite` em voo ao mesmo
  // tempo podem RESOLVER fora de ordem (o scan síncrono do main não garante
  // que quem foi chamado primeiro responde primeiro) — a resposta do
  // clique MAIS ANTIGO chegando DEPOIS da do mais recente sobrescrevia o
  // estado certo com um snapshot obsoleto. Só aplica `setProjects` da
  // resposta cujo id ainda é o mais recente disparado.
  const favoriteRequestIdRef = useRef(0);
  const handleToggleFavorite = (path: string, favorite: boolean): void => {
    setProjects((prev) => sortProjects(prev.map((project) => (project.path === path ? { ...project, favorite } : project))));
    const requestId = (favoriteRequestIdRef.current += 1);
    void window.donel.projects
      .setFavorite(path, favorite)
      .then((list) => {
        if (requestId !== favoriteRequestIdRef.current) return; // resposta obsoleta — um toggle mais novo já rodou depois deste
        setProjects(list);
      })
      .catch(() => undefined);
  };

  // T708 (007) — colapsar/expandir o grupo "Favoritos" de um projeto; estado
  // persiste (CA-1). Substitui a lista INTEIRA (mesmo padrão de `setFavorite`
  // acima) — poucos favoritos, sem necessidade de um canal incremental.
  const handleToggleFavoriteGroupCollapsed = (projectPath: string): void => {
    const current = new Set(appConfig?.collapsedFavorites ?? []);
    if (current.has(projectPath)) current.delete(projectPath);
    else current.add(projectPath);
    void window.donel.config.setCollapsedFavorites([...current]).then(setAppConfig).catch(() => undefined);
  };

  /**
   * T710 (007) — CA-4: clique numa linha do grupo "Favoritos". Se já existe
   * uma aba aberta com esse `claudeSessionId`, FOCA (nunca abre a mesma sessão
   * duas vezes); senão retoma pelo mesmo caminho de `handleResumeSession`
   * (`-r <id>`). Entrada que já sumiu do registro (órfã removida por outro
   * caminho) é no-op — nada a focar nem a retomar.
   */
  const handleFocusOrResumeFavoriteSession = (sessionId: string): void => {
    const existingTab = tabs.find((tab) => tab.claudeSessionId === sessionId);
    if (existingTab) {
      focusTab(existingTab.id);
      return;
    }

    const entry = appConfig?.sessionRegistry[sessionId];
    if (!entry) return;

    const project = projects.find((candidate) => candidate.path === entry.projectPath);
    const args = buildClaudeArgs({ continuation: { type: 'resume', sessionId } });
    openWhereItLives(sessionId, entry.projectPath, (remote) => {
      addTab({
        name: entry.label,
        cwd: entry.projectPath,
        projectName: project?.name,
        pinned: false,
        launchArgs: args,
        sessionType: 'claude',
        ...remote,
        customTitle: null,
      });
      setSelectedProjectPath(entry.projectPath);
    });
  };

  /**
   * T710 (007) — CA-11, **2º momento**: "perceber" que a sessão sumiu quando uma
   * tentativa de RETOMAR aquela sessão falha.
   *
   * O sinal é o exit code, não o texto do CLI — medido contra o binário real em
   * `specs/008-fechar-pendencias/medicao-t710.md`: no PTY, `claude -r <uuid
   * inexistente>` sai com código 1 em ~8,5–10,4 s, enquanto sessão válida e
   * sessão nova seguem vivas. A decisão vive em `shared/resumeFailure.ts`
   * (puro, testado), e a PROVA antes de apagar é do main: ele confere o `.jsonl`
   * e só remove se não existir (`sessions:forgetIfOrphan`) — por isso um exit
   * != 0 de outra origem (cota, `claude` não encontrado, Ctrl+C precoce) não
   * apaga nada. Sem aviso na tela, como o CA-11 pede.
   */
  const handleTabProcessExit = (tab: TabState, info: { exitCode: number | undefined; msSinceSpawn: number }): void => {
    liderTabDiedRef.current[tab.id]?.(); // Líder único na VPS — the new Líder of a move died: the old one stays
    // T057 (014-chat, FR-034) — a barra "Sessão encerrada (código N)" do chat.
    setTabExits((prev) => ({ ...prev, [tab.id]: { exitCode: info.exitCode ?? null } }));
    // Dono, 12/11 (t-5c0df1df): its live tasks pass on as from a closed tab. Only on the PC: a remote tab's PTY is the
    // ssh, which drops when the notebook sleeps while the CLI keeps working in the place's tmux.
    if (!tab.remoteId) agentBridgeRef.current?.placeExited(tab.id);
    // Spec 010 / B1 — o processo da sessão morreu (saiu sozinho, ou foi morto).
    // A aba pode continuar na tela, mas a SESSÃO acabou: deixar o card dizendo
    // "em andamento" com nada rodando é a mesma inverdade que fechar a aba
    // produziria. Se a fase já tinha concluído, o gesto não grava nada.
    const esteiraSessionId = esteiraTabSessionsRef.current[tab.id];
    if (esteiraSessionId) {
      delete esteiraTabSessionsRef.current[tab.id];
      void window.donel.esteira.endSession({ sessionId: esteiraSessionId, reason: 'process-exit' }).catch(() => undefined);
    }

    const resumedSessionId = resumedSessionIdFromArgs(tab.launchArgs);
    if (!resumedSessionId) return; // sessão nova nunca é candidata
    if (!shouldForgetOnResumeFailure({ resumedSessionId, exitCode: info.exitCode, msSinceSpawn: info.msSinceSpawn })) return;
    void window.donel.sessions
      .forgetIfOrphan(resumedSessionId)
      .then(setAppConfig)
      .catch(() => undefined);
  };

  /**
   * T710/C2 (007) — CA-5: UM gesto de pin na linha do grupo. Persiste no
   * registro (`sessions:setPinned`) E, se a sessão tem aba aberta agora,
   * também atualiza `TabState.pinned` — é o que continua alimentando
   * `sortSessions`/o desempate da lista geral (comportamento de hoje
   * preservado, C2: "nada de dois pins parecidos").
   */
  const handleToggleFavoriteSessionPinned = (sessionId: string): void => {
    const entry = appConfig?.sessionRegistry[sessionId];
    const nextPinned = !(entry?.pinned ?? false);
    void window.donel.sessions.setPinned(sessionId, nextPinned).then(setAppConfig).catch(() => undefined);

    const openTab = tabs.find((tab) => tab.claudeSessionId === sessionId);
    if (openTab) updateTab(openTab.id, { pinned: nextPinned });
  };

  // T015 — UI de Preferências (FR-007, feedback E2E rodada 3 "roots
  // configuráveis"): substitui a lista INTEIRA de roots no ConfigStore
  // (main/index.ts `sanitizeProjectRoots` descarta vazio/duplicata) e
  // refaz o scan de projetos em seguida — "re-scan imediato" pedido pelo
  // feedback, sem esperar um restart.
  const refreshProjectsAfterRootsChange = (): void => {
    void window.donel.projects.list().then(setProjects).catch(() => undefined);
  };

  const handleAddProjectRoot = (root: string): void => {
    const currentRoots = appConfig?.projectRoots ?? [];
    void window.donel.config
      .setProjectRoots([...currentRoots, root])
      .then((config) => {
        setAppConfig(config);
        refreshProjectsAfterRootsChange();
      })
      .catch(() => undefined);
  };

  const handleRemoveProjectRoot = (root: string): void => {
    const currentRoots = appConfig?.projectRoots ?? [];
    void window.donel.config
      .setProjectRoots(currentRoots.filter((existing) => existing !== root))
      .then((config) => {
        setAppConfig(config);
        refreshProjectsAfterRootsChange();
      })
      .catch(() => undefined);
  };

  // FIX (feedback E2E rodada 4, batch 3 achado "notificar toda transição
  // vira spam") — preferência configurável (all/permission-only/none),
  // aplicada pelo efeito de notificação mais abaixo.
  const handleChangeNotificationPreference = (preference: NotificationPreference): void => {
    void window.donel.config.setNotificationPreference(preference).then(setAppConfig).catch(() => undefined);
  };

  // T056 (014-chat) — interruptor "Chat (experimental)" (vale após reiniciar) e Modo Foco (vale já).
  const handleChangeChatEnabled = (enabled: boolean): void => {
    void window.donel.config.setChatPrefs({ enabled }).then(setAppConfig).catch(() => undefined);
  };

  const handleChangeFocusMode = (focusMode: boolean): void => {
    void window.donel.config.setChatPrefs({ focusMode }).then(setAppConfig).catch(() => undefined);
  };

  // T022 (015-jobu-pet) — "Jobu na área de trabalho" switch: turns the pet window on/off at once, without a restart.
  const handleChangePetEnabled = (enabled: boolean): void => {
    void window.donel.config.setPetPrefs({ enabled }).then(setAppConfig).catch(() => undefined);
  };

  /** T056 — troca a vista da aba (Chat | Terminal). A sessão e o PTY seguem os mesmos; só muda o que se vê. */
  const setTabView = (tabId: string, view: ChatViewMode): void => {
    updateTab(tabId, { view });
    if (view === 'terminal') {
      // O terminal volta a ter layout no próximo frame; só então aceita o foco.
      requestAnimationFrame(() => terminalRefs.current[tabId]?.focus());
    }
  };

  /** Ctrl+` — alterna a vista da aba ativa. Devolve se tratou (aba sem vista de chat deixa a tecla passar). */
  const toggleActiveTabView = (): boolean => {
    const tab = tabsRef.current.find((candidate) => candidate.id === activeTabIdRef.current);
    if (!tab || !hasChatView(tab, chatEnabled)) return false;
    setTabView(tab.id, nextTabView(effectiveTabView(tab, chatEnabled)));
    return true;
  };
  const toggleActiveTabViewRef = useRef(toggleActiveTabView);
  toggleActiveTabViewRef.current = toggleActiveTabView;

  // Modo YOLO — a aba responde pelas pastas que o main olha (`projects:tabFolders`): assim a marca, o botão e a
  // ponte nunca discordam, inclusive numa worktree fora da pasta do projeto.
  const [tabFoldersByCwd, setTabFoldersByCwd] = useState<Readonly<Record<string, readonly string[]>>>({});
  useEffect(() => {
    for (const tab of tabs) {
      const { cwd } = tab;
      if (tab.sessionType !== 'claude' || !cwd || tabFoldersByCwd[cwd]) continue;
      void window.donel.projects
        .tabFolders(cwd)
        .then((folders) => setTabFoldersByCwd((prev) => ({ ...prev, [cwd]: folders })))
        .catch(() => undefined);
    }
  }, [tabs, tabFoldersByCwd]);
  const yoloProjects = appConfig?.yolo.projects ?? [];
  const projectPaths = useMemo(() => projects.map((project) => project.path), [projects]);
  const foldersOfTab = (tab: TabState): readonly string[] => (tab.cwd ? (tabFoldersByCwd[tab.cwd] ?? [tab.cwd]) : []);
  const isTabYolo = (tab: TabState): boolean => projectOfFolders(foldersOfTab(tab), yoloProjects) !== null;
  const projectOfTab = (tab: TabState): string | null => projectOfFolders(foldersOfTab(tab), projectPaths);

  // O objeto é ESTÁVEL (ChatView é memoizado: o App re-renderiza a cada tique do semáforo);
  // o que muda a cada render fica atrás de `chatActionsRef`.
  const chatActionsRef = useRef<ChatViewActions>({
    openTerminal: () => undefined,
    resume: () => undefined,
    closeTab: () => undefined,
    openPreviousSessions: () => undefined,
    turnOnYolo: () => Promise.resolve(),
    terminal: () => null,
  });
  chatActionsRef.current = {
    terminal: (tabId) => terminalRefs.current[tabId] ?? null,
    openTerminal: (tabId) => setTabView(tabId, 'terminal'),
    // FR-034 — retoma a MESMA conversa (a atual da aba, mesmo após /clear ou /resume).
    resume: (tabId) => {
      const sessionId = tabsRef.current.find((candidate) => candidate.id === tabId)?.claudeSessionId;
      terminalRefs.current[tabId]?.respawn(sessionId ? { resume: sessionId } : undefined);
    },
    closeTab: (tabId) => handleRequestCloseTab(tabId),
    openPreviousSessions: (tabId) => {
      const cwd = tabsRef.current.find((candidate) => candidate.id === tabId)?.cwd;
      const project = projects.find((candidate) => candidate.path === cwd);
      if (project) handleShowPreviousSessions(project);
    },
    turnOnYolo: (tabId) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      const project = tab ? projectOfTab(tab) : null;
      if (project === null) return Promise.resolve();
      return window.donel.config.setProjectYolo(project, true).then(setAppConfig);
    },
  };
  const chatActions = useMemo<ChatViewActions>(
    () => ({
      openTerminal: (tabId) => chatActionsRef.current.openTerminal(tabId),
      resume: (tabId) => chatActionsRef.current.resume(tabId),
      closeTab: (tabId) => chatActionsRef.current.closeTab(tabId),
      openPreviousSessions: (tabId) => chatActionsRef.current.openPreviousSessions(tabId),
      turnOnYolo: (tabId) => chatActionsRef.current.turnOnYolo(tabId),
      terminal: (tabId) => chatActionsRef.current.terminal(tabId),
    }),
    [],
  );

  // FIX ambiente genérico (28/07) — troca do critério da listagem re-escaneia
  // na hora, mesmo espírito instantâneo do add/remove de root.
  const handleChangeProjectScanMode = (mode: ProjectScanMode): void => {
    void window.donel.config
      .setProjectScanMode(mode)
      .then((config) => {
        setAppConfig(config);
        refreshProjectsAfterRootsChange();
      })
      .catch(() => undefined);
  };

  /**
   * T408 (004) — update parcial de UMA aba. Antes existia só o `.map` inline
   * do pin; com nome, `claudeSessionId` e `customTitle` chegando, virariam
   * três `.map` espalhados fazendo a mesma coisa. O pin passou a usar este
   * (`handleTogglePin` abaixo), então há um caminho só de mutação de aba.
   */
  const updateTab = useCallback((tabId: string, partial: Partial<Omit<TabState, 'id'>>): void => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, ...partial } : tab)));
  }, []);

  const handleTogglePin = (tabId: string): void => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    updateTab(tabId, { pinned: !tab.pinned });
  };

  /**
   * T408 (004) — CA-3: renomear pela aba ou pela linha da sidebar. Dois
   * caminhos, por decisão do clarify:
   * - aba `claude`: persiste no ConfigStore via `sessions:setName` (CA-6), com
   *   `seenTitle` = o `custom-title` que esta aba conhece agora (dirty-check
   *   do C2). Vazio APAGA a entrada e o nome volta ao fallback (C5).
   * - aba `shell` (ou aba cujo create ainda não resolveu): só memória, em
   *   `tab.name` — não há `sessionId` onde persistir (C4). Nesse caso um nome
   *   vazio é ignorado: sem entrada no store, não existe fallback para onde
   *   voltar, e uma aba sem rótulo nenhum não é um estado útil.
   */
  const handleRenameTab = (tabId: string, rawName: string): void => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;

    const normalized = normalizeSessionName(rawName);

    if (tab.sessionType !== 'claude' || !tab.claudeSessionId) {
      if (normalized === null) return;
      updateTab(tabId, { name: normalized });
      return;
    }

    void window.donel.sessions
      .setName(tab.claudeSessionId, rawName, tab.customTitle ?? null)
      .then((config) => {
        setAppConfig(config);
        // T707 (007) — gatilho 2: rename muda o rótulo. `config` já tem o
        // `sessionNames` fresco desta escrita — mais preciso que reler o
        // estado `appConfig` (ainda não re-renderizou).
        if (tab.cwd && tab.claudeSessionId) {
          const resolvedLabel = resolveSessionName({
            fallback: tab.name,
            customTitle: tab.customTitle ?? null,
            stored: config.sessionNames[tab.claudeSessionId] ?? null,
          });
          maybeRegisterVisit(tab.claudeSessionId, tab.cwd, resolvedLabel);
        }
      })
      .catch(() => undefined);
  };

  /**
   * CA-27 (009-modo-dev-v3) — cor escolhida pelo operador no menu da aba
   * (clique direito, `TerminalTab` variante v3). Mesmo split de
   * `handleRenameTab`: aba `claude` persiste via `tabs:setColor` (sobrevive a
   * restart — CA-27); aba `shell` (ou aba cujo `claudeSessionId` ainda não
   * resolveu) só muda em memória, sem `sessionId` onde persistir (C4).
   */
  const handleTabColorChange = (tabId: string, color: TabColorToken): void => {
    updateTab(tabId, { color });
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab?.claudeSessionId) return;
    void window.donel.tabs.setColor(tab.claudeSessionId, color).then(setAppConfig).catch(() => undefined);
  };

  /**
   * CA-26 (009-modo-dev-v3) — reordena a barra de abas por arraste
   * (`reorderTabs`, src/shared/tabAppearance.ts). Persiste a nova posição de
   * toda aba `claude` (CA-27: ordem sobrevive a restart, mesmo par
   * cor/ordem); aba `shell` reordena só em memória (sem `sessionId`, C4).
   */
  const handleTabReorder = (fromIndex: number, toIndex: number): void => {
    const next = reorderTabs(tabs, fromIndex, toIndex);
    setTabs(next);
    next.forEach((tab, index) => {
      if (!tab.claudeSessionId) return;
      void window.donel.tabs.setOrder(tab.claudeSessionId, index).then(setAppConfig).catch(() => undefined);
    });
  };

  // "Isolar em worktree" — o main avisa quando a worktree de uma aba fechada ficou (trabalho não enviado).
  useEffect(() => window.donel.workspace.onWorktreeKept(setWorktreeKept), []);
  const dismissWorktreeKept = useCallback(() => setWorktreeKept(null), []);

  /**
   * T412 (004) — CA-4: o `/rename` digitado no CLI reflete na aba/sidebar em
   * menos de 1 s, sem reabrir a sessão. UMA assinatura para TODAS as abas (o
   * watcher do main já cobre toda aba `claude` viva e o payload traz o
   * `sessionId`) — e é aqui que o "CLI vence" do C2 finalmente fecha: quando o
   * título novo difere do `seenTitle` gravado, a entrada da UI é DESCARTADA,
   * em vez de ficar um nome morto competindo no storage (`reconcileStoredName`).
   *
   * Deps vazias de propósito: a assinatura é montada uma vez e lê estado atual
   * por ref. O `unsubscribe` remove só o próprio listener (preload usa
   * `removeListener` com a mesma função), então o double-invoke do StrictMode
   * não deixa listener órfão nem cancela o da montagem nova.
   */
  // Ponte da statusline — UMA assinatura para todas as abas, mais a carga inicial
  // (leituras que chegaram antes da montagem). `snapshot: null` = a aba saiu.
  useEffect(() => {
    let disposed = false;
    // Peso do renderer (08/11) — each working session posts its statusline many times a second; the readings are
    // gathered and land together a few times a second, so the app renders once for all of them.
    let pending = new Map<string, StatusLineSnapshot | null>();
    let flushTimer: number | undefined;
    const flush = (): void => {
      flushTimer = undefined;
      const batch = pending;
      pending = new Map();
      setStatusLines((prev) => {
        let next = prev;
        for (const [ptyId, snapshot] of batch) {
          if (snapshot) {
            next = { ...next, [ptyId]: snapshot };
          } else if (ptyId in next) {
            next = { ...next };
            delete next[ptyId];
          }
        }
        return next;
      });
    };
    const unsubscribe = window.donel.statusLine.onChanged(({ ptyId, snapshot }) => {
      pending.set(ptyId, snapshot);
      if (flushTimer === undefined) flushTimer = window.setTimeout(flush, STATUS_LINE_FLUSH_MS);
    });
    void window.donel.statusLine
      .getAll()
      .then((all) => {
        if (!disposed) setStatusLines((prev) => ({ ...all, ...prev }));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
      window.clearTimeout(flushTimer);
    };
  }, []);
  useEffect(() => {
    const unsubscribe = window.donel.sessions.onTranscriptChanged(
      ({ sessionId, customTitle, contextTokens: tokens, cliColorName, model }) => {
        // Chave é o `sessionId`, não o `tabId` — daí o `.map` próprio em vez do
        // `updateTab`. Uma mesma sessão retomada pode estar em mais de uma aba.
        // Fix #19 — `cliColorName` entra no MESMO `.map`: é o mesmo evento, a
        // mesma chave, nenhum segundo caminho de estado.
        // Peso do renderer (08/11) — this arrives on every line a session writes: only a real change makes new
        // tabs (a new array re-rendered the whole app, the Mindscape included, for each line of each session).
        setTabs((prev) => {
          let changed = false;
          const next = prev.map((tab) => {
            if (tab.claudeSessionId !== sessionId || (tab.customTitle === customTitle && tab.cliColorName === cliColorName)) return tab;
            changed = true;
            return { ...tab, customTitle, cliColorName };
          });
          return changed ? next : prev;
        });

        // T610 (006) — MESMA assinatura, MESMO evento: a 006 só lê o segundo campo
        // do payload. Abrir uma segunda assinatura aqui era risco nomeado na
        // tabela de riscos do tasks.md (dois listeners no mesmo canal, um deles
        // órfão no double-invoke do StrictMode).
        setContextTokens((prev) => (prev[sessionId] === tokens ? prev : { ...prev, [sessionId]: tokens }));
        // Issue #21 — idem para o modelo (campo novo do mesmo payload).
        setSessionModels((prev) => (prev[sessionId] === model ? prev : { ...prev, [sessionId]: model }));

        const stored = appConfigRef.current?.sessionNames[sessionId] ?? null;
        const cliWins = !!stored && reconcileStoredName(stored, customTitle) === null;
        if (cliWins) {
          // Nome vazio = apagar a entrada (mesmo canal do C5, sem inventar outro).
          void window.donel.sessions.setName(sessionId, '', null).then(setAppConfig).catch(() => undefined);
        }

        // T707 (007) — gatilho 3: "durante o trabalho" do D9. `tabsRef` (não
        // `tabs`) porque esta assinatura tem deps vazias (montada uma vez só,
        // mesmo motivo do `appConfigRef` acima). `stored: null` quando o CLI
        // acabou de vencer (a entrada já foi limpa acima) — sem isso o rótulo
        // gravado usaria um nome que já deixou de valer.
        const matchingTab = tabsRef.current.find((tab) => tab.claudeSessionId === sessionId);
        if (matchingTab?.cwd) {
          const label = resolveSessionName({ fallback: matchingTab.name, customTitle, stored: cliWins ? null : stored });
          maybeRegisterVisit(sessionId, matchingTab.cwd, label);
        }
      },
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * T016 (014-chat, FR-033) — `/clear`, `/resume` e fork trocam a CONVERSA da
   * aba sem fechá-la. A aba é achada pelo id anterior (o renderer não conhece o
   * `ptyId`) e passa a apontar para o id novo; contexto, cor do CLI e título do
   * CLI recomeçam (pertencem à conversa). O que o dono vê como "nome" e "cor" da
   * aba SEGUE a aba: o nome efetivo de agora é gravado sob o id novo (quando difere
   * do fallback) e a cor escolhida é persistida também para ele. Um `/rename`
   * posterior no CLI vence, como sempre (`seenTitle: null`). A conversa anterior
   * mantém o que tinha, em Sessões anteriores.
   *
   * Deps vazias de propósito, como a assinatura de `onTranscriptChanged`: lê o
   * estado atual por ref.
   */
  useEffect(() => {
    const unsubscribe = window.donel.sessions.onSessionSwitched(({ previousSessionId, sessionId }) => {
      if (!previousSessionId || previousSessionId === sessionId) return;
      const tab = tabsRef.current.find((candidate) => candidate.claudeSessionId === previousSessionId);
      if (!tab) return;

      const stored = appConfigRef.current?.sessionNames[previousSessionId] ?? null;
      const effectiveName = resolveSessionName({ fallback: tab.name, customTitle: tab.customTitle ?? null, stored });

      // Item 12a — the tab is the place: the new conversation joins the same card (role, post-it,
      // links), BEFORE the tab gets the new id so the board never places a second card.
      const mindscapePort = mindscapeSessionPortRef.current;
      if (mindscapePort.loaded) mindscapePort.applySession((doc) => appendConversation(doc, previousSessionId, sessionId));

      setTabs((prev) =>
        prev.map((candidate) =>
          candidate.claudeSessionId === previousSessionId
            ? { ...candidate, claudeSessionId: sessionId, customTitle: null, cliColorName: null }
            : candidate,
        ),
      );

      // Issue #21 — o modelo é do PROCESSO do CLI, não da conversa: um `/model`
      // sobrevive ao `/clear`. A conversa nova herda o modelo observado na
      // anterior até a primeira resposta dela, em vez de voltar ao do launch.
      setSessionModels((prev) => {
        const carried = prev[previousSessionId];
        return carried && !prev[sessionId] ? { ...prev, [sessionId]: carried } : prev;
      });

      if (effectiveName !== tab.name && !appConfigRef.current?.sessionNames[sessionId]) {
        void window.donel.sessions.setName(sessionId, effectiveName, null).then(setAppConfig).catch(() => undefined);
      }
      if (tab.color && tab.color !== 'none') {
        void window.donel.tabs.setColor(sessionId, tab.color).then(setAppConfig).catch(() => undefined);
      }
      if (tab.cwd) maybeRegisterVisit(sessionId, tab.cwd, effectiveName);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // 003-modo-dev (Batch B) — Zonas 1/2/3
  //
  // INVARIANTE 2 (CA-3): o Enter é sempre gesto humano — a ÚNICA exceção
  // FECHADA é o auto-start de sessão de fase da esteira (batch B5,
  // `armEsteiraAutoStart`, mais abaixo), que nunca é a abertura genérica de
  // aba. A infra GENÉRICA de pré-digitar-sem-enviar (`isReadyToPreType`,
  // `createPrimeSequencer`) segue viva e testada em `shared/preTypeReadiness.ts`
  // / `DevMode/primeSequencer.ts`, mesmo sem uma função de encanamento própria
  // neste arquivo hoje — `handleOpenEsteiraSession` (o único lugar do Modo Dev
  // que abria aba com comando pré-digitado) migrou para o auto-start no B5.
  // =========================================================================

  /**
   * B3 — os `cliSessionId` que o store da Esteira reconhece como sessão de
   * FASE (o disparo, não a sessão livre em que alguém orquestra várias
   * fases). É este conjunto que `PreviousSessions` usa para ocultá-las por
   * default — dado que o app JÁ tem (nenhuma leitura nova), só recortado.
   */
  const esteiraPhaseSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of esteiraState?.snapshot.sessions ?? []) {
      if (session.cliSessionId) ids.add(session.cliSessionId);
    }
    return ids;
  }, [esteiraState]);

  // Um evento só cobre os três caminhos de mudança do histórico (ingestão,
  // gesto do app, gesto de outro canal). O mapa e o painel do store assinam o
  // MESMO canal — nenhum dos dois relê disco.
  useEffect(() => {
    void window.donel.esteira.snapshot().then(setEsteiraState).catch(() => undefined);
    return window.donel.esteira.onChanged(setEsteiraState);
  }, []);

  /**
   * Batch B5 (05/08, pedido literal do dono) — a sessão de FASE DA ESTEIRA
   * aperta o próprio Enter, assim que o CLI PROVA que aceita input
   * (`isReadyForAutoStart`, o mesmo sinal de boot do pré-digitar genérico
   * acima: banner do CLI ou barra de status do prompt ocioso; nunca com o
   * diálogo de confiança na tela). O gesto explícito continua sendo o clique
   * em "Preparar" — o que some é a SEGUNDA confirmação (apertar Enter dentro
   * do terminal depois de ver o comando escrito).
   *
   * Função PRÓPRIA, de propósito — NUNCA uma bifurcação dentro de
   * `armPhaseCommands`: aquela é o mecanismo GENÉRICO de pré-digitar sem
   * enviar (invariante 2/CA-3), que outro código pode voltar a usar um dia, e
   * esta é a exceção FECHADA, chamada só pelo caminho de disparo de fase da
   * esteira (`handleOpenEsteiraSession`, logo abaixo) — nunca pela abertura
   * genérica de aba.
   *
   * Reaproveita `armWatchersRef`/`terminalRefs` (mesmos refs de
   * `armPhaseCommands`): a aba é NOVA aqui (acabou de nascer em
   * `handleOpenEsteiraSession`), então não há watcher anterior para colidir —
   * a limpeza defensiva (`armWatchersRef.current[tabId]?.()`) segue o mesmo
   * padrão só por disciplina.
   *
   * **wi-esteira4-enter-confirmado (13/08) — CONFIRMA E REENVIA.** Até aqui
   * esta função tratava `written === true` (o texto entrou no stdin do PTY)
   * como "o CLI executou", e encerrava. Não é a mesma coisa: a bateria de
   * 13/08 mostrou o comando digitado e nunca submetido, sem toast nenhum,
   * porque ninguém conferia. Agora há uma fase de CONFIRMAÇÃO — o watcher de
   * renderização e o poll, que antes morriam junto com o write do texto,
   * seguem vivos até a caixa de input provar que a linha saiu (ou até um teto
   * estourar e o app DIZER que não conseguiu). Todo o julgamento é puro
   * (`classifyAutoStartSubmission`/`nextAutoStartEnterAction`,
   * `Esteira/esteiraSession.ts`); aqui só o encanamento e os timers.
   */
  const armEsteiraAutoStart = useCallback((tabId: string, command: string): void => {
    armWatchersRef.current[tabId]?.();

    // Duas fases de trabalho, não três: o que era `text-sent` (esperar um
    // `setTimeout` entregar o Enter) virou `submitting` — escrever o Enter,
    // conferir, reenviar se preciso. O timer do Enter deixou de existir; quem
    // decide quando escrever é a política pura, a cada frame renderizado.
    let phase: 'waiting-ready' | 'submitting' | 'done' = 'waiting-ready';
    let attemptsUsed = 0;
    let sawEcho = false;
    let lastWriteAt = 0;
    let phaseStartedAt = 0;

    const cleanup = (): void => {
      unsubscribe();
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      delete armWatchersRef.current[tabId];
    };

    // Fechar a aba (ou armar um auto-start por cima) encerra tudo em silêncio:
    // não há Enter pendente para cancelar — nenhum timer carrega write — e
    // ninguém está olhando uma aba que já não existe.
    const finish = (message?: string): void => {
      if (phase === 'done') return;
      phase = 'done';
      cleanup();
      if (message !== undefined) setDevModeToast(message);
    };

    const check = (): void => {
      if (phase === 'done') return;
      const renderedLines = terminalRefs.current[tabId]?.getRenderedLines() ?? [];

      if (phase === 'waiting-ready') {
        if (!isReadyForAutoStart({ renderedLines })) return;

        const [text] = autoStartWriteSteps(command);
        const written = terminalRefs.current[tabId]?.injectCommand(text) ?? false;
        if (!written) return; // PTY ainda não nasceu — tenta de novo no próximo sinal

        phase = 'submitting';
        phaseStartedAt = Date.now();
        lastWriteAt = phaseStartedAt;
        // O teto de PRONTIDÃO morre aqui (o CLI já provou que aceita input);
        // o teto da confirmação é contado por `phaseStartedAt`, dentro da
        // política. O watcher e o poll seguem VIVOS de propósito — são eles
        // que movem a confirmação.
        clearTimeout(timeoutId);
        return;
      }

      const verdict = classifyAutoStartSubmission({ renderedLines, command });
      // Ver o comando na caixa é a prova de que o leitor de stdin do REPL
      // está armado e consumiu o que escrevemos. Sem isso, caixa vazia é só o
      // estado de sempre — nunca sucesso.
      if (verdict === 'still-typed') sawEcho = true;

      const action = nextAutoStartEnterAction({
        verdict,
        safeToSend: isSafeToSendEnter(renderedLines),
        sawEcho,
        attemptsUsed,
        msSinceLastWrite: Date.now() - lastWriteAt,
        msSincePhaseStart: Date.now() - phaseStartedAt,
      });

      if (action === 'wait') return;
      if (action === 'confirmed') return finish();
      if (action === 'give-up-no-echo') return finish(autoStartGiveUpMessage('no-echo'));
      if (action === 'give-up-attempts') return finish(autoStartGiveUpMessage('attempts'));
      if (action === 'give-up-unconfirmed') return finish(autoStartGiveUpMessage('unconfirmed'));

      // `send-enter` — no MESMO tick síncrono da leitura acima: entre
      // classificar a tela e escrever o `\r` não existe await nem timer, então
      // não há janela para um diálogo aparecer entre a decisão e o byte.
      const [, enter] = autoStartWriteSteps(command);
      if (!(terminalRefs.current[tabId]?.injectCommand(enter) ?? false)) return finish();
      attemptsUsed += 1;
      lastWriteAt = Date.now();
      // Instrumentação da bateria manual: é o que separa "consertou" de "deu
      // sorte" — se todos os disparos submetem no #1, o caminho de reenvio
      // ficou por provar, e o relatório precisa dizer isso.
      console.info(`[auto-start] enter #${attemptsUsed} (aba ${tabId})`);
    };

    const unsubscribe = terminalRefs.current[tabId]?.onRenderedUpdate(check) ?? ((): void => {});
    const intervalId = setInterval(check, PRE_TYPE_POLL_MS);
    const timeoutId = setTimeout(() => {
      if (phase !== 'waiting-ready') return;
      // O boot medido leva 14,5-20,9s; o teto (30s) sobra folga. Se estourar
      // mesmo assim, NADA foi enviado (nem o texto) — dizer isso é a única
      // frase honesta, e o comando manual continua disponível na tela do card.
      finish(AUTO_START_NOT_READY_MESSAGE);
    }, PRE_TYPE_READY_TIMEOUT_MS);

    armWatchersRef.current[tabId] = cleanup;
    check();
  }, []);

  // =========================================================================
  // Sessão renovada em voo (B36, docs/refinamentos/sessao-renovada-em-voo.md).
  // The decisions are pure (`shared/sessionRenewal.ts`); the per-tab machine is
  // `useSessionRenewal`; here only what it reads from the tabs and the doors it
  // uses: sending one line to the session and swapping the process of the pane.
  // =========================================================================
  const renewalPrefs: SessionRenewalPrefs = appConfig?.sessionRenewal ?? DEFAULT_SESSION_RENEWAL_PREFS;
  const renewalInputs: RenewalTabInput[] = tabs.map((tab) => {
    const semaphore = semaphoreStates[tab.id];
    return {
      tabId: tab.id,
      ptyId: chatPtyIds[tab.id] ?? null,
      sessionId: tab.claudeSessionId ?? null,
      // An isolated worktree is released when its process ends: renewing it would race the cleanup.
      eligible:
        tab.sessionType === 'claude' &&
        !tab.accountLoginId &&
        !!tab.claudeSessionId &&
        tabExits[tab.id] === undefined &&
        worktreeNameFromArgs(tab.launchArgs) === null,
      contextTokens: tab.claudeSessionId ? (contextTokens[tab.claudeSessionId] ?? null) : null,
      turn: semaphore?.state ?? null,
      stateEnteredAt: semaphore?.stateEnteredAt ?? 0,
      backgroundAgents: semaphore?.awaitingBackgroundAgents === true,
    };
  });
  /** One line to the session of `tabId` — same doors as the Esteira auto-start: the chat's send driver, or typed into the terminal. */
  /** `from: 'session'` — a notice or a message from another session: it waits for the owner (sendDriver, 06/11). */
  const sendRenewalLine = (tabId: string, rawText: string, from?: 'session'): void => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
    if (tab === undefined) return;
    // Not the owner's request: the pipeline router leaves it alone (src/shared/chat/noPipeline.ts).
    const text = from === 'session' ? withNoPipelineTag(rawText) : rawText;
    if (hasChatView(tab, chatEnabled)) sendToTab(tabId, { terminal: () => terminalRefs.current[tabId] ?? null }, { text, ...(from ? { from } : {}) });
    else armEsteiraAutoStart(tabId, text);
  };
  const sessionRenewal = useSessionRenewal(renewalInputs, renewalPrefs, {
    send: sendRenewalLine,
    renew: (tabId, renewalId) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      const handle = terminalRefs.current[tabId];
      if (tab === undefined || !handle) return false;
      // A permission mode switched with Shift+Tab lives only in the old process: the new one starts in it.
      const ptyId = handle.ptyId;
      const chat = ptyId ? getChatStore().getState(ptyId) : null;
      const mode = chat !== null && chat.status === 'ready' ? chat.permissionMode : null;
      handle.renew({ args: renewalLaunchArgs(tab.launchArgs, mode), renewalId });
      return true;
    },
    toast: (message) => setDevModeToast(message),
  });

  // T009 — antes do primeiro evento de hook chegar pra uma aba recém-criada,
  // assume 'working' (spike: estado inicial otimista) com stateEnteredAt=0
  // (sortSessions trata omitido/0 como "a mais antiga possível" — nunca
  // perde o desempate de FR-010/CA-6 por causa disso).
  /**
   * "Isolar em worktree" — a branch da aba isolada: a leitura oficial do CLI (statusline) quando já chegou, senão a
   * `worktree-<nome>` que o CLI cria. `undefined` = aba no checkout do projeto.
   */
  const tabWorktreeBranch = (tab: TabState): string | undefined => {
    const name = tab.sessionType === 'claude' ? worktreeNameFromArgs(tab.launchArgs) : null;
    if (name === null) return undefined;
    const ptyId = chatPtyIds[tab.id];
    return (ptyId ? statusLines[ptyId]?.worktree?.branch : null) ?? cliWorktreeBranch(name);
  };

  /**
   * T408 (004) — CA-5: UMA função de resolução por sessão, consumida pela aba,
   * pela linha da sidebar e pela lista de sessões anteriores. Se cada lugar
   * decidisse o nome por conta própria, os três divergiriam.
   * Aba `shell` não tem sessão do Claude: seu nome é o `tab.name` e ponto (C4).
   */
  // Segundo plano visível — what every tab left running in the background (the chat store gathers the live
  // states the main sends; a tab without the chat view simply has no entry).
  const backgroundByPty = useSyncExternalStore(
    useCallback((listener: () => void) => getChatStore().subscribeBackground(listener), []),
    () => getChatStore().getBackground(),
  );
  const backgroundRunningOf = (tabId: string): number => {
    const ptyId = chatPtyIds[tabId];
    return ptyId ? runningCount(backgroundByPty[ptyId]) : 0;
  };

  const resolveTabName = (tab: TabState): string => {
    if (tab.sessionType !== 'claude') return tab.name;
    return resolveSessionName({
      fallback: tab.name,
      customTitle: tab.customTitle ?? null,
      stored: (tab.claudeSessionId ? appConfig?.sessionNames[tab.claudeSessionId] : undefined) ?? null,
    });
  };

  // Navegador do Líder (t-31e2b949) — every session with a PTY, also the ones opened by another session (off the tab
  // bar): the Líder's browser panel lists their browsers by name, board and place.
  const browserSessions: BrowserDirectorySession[] = tabs.flatMap((tab) => {
    const ptyId = tab.sessionType === 'claude' ? chatPtyIds[tab.id] : undefined;
    if (!ptyId) return [];
    const board = tab.projectName ?? (tab.cwd ? tab.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null : null);
    const place = tab.remoteId ? (accountsView.remotes.find((remote) => remote.id === tab.remoteId)?.label ?? tab.remoteId) : 'Este computador';
    return [{ ptyId, name: resolveTabName(tab), board, place }];
  });

  // B33 — "Atualizar": the click only asks; the switch happens when no session is in the middle of a turn
  // or waiting on the owner (never ends a turn). The open tabs go to the main to be reopened after the update.
  const [updateRequested, setUpdateRequested] = useState(false);
  const [updateApplying, setUpdateApplying] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  // Sessão durável (dono, 12/11) — "Atualizar" no longer waits forever: the sessions in a turn are asked to close it
  // and save their state, and when the deadline (`appUpdate.forceAfterMinutes`, 5 min) passes it restarts anyway.
  const [updateDeadline, setUpdateDeadline] = useState<{ readonly requestedAt: number; readonly forceAfterMs: number } | null>(null);
  const [updateNow, setUpdateNow] = useState(() => Date.now());
  const updateSessionInputs = useMemo(
    () =>
      tabs
        .filter((tab) => tab.sessionType === 'claude')
        .map((tab) => {
          const info = semaphoreStates[tab.id];
          return {
            id: tab.id,
            alive: aliveTabs[tab.id] === true,
            state: info?.state,
            unconfirmed: info?.unconfirmed,
            pendingKinds: info?.pendingKinds,
            awaitingBackgroundAgents: info?.awaitingBackgroundAgents,
          };
        }),
    [tabs, semaphoreStates, aliveTabs],
  );
  const updateSessions = useMemo(() => updateReadiness(updateSessionInputs), [updateSessionInputs]);
  // Since when every session is free (the hold of `updateGo`); reset at each one that gets busy again.
  const updateReadySinceRef = useRef<number | null>(null);
  if (!updateSessions.ready) updateReadySinceRef.current = null;
  else if (updateReadySinceRef.current === null) updateReadySinceRef.current = Date.now();
  const updateTiming = updateDeadline
    ? updateGo(updateSessions, { ...updateDeadline, now: updateNow, readyForMs: updateReadySinceRef.current === null ? 0 : Math.max(0, updateNow - updateReadySinceRef.current) })
    : null;
  useEffect(() => {
    if (!updateRequested) {
      setUpdateDeadline(null);
      return undefined;
    }
    const requestedAt = Date.now();
    setUpdateNow(requestedAt);
    let alive = true;
    const fallback = DEFAULT_FORCE_AFTER_MINUTES * 60_000;
    void window.donel.appUpdate
      .get()
      .then((status) => status.forceAfterMs)
      .catch(() => fallback)
      .then((forceAfterMs) => {
        if (alive) setUpdateDeadline({ requestedAt, forceAfterMs: forceAfterMs > 0 ? forceAfterMs : fallback });
      });
    const timer = setInterval(() => setUpdateNow(Date.now()), 1_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [updateRequested]);
  const toResumeTab = (tab: TabState): ResumeTab[] => {
    if (tab.accountLoginId) return []; // a login in progress is not a session to come back to
    const common = {
      name: resolveTabName(tab),
      ...(tab.cwd ? { cwd: tab.cwd } : {}),
      ...(tab.projectName ? { projectName: tab.projectName } : {}),
      ...(tab.color && tab.color !== 'none' ? { color: tab.color } : {}),
      ...(tab.pinned ? { pinned: true } : {}),
      ...(tab.id === activeTabId ? { active: true } : {}),
    };
    if (tab.sessionType === 'shell') return [{ sessionType: 'shell', ...common }];
    // Sessões remotas — they keep running on the remote place; the next boot finds and reattaches them (`toResumeRemote`).
    if (tab.remoteId) return [];
    const sessionId = tab.claudeSessionId;
    const launchArgs = sessionId ? withResumeArgs(tab.launchArgs, sessionId) : tab.launchArgs;
    return [
      {
        sessionType: 'claude',
        ...common,
        ...(sessionId ? { sessionId } : {}),
        ...(launchArgs ? { launchArgs } : {}),
        ...(tab.providerId ? { providerId: tab.providerId } : {}),
        ...(tab.roleId ? { roleId: tab.roleId } : {}),
        // A place binds to its conversation; only a session that never started still needs it.
        ...(tab.placeId && !sessionId ? { placeId: tab.placeId } : {}),
        ...(tab.openedBySession && tab.openedBy ? { openedBy: tab.openedBy } : {}),
        ...(tab.leaderOfAll ? { leaderOfAll: true } : {}),
        ...(tab.customTitle !== undefined ? { customTitle: tab.customTitle } : {}),
        ...(tab.view ? { view: tab.view } : {}),
      },
    ];
  };
  /** A remote session that was open: listed only so the Líder hears whether it reattached after the update. */
  const toResumeRemote = (tab: TabState): ResumeRemote[] =>
    tab.remoteId && tab.claudeSessionId && tab.sessionType === 'claude' && !tab.leaderOfAll
      ? [{ remoteId: tab.remoteId, sessionId: tab.claudeSessionId, name: resolveTabName(tab), ...(tab.cwd ? { cwd: tab.cwd } : {}) }]
      : [];
  const toResumeTabRef = useRef(toResumeTab);
  toResumeTabRef.current = toResumeTab;
  const updateGoes = updateTiming?.go === true;
  useEffect(() => {
    if (!updateRequested || updateApplying || !updateGoes) return;
    setUpdateApplying(true);
    const resumeTabs = tabsRef.current.flatMap((tab) => toResumeTabRef.current(tab));
    const resumeRemotes = tabsRef.current.flatMap(toResumeRemote);
    const fail = (message: string): void => {
      setUpdateApplying(false);
      setUpdateRequested(false);
      setUpdateError(message);
    };
    window.donel.appUpdate
      .apply(resumeTabs, resumeRemotes)
      .then((result) => {
        if (!result.ok) fail(result.message);
      })
      .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateRequested, updateApplying, updateGoes]);
  // B33 — the first boot after an update: reopen the tabs that were open, in the same order, resuming each
  // conversation (`-r`), so its card stays where it was on the Mindscape. Only after an update: the general
  // restore on boot stays cancelled (the main hands the list once and deletes it).
  const updateBootTakenRef = useRef(false);
  useEffect(() => {
    if (!appConfig || updateBootTakenRef.current || !window.donel.appUpdate) return;
    updateBootTakenRef.current = true;
    void window.donel.appUpdate
      .takeBoot()
      .then((boot) => {
        if (boot.failure) setUpdateError(`${boot.failure}. Esta é a versão de antes.`);
        let activeId: string | null = null;
        // A restore is not a gesture of the owner: it focuses as before, without leaving the Oráculo (`focus` false).
        let lastListedId: string | null = null;
        // Sessão durável — who must come back on the same conversation; the Líder hears who did (agentBridge).
        const expected: ReturnExpectation[] = [];
        for (const entry of boot.tabs) {
          const id = addTab(
            {
            name: entry.name,
            cwd: entry.cwd,
            projectName: entry.projectName,
            pinned: entry.pinned === true,
            sessionType: entry.sessionType,
            ...(entry.sessionType === 'claude' && entry.launchArgs ? { launchArgs: [...entry.launchArgs] } : {}),
            ...(entry.providerId ? { providerId: entry.providerId } : {}),
            ...(entry.roleId ? { roleId: entry.roleId } : {}),
            ...(entry.placeId ? { placeId: entry.placeId } : {}),
            ...(entry.color && isTabColorToken(entry.color) ? { color: entry.color } : {}),
            ...(entry.customTitle !== undefined ? { customTitle: entry.customTitle } : {}),
            ...(entry.view ? { view: entry.view } : {}),
            ...(entry.leaderOfAll ? { leaderOfAll: true } : {}),
              ...(entry.openedBy ? { openedBySession: true, openedBy: entry.openedBy } : {}),
            },
            false,
          );
          // Só os Líderes nas abas — the team comes back to the Mindscape, not to the tab bar.
          if (entry.openedBy) agentBridgeRef.current.adoptOpened(id, entry.openedBy);
          else {
            lastListedId = id;
            if (entry.active) activeId = id;
          }
          if (entry.sessionType === 'claude' && entry.sessionId && entry.cwd && !entry.leaderOfAll)
            expected.push({
              tabId: id,
              sessionId: entry.sessionId,
              projectPath: entry.cwd,
              name: entry.name,
              ...(entry.launchArgs?.includes('--session-id') ? { fresh: true } : {}),
            });
        }
        for (const remote of boot.remotes ?? [])
          if (remote.cwd) expected.push({ sessionId: remote.sessionId, projectPath: remote.cwd, name: remote.name, remote: true });
        if (expected.length > 0) agentBridgeRef.current.expectReturn(expected);
        if (activeId ?? lastListedId) setActiveTabId((activeId ?? lastListedId)!);
      })
      .catch(() => undefined);
    // `addTab` is recreated every render; this runs once, when the config (model defaults) is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig]);

  // Sessões remotas — sessions that kept running on a remote place while the app was closed come back as
  // tabs, attached to the same tmux session (`-r` only matters if it ended in the meantime).
  const remoteBootTakenRef = useRef(false);
  useEffect(() => {
    if (!appConfig || remoteBootTakenRef.current || !window.donel.pty.remoteAlive) return;
    remoteBootTakenRef.current = true;
    void window.donel.pty
      .remoteAlive()
      .then((alive) => {
        for (const entry of alive) {
          if (tabsRef.current.some((tab) => tab.claudeSessionId === entry.sessionId)) continue;
          const id = addTab(
            {
              name: entry.name,
              cwd: entry.cwd,
              projectName: entry.projectName,
              pinned: false,
              sessionType: 'claude',
              launchArgs: withResumeArgs(entry.launchArgs, entry.sessionId),
              remoteId: entry.remoteId,
              ...(entry.openedBy ? { openedBySession: true, openedBy: entry.openedBy } : {}),
              // Líder único na VPS — it comes back as the Líder (the Jobu talks to it), not as an ordinary tab.
              ...(entry.roleId ? { roleId: entry.roleId } : {}),
              ...(entry.leaderOfAll ? { leaderOfAll: true } : {}),
            },
            false,
          );
          // Só os Líderes nas abas — a session a Líder opened on the remote stays out of the tab bar after a restart.
          if (entry.openedBy) agentBridgeRef.current.adoptOpened(id, entry.openedBy);
          // A restore, not a gesture: it takes the focus as before, without leaving the Oráculo. The Líder único is
          // reached through the Jobu: it never takes the focus.
          else if (!entry.leaderOfAll) setActiveTabId(id);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig]);

  // T709/CA-3 (007) — dedupe: sessões exibidas sob um projeto FAVORITADO saem
  // da lista geral. Escopado só aos favoritados (D6) — sessão de projeto
  // comum nunca é afetada. Vem DEPOIS do cabeçalho (favoriteGroups, abaixo)
  // já estar computado com o pior estado — a ordem é a mesma do tasks.md T709
  // (cabeçalho antes do dedupe), aqui expressa como "o dot nunca depende do
  // dedupe", não como ordem de linhas de código.
  const favoritedProjectPaths = useMemo(
    () => projects.filter((project) => project.favorite).map((project) => project.path),
    [projects],
  );
  const registeredFavoriteIds = useMemo(
    () => selectRegisteredIds(appConfig?.sessionRegistry ?? {}, favoritedProjectPaths),
    [appConfig, favoritedProjectPaths],
  );

  // Mindscape V1 — the live `claude` tabs that belong to a project (a tab
  // without project — shell or home — does not enter, rule 11).
  const mindscapeSessions: MindscapeLiveSession[] = useMemo(
    () =>
      tabs.flatMap((tab) => {
        if (!(tab.sessionType === 'claude' && tab.claudeSessionId && tab.cwd && tab.projectName)) return [];
        const sessionId = tab.claudeSessionId;
        const semaphore = semaphoreStates[tab.id];
        // Item 04 — the engine and the context, read exactly like the footer (`resolveSessionMeter`):
        // the statusline of the CLI first, then the transcript. No reading → no seal, no meter.
        const ptyId = tabExits[tab.id] === undefined ? (chatPtyIds[tab.id] ?? null) : null;
        const statusLine = statusLineForSession(ptyId ? statusLines[ptyId] : null, sessionId);
        const meter = resolveSessionMeter({
          transcriptModelId: sessionModels[sessionId],
          transcriptTokens: contextTokens[sessionId],
          launchAlias: sessionModelEffort[tab.id]?.model ?? DEFAULT_MODEL_ALIAS,
          statusLine,
        });
        const modelRead = Boolean(statusLine?.model?.id || sessionModels[sessionId]);
        const providerLabel = tab.providerId ? (providers.find((provider) => provider.id === tab.providerId)?.label ?? tab.providerId) : null;
        const engine = [modelRead ? meter.label : null, providerLabel].filter(Boolean).join(' · ');
        return [
          {
            tabId: tab.id,
            sessionId,
            name: resolveTabName(tab),
            projectPath: tab.cwd,
            color: tab.color ?? 'none',
            cliColorHex: cliColorNameToHex(tab.cliColorName),
            state: semaphore?.state ?? 'working',
            stateEnteredAt: semaphore?.stateEnteredAt ?? 0,
            background: backgroundRunningOf(tab.id),
            ...(tab.roleId ? { roleId: tab.roleId } : {}),
            ...(tab.remoteId ? { machineId: tab.remoteId } : {}),
            ...(!semaphore || semaphore.unconfirmed ? { unconfirmed: true } : {}),
            ...(semaphore?.pendingKinds ? { pendingKinds: semaphore.pendingKinds } : {}),
            ...(semaphore?.turnFailure ? { turnFailure: semaphore.turnFailure } : {}),
            ...(tabLinkLost(tab.id) ? { linkLost: true } : {}),
            ...(engine ? { engine } : {}),
            ...(meter.usedTokens !== null ? { meter: { usedTokens: meter.usedTokens, maxTokens: meter.contextZone } } : {}),
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, semaphoreStates, appConfig, backgroundByPty, chatPtyIds, tabExits, linkLostPtys, statusLines, sessionModels, contextTokens, sessionModelEffort, providers],
  );
  // Mindscape, fatia 02 — last visit of the owner to each session, in memory
  // only (not persisted: the app is born without tabs). Stamped when a tab
  // gets focus in the Uso geral and when the owner leaves the Uso geral with
  // a tab in focus (rule 4).
  const [mindscapeSeenAt, setMindscapeSeenAt] = useState<Record<string, number>>({});
  const previousAppModeRef = useRef(appMode);
  useEffect(() => {
    const wasGeral = previousAppModeRef.current === 'geral';
    const leftGeral = wasGeral && appMode !== 'geral';
    previousAppModeRef.current = appMode;
    if (appMode !== 'geral' && !leftGeral) return;
    const sessionId = tabsRef.current.find((tab) => tab.id === activeTabId)?.claudeSessionId;
    if (!sessionId) return;
    setMindscapeSeenAt((previous) => ({ ...previous, [sessionId]: Date.now() }));
    // Diário de gestos — a tab focused inside the Uso geral (coming from the Mindscape is recorded there).
    if (wasGeral && appMode === 'geral') window.donel.learning?.record({ type: 'sessao-aberta', sessionId, via: 'aba' });
  }, [appMode, activeTabId]);
  // Só os Líderes nas abas — a hidden session that takes the focus (double click on its place, a notice of the Jobu,
  // Ctrl+Tab) comes to the tab bar until the owner closes it.
  useEffect(() => {
    setTabs((prev) => {
      const target = prev.find((tab) => tab.id === activeTabId);
      if (!target || isTabListed(target)) return prev;
      return prev.map((tab) => (tab.id === activeTabId ? { ...tab, shown: true } : tab));
    });
  }, [activeTabId]);
  // "Ir ao terminal" (rule 10) — the focus change above stamps `seenAt`.
  const handleMindscapeGoToTerminal = useCallback((tabId: string): void => {
    const sessionId = tabsRef.current.find((tab) => tab.id === tabId)?.claudeSessionId;
    if (sessionId) window.donel.learning?.record({ type: 'sessao-aberta', sessionId, via: 'mindscape' });
    setAppMode('geral');
    focusTab(tabId);
  }, []);
  // Lugar principal, rule 5 — a dormant session is resumed (`-r <id>`) in a new tab of the
  // board's project; a session already open in a tab is only focused (never opened twice).
  /** The tab that resumes `sessionId` of a dormant place (the owner's double click, or `sessao_retomar`). */
  const resumeTab = (sessionId: string, projectPath: string, name: string, remote: { remoteId?: string }, bySession?: { placeId: string; openedBy?: string }): string => {
    const project = projects.find((candidate) => candidate.path === projectPath);
    return addTab(
      {
        name,
        cwd: projectPath,
        projectName: project?.name ?? projectPath.split(/[\\/]/).filter(Boolean).pop(),
        pinned: false,
        launchArgs: buildClaudeArgs({ continuation: { type: 'resume', sessionId } }),
        sessionType: 'claude',
        ...remote,
        customTitle: null,
        // Resumed by a session: out of the owner's tab bar and without his focus, like one opened by `sessao_abrir`. Its
        // place goes along, so the bridge sees the place open before the conversation binds (seconds, on a remote place).
        ...(bySession ? { placeId: bySession.placeId, openedBySession: true, ...(bySession.openedBy ? { openedBy: bySession.openedBy } : {}) } : {}),
      },
      !bySession,
    );
  };
  const handleMindscapeResume = (sessionId: string, projectPath: string, name: string): void => {
    const existingTab = tabs.find((tab) => tab.claudeSessionId === sessionId);
    if (existingTab) {
      handleMindscapeGoToTerminal(existingTab.id);
      return;
    }
    openWhereItLives(sessionId, projectPath, (remote) => {
      window.donel.learning?.record({ type: 'sessao-aberta', sessionId, via: 'retomar' });
      resumeTab(sessionId, projectPath, name, remote);
      setSelectedProjectPath(projectPath);
      setAppMode('geral');
    });
  };
  const mindscapeStoredNameOf = (sessionId: string): string | null => appConfig?.sessionNames[sessionId]?.name ?? null;
  const mindscapeProjectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.path, project.name])), [projects]);
  const { loaded: mindscapeLoaded, apply: applyMindscape, applySession: applyMindscapeSession, undo: undoMindscape, redo: redoMindscape } = mindscape;

  /**
   * B36 — the pane of `tab` opened the new session of a renewal. What the owner sees as THIS tab
   * follows it, like after a `/clear` (`onSessionSwitched`): the effective name and the color are
   * stored under the new id, the model observed carries until the first answer, and the Mindscape
   * card (with its post-it and links) moves to the new session in the same place — BEFORE the tab
   * gets the new id, so the board never places a second card. Then the first message: read the handoff.
   */
  const handleRenewedSession = (tab: TabState, previousSessionId: string, sessionId: string, firstPrompt: string, handoffPath: string): void => {
    const stored = appConfigRef.current?.sessionNames[previousSessionId] ?? null;
    const effectiveName = resolveSessionName({ fallback: tab.name, customTitle: tab.customTitle ?? null, stored });
    // Item 12a — the new conversation is added to the same place (card, role, post-it, links).
    if (mindscapeLoaded) applyMindscapeSession((doc) => appendConversation(doc, previousSessionId, sessionId));
    updateTab(tab.id, { customTitle: null, cliColorName: null });
    setSessionModels((prev) => {
      const carried = prev[previousSessionId];
      return carried && !prev[sessionId] ? { ...prev, [sessionId]: carried } : prev;
    });
    if (effectiveName !== tab.name && !appConfigRef.current?.sessionNames[sessionId]) {
      void window.donel.sessions.setName(sessionId, effectiveName, null).then(setAppConfig).catch(() => undefined);
    }
    if (tab.color && tab.color !== 'none') {
      void window.donel.tabs.setColor(sessionId, tab.color).then(setAppConfig).catch(() => undefined);
    }
    // The handoff must reach the new session: with the chat, wait for its CLI to take the message and,
    // when it does not, say so on the tab (never resent by itself). The terminal-only path types it as before.
    const tabId = tab.id;
    if (!hasChatView(tab, chatEnabled)) {
      sendRenewalLine(tabId, firstPrompt);
      return;
    }
    setRenewalDeliveryNotices((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    void sendToTabAndWait(tabId, { terminal: () => terminalRefs.current[tabId] ?? null }, { text: firstPrompt }, RENEWAL_HANDOFF_WAIT_MS).then((outcome) => {
      const notice = renewalHandoffDeliveryNotice(outcome, handoffPath);
      if (notice === null || !tabsRef.current.some((candidate) => candidate.id === tabId)) return;
      setRenewalDeliveryNotices((prev) => ({ ...prev, [tabId]: notice }));
    });
  };
  // Desenho, fatia 02 — what the sessions do goes through `applySession`: it
  // never enters the history (an undo does not take a session post-it away).
  useEffect(() => {
    // Only after the boot load: writing before it would overwrite the file with an empty document.
    if (!mindscapeLoaded) return;
    applyMindscapeSession((doc) =>
      placeSessionCards(
        doc,
        mindscapeSessions.map((session) => ({ projectPath: session.projectPath, sessionId: session.sessionId, ...(session.roleId ? { roleId: session.roleId } : {}) })),
      ),
    );
  }, [mindscapeLoaded, applyMindscapeSession, mindscapeSessions]);
  // Item 12a — what the "`/clear`, `/resume` and fork" handler (registered once, at mount) needs from this render.
  const mindscapeSessionPortRef = useRef({ loaded: mindscapeLoaded, applySession: applyMindscapeSession });
  mindscapeSessionPortRef.current = { loaded: mindscapeLoaded, applySession: applyMindscapeSession };
  // Papéis de sessão (item 12a) — the roles of `<userData>/papeis/`, read once (and after an edit).
  const [roles, setRoles] = useState<SessionRole[]>([]);
  // Item 12b — the screen to create and edit roles ("Papéis…" in the Mindscape and in the Launcher).
  const [rolesEditorOpen, setRolesEditorOpen] = useState(false);
  /** Cadeiras, fatia 2 — the role whose chair screen (B1) is open, and the role the Papéis editor opens on. */
  const [chairRoleId, setChairRoleId] = useState<string | null>(null);
  const [rolesEditorRoleId, setRolesEditorRoleId] = useState<string | undefined>(undefined);
  useEffect(() => {
    void window.donel.roles
      ?.list()
      .then(setRoles)
      .catch(() => undefined);
  }, []);
  /**
   * Item 12a — the role a tab shows: the one it was opened with, else the role of the place that
   * holds its conversation.
   */
  const roleOfTab = (tab: TabState): SessionRole | undefined => {
    const roleId = tab.roleId ?? (tab.claudeSessionId ? roleOfSession(mindscape.doc, tab.claudeSessionId) : undefined);
    return roleId ? roles.find((role) => role.id === roleId) : undefined;
  };
  /**
   * Item 12a — double click on a place that has not started: a new tab in the board's project with
   * the role's suggestions (model, effort, permission, engine) and the role itself. A tab already
   * opening for that place is only focused. The place binds to the conversation when its id comes.
   */
  /** Where the Líderes run (Preferences, "Onde o Líder roda"): a remote place, or `undefined` for this computer. */
  const leaderPlace = (): string | undefined =>
    leaderRemoteId(
      appConfig?.leader ?? DEFAULT_LEADER_PREFS,
      accountsView.remotes.map((remote) => ({ id: remote.id, hasAccount: Boolean(remote.activeAccountId) })),
    );
  const handleMindscapeStartPlace = (placeId: string, projectPath: string): void => {
    const existingTab = tabs.find((tab) => tab.placeId === placeId);
    if (existingTab) {
      handleMindscapeGoToTerminal(existingTab.id);
      return;
    }
    if (!startPlaceTab(placeId, projectPath)) return;
    setSelectedProjectPath(projectPath);
    setAppMode('geral');
  };
  /**
   * The first tab of a place that never started (the owner's double click, or `sessao_retomar` with `bySession`: then
   * without his focus and out of his tab bar). `undefined` = no such place.
   */
  const startPlaceTab = (
    placeId: string,
    projectPath: string,
    bySession?: { openedBy?: string; mayOpenOn(remoteId: string | undefined): string | undefined },
  ): { tabId: string; remoteId?: string } | { refused: string } | undefined => {
    const place = mindscape.doc.boards[projectPath]?.cards[placeId];
    if (place?.kind !== 'session') return undefined;
    const role = place.roleId ? roles.find((candidate) => candidate.id === place.roleId) : undefined;
    // A suggested engine that is not registered here is ignored: the session opens on the active account.
    const providerId = role?.engine && providers.some((provider) => provider.id === role.engine) ? role.engine : undefined;
    const defaults = appConfig?.launcherDefaults;
    const project = projects.find((candidate) => candidate.path === projectPath);
    // "Onde roda" — same default as the Launcher (owner, 04/11): the last choice; without one, the first remote place with an account.
    // A Líder of a board opens where the Líder único runs (owner, 08/11: the orchestrator on the VPS, the PC only with the app).
    const savedWhere = defaults?.where;
    const remoteId =
      place.roleId === LIDER_ROLE_ID && !providerId
        ? leaderPlace()
        : savedWhere === 'local'
          ? undefined
          : accountsView.remotes.some((remote) => remote.id === savedWhere)
            ? savedWhere
            : accountsView.remotes.find((remote) => remote.activeAccountId)?.id;
    const refused = bySession?.mayOpenOn(remoteId);
    if (refused) return { refused };
    const tabId = addTab(
      {
        name: role?.name ?? 'Sessão',
        cwd: projectPath,
        projectName: project?.name ?? projectPath.split(/[\\/]/).filter(Boolean).pop(),
        pinned: false,
        launchArgs: buildLauncherArgs({
          providerId,
          model: role?.model ?? defaults?.model ?? DEFAULT_MODEL_ALIAS,
          effort: role?.effort ?? defaults?.effort ?? DEFAULT_EFFORT_LEVEL,
          permissionMode: role?.permissionMode ?? defaults?.permissionMode ?? 'acceptEdits',
          sessionName: '',
        }),
        sessionType: 'claude',
        providerId,
        ...(remoteId ? { remoteId } : {}),
        ...(place.roleId ? { roleId: place.roleId } : {}),
        placeId,
        ...(bySession ? { openedBySession: true, ...(bySession.openedBy ? { openedBy: bySession.openedBy } : {}) } : {}),
      },
      !bySession,
    );
    return { tabId, ...(remoteId ? { remoteId } : {}) };
  };

  // Item 18 (PDA mindscape-openrig) + Líder único (ADR 0007) — the Jobu as the Líder of EVERY board, in a bubble that
  // comes out of him. One session with the role `lider` and the Jobu's mark (`isLeaderOfAllTab`): this window owns the tabs,
  // so it says which one it is (`lider:report`) and delivers what the owner writes there (`lider:deliver`) through the
  // tab's own send machine; with no live Líder, the first message opens one, on this computer, in the folder that holds
  // the projects of the boards (`leaderHome`), or `leader.home` of config.json when set (`leaderCwd`).
  const liderTabRef = useRef<string | null>(null);
  const findLiderTab = (): TabState | undefined => {
    const alive = (tab: TabState): boolean => isLeaderOfAllTab(tab) && tabExits[tab.id] === undefined;
    const remembered = liderTabRef.current ? tabs.find((tab) => tab.id === liderTabRef.current && alive(tab)) : undefined;
    return remembered ?? tabs.find(alive);
  };
  const liderTab = findLiderTab();
  const liderRoleAvailable = roles.some((role) => role.id === LIDER_ROLE_ID);
  const lastLiderReportRef = useRef<string | null>(null);
  useEffect(() => {
    const report: LiderReport = {
      tabId: liderTab?.id ?? null,
      ptyId: liderTab ? (chatPtyIds[liderTab.id] ?? null) : null,
      name: liderTab ? resolveTabName(liderTab) : null,
      roleAvailable: liderRoleAvailable,
    };
    const json = JSON.stringify(report);
    if (json === lastLiderReportRef.current) return;
    lastLiderReportRef.current = json;
    window.donel.lider.report(report);
  });
  const liderDeliverRef = useRef<(text: string) => LiderSendResult>(() => ({ ok: false, reason: 'O Donel ainda está abrindo.' }));
  // Líder único na VPS — the move in progress (its messages wait for it). Async steps close tabs through a ref,
  // never through a stale render.
  const liderMoveRef = useRef<LeaderMove | null>(null);
  liderDeliverRef.current = (text: string): LiderSendResult => {
    const sendTo = (tabId: string, message: string): void => {
      sendToTab(tabId, { terminal: () => terminalRefs.current[tabId] ?? null }, { text: message });
    };
    if (liderMoveRef.current) {
      liderMoveRef.current.enqueue(text);
      return { ok: true };
    }
    const role = roles.find((candidate) => candidate.id === LIDER_ROLE_ID);
    const providerId = role?.engine && providers.some((provider) => provider.id === role.engine) ? role.engine : undefined;
    // Líder único na VPS (docs/planos/lider-na-vps.md) — where the owner wants it (Preferences). A provider of a third
    // party does not run on a remote place (ADR 0006): that Líder stays here.
    const wantedRemoteId = providerId ? undefined : leaderPlace();
    const openLeader = (resume?: { readonly sessionId: string; readonly cwd: string | undefined }): string => {
      // Without the role there is no Líder único (it is the role + the mark below): say so instead of opening a plain session.
      if (!role) throw new Error('O papel Líder não existe nesta máquina.');
      const defaults = appConfig?.launcherDefaults;
      const home = resume ? resume.cwd : leaderCwd(appConfig?.leader ?? DEFAULT_LEADER_PREFS, Object.keys(mindscape.doc.boards));
      const launchArgs = buildLauncherArgs({
        providerId,
        model: role.model ?? defaults?.model ?? DEFAULT_MODEL_ALIAS,
        effort: role.effort ?? defaults?.effort ?? DEFAULT_EFFORT_LEVEL,
        permissionMode: role.permissionMode ?? defaults?.permissionMode ?? 'acceptEdits',
        sessionName: '',
      });
      return addTab({
        name: role.name,
        // No `projectName`: the Líder único belongs to no board.
        ...(home ? { cwd: home } : {}),
        pinned: false,
        launchArgs: resume ? withResumeArgs(launchArgs, resume.sessionId) : launchArgs,
        ...(wantedRemoteId ? { remoteId: wantedRemoteId } : {}),
        sessionType: 'claude',
        providerId,
        roleId: role.id,
        // The mark that makes it the Líder único (never the role alone): only this path puts it.
        leaderOfAll: true,
        // Oráculo no centro — the owner talks to it through the Jobu: it opens without taking the front.
      }, !layoutPrefsRef.current.oracleCenter);
    };

    // The live Líder; with none, the one whose process ended (the ssh dropped while the notebook slept).
    const live = findLiderTab();
    const remembered = liderTabRef.current ? tabs.find((tab) => tab.id === liderTabRef.current && isLeaderOfAllTab(tab)) : undefined;
    const tab = live ?? remembered ?? tabs.find(isLeaderOfAllTab);
    const plan = planLeaderDelivery(
      tab ? { id: tab.id, remoteId: tab.remoteId, claudeSessionId: tab.claudeSessionId, state: semaphoreStates[tab.id]?.state, exited: tabExits[tab.id] !== undefined } : undefined,
      wantedRemoteId,
    );

    if (plan.kind === 'send') {
      sendTo(plan.tabId, text);
      return { ok: true };
    }
    if (plan.kind === 'reconnect') {
      // The same conversation, where it was: on a remote place this reattaches to the same CLI in its tmux.
      liderTabRef.current = plan.tabId;
      terminalRefs.current[plan.tabId]?.respawn({ resume: plan.sessionId });
      sendTo(plan.tabId, text);
      return { ok: true };
    }
    if (plan.kind === 'move' && tab) {
      const oldTabId = plan.tabId;
      const cwd = tab.cwd;
      const move = startLeaderMove(oldTabId, text, {
        carry: () => window.donel.lider.carry({ sessionId: plan.sessionId, ...(cwd ? { cwd } : {}), ...(tab.remoteId ? { from: tab.remoteId } : {}), ...(wantedRemoteId ? { to: wantedRemoteId } : {}) }),
        openNew: () => openLeader({ sessionId: plan.sessionId, cwd }),
        deliverFirst: (tabId, first) =>
          new Promise<boolean>((resolve) => {
            liderTabDiedRef.current[tabId] = () => resolve(false);
            void sendToTabAndWait(tabId, { terminal: () => terminalRefs.current[tabId] ?? null }, { text: first }, LIDER_MOVE_WAIT_MS).then((outcome) =>
              resolve(outcome.kind === 'entrou' || outcome.kind === 'na-fila'),
            );
          }).finally(() => {
            delete liderTabDiedRef.current[tabId];
          }),
        send: sendTo,
        close: (tabId) => closeTabImmediatelyRef.current(tabId),
        adopt: (tabId) => {
          liderTabRef.current = tabId;
        },
        notify: (message) => setDevModeToast(message),
      });
      liderMoveRef.current = move;
      void move.done.finally(() => {
        if (liderMoveRef.current === move) liderMoveRef.current = null;
      });
      return { ok: true };
    }
    try {
      const tabId = openLeader();
      liderTabRef.current = tabId;
      sendTo(tabId, text);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };
  useEffect(() => window.donel.lider.onDeliver(({ text }, reply) => reply(liderDeliverRef.current(text))), []);
  useEffect(
    () =>
      window.donel.lider.onActivateTab(({ tabId }) => {
        focusTab(tabId);
        setAppMode('geral');
      }),
    [],
  );

  // Mindscape, fatia 03 — post-it written by the session at each end of turn.
  // The project and the name come from the live tab; a session that is no
  // longer open falls back to the board that already holds its card.
  const mindscapeSessionsRef = useRef(mindscapeSessions);
  mindscapeSessionsRef.current = mindscapeSessions;
  useEffect(() => {
    if (!mindscapeLoaded) return undefined;
    return window.donel.mindscape.onTurnEnded(({ sessionId, text, at }) => {
      const live = mindscapeSessionsRef.current.find((session) => session.sessionId === sessionId);
      applyMindscapeSession((doc) => {
        const projectPath = live?.projectPath ?? findSessionBoard(doc, sessionId);
        if (!projectPath) return doc;
        const previous = doc.boards[projectPath]?.cards[`note:${sessionId}`];
        const sessionName = live?.name ?? (previous?.kind === 'session-note' ? previous.sessionName : sessionId);
        return writeSessionNote(doc, projectPath, { sessionId, sessionName, text, writtenAt: at });
      });
      // Quadro por MCP (D) — the sessions with an arrow to this one (or that opened it) hear that it ended.
      agentBridgeRef.current.turnEnded(sessionId, text);
    });
  }, [mindscapeLoaded, applyMindscapeSession]);

  // Quadro por MCP (items 08/13 + B37) — the board and session tools of the MCP server `donel`. The main relays
  // each call here (main/board-bridge.ts); the bridge reads and changes the document through the same doors as
  // the owner (one undoable gesture per batch) and opens tabs like a place of the board does.
  const [spawnAsks, setSpawnAsks] = useState<readonly SpawnAsk[]>([]);
  const pendingFirstMessagesRef = useRef<Record<string, string>>({});
  const agentPorts: AgentBridgePorts = {
    loaded: mindscapeLoaded,
    doc: () => mindscape.doc,
    applyGesture: (projectPath, reducer) => applyMindscape(projectPath, reducer),
    tabs: () => tabsRef.current,
    tabOfPty: (ptyId) => tabsRef.current.find((tab) => chatPtyIds[tab.id] === ptyId),
    stateOf: (tabId) => (tabExits[tabId] !== undefined || !tabsRef.current.some((tab) => tab.id === tabId) ? undefined : (semaphoreStates[tabId]?.state ?? 'working')),
    linkLost: (tabId) => tabLinkLost(tabId),
    relinkTools: (tabId) => {
      const ptyId = tabExits[tabId] === undefined ? chatPtyIds[tabId] : undefined;
      return ptyId ? window.donel.pty.relinkTools(ptyId) : Promise.resolve({ ok: false, text: 'a aba dela não tem processo vivo.' });
    },
    roles: () => roles,
    openSession: (request) => {
      const defaults = appConfig?.launcherDefaults;
      const providerId = request.role.engine && providers.some((provider) => provider.id === request.role.engine) ? request.role.engine : undefined;
      const tabId = addTab(
        {
          name: request.name,
          cwd: request.projectPath,
          projectName: request.projectName ?? request.projectPath.split(/[\\/]/).filter(Boolean).pop(),
          pinned: false,
          launchArgs: buildLauncherArgs({
            providerId,
            model: request.role.model ?? defaults?.model ?? DEFAULT_MODEL_ALIAS,
            effort: request.role.effort ?? defaults?.effort ?? DEFAULT_EFFORT_LEVEL,
            permissionMode: request.role.permissionMode ?? defaults?.permissionMode ?? 'acceptEdits',
            sessionName: request.name,
          }),
          sessionType: 'claude',
          providerId,
          ...(request.remoteId ? { remoteId: request.remoteId } : {}),
          roleId: request.role.id,
          placeId: request.placeId,
          openedBySession: true,
          openedBy: request.openedBy,
        },
        false,
      );
      pendingFirstMessagesRef.current[tabId] = request.firstMessage;
      return tabId;
    },
    // t-1293c818 — `sessao_retomar`: the owner's two clicks on a dormant place, without his focus.
    resumePlace: (request) =>
      new Promise((resolve) => {
        const opener = request.openedBy ? { openedBy: request.openedBy } : {};
        if (!request.sessionId) {
          const started = startPlaceTab(request.placeId, request.projectPath, { ...opener, mayOpenOn: request.mayOpenOn });
          if (!started) resolve({ ok: false, reason: 'o lugar não está mais no quadro' });
          else if ('refused' in started) resolve({ ok: false, reason: started.refused });
          else resolve({ ok: true, ...started });
          return;
        }
        const sessionId = request.sessionId;
        const name = appConfig?.sessionNames[sessionId]?.name ?? request.name;
        openWhereItLives(
          sessionId,
          request.projectPath,
          (remote) => {
            const refused = request.mayOpenOn(remote.remoteId);
            if (refused) resolve({ ok: false, reason: refused });
            else resolve({ ok: true, tabId: resumeTab(sessionId, request.projectPath, name, remote, { placeId: request.placeId, ...opener }), ...remote });
          },
          (reason) => resolve({ ok: false, reason }),
        );
      }),
    closeTab: (tabId) => closeTabImmediatelyRef.current(tabId),
    sendLine: (tabId, text) => sendRenewalLine(tabId, text, 'session'),
    deliverLine: (tabId, text, waitMs, from) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (tab !== undefined && hasChatView(tab, chatEnabled))
        return sendToTabAndWait(tabId, { terminal: () => terminalRefs.current[tabId] ?? null }, { text: from === 'session' ? withNoPipelineTag(text) : text, from }, waitMs);
      sendRenewalLine(tabId, text, from === 'session' ? 'session' : undefined);
      return Promise.resolve({ kind: 'pelo-terminal' as const });
    },
    // t-1293c818 (3) — the Líder reads and answers a permission open on this tab (the held hook first, else the screen).
    // `permissionOnScreen` comes from here too: only the dialog that is the last block of the screen, crossed with the
    // session's hook state (Revisor, #406).
    ...permissionPorts({
      held: async (tabId) => {
        const ptyId = chatPtyIds[tabId];
        return ptyId ? window.donel.chat.openPermissions(ptyId) : [];
      },
      answerHeld: async (tabId, pendingId, answer) => {
        const ptyId = chatPtyIds[tabId];
        if (!ptyId) return { ok: false };
        return window.donel.chat.answer(ptyId, pendingId, answer === 'allow' ? { kind: 'allow' } : { kind: 'deny', reason: LEADER_DENY_REASON });
      },
      screen: (tabId) => terminalRefs.current[tabId]?.readScreen().lines,
      write: (tabId, data) => terminalRefs.current[tabId]?.write(data) ?? false,
      state: (tabId) => (semaphoreStates[tabId]?.unconfirmed ? undefined : semaphoreStates[tabId]?.state),
    }),
    // No hook yet is not "never started" when the CLI already took a message (the transcript showed it): a session on a
    // remote place whose hooks do not come back was told "não começou" with five answers in its transcript (07/11).
    unconfirmed: (tabId) => (semaphoreStates[tabId]?.unconfirmed === true || semaphoreStates[tabId] === undefined) && !tabTookMessage(tabId),
    startTrouble: (tabId) => {
      if (tabExits[tabId] !== undefined) return 'o Claude de lá foi encerrado';
      const failed = startFailuresRef.current[tabId];
      if (failed !== undefined) return `o terminal dela não abriu (${failed})`;
      const sending = pendingSendReason(tabId);
      if (aliveTabs[tabId] !== true) return `o terminal dela não chegou a abrir${sending !== null ? '; o pedido espera por ele' : ''}`;
      if (sending !== null) return `o pedido ainda está a caminho (${sending})`;
      const lines = terminalRefs.current[tabId]?.readScreen().lines;
      if (lines === undefined) return null;
      const dialog = blockingScreen(lines);
      if (dialog) return `a tela dela mostra «${dialog.title}» e espera alguém responder`;
      const box = readInputText(lines);
      if (box === null) return 'a caixa de entrada do Claude não apareceu na tela dela';
      if (box !== '') return 'o pedido ficou na caixa do terminal dela sem ser enviado';
      return null;
    },
    openCap: () => appConfig?.team.openCap ?? null,
    askOwner: (question) =>
      new Promise<boolean>((resolve) => {
        const id = crypto.randomUUID();
        setSpawnAsks((prev) => [...prev, { id, ...question, resolve }]);
      }),
    remoteLabel: (remoteId) => accountsView.remotes.find((remote) => remote.id === remoteId)?.label ?? remoteId,
    remotes: () => accountsView.remotes.map((remote) => ({ id: remote.id, label: remote.label })),
    routing: () => appConfig?.team.routing ?? null,
    projects: () => projects.map((project) => ({ path: project.path, name: project.name })),
    passOn: (requests) => window.donel.ledger.passOn(requests),
    stateEnteredAt: (tabId) => semaphoreStates[tabId]?.stateEnteredAt,
    logFaxineiro: (entries) => window.donel.faxineiro.log(entries),
    // 08/11 — the end of a turn goes to the ledger, not to a Líder's chat (Preferências can turn the old mode back on).
    turnNotices: () => appConfig?.team.turnNotices ?? 'ledger',
    recordTurn: (record) => window.donel.ledger.turnEnded(record).catch((): LedgerTurnRecorded => 'falhou'),
    turnFailureOf: (tabId) => semaphoreStates[tabId]?.turnFailure,
  };
  const agentBridgeRef = useRef<AgentBridge>(null as unknown as AgentBridge);
  if (agentBridgeRef.current === null) agentBridgeRef.current = new AgentBridge(agentPorts);
  agentBridgeRef.current.setPorts(agentPorts);
  // Sessão durável (dono, 12/11: "notificar todas as sessões trabalhando que impedem a nossa atualização") — once the
  // owner clicked Atualizar, each session in a turn is asked, once, to close it and save its state before the deadline.
  // A chat tab takes the notice mid-turn (the CLI queues it). A terminal tab types only at an idle prompt and a new line
  // there replaces one still waiting for it: it gets the notice once its turn ended and that line went.
  const updateWarnedRef = useRef<Set<string>>(new Set());
  const updateBlockersRef = useRef<Set<string>>(new Set());
  const updateRemainingMs = updateTiming?.remainingMs;
  useEffect(() => {
    if (!updateRequested) {
      updateWarnedRef.current = new Set();
      updateBlockersRef.current = new Set();
      return;
    }
    if (updateApplying || updateRemainingMs === undefined) return;
    const inTurn = new Set(sessionsToWarn(updateSessionInputs));
    for (const tabId of inTurn) updateBlockersRef.current.add(tabId);
    const minutes = Math.max(1, Math.ceil(updateRemainingMs / 60_000));
    for (const tabId of updateBlockersRef.current) {
      if (updateWarnedRef.current.has(tabId)) continue;
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (!tab || aliveTabs[tabId] !== true) continue;
      if (!hasChatView(tab, chatEnabled) && (inTurn.has(tabId) || armWatchersRef.current[tabId] !== undefined)) continue;
      updateWarnedRef.current.add(tabId);
      const retry = (): void => {
        updateWarnedRef.current.delete(tabId);
      };
      void agentPorts
        .deliverLine(
          tabId,
          `◆ O app vai reiniciar para instalar a versão nova em até ${minutes} min. Feche o turno num ponto seguro e salve o estado agora: registre o andamento no ledger (tarefa_andamento) e atualize a sua nota de handoff, se tiver uma. Depois do reinício o app retoma esta mesma conversa; se o turno não fechar até lá, ele reinicia mesmo assim.`,
          60_000,
          'session',
        )
        .then((outcome) => {
          if (outcome.kind === 'nao-foi') retry();
        })
        .catch(retry);
    }
    // `agentPorts` is rebuilt every render; each session is told once (the refs), retried only when it did not go in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateRequested, updateApplying, updateNow, updateSessionInputs]);
  // 08/11 — what cannot wait for the Líder's read of the ledger (a permission open, a failed turn) is told at once by
  // the bridge, from the semaphore the app already has; the bridge tells each situation once.
  useEffect(() => {
    for (const tabId of Object.keys(semaphoreStates)) agentBridgeRef.current.attention(tabId);
  }, [semaphoreStates]);
  // A Líder that comes back from "sem ligação" changes no state: what waited for it is tried again every half minute.
  useEffect(() => {
    const timer = setInterval(() => agentBridgeRef.current.flushUrgent(), 30_000);
    return () => clearInterval(timer);
  }, []);
  // t-e753b554 — a place that never started passes its live tasks on (the main waits 30 min after the last event).
  useEffect(() => {
    const timer = setInterval(() => void agentBridgeRef.current.checkNotStarted(), 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  // t-b3b26e60 — Faxineiro com gatilhos: once a minute the main judges the machines and the open sessions, and the
  // bridge wakes the Faxineiro of a board (or closes one that finished its round). One round at a time.
  useEffect(() => {
    let running = false;
    const round = async (): Promise<void> => {
      if (running) return;
      running = true;
      try {
        const bridge = agentBridgeRef.current;
        const answer = await window.donel.faxineiro.round(bridge.faxineiroSessions());
        bridge.setFullMachines(answer.fullMachines, answer.openingRoom);
        const entries: FaxineiroLogEntry[] = [...bridge.drainQueue()];
        for (const close of answer.closeIdle) {
          const closed = bridge.closeIdleFaxineiro(close.projectPath, close.placeId);
          if (closed) entries.push(closed);
        }
        for (const wake of answer.wakes) entries.push(await bridge.wakeFaxineiro(wake));
        if (entries.length > 0) window.donel.faxineiro.log(entries);
      } catch (error) {
        console.error('[donel-dev] faxineiro: rodada falhou', error);
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => void round(), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const bridge = agentBridgeRef.current;
    const off = window.donel.mindscape.onBoardRequest(({ requestId, ptyId, call, answerBy }) => {
      void bridge.handle(ptyId, call, answerBy).then((answer) => window.donel.mindscape.respondBoard({ requestId, ...answer }));
    });
    // Cartas forma A — what the owner wrote on a card goes to the session that owns the task (or the Líder).
    const offOwner = window.donel.mindscape.onOwnerMessage(({ requestId, ...message }) => {
      void bridge
        .deliverOwnerMessage(message)
        .catch(() => null)
        .then((deliveredTo) => window.donel.mindscape.respondOwnerMessage({ requestId, deliveredTo }));
    });
    return () => {
      off();
      offOwner();
      bridge.dispose();
    };
  }, []);
  // The first message of a session opened by `sessao_abrir`: as soon as its tab is in the list.
  useEffect(() => {
    for (const [tabId, text] of Object.entries(pendingFirstMessagesRef.current)) {
      if (!tabs.some((tab) => tab.id === tabId)) continue;
      delete pendingFirstMessagesRef.current[tabId];
      // The request of the session that opened it, not the owner's: the pipeline router leaves it alone.
      sendRenewalLine(tabId, withNoPipelineTag(text));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);
  const answerSpawnAsk = (id: string, allowed: boolean): void => {
    setSpawnAsks((prev) => {
      prev.find((ask) => ask.id === id)?.resolve(allowed);
      return prev.filter((ask) => ask.id !== id);
    });
  };
  // Mindscape, fatia 04 — moving the view is not an action on the board: out of the history.
  // Desenho, fatia 05 — pan and zoom together (setBoardView), each change computed
  // from the board as it is NOW (several wheel events in a row compose).
  const handleMindscapeView = useCallback(
    (projectPath: string, change: (view: BoardView) => BoardView): void =>
      applyMindscapeSession((doc) => {
        const board = doc.boards[projectPath];
        return board ? setBoardView(doc, projectPath, change({ pan: board.pan, zoom: board.zoom })) : doc;
      }),
    [applyMindscapeSession],
  );
  // Desenho, fatia 02 — the single door of every owner action on the board
  // (post-its, links, drawings): each one is an entry of the board history.
  const handleMindscapeAction = useCallback(
    (projectPath: string, reducer: (doc: MindscapeDoc) => MindscapeDoc): void => applyMindscape(projectPath, reducer),
    [applyMindscape],
  );

  // Só os Líderes nas abas — the sessions opened by another one are out of the list (they live in the Mindscape),
  // but Ctrl+Tab still reaches one that waits for the owner.
  const allSidebarSessions: SidebarSession[] = tabs
    .filter((tab) => !(tab.claudeSessionId && registeredFavoriteIds.has(tab.claudeSessionId)))
    .map((tab) => ({
      id: tab.id,
      name: resolveTabName(tab),
      projectName: tab.projectName,
      state: semaphoreStates[tab.id]?.state ?? 'working',
      stateEnteredAt: semaphoreStates[tab.id]?.stateEnteredAt,
      ...(chatEnabled && tab.sessionType === 'claude' && semaphoreStates[tab.id]?.state === 'permission' ? { statusText: 'esperando você' } : {}),
      pinned: tab.pinned,
      active: tab.id === activeTabId,
      cwd: tab.cwd,
    }));
  const listedTabIds = new Set(tabs.filter(isTabListed).map((tab) => tab.id));
  const sidebarSessions = allSidebarSessions.filter((session) => listedTabIds.has(session.id));

  /**
   * T708/T709 (007) — grupo "Favoritos": um projeto por linha, colapsável
   * (CA-1), com o cabeçalho mostrando o PIOR estado das abas vivas dele (CA-6,
   * `worstState` reusa a precedência de `sessionOrdering.ts`) — é o que
   * impede o dedupe acima de esconder uma sessão em `permission` dentro de um
   * grupo colapsado (conflito nº 1 do discovery). Rótulo de cada linha:
   * `registry.label` (cache do CA-7), substituído pelo nome resolvido AO VIVO
   * quando a sessão já tem aba aberta (dado fresco de graça).
   */
  const favoriteGroups: FavoriteProjectGroup[] = useMemo(() => {
    const registry = appConfig?.sessionRegistry ?? {};
    const collapsedSet = new Set(appConfig?.collapsedFavorites ?? []);
    return projects
      .filter((project) => project.favorite)
      .map((project) => {
        const liveTabs = tabs.filter((tab) => tab.sessionType === 'claude' && tab.cwd === project.path);
        const liveStates = liveTabs.map((tab) => semaphoreStates[tab.id]?.state ?? 'working');
        const sessions: FavoriteSessionRow[] = selectProjectSessions(registry, project.path).map((entry) => {
          const liveTab = tabs.find((tab) => tab.claudeSessionId === entry.sessionId);
          return { sessionId: entry.sessionId, label: liveTab ? resolveTabName(liveTab) : entry.label, pinned: entry.pinned };
        });
        return {
          project,
          collapsed: collapsedSet.has(project.path),
          loading: seedingProjects.has(project.path),
          sessions,
          liveState: worstState(liveStates),
          liveCount: liveTabs.length,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, appConfig, tabs, semaphoreStates, seedingProjects]);

  // Sidebar — "Abrir no editor" + branch das pastas visíveis (sessões abertas e favoritos).
  const workspacePaths = useMemo(
    () => [...sidebarSessions.flatMap((session) => (session.cwd ? [session.cwd] : [])), ...favoriteGroups.map((group) => group.project.path)],
    [sidebarSessions, favoriteGroups],
  );
  const workspaceInfo = useWorkspaceInfo(workspacePaths);
  // B3 — PR da branch de cada pasta da sidebar; o "consertar" vai para uma aba do Claude daquela pasta.
  const pullRequestsInfo = usePullRequests(workspacePaths, workspaceInfo.branches);
  const fixTabFor = useCallback(
    (path: string, preferredTabId?: string): string | null => {
      const claudeTabs = tabs.filter((tab) => tab.sessionType === 'claude' && !tab.accountLoginId && tab.cwd === path);
      return (claudeTabs.find((tab) => tab.id === preferredTabId) ?? claudeTabs.find((tab) => tab.id === activeTabId) ?? claudeTabs[0])?.id ?? null;
    },
    [tabs, activeTabId],
  );
  const handleSendPullRequestFix = useCallback((tabId: string, text: string): void => {
    focusTab(tabId);
    // Mesmo caminho da caixa do chat (fila única, espera o CLI, confirma o aceite): nunca escrita direta no PTY.
    const source = { terminal: () => terminalRefs.current[tabId] ?? null };
    const id = sendToTab(tabId, source, { text });
    const driver = sendDriverFor(tabId, source);
    const off = driver.subscribe(() => {
      const item = driver.getItems().find((candidate) => candidate.id === id);
      if (item === undefined || item.state === 'accepted' || item.state === 'queued') return off();
      if (item.state === 'failed') {
        off();
        setDevModeToast(`Não consegui mandar o pedido de conserto para a aba (${item.reason ?? 'sem motivo'}). Tente de novo pelo painel do PR.`);
      }
    });
  }, []);
  const sidebarWorkspace = useMemo(
    () => ({
      editor: workspaceInfo.editor,
      branches: workspaceInfo.branches,
      onOpenInEditor: workspaceInfo.openInEditor,
      pullRequests: {
        byPath: pullRequestsInfo.pullRequests,
        fixTabFor,
        onLoadDetails: pullRequestsInfo.loadDetails,
        onOpenUrl: (url: string) => void window.donel.workspace.openPullRequestUrl(url).catch(() => undefined),
        onSendFix: handleSendPullRequestFix,
      },
    }),
    [workspaceInfo.editor, workspaceInfo.branches, workspaceInfo.openInEditor, pullRequestsInfo.pullRequests, pullRequestsInfo.loadDetails, fixTabFor, handleSendPullRequestFix],
  );

  // Mesma ordenação da sidebar (sessionOrdering.ts) — FR-013 usa essa lista
  // ranqueada tanto pro Ctrl+1..9 (posição N) quanto pro Ctrl+Tab (próxima
  // sessão que precisa de atenção).
  const orderedSessions = useMemo(() => sortSessions(sidebarSessions), [sidebarSessions]);
  const attentionSessions = useMemo(() => sortSessions(allSidebarSessions), [allSidebarSessions]);

  // FR-013 — Ctrl+1..9 foca a sessão na posição N da lista ranqueada;
  // Ctrl+Tab foca a próxima que precisa de atenção (permissão > aguardando).
  // Capture na fase de captura + preventDefault/stopPropagation: sem isso o
  // xterm embaixo (foco na aba ativa) recebe as teclas como input normal do
  // terminal em vez do atalho do app.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      // T056 (014-chat) — Ctrl+` alterna Chat | Terminal (capture, como os demais: o xterm
      // embaixo não pode receber a tecla). Aba sem vista de chat deixa passar.
      if (shouldHandleViewShortcut(event)) {
        if (toggleActiveTabViewRef.current()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      // Oráculo no centro — Ctrl+Shift+O alternates Oráculo | Terminais (physical key: any layout).
      if (event.shiftKey && event.code === 'KeyO') {
        if (toggleCenterViewRef.current()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === 'Tab') {
        const target = nextAttentionSessionId(attentionSessions, activeTabIdRef.current);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        focusTab(target);
        return;
      }

      const position = Number(event.key);
      if (Number.isInteger(position) && position >= 1 && position <= 9) {
        const target = sessionIdAtPosition(orderedSessions, position);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        focusTab(target);
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [orderedSessions, attentionSessions]);

  // Notificação Windows de sessão (ui-spec §3, FR-010): desde notificacoes-completas (30/10) nasce no main, junto
  // do balão do Jobu, do piscar e do selo da barra de tarefas — uma regra só (src/shared/attention/rule.ts) que sabe
  // o que esta aqui não sabia: o foco da janela, o subagente vivo (#109) e a falha de API (`StopFailure`).

  // C2 (015-jobu-pet, R4) — ptyId -> tab.id for the gestures that arrive from the main (a click on a notification,
  // a click on the Jobu). Built from `chatPtyIds`, the LAST ptyId of every tab, with no filter by `tabExits`: the
  // tab of a process that ended is still there with its "Sessão encerrada" bar, and "encerrou" must lead to it.
  // It is read when the gesture arrives, so a ref assigned on every render, like `toggleActiveTabViewRef`.
  const ptyActivationMapRef = useRef<TabPtyMap>(tabPtyMap([], () => null));
  ptyActivationMapRef.current = tabPtyMap(tabs, (tabId) => chatPtyIds[tabId] ?? null);

  // T079 (014-chat) — o main decide notificar pela aba ativa e pelo foco da janela (que ele lê sozinho);
  // o renderer só informa a aba ativa e os nomes das abas (título da notificação).
  // C2 (015-jobu-pet): both go by ptyId, as the contract says - the main compares the tab in front with the
  // ptyId of the pending. They used to go by `tab.id`, which is never a ptyId, so the notification was raised
  // even for the tab in front, and titled "Donel Dev".
  useEffect(() => {
    if (!chatEnabled) return;
    const focus = buildChatFocusState(tabs, (tabId) => chatPtyIds[tabId] ?? null, resolveTabName, activeTabId);
    getChatStore().reportFocusState(focus.activePtyId, focus.tabNames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatEnabled, tabs, activeTabId, chatPtyIds, appConfig?.sessionNames]);

  // T079 — clique na notificação: ativa a aba, abre a vista Chat e avisa o painel de pendências (evento de DOM
  // `donel:chat-focus-pending`, `detail: { ptyId }`) para tomar o foco.
  // C2 (015-jobu-pet): the main sends the ptyId and the tab to activate is the one the map gives for it; the ptyId
  // used to be taken as the `tab.id`, so the click on the notification activated nothing.
  useEffect(() => {
    if (!chatEnabled) return undefined;
    return window.donel.chat.onFocusPending(({ ptyId }) => {
      const tabId = ptyActivationMapRef.current.tabIdOf(ptyId);
      if (tabId === null) return; // the tab closed on the way
      focusTab(tabId);
      setTabView(tabId, 'chat');
      window.dispatchEvent(new CustomEvent('donel:chat-focus-pending', { detail: { ptyId } }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatEnabled]);

  // T021 (015-jobu-pet, R4) — the Jobu lives in the main process and only knows ptyIds: this effect tells it which `claude`
  // tabs have a PTY, the name each one shows and which one is in front. It is ALWAYS on (with or without the chat,
  // with the pet on or not): the main keeps the last state, so turning the pet on later finds it ready.
  // Dedupe by JSON: the effect re-evaluates on every semaphore tick, the channel only when something really changed.
  // `chatPtyIds` keeps the tab's LAST ptyId (the conversation stays readable after the exit), but a tab whose
  // process ended (`tabExits`) has no PTY: its ptyId is dead and does not count as a session.
  const lastPetTabsJsonRef = useRef<string | null>(null);
  useEffect(() => {
    const ptyIdOf = (tabId: string): string | null => (tabExits[tabId] === undefined ? (chatPtyIds[tabId] ?? null) : null);
    const payload = buildPetTabsPayload(tabs, ptyIdOf, resolveTabName, activeTabId);
    const json = JSON.stringify(payload);
    if (json === lastPetTabsJsonRef.current) return;
    lastPetTabsJsonRef.current = json;
    window.donel.pet.sendTabs(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, chatPtyIds, tabExits, activeTabId, appConfig?.sessionNames]);

  // T021 — the Jobu sends "activate this session's tab" (the main has already brought the window to the front).
  // The map is the activation one (`ptyActivationMapRef`, above), which also sees the tab of a process that ended;
  // a ptyId that is no tab's anymore (the tab closed on the way) does nothing.
  useEffect(() => {
    return window.donel.pet.onActivateSession(({ ptyId }) => {
      const tabId = ptyActivationMapRef.current.tabIdOf(ptyId);
      if (tabId !== null) focusTab(tabId);
    });
  }, []);

  // T021 (R19) — the main changed `pet.enabled` (Preferences or, later, "Esconder"): the renderer has no config push,
  // so this notice keeps `appConfig.pet` up to date (the Preferences switch and the suppression of the toasts).
  useEffect(() => {
    return window.donel.pet.onPrefsChanged(({ enabled }) => {
      setAppConfig((previous) =>
        previous === null || previous.pet.enabled === enabled ? previous : { ...previous, pet: { ...previous.pet, enabled } },
      );
    });
  }, []);

  // FIX (feedback E2E rodada 3) — painel colapsável: "fecha ao... Esc".
  // Efeito próprio (não reaproveita o listener de atalhos Ctrl+1..9/Ctrl+Tab
  // acima — aquele é `capture` + exige Ctrl; Esc aqui é global e só importa
  // quando o painel está aberto, sem interferir no Esc que o SplitButton já
  // trata internamente pro PRÓPRIO dropdown, nem no Esc do Modal.tsx).
  useEffect(() => {
    if (!launcherOpen) return undefined;
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setLauncherOpen(false);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [launcherOpen]);

  // T011 — aba em foco, pra decidir se a toolbar de Modelo/Esforço aparece (só sessões 'claude').
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  // Segundo plano visível — the status bar's overview, one entry per tab with something in the background.
  const backgroundSessions: BackgroundSession[] = tabs.flatMap((tab) => {
    const ptyId = chatPtyIds[tab.id];
    const tasks = ptyId ? backgroundByPty[ptyId] : undefined;
    return ptyId && tasks && tasks.length > 0 ? [{ tabId: tab.id, ptyId, name: resolveTabName(tab), tasks }] : [];
  });
  const handleOpenBackground = (session: BackgroundSession, task: { readonly rowId: string } | null): void => {
    setAppMode('geral');
    focusTab(session.tabId);
    const tab = tabs.find((candidate) => candidate.id === session.tabId);
    if (tab && hasChatView(tab, chatEnabled)) setTabView(tab.id, 'chat');
    if (task) revealRow(session.ptyId, task.rowId);
  };


  // FIX (T015, FR-009 "statusbar completa") — era hardcoded "fable/high"
  // (sempre o mesmo texto, ignorando a aba real): agora reflete o
  // modelo/esforço de VERDADE da aba em foco (`sessionModelEffort`, já
  // mantido pelo T011/T013), e some quando a aba ativa não é uma sessão
  // claude (terminal livre não tem os dois campos — `StatusBar` omite o
  // separador quando `modelEffort` é `undefined`).
  // FIX (teste manual 27/07) — com a toolbar SessionDetails removida, o rodapé
  // é a única leitura de modelo/esforço; ganha também o contexto REAL do último
  // turno (T610, transcript-watcher — nunca estimado, some sem leitura).
  // CA-22 (009) — "o acompanhamento de contexto % sumiu". O que existia até
  // aqui era o token bruto (`ctx 135k`), herdado do teste manual de 27/07: sem
  // denominador, 135k não responde "dá pra continuar nesta sessão?". Volta o
  // `%` da smart zone, na forma que o design já previa para o rodapé (o
  // `SmartZoneMeter` compacto do slot `smartZone` da StatusBar, que a app nunca
  // tinha ligado), com a régua real da 006: `min(500k, janela do modelo)`.
  //
  // O denominador segue sendo `min(500k, janela)` — a decisão de 24/07 dele —
  // e NÃO o default de 400k do design-system. Desde a issue #21 a janela é a do
  // modelo REAL da sessão (`resolveSessionModel`), não a do alias do launch.
  const activeContextTokens = activeTab?.claudeSessionId ? (contextTokens[activeTab.claudeSessionId] ?? null) : null;
  const activeClaudeTab = activeTab && activeTab.sessionType === 'claude' ? activeTab : null;
  // Oráculo no centro — the switch exists in "Uso geral" with the new layout; the Oráculo shows when chosen. The
  // Líder único leaves the tab bar (the owner talks to it through the Jobu): "Conversa do Líder" brings it, and while
  // it is the tab in front it stays in the bar.
  const oracleLayoutOn = layoutPrefs.oracleCenter && appMode === 'geral';
  const oracleShown = oracleLayoutOn && showsOracle(layoutPrefs);
  /** The center shows `view`. Going to the terminals with no tab in front brings one (the Líder if it is the only one). */
  const setCenterView = (view: LayoutPrefs['centerView']): void => {
    if (view === 'terminals' && !tabs.some((tab) => tab.id === activeTabId && isTabListed(tab))) {
      const first = tabs.find((tab) => isTabListed(tab) && !isLeaderOfAllTab(tab)) ?? tabs.find(isTabListed);
      if (first) setActiveTabId(first.id);
    }
    changeLayoutPrefs({ centerView: view });
  };
  toggleCenterViewRef.current = (): boolean => {
    if (!oracleLayoutOn) return false;
    setCenterView(toggleCenterView(layoutPrefs).centerView);
    return true;
  };
  const hiddenFromTabBar = (tab: TabState): boolean => oracleLayoutOn && isLeaderOfAllTab(tab) && (oracleShown || tab.id !== activeTabId);
  // Ledger v5, fatia 1 — the orphans of the box "Esperando você" read the places as `tarefa_listar` does; before the
  // board loads every place would look closed, so no orphan is called until then.
  const ledgerPlaceStatesOf = (projectPaths: readonly string[]): Map<string, Map<string, string>> =>
    mindscapeLoaded ? agentBridgeRef.current.placeStates(projectPaths) : new Map();
  const oraclePlaceName: PlaceNameOf = (projectPath, placeId) => {
    const card = mindscape.doc.boards[projectPath]?.cards[placeId];
    if (card?.kind !== 'session' || !card.sessionId) return undefined;
    const sessionId = card.sessionId;
    return mindscapeSessions.find((session) => session.sessionId === sessionId)?.name ?? mindscapeStoredNameOf(sessionId) ?? undefined;
  };
  // T056 — a aba ativa tem vista de chat? (D-C22: o chat só ACRESCENTA controles ao cabeçalho, e só em aba claude.)
  const activeChatTab = activeTab && hasChatView(activeTab, chatEnabled) ? activeTab : null;
  const activeChatView = activeChatTab ? effectiveTabView(activeChatTab, chatEnabled) : null;
  // Issue #21 — o modelo exibido (e a régua do medidor) é o da última resposta
  // do assistente no transcript; o do launch só vale até a primeira resposta.
  // Ponte da statusline — a leitura OFICIAL do CLI da aba (modelo, esforço, tokens e
  // janela de contexto) vai na frente do que o transcript e o launch inferem; sem ela
  // (sessão sem a ponte), o rodapé é exatamente o de antes.
  const activePtyId = activeClaudeTab && tabExits[activeClaudeTab.id] === undefined ? (chatPtyIds[activeClaudeTab.id] ?? null) : null;
  const activeStatusLine = activeClaudeTab
    ? statusLineForSession(activePtyId ? statusLines[activePtyId] : null, activeClaudeTab.claudeSessionId)
    : null;
  const activeModel = activeClaudeTab
    ? resolveSessionMeter({
        transcriptModelId: activeClaudeTab.claudeSessionId ? sessionModels[activeClaudeTab.claudeSessionId] : null,
        transcriptTokens: activeContextTokens,
        launchAlias: sessionModelEffort[activeClaudeTab.id]?.model ?? DEFAULT_MODEL_ALIAS,
        statusLine: activeStatusLine,
      })
    : null;
  const activeModelEffort = activeClaudeTab && activeModel
    ? `${activeModel.label}/${activeStatusLine?.effortLevel ?? sessionModelEffort[activeClaudeTab.id]?.effort ?? DEFAULT_EFFORT_LEVEL}`
    : undefined;
  // Sem leitura ainda (ou aba shell) o medidor NÃO aparece — nunca um `0%`
  // fabricado no lugar de "não há leitura" (CA-4 da 006).
  const activeSmartZone =
    activeModel !== null && activeModel.usedTokens !== null
      ? { usedTokens: activeModel.usedTokens, maxTokens: activeModel.contextZone }
      : undefined;
  // Cota que o CLI da aba leu — só se a leitura veio de resposta da API DEPOIS da última
  // troca de conta (antes disso ela é da conta anterior). A troca é anotada no próprio
  // render em que aparece, para esse mesmo render já descartar a leitura velha.
  if (lastActiveAccountIdRef.current !== accountsView.activeAccountId) {
    if (lastActiveAccountIdRef.current !== undefined) lastAccountSwitchAtRef.current = Date.now();
    lastActiveAccountIdRef.current = accountsView.activeAccountId;
  }
  const activeLiveLoad =
    activeStatusLine && activeStatusLine.apiActivityAt >= lastAccountSwitchAtRef.current
      ? statusLineRateLimitPercents(activeStatusLine, Date.now())
      : null;

  // T1221 (011-contas-e-provedores, etapa 2) — `accountLabel` é o rótulo
  // GLOBAL (badge do titlebar/AccountsPanel, "que conta a PRÓXIMA sessão
  // usa"): conta ativa do motor quando ele está ligado; "Motor inerte"
  // enquanto `accounts.mod` for `null` (comportamento de hoje, sem perfis).
  const activeAccountSummary = accountsView.accounts.find((account) => account.id === accountsView.activeAccountId) ?? null;
  const accountLabel = activeAccountSummary?.label ?? (accountsView.mod === null ? 'Motor inerte' : 'Conta ativa');

  // "Statusbar deve mostrar a conta VIGENTE" (011-contas-e-provedores,
  // etapa 3, Fase 2, D1/D2) — deixou de ser a conta com que a sessão em
  // foco foi criada: sessão de conta (sem provider, sem login isolado)
  // segue a troca GLOBAL, rótulo e cota vêm de `current` (montado abaixo a
  // partir do MESMO `accountsView` que alimenta o painel). `accountLabel`
  // acima é só o fallback da janela curta antes de `activeTab` existir (0
  // sessões abertas) ou antes de `current.active` existir (motor inerte);
  // `sessionAccounts[activeTab.id]` continua guardando a conta de
  // NASCIMENTO da aba (`PtyCreateResult.account`) — ela virou insumo só do
  // sufixo "trocou em voo" (ver `computeSessionAccountLabel`), não mais da
  // cota/rótulo principal (isso fecha o C25 de outro jeito: uma unidade só,
  // `AccountLoad`/% consumido, mas agora sempre da conta ATIVA).
  const activeSessionAccount = activeTab ? sessionAccounts[activeTab.id] : undefined;
  // C13/D1 — de onde vem a credencial desta aba: provider (Launcher com
  // provider classe A escolhido, T1320) > login isolado (Fase 1.2, aba do
  // próprio login) > conta do motor (default, comportamento de hoje).
  const activeCredentialSource: 'account' | 'provider' | 'login' = activeTab?.providerId
    ? 'provider'
    : activeTab?.accountLoginId
      ? 'login'
      : 'account';
  const activeProviderLabel = activeTab?.providerId
    ? (providers.find((provider) => provider.id === activeTab.providerId)?.label ?? activeTab.providerId)
    : undefined;
  const activeSessionAccountLabel = activeTab
    ? computeSessionAccountLabel(
        {
          sessionType: activeTab.sessionType,
          account: activeSessionAccount,
          credentialSource: activeCredentialSource,
          providerLabel: activeProviderLabel,
        },
        accountLabel,
        {
          active: activeAccountSummary ? { id: activeAccountSummary.id, label: activeAccountSummary.label } : null,
          load: activeAccountSummary?.load ?? null,
          autoSwitchState: accountsView.autoSwitchState,
          liveLoad: activeLiveLoad,
        },
      )
    : accountLabel;

  // Item 11 (rodada de forma fix/009-board-real-e-modal) — presença de
  // entrada aqui é o sinal de "sessão VIVA agora" (glifo ▶ na coluna SESSÃO
  // de "Sessões anteriores", `PreviousSessions.tsx`); a coluna CONTEXTO que
  // exibia o valor ("312k/400k") foi removida (#26) — o mapa segue existindo
  // só pra essa checagem de presença (`contextTokens` é um push pra abas
  // abertas via `TranscriptChangedPayload` — nunca persistido pro índice de
  // sessões fechadas, `SessionSummaryDto` não carrega esse campo).
  const previousSessionsContextLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tab of tabs) {
      if (tab.sessionType !== 'claude' || !tab.claudeSessionId) continue;
      const used = contextTokens[tab.claudeSessionId];
      if (used === null || used === undefined) continue;
      const { contextZone } = resolveSessionModel(
        sessionModels[tab.claudeSessionId],
        sessionModelEffort[tab.id]?.model ?? DEFAULT_MODEL_ALIAS,
      );
      map[tab.claudeSessionId] = formatSmartZoneLabel(used, contextZone);
    }
    return map;
  }, [tabs, contextTokens, sessionModelEffort, sessionModels]);

  return (
    <div className={styles.shell}>
      <SpawnAskPanel asks={spawnAsks} onAnswer={answerSpawnAsk} />
      <header className={styles.titlebar}>
        <div className={styles.brand}>
          <span aria-hidden="true">◆</span>
          <span>Donel Dev</span>
        </div>
        {/* CA-30 (009-modo-dev-v3, lote 9) — o seletor vive no titlebar, fora
            da coluna da sidebar (que fica oculta no Modo Dev, `zoneHidden`
            abaixo): é a única forma de trocar/criar projeto quando o Modo
            Dev está ligado (mockup linha 1295: "criar projeto é ação do
            nível app, não do projeto aberto"). */}
        <ProjectSwitcher
          projects={projects}
          activeProjectPath={selectedProjectPath}
          projectRoots={appConfig?.projectRoots ?? []}
          onOpenProject={handleOpenProject}
          onProjectsChanged={setProjects}
          loadingProjects={loadingProjects}
          onToggleFavorite={handleToggleFavorite}
          onShowPreviousSessions={handleShowPreviousSessions}
        />
        {/* Item 1 (rodada de forma fix/009-board-real-e-modal) — titlebar v3
            (mockup linhas 39-51): esquerda = marca + pill de projeto (acima);
            CENTRO = SegmentedControl "Uso geral | Dev" entre dois espaçadores
            flex:1, substituindo o rótulo solto "Principal —" + o Toggle
            azul; direita = AccountBadge (AccountsPanel, T1221) + os ícones que já
            existiam. T310/CA-20 — ligar REORGANIZA o layout desta mesma
            janela; desligar volta à tela de hoje, que não é aposentada (nem
            desmontada — mesmo princípio do T007 "todas as abas ficam
            montadas", garante que nenhum PTY é recriado na troca). */}
        <div className={styles.titlebarSpacer} />
        <div className={styles.devModeToggle} data-testid="devmode-toggle">
          <SegmentedControl
            ariaLabel="Modo"
            value={appMode}
            onChange={(next) => setAppMode(next === 'hill' || next === 'mindscape' ? next : 'geral')}
            options={[
              { value: 'geral', label: 'Uso geral' },
              { value: 'hill', label: 'Hill climbing' },
              { value: 'mindscape', label: 'Mindscape' },
            ]}
          />
        </div>
        <div className={styles.titlebarSpacer} />
        {/* T1221 (011-contas-e-provedores, etapa 2) — `AccountsPanel`
            SUBSTITUI o `ProfileSwitcher` (dropdown de perfis): é agora o
            único badge/entrada de troca de conta no titlebar. Nasce inerte
            (accounts.mod = null) quando não há mod conectado — mesmo
            comportamento de sempre, só que sem o dropdown de perfis ao
            lado. */}
        <AccountsPanel onViewChange={handleAccountsViewChange} onStartLogin={handleStartLogin} onLoginEnded={handleLoginEnded} />
        {/* T1321 (011-contas-e-provedores, etapa 3) — gerenciamento do
            registry de providers classe A (criar/editar/remover, gravar
            segredo write-only). Nasce inerte (registry vazio, C14/D6) — o
            trigger sempre aparece, mesmo sem entrada nenhuma (é como um
            provider passa a existir). */}
        <ProviderForm onChanged={refreshProviders} />
        {/* T015 — UI de Preferências (FR-007, feedback E2E rodada 3/4). */}
        <button
          type="button"
          className={styles.preferencesButton}
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          aria-label={sidebarCollapsed ? 'Mostrar barra lateral' : 'Recolher barra lateral'}
          title={sidebarCollapsed ? 'Mostrar barra lateral' : 'Recolher barra lateral'}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={styles.preferencesButton}
          onClick={() => setPreferencesOpen(true)}
          aria-label="Preferências"
          title="Preferências"
        >
          <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {/* "＋ Nova sessão" vale em todos os modos: o Escalador de uma missão é uma sessão comum. */}
        <SplitButton
          label="＋ Nova sessão"
          // FIX (teste manual 27/07) — o corpo do botão passa a ABRIR o
          // Launcher (escolher modelo/esforço/projeto) em vez do quick-launch
          // cego: pedido do dono ("sempre que eu aperte em Nova sessão
          // apareça a barra lateral para escolher o modelo e afins"). O
          // atalho rápido com a última config vira item do dropdown.
          onClick={() => setLauncherOpen(true)}
          items={[
            { label: 'Rápida (última config)', onSelect: handleQuickNewClaudeSession },
            // FIX (feedback E2E rodada 1, "terminal livre confuso") — rótulo
            // explícito no dropdown; "Terminal" sozinho não deixava claro
            // que era um shell livre (sem sessão claude nenhuma).
            { label: 'Terminal (shell livre)', onSelect: handleNewFreeTerminal },
          ]}
        />
      </header>

      <div
        className={[
          styles.body,
          hillOn ? styles.bodyDevMode : '',
          sidebarCollapsed ? styles.bodySidebarCollapsed : '',
          // Clássico sem Launcher: coluna direita (320px, Launcher) zerada.
          !launcherOpen ? styles.bodyRightCollapsed : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Spec 010 — a esteira nova entra POR CIMA, sem desmontar nada: o
            mapa atual segue vivo por baixo (`[P-5]` — ele só sai no fim do
            vertical, quando o novo provar a espinha). */}
        {appMode === 'mindscape' ? (
          <MindscapeScreen
            doc={mindscape.doc}
            sessions={mindscapeSessions}
            projectNames={mindscapeProjectNames}
            initialProjectPath={tabs.find((tab) => tab.id === activeTabId)?.cwd}
            seenAt={mindscapeSeenAt}
            onGoToTerminal={handleMindscapeGoToTerminal}
            onView={handleMindscapeView}
            onAction={handleMindscapeAction}
            onUndo={undoMindscape}
            onRedo={redoMindscape}
            alert={mindscape.alert}
            onRetry={mindscape.retry}
            registry={appConfig?.sessionRegistry}
            storedNameOf={mindscapeStoredNameOf}
            onResume={handleMindscapeResume}
            onGesture={(gesture) => window.donel.learning?.record(gesture)}
            roles={roles}
            onStartPlace={handleMindscapeStartPlace}
            onManageRoles={() => setRolesEditorOpen(true)}
            onDefineChair={setChairRoleId}
            ledgerPlaceStatesOf={ledgerPlaceStatesOf}
            onCloseSessions={handleMindscapeCloseSessions}
          />
        ) : null}

        {chairRoleId !== null
          ? (() => {
              // Cadeiras, fatia 2 — the chair screen (B1, read-only) over the middle, like the Mindscape.
              const projectPath = tabs.find((tab) => tab.id === activeTabId)?.cwd;
              return (
                <ChairScreen
                  roles={roles}
                  roleId={chairRoleId}
                  projectPath={projectPath}
                  projectName={projectPath ? (mindscapeProjectNames[projectPath] ?? projectPath.split(/[\\/]/).filter(Boolean).pop()) : undefined}
                  board={projectPath ? mindscape.doc.boards[projectPath] : undefined}
                  onPick={setChairRoleId}
                  onEditRole={(roleId) => {
                    setRolesEditorRoleId(roleId);
                    setRolesEditorOpen(true);
                  }}
                  onClose={() => setChairRoleId(null)}
                  onSaved={setRoles}
                />
              );
            })()
          : null}

        {/* CA-20 — a tela de hoje continua MONTADA quando o Modo Dev liga
            (só oculta por CSS): nada de remontar sidebar/abas, nada de PTY
            recriado. Mesmo princípio já usado nas abas de terminal (T007).
            FIX (revisão do orquestrador, app-06 regenerado) — "Sessões
            anteriores" (item 11) é uma TELA irmã de `.body` na MESMA linha
            do grid (`.previousSessionsScreen`, `grid-row: 2`), não um
            `Modal` portalizado: sem esconder esta zona também, o rótulo
            "PROJETOS" e a scrollbar da sidebar continuavam vivos por baixo
            e vazavam na borda inferior do print — mesmo princípio de
            `hillOn`, mais um caso que reorganiza o miolo por cima da
            tela de hoje. */}
        <div
          className={hillOn || sidebarCollapsed || previousSessionsProject !== null ? styles.zoneHidden : styles.zone}
          data-testid="today-sidebar"
        >
        <ProjectSidebar
          sessions={sidebarSessions}
          onFocusSession={focusTab}
          onTogglePin={handleTogglePin}
          onRenameSession={handleRenameTab}
          favoriteGroups={favoriteGroups}
          onToggleFavoriteGroupCollapsed={handleToggleFavoriteGroupCollapsed}
          onFocusOrResumeFavoriteSession={handleFocusOrResumeFavoriteSession}
          onToggleFavoriteSessionPinned={handleToggleFavoriteSessionPinned}
          workspace={sidebarWorkspace}
        />
        </div>

        {/* Spec 010 / B6 — a porta de entrada saiu com o modelo antigo: ela
            listava cards do BOARD, e o tracker deixou de ser consultado para
            saber estado (D-1). Escolher qual discovery conduzir virou o eixo X
            do nível Discovery do mapa; criar um passa pelo painel do store, que
            é onde a criação já mora (D-16 — o app não ganha um segundo
            formulário). O inventário de paridade registra a decisão (M-21). */}

        <main className={styles.center}>
          <div className={styles.tabBar}>
            {oracleLayoutOn ? (
              <div className={styles.centerSwitch} data-testid="center-view-switch" title="Oráculo ou Terminais. Atalho Ctrl+Shift+O.">
                <SegmentedControl
                  ariaLabel="O que o centro mostra"
                  options={[
                    { value: 'oracle', label: 'Oráculo' },
                    { value: 'terminals', label: 'Terminais' },
                  ]}
                  value={layoutPrefs.centerView}
                  onChange={(value) => setCenterView(value === 'terminals' ? 'terminals' : 'oracle')}
                />
                {liderTab ? (
                  <Button variant="secondary" onClick={() => focusTab(liderTab.id)} data-testid="lider-conversation">
                    Conversa do Líder
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className={styles.tabBarScroll}>
            {tabs.map((tab, index) => (
              // Só os Líderes nas abas — a session opened by another one stays out until the owner opens it.
              !isTabListed(tab) || hiddenFromTabBar(tab) ? null : <TerminalTab
                key={tab.id}
                name={resolveTabName(tab)}
                // T408 (004) — CA-3: duplo-clique no nome, ou F2 na aba em
                // foco. Vale para aba claude (persiste) e shell (memória, C4).
                onRename={(next) => handleRenameTab(tab.id, next)}
                nameMaxLength={SESSION_NAME_MAX_LENGTH}
                // T010 — ui-spec §2 zona 3: abas de terminal comum não têm
                // dot de semáforo (undefined = TerminalTab troca pelo ícone
                // de shell); só abas 'claude' mostram o ícone de estado
                // (CA-28) do T009.
                state={tab.sessionType === 'shell' ? undefined : (semaphoreStates[tab.id]?.state ?? 'working')}
                // T079 (D-C20) — slot próprio, nunca o `model`.
                statusText={chatEnabled && tab.sessionType === 'claude' && semaphoreStates[tab.id]?.state === 'permission' ? 'esperando você' : undefined}
                // "Isolar em worktree" — a marca ⎇ no slot curto ao lado do nome (a branch vai no cabeçalho da sessão).
                model={tabMarks(roleOfTab(tab)?.name, tabWorktreeBranch(tab) ? WORKTREE_TAB_MARK : undefined, backgroundRunningOf(tab.id))}
                active={tab.id === activeTabId && !oracleShown}
                onClick={() => focusTab(tab.id)}
                onClose={() => handleRequestCloseTab(tab.id)}
                // CA-27 — faixa de cor definida pelo operador (clique direito na aba).
                color={tab.color ?? 'none'}
                onColorChange={(color) => handleTabColorChange(tab.id, color)}
                // Fix #19 — a cor REAL do `/color` do CLI (quando existe) vence a
                // faixa por token: gesto explícito e recente do operador, ver
                // decisão em TerminalTab.tsx. O menu de clique direito (acima)
                // continua funcionando normalmente — só fica visualmente
                // sobreposto enquanto houver cor do CLI.
                cliColorHex={cliColorNameToHex(tab.cliColorName)}
                // CA-26 — arraste nativo (HTML5 DnD): o índice de origem fica
                // em `dragFromIndex` até o `drop`, que dispara `reorderTabs`.
                draggable
                onDragStart={() => setDragFromIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragFromIndex !== null && dragFromIndex !== index) handleTabReorder(dragFromIndex, index);
                  setDragFromIndex(null);
                }}
              />
            ))}
            </div>
            {/* Item 4 (rodada de forma fix/009-board-real-e-modal, mockup
                linha 64) — o hint fica FORA da área rolável das abas, pra
                nunca ser espremido/sumir quando há muitas abas. Só aparece
                com pelo menos 1 aba (sem abas, não há barra). */}
          </div>
          {/* FIX (teste manual 27/07) — a toolbar de Modelo/Esforço
              (SessionDetails) foi REMOVIDA dos dois modos a pedido do dono
              ("não tem sido nem um pouco útil"): modelo/esforço agora se
              escolhe no Launcher ao criar a sessão, e a leitura do que a
              sessão usa vive na StatusBar (rodapé). */}
          {/* REVISÃO do orquestrador (lote 8, 009-modo-dev-v3) — o header de
              44px do mockup (linhas 175-196 Modo Dev / 341-356 Uso geral)
              tinha sido comprimido pro titlebar (ícone solto); D1 "confia no
              design sempre" manda a forma desenhada, sem abrandar. D-V6
              continua valendo: isto NÃO é o SessionDetails (modelo/esforço/
              permissões) — só o que o mockup desenha aqui: breadcrumb (Dev)
              ou nome+path (Uso geral), StateDot e "⟳ Reiniciar" (CA-24). */}
          {/* Item 3 (rodada de forma fix/009-board-real-e-modal) — no Modo
              Dev o header é SEMPRE o breadcrumb quando há etapa em foco,
              independente de existir aba aberta (2a: a etapa "sem sessão
              ainda" já mostra o breadcrumb) — antes a condição era só
              `tabs.length > 0`, então com 0 sessões o header sumia inteiro e
              o path cru do "consultar artefato" (Zona 2, acima) parecia ser
              o header. Uso geral mantém a condição antiga (nome+path só com
              aba aberta, lote 8). */}
          {oracleShown ? <OracleCenter placeName={oraclePlaceName} placeStatesOf={ledgerPlaceStatesOf} /> : null}
          {!oracleShown && listedTabIds.size > 0 ? (
            <div className={styles.sessionHeader} data-testid="session-header">
              {/* Spec 010 / B6 — o breadcrumb passou a ser o dos nós novos:
                  discovery › plano › item. Ele vem pronto de `buildMapView`;
                  montá-lo aqui seria a terceira redação da mesma navegação. */}
                <>
                  <span className={styles.sessionHeaderTitle}>{activeTab ? resolveTabName(activeTab) : ''}</span>
                  {activeTab?.cwd ? <span className={styles.sessionHeaderPath}>{activeTab.cwd}</span> : null}
                  {activeTab && tabWorktreeBranch(activeTab) ? (
                    <span className={styles.sessionHeaderWorktree} data-testid="session-header-worktree" title="Sessão isolada numa worktree (.claude/worktrees)">
                      {WORKTREE_TAB_MARK} {tabWorktreeBranch(activeTab)}
                    </span>
                  ) : null}
                  {activeClaudeTab && isTabYolo(activeClaudeTab) ? (
                    <span
                      className={styles.sessionHeaderYolo}
                      data-testid="session-header-yolo"
                      title="Modo YOLO: neste projeto o agente age sem perguntar. Desliga na engrenagem do projeto."
                    >
                      YOLO
                    </span>
                  ) : null}
                </>
              <div className={styles.sessionHeaderSpacer} />
              {activeChatTab && activeChatView ? (
                <>
                  {/* D-C21: o Modo Foco é do chat — some na vista Terminal. */}
                  {activeChatView === 'chat' ? (
                    <div className={styles.sessionHeaderControl} data-testid="chat-focus-toggle">
                      <Toggle checked={appConfig?.chat.focusMode ?? true} onChange={handleChangeFocusMode} label="Modo Foco" />
                    </div>
                  ) : null}
                  <div
                    className={styles.sessionHeaderControl}
                    data-testid="chat-view-switch"
                    title={'Alternar para ' + (activeChatView === 'chat' ? 'o Terminal' : 'o Chat') + ' — mesma sessão, mesma conversa. Atalho Ctrl+`.'}
                  >
                    <SegmentedControl
                      ariaLabel="Vista da aba"
                      options={[
                        { value: 'chat', label: 'Chat' },
                        { value: 'terminal', label: 'Terminal' },
                      ]}
                      value={activeChatView}
                      onChange={(value) => setTabView(activeChatTab.id, value === 'terminal' ? 'terminal' : 'chat')}
                    />
                  </div>
                  <Kbd>Ctrl+`</Kbd>
                </>
              ) : null}
              {activeClaudeTab && chatPtyIds[activeClaudeTab.id] ? <BrowserToggleButton ptyId={chatPtyIds[activeClaudeTab.id]} leader={isLeaderOfAllTab(activeClaudeTab)} /> : null}
              {activeClaudeTab ? (
                <StateDot
                  state={semaphoreStates[activeClaudeTab.id]?.state ?? 'working'}
                  label={SESSION_STATE_LABEL_PT[semaphoreStates[activeClaudeTab.id]?.state ?? 'working']}
                />
              ) : null}
            </div>
          ) : null}
          {/* B36 — sessão renovada em voo: the discreet strip of the active session (close, due, in progress). */}
          {!oracleShown && activeTab && sessionRenewal.banners[activeTab.id] ? (
            <div className={styles.renewalStrip} data-testid="renewal-strip">
              <RenewalStrip banner={sessionRenewal.banners[activeTab.id]!} onSnooze={() => sessionRenewal.snooze(activeTab.id)} />
            </div>
          ) : null}
          {!oracleShown && activeTab && renewalDeliveryNotices[activeTab.id] ? (
            <div className={styles.renewalStrip} data-testid="renewal-delivery-strip">
              <RenewalDeliveryStrip
                text={renewalDeliveryNotices[activeTab.id]!}
                onDismiss={() => {
                  const tabId = activeTab.id;
                  setRenewalDeliveryNotices((prev) => {
                    const next = { ...prev };
                    delete next[tabId];
                    return next;
                  });
                }}
              />
            </div>
          ) : null}
          {/* Oráculo no centro — the terminals stay mounted (the PTYs live on), only out of sight. */}
          <div className={oracleShown ? styles.terminalHidden : styles.terminal}>
            {/* FIX (decisão A, 2026-07-23) — mesmo empty state pros dois
                caminhos que levam a "zero abas": boot do app (INITIAL_TABS
                vazio, ver comentário lá) e fechar a última aba restante
                (T010, handleRequestCloseTab/closeTabImmediately) — nenhum
                estado especial "primeira vez" separado do estado normal
                "sem sessão nenhuma aberta agora". CTA aponta pros dois
                caminhos reais de abrir uma sessão (sidebar ou "＋ Nova
                sessão") em vez de inventar um terceiro botão/atalho.
                Item 2 (rodada de forma fix/009-board-real-e-modal, CA-15) —
                este CTA é do modo clássico: no Modo Dev as sessões nascem da
                esteira ("⌁ Preparar" na trilha do mapa), nunca de um atalho
                ad-hoc — o botão nunca aparece lá (screenshot app-01/03
                mostrava o contrário). */}
            {listedTabIds.size === 0 && !hillOn ? (
              <div className={styles.emptyState} data-testid="empty-state">
                <p className={styles.emptyStateTitle}>Nenhuma sessão aberta</p>
                <p className={styles.emptyStateHint}>Escolha um projeto na barra lateral ou</p>
                {/* Rótulo "Nova sessão" (sem "＋") de propósito — o botão do
                    titlebar (SplitButton logo abaixo) já usa "＋ Nova sessão"
                    como nome acessível; texto IDÊNTICO nos dois criaria
                    ambiguidade de `getByRole('button', { name: ... })` pra
                    qualquer consumidor (smokes, leitor de tela) enquanto os
                    dois estiverem visíveis ao mesmo tempo. */}
                <Button variant="primary" onClick={handleQuickNewClaudeSession}>
                  Nova sessão
                </Button>
              </div>
            ) : null}
            {tabs.map((tab) => {
              // T056 — o TerminalPane fica SEMPRE montado (o PTY e o xterm sobrevivem à troca de vista);
              // a vista que não está em foco só é ocultada por CSS.
              const chatTab = hasChatView(tab, chatEnabled);
              const view = effectiveTabView(tab, chatEnabled);
              return (
              <div key={tab.id} className={tab.id === activeTabId ? styles.terminalPane : styles.terminalPaneHidden}>
                {chatTab ? (
                  <div className={view === 'chat' ? styles.terminalPane : styles.terminalPaneHidden} data-testid="chat-layer">
                    <ChatView
                      tabId={tab.id}
                      actions={chatActions}
                      ptyId={chatPtyIds[tab.id] ?? null}
                      active={tab.id === activeTabId && view === 'chat'}
                      focusMode={appConfig?.chat.focusMode ?? true}
                      ended={tabExits[tab.id] ?? null}
                      cwd={tab.cwd}
                      offerYolo={!isTabYolo(tab) && projectOfTab(tab) !== null}
                    />
                  </div>
                ) : null}
                <div className={view === 'chat' ? styles.terminalPaneHidden : styles.terminalPane}>
                <TerminalPane
                  ref={(handle) => {
                    terminalRefs.current[tab.id] = handle;
                  }}
                  sessionType={tab.sessionType}
                  cwd={tab.cwd}
                  args={tab.launchArgs}
                  providerId={tab.providerId}
                  remoteId={tab.remoteId}
                  tabName={tab.name}
                  projectName={tab.projectName}
                  openedBy={tab.openedBy}
                  accountLoginId={tab.accountLoginId}
                  roleId={tab.roleId}
                  leaderOfAll={isLeaderOfAllTab(tab)}
                  placeId={tab.placeId}
                  ownerInputGate={(data, forward) => ownerTerminalInput(tab.id, data, forward)}
                  onStateChange={(info) => handleSemaphoreChange(tab.id, info)}
                  onAliveChange={(alive) => handleAliveChange(tab.id, alive)}
                  onAccountResolved={(account) => handleAccountResolved(tab.id, account)}
                  // T404/T408 — o id da sessão chega aqui e vira a chave de
                  // persistência do nome desta aba (CA-6).
                  onClaudeSessionIdResolved={(claudeSessionId) => {
                    // B36 — the new session of a renewal: the tab keeps its name, its color and its card on
                    // the Mindscape, and the new session reads the handoff first.
                    const renewal = sessionRenewal.takeCompletion(tab.id, claudeSessionId);
                    if (renewal && claudeSessionId) {
                      handleRenewedSession(tab, renewal.previousSessionId, claudeSessionId, renewal.firstPrompt, renewal.handoffPath);
                    } else if (tab.placeId && tab.cwd && claudeSessionId && mindscapeLoaded) {
                      // Item 12a — the tab opened from a place that had not started: the place starts
                      // with this conversation, BEFORE the tab gets the id (no second card).
                      const { placeId, cwd } = tab;
                      applyMindscapeSession((doc) => setPlaceConversation(doc, cwd, placeId, claudeSessionId));
                    }
                    // CA-27 (009-modo-dev-v3) — retomada de uma sessão colorida
                    // antes: hidrata a cor persistida assim que o `claudeSessionId`
                    // chega (é o mesmo id de antes numa retomada, `pty:create`
                    // reusa o `-r`). Sem entrada persistida, mantém a cor que a
                    // aba já tinha (default 'none' de uma sessão nova).
                    const persistedColor = claudeSessionId ? appConfig?.tabAppearance[claudeSessionId]?.color : undefined;
                    updateTab(tab.id, { claudeSessionId, ...(persistedColor ? { color: persistedColor } : {}) });
                    // T707 (007) — gatilho 1: a sessão nasce. `resolveTabName`
                    // já sabe compor fallback/customTitle/nome da UI; o
                    // `claudeSessionId` chega só agora, então é passado por
                    // fora do `tab` (que só é atualizado no próximo render).
                    const projectPath = tab.cwd;
                    if (projectPath && claudeSessionId) {
                      maybeRegisterVisit(claudeSessionId, projectPath, resolveTabName({ ...tab, claudeSessionId }));
                    }
                    // Spec 010 / B1 — aba de fase da esteira: o id do CLI é o
                    // que separa "preparada" de "em andamento". Antes dele, o
                    // que existia era um arquivo em disco; agora existe sessão,
                    // com dono. É o único fato que autoriza a frase.
                    const esteiraSessionId = esteiraTabSessionsRef.current[tab.id];
                    if (esteiraSessionId && claudeSessionId) {
                      void window.donel.esteira
                        .claimSession({ sessionId: esteiraSessionId, cliSessionId: claudeSessionId })
                        .catch(() => undefined);
                    }
                  }}
                  // T710 (CA-11, 2º momento) — retomada que morre logo depois do
                  // spawn faz a entrada órfã sair da lista.
                  onProcessExit={(info) => handleTabProcessExit(tab, info)}
                  onStartFailed={(message) => {
                    startFailuresRef.current[tab.id] = message;
                    liderTabDiedRef.current[tab.id]?.(); // Líder único na VPS — the new Líder of a move did not start
                    agentBridgeRef.current?.startFailed(tab.id);
                  }}
                  onCloseTab={() => handleRequestCloseTab(tab.id)}
                  onPtyChange={(ptyId) => {
                    setChatPtyIds((prev) => (prev[tab.id] === ptyId ? prev : { ...prev, [tab.id]: ptyId }));
                    setTabExits((prev) => omitKey(prev, tab.id));
                  }}
                  resumeSessionId={chatTab ? tab.claudeSessionId : undefined}
                />
                </div>
                {/* Navegador interno — o painel desta sessão (null enquanto fechado). */}
                {tab.sessionType === 'claude' && chatPtyIds[tab.id] ? (
                  isLeaderOfAllTab(tab) ? (
                    <LeaderBrowserPanel ownPtyId={chatPtyIds[tab.id]} active={tab.id === activeTabId} sessions={browserSessions} />
                  ) : (
                    <BrowserPanel ptyId={chatPtyIds[tab.id]} active={tab.id === activeTabId} />
                  )
                ) : null}
              </div>
              );
            })}
          </div>
        </main>

        {/* FIX (feedback E2E rodada 3, painel colapsável) — deixa de ser
            fixo: só monta quando `launcherOpen` (aberto via item "Sessão
            Claude" do menu do "＋ Nova sessão", ou fechado ao lançar/Esc);
            fechado, o espaço vai pro `.center` (terminal), ver
            `styles.bodyPanelClosed` acima. */}
        {/* Hill climbing — a barra esquerda (trilha + carrossel) que ficou do Modo Dev; não há barra direita.
            Recolher a lateral desmonta a barra, como desmontava o mapa. */}
        {hillOn && !sidebarCollapsed ? <HillClimbBar snapshot={hillClimb.snapshot} onGesture={hillClimb.gesture} /> : null}

        {launcherOpen ? (
          <aside className={styles.rightPanel} aria-label="Lançar sessão">
            {/* Teste manual 27/07 — fechar o painel precisa de um gesto
                VISÍVEL (Esc continua valendo; lançar também fecha). */}
            <button
              type="button"
              className={styles.rightPanelClose}
              onClick={() => setLauncherOpen(false)}
              aria-label="Fechar painel de nova sessão"
              title="Fechar (Esc)"
            >
              <PanelRightClose size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <Launcher
              projects={projects}
              defaultProjectPath={selectedProjectPath}
              launcherDefaults={appConfig?.launcherDefaults}
              providers={providers}
              roles={roles}
              onManageRoles={() => setRolesEditorOpen(true)}
              remotes={accountsView.remotes.map((place) => ({
                id: place.id,
                label: place.label,
                accountLabel: place.activeAccountId
                  ? (accountsView.accounts.find((account) => account.id === place.activeAccountId)?.label ?? place.activeAccountId)
                  : null,
              }))}
              onLaunch={handleLaunch}
            />
          </aside>
        ) : null}
        {/*
          Hook só de teste (T008 DoD — CA-1): não há como inspecionar o
          argv real recebido pelo processo `claude` a partir do renderer (o
          node-pty spawna no main process), então expomos aqui o comando
          exatamente como foi montado pelo CommandBuilder e o cwd usado na
          criação da aba. `hidden` tira do fluxo visual — o smoke lê via
          textContent/atributo, não via visibilidade. FORA do `<aside>`
          condicional de propósito: `handleLaunch` fecha o painel no mesmo
          gesto que preenche este valor (ui-spec §4 "fecha ao lançar") — se
          este elemento vivesse dentro do `<aside>`, ele desmontaria antes
          do smoke conseguir ler o comando montado.
        */}
        <pre data-testid="launcher-last-command" data-cwd={lastLaunch?.cwd ?? ''} hidden>
          {lastLaunch ? ['claude', ...lastLaunch.args].join(' ') : ''}
        </pre>
      </div>

      {/* Novidades and Saúde do computador — live beside the StatusBar (not inside it): the design-system
          bar keeps its own slots, and these buttons are the app's. */}
      <div className={styles.statusRow}>
        <StatusBar
          className={styles.statusBarFill}
          // B36 — same pattern as "trocou em voo (era a …)": the statusbar says the session was renewed.
          accountLabel={
            activeTab && sessionRenewal.renewed[activeTab.id] ? `${activeSessionAccountLabel} · sessão renovada em voo` : activeSessionAccountLabel
          }
          modelEffort={activeModelEffort}
          sessionCount={tabs.length}
          smartZone={activeSmartZone}
          accountTestId="statusbar-account"
        />
        <BackgroundIndicator sessions={backgroundSessions} onOpen={handleOpenBackground} />
        <UpdateIndicator
          waiting={updateRequested && !updateApplying ? updateSessions : null}
          remainingMs={updateTiming?.remainingMs ?? null}
          applying={updateApplying}
          error={updateError}
          onUpdate={() => {
            setUpdateError(null);
            setUpdateRequested(true);
          }}
          onCancel={() => setUpdateRequested(false)}
          onDismissError={() => setUpdateError(null)}
        />
        <PatchNotes />
        <ProxyIndicator />
        <HealthIndicator />
      </div>

      {/* Item 12b — the roles: create and edit (text + suggestions). */}
      <RolesEditor
        open={rolesEditorOpen}
        roles={roles}
        providers={providers}
        initialRoleId={rolesEditorRoleId}
        onClose={() => {
          setRolesEditorOpen(false);
          setRolesEditorRoleId(undefined);
        }}
        onSaved={setRoles}
        onOpenChair={(roleId) => {
          setRolesEditorOpen(false);
          setRolesEditorRoleId(undefined);
          setChairRoleId(roleId);
        }}
      />

      {/* T010 — FR-006, ui-spec §2 "fechar aba com sessão ativa": confirmação destrutiva antes de matar um PTY vivo. */}
      <Modal
        open={pendingCloseTabId !== null}
        onClose={handleCancelCloseTab}
        title="Fechar sessão?"
        actions={
          <>
            <Button variant="secondary" onClick={handleCancelCloseTab}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleConfirmCloseTab}>
              Fechar sessão
            </Button>
          </>
        }
      >
        <p>O processo desta aba será encerrado.</p>
      </Modal>

      {/* T013 — PARTE PRINCIPAL (FR-004, CA-2, ui-spec §5). Item 11 — a
          tela não é mais um `Modal` portalizado: precisa do wrapper
          posicionado no grid do `.shell` (`.previousSessionsScreen`, mesma
          linha de `.body`) só quando aberta. */}
      {previousSessionsProject !== null ? (
        <div className={styles.previousSessionsScreen}>
          <PreviousSessions
            open={previousSessionsProject !== null}
            projectName={previousSessionsProject?.name ?? ''}
            projectPath={previousSessionsProject?.path ?? ''}
            sessions={previousSessions}
            loading={loadingPreviousSessions}
            onClose={handleClosePreviousSessions}
            onResume={handleResumeSession}
            onFork={handleForkSession}
            // T408 (004) — a lista mostra o nome resolvido (custom-title do CLI ou
            // nome dado na UI), não só a 1ª mensagem: é o caminho do US-A.
            sessionNames={appConfig?.sessionNames ?? {}}
            contextLabelBySessionId={previousSessionsContextLabel}
            esteiraPhaseSessionIds={esteiraPhaseSessionIds}
            yolo={previousSessionsProject !== null && projectOfFolders([previousSessionsProject.path], yoloProjects) !== null}
            onChangeYolo={(enabled) => {
              if (!previousSessionsProject) return;
              void window.donel.config.setProjectYolo(previousSessionsProject.path, enabled).then(setAppConfig).catch(() => undefined);
            }}
          />
        </div>
      ) : null}

      {/* D4 — Toast do Modo Dev: uma linha, SEM ação de desfazer. Trocar o
          foco já é reversível pelo próprio gesto (clicar no outro card); uma
          máquina de "desfazer" não agregaria valor nenhum. */}
      <Toast open={devModeToast !== null} message={devModeToast ?? ''} onDismiss={() => setDevModeToast(null)} />

      {/* "Isolar em worktree" — a worktree da aba fechada ficou (trabalho não enviado); nada foi apagado. */}
      <Toast
        open={worktreeKept !== null}
        message={
          worktreeKept
            ? worktreeKept.kind === 'kept'
              ? `A worktree ${worktreeKept.name} ficou porque tem trabalho não enviado: ${worktreeKept.reason}.`
              : `Não consegui remover a worktree ${worktreeKept.name} (${worktreeKept.reason}); ela ficou onde estava.`
            : ''
        }
        actionLabel="Abrir pasta"
        onAction={() => {
          if (worktreeKept) void window.donel.workspace.openWorktreeFolder(worktreeKept.path).catch(() => false);
          setWorktreeKept(null);
        }}
        onDismiss={dismissWorktreeKept}
        duration={15_000}
      />

      {/* T015 — Preferências (FR-007, feedback E2E rodada 3/4). */}
      <Preferences
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        projectRoots={appConfig?.projectRoots ?? []}
        projectScanMode={appConfig?.projectScanMode ?? 'markers'}
        notificationPreference={appConfig?.notificationPreference ?? FALLBACK_NOTIFICATION_PREFERENCE}
        onAddRoot={handleAddProjectRoot}
        onRemoveRoot={handleRemoveProjectRoot}
        onChangeProjectScanMode={handleChangeProjectScanMode}
        onChangeNotificationPreference={handleChangeNotificationPreference}
        chatEnabled={appConfig?.chat.enabled ?? false}
        chatRestartPending={(appConfig?.chat.enabled ?? false) !== chatEnabled}
        onChangeChatEnabled={handleChangeChatEnabled}
        petEnabled={appConfig?.pet.enabled ?? false}
        onChangePetEnabled={handleChangePetEnabled}
        sessionRenewal={renewalPrefs}
        onChangeSessionRenewal={(prefs) => {
          void window.donel.config.setSessionRenewalPrefs(prefs).then(setAppConfig).catch(() => undefined);
        }}
        openCap={appConfig?.team.openCap ?? null}
        onChangeOpenCap={(openCap) => {
          void window.donel.config.setTeamPrefs({ ...(appConfig?.team ?? DEFAULT_TEAM_PREFS), openCap }).then(setAppConfig).catch(() => undefined);
        }}
        turnNotices={appConfig?.team.turnNotices ?? 'ledger'}
        onChangeTurnNotices={(turnNotices) => {
          void window.donel.config.setTeamPrefs({ ...(appConfig?.team ?? DEFAULT_TEAM_PREFS), turnNotices }).then(setAppConfig).catch(() => undefined);
        }}
        remotes={accountsView.remotes.map((place) => ({ id: place.id, label: place.label }))}
        launcherWhere={appConfig?.launcherDefaults.where}
        leaderWhere={appConfig?.leader.where ?? DEFAULT_LEADER_PREFS.where}
        onChangeLeaderWhere={(where) => {
          void window.donel.config.setLeaderPrefs({ where }).then(setAppConfig).catch(() => undefined);
        }}
        onChangeLauncherWhere={(where) => {
          if (!appConfig) return;
          const { where: _previous, ...rest } = appConfig.launcherDefaults;
          void window.donel.config
            .setLauncherDefaults({ ...rest, ...(where ? { where } : {}) })
            .then(setAppConfig)
            .catch(() => undefined);
        }}
        onManageRoles={() => {
          setPreferencesOpen(false);
          setRolesEditorOpen(true);
        }}
        autoNeverAsks={appConfig?.autoMode.neverAsks ?? true}
        onChangeAutoNeverAsks={(neverAsks) => {
          void window.donel.config.setAutoModePrefs({ neverAsks }).then(setAppConfig).catch(() => undefined);
        }}
        oracleCenter={layoutPrefs.oracleCenter}
        // Turning it on shows the Oráculo (not a "Terminais" left from before): that is what the switch promises.
        onChangeOracleCenter={(oracleCenter) => changeLayoutPrefs(oracleCenter ? { oracleCenter, centerView: 'oracle' } : { oracleCenter })}
      />

    </div>
  );
}
