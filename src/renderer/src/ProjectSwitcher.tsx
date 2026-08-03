import { Button, Modal, Select, TextInput } from '@donel-dev/design-system';
import type { SelectOption } from '@donel-dev/design-system';
import { History, Star } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { resolveGithubCloneUrl } from '../../shared';
import type { CreateProjectErrorReason, ProjectInfo, ProjectSourceMode } from '../../shared';
import { filterProjectsByName, groupProjectsByRoot, projectRootLabel } from '../../shared/projectCatalog';
import { ProjectConfigForm, type ProjectConfigFormHandle } from './ProjectConfigForm';
import { withPendingRepoCommitted } from './repoEntryList';
import styles from './ProjectSwitcher.module.css';

// CA-30 (009-modo-dev-v3, lote 9) — "lançar um projeto do zero pelo app"
// (US-15 do backlog.md, problema 10 do spec.md). Forma do mockup
// (`design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html`, linhas
// 433-449/1200-1227): seletor no titlebar (path/nome + ▾) → popover
// "Projetos" (lista + "＋ Novo projeto") → modal "Novo projeto" (nome, fonte
// do código, pasta local, repo/board opcionais).
//
// DIVERGÊNCIA NOMEADA (popover → Modal): o mockup desenha um popover
// ANCORADO sob o botão (`position: absolute; top: 44px; left: 118px`), mas
// esta implementação reaproveita o `Modal` centralizado do design-system —
// mesmo componente que `ProfileSwitcher.tsx` já usa pro par "badge no
// titlebar → lista + criar" (perfis de conta) e a MESMA razão que
// `PreviousSessions.tsx` documenta pra evitar popover posicionado à mão:
// acessibilidade (foco preso, Escape, foco devolvido) de graça, sem inventar
// posicionamento/click-outside novos. É uma troca de COMPORTAMENTO de
// apresentação, não de conteúdo — a lista e o botão "＋ Novo projeto"
// aparecem com o mesmo texto/ordem do mockup.
//
// ESCOPO (nomeado): das 3 opções "De onde vem o código" do mockup, "Começar
// vazio" (mkdir + marcador CLAUDE.md + `git init` best-effort) e "Clonar do
// GitHub" (FIX #31 — `git clone` de verdade, src/main/project-creator.ts,
// erro de clone aparece pro usuário e a pasta pela metade é limpa) criam de
// fato. "Pasta existente no disco" continua fora do Select habilitado —
// reabriria a mesma ambiguidade que o lote 3 (CA-23) já resolveu de outro
// jeito (favoritos tratam path fora do scan como "missing", não como
// "registrado") — não cabe no mesmo encanamento validado aqui.
//
// FIX (rodada de feedback 30/07, item 2) — "não ter que selecionar a pasta
// local, mas ele criar em um dos diretórios já configurados": o campo/preview
// "Pasta local" SAIU do modal. Com 1 root configurado, a criação usa ele
// direto (sem pergunta nenhuma); com vários, um `Select` simples escolhe
// ENTRE os já configurados — nunca um path digitado livre (a allowlist de
// destino continua sendo `appConfig.projectRoots`, decidida no main).
//
// FIX (rodada de feedback 30/07, item 1) — "adicionar vários repositórios
// github e o board do taskdex" também no modal "Novo projeto": o mesmo
// `ProjectConfigForm` da engrenagem (`PreviousSessions.tsx`, lote 3) entra
// aqui. O board do mockup era 1 campo só; junto com CA-23 (lote 3) isso já
// tinha virado `workspaceId`/`teamId` separados — o formulário unificado é
// quem resolve os dois de uma vez agora. `projectBinding.save` só roda
// DEPOIS da criação (o projeto ainda não existe antes disso — `repoPath` é o
// path recém-criado).

export interface ProjectSwitcherProps {
  projects: readonly ProjectInfo[];
  /** Projeto ativo (último aberto) — `selectedProjectPath` em App.tsx. */
  activeProjectPath?: string;
  /** `appConfig.projectRoots` — a allowlist de destino; a criação usa SEMPRE o primeiro (escolher entre múltiplos roots fica fora deste lote). */
  projectRoots: readonly string[];
  onOpenProject: (project: ProjectInfo) => void;
  /** Sincroniza a lista de projetos de App.tsx com a resposta (já re-escaneada) de `projects.create`. */
  onProjectsChanged: (projects: ProjectInfo[]) => void;
  /** Item 1 — o hint de "carregando" que a árvore da sidebar mostrava migrou pra cá (o scan inicial de `~/seazone`/`~/pessoal` ainda leva um instante). */
  loadingProjects?: boolean;
  /**
   * Item 1/2/3 (rodada de feedback do teste de 30/07) — a sidebar perdeu a
   * árvore completa de projetos (agora só Favoritos + Sessões); favoritar um
   * projeto qualquer passou a acontecer AQUI, no popover "Projetos", que é o
   * catálogo completo agora.
   */
  onToggleFavorite: (path: string, favorite: boolean) => void;
  /**
   * Item 1 — "sessões anteriores" de um projeto qualquer (favoritado ou não)
   * também migrou pra cá: era um botão por linha da árvore da sidebar
   * (removida), agora é um botão por linha desta lista.
   */
  onShowPreviousSessions: (project: ProjectInfo) => void;
}

const SOURCE_OPTIONS: SelectOption[] = [
  { value: 'vazio', label: 'Começar vazio', description: 'só a pasta e o registro — sem repositório ainda' },
  { value: 'clone', label: 'Clonar do GitHub', description: 'o app clona o repositório na pasta escolhida' },
  { value: 'local', label: 'Pasta existente no disco', description: 'registra um projeto que já está aqui' },
];

/**
 * FIX (#31) — `clone-failed` é o ÚNICO motivo com mensagem DINÂMICA (o texto
 * de verdade vem do `git`, em `cloneErrorDetail`) — os demais são sempre o
 * MESMO texto fixo em pt-BR, independente do payload.
 */
function errorMessage(reason: CreateProjectErrorReason, cloneDetail?: string | null): string {
  switch (reason) {
    case 'empty':
      return 'Dê um nome pro projeto.';
    case 'invalid-chars':
      return 'Nome inválido — sem barras, dois-pontos, aspas e outros caracteres que o Windows não aceita em pasta, e sem terminar em ponto.';
    case 'reserved-name':
      return 'Esse nome é reservado pelo Windows (ex.: CON, NUL, COM1) — escolha outro.';
    case 'too-long':
      return 'Nome longo demais.';
    case 'invalid-root':
      return 'A pasta-raiz não é uma das configuradas — confira em Preferências.';
    case 'already-exists':
      return 'Já existe uma pasta com esse nome ali.';
    case 'mkdir-failed':
      return 'Não consegui criar a pasta (permissão negada?).';
    case 'clone-url-empty':
      return 'Preencha o campo "Repositório GitHub (issues/PRs)" com o repo a clonar antes de criar.';
    case 'clone-failed':
      return cloneDetail ?? 'Não consegui clonar o repositório — confira a URL, a autenticação e a rede.';
  }
}

export function ProjectSwitcher({
  projects,
  activeProjectPath,
  projectRoots,
  onOpenProject,
  onProjectsChanged,
  loadingProjects = false,
  onToggleFavorite,
  onShowPreviousSessions,
}: ProjectSwitcherProps): React.JSX.Element {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState('vazio');
  const [selectedRoot, setSelectedRoot] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorReason, setErrorReason] = useState<CreateProjectErrorReason | null>(null);
  // FIX (#33) — `projectBinding.save` era fire-and-forget: se o IPC falhasse
  // (guarda `isValidSaveProjectBindingIpcInput` rejeitando o payload, ou a
  // escrita em disco lançando), ninguém ficava sabendo — o modal já tinha
  // fechado. Agora o save é aguardado e, em falha, o erro aparece aqui (mesmo
  // lugar de `errorReason`/`new-project-error`) SEM fechar o modal — o
  // projeto em si já foi criado (mkdir/CLAUDE.md/clone já aconteceram), então
  // um novo clique em "Criar projeto" só reintenta o SAVE do binding (via
  // `createdProject`), nunca recria a pasta (que já existe).
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<{ path: string; name: string } | null>(null);
  // FIX (#31) — `clone-failed` é o único motivo de erro com mensagem
  // dinâmica (o texto de verdade vem do `git`, propagado por
  // `project-creator.ts`) — os demais reasons são texto fixo (`errorMessage`).
  const [cloneErrorDetail, setCloneErrorDetail] = useState<string | null>(null);
  // FIX (#32) — o campo "Novo repositório GitHub" de `ProjectConfigForm` tem
  // texto pendente que só vira item de `repos` ao clicar "Adicionar"/Enter;
  // no submit, commitamos esse pendente via `getPendingRepo()` ANTES de ler
  // `repos` — sem isso, o texto digitado sumia se o usuário só tivesse
  // preenchido e clicado direto em "Criar projeto".
  const configFormRef = useRef<ProjectConfigFormHandle>(null);
  // Item 2 — filtro textual do popover "Projetos" (case/acento-insensível,
  // lógica pura em src/shared/projectCatalog.ts). Zera toda vez que o
  // popover fecha, pra não reabrir com um filtro "esquecido" de outra hora.
  const [filterQuery, setFilterQuery] = useState('');

  // Item 3 — a lista mostra só o NOME, agrupada por diretório-raiz
  // (cabeçalho = o root, ex. `seazone`). Filtro roda ANTES do agrupamento —
  // um grupo que não sobra nenhum item some inteiro (não aparece cabeçalho
  // vazio).
  const filteredGroups = useMemo(
    () => groupProjectsByRoot(filterProjectsByName(projects, filterQuery)),
    [projects, filterQuery],
  );

  const activeProject = projects.find((project) => project.path === activeProjectPath);
  const targetRoot = projectRoots.includes(selectedRoot) ? selectedRoot : projectRoots[0];
  const rootOptions: SelectOption[] = projectRoots.map((root) => ({ value: root, label: root }));

  const openProjectsPopover = (): void => setProjectsOpen(true);
  const closeProjectsPopover = (): void => {
    setProjectsOpen(false);
    setFilterQuery('');
  };

  const openNewProjectModal = (): void => {
    setProjectsOpen(false);
    setName('');
    setSource('vazio');
    setSelectedRoot(projectRoots[0] ?? '');
    setRepos([]);
    setWorkspaceId('');
    setTeamId('');
    setErrorReason(null);
    setBindingError(null);
    setCreatedProject(null);
    setCloneErrorDetail(null);
    setNewProjectOpen(true);
  };
  const closeNewProjectModal = (): void => setNewProjectOpen(false);

  // FIX (#31) — "Clonar do GitHub" agora tem encanamento de verdade; "Pasta
  // existente no disco" continua fora do escopo (ver comentário do topo do
  // arquivo — reabriria a ambiguidade que o lote 3/CA-23 já resolveu).
  const isSourceSupported = source === 'vazio' || source === 'clone';

  const handleCreate = (): void => {
    if (creating || !isSourceSupported || (!createdProject && (!name.trim() || !targetRoot))) return;
    setCreating(true);
    setErrorReason(null);
    setBindingError(null);
    setCloneErrorDetail(null);

    void (async (): Promise<void> => {
      try {
        // FIX (#32) — commita o texto pendente do campo de repo ANTES de ler
        // a lista (mesma normalização trim+dedup do `handleAddRepo` interno).
        // FIX (#31) — o modo clone também depende disso: o repo PRINCIPAL
        // (`effectiveRepos[0]`) É a URL/shorthand a clonar (mesmo campo,
        // reaproveitado — a esteira grava o mesmo valor em `repos.<slug>.github`).
        const effectiveRepos = withPendingRepoCommitted(repos, configFormRef.current?.getPendingRepo() ?? '');
        if (effectiveRepos.length !== repos.length) setRepos(effectiveRepos);

        let path: string;
        let createdName: string;
        let projectsList: readonly ProjectInfo[];

        if (createdProject) {
          // Retry — o projeto já existe em disco (a criação deu certo da
          // primeira vez); só o save do binding falhou, então NÃO chama
          // `projects.create` de novo (a pasta já existe, viraria erro
          // `already-exists` mascarando a falha real).
          path = createdProject.path;
          createdName = createdProject.name;
          projectsList = projects;
        } else {
          const sourceMode: ProjectSourceMode = source === 'clone' ? 'clone' : 'vazio';
          if (sourceMode === 'clone' && effectiveRepos.length === 0) {
            setErrorReason('clone-url-empty');
            return;
          }
          const response = await window.donel.projects.create({
            name,
            root: targetRoot,
            source: sourceMode,
            ...(sourceMode === 'clone' ? { cloneUrl: resolveGithubCloneUrl(effectiveRepos[0] ?? '') } : {}),
          });
          onProjectsChanged(response.projects);
          if (!response.result.ok) {
            setErrorReason(response.result.reason);
            if (response.result.reason === 'clone-failed') setCloneErrorDetail(response.result.message);
            return;
          }
          path = response.result.path;
          createdName = response.result.name;
          projectsList = response.projects;
        }

        const needsBindingSave = effectiveRepos.length > 0 || (workspaceId.trim() && teamId.trim());
        if (needsBindingSave) {
          const saveResult = await window.donel.projectBinding.save({
            repoPath: path,
            workspaceId,
            teamId,
            github: effectiveRepos[0] ?? '',
            githubExtra: effectiveRepos.slice(1),
          });
          if (!saveResult.ok) {
            setCreatedProject({ path, name: createdName });
            setBindingError(
              'O projeto foi criado, mas não consegui salvar o repositório/board dele — tente salvar de novo.',
            );
            return;
          }
        }

        setNewProjectOpen(false);
        setCreatedProject(null);
        const created = projectsList.find((project) => project.path === path);
        onOpenProject(created ?? { path, name: createdName, root: targetRoot, favorite: false });
      } finally {
        setCreating(false);
      }
    })();
  };

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={openProjectsPopover}
        aria-label="Trocar de projeto"
        aria-haspopup="dialog"
        data-testid="project-switcher-trigger"
      >
        {/* Item 1 (rodada de forma fix/009-board-real-e-modal) — este pill É o
            titlebar do mockup v3 (linha 46: `{{ project.path }} ▾`): mostra o
            PATH real do projeto selecionado, não só o nome. */}
        <span className={styles.triggerLabel} title={activeProject?.path}>
          {activeProject?.path ?? 'Selecionar projeto'}
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      <Modal open={projectsOpen} onClose={closeProjectsPopover} title="Projetos">
        <div className={styles.body} data-testid="project-switcher-list">
          {/* Item 2 — filtro textual (case/acento-insensível, ver
              src/shared/projectCatalog.ts filterProjectsByName). */}
          {projects.length > 0 ? (
            <TextInput
              aria-label="Filtrar projetos"
              placeholder="Filtrar por nome…"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
            />
          ) : null}
          {projects.length === 0 && loadingProjects ? <p className={styles.hint}>Carregando projetos…</p> : null}
          {projects.length === 0 && !loadingProjects ? <p className={styles.hint}>Nenhum projeto encontrado.</p> : null}
          {projects.length > 0 && filteredGroups.length === 0 ? (
            <p className={styles.hint}>Nenhum projeto bate com "{filterQuery}".</p>
          ) : null}
          {filteredGroups.map((group) => (
            <div key={group.root} className={styles.rootGroup}>
              {/* Item 3 — cabeçalho de grupo é o root (ex. "seazone"), lista
                  mostra só o NOME do projeto (não mais o path inteiro). */}
              <div className={styles.rootGroupHeader}>{projectRootLabel(group.root)}</div>
              <ul className={styles.list}>
                {group.items.map((project) => (
                  <li key={project.path}>
                    <div className={styles.projectRow}>
                      <button
                        type="button"
                        className={styles.favoriteToggle}
                        onClick={() => onToggleFavorite(project.path, !project.favorite)}
                        aria-pressed={project.favorite}
                        aria-label={project.favorite ? `Remover ${project.name} dos favoritos` : `Favoritar ${project.name}`}
                      >
                        <Star size={11} strokeWidth={1.5} fill={project.favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.projectOpenButton}
                        onClick={() => {
                          onOpenProject(project);
                          setProjectsOpen(false);
                        }}
                        title={project.path}
                      >
                        <span className={styles.mark} aria-hidden="true">
                          {project.path === activeProjectPath ? '●' : ''}
                        </span>
                        <span className={styles.name}>{project.name}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.historyToggle}
                        onClick={() => {
                          onShowPreviousSessions(project);
                          setProjectsOpen(false);
                        }}
                        aria-label={`Sessões anteriores de ${project.name}`}
                        title="Sessões anteriores"
                      >
                        <History size={12} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className={styles.footer}>
            <Button variant="primary" onClick={openNewProjectModal}>
              ＋ Novo projeto
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={newProjectOpen}
        onClose={closeNewProjectModal}
        title="Novo projeto"
        actions={
          <>
            <Button variant="secondary" onClick={closeNewProjectModal} disabled={creating}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={creating || !isSourceSupported || (!createdProject && (!name.trim() || !targetRoot))}
            >
              {creating ? 'Criando…' : createdProject ? 'Tentar salvar de novo' : source === 'clone' ? 'Clonar e criar' : 'Criar projeto'}
            </Button>
          </>
        }
      >
        <div className={styles.newProjectBody} data-testid="new-project-form">
          <p className={styles.hint}>
            O app cria a pasta do projeto e o registro local, dentro de uma pasta-raiz já configurada. Repositório e board
            podem ficar em branco agora e ser preenchidos depois pela engrenagem.
          </p>

          <TextInput
            label="Nome do projeto"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ex.: minha-automacao"
            disabled={creating}
          />

          <Select label="De onde vem o código" value={source} options={SOURCE_OPTIONS} onChange={setSource} disabled={creating} />
          {source === 'clone' ? (
            <p className={styles.hint}>
              O app clona o repositório digitado no campo "Repositório GitHub (issues/PRs)" abaixo pra dentro da pasta nova —
              preencha esse campo antes de criar.
            </p>
          ) : null}
          {source === 'local' ? (
            <p className={styles.hintDanger}>
              Ainda não implementado nesta leva — crie vazio/clone, ou registre a pasta manualmente e abra por "Trocar de
              projeto".
            </p>
          ) : null}

          {/* Item 2 (rodada de feedback 30/07) — "não ter que selecionar a
              pasta local, mas ele criar em um dos diretórios já configurados":
              1 root -> cria direto nele, sem pergunta nenhuma; vários roots ->
              Select ENTRE eles (nunca um path digitado livre). */}
          {rootOptions.length > 1 ? (
            <Select
              label="Pasta-raiz"
              value={targetRoot ?? ''}
              options={rootOptions}
              onChange={setSelectedRoot}
              disabled={creating}
            />
          ) : null}

          <ProjectConfigForm
            ref={configFormRef}
            repos={repos}
            onReposChange={setRepos}
            workspaceId={workspaceId}
            onWorkspaceIdChange={setWorkspaceId}
            teamId={teamId}
            onTeamIdChange={setTeamId}
            disabled={creating}
          />

          {!targetRoot ? (
            <p className={styles.hintDanger}>Nenhuma pasta-raiz configurada — adicione uma em Preferências antes de criar.</p>
          ) : null}
          {errorReason || bindingError ? (
            <p className={styles.hintDanger} data-testid="new-project-error">
              {errorReason ? errorMessage(errorReason, cloneErrorDetail) : bindingError}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
