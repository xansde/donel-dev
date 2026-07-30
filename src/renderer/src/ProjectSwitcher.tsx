import { Button, Modal, Select, TextInput } from '@donel-dev/design-system';
import type { SelectOption } from '@donel-dev/design-system';
import { Star } from 'lucide-react';
import { useState } from 'react';
import type { CreateProjectErrorReason, ProjectInfo } from '../../shared';
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
// ESCOPO DESTE LOTE (nomeado): das 3 opções "De onde vem o código" do
// mockup, só "Começar vazio" cria de fato (mkdir + marcador CLAUDE.md +
// `git init` best-effort, src/main/project-creator.ts). "Clonar do GitHub"
// e "Pasta existente no disco" ficam no Select (fidelidade de forma) mas
// desabilitam "Criar projeto" com uma nota — CA-30/US-15 pede "lançar um
// projeto DO ZERO"; clonar é uma feature de importação bem maior (rede,
// autenticação) e "pasta existente" reabriria a mesma ambiguidade que o
// lote 3 (CA-23) já resolveu de outro jeito (favoritos tratam path fora do
// scan como "missing", não como "registrado") — nenhuma das duas cabe no
// mesmo encanamento validado aqui.
//
// "Pasta local" é um preview SÓ-LEITURA (o mockup usa `TextInput` com
// `onChange`, mas deixá-lo editável reabriria a mesma pergunta de conter
// path arbitrário fora de um root permitido). O campo "ID do board de
// tarefas" do mockup foi OMITIDO deste modal: CA-23 (lote 3) já resolveu a
// mesma ambiguidade (1 campo no mockup × workspaceId/teamId separados no
// app) dividindo em dois campos — repetir isso aqui, ou resolver diferente,
// duplicaria uma decisão já fechada. "Repositório GitHub" continua (mapeia
// 1:1 pro `github` do `projectBinding.save`, sem ambiguidade).

export interface ProjectSwitcherProps {
  projects: readonly ProjectInfo[];
  /** Projeto ativo (último aberto) — `selectedProjectPath` em App.tsx. */
  activeProjectPath?: string;
  /** `appConfig.projectRoots` — a allowlist de destino; a criação usa SEMPRE o primeiro (escolher entre múltiplos roots fica fora deste lote). */
  projectRoots: readonly string[];
  onOpenProject: (project: ProjectInfo) => void;
  /** Sincroniza a lista de projetos de App.tsx com a resposta (já re-escaneada) de `projects.create`. */
  onProjectsChanged: (projects: ProjectInfo[]) => void;
}

const SOURCE_OPTIONS: SelectOption[] = [
  { value: 'vazio', label: 'Começar vazio', description: 'só a pasta e o registro — sem repositório ainda' },
  { value: 'clone', label: 'Clonar do GitHub', description: 'o app clona o repositório na pasta escolhida' },
  { value: 'local', label: 'Pasta existente no disco', description: 'registra um projeto que já está aqui' },
];

function errorMessage(reason: CreateProjectErrorReason): string {
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
  }
}

export function ProjectSwitcher({
  projects,
  activeProjectPath,
  projectRoots,
  onOpenProject,
  onProjectsChanged,
}: ProjectSwitcherProps): React.JSX.Element {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState('vazio');
  const [repo, setRepo] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorReason, setErrorReason] = useState<CreateProjectErrorReason | null>(null);

  const activeProject = projects.find((project) => project.path === activeProjectPath);
  const defaultRoot = projectRoots[0];
  const previewPath = defaultRoot ? `${defaultRoot}\\${name.trim() || '…'}` : '';

  const openProjectsPopover = (): void => setProjectsOpen(true);
  const closeProjectsPopover = (): void => setProjectsOpen(false);

  const openNewProjectModal = (): void => {
    setProjectsOpen(false);
    setName('');
    setSource('vazio');
    setRepo('');
    setErrorReason(null);
    setNewProjectOpen(true);
  };
  const closeNewProjectModal = (): void => setNewProjectOpen(false);

  const handleCreate = (): void => {
    if (creating || source !== 'vazio' || !name.trim() || !defaultRoot) return;
    setCreating(true);
    setErrorReason(null);
    window.donel.projects
      .create({ name, root: defaultRoot })
      .then((response) => {
        onProjectsChanged(response.projects);
        if (!response.result.ok) {
          setErrorReason(response.result.reason);
          return;
        }
        const { path, name: createdName } = response.result;
        setNewProjectOpen(false);
        if (repo.trim()) {
          void window.donel.projectBinding.save({ repoPath: path, workspaceId: '', teamId: '', github: repo.trim() });
        }
        const created = response.projects.find((project) => project.path === path);
        onOpenProject(created ?? { path, name: createdName, root: defaultRoot, favorite: false });
      })
      .finally(() => setCreating(false));
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
          {projects.length === 0 ? <p className={styles.hint}>Nenhum projeto encontrado.</p> : null}
          {projects.length > 0 ? (
            <ul className={styles.list}>
              {projects.map((project) => (
                <li key={project.path}>
                  <button
                    type="button"
                    className={styles.projectRow}
                    onClick={() => {
                      onOpenProject(project);
                      setProjectsOpen(false);
                    }}
                  >
                    <span className={styles.mark} aria-hidden="true">
                      {project.path === activeProjectPath ? '●' : ''}
                    </span>
                    <span className={styles.path} title={project.path}>
                      {project.path}
                    </span>
                    {project.favorite ? <Star size={11} strokeWidth={1.5} fill="currentColor" aria-hidden="true" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
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
              disabled={creating || source !== 'vazio' || !name.trim() || !defaultRoot}
            >
              {creating ? 'Criando…' : 'Criar projeto'}
            </Button>
          </>
        }
      >
        <div className={styles.newProjectBody} data-testid="new-project-form">
          <p className={styles.hint}>
            O app cria a pasta do projeto e o registro local. Repositório pode ficar em branco agora e ser preenchido depois
            pela engrenagem.
          </p>

          <TextInput
            label="Nome do projeto"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ex.: minha-automacao"
            disabled={creating}
          />

          <Select label="De onde vem o código" value={source} options={SOURCE_OPTIONS} onChange={setSource} disabled={creating} />
          {source !== 'vazio' ? (
            <p className={styles.hintDanger}>
              Ainda não implementado nesta leva — crie vazio, ou clone/registre a pasta manualmente e abra por "Trocar de
              projeto".
            </p>
          ) : null}

          <TextInput
            label="Pasta local"
            value={previewPath}
            readOnly
            hint="as worktrees dos planos nascem ao lado dela"
            hintTone="muted"
          />

          <TextInput
            label="Repositório GitHub (opcional)"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="org/repo"
            disabled={creating}
          />

          {!defaultRoot ? (
            <p className={styles.hintDanger}>Nenhuma pasta-raiz configurada — adicione uma em Preferências antes de criar.</p>
          ) : null}
          {errorReason ? (
            <p className={styles.hintDanger} data-testid="new-project-error">
              {errorMessage(errorReason)}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
