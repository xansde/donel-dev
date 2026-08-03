import { Button, TextInput } from '@donel-dev/design-system';
import { Trash2 } from 'lucide-react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { withPendingRepoCommitted } from './repoEntryList';
import styles from './ProjectConfigForm.module.css';

// Frente 2 (rodada de feedback 30/07, item 1) — "gostaria de poder adicionar
// vários repositórios github e adicionar o board do taskdex. Deve ser o
// mesmo nas configurações do projeto (engrenagem)". Formulário PURO
// (controlado, sem fetch/save próprio) reaproveitado nos dois lugares que
// hoje editam board+repo: a engrenagem de `PreviousSessions.tsx` (lote 3,
// projeto já existe) e a seção de configuração do modal "Novo projeto" de
// `ProjectSwitcher.tsx` (lote 9, projeto ainda não existe — por isso o save
// de verdade fica com quem chama, não com este componente).
//
// Contrato de `repos.json` (`handoff-v3.md` §I): `github` é SINGULAR por
// entrada — não é renegociável (as skills da esteira leem esse campo).
// `repos` aqui é uma lista ORDENADA onde o PRIMEIRO item é o repo principal
// (grava em `github`) e os demais são ADITIVOS (`github_extra`, contrato
// ignora) — mesma decisão nomeada em `shared/projectBinding.ts`. Mesmo
// padrão visual de lista editável de `Preferences.tsx` (`rootList`/Trash2).
//
// FIX (#32) — "o link do repositório digitado some se não clicar
// 'Adicionar'": `newRepo` (o texto do campo "Novo repositório GitHub") era
// state PURAMENTE local — se o usuário digitasse um repo e submetesse o
// formulário PAI sem clicar "Adicionar" (ou apertar Enter) antes, o texto
// nunca virava um item de `repos` e sumia em silêncio. `ProjectConfigForm`
// agora expõe `getPendingRepo()` via ref (`ProjectConfigFormHandle`) — quem
// submete (handleCreate/handleSaveSettings) commita esse texto pendente com
// `withPendingRepoCommitted` (mesma normalização trim+dedup do
// `handleAddRepo`) ANTES de gravar, sem depender de re-render/timing de
// state do React.

export interface ProjectConfigFormProps {
  repos: readonly string[];
  onReposChange: (repos: string[]) => void;
  workspaceId: string;
  onWorkspaceIdChange: (value: string) => void;
  teamId: string;
  onTeamIdChange: (value: string) => void;
  disabled?: boolean;
}

/** Imperativo exposto via ref — só o necessário pra quem submete o formulário PAI não perder o texto pendente do campo de repo (FIX #32). */
export interface ProjectConfigFormHandle {
  /** Texto cru (ainda não trimado/commitado) do campo "Novo repositório GitHub" agora mesmo. */
  getPendingRepo(): string;
}

export const ProjectConfigForm = forwardRef<ProjectConfigFormHandle, ProjectConfigFormProps>(function ProjectConfigForm(
  { repos, onReposChange, workspaceId, onWorkspaceIdChange, teamId, onTeamIdChange, disabled = false },
  ref,
) {
  const [newRepo, setNewRepo] = useState('');

  useImperativeHandle(ref, () => ({ getPendingRepo: () => newRepo }), [newRepo]);

  const handleAddRepo = (): void => {
    const next = withPendingRepoCommitted(repos, newRepo);
    if (next.length === repos.length) return; // candidato vazio ou já presente — nada a adicionar
    onReposChange(next);
    setNewRepo('');
  };

  const handleRemoveRepo = (repo: string): void => {
    onReposChange(repos.filter((entry) => entry !== repo));
  };

  return (
    <>
      <div className={styles.section} data-testid="project-config-repos">
        <h4 className={styles.sectionTitle}>Repositório GitHub (issues/PRs)</h4>
        <p className={styles.hint}>
          Metadado usado pela esteira pra achar issue/PR deste projeto (grava em <code>repos.json</code>) — não traz código
          nenhum. Pra trazer código de um repositório, use "Clonar do GitHub" ao criar o projeto.
        </p>
        <ul className={styles.repoList}>
          {repos.length === 0 ? <li className={styles.hint}>Nenhum repositório configurado.</li> : null}
          {repos.map((repo, index) => (
            <li key={repo} className={styles.repoRow}>
              <span className={styles.repoBadge}>{index === 0 ? 'principal' : 'extra'}</span>
              <span className={styles.repoPath} title={repo}>
                {repo}
              </span>
              <button
                type="button"
                className={styles.removeRepoButton}
                onClick={() => handleRemoveRepo(repo)}
                aria-label={`Remover repositório ${repo}`}
                disabled={disabled}
              >
                <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.addRepoRow}>
          <TextInput
            className={styles.addRepoInput}
            placeholder="org/repo"
            aria-label="Novo repositório GitHub"
            value={newRepo}
            onChange={(event) => setNewRepo(event.target.value)}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddRepo();
              }
            }}
          />
          <Button variant="secondary" onClick={handleAddRepo} disabled={disabled || !newRepo.trim()}>
            Adicionar
          </Button>
        </div>
      </div>

      <div className={styles.boardFields} data-testid="project-config-board">
        <TextInput
          label="Workspace ID"
          value={workspaceId}
          onChange={(event) => onWorkspaceIdChange(event.target.value)}
          hint="board do projeto · usado para ler colunas e cards"
          hintTone="muted"
          aria-label="Workspace ID do board de tarefas"
          disabled={disabled}
        />
        <TextInput
          label="Team ID"
          value={teamId}
          onChange={(event) => onTeamIdChange(event.target.value)}
          aria-label="Team ID do board de tarefas"
          disabled={disabled}
        />
      </div>
    </>
  );
});
