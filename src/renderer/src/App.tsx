import {
  Button,
  formatSmartZoneLabel,
  Modal,
  SegmentedControl,
  SESSION_STATE_LABEL_PT,
  SplitButton,
  StateDot,
  StatusBar,
  TerminalTab,
  Toast,
} from '@donel-dev/design-system';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Route, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountLoad,
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
import { reorderTabs } from '../../shared/tabAppearance';
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
// CA-22 (009) — só o DENOMINADOR do `%` de contexto vem daqui (`min(300k,
// janela do modelo)`, decisão de 24/07); a formatação e as faixas de cor são do
// `SmartZoneMeter` do design-system.
import { effectiveContextZone } from '../../shared/contextWindow';
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
// Spec 010 / batch B6 — o Modo Dev continua sendo o mapa; a fonte dele passou
// a ser o STORE (`esteiraMapView.ts`, puro e testado). Aqui fica só o
// encanamento com PTY/IPC — nenhuma decisão de domínio, nenhuma frase de estado.
import { DiscoveryMap } from './DevMode/DiscoveryMap';
import { PhaseDetailsPanel } from './DevMode/PhaseDetailsPanel';
import { buildMapView, tabToFocusFor, tasksArtifactFor, type MapSelection, type MapTrailStep } from './DevMode/esteiraMapView';
import type { TasksRunningTogetherView } from './DevMode/PhaseDetailsPanel';
import styles from './App.module.css';
import { Launcher } from './Launcher';
import type { LauncherLaunchOptions } from './Launcher';
// Spec 010 — a esteira nova, AO LADO do mapa atual (`[P-5]`): nada aqui
// desmonta ou altera o Modo Dev de hoje; a tela entra por cima, atrás de um
// gesto interno, para dar para comparar as duas com o mesmo dado.
import { EsteiraScreen } from './Esteira/EsteiraScreen';
import { cardView, dispatchView, STORE_COMPATIBILITY_WARNING } from './Esteira/esteiraView';
import {
  esteiraTabName,
  isReadyForAutoStart,
  resolveSessionCwd,
  withAutoEnter,
  type EsteiraSessionRequest,
} from './Esteira/esteiraSession';
import { preparePhase } from './Esteira/preparePhase';
import type { EsteiraSnapshotDto } from '../../shared/esteira/ipc';
import type { EntityId } from '../../shared/esteira/store/storeFormat';
// C3 — o parser do tasks.md (puro, testado) fica fora do domínio da esteira
// de propósito: é interpretação de TEXTO de um artefato, não fato do store.
import { parseTasksDoc, taskScope } from '../../shared/tasksDoc';
import { Preferences } from './Preferences';
import { PreviousSessions } from './PreviousSessions';
import { AccountsPanel } from './AccountsPanel';
import { ProviderForm } from './ProviderForm';
import { ProjectSidebar } from './ProjectSidebar';
import type { FavoriteProjectGroup, FavoriteSessionRow, SidebarSession } from './ProjectSidebar';
// CA-30 (009-modo-dev-v3, lote 9) — seletor de projetos no titlebar + modal de criação.
import { ProjectSwitcher } from './ProjectSwitcher';
import { TerminalPane } from './TerminalPane';
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


// 003-modo-dev/T312 — teto de espera pelo sinal de "pronto para receber
// input" antes de pré-digitar (plan.md, tabela de riscos: "se não voltar a
// 'waiting' num teto, o app para no 1º passo e deixa a retomada manual —
// nunca força o 2º"). Mesma ordem de grandeza (e o mesmo motivo: rede de
// segurança de um sinal que pode nunca chegar) de `LIVE_INJECTION_TIMEOUT_MS`
// acima; separado de propósito porque são esperas de coisas diferentes.
const PRE_TYPE_READY_TIMEOUT_MS = 30_000;

/** Intervalo do re-teste da prontidão. Não é um "delay fixo até digitar": o gatilho continua sendo o SINAL (semáforo/buffer), este tick só garante reavaliar quando o sinal chega sem um chunk novo de PTY junto. */
const PRE_TYPE_POLL_MS = 250;

/** Remove uma chave de um record sem mutar o original — usado ao limpar `semaphoreStates`/`aliveTabs` no fechamento de aba. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

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
  const [rightCollapsed, setRightCollapsed] = useState(false);
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
  });
  // T009 — estado do semáforo por aba (chave = tab.id), alimentado pelo
  // callback que cada TerminalPane levanta via onStateChange.
  const [semaphoreStates, setSemaphoreStates] = useState<Record<string, SemaphoreStateInfo>>({});
  const previousSemaphoreStatesRef = useRef<Record<string, SemaphoreStateInfo>>({});
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // T412 (004) — a assinatura do evento de transcript é ÚNICA e montada uma vez
  // só; sem esta ref ela leria o `appConfig` do primeiro render pra sempre.
  const appConfigRef = useRef(appConfig);
  appConfigRef.current = appConfig;
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
  const [devModeOn, setDevModeOn] = useState(false);
  /** Spec 010 — tela da esteira nova (gesto interno: botão no titlebar do Modo Dev). */
  const [esteiraOpen, setEsteiraOpen] = useState(false);
  /**
   * Spec 010 / B6 — o mapa é PROJEÇÃO do store: o snapshot chega pronto do main
   * (macro etapa já derivada, D-13) e é empurrado a cada mudança. O renderer
   * nunca lê disco nem calcula etapa.
   */
  const [esteiraState, setEsteiraState] = useState<EsteiraSnapshotDto | null>(null);
  /**
   * O que está em foco em cada eixo do carrossel e qual nó/etapa o painel de
   * detalhe mostra. Estado de TELA — nada aqui é domínio.
   */
  const [mapSelection, setMapSelection] = useState<MapSelection>({
    discoveryId: null,
    planId: null,
    itemId: null,
    nodeKey: null,
    phase: null,
  });
  /** D4 — Toast informativo (o que o gesto fez, por que foi recusado); nunca tem desfazer. */
  const [devModeToast, setDevModeToast] = useState<string | null>(null);
  /**
   * C3 — cache do texto de tasks.md já lido, por caminho ABSOLUTO. `null` =
   * já tentou e não achou/não leu (não refaz o IPC); ausente = ainda não
   * tentou. `buildMapView` é síncrona e não lê disco (D-13 continua valendo
   * pro resto do snapshot) — este cache vive fora dela de propósito.
   */
  const [taskDocByPath, setTaskDocByPath] = useState<Record<string, string | null>>({});
  /** Evita reler o mesmo caminho enquanto o fetch está em voo (guard por ref, mesmo padrão de `armWatchersRef`). */
  const taskDocFetchingRef = useRef<Set<string>>(new Set());
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

  const handleSemaphoreChange = useCallback((tabId: string, info: SemaphoreStateInfo): void => {
    setSemaphoreStates((prev) => ({ ...prev, [tabId]: info }));
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
  const addTab = (partial: Omit<TabState, 'id'>): string => {
    tabIdCounter.current += 1;
    const id = `tab-${tabIdCounter.current}`;
    setTabs((prev) => [...prev, { id, ...partial }]);
    setActiveTabId(id);
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
    const remaining = tabs.filter((tab) => tab.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      const fallback = remaining[Math.max(0, index - 1)] ?? remaining[0];
      setActiveTabId(fallback ? fallback.id : '');
    }
    setSemaphoreStates((prev) => omitKey(prev, tabId));
    setAliveTabs((prev) => omitKey(prev, tabId));
    delete aliveSinceRef.current[tabId]; // FIX (feedback E2E rodada 5) — mesmo padrão de limpeza dos maps acima.
    setSessionAccounts((prev) => omitKey(prev, tabId)); // FIX (feedback E2E rodada 5) — idem.
    setSessionModelEffort((prev) => omitKey(prev, tabId));
    delete terminalRefs.current[tabId];
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
  const closeTabImmediatelyRef = useRef(closeTabImmediately);
  closeTabImmediatelyRef.current = closeTabImmediately;

  // T010 — FR-006: "se a sessão estiver ativa (processo vivo), pede
  // confirmação" — senão fecha direto (ex.: aba já em 'ended'/'claude-not-found').
  // Função simples (não useCallback) de propósito: lê `aliveTabs`/`tabs`/
  // `activeTabId` direto do escopo do render, mesmo padrão de
  // `handleOpenProject`/`handleLaunch` logo acima.
  const handleRequestCloseTab = (tabId: string): void => {
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
        if (!cancelled) setAppConfig(config);
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
      setActiveTabId(existing.id);
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

  // T013 — Retomar (ui-spec §5, primário): `-r <session-id>` via
  // CommandBuilder (já testado no T006/CommandBuilder.test.ts, tabela
  // FR-003) — CONTINUA a mesma sessão (mesmo id). Nome da aba vem do
  // preview (sessionTabName, shared/sessions.ts) — mais informativo que só
  // o uuid do arquivo.
  const handleResumeSession = (session: SessionSummaryDto): void => {
    if (!previousSessionsProject) return;
    const args = buildClaudeArgs({ continuation: { type: 'resume', sessionId: session.id } });
    addTab({
      name: sessionTabName(session),
      cwd: previousSessionsProject.path,
      projectName: previousSessionsProject.name,
      pinned: false,
      launchArgs: args,
      sessionType: 'claude',
      // T403/T408 (004) — o `/rename` que esta sessão levou no CLI já veio no
      // índice; semeado aqui, `resolveSessionName` prefere ele ao preview (CA-1).
      customTitle: session.customTitle,
    });
    setSelectedProjectPath(previousSessionsProject.path);
    setPreviousSessionsProject(null);
  };

  // T013 — Fork (ui-spec §5, secundário, "nova sessão a partir desta"):
  // `-r <session-id> --fork-session` — confirmado em `claude --help` (flag
  // real: "When resuming, create a new session ID instead of reusing the
  // original (use with --resume or --continue)") — cria uma sessão com ID
  // NOVO a partir do histórico da original, que continua intacta.
  const handleForkSession = (session: SessionSummaryDto): void => {
    if (!previousSessionsProject) return;
    const args = buildClaudeArgs({ continuation: { type: 'fork', sessionId: session.id } });
    addTab({
      name: sessionTabName(session),
      cwd: previousSessionsProject.path,
      projectName: previousSessionsProject.name,
      pinned: false,
      launchArgs: args,
      sessionType: 'claude',
      // T403/T408 (004) — o `/rename` que esta sessão levou no CLI já veio no
      // índice; semeado aqui, `resolveSessionName` prefere ele ao preview (CA-1).
      customTitle: session.customTitle,
    });
    setSelectedProjectPath(previousSessionsProject.path);
    setPreviousSessionsProject(null);
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
    const args = buildLauncherArgs({
      providerId: options.providerId ?? undefined,
      model: options.model,
      effort: options.effort,
      permissionMode: options.permissionMode,
      sessionName: options.sessionName,
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
    });
    setSelectedProjectPath(options.projectPath);
    setLastLaunch({ args, cwd: options.projectPath, name });
    // T015 (FR-007 "defaults do launcher") — cada lançamento configurado vira
    // o default do PRÓXIMO Launcher aberto (mesmo espírito de "lembra a
    // última config" que o corpo do "＋ Nova sessão" já tinha via
    // `lastLaunch` em memória — agora persistido, sobrevive a restart).
    void window.donel.config
      .setLauncherDefaults({ model: options.model, effort: options.effort, permissionMode: options.permissionMode })
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
      setActiveTabId(existingTab.id);
      return;
    }

    const entry = appConfig?.sessionRegistry[sessionId];
    if (!entry) return;

    const project = projects.find((candidate) => candidate.path === entry.projectPath);
    const args = buildClaudeArgs({ continuation: { type: 'resume', sessionId } });
    addTab({
      name: entry.label,
      cwd: entry.projectPath,
      projectName: project?.name,
      pinned: false,
      launchArgs: args,
      sessionType: 'claude',
      customTitle: null,
    });
    setSelectedProjectPath(entry.projectPath);
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
  useEffect(() => {
    const unsubscribe = window.donel.sessions.onTranscriptChanged(
      ({ sessionId, customTitle, contextTokens: tokens, cliColorName }) => {
        // Chave é o `sessionId`, não o `tabId` — daí o `.map` próprio em vez do
        // `updateTab`. Uma mesma sessão retomada pode estar em mais de uma aba.
        // Fix #19 — `cliColorName` entra no MESMO `.map`: é o mesmo evento, a
        // mesma chave, nenhum segundo caminho de estado.
        setTabs((prev) =>
          prev.map((tab) => (tab.claudeSessionId === sessionId ? { ...tab, customTitle, cliColorName } : tab)),
        );

        // T610 (006) — MESMA assinatura, MESMO evento: a 006 só lê o segundo campo
        // do payload. Abrir uma segunda assinatura aqui era risco nomeado na
        // tabela de riscos do tasks.md (dois listeners no mesmo canal, um deles
        // órfão no double-invoke do StrictMode).
        setContextTokens((prev) => (prev[sessionId] === tokens ? prev : { ...prev, [sessionId]: tokens }));

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
   * Spec 010 / B6 — a projeção do store para o carrossel. Tudo que o mapa
   * mostra sai daqui: níveis, cards, trilha, detalhe, breadcrumb e a frase do
   * vazio. Nenhuma decisão de domínio acontece neste arquivo.
   */
  const mapView = useMemo(
    () => buildMapView(esteiraState?.snapshot ?? null, mapSelection),
    [esteiraState, mapSelection],
  );
  const storeWarning = esteiraState === null ? null : STORE_COMPATIBILITY_WARNING[esteiraState.compatibility];
  const storeReadOnly = esteiraState !== null && esteiraState.compatibility !== 'read-write';

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
   */
  const armEsteiraAutoStart = useCallback((tabId: string, command: string): void => {
    armWatchersRef.current[tabId]?.();

    let settled = false;

    const cleanup = (): void => {
      unsubscribe();
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      delete armWatchersRef.current[tabId];
    };

    const stop = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
    };

    const check = (): void => {
      if (settled) return;
      if (!isReadyForAutoStart({ renderedLines: terminalRefs.current[tabId]?.getRenderedLines() ?? [] })) return;

      // ⬇⬇ O único lugar do repo em que uma sessão de FASE DA ESTEIRA recebe
      // o próprio Enter — texto + `\r` num write só (mesmo padrão de
      // `buildModelInjection`, `shared/liveSessionInjection.ts`), para não
      // haver janela entre "digitou" e "enviou" onde uma corrida possa
      // acontecer. ⬇⬇
      const written = terminalRefs.current[tabId]?.injectCommand(withAutoEnter(command)) ?? false;
      if (!written) return; // PTY ainda não nasceu — tenta de novo no próximo sinal

      stop();
    };

    const unsubscribe = terminalRefs.current[tabId]?.onRenderedUpdate(check) ?? ((): void => {});
    const intervalId = setInterval(check, PRE_TYPE_POLL_MS);
    const timeoutId = setTimeout(() => {
      if (settled) return;
      stop();
      // O boot medido leva 14,5-20,9s; o teto (30s) sobra folga. Se estourar
      // mesmo assim, NADA foi enviado (nem o texto) — dizer isso é a única
      // frase honesta, e o comando manual continua disponível na tela do card.
      setDevModeToast('A sessão não ficou pronta a tempo — o comando não foi enviado. Rode-o você mesmo na aba.');
    }, PRE_TYPE_READY_TIMEOUT_MS);

    armWatchersRef.current[tabId] = cleanup;
    check();
  }, []);

  /**
   * Spec 010 / batch B1 — o "Preparar" da esteira nova abre a sessão de
   * verdade. Mesma divisão do Modo Dev: a DECISÃO (onde abrir, com que comando)
   * é pura e vive em `Esteira/esteiraSession.ts`; aqui só o encanamento —
   * criar a aba e amarrá-la à sessão registrada no histórico.
   *
   * Batch B5 — o comando não fica só pré-digitado: `armEsteiraAutoStart`
   * também aperta o Enter, sozinho, assim que o CLI prova que está pronto.
   */
  const handleOpenEsteiraSession = (request: EsteiraSessionRequest): void => {
    const tabId = addTab({
      name: request.tabName,
      cwd: request.cwd,
      projectName: projects.find((project) => project.path === request.cwd)?.name,
      pinned: false,
      // Sem `--model`/`--effort`: a fase da esteira nova não tem tabela de
      // defaults (`run.phase` é string livre, `[P-4]`), e inventar um modelo
      // aqui seria o app decidindo o que ninguém declarou.
      launchArgs: [],
      sessionType: 'claude',
    });
    esteiraTabSessionsRef.current[tabId] = request.sessionId;
    armEsteiraAutoStart(tabId, request.command);
  };

  /**
   * Spec 010 / B6 — "⌁ Preparar" na trilha do mapa. É o MESMO gesto do painel
   * do store: a orquestração inteira mora em `preparePhase` (resolver o cwd,
   * disparar, abrir a aba com o comando escrito, dizer o que aconteceu). Duas
   * orquestrações do mesmo disparo divergiriam no primeiro conserto — e
   * divergir aqui significa uma tela abrindo sessão onde a outra recusa.
   */
  const handleMapPrepare = (step: MapTrailStep): void => {
    const snapshot = esteiraState?.snapshot;
    if (!snapshot) return;
    const card = cardView(snapshot, mapView.focused.discoveryId ?? '');
    if (card === null) return;
    // Quem diz se esta fase pode rodar sobre este assunto é `dispatchView` (B2)
    // — o mapa pergunta, nunca recalcula.
    const oferta = dispatchView(card, { phase: step.phase, targetKey: `${step.subject.entity}:${step.subject.id}` });
    if (oferta.target === null) return;
    if (!oferta.canDispatch) {
      setDevModeToast(oferta.blocked ?? oferta.hint);
      return;
    }
    void preparePhase(
      { card, phase: step.phase, target: oferta.target, projects },
      { dispatch: (payload) => window.donel.esteira.dispatch(payload), openSession: handleOpenEsteiraSession },
    ).then((result) => {
      setEsteiraState(result.state);
      setDevModeToast(result.message);
    });
  };

  /**
   * B1 (batch N5) — "↺ Retomar" na trilha do mapa: reabre a ÚLTIMA sessão da
   * cadeia daquele passo já FECHADO (`claude -r <cliSessionId>` no `cwd`
   * dela — `step.resume` já vem resolvido de `esteiraMapView.trailFor`,
   * pura). SEM dispatch novo, SEM mudar estado do card: quem muda estado é
   * fato declarado por skill, nunca o gesto de abrir. Mesmo padrão de
   * `handleFocusOrResumeFavoriteSession` (007): aba já aberta com essa
   * sessão ganha foco, em vez de abrir outra.
   */
  const handleMapResume = (step: MapTrailStep): void => {
    if (step.resume === null) return;
    const { cliSessionId, cwd } = step.resume;
    const existingTab = tabs.find((tab) => tab.claudeSessionId === cliSessionId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }
    const discoveryTitle = mapView.breadcrumb[0] ?? step.phase;
    addTab({
      name: esteiraTabName(step.phase, discoveryTitle),
      cwd,
      projectName: projects.find((project) => project.path === cwd)?.name,
      pinned: false,
      launchArgs: buildClaudeArgs({ continuation: { type: 'resume', sessionId: cliSessionId } }),
      sessionType: 'claude',
    });
  };

  /**
   * B2 (batch N5) — navegar o mapa até um nó alterna para a aba da sessão
   * VIVA dele, quando existe. `tabToFocusFor` (esteiraMapView, pura) é quem
   * decide o FATO — `SessionSnapshot.endedAt === null` cruzado com as abas
   * abertas; esta função só aplica o resultado. Nó sem sessão viva não rouba
   * foco (`tabId` vem `null`, nada muda) — sessão fechada nunca é alvo de
   * alternância; para isso existe o retomar explícito do B1.
   */
  const focusLiveSessionOf = (discoveryId: string, subject: EntityId): void => {
    const tabId = tabToFocusFor(esteiraState?.snapshot ?? null, discoveryId, subject, tabs);
    if (tabId !== null) setActiveTabId(tabId);
  };

  /**
   * C3 — o artefato de tasks.md do nó em foco no detalhe, e o caminho
   * ABSOLUTO resolvido pra lê-lo. `resolveSessionCwd` é a MESMA resolução
   * repo→caminho local que já decide onde a sessão de terminal abre (D-6) —
   * reusada aqui, não recalculada: um repo que o app não conhece não vira
   * leitura silenciosa por palpite, do mesmo jeito que não vira sessão.
   */
  const tasksTarget = useMemo(() => {
    const snapshot = esteiraState?.snapshot;
    if (!snapshot || mapView.focused.discoveryId === null || mapView.detail === null) return null;
    const card = cardView(snapshot, mapView.focused.discoveryId);
    if (card === null) return null;
    const artifact = tasksArtifactFor(card, mapView.detail.subject);
    if (artifact === null || artifact.location !== 'repo' || artifact.repo === null) return null;
    const resolved = resolveSessionCwd(artifact.repo, projects);
    if (!resolved.ok) return null;
    const separator = resolved.cwd.endsWith('/') || resolved.cwd.endsWith('\\') ? '' : '/';
    return { path: `${resolved.cwd}${separator}${artifact.path}` };
  }, [esteiraState, mapView.focused.discoveryId, mapView.detail, projects]);

  useEffect(() => {
    if (tasksTarget === null) return;
    if (taskDocFetchingRef.current.has(tasksTarget.path)) return;
    taskDocFetchingRef.current.add(tasksTarget.path);
    void window.donel.esteira.readArtifactText({ path: tasksTarget.path }).then((result) => {
      setTaskDocByPath((prev) => ({ ...prev, [tasksTarget.path]: result.ok ? result.text : null }));
    });
  }, [tasksTarget]);

  /** C3 — o texto já lido (se houver) interpretado por `shared/tasksDoc` (puro): o painel de detalhe só desenha o que sai daqui. */
  const tasksView = useMemo((): TasksRunningTogetherView | null => {
    if (tasksTarget === null) return null;
    const text = taskDocByPath[tasksTarget.path];
    if (text === undefined || text === null) return null;
    const tasks = parseTasksDoc(text);
    const scope = taskScope(tasks);
    return scope === null ? null : { scope, tasks };
  }, [tasksTarget, taskDocByPath]);

  /** D-11 — a trava é fato local, e sai num gesto. Nada de etiqueta órfã no board. */
  const handleMapReleaseLock = (): void => {
    const lock = mapView.detail?.lock;
    const snapshot = esteiraState?.snapshot;
    if (!lock || !snapshot) return;
    const card = cardView(snapshot, mapView.focused.discoveryId ?? '');
    if (card?.lock == null) return;
    void window.donel.esteira
      .releaseLock({ subject: card.lock.subject, phase: card.lock.phase })
      .then(setEsteiraState)
      .catch(() => undefined);
  };

  /** D-12 — reenviar o espelho é cortesia: não desbloqueia nada local, e a frase fala do board. */
  const handleMapRetryMirror = (): void => {
    void window.donel.esteira
      .retryMirror()
      .then((state) => {
        setEsteiraState(state);
        const pendente = state.snapshot.mirrorQueue.length;
        setDevModeToast(pendente === 0 ? 'O board recebeu o que faltava.' : `${pendente} operação(ões) ainda não foram aceitas pelo board.`);
      })
      .catch(() => undefined);
  };

  // T009 — antes do primeiro evento de hook chegar pra uma aba recém-criada,
  // assume 'working' (spike: estado inicial otimista) com stateEnteredAt=0
  // (sortSessions trata omitido/0 como "a mais antiga possível" — nunca
  // perde o desempate de FR-010/CA-6 por causa disso).
  /**
   * T408 (004) — CA-5: UMA função de resolução por sessão, consumida pela aba,
   * pela linha da sidebar e pela lista de sessões anteriores. Se cada lugar
   * decidisse o nome por conta própria, os três divergiriam.
   * Aba `shell` não tem sessão do Claude: seu nome é o `tab.name` e ponto (C4).
   */
  const resolveTabName = (tab: TabState): string => {
    if (tab.sessionType !== 'claude') return tab.name;
    return resolveSessionName({
      fallback: tab.name,
      customTitle: tab.customTitle ?? null,
      stored: (tab.claudeSessionId ? appConfig?.sessionNames[tab.claudeSessionId] : undefined) ?? null,
    });
  };

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

  const sidebarSessions: SidebarSession[] = tabs
    .filter((tab) => !(tab.claudeSessionId && registeredFavoriteIds.has(tab.claudeSessionId)))
    .map((tab) => ({
      id: tab.id,
      name: resolveTabName(tab),
      projectName: tab.projectName,
      state: semaphoreStates[tab.id]?.state ?? 'working',
      stateEnteredAt: semaphoreStates[tab.id]?.stateEnteredAt,
      pinned: tab.pinned,
      active: tab.id === activeTabId,
    }));

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

  // Mesma ordenação da sidebar (sessionOrdering.ts) — FR-013 usa essa lista
  // ranqueada tanto pro Ctrl+1..9 (posição N) quanto pro Ctrl+Tab (próxima
  // sessão que precisa de atenção).
  const orderedSessions = useMemo(() => sortSessions(sidebarSessions), [sidebarSessions]);

  // FR-013 — Ctrl+1..9 foca a sessão na posição N da lista ranqueada;
  // Ctrl+Tab foca a próxima que precisa de atenção (permissão > aguardando).
  // Capture na fase de captura + preventDefault/stopPropagation: sem isso o
  // xterm embaixo (foco na aba ativa) recebe as teclas como input normal do
  // terminal em vez do atalho do app.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      if (event.key === 'Tab') {
        const target = nextAttentionSessionId(orderedSessions, activeTabIdRef.current);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        setActiveTabId(target);
        return;
      }

      const position = Number(event.key);
      if (Number.isInteger(position) && position >= 1 && position <= 9) {
        const target = sessionIdAtPosition(orderedSessions, position);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        setActiveTabId(target);
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [orderedSessions]);

  // Notificação Windows opcional (ui-spec §3, FR-010) quando uma sessão em
  // BACKGROUND passa a precisar de atenção — nunca pra aba já em foco (o
  // usuário já está olhando). `app.setAppUserModelId` (main/index.ts) é o
  // que garante a notificação sair atribuída ao Donel Dev, não a "Electron".
  //
  // FIX (feedback E2E rodada 4, batch 3 achado "notificar toda transição
  // vira spam") — antes SEMPRE disparava pra waiting+permission; agora
  // filtra pela preferência do ConfigStore (T015): 'all' preserva o
  // comportamento antigo, 'permission-only' (default) só a transição que de
  // fato TRAVA a sessão, 'none' desliga. `previousSemaphoreStatesRef` é
  // atualizado INCONDICIONALMENTE (mesmo com 'none') — trocar a preferência
  // de volta pra mais permissiva no meio de uma sessão não deve disparar
  // notificação retroativa de uma transição que já aconteceu enquanto
  // estava desligado.
  useEffect(() => {
    const preference = appConfig?.notificationPreference ?? FALLBACK_NOTIFICATION_PREFERENCE;
    const previous = previousSemaphoreStatesRef.current;

    if (preference !== 'none') {
      for (const tab of tabs) {
        const nextState = semaphoreStates[tab.id]?.state;
        const prevState = previous[tab.id]?.state;
        if (!nextState || nextState === prevState) continue; // só na TRANSIÇÃO de estado, não a cada update
        if (tab.id === activeTabId) continue; // aba em foco não precisa de toast
        if (nextState !== 'waiting' && nextState !== 'permission') continue;
        if (preference === 'permission-only' && nextState !== 'permission') continue;

        try {
          if (typeof Notification === 'undefined') continue;
          const title = nextState === 'permission' ? 'Permissão pendente' : 'Aguardando sua resposta';
          const body =
            nextState === 'permission' ? `Sessão "${tab.name}" precisa da sua aprovação.` : `Sessão "${tab.name}" terminou o turno.`;
          const notification = new Notification(title, { body });
          notification.onclick = () => setActiveTabId(tab.id);
        } catch {
          // Notificação é opcional (ui-spec §3) — nunca deve derrubar a UI.
        }
      }
    }
    previousSemaphoreStatesRef.current = semaphoreStates;
  }, [semaphoreStates, tabs, activeTabId, appConfig?.notificationPreference]);

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
  // tinha ligado), com a régua real da 006: `min(300k, janela do modelo)`.
  //
  // O denominador segue vindo de `effectiveContextZone` — a decisão de 24/07
  // dele — e NÃO do default de 400k do design-system.
  const activeContextTokens = activeTab?.claudeSessionId ? (contextTokens[activeTab.claudeSessionId] ?? null) : null;
  const activeClaudeTab = activeTab && activeTab.sessionType === 'claude' ? activeTab : null;
  const activeModel = activeClaudeTab ? (sessionModelEffort[activeClaudeTab.id]?.model ?? DEFAULT_MODEL_ALIAS) : null;
  const activeModelEffort = activeClaudeTab
    ? `${activeModel}/${sessionModelEffort[activeClaudeTab.id]?.effort ?? DEFAULT_EFFORT_LEVEL}`
    : undefined;
  // Sem leitura ainda (ou aba shell) o medidor NÃO aparece — nunca um `0%`
  // fabricado no lugar de "não há leitura" (CA-4 da 006).
  const activeSmartZone =
    activeModel !== null && activeContextTokens !== null
      ? { usedTokens: activeContextTokens, maxTokens: effectiveContextZone(activeModel) }
      : undefined;

  // T1221 (011-contas-e-provedores, etapa 2) — `accountLabel` é o rótulo
  // GLOBAL (badge do titlebar/AccountsPanel, "que conta a PRÓXIMA sessão
  // usa"): conta ativa do motor quando ele está ligado; "Motor inerte"
  // enquanto `accounts.mod` for `null` (comportamento de hoje, sem perfis).
  const activeAccountSummary = accountsView.accounts.find((account) => account.id === accountsView.activeAccountId) ?? null;
  const accountLabel = activeAccountSummary?.label ?? (accountsView.mod === null ? 'Motor inerte' : 'Conta ativa');

  // "Statusbar deve mostrar a conta com que a sessão EM FOCO foi criada",
  // não a conta ATIVA global — `accountLabel` acima é só o fallback pra
  // janela curta antes de `sessionAccounts[activeTab.id]` resolver (ver
  // `computeSessionAccountLabel`). Sem aba ativa (0 sessões abertas), cai no
  // `accountLabel` global também — não há "aba em foco" nesse estado.
  //
  // C25 — uma unidade só: a cota é `AccountLoad` (% consumido) da conta de
  // NASCIMENTO da aba, lida do MESMO `accountsView` que alimenta o painel
  // (não mais `ProfileQuota`/`profileHeadroom`, mortos nesta troca de fonte).
  const activeSessionAccount = activeTab ? sessionAccounts[activeTab.id] : undefined;
  const activeSessionLoad: AccountLoad | null =
    (activeSessionAccount && accountsView.accounts.find((account) => account.id === activeSessionAccount.id)?.load) ?? null;
  const activeSessionAccountLabel = activeTab
    ? computeSessionAccountLabel(
        { sessionType: activeTab.sessionType, account: activeSessionAccount },
        accountLabel,
        activeSessionLoad,
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
      const model = sessionModelEffort[tab.id]?.model ?? DEFAULT_MODEL_ALIAS;
      map[tab.claudeSessionId] = formatSmartZoneLabel(used, effectiveContextZone(model));
    }
    return map;
  }, [tabs, contextTokens, sessionModelEffort]);

  return (
    <div className={styles.shell}>
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
            value={devModeOn ? 'dev' : 'geral'}
            onChange={(next) => setDevModeOn(next === 'dev')}
            options={[
              { value: 'geral', label: 'Uso geral' },
              { value: 'dev', label: 'Dev' },
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
        <AccountsPanel onViewChange={handleAccountsViewChange} />
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
        {devModeOn ? (
          // FIX (rodada de feedback 30/07, item 2) — "o botão de ocultar
          // barra lateral não oculta a barra direita": o ícone é
          // Panel-RIGHT-Close/Open, mas até aqui `rightCollapsed` só zerava
          // a coluna ESQUERDA (o mapa, que migrou de lado no lote 7 —
          // `bodyMapCollapsed`). O painel de 316px à direita
          // (`PhaseDetailsPanel`) nunca obedecia a este botão. Mesmo
          // estado, agora os dois painéis do Modo Dev — mapa e detalhe —
          // respondem ao mesmo gesto (ver `.bodyMapCollapsed` no CSS e a
          // condição de `PhaseDetailsPanel` logo abaixo).
          <button
            type="button"
            className={styles.preferencesButton}
            onClick={() => setRightCollapsed((prev) => !prev)}
            aria-label={rightCollapsed ? 'Mostrar painéis do Modo Dev' : 'Recolher painéis do Modo Dev'}
            title={rightCollapsed ? 'Mostrar painéis do Modo Dev' : 'Recolher painéis do Modo Dev'}
          >
            {rightCollapsed ? (
              <PanelRightOpen size={16} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <PanelRightClose size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        ) : null}
        {/* Spec 010 — gesto interno para a esteira nova. Fica só no Modo Dev e
            NÃO substitui o mapa: os dois convivem até o vertical fechar. */}
        {devModeOn ? (
          <button
            type="button"
            className={styles.preferencesButton}
            onClick={() => setEsteiraOpen((prev) => !prev)}
            aria-label={esteiraOpen ? 'Voltar ao mapa atual' : 'Abrir a esteira nova'}
            title={esteiraOpen ? 'Voltar ao mapa atual' : 'Abrir a esteira nova (spec 010)'}
            data-testid="esteira-toggle"
          >
            <Route size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className={styles.preferencesButton}
          onClick={() => setPreferencesOpen(true)}
          aria-label="Preferências"
          title="Preferências"
        >
          <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {/* D11/CA-15 (009-modo-dev-v3) — "＋ Nova sessão" não pertence ao Modo
            Dev: lá as sessões nascem da esteira (trilha do mapa, "⌁
            Preparar"), nunca de um atalho ad-hoc. O modo clássico preserva o
            gesto por inteiro. */}
        {!devModeOn ? (
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
        ) : null}
      </header>

      <div
        className={[
          styles.body,
          devModeOn ? styles.bodyDevMode : '',
          sidebarCollapsed ? styles.bodySidebarCollapsed : '',
          // Clássico sem Launcher: coluna direita (320px, Launcher) zerada.
          !devModeOn && !launcherOpen ? styles.bodyRightCollapsed : '',
          // Lote 7 — o mapa mudou de coluna (CA-7: agora é a ESQUERDA, 480px).
          // "Recolher mapa" (botão do titlebar) zera essa coluna; o Launcher
          // aberto por cima não depende dela (vive na coluna direita).
          devModeOn && rightCollapsed ? styles.bodyMapCollapsed : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Spec 010 — a esteira nova entra POR CIMA, sem desmontar nada: o
            mapa atual segue vivo por baixo (`[P-5]` — ele só sai no fim do
            vertical, quando o novo provar a espinha). */}
        {devModeOn && esteiraOpen ? (
          <EsteiraScreen onClose={() => setEsteiraOpen(false)} projects={projects} onOpenSession={handleOpenEsteiraSession} />
        ) : null}

        {/* CA-20 — a tela de hoje continua MONTADA quando o Modo Dev liga
            (só oculta por CSS): nada de remontar sidebar/abas, nada de PTY
            recriado. Mesmo princípio já usado nas abas de terminal (T007).
            FIX (revisão do orquestrador, app-06 regenerado) — "Sessões
            anteriores" (item 11) é uma TELA irmã de `.body` na MESMA linha
            do grid (`.previousSessionsScreen`, `grid-row: 2`), não um
            `Modal` portalizado: sem esconder esta zona também, o rótulo
            "PROJETOS" e a scrollbar da sidebar continuavam vivos por baixo
            e vazavam na borda inferior do print — mesmo princípio de
            `devModeOn`, mais um caso que reorganiza o miolo por cima da
            tela de hoje. */}
        <div
          className={devModeOn || sidebarCollapsed || previousSessionsProject !== null ? styles.zoneHidden : styles.zone}
          data-testid="today-sidebar"
        >
        <ProjectSidebar
          sessions={sidebarSessions}
          onFocusSession={setActiveTabId}
          onTogglePin={handleTogglePin}
          onRenameSession={handleRenameTab}
          favoriteGroups={favoriteGroups}
          onToggleFavoriteGroupCollapsed={handleToggleFavoriteGroupCollapsed}
          onFocusOrResumeFavoriteSession={handleFocusOrResumeFavoriteSession}
          onToggleFavoriteSessionPinned={handleToggleFavoriteSessionPinned}
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
            <div className={styles.tabBarScroll}>
            {tabs.map((tab, index) => (
              <TerminalTab
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
                active={tab.id === activeTabId}
                onClick={() => setActiveTabId(tab.id)}
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
          {(devModeOn ? mapView.breadcrumb.length > 0 : tabs.length > 0) ? (
            <div className={styles.sessionHeader} data-testid="session-header">
              {/* Spec 010 / B6 — o breadcrumb passou a ser o dos nós novos:
                  discovery › plano › item. Ele vem pronto de `buildMapView`;
                  montá-lo aqui seria a terceira redação da mesma navegação. */}
              {devModeOn && mapView.breadcrumb.length > 0 ? (
                <>
                  {mapView.breadcrumb.map((step, index) => (
                    <span key={step} className={index === 0 ? styles.sessionHeaderId : styles.sessionHeaderTitle}>
                      {index > 0 ? '› ' : ''}
                      {step}
                    </span>
                  ))}
                  {mapView.detail?.phase ? <span className={styles.sessionHeaderFase}>{mapView.detail.phase}</span> : null}
                </>
              ) : (
                <>
                  <span className={styles.sessionHeaderTitle}>{activeTab ? resolveTabName(activeTab) : ''}</span>
                  {activeTab?.cwd ? <span className={styles.sessionHeaderPath}>{activeTab.cwd}</span> : null}
                </>
              )}
              <div className={styles.sessionHeaderSpacer} />
              {activeClaudeTab ? (
                <StateDot
                  state={semaphoreStates[activeClaudeTab.id]?.state ?? 'working'}
                  label={SESSION_STATE_LABEL_PT[semaphoreStates[activeClaudeTab.id]?.state ?? 'working']}
                />
              ) : null}
            </div>
          ) : null}
          <div className={styles.terminal}>
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
            {tabs.length === 0 && !devModeOn ? (
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
            {/* Item 2 — vazio NEUTRO do Modo Dev sem sessão: só a moldura
                (fundo + hairline do próprio `.terminal`); com etapa em foco,
                um texto de condução que aponta pro mapa (nunca um narrativa
                por etapa fabricada — não há fonte pra isso). */}
            {tabs.length === 0 && devModeOn ? (
              <div className={styles.devModeTerminalEmpty} data-testid="devmode-terminal-empty">
                {mapView.detail ? (
                  <p className={styles.devModeHint}>
                    — nenhuma sessão para esta etapa ainda — use "⌁ Preparar" na trilha do mapa.
                  </p>
                ) : null}
              </div>
            ) : null}
            {tabs.map((tab) => (
              <div key={tab.id} className={tab.id === activeTabId ? styles.terminalPane : styles.terminalPaneHidden}>
                <TerminalPane
                  ref={(handle) => {
                    terminalRefs.current[tab.id] = handle;
                  }}
                  sessionType={tab.sessionType}
                  cwd={tab.cwd}
                  args={tab.launchArgs}
                  providerId={tab.providerId}
                  onStateChange={(info) => handleSemaphoreChange(tab.id, info)}
                  onAliveChange={(alive) => handleAliveChange(tab.id, alive)}
                  onAccountResolved={(account) => handleAccountResolved(tab.id, account)}
                  // T404/T408 — o id da sessão chega aqui e vira a chave de
                  // persistência do nome desta aba (CA-6).
                  onClaudeSessionIdResolved={(claudeSessionId) => {
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
                  onCloseTab={() => handleRequestCloseTab(tab.id)}
                />
              </div>
            ))}
          </div>
        </main>

        {/* FIX (feedback E2E rodada 3, painel colapsável) — deixa de ser
            fixo: só monta quando `launcherOpen` (aberto via item "Sessão
            Claude" do menu do "＋ Nova sessão", ou fechado ao lançar/Esc);
            fechado, o espaço vai pro `.center` (terminal), ver
            `styles.bodyPanelClosed` acima. */}
        {/* Zona 3 — o mapa do discovery em foco (CA-7..CA-16). Lote 7: agora
            na coluna ESQUERDA de 480px (a compressão da v2 saiu — o mapa não
            divide coluna com o Launcher nunca mais). "Recolher mapa" (botão
            do titlebar) zera essa coluna. */}
        {/* FIX #15 (e2e 30/07, reincidente em 31/07) — "recolher a barra
            lateral deixa o mapa desenhado POR CIMA do terminal": recolher só
            zerava a COLUNA (`--col-left: 0px`) e o mapa continuava montado,
            transbordando de uma caixa de largura zero. Colapsar a lateral
            agora desmonta o mapa — preservado abaixo (`!sidebarCollapsed`).
            C4 (batch N5) — BUG relacionado, mas inverso: ocultar a barra
            DIREITA (`rightCollapsed`, botão "Recolher painéis") desmontava o
            mapa ESQUERDO também, perdendo o estado do carrossel a cada
            toggle. O mapa agora fica montado sempre que o Modo Dev está
            ligado e a lateral não colapsou; `rightCollapsed` vira só a prop
            `collapsed` (largura 0 via CSS, ver `.mapCollapsed`), nunca mais a
            condição de montagem. */}
        {devModeOn && !sidebarCollapsed ? (
          <DiscoveryMap
            view={mapView}
            selection={mapSelection}
            warning={storeWarning}
            collapsed={rightCollapsed}
            onFocusDiscovery={(discoveryId) => {
              // Trocar de card zera o que pertence ao card: o plano, o item e o
              // nó do detalhe apontariam para algo que não está mais na tela.
              setMapSelection({ discoveryId, planId: null, itemId: null, nodeKey: null, phase: null });
              // B2 — navegar até o discovery alterna para a aba da sessão viva
              // DELE, quando existe (nó sem sessão viva não rouba foco).
              focusLiveSessionOf(discoveryId, { entity: 'discovery', id: discoveryId });
            }}
            onFocusPlan={(planId) => {
              setMapSelection((prev) => ({ ...prev, planId, itemId: null, nodeKey: null, phase: null }));
              if (mapView.focused.discoveryId) focusLiveSessionOf(mapView.focused.discoveryId, { entity: 'plan', id: planId });
            }}
            onFocusItem={(itemId) => {
              setMapSelection((prev) => ({ ...prev, itemId, nodeKey: `work_item:${itemId}`, phase: null }));
              if (mapView.focused.discoveryId) focusLiveSessionOf(mapView.focused.discoveryId, { entity: 'work_item', id: itemId });
            }}
            onSelectNode={(nodeKey, phase) => setMapSelection((prev) => ({ ...prev, nodeKey, phase }))}
            onPrepare={handleMapPrepare}
            onResume={handleMapResume}
            onNewDiscovery={() => setEsteiraOpen(true)}
          />
        ) : null}

        {/* Painel de 316px à direita (CA-7) — o mapa NUNCA carrega o detalhe
            dentro de si; esqueleto aqui, conteúdo rico no lote 8. Quando o
            Launcher está aberto, ele ocupa esta mesma coluna (mesmo padrão
            de antes). FIX (item 2, rodada 30/07) — `!rightCollapsed`: o
            botão "Recolher painéis" do titlebar agora também esconde este
            painel, não só o mapa (ver comentário do botão e `.bodyMapCollapsed`). */}
        {devModeOn && !launcherOpen && !rightCollapsed ? (
          <PhaseDetailsPanel
            detail={mapView.detail}
            onReleaseLock={handleMapReleaseLock}
            onRetryMirror={handleMapRetryMirror}
            readOnly={storeReadOnly}
            tasks={tasksView}
          />
        ) : null}

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

      <StatusBar
        accountLabel={activeSessionAccountLabel}
        modelEffort={activeModelEffort}
        sessionCount={tabs.length}
        smartZone={activeSmartZone}
        accountTestId="statusbar-account"
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
          />
        </div>
      ) : null}

      {/* D4 — Toast do Modo Dev: uma linha, SEM ação de desfazer. Trocar o
          foco já é reversível pelo próprio gesto (clicar no outro card); uma
          máquina de "desfazer" não agregaria valor nenhum. */}
      <Toast open={devModeToast !== null} message={devModeToast ?? ''} onDismiss={() => setDevModeToast(null)} />

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
      />
    </div>
  );
}
