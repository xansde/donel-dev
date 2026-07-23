import type { ProjectInfo } from '../../shared';
import type { SessionState } from '@donel-dev/design-system';
import { StateDot } from '@donel-dev/design-system';
import { ChevronDown, ChevronRight, Pin, PinOff, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { sortSessions } from '../../shared/sessionOrdering';
import styles from './ProjectSidebar.module.css';

// T007 — sidebar real (ui-spec §2, US-1, FR-001): PROJETOS (árvore rasa por
// root, favoritos no topo) + SESSÕES (todas as sessões abertas, sessões
// fixadas com pin). `state` das sessões é placeholder ('working') até o
// semáforo real chegar no T009 — a ordenação (sortSessions) já segue a regra
// definitiva de precedência pra não precisar reescrever depois.

export interface SidebarSession {
  id: string;
  name: string;
  /** Nome curto do projeto, ou undefined pra sessão sem projeto (aba livre/inicial). */
  projectName?: string;
  state: SessionState;
  pinned: boolean;
  active: boolean;
}

export interface ProjectSidebarProps {
  projects: ProjectInfo[];
  loadingProjects: boolean;
  onOpenProject: (project: ProjectInfo) => void;
  onToggleFavorite: (path: string, favorite: boolean) => void;
  sessions: SidebarSession[];
  onFocusSession: (id: string) => void;
  onTogglePin: (id: string) => void;
}

function rootLabel(root: string): string {
  const normalized = root.replace(/[\\/]+$/, '');
  const lastSep = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  const base = lastSep >= 0 ? normalized.slice(lastSep + 1) : normalized;
  return `${base}/`;
}

function groupByRoot(projects: ProjectInfo[]): { root: string; items: ProjectInfo[] }[] {
  const groups: { root: string; items: ProjectInfo[] }[] = [];
  for (const project of projects) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.root === project.root) {
      lastGroup.items.push(project);
    } else {
      groups.push({ root: project.root, items: [project] });
    }
  }
  return groups;
}

export function ProjectSidebar({
  projects,
  loadingProjects,
  onOpenProject,
  onToggleFavorite,
  sessions,
  onFocusSession,
  onTogglePin,
}: ProjectSidebarProps): React.JSX.Element {
  const [collapsedRoots, setCollapsedRoots] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => groupByRoot(projects), [projects]);
  const orderedSessions = useMemo(() => sortSessions(sessions), [sessions]);

  const toggleRoot = (root: string): void => {
    setCollapsedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });
  };

  return (
    <nav className={styles.sidebar} aria-label="Projetos e sessões">
      <section>
        <h2 className={styles.sectionTitle}>Projetos</h2>
        {loadingProjects ? <p className={styles.hint}>Carregando projetos…</p> : null}
        {!loadingProjects && groups.length === 0 ? (
          <p className={styles.hint}>Nenhum projeto encontrado em ~/seazone ou ~/pessoal.</p>
        ) : null}
        {groups.map((group) => {
          const collapsed = collapsedRoots.has(group.root);
          return (
            <div key={group.root} className={styles.projectGroup}>
              <button
                type="button"
                className={styles.projectRootToggle}
                onClick={() => toggleRoot(group.root)}
                aria-expanded={!collapsed}
              >
                {collapsed ? (
                  <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
                )}
                <span className={styles.projectRoot}>{rootLabel(group.root)}</span>
              </button>
              {collapsed
                ? null
                : group.items.map((project) => (
                    <div
                      key={project.path}
                      className={[styles.projectRow, project.missing ? styles.missing : ''].join(' ')}
                    >
                      <button
                        type="button"
                        className={styles.favoriteButton}
                        onClick={() => onToggleFavorite(project.path, !project.favorite)}
                        aria-pressed={project.favorite}
                        aria-label={project.favorite ? `Remover ${project.name} dos favoritos` : `Favoritar ${project.name}`}
                        disabled={project.missing}
                      >
                        <Star size={12} strokeWidth={1.5} fill={project.favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                      </button>
                      {project.missing ? (
                        <>
                          <span className={styles.projectName} title={project.path}>
                            {project.name}
                          </span>
                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={() => onToggleFavorite(project.path, false)}
                          >
                            remover
                          </button>
                        </>
                      ) : (
                        <button type="button" className={styles.projectOpenButton} onClick={() => onOpenProject(project)}>
                          {project.name}
                        </button>
                      )}
                    </div>
                  ))}
            </div>
          );
        })}
      </section>

      <section>
        <h2 className={styles.sectionTitle}>Sessões</h2>
        {orderedSessions.length === 0 ? <p className={styles.hint}>Nenhuma sessão aberta.</p> : null}
        {orderedSessions.map((session) => (
          <div key={session.id} className={[styles.sessionRow, session.active ? styles.sessionRowActive : ''].join(' ')}>
            <button type="button" className={styles.sessionOpenButton} onClick={() => onFocusSession(session.id)}>
              <StateDot state={session.state} />
              <span>{session.name}</span>
              {session.projectName ? <span className={styles.sessionProject}>{session.projectName}</span> : null}
            </button>
            <button
              type="button"
              className={styles.pinButton}
              onClick={() => onTogglePin(session.id)}
              aria-pressed={session.pinned}
              aria-label={session.pinned ? `Desafixar sessão ${session.name}` : `Fixar sessão ${session.name}`}
            >
              {session.pinned ? (
                <Pin size={12} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
              ) : (
                <PinOff size={12} strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
          </div>
        ))}
      </section>
    </nav>
  );
}
