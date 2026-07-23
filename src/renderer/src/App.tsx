import { AccountBadge, Button, SplitButton, StateDot, StatusBar, TerminalTab } from '@donel-dev/design-system';
import type { SessionState } from '@donel-dev/design-system';
import styles from './App.module.css';
import { TerminalPane } from './TerminalPane';

// Estrutura estática do shell (ui-spec §2). ProjectScanner (FR-001) e
// SessionIndexer (FR-004) reais chegam em T007 — aqui é só o placeholder de
// layout pedido pela T003.

interface ProjectGroup {
  root: string;
  projects: { name: string; favorite?: boolean }[];
}

interface SessionRow {
  id: string;
  name: string;
  project: string;
  state: SessionState;
}

const PROJECT_GROUPS: ProjectGroup[] = [
  {
    root: 'seazone/',
    projects: [{ name: 'bizops-…', favorite: true }, { name: 'spotsys' }, { name: 'dalton' }],
  },
  { root: 'pessoal/', projects: [] },
];

const SESSIONS: SessionRow[] = [
  { id: 'spec-helm', name: 'spec helm', project: 'bizops', state: 'working' },
  { id: 'radar-spots', name: 'radar spots', project: 'spotsys', state: 'waiting' },
  { id: 'fix-build', name: 'fix build', project: 'dalton', state: 'done' },
];

/** Ação real chega nas tasks do Cockpit (T007+); aqui o shell é só layout. */
function noop(): void {}

export function App(): React.JSX.Element {
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
        <nav className={styles.sidebar} aria-label="Projetos e sessões">
          <section>
            <h2 className={styles.sectionTitle}>Projetos</h2>
            {PROJECT_GROUPS.map((group) => (
              <div key={group.root} className={styles.projectGroup}>
                <span className={styles.projectRoot}>{group.root}</span>
                {group.projects.map((project) => (
                  <div key={project.name} className={styles.projectRow}>
                    {project.favorite ? <span aria-hidden="true">★</span> : null}
                    <span>{project.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </section>
          <section>
            <h2 className={styles.sectionTitle}>Sessões</h2>
            {SESSIONS.map((session) => (
              <div key={session.id} className={styles.sessionRow}>
                <StateDot state={session.state} />
                <span>{session.name}</span>
                <span className={styles.sessionProject}>{session.project}</span>
              </div>
            ))}
          </section>
        </nav>

        <main className={styles.center}>
          <div className={styles.tabBar}>
            {/* T004: 1 aba fixa de terminal livre (FR-008). Abas múltiplas/fechar
                chegam em T010 — por isso sem onClose ainda. */}
            <TerminalTab name="Terminal" active />
          </div>
          <div className={styles.terminal}>
            <TerminalPane />
          </div>
        </main>

        <aside className={styles.rightPanel} aria-label="Lançar sessão">
          <h2 className={styles.sectionTitle}>Lançar sessão</h2>
          <p className={styles.rightPanelHint}>Launcher completo chega no T008 (ui-spec §4).</p>
          <Button variant="primary" onClick={noop}>
            ▶ Iniciar
          </Button>
        </aside>
      </div>

      <StatusBar
        accountLabel="Tecnologia Claude 3 · 62%"
        modelEffort="fable/high"
        sessionCount={SESSIONS.length}
      />
    </div>
  );
}
