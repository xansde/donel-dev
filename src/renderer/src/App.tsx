import { Button, Modal, SplitButton, StatusBar, TerminalTab } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectInfo, SemaphoreStateInfo, SessionSummaryDto } from '../../shared';
import {
  buildClaudeArgs,
  DEFAULT_EFFORT_LEVEL,
  DEFAULT_MODEL_ALIAS,
  parseModelEffortFromArgs,
} from '../../shared/commandBuilder';
import type { EffortLevel, ModelAlias } from '../../shared/commandBuilder';
import {
  buildEffortInjection,
  buildModelInjection,
  canInjectLiveCommand,
  hasLiveInjectionConfirmation,
} from '../../shared/liveSessionInjection';
import { sortProjects } from '../../shared';
import { sortSessions } from '../../shared/sessionOrdering';
import { nextAttentionSessionId, sessionIdAtPosition } from '../../shared/sessionShortcuts';
import { sessionTabName } from '../../shared/sessions';
import styles from './App.module.css';
import { Launcher } from './Launcher';
import type { LauncherLaunchOptions } from './Launcher';
import { PreviousSessions } from './PreviousSessions';
import { ProfileSwitcher } from './ProfileSwitcher';
import { ProjectSidebar } from './ProjectSidebar';
import type { SidebarSession } from './ProjectSidebar';
import { SessionDetails } from './SessionDetails';
import { TerminalPane } from './TerminalPane';
import type { TerminalPaneHandle } from './TerminalPane';

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
  /** Nome da aba/sessão — nome do projeto quando aberta pela sidebar. */
  name: string;
  /** cwd do PTY; undefined = home (aba inicial, sem projeto associado). */
  cwd?: string;
  projectName?: string;
  pinned: boolean;
  /** Argv do CommandBuilder (T008 — Launcher); undefined = sessão sem flags (abertura direta pela sidebar). */
  launchArgs?: string[];
  /** 'claude' (default) = sessão claude direta no PTY; 'shell' = terminal livre (FR-008, powershell.exe). */
  sessionType: 'claude' | 'shell';
}

/** Último lançamento do Launcher — CA-1 (comando exato) + reaproveitado pelo corpo do "＋ Nova sessão" (ui-spec §2, zona 1). */
interface LastLaunch {
  args: string[];
  cwd: string;
  name: string;
}

const INITIAL_TABS: TabState[] = [{ id: 'default', name: 'Sessão', pinned: false, sessionType: 'claude' }];

// T013 (correção herdada) — timeout total de espera pela confirmação real do
// CLI depois de uma injeção de `/model`/`/effort` (rede de segurança — a
// checagem em si é orientada a evento, não poll; ver `watchLiveInjection`
// dentro do componente).
const LIVE_INJECTION_TIMEOUT_MS = 20_000;

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
  const [activeTabId, setActiveTabId] = useState(INITIAL_TABS[0].id);
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
  const tabIdCounter = useRef(0);
  // T014 — rótulo de conta pra Statusbar (ui-spec §2 zona 5), reportado pelo
  // ProfileSwitcher (que já busca `window.donel.profiles.*` pro dropdown do
  // titlebar — ver comentário de topo de ProfileSwitcher.tsx).
  const [accountLabel, setAccountLabel] = useState('Principal');
  // T009 — estado do semáforo por aba (chave = tab.id), alimentado pelo
  // callback que cada TerminalPane levanta via onStateChange.
  const [semaphoreStates, setSemaphoreStates] = useState<Record<string, SemaphoreStateInfo>>({});
  const previousSemaphoreStatesRef = useRef<Record<string, SemaphoreStateInfo>>({});
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // T010 — FR-006: "aba ativa" (processo vivo) por tab.id, alimentado por
  // `onAliveChange` (TerminalPane.tsx). Decide se fechar a aba pede
  // confirmação (true) ou fecha direto (false/ausente — connecting sem PTY
  // ainda, ou já 'ended'/'claude-not-found').
  const [aliveTabs, setAliveTabs] = useState<Record<string, boolean>>({});
  // T010 — aba com fechamento pendente de confirmação (modal "Fechar sessão?", ui-spec §2); null = nenhum modal aberto.
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  // T011 — modelo/esforço "atual" de cada aba claude (chave = tab.id), pro
  // controle da toolbar (SessionDetails) mostrar o valor certo pré-selecionado
  // e refletir a troca depois de uma injeção bem-sucedida. Semeado no
  // `addTab` (parseModelEffortFromArgs do launchArgs, se houver, senão os
  // defaults do Brief 3) — nunca undefined pra uma aba 'claude' já criada.
  // A aba 'default' de INITIAL_TABS nasce fora do `addTab` (é o estado
  // inicial), por isso precisa do mesmo seed aqui.
  const [sessionModelEffort, setSessionModelEffort] = useState<Record<string, { model: ModelAlias; effort: EffortLevel }>>({
    [INITIAL_TABS[0].id]: { model: DEFAULT_MODEL_ALIAS, effort: DEFAULT_EFFORT_LEVEL },
  });
  // T011 — handle imperativo de cada TerminalPane viva (ver TerminalPaneHandle):
  // ref callback comum, não state (não precisa re-render quando muda; o
  // próprio React já nula a entrada no unmount da aba).
  const terminalRefs = useRef<Record<string, TerminalPaneHandle | null>>({});
  // T013 (correção herdada) — troca de modelo/esforço por aba (chave =
  // tab.id) já ESCRITA no stdin mas ainda sem confirmação real do CLI no
  // terminal renderizado; `undefined` = nenhuma injeção em voo nesta aba.
  // Enquanto pendente, a toolbar (SessionDetails) fica desabilitada e mostra
  // um hint distinto — `sessionModelEffort` só muda quando `watchLiveInjection`
  // (abaixo) vir a confirmação de verdade. Ver shared/liveSessionInjection.ts.
  const [pendingInjection, setPendingInjection] = useState<Record<string, 'model' | 'effort' | undefined>>({});
  // Função de cleanup (unsubscribe de `onRenderedUpdate` + clearTimeout) por
  // aba com injeção em voo — ver `watchLiveInjection`.
  const pendingInjectionWatchersRef = useRef<Record<string, (() => void) | undefined>>({});

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

  const handleSemaphoreChange = useCallback((tabId: string, info: SemaphoreStateInfo): void => {
    setSemaphoreStates((prev) => ({ ...prev, [tabId]: info }));
  }, []);

  const handleAliveChange = useCallback((tabId: string, alive: boolean): void => {
    setAliveTabs((prev) => (prev[tabId] === alive ? prev : { ...prev, [tabId]: alive }));
  }, []);

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
      const parsed = parseModelEffortFromArgs(partial.launchArgs);
      setSessionModelEffort((prev) => ({
        ...prev,
        [id]: { model: parsed.model ?? DEFAULT_MODEL_ALIAS, effort: parsed.effort ?? DEFAULT_EFFORT_LEVEL },
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
    setSessionModelEffort((prev) => omitKey(prev, tabId));
    // T013 — uma injeção pendente cuja confirmação ainda não chegou não pode
    // continuar rodando pra uma aba que acabou de fechar (nem escreveria
    // estado errado — `setPendingInjection`/`setSessionModelEffort` seriam
    // no-ops sem a chave —, mas o listener/timeout ficaria vivo à toa até o
    // timeout; melhor limpar já).
    pendingInjectionWatchersRef.current[tabId]?.();
    delete pendingInjectionWatchersRef.current[tabId];
    setPendingInjection((prev) => omitKey(prev, tabId));
    delete terminalRefs.current[tabId];
  };

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
    });
    setSelectedProjectPath(previousSessionsProject.path);
    setPreviousSessionsProject(null);
  };

  // T008 — Launcher (ui-spec §4, FR-003, CA-1): monta o argv via
  // buildClaudeArgs (CommandBuilder puro, T006) e abre uma aba NOVA (o
  // Launcher é lançamento configurado, distinto do clique direto no nome do
  // projeto acima, que reaproveita/foca uma aba existente com defaults).
  const handleLaunch = (options: LauncherLaunchOptions): void => {
    const args = buildClaudeArgs({
      model: options.model,
      effort: options.effort,
      permissionMode: options.permissionMode,
      sessionName: options.sessionName || undefined,
    });
    const name = options.sessionName || options.projectName;
    addTab({ name, cwd: options.projectPath, projectName: options.projectName, pinned: false, launchArgs: args, sessionType: 'claude' });
    setSelectedProjectPath(options.projectPath);
    setLastLaunch({ args, cwd: options.projectPath, name });
    // FIX (feedback E2E rodada 3) — painel colapsável: "fecha ao lançar".
    setLauncherOpen(false);
  };

  // T010 — corpo do "＋ Nova sessão" (ui-spec §2, zona 1): "clique no corpo
  // abre direto com a última configuração de sessão Claude usada" (também o
  // item de menu "Sessão Claude" — mesma ação, dois gatilhos). Sem
  // lançamento anterior nesta sessão do app, cai pros defaults do Launcher
  // (sem args explícitos = CommandBuilder omite tudo, T006) no projeto
  // selecionado (ou home, se nenhum projeto foi aberto ainda).
  const handleQuickNewClaudeSession = (): void => {
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

  const handleTogglePin = (tabId: string): void => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, pinned: !tab.pinned } : tab)));
  };

  // T013 (correção herdada) — assina `onRenderedUpdate` (EVENTO, disparado
  // no callback de conclusão de cada `term.write`, ver TerminalPane.tsx) em
  // vez de `setInterval`: a confirmação real do CLI ("Set model to Sonnet
  // 5") dura só UM frame na tela antes do próximo redraw sobrescrever por
  // cima (achado do smoke real, ver shared/liveSessionInjection.ts) — um
  // poll periódico quase sempre chega tarde demais pra ver esse frame; só
  // checar a CADA chunk processado garante nunca perder. Sem baseline (ver
  // mesmo comentário — este CLI redesenha um viewport de tamanho FIXO, não
  // um log sequencial, então "linhas novas desde X" não é um conceito válido
  // aqui): checa o snapshot ATUAL inteiro a cada evento. `LIVE_INJECTION_
  // TIMEOUT_MS` continua como rede de segurança (`setTimeout`, não mais
  // `setInterval`): se a confirmação nunca chegar (usuário nunca responde o
  // diálogo, ou o CLI falha), desiste de esperar. Só então
  // `sessionModelEffort` é atualizado — nunca antes, nunca otimisticamente.
  const watchLiveInjection = useCallback(
    (tabId: string, kind: 'model' | 'effort', value: ModelAlias | EffortLevel): void => {
      pendingInjectionWatchersRef.current[tabId]?.(); // cancela qualquer watcher anterior desta aba

      let settled = false;
      const settle = (confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        cleanup();
        delete pendingInjectionWatchersRef.current[tabId];
        setPendingInjection((prev) => omitKey(prev, tabId));

        if (!confirmed) return; // timeout sem confirmação — desiste, valor antigo (correto) permanece

        setSessionModelEffort((prev) => {
          const base = prev[tabId] ?? { model: DEFAULT_MODEL_ALIAS, effort: DEFAULT_EFFORT_LEVEL };
          return {
            ...prev,
            [tabId]: kind === 'model' ? { ...base, model: value as ModelAlias } : { ...base, effort: value as EffortLevel },
          };
        });
      };

      const checkNow = (): void => {
        const current = terminalRefs.current[tabId]?.getRenderedLines() ?? [];
        if (hasLiveInjectionConfirmation(current, kind)) settle(true);
      };

      const unsubscribe = terminalRefs.current[tabId]?.onRenderedUpdate(checkNow) ?? ((): void => {});
      const timeoutId = setTimeout(() => settle(false), LIVE_INJECTION_TIMEOUT_MS);
      const cleanup = (): void => {
        unsubscribe();
        clearTimeout(timeoutId);
      };

      pendingInjectionWatchersRef.current[tabId] = cleanup;
      checkNow(); // defesa em profundidade: cobre a confirmação já ter acontecido antes desta chamada
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // T011 — FR-011: injeta `/model <alias>\r` no stdin da aba `tabId` só com
  // o prompt ocioso. `canInjectLiveCommand` já é o mesmo gate que desabilita
  // o SegmentedControl da toolbar (SessionDetails); reconferido aqui (defesa
  // em profundidade contra a corrida rara clique-vs-mudança-de-estado — o
  // clique nasce de um render que pode já estar um tick atrás do semáforo).
  // Clique na opção já ativa não injeta nada (nenhuma mudança de verdade a
  // aplicar); uma injeção já em voo na mesma aba também não injeta uma 2ª
  // por cima (T013 — `pendingInjection`).
  //
  // T013 (correção herdada) — NÃO grava `sessionModelEffort` aqui mais: só
  // marca a troca como pendente e delega a confirmação de verdade pro
  // watcher orientado a evento (`watchLiveInjection`) — ver comentário de
  // topo dessas funções e shared/liveSessionInjection.ts pro porquê (o CLI
  // pode abrir um diálogo interativo de confirmação que o usuário pode
  // recusar).
  const handleSelectModel = (tabId: string, model: ModelAlias): void => {
    if (sessionModelEffort[tabId]?.model === model) return;
    if (pendingInjection[tabId]) return;
    if (!canInjectLiveCommand(semaphoreStates[tabId]?.state, aliveTabs[tabId] ?? false)) return;
    const injected = terminalRefs.current[tabId]?.injectCommand(buildModelInjection(model)) ?? false;
    if (!injected) return;
    setPendingInjection((prev) => ({ ...prev, [tabId]: 'model' }));
    watchLiveInjection(tabId, 'model', model);
  };

  // T011/T013 — idem `handleSelectModel`, pro campo Esforço (`/effort <level>\r`).
  const handleSelectEffort = (tabId: string, effort: EffortLevel): void => {
    if (sessionModelEffort[tabId]?.effort === effort) return;
    if (pendingInjection[tabId]) return;
    if (!canInjectLiveCommand(semaphoreStates[tabId]?.state, aliveTabs[tabId] ?? false)) return;
    const injected = terminalRefs.current[tabId]?.injectCommand(buildEffortInjection(effort)) ?? false;
    if (!injected) return;
    setPendingInjection((prev) => ({ ...prev, [tabId]: 'effort' }));
    watchLiveInjection(tabId, 'effort', effort);
  };

  // T011 — degradação do FR-011 quando não há processo vivo pra injetar
  // (sessão 'done'/'error'/ainda conectando): fecha a aba encerrada e abre
  // uma sessão claude NOVA no mesmo cwd/nome, com `--model`/`--effort` já no
  // argv de spawn (CommandBuilder, T006) — mesmo caminho do Launcher, só que
  // disparado pela toolbar em vez do painel. Perde o histórico da conversa
  // (não tem `-r` aqui — resume real é T012/T013); o próprio texto do
  // FR-011 já prevê essa perda como o preço aceito da degradação (a garantia
  // de "sem perder contexto" da DoD é do caminho de injeção ao vivo, não
  // deste fallback).
  const handleRestartWithConfig = (tabId: string): void => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    const pending = sessionModelEffort[tabId] ?? { model: DEFAULT_MODEL_ALIAS, effort: DEFAULT_EFFORT_LEVEL };
    const args = buildClaudeArgs({ model: pending.model, effort: pending.effort, sessionName: tab.name || undefined });
    closeTabImmediately(tabId);
    addTab({ name: tab.name, cwd: tab.cwd, projectName: tab.projectName, pinned: tab.pinned, launchArgs: args, sessionType: 'claude' });
  };

  // T009 — antes do primeiro evento de hook chegar pra uma aba recém-criada,
  // assume 'working' (spike: estado inicial otimista) com stateEnteredAt=0
  // (sortSessions trata omitido/0 como "a mais antiga possível" — nunca
  // perde o desempate de FR-010/CA-6 por causa disso).
  const sidebarSessions: SidebarSession[] = tabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    projectName: tab.projectName,
    state: semaphoreStates[tab.id]?.state ?? 'working',
    stateEnteredAt: semaphoreStates[tab.id]?.stateEnteredAt,
    pinned: tab.pinned,
    active: tab.id === activeTabId,
  }));

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
  useEffect(() => {
    const previous = previousSemaphoreStatesRef.current;
    for (const tab of tabs) {
      const nextState = semaphoreStates[tab.id]?.state;
      const prevState = previous[tab.id]?.state;
      if (!nextState || nextState === prevState) continue; // só na TRANSIÇÃO de estado, não a cada update
      if (tab.id === activeTabId) continue; // aba em foco não precisa de toast
      if (nextState !== 'waiting' && nextState !== 'permission') continue;

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
    previousSemaphoreStatesRef.current = semaphoreStates;
  }, [semaphoreStates, tabs, activeTabId]);

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

  return (
    <div className={styles.shell}>
      <header className={styles.titlebar}>
        <div className={styles.brand}>
          <span aria-hidden="true">◆</span>
          <span>Donel Dev</span>
        </div>
        <ProfileSwitcher onActiveProfileLabelChange={setAccountLabel} />
        <SplitButton
          label="＋ Nova sessão"
          onClick={handleQuickNewClaudeSession}
          items={[
            // FIX (feedback E2E rodada 3, painel colapsável) — "Sessão
            // Claude" passa a ABRIR o painel de configuração (Launcher, §4)
            // em vez de repetir o quick-launch do corpo (redundante antes:
            // as duas ações faziam a MESMA coisa). O corpo do botão
            // continua sendo o atalho rápido (última config usada).
            { label: 'Sessão Claude', onSelect: () => setLauncherOpen(true) },
            // FIX (feedback E2E rodada 1, "terminal livre confuso") — rótulo
            // explícito no dropdown; "Terminal" sozinho não deixava claro
            // que era um shell livre (sem sessão claude nenhuma).
            { label: 'Terminal (shell livre)', onSelect: handleNewFreeTerminal },
          ]}
        />
      </header>

      <div className={launcherOpen ? styles.body : `${styles.body} ${styles.bodyPanelClosed}`}>
        <ProjectSidebar
          projects={projects}
          loadingProjects={loadingProjects}
          onOpenProject={handleOpenProject}
          onToggleFavorite={handleToggleFavorite}
          sessions={sidebarSessions}
          onFocusSession={setActiveTabId}
          onTogglePin={handleTogglePin}
          onShowPreviousSessions={handleShowPreviousSessions}
        />

        <main className={styles.center}>
          <div className={styles.tabBar}>
            {tabs.map((tab) => (
              <TerminalTab
                key={tab.id}
                name={tab.name}
                // T010 — ui-spec §2 zona 3: abas de terminal comum não têm
                // dot de semáforo (undefined = TerminalTab troca pelo ícone
                // de shell); só abas 'claude' mostram o StateDot do T009.
                state={tab.sessionType === 'shell' ? undefined : (semaphoreStates[tab.id]?.state ?? 'working')}
                active={tab.id === activeTabId}
                onClick={() => setActiveTabId(tab.id)}
                onClose={() => handleRequestCloseTab(tab.id)}
              />
            ))}
          </div>
          {/* T011 (FR-011) — toolbar de Modelo/Esforço da aba ATIVA, só pra sessões claude (terminal livre não tem os dois campos). Ver comentário de topo de SessionDetails.tsx sobre por que aqui e não no painel direito. */}
          {activeTab && activeTab.sessionType === 'claude' ? (
            <SessionDetails
              model={sessionModelEffort[activeTab.id]?.model ?? DEFAULT_MODEL_ALIAS}
              effort={sessionModelEffort[activeTab.id]?.effort ?? DEFAULT_EFFORT_LEVEL}
              semaphoreState={semaphoreStates[activeTab.id]?.state}
              alive={aliveTabs[activeTab.id] ?? false}
              onSelectModel={(model) => handleSelectModel(activeTab.id, model)}
              onSelectEffort={(effort) => handleSelectEffort(activeTab.id, effort)}
              onRestartWithConfig={() => handleRestartWithConfig(activeTab.id)}
              pendingKind={pendingInjection[activeTab.id]}
            />
          ) : null}
          <div className={styles.terminal}>
            {tabs.length === 0 ? <p className={styles.emptyState}>Nenhuma sessão aberta. Use “＋ Nova sessão”.</p> : null}
            {tabs.map((tab) => (
              <div key={tab.id} className={tab.id === activeTabId ? styles.terminalPane : styles.terminalPaneHidden}>
                <TerminalPane
                  ref={(handle) => {
                    terminalRefs.current[tab.id] = handle;
                  }}
                  sessionType={tab.sessionType}
                  cwd={tab.cwd}
                  args={tab.launchArgs}
                  onStateChange={(info) => handleSemaphoreChange(tab.id, info)}
                  onAliveChange={(alive) => handleAliveChange(tab.id, alive)}
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
        {launcherOpen ? (
          <aside className={styles.rightPanel} aria-label="Lançar sessão">
            <Launcher projects={projects} defaultProjectPath={selectedProjectPath} onLaunch={handleLaunch} />
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

      <StatusBar accountLabel={accountLabel} modelEffort="fable/high" sessionCount={tabs.length} />

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

      {/* T013 — PARTE PRINCIPAL (FR-004, CA-2, ui-spec §5). */}
      <PreviousSessions
        open={previousSessionsProject !== null}
        projectName={previousSessionsProject?.name ?? ''}
        sessions={previousSessions}
        loading={loadingPreviousSessions}
        onClose={handleClosePreviousSessions}
        onResume={handleResumeSession}
        onFork={handleForkSession}
      />
    </div>
  );
}
