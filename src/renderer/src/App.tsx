import { AccountBadge, SplitButton, StatusBar, TerminalTab } from '@donel-dev/design-system';
import { useEffect, useRef, useState } from 'react';
import type { ProjectInfo } from '../../shared';
import { buildClaudeArgs } from '../../shared/commandBuilder';
import styles from './App.module.css';
import { Launcher } from './Launcher';
import type { LauncherLaunchOptions } from './Launcher';
import { ProjectSidebar } from './ProjectSidebar';
import type { SidebarSession } from './ProjectSidebar';
import { TerminalPane } from './TerminalPane';

// T007 — sidebar real ligada ao ProjectScanner (FR-001, US-1): abrir um
// projeto pela sidebar cria (ou foca, se já aberta) uma aba de sessão claude
// com `cwd` no projeto. Todas as abas ficam montadas (visibilidade via CSS,
// não unmount) pra o PTY continuar vivo ao trocar de aba — o ciclo de vida
// completo (fechar de verdade, limite de 6 sessões) é do T010. O dot de
// estado é 'working' fixo pra todas as abas até o semáforo real (T009).

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
}

/** Último lançamento do Launcher — CA-1 (comando exato); exposto num elemento oculto pro smoke ler (ver JSX). */
interface LastLaunch {
  args: string[];
  cwd: string;
}

const INITIAL_TABS: TabState[] = [{ id: 'default', name: 'Sessão', pinned: false }];

/** Ação real chega nas tasks do Cockpit (T009+); aqui o shell é só layout. */
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
    tabIdCounter.current += 1;
    const id = `tab-${tabIdCounter.current}`;
    setTabs((prev) => [...prev, { id, name: project.name, cwd: project.path, projectName: project.name, pinned: false }]);
    setActiveTabId(id);
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
    tabIdCounter.current += 1;
    const id = `tab-${tabIdCounter.current}`;
    const name = options.sessionName || options.projectName;
    setTabs((prev) => [
      ...prev,
      {
        id,
        name,
        cwd: options.projectPath,
        projectName: options.projectName,
        pinned: false,
        launchArgs: args,
      },
    ]);
    setActiveTabId(id);
    setSelectedProjectPath(options.projectPath);
    setLastLaunch({ args, cwd: options.projectPath });
  };

  const handleToggleFavorite = (path: string, favorite: boolean): void => {
    void window.donel.projects.setFavorite(path, favorite).then(setProjects);
  };

  const handleTogglePin = (tabId: string): void => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, pinned: !tab.pinned } : tab)));
  };

  const sidebarSessions: SidebarSession[] = tabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    projectName: tab.projectName,
    state: 'working',
    pinned: tab.pinned,
    active: tab.id === activeTabId,
  }));

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
          onClick={noop}
          items={[
            { label: 'Sessão Claude', onSelect: noop },
            { label: 'Terminal', onSelect: noop },
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
                state="working"
                active={tab.id === activeTabId}
                onClick={() => setActiveTabId(tab.id)}
              />
            ))}
          </div>
          <div className={styles.terminal}>
            {tabs.map((tab) => (
              <div key={tab.id} className={tab.id === activeTabId ? styles.terminalPane : styles.terminalPaneHidden}>
                <TerminalPane sessionType="claude" cwd={tab.cwd} args={tab.launchArgs} />
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
    </div>
  );
}
