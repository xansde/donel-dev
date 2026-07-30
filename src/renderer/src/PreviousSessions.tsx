import { Button, Modal, TextInput } from '@donel-dev/design-system';
import { Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ProjectBindingDto, SessionNamesMap, SessionSummaryDto } from '../../shared';
import { resolveSessionName } from '../../shared/sessionName';
import { filterSessionsByQuery, formatFileSize, formatRelativeTime } from '../../shared/sessions';
import styles from './PreviousSessions.module.css';

// T013 — PARTE PRINCIPAL: painel "Sessões anteriores" (FR-004, CA-2,
// ui-spec §5, brief B4 do design reference). Lista por projeto, alimentada
// pelo SessionIndexer (T012, via `window.donel.sessions.list` — App.tsx faz
// o fetch, este componente só renderiza). Aberto por um ícone dedicado na
// sidebar (ProjectSidebar `onShowPreviousSessions`) — ver comentário lá pro
// porquê de não ser o clique no nome do projeto.
//
// Reaproveita o `Modal` do design-system (mesmo padrão do "Fechar sessão?"
// em App.tsx) em vez de um popover posicionado à mão: acessibilidade
// (role=dialog, foco preso, Escape) de graça, sem inventar um sistema de
// posicionamento novo pro card flutuante do brief B4.
//
// Campo "modelo" do brief B4 ("{{ p.date }} · {{ p.size }} · {{ p.model }}")
// fica DE FORA — ver comentário no topo de shared/sessions.ts pro porquê
// (SessionIndexer, T012, congelado, não extrai modelo por sessão).
//
// CA-23 (009-modo-dev-v3, lote 3) — engrenagem de configuração por projeto
// (spec.md problema 8): a tela ganhou o ícone ⚙ (`design/modo-dev-v3-handoff
// /project/Modo Dev v3.dc.html` linha 485) que abre um painel lateral com
// board TaskDex + repo GitHub — os dois hoje editados à mão fora do app. O
// mockup desenha um 3º campo ("Base de conhecimento") — D-V7 do
// `design/modo-dev-v3-verificacao.md`: alcance novo, decisão pendente do
// Alexandre, DE FORA deste lote de propósito. O mockup também mostra "ID do
// board de tarefas" como UM campo só; o app grava DOIS ids independentes
// (`workspaceId`/`teamId`, `~/.claude/esteira-config/donel-board-credential
// .json`) — sem um formato documentado de composição num campo só, dividir
// em dois inputs é o que evita inventar uma convenção não especificada em
// lugar nenhum (decisão nomeada no report do lote).
export interface PreviousSessionsProps {
  open: boolean;
  projectName: string;
  /** CA-23 — chave da engrenagem: de onde ela lê/grava a config deste projeto (`resolveRepoSlug`, main/index.ts, usa o mesmo path). */
  projectPath: string;
  sessions: SessionSummaryDto[];
  loading: boolean;
  onClose: () => void;
  onResume: (session: SessionSummaryDto) => void;
  onFork: (session: SessionSummaryDto) => void;
  /**
   * T408 (004-nomear-sessoes) — mapa de nomes do ConfigStore, para esta lista
   * exibir o MESMO nome resolvido que a aba e a sidebar (CA-1/CA-5). É aqui
   * que o caso de uso principal acontece: reachar pelo nome uma sessão de
   * semanas atrás (US-A). Sem isso, a lista mostraria só a 1ª mensagem.
   */
  sessionNames: SessionNamesMap;
}

const EMPTY_BINDING: ProjectBindingDto = { workspaceId: '', teamId: '', github: '' };

export function PreviousSessions({
  open,
  projectName,
  projectPath,
  sessions,
  loading,
  onClose,
  onResume,
  onFork,
  sessionNames,
}: PreviousSessionsProps): React.JSX.Element {
  // Query de busca reseta implicitamente a cada abertura (o componente some
  // do DOM quando `open` é false — Modal.tsx `if (!open) return null` — o
  // React descarta o state local junto). Mesmo vale pro estado da
  // engrenagem abaixo (settingsOpen, os três inputs): nunca precisa de
  // reset manual, a desmontagem já cuida disso.
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterSessionsByQuery(sessions, query), [sessions, query]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [github, setGithub] = useState('');

  // CA-23 — carrega board+repo do disco toda vez que o painel abre (nunca
  // guarda em memória entre aberturas: o app não é a única forma de editar
  // esses arquivos, as skills da esteira também escrevem neles diretamente).
  useEffect(() => {
    if (!settingsOpen) return undefined;
    let cancelled = false;
    setBindingLoading(true);
    window.donel.projectBinding
      .get(projectPath)
      .then((dto) => {
        if (cancelled) return;
        setWorkspaceId(dto.workspaceId);
        setTeamId(dto.teamId);
        setGithub(dto.github);
      })
      .catch(() => {
        // Mesma degradação do resto do app (C4): arquivo ilegível não é erro
        // na tela, é campo vazio — o operador reescreve do zero se quiser.
        if (cancelled) return;
        setWorkspaceId(EMPTY_BINDING.workspaceId);
        setTeamId(EMPTY_BINDING.teamId);
        setGithub(EMPTY_BINDING.github);
      })
      .finally(() => {
        if (!cancelled) setBindingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, projectPath]);

  const handleSaveSettings = (): void => {
    setSaving(true);
    window.donel.projectBinding
      .save({ repoPath: projectPath, workspaceId, teamId, github })
      .then((dto) => {
        setWorkspaceId(dto.workspaceId);
        setTeamId(dto.teamId);
        setGithub(dto.github);
        setSettingsOpen(false);
      })
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Sessões anteriores · ${projectName}`}
      className={settingsOpen ? styles.dialogWide : undefined}
    >
      <div data-testid="previous-sessions" className={styles.body}>
        <div className={styles.toolbar}>
          <TextInput
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar por nome…"
            aria-label="Filtrar sessões anteriores por nome"
          />
          <button
            type="button"
            className={styles.gearButton}
            onClick={() => setSettingsOpen((prev) => !prev)}
            aria-label="Configuração do projeto"
            aria-expanded={settingsOpen}
            title="Configuração do projeto"
          >
            <Settings size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.sessionsColumn}>
            {loading ? <p className={styles.hint}>Carregando sessões…</p> : null}

            {/* ui-spec §5, edge case "empty state": projeto sem NENHUMA sessão anterior. */}
            {!loading && sessions.length === 0 ? (
              <p className={styles.hint} data-testid="previous-sessions-empty">
                Nenhuma sessão anterior neste projeto — comece uma nova.
              </p>
            ) : null}

            {/* Busca sem resultado é um estado DIFERENTE do índice vazio (ui-spec §5: "Busca simples por nome"). */}
            {!loading && sessions.length > 0 && filtered.length === 0 ? (
              <p className={styles.hint}>Nenhuma sessão bate com “{query}”.</p>
            ) : null}

            {filtered.length > 0 ? (
              <ul className={styles.list}>
                {filtered.map((session) => (
                  <li key={session.id} className={styles.row} data-testid="previous-session-row">
                    <div className={styles.info}>
                      {/* ui-spec §5: transcript corrompido/truncado entra na lista com preview "(ilegível)", sem derrubar o índice — o SessionIndexer já garante isso; aqui só um tom visual diferente. */}
                      <span className={[styles.preview, session.corrupted ? styles.corrupted : ''].join(' ')}>
                        {resolveSessionName({
                          fallback: session.preview,
                          customTitle: session.customTitle,
                          stored: sessionNames[session.id] ?? null,
                        })}
                      </span>
                      <span className={styles.meta}>
                        {formatRelativeTime(session.lastActivityAt ?? session.mtimeMs)} · {formatFileSize(session.size)}
                      </span>
                    </div>
                    <div className={styles.actions}>
                      <Button variant="primary" onClick={() => onResume(session)}>
                        Retomar
                      </Button>
                      <Button variant="secondary" onClick={() => onFork(session)}>
                        Fork
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {settingsOpen ? (
            <div className={styles.settingsPanel} data-testid="project-settings-panel">
              <div className={styles.settingsHeader}>
                <span className={styles.settingsTitle}>Configuração do projeto</span>
                <button
                  type="button"
                  className={styles.settingsClose}
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Fechar configuração do projeto"
                >
                  ✕
                </button>
              </div>
              <p className={styles.settingsIntro}>
                Sem estes dois o app não sabe onde procurar nada — e não escreve em nenhum dos dois. São editáveis aqui, não mais à
                mão em arquivos fora do app.
              </p>

              {bindingLoading ? <p className={styles.hint}>Carregando configuração…</p> : null}

              <TextInput
                label="Workspace ID"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                hint="board único do projeto · usado para ler colunas e cards"
                hintTone="muted"
                aria-label="Workspace ID do board de tarefas"
              />
              <TextInput
                label="Team ID"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                aria-label="Team ID do board de tarefas"
              />
              <TextInput
                label="Repositório GitHub"
                value={github}
                onChange={(event) => setGithub(event.target.value)}
                placeholder="org/repo"
                hint="origem das branches, PRs e lições do repositório"
                hintTone="muted"
                aria-label="Repositório GitHub"
              />

              <div className={styles.settingsActions}>
                <Button variant="primary" onClick={handleSaveSettings} disabled={saving}>
                  Salvar
                </Button>
                <Button variant="secondary" onClick={() => setSettingsOpen(false)} disabled={saving}>
                  Cancelar
                </Button>
              </div>

              <p className={styles.settingsFooter}>
                Board e repositório são integrações plugáveis. Um projeto sem eles usa o Modo Dev inteiro — só sem leitura de coluna
                e sem sub-issues.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
