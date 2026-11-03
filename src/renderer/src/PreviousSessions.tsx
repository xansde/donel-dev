import { Button, TextInput } from '@donel-dev/design-system';
import { Settings } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectBindingDto, SessionNamesMap, SessionSummaryDto } from '../../shared';
import { resolveSessionName } from '../../shared/sessionName';
import {
  deriveSessionEtapa,
  filterSessionsByQuery,
  formatFileSize,
  formatRelativeTime,
  FREE_TERMINAL_ETAPA_LABEL,
  partitionSessionsByPhaseWork,
  phaseOnlyResultsMessage,
  phaseSessionsToggleLabel,
} from '../../shared/sessions';
import { ProjectConfigForm, type ProjectConfigFormHandle } from './ProjectConfigForm';
import { withPendingRepoCommitted } from './repoEntryList';
import styles from './PreviousSessions.module.css';

// T013 — PARTE PRINCIPAL: tela "Sessões anteriores" (FR-004, CA-2). Lista por
// projeto, alimentada pelo SessionIndexer (T012, via `window.donel.sessions.list`
// — App.tsx faz o fetch, este componente só renderiza).
//
// Item 11 (rodada de forma fix/009-board-real-e-modal) — a MAIOR distância
// entre o app e o handoff v3 (`design/modo-dev-v3-handoff/project/Modo Dev
// v3.dc.html`, quadro 2b): a tela era um `Modal` pequeno com lista simples; o
// mockup desenha uma TELA (ocupa o miolo, entre titlebar e StatusBar) com
// tabela de 5 colunas. Decisão nomeada: manter a tela como uma REGIÃO no
// grid do `.shell` (App.module.css `.previousSessionsScreen`, `grid-row: 2`,
// mesma linha de `.body`) em vez do `Modal` compartilhado — o `Modal` é
// fixo/centralizado e cobriria também o titlebar/StatusBar via portal para
// `document.body`, o que o mockup NÃO desenha (titlebar mostra "Sessões
// anteriores" + AccountBadge, StatusBar continua com os dados da conta —
// os dois seguem vivos "por trás" da tela). O gatilho continua o mesmo
// (`onShowPreviousSessions`, ícone dedicado na sidebar).
//
// O mockup não desenha nenhum "X"/fechar para esta tela (só troca de volta
// via o resto do titlebar) — mas a tela PRECISA ser dispensável: Escape e um
// "✕" discreto no cabeçalho cobrem isso (decisão nomeada, sem equivalente no
// desenho).
//
// Dados por coluna (nenhum fabricado — degrada por omissão quando a fonte
// não tem o fato):
// - SESSÃO: glifo de estado (real, corrompida/viva/arquivada) + nome mono
//   (mesma resolução de sempre, `resolveSessionName`).
// - ETAPA: derivada do PRÓPRIO primeiro prompt (`deriveSessionEtapa`,
//   shared/sessions.ts) — sessão que não bate `/esteira-*` vira "terminal
//   comum" (nunca inventa etapa pra sessão livre).
// - QUANDO: `formatRelativeTime`, já existente.
//
// #26 — colunas CONTA e CONTEXTO removidas (dispensáveis, sem consumidor que
// as leia no dia a dia). O rodapé sobre "entradas irmãs" (sessão reiniciada
// em outra conta) fica — é decisão nomeada do dono, não depende da coluna.
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
  /** Item 11 — "sessão VIVA agora" (glifo ▶ na coluna SESSÃO): presença de entrada aqui é o sinal, não mais exibido como texto (coluna CONTEXTO removida, #26). */
  contextLabelBySessionId: Readonly<Record<string, string>>;
  /**
   * B3 (relatório de sessão 05/08) — os `id` das sessões que o store da
   * Esteira reconhece como disparo de FASE (o "worker", não o "cockpit" que
   * orquestra). Somem da lista por default: elas já têm histórico próprio no
   * card da Esteira, e uma cadeia de disparos de várias fases enche esta
   * lista genérica de entradas que atrapalham achar a sessão certa.
   */
  esteiraPhaseSessionIds: ReadonlySet<string>;
  /** Modo YOLO deste projeto: a marca ao lado da engrenagem e o interruptor dentro dela. */
  yolo: boolean;
  onChangeYolo: (enabled: boolean) => void;
}

const EMPTY_BINDING: ProjectBindingDto = { workspaceId: '', teamId: '', github: '', githubExtra: [], hasOwnBoard: false };

/** `github` (principal) + `githubExtra` (aditivos) viram uma lista ordenada só, pro `ProjectConfigForm` — índice 0 é sempre o principal. Vazio quando ambos vazios (nenhum repo configurado ainda). */
function reposFromBinding(dto: ProjectBindingDto): string[] {
  return [dto.github, ...dto.githubExtra].filter((repo) => repo.trim().length > 0);
}

function sessionGlyph(session: SessionSummaryDto, isLive: boolean): { glyph: string; tone: 'muted' | 'accent' | 'error' } {
  if (session.corrupted) return { glyph: '⚠', tone: 'error' };
  if (isLive) return { glyph: '▶', tone: 'accent' };
  return { glyph: '○', tone: 'muted' };
}

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
  contextLabelBySessionId,
  esteiraPhaseSessionIds,
  yolo,
  onChangeYolo,
}: PreviousSessionsProps): React.JSX.Element | null {
  // Query de busca reseta implicitamente a cada abertura (o componente some
  // do DOM quando `open` é false — o React descarta o state local junto).
  // Mesmo vale pro estado da engrenagem abaixo (settingsOpen, os três
  // inputs) e pro toggle de sessões de fase logo abaixo: nunca precisa de
  // reset manual, a desmontagem já cuida disso.
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterSessionsByQuery(sessions, query), [sessions, query]);
  // B3 — por default, as sessões de FASE DA ESTEIRA ficam de fora (ver o
  // porquê no JSDoc da prop). `partitioned.visible` preserva a ordem
  // original de `filtered`.
  const [showPhaseSessions, setShowPhaseSessions] = useState(false);
  const partitioned = useMemo(
    () => partitionSessionsByPhaseWork(filtered, esteiraPhaseSessionIds),
    [filtered, esteiraPhaseSessionIds],
  );
  const rows = showPhaseSessions ? filtered : partitioned.visible;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // FIX (#33) — `projectBinding.save` agora devolve `{ ok, ... }` (ver
  // src/shared/projectBinding.ts) em vez do DTO cru, justamente pra distinguir
  // falha de sucesso — antes o handler engolia payload inválido/erro de
  // escrita no mesmo DTO "vazio" que uma limpeza legítima produz.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  // FIX (#32) — mesmo commit de texto pendente do campo de repo que
  // `ProjectSwitcher.tsx` faz antes do submit (ver comentário lá).
  const configFormRef = useRef<ProjectConfigFormHandle>(null);

  // A tela NÃO é o `Modal` compartilhado (ver comentário de topo) — Escape
  // continua fechando, mesmo comportamento de sempre, só que sem foco preso
  // (a tela convive com o titlebar/StatusBar vivos, não bloqueia interação
  // com eles).
  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // CA-23 — carrega board+repo do disco toda vez que o painel abre (nunca
  // guarda em memória entre aberturas: o app não é a única forma de editar
  // esses arquivos, as skills da esteira também escrevem neles diretamente).
  useEffect(() => {
    if (!settingsOpen) return undefined;
    let cancelled = false;
    setBindingLoading(true);
    setSaveError(null);
    window.donel.projectBinding
      .get(projectPath)
      .then((dto) => {
        if (cancelled) return;
        setWorkspaceId(dto.workspaceId);
        setTeamId(dto.teamId);
        setRepos(reposFromBinding(dto));
      })
      .catch(() => {
        // Mesma degradação do resto do app (C4): arquivo ilegível não é erro
        // na tela, é campo vazio — o operador reescreve do zero se quiser.
        if (cancelled) return;
        setWorkspaceId(EMPTY_BINDING.workspaceId);
        setTeamId(EMPTY_BINDING.teamId);
        setRepos([]);
      })
      .finally(() => {
        if (!cancelled) setBindingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, projectPath]);

  if (!open) return null;

  const handleSaveSettings = (): void => {
    setSaving(true);
    setSaveError(null);
    // FIX (#32) — commita o texto pendente do campo de repo ANTES de ler a
    // lista (mesma normalização trim+dedup do `handleAddRepo` interno).
    const effectiveRepos = withPendingRepoCommitted(repos, configFormRef.current?.getPendingRepo() ?? '');
    if (effectiveRepos.length !== repos.length) setRepos(effectiveRepos);
    window.donel.projectBinding
      .save({ repoPath: projectPath, workspaceId, teamId, github: effectiveRepos[0] ?? '', githubExtra: effectiveRepos.slice(1) })
      .then((result) => {
        if (!result.ok) {
          setSaveError('Não consegui salvar — tente de novo.');
          return;
        }
        setWorkspaceId(result.binding.workspaceId);
        setTeamId(result.binding.teamId);
        setRepos(reposFromBinding(result.binding));
        setSettingsOpen(false);
      })
      .finally(() => setSaving(false));
  };

  return (
    <section
      className={styles.screen}
      role="region"
      aria-label={`Sessões anteriores · ${projectName}`}
      data-testid="previous-sessions"
    >
      <div className={styles.content}>
        <div className={styles.sessionsColumn}>
          <div className={styles.header}>
            <span className={styles.title}>Sessões anteriores</span>
            <span className={styles.projectName}>{projectName}</span>
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
            {yolo ? (
              <span className={styles.yoloMark} data-testid="project-yolo-mark" title="Modo YOLO: neste projeto o agente age sem perguntar. Desliga na engrenagem.">
                YOLO
              </span>
            ) : null}
            <div className={styles.headerSpacer} />
            <span className={styles.headerNote}>só as sessões deste projeto</span>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Fechar sessões anteriores" title="Fechar (Esc)">
              ✕
            </button>
          </div>

          <TextInput
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar por nome…"
            aria-label="Filtrar sessões anteriores por nome"
          />

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

          {/* B3 — tudo que a busca achou é sessão de fase da esteira, e elas estão ocultas: estado DIFERENTE de "sem resultado" (a busca achou, só não mostra por default). A frase nasce em `phaseOnlyResultsMessage` (shared/sessions.ts) — aqui só decide QUANDO mostrá-la. */}
          {!loading && filtered.length > 0 && rows.length === 0 ? (
            <p className={styles.hint}>
              {phaseOnlyResultsMessage(partitioned.hidden.length)}{' '}
              <button type="button" className={styles.phaseToggle} onClick={() => setShowPhaseSessions(true)}>
                Mostrar
              </button>
            </p>
          ) : null}

          {rows.length > 0 ? (
            <div className={styles.tableWrap}>
              <div className={styles.tableHeader}>
                <span aria-hidden="true" />
                <span>Sessão</span>
                <span>Etapa</span>
                <span>Quando</span>
                {/* Célula vazia na última coluna (ações) — mesma contagem de filhos que
                    `.row`, pro grid do cabeçalho resolver o MESMO layout (ver
                    comentário de `.tableGridColumns`, PreviousSessions.module.css). */}
                <span aria-hidden="true" />
              </div>
              <ul className={styles.table}>
                {rows.map((session) => {
                  const isLive = Boolean(contextLabelBySessionId[session.id]);
                  const { glyph, tone } = sessionGlyph(session, isLive);
                  // Fix #20 (E2E 30/07) — `preview` nunca contém o texto cru
                  // de um slash-command (FR-004 descarta esse payload de
                  // propósito), então toda sessão da esteira caía em
                  // "terminal comum". `firstCommandLine` (SessionIndexer)
                  // guarda esse texto à parte, sem afetar o `preview` exibido.
                  const etapa = deriveSessionEtapa(session.firstCommandLine ?? session.preview);
                  return (
                    <li key={session.id} className={styles.row} data-testid="previous-session-row">
                      <span className={[styles.rowGlyph, styles[`tone-${tone}`]].join(' ')} aria-hidden="true">
                        {glyph}
                      </span>
                      <span className={[styles.rowName, session.corrupted ? styles.corrupted : ''].join(' ')}>
                        {resolveSessionName({
                          fallback: session.preview,
                          customTitle: session.customTitle,
                          stored: sessionNames[session.id] ?? null,
                        })}
                      </span>
                      <span className={[styles.rowEtapa, etapa === FREE_TERMINAL_ETAPA_LABEL ? styles.rowEtapaMuted : ''].join(' ')}>
                        {etapa}
                      </span>
                      <span className={styles.rowWhen}>{formatRelativeTime(session.lastActivityAt ?? session.mtimeMs)}</span>
                      {/* Gestos Retomar/Fork continuam, sempre visíveis (ver PreviousSessions.module.css `.rowActions` — decisão nomeada contra hover-reveal). `formatFileSize` some da forma de tabela (a coluna não existe no mockup) mas o dado ainda existe no título, pra quem passar o mouse na sessão. */}
                      <span className={styles.rowActions} title={`${formatFileSize(session.size)}`}>
                        <Button variant="primary" onClick={() => onResume(session)}>
                          Retomar
                        </Button>
                        <Button variant="secondary" onClick={() => onFork(session)}>
                          Fork
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className={styles.footerNote}>
                Uma sessão reiniciada em outra conta aparece como duas entradas irmãs — a etiqueta de conta é o que diz de quem
                é a cota.
              </p>
              {/* B3 — o toggle só aparece quando há algo a esconder/revelar; "ocultar de novo" mantém o gesto reversível. O rótulo nasce em `phaseSessionsToggleLabel` (shared/sessions.ts). */}
              {partitioned.hidden.length > 0 ? (
                <p className={styles.footerNote}>
                  <button type="button" className={styles.phaseToggle} onClick={() => setShowPhaseSessions((prev) => !prev)}>
                    {phaseSessionsToggleLabel(partitioned.hidden.length, showPhaseSessions)}
                  </button>
                  {showPhaseSessions ? ' — elas já têm histórico próprio no card da Esteira.' : null}
                </p>
              ) : null}
            </div>
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

            <ProjectConfigForm
              ref={configFormRef}
              repos={repos}
              onReposChange={setRepos}
              workspaceId={workspaceId}
              onWorkspaceIdChange={setWorkspaceId}
              teamId={teamId}
              onTeamIdChange={setTeamId}
              disabled={bindingLoading || saving}
              yolo={{ enabled: yolo, onChange: onChangeYolo }}
            />

            {saveError ? (
              <p className={styles.hintDanger} data-testid="project-config-save-error">
                {saveError}
              </p>
            ) : null}

            <div className={styles.settingsActions}>
              <Button variant="primary" onClick={handleSaveSettings} disabled={saving}>
                Salvar
              </Button>
              <Button variant="secondary" onClick={() => setSettingsOpen(false)} disabled={saving}>
                Cancelar
              </Button>
            </div>

            <p className={styles.settingsFooter}>
              Board e repositório são integrações plugáveis. Um projeto sem eles usa o Modo Dev inteiro — só sem leitura de
              coluna e sem sub-issues.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
