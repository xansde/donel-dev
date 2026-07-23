import { AccountBadge, Button, Modal, SplitButton, StatusBar, TerminalTab } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectInfo, SemaphoreStateInfo } from '../../shared';
import {
  buildClaudeArgs,
  DEFAULT_EFFORT_LEVEL,
  DEFAULT_MODEL_ALIAS,
  parseModelEffortFromArgs,
} from '../../shared/commandBuilder';
import type { EffortLevel, ModelAlias } from '../../shared/commandBuilder';
import { buildEffortInjection, buildModelInjection, canInjectLiveCommand } from '../../shared/liveSessionInjection';
import { sortSessions } from '../../shared/sessionOrdering';
import { nextAttentionSessionId, sessionIdAtPosition } from '../../shared/sessionShortcuts';
import styles from './App.module.css';
import { Launcher } from './Launcher';
import type { LauncherLaunchOptions } from './Launcher';
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

/** Remove uma chave de um record sem mutar o original — usado ao limpar `semaphoreStates`/`aliveTabs` no fechamento de aba. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** Ação real (perfis) chega no T014; aqui o badge é só layout. */
function noop(): void {}

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [tabs, setTabs] = useState<TabState[]>(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState(INITIAL_TABS[0].id);
  // "Herdado da seleção da sidebar" (ui-spec §4) — default do campo
  // Projeto-alvo do Launcher; segue o último projeto aberto pela sidebar.
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | undefined>(undefined);
  const [lastLaunch, setLastLaunch] = useState<LastLaunch | null>(null);
  const tabIdCounter = useRef(0);
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

  const handleToggleFavorite = (path: string, favorite: boolean): void => {
    void window.donel.projects.setFavorite(path, favorite).then(setProjects);
  };

  const handleTogglePin = (tabId: string): void => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, pinned: !tab.pinned } : tab)));
  };

  // T011 — FR-011: injeta `/model <alias>\r` no stdin da aba `tabId` só com
  // o prompt ocioso. `canInjectLiveCommand` já é o mesmo gate que desabilita
  // o SegmentedControl da toolbar (SessionDetails); reconferido aqui (defesa
  // em profundidade contra a corrida rara clique-vs-mudança-de-estado — o
  // clique nasce de um render que pode já estar um tick atrás do semáforo).
  // Clique na opção já ativa não injeta nada (nenhuma mudança de verdade a
  // aplicar) — só atualiza se `injectCommand` confirmar que escreveu.
  const handleSelectModel = (tabId: string, model: ModelAlias): void => {
    if (sessionModelEffort[tabId]?.model === model) return;
    if (!canInjectLiveCommand(semaphoreStates[tabId]?.state, aliveTabs[tabId] ?? false)) return;
    const injected = terminalRefs.current[tabId]?.injectCommand(buildModelInjection(model)) ?? false;
    if (!injected) return;
    setSessionModelEffort((prev) => ({ ...prev, [tabId]: { model, effort: prev[tabId]?.effort ?? DEFAULT_EFFORT_LEVEL } }));
  };

  // T011 — idem `handleSelectModel`, pro campo Esforço (`/effort <level>\r`).
  const handleSelectEffort = (tabId: string, effort: EffortLevel): void => {
    if (sessionModelEffort[tabId]?.effort === effort) return;
    if (!canInjectLiveCommand(semaphoreStates[tabId]?.state, aliveTabs[tabId] ?? false)) return;
    const injected = terminalRefs.current[tabId]?.injectCommand(buildEffortInjection(effort)) ?? false;
    if (!injected) return;
    setSessionModelEffort((prev) => ({ ...prev, [tabId]: { model: prev[tabId]?.model ?? DEFAULT_MODEL_ALIAS, effort } }));
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

  // T011 — aba em foco, pra decidir se a toolbar de Modelo/Esforço aparece (só sessões 'claude').
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <div className={styles.shell}>
      <header className={styles.titlebar}>
        <div className={styles.brand}>
          <span aria-hidden="true">◆</span>
          <span>Donel Dev</span>
        </div>
        <AccountBadge accountNumber={3} headroomPercent={62} expandable onClick={noop} />
        <SplitButton
          label="＋ Nova sessão"
          onClick={handleQuickNewClaudeSession}
          items={[
            { label: 'Sessão Claude', onSelect: handleQuickNewClaudeSession },
            { label: 'Terminal', onSelect: handleNewFreeTerminal },
          ]}
        />
      </header>

      <div className={styles.body}>
        <ProjectSidebar
          projects={projects}
          loadingProjects={loadingProjects}
          onOpenProject={handleOpenProject}
          onToggleFavorite={handleToggleFavorite}
          sessions={sidebarSessions}
          onFocusSession={setActiveTabId}
          onTogglePin={handleTogglePin}
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

        <aside className={styles.rightPanel} aria-label="Lançar sessão">
          <Launcher projects={projects} defaultProjectPath={selectedProjectPath} onLaunch={handleLaunch} />
          {/*
            Hook só de teste (T008 DoD — CA-1): não há como inspecionar o
            argv real recebido pelo processo `claude` a partir do renderer
            (o node-pty spawna no main process), então expomos aqui o
            comando exatamente como foi montado pelo CommandBuilder e o cwd
            usado na criação da aba. `hidden` tira do fluxo visual — o
            smoke lê via textContent/atributo, não via visibilidade.
          */}
          <pre data-testid="launcher-last-command" data-cwd={lastLaunch?.cwd ?? ''} hidden>
            {lastLaunch ? ['claude', ...lastLaunch.args].join(' ') : ''}
          </pre>
        </aside>
      </div>

      <StatusBar accountLabel="Tecnologia Claude 3 · 62%" modelEffort="fable/high" sessionCount={tabs.length} />

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
    </div>
  );
}
