import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { APP_MAIN, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// T322 (003-modo-dev, Batch B) — smoke completo da Fatia 1: condução e mapa.
//
// Isolado do `%APPDATA%` real (userData temp), do BOARD real (porta de
// entrada alimentada por um arquivo de fixture, `DONEL_DEVMODE_BOARD_FIXTURE`
// — ver `taskdex-board-client.ts` — nenhuma chamada de rede, nenhum token) e
// da raiz v3 do handoff (`DONEL_ESTEIRA_STATE_ROOT`, CA-4/009-modo-dev-v3):
// uma fixture em tmpdir escrita por este arquivo; nada é lido do repo/`~/.claude` de verdade.
//
// UMA sessão `claude` real é aberta de propósito: o teste mais importante da
// feature é "o comando aparece ESCRITO no prompt e NÃO foi enviado", e isso
// só existe contra um PTY real. **Nenhum Enter é pressionado sobre o comando
// armado** — pressioná-lo dispararia uma skill de verdade (custo/quota), e o
// que a spec exige provar é justamente o contrário: que o app parou ali.

const CARD_DISCOVERY = 'SZI-900';
const CARD_M1 = 'SZI-901';
const CARD_M2 = 'SZI-902';
/** 009-modo-dev-v3, lote 5 (CA-2) — card SEM vínculo numa coluna que a v2 nunca listava. */
const CARD_IMPL = 'SZI-903';
const CARD_LIVRE = 'SZI-999';
const CARD_FORA = 'SZI-500';

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
let fixtureRepo: string;
/** CA-4 (009-modo-dev-v3) — raiz v3 do handoff, `~/.claude/esteira-state` isolada via `DONEL_ESTEIRA_STATE_ROOT`. */
let stateRoot: string;
/**
 * Isolamento que faltava (achado 31/07): sem `DONEL_ESTEIRA_CONFIG_DIR`, o app
 * lia o `~/.claude/esteira-config/repos.json` REAL da máquina — o dropdown de
 * board do smoke chegou a listar "spotsys", um projeto de verdade. Teste que
 * enxerga a configuração da máquina não é isolado: passa ou falha conforme o
 * dia.
 */
let esteiraConfigDir: string;
/** `repo_slug` é o basename do checkout local — mesma resolução de `resolveRepoSlug` (main/index.ts). */
let repoSlug: string;
let worktreeDir: string;
/** Mesmo caminho de `worktreeDir` com barras normais — é assim que o `ctx.md` declara (e é o que o app usa como `cwd`). */
let worktreeDeclared: string;
let boardFixturePath: string;

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

function ctxPath(fase: string, cardId: string): string {
  return path.join(stateRoot, repoSlug, cardId, fase, `${cardId}-ctx.md`);
}

/** CA-4/D.0-bis — implementar/validar arquivam por `fase-<n>`; as demais fases gravam direto em `handoffs/`. */
function resultPath(fase: string, cardId: string, faseNum?: number): string {
  const handoffsDir = path.join(stateRoot, repoSlug, cardId, fase, 'handoffs');
  if (fase === 'implementar' || fase === 'validar') {
    return path.join(handoffsDir, `fase-${faseNum ?? 1}`, `${fase}-result.json`);
  }
  return path.join(handoffsDir, `${fase}-result.json`);
}

function manifest(cardId: string, fase: string, status: string, outputs: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      card_id: cardId,
      fase,
      status,
      started_at: '2026-07-27T10:00:00Z',
      finished_at: '2026-07-27T10:30:00Z',
      executor: 'claude',
      model: 'opus',
      effort: 'high',
      outputs,
      registrations: { vault: { path: null, section: null } },
    },
    null,
    2,
  );
}

/** PIDs vivos de `imageName` agora — mesmo helper de tabs-lifecycle/dev-mode (diferença de PID, nunca contagem absoluta). */
function listPids(imageName: string): Set<number> {
  let output: string;
  try {
    output = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV /NH`, { encoding: 'utf8' });
  } catch {
    return new Set();
  }
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('"')) continue;
    const cols = trimmed.split('","').map((col) => col.replace(/^"|"$/g, ''));
    const pid = Number(cols[1]);
    if (Number.isFinite(pid)) pids.add(pid);
  }
  return pids;
}

function newPids(before: Set<number>): number[] {
  return [...listPids('claude.exe')].filter((pid) => !before.has(pid));
}

test.beforeAll(async () => {
  fixtureRepo = mkdtempSync(path.join(os.tmpdir(), 'modo-dev-esteira-'));
  stateRoot = mkdtempSync(path.join(os.tmpdir(), 'modo-dev-esteira-state-'));
  esteiraConfigDir = mkdtempSync(path.join(os.tmpdir(), 'modo-dev-esteira-config-'));
  repoSlug = path.basename(fixtureRepo);
  // O catálogo de projetos do app só reconhece pasta com `.git` ou
  // `CLAUDE.md` (`project-scanner.ts`) — sem o marcador, o repo do fixture não
  // existe para o dropdown da porta de entrada.
  write(path.join(fixtureRepo, 'CLAUDE.md'), '# fixture do smoke\n');
  worktreeDir = mkdtempSync(path.join(os.tmpdir(), 'modo-dev-worktree-'));
  worktreeDeclared = worktreeDir.split(path.sep).join('/');

  // --- Fixture da raiz v3 do handoff (o que a Esteira já grava em disco) --
  // Discovery concluído, com 2 cards de plano em `plan_cards[]` (CA-14/CA-17:
  // o mapa card→card-de-plano vem daqui, nunca do prefixo [Mx] do título do
  // card — que a v3 nem grava mais).
  write(ctxPath('discovery', CARD_DISCOVERY), '---\ncard_id: SZI-900\n---\n\n# ctx\n');
  write(
    resultPath('discovery', CARD_DISCOVERY),
    manifest(CARD_DISCOVERY, 'discovery', 'success', {
      summary: 'discovery ok',
      plan_cards: [
        { card_id: CARD_M1, track: 'codigo', shadow: false },
        { card_id: CARD_M2, track: 'codigo', shadow: false },
      ],
    }),
  );

  // M1: plano concluído (com artefatos declarados) e implementar TRAVADO
  // (ctx.md presente, sem manifesto, sem sessão viva) — é o estado que
  // dispara a sequência de dois comandos do CA-16.
  write(ctxPath('plano', CARD_M1), '---\ncard_id: SZI-901\n---\n\n# ctx do plano\n');
  write(
    resultPath('plano', CARD_M1),
    manifest(CARD_M1, 'plano', 'success', {
      summary: 'plano ok',
      artifact_paths: ['specs/003/spec.md', 'specs/003/plan.md'],
      // Lote 7 (CA-11) — o plano declara 1 fase (unidade de PR); sem isto,
      // `PlanCardNode.fases` fica vazio e Implementação/Validação não nascem
      // no mapa (CA-14) — a trilha ficaria só em [discovery, plano]. Lote 8
      // (CA-20) — a garantia mora DENTRO da fase (contrato §D.3), não solta
      // em `outputs.garantia`: é essa a fonte que o painel de 316px lê.
      fases: [
        {
          fase_num: 1,
          titulo: 'Implementação única',
          garantia: { tipo: 'roteiro_e2e', descricao: 'Cobre o fluxo ponta a ponta', roteiro_path: 'specs/003/e2e.md' },
        },
      ],
    }),
  );
  // D3 — worktree/branch no frontmatter do ctx.md da fase implementar.
  write(
    ctxPath('implementar', CARD_M1),
    `---\ncard_id: ${CARD_M1}\nworktree_path: ${worktreeDeclared}\nbranch: feature/szi-901\n---\n\n# ctx\n`,
  );

  // --- Board mockado (arquivo, nunca rede) --------------------------------
  boardFixturePath = path.join(fixtureRepo, 'board-fixture.json');
  write(
    boardFixturePath,
    JSON.stringify({
      cards: [
        { cardId: CARD_DISCOVERY, column: 'discovery', title: 'Frente grande' },
        { cardId: CARD_M1, column: 'plano', title: 'Marco 1' },
        { cardId: CARD_M2, column: 'plano', title: 'Marco 2' },
        { cardId: CARD_LIVRE, column: 'backlog', title: 'Card sem discovery' },
        // CA-2 (009-modo-dev-v3, lote 5) — coluna nova da v3: a v2 nunca listava
        // cards de Implementar na porta de entrada; agora lista.
        { cardId: CARD_IMPL, column: 'implementar', title: 'Card em implementar' },
        // CA-1 — Concluído continua fora: NUNCA pode aparecer.
        { cardId: CARD_FORA, column: 'concluido', title: 'Card concluído' },
      ],
      // Achado do e2e 31/07 — a fase TRAVADA do M1 não é mais expressável só
      // pelo disco: desde o fix do #16, `ctx.md` sem o manifesto do `fase_num`
      // significa "não iniciada". Quem diz "esta fase rodou e não arquivou" é
      // a ETIQUETA do board (D1) — é ela que devolve `stuck` à fase, e com ela
      // a trilha volta a mostrar a etapa seguinte e o `/esteira-liberar` do
      // CA-16.
      facts: {
        [CARD_M1]: { column: 'implementar', title: 'Marco 1', labels: ['esteira:em-andamento:implementar'] },
      },
    }),
  );

  // --- Config semeado no userData isolado ---------------------------------
  // Discovery já ABERTO (para o card de Plano ter um pai a focar) e uma etapa
  // ARQUIVADA em OUTRO perfil (CA-22). `phaseDefaults` com haiku/low prova que
  // a tabela do CA-4 é config editável, não constante de código.
  userDataDir = createIsolatedUserDataDir('dev-mode-conducao');
  const phaseEntry = (commandTemplate: string, opensOwnSession: boolean) => ({
    model: 'haiku',
    effort: 'low',
    commandTemplate,
    opensOwnSession,
  });
  write(
    path.join(userDataDir, 'config.json'),
    JSON.stringify({
      version: 1,
      projectRoots: [path.dirname(fixtureRepo)],
      favorites: [],
      activeProfileSlug: 'principal',
      launcherDefaults: { model: 'haiku', effort: 'low', permissionMode: 'acceptEdits' },
      notificationPreference: 'none',
      sessionNames: {},
      theme: 'dark',
      sessionRegistry: {},
      collapsedFavorites: [],
      devMode: {
        discoveries: {
          [CARD_DISCOVERY]: { cardId: CARD_DISCOVERY, repoPath: fixtureRepo, epicId: null, openedAt: 1, closedAt: null },
        },
        focusedDiscoveryId: null,
        // CA-31 — chave v3 (cardId:fase, sem marco_id).
        archivedPhaseSessions: {
          [`${CARD_M1}:plano`]: { sessionId: 'sess-antiga', profileSlug: 'outra-conta', archivedAt: 1 },
        },
        // "Tudo ou nada" (config-store.ts sanitizePhaseDefaultsTable): as 7
        // fases têm de estar presentes, senão a tabela INTEIRA cai no
        // DEFAULT_PHASE_DEFAULTS (opus/high) e este smoke perderia a prova de
        // que a tabela é config editável (haiku/low, abaixo).
        phaseDefaults: {
          discovery: phaseEntry('/esteira-discovery {card_id}', true),
          plano: phaseEntry('/esteira-plano {card_id}', true),
          implementar: phaseEntry('/esteira-implementar {card_id} ultracode', true),
          validar: phaseEntry('/esteira-validar {card_id}', true),
          documentar: phaseEntry('/esteira-documentar {card_id}', true),
          cliente: phaseEntry('/esteira-cliente {card_id}', false),
          concluir: phaseEntry('/esteira-concluir {card_id}', false),
        },
        boardConfig: { workspaceId: 'ws-smoke', teamId: 'team-smoke' },
      },
    }),
  );

  electronApp = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DONEL_DEVMODE_BOARD_FIXTURE: boardFixturePath,
      DONEL_ESTEIRA_STATE_ROOT: stateRoot,
      DONEL_ESTEIRA_CONFIG_DIR: esteiraConfigDir,
    },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp?.close();
  if (userDataDir) removeIsolatedUserDataDir(userDataDir);
  // Limpeza best-effort: no Windows o `claude.exe` que rodou com `cwd` na
  // worktree pode ainda segurar o handle do diretório por alguns ms depois do
  // app fechar (EBUSY). Falhar a suíte por causa de um rmdir de fixture seria
  // um falso vermelho — o diretório é temp e o SO recolhe.
  for (const dir of [fixtureRepo, stateRoot, worktreeDir, esteiraConfigDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignorado de propósito — ver comentário acima
    }
  }
});

test('Modo Dev — Fatia 1 de ponta a ponta: entrada, condução sem Enter, mapa e arquivamento', async () => {
  test.setTimeout(240_000);
  const claudeBaseline = listPids('claude.exe');

  // === T310/CA-20 — liga o modo ==========================================
  // Item 1 (rodada de forma fix/009-board-real-e-modal) — o switch "Modo
  // Dev" virou SegmentedControl "Uso geral | Dev" (titlebar v3).
  await window.locator('[data-testid="devmode-toggle"]').getByRole('radio', { name: 'Dev' }).click();
  await expect(window.locator('[data-testid="devmode-entry"]')).toBeVisible();
  // A tela de hoje foi OCULTADA, não desmontada.
  await expect(window.locator('[data-testid="today-sidebar"]')).toBeHidden();

  // === T311/CA-1/CA-2 (009-modo-dev-v3, lote 5) — colunas de entrada ======
  // A v2 restringia a 3 colunas; a v3 soma as colunas disparáveis do CA-1
  // (implementar/validar/documentar) — CARD_IMPL é a prova viva disso.
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_DISCOVERY}"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_M1}"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_LIVRE}"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_IMPL}"]`)).toBeVisible();
  // Concluído continua fora — CA-1 diz que ela não dispara nada.
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_FORA}"]`)).toHaveCount(0);

  // === T311/CA-2 — card vinculado aparece MARCADO =========================
  await expect(window.locator(`[data-testid="devmode-entry-linked-${CARD_DISCOVERY}"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-entry-linked-${CARD_M1}"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-entry-linked-${CARD_LIVRE}"]`)).toHaveCount(0);

  // === forma enxuta (31/07) — a porta é dropdown de board + busca + lista ===
  // O filtro por COLUNA (SegmentedControl de 7 segmentos) saiu: a etapa agora
  // vem escrita em cada linha, junto do nome do board.
  const entryModal = window.locator('[data-testid="devmode-entry"]');
  const filterInput = entryModal.locator('input[aria-label="Buscar card"]');
  await filterInput.fill(CARD_M1);
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_M1}"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_LIVRE}"]`)).toHaveCount(0);
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_IMPL}"]`)).toHaveCount(0);
  await filterInput.fill('');
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_M1}"]`)).toBeVisible();

  // A etapa do card está na própria linha (era o que o SegmentedControl filtrava).
  await expect(window.locator(`[data-testid="devmode-entry-card-${CARD_IMPL}"]`)).toContainText('Implementar');

  // Nada do conteúdo pode passar da caixa do modal — o corte na borda direita
  // (e2e 30/07) era exatamente isto: filho mais largo que o próprio diálogo.
  const overflowX = await entryModal.evaluate((element) => {
    const dialog = element.closest('[role="dialog"]') ?? element;
    return Math.max(
      dialog.scrollWidth - dialog.clientWidth,
      ...[...dialog.querySelectorAll('*')].map((child) => child.scrollWidth - child.clientWidth),
    );
  });
  expect(overflowX).toBeLessThanOrEqual(1);

  // === T311/CA-2 — card de PLANO abre o discovery PAI, não um novo ========
  // (escolher card já vinculado a um discovery existente traz esse discovery
  // ao foco — nunca dispara/cria outro: nenhuma sessão nova nasce aqui.)
  const claudeBeforeSelect = listPids('claude.exe');
  await window.locator(`[data-testid="devmode-entry-card-${CARD_M2}"] button`).click();
  const toast = window.locator('[role="status"]');
  await expect(toast).toContainText(`Discovery ${CARD_DISCOVERY} em foco`);
  // D4 — Toast informativo: nenhuma ação de desfazer.
  await expect(toast.locator('button')).toHaveCount(0);
  expect(newPids(claudeBeforeSelect)).toHaveLength(0);
  // Nenhum discovery novo nasceu: o card de Plano continua marcado como
  // vinculado ao PAI (se tivesse criado um discovery próprio, o mapa abriria
  // com o card do marco no topo).
  // Selecionar fecha o modal (CA-2 — comportamento, não forma do mockup).
  await expect(entryModal).toHaveCount(0);

  // === lote 5 (CA-2) — "Trocar…" reabre o modal com um discovery em foco ==
  await window.locator('[data-testid="devmode-entry-trigger"]').click();
  await expect(entryModal).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(entryModal).toHaveCount(0);
  await expect(window.locator('[data-testid="devmode-map"]')).toBeVisible();

  // === Lote 7/CA-7/CA-9 — o mapa virou carrossel de dois eixos ============
  // CA-17 — o testid usa o card_id real (não há mais marco_id no disco).
  await expect(window.locator(`[data-testid="devmode-map-plano-${CARD_M1}"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-map-plano-${CARD_M2}"]`)).toBeVisible();
  // Card de plano em foco (M1 é `planCards[0]`, foco default) tem marcação distinta.
  await expect(window.locator(`[data-testid="devmode-map-plano-${CARD_M1}"]`)).toHaveAttribute('data-focused', 'true');
  await expect(window.locator(`[data-testid="devmode-map-plano-${CARD_M2}"]`)).toHaveAttribute('data-focused', 'false');
  // CA-28 — a legenda dos dois eixos SAIU do rodapé do mapa (não existe mais testid pra ela).
  await expect(window.locator('[data-testid="devmode-map-legend"]')).toHaveCount(0);

  // === CA-13 — a trilha do card em foco: já rodou + a PRÓXIMA, nada além ==
  // M1: discovery(done) · plano(done) · implementar-1(stuck) · validar-1(not-started, é a próxima).
  const trilhaM1 = window.locator(`[data-testid="devmode-map-trilha-${CARD_M1}"]`);
  await expect(trilhaM1.locator('[data-testid^="devmode-trilha-step-"]')).toHaveCount(4);
  await expect(window.locator(`[data-testid="devmode-trilha-step-${CARD_M1}-discovery"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-trilha-step-${CARD_M1}-plano"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-trilha-step-${CARD_M1}-implementar-1"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-trilha-step-${CARD_M1}-validar-1"]`)).toContainText('é a próxima');
  // CA-13/verificação §2 — "⌁ Preparar" só na PRÓXIMA (validar-1); nenhuma outra etapa ganha o botão.
  await expect(window.locator(`[data-testid="devmode-trilha-prepare-${CARD_M1}-validar-1"]`)).toBeVisible();
  await expect(window.locator(`[data-testid="devmode-trilha-prepare-${CARD_M1}-implementar-1"]`)).toHaveCount(0);

  // === T317/CA-8,CA-10,CA-18 + T318/CA-9 — clicar numa etapa PASSADA retoma =
  // Clicar na linha `plano` (concluída, COM session-id arquivado) retoma a
  // sessão daquela etapa — é o que o CA-13 pede literalmente ("clicar numa
  // passada retoma a sessão arquivada").
  await window.locator(`[data-testid="devmode-trilha-step-${CARD_M1}-plano"]`).click();

  // === Lote 8/CA-18/CA-20 — header de 44px (breadcrumb) + painel (artefatos) =
  // Revisão do orquestrador (mesmo lote): o breadcrumb mora no HEADER de
  // 44px acima do terminal (mockup linhas 175-196), não no painel de 316px
  // (que só tem glifo+chip+fase+resumo, mockup linhas 236-250). A fase
  // `plano` não é fase-indexada (`faseNum: null`): sem seção de garantia
  // nem de PR (essas são 1:1 com `fase_num`, CA-20) — só os artefatos
  // declarados no `plano-result.json` (linha ~136).
  const detailsPanel = window.locator('[data-testid="devmode-details-panel"]');
  const sessionHeader = window.locator('[data-testid="session-header"]');
  await expect(sessionHeader).toContainText(CARD_DISCOVERY);
  await expect(sessionHeader).toContainText(CARD_M1);
  await expect(detailsPanel.locator('[data-testid="devmode-details-garantia"]')).toHaveCount(0);
  await expect(detailsPanel.locator('[data-testid="devmode-details-pr"]')).toHaveCount(0);
  const artifacts = window.locator('[data-testid="devmode-details-artifacts"]');
  await expect(artifacts).toContainText('specs/003/spec.md');
  await expect(artifacts).toContainText('specs/003/plan.md');

  // FIX (rodada de feedback 30/07, item 2) — "o botão de ocultar barra
  // lateral não oculta a barra direita": o botão do titlebar (ícone
  // Panel-Right-Close/Open, `rightCollapsed`) tinha de esconder os DOIS
  // painéis do Modo Dev (mapa à esquerda + `PhaseDetailsPanel` de 316px à
  // direita) — antes só o mapa obedecia.
  const devMap = window.locator('[data-testid="devmode-map"]');
  const collapsePanelsButton = window.getByRole('button', { name: 'Recolher painéis do Modo Dev' });
  await collapsePanelsButton.click();
  await expect(devMap).toHaveCount(0);
  await expect(detailsPanel).toHaveCount(0);
  await window.getByRole('button', { name: 'Mostrar painéis do Modo Dev' }).click();
  await expect(devMap).toBeVisible();
  await expect(detailsPanel).toBeVisible();

  // CA-9 — retomada pelo `-r <session-id>` arquivado (argv real, hook de teste).
  await expect(window.locator('[data-testid="devmode-last-session"]')).toHaveText('claude -r sess-antiga');
  // CA-22 — a etapa rodou em outra conta: avisa, e retoma assim mesmo (o
  // aviso inline no nó do mapa é conteúdo rico do lote 8 — o Toast já cobre
  // o fato aqui).
  await expect(toast).toContainText('outra-conta');
  // A sessão retomada de verdade subiu (1 processo novo) — só depois disso a
  // contagem do próximo passo é determinística.
  await expect(async () => {
    expect(newPids(claudeBaseline)).toHaveLength(1);
  }).toPass({ timeout: 60_000 });

  // === T312/CA-3 — O GESTO CENTRAL: escreve e PARA ========================
  // `implementar-1` está TRAVADA (stuck): a sequência do CA-16 tem dois
  // passos, e só o primeiro pode sair agora (o segundo depende de um Enter
  // humano que este teste deliberadamente não dá). Clicar a LINHA (travada
  // não é "a próxima" — não tem botão "⌁ Preparar", mas a linha inteira
  // dispara, mesmo comportamento do antigo botão sempre clicável, CA-5).
  const beforeImplementar = listPids('claude.exe');
  await window.locator(`[data-testid="devmode-trilha-step-${CARD_M1}-implementar-1"]`).click();

  // T312 — argv da tabela do CA-4 (editada no config: haiku/low) e `cwd` na
  // WORKTREE declarada no ctx.md (D3), não no repo.
  await expect(window.locator('[data-testid="devmode-last-session"]')).toHaveText('claude --model haiku --effort low');
  await expect(window.locator('[data-testid="devmode-last-session"]')).toHaveAttribute('data-cwd', worktreeDeclared);

  // === Lote 8/CA-18/CA-20 — header (breadcrumb) + painel (garantia + PR) ===
  // `implementar-1` É fase-indexada (`faseNum: 1`): garantia (da fase do
  // PLANO, contrato §D.3) e PR (branch do frontmatter do ctx.md, D3 — sem
  // `gh`/repo configurado neste smoke, "sem PR ainda" é o degradado correto).
  await expect(sessionHeader).toContainText('fase 1');
  const garantia = window.locator('[data-testid="devmode-details-garantia"]');
  await expect(garantia).toContainText('roteiro_e2e');
  await expect(garantia).toContainText('specs/003/e2e.md');
  const prSection = window.locator('[data-testid="devmode-details-pr"]');
  await expect(prSection).toContainText('sem PR ainda');
  await expect(prSection).toContainText('feature/szi-901');

  const activePane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(activePane).toHaveCount(1);
  // Diálogo de confiança de pasta (tmpdir nunca é confiada): responde como
  // humano. É o ÚNICO Enter deste teste — e ele nunca cai sobre o comando
  // armado, que só é escrito depois disto.
  await expect(async () => {
    const text = await activePane.innerText();
    if (text.includes('trust this folder') || text.includes('Do you trust')) {
      await activePane.click();
      await window.keyboard.press('Enter');
    }
    expect(text.toLowerCase()).toContain('claude code');
  }).toPass({ timeout: 90_000 });

  // #24 (onda 3) — a moldura do `ArmedPrompt` saiu: o comando escrito no
  // PROMPT do CLI é a única prova que interessa (e sempre foi a de verdade).
  await expect(async () => {
    expect(await activePane.innerText()).toContain(`/esteira-liberar ${CARD_M1}`);
  }).toPass({ timeout: 60_000 });
  const paneText = await activePane.innerText();
  // CA-16 — NUNCA os dois comandos ao mesmo tempo.
  expect(paneText).not.toContain('/esteira-implementar');
  // ...e o que está lá NÃO foi submetido: nenhuma linha de output do CLI
  // processando o comando.
  expect(paneText).not.toContain('Unknown slash command');
  expect(paneText).not.toContain('esteira-liberar: ');

  // Exatamente UMA sessão nova (a retomada da fase `plano` de antes).
  await expect(async () => {
    expect(newPids(beforeImplementar)).toHaveLength(1);
  }).toPass({ timeout: 30_000 });

  // NOTA (lote 7) — o C6 (`concluir` pré-digita na aba em foco, sem PTY novo)
  // e o painel de detalhe rico (artefatos, skill, recibos, aviso de conta) já
  // não têm entrada nesta suíte: `concluir` não é mais nível nem trilha (a
  // trilha para na PRÓXIMA etapa proposta — CA-13/CA-21), e o conteúdo do nó
  // migrou para o painel de 316px (`PhaseDetailsPanel`), que o lote 8 povoa.
  // `--fase=n` (D-V4) é coberto por unidade em `tests/mapLevels.test.ts`
  // (`formatFaseCommand`) — armar o 2º passo aqui exigiria destravar o
  // sequenciador com Enter de verdade, custando uma sessão real de cota.

  // === T310/CA-20 — desligar preserva a tela de hoje E as abas ============
  const tabsBefore = await window.locator('[role="tab"]').count();
  const pidsBefore = listPids('claude.exe');
  await window.locator('[data-testid="devmode-toggle"]').getByRole('radio', { name: 'Uso geral' }).click();
  await expect(window.locator('[data-testid="today-sidebar"]')).toBeVisible();
  await expect(window.locator('[data-testid="devmode-entry"]')).toHaveCount(0);
  expect(await window.locator('[role="tab"]').count()).toBe(tabsBefore);
  expect([...listPids('claude.exe')].sort()).toEqual([...pidsBefore].sort()); // nenhum PTY recriado
  await window.locator('[data-testid="devmode-toggle"]').getByRole('radio', { name: 'Dev' }).click();
  await expect(window.locator('[data-testid="devmode-map"]')).toBeVisible();

  // === T315/CA-6 — arquivamento pelo MANIFESTO ============================
  // Manifesto de FALHA não arquiva: a aba fica aberta (CA-6 literal).
  write(resultPath('implementar', CARD_M1), manifest(CARD_M1, 'implementar', 'failed', { summary: 'falhou' }));
  await window.waitForTimeout(2_000);
  expect(await window.locator('[role="tab"]').count()).toBe(tabsBefore);

  // Manifesto de SUCESSO fecha a aba daquela etapa.
  write(resultPath('implementar', CARD_M1), manifest(CARD_M1, 'implementar', 'success', { summary: 'ok' }));
  await expect(window.locator('[role="tab"]')).toHaveCount(tabsBefore - 1, { timeout: 30_000 });

  // === T321/CA-23/CA-21 — encerramento automático ==========================
  // CA-21 (009-modo-dev-v3, lote 8) — o sinal de "card de plano concluído"
  // deixou de ser `phases.concluir.status === 'done'` (a v3 nunca grava
  // `concluir-result.json`, contrato §D.7 — era por isso que o auto-close
  // nunca disparava de verdade na v3, problema 3 da spec). Agora é: track
  // código, QUALQUER fase declarada com `validar-result.json.outputs.
  // plano_completo === true` (§D.5 — "todas as fases deste plano estão
  // homologadas"). M1 já tem `plano-result.json` com uma fase declarada
  // (linha ~141); M2 ainda não tinha NENHUM — ganha um aqui, senão
  // `fases: []` faria `allPlanCardsComplete` nunca fechar (CA-14, nunca
  // fabrica conclusão por ausência).
  write(resultPath('plano', CARD_M2), manifest(CARD_M2, 'plano', 'success', { fases: [{ fase_num: 1, titulo: 'Implementação única' }] }));
  for (const cardId of [CARD_M1, CARD_M2]) {
    write(ctxPath('validar', cardId), `---\ncard_id: ${cardId}\n---\n\n# ctx\n`);
    write(resultPath('validar', cardId), manifest(cardId, 'validar', 'success', { fase_num: 1, plano_completo: true }));
  }
  // Força uma releitura do disco pelo mesmo caminho que o usuário usaria.
  await window.locator('[data-testid="devmode-toggle"]').getByRole('radio', { name: 'Uso geral' }).click();
  await window.locator('[data-testid="devmode-toggle"]').getByRole('radio', { name: 'Dev' }).click();
  await expect(window.locator(`[data-testid="devmode-entry-linked-${CARD_DISCOVERY}"]`)).toHaveCount(0, { timeout: 30_000 });
  await expect(window.locator('[data-testid="devmode-map"]')).toHaveCount(0);

  // === CA-1 + "a porta FECHA ao escolher" (e2e 31/07) ======================
  // Card sem vínculo numa coluna disparável abre a sessão DAQUELA fase (nunca
  // `/esteira-discovery`) — e a porta some. Este segundo pedaço é o que
  // prendeu ele: sem discovery em foco, zerar só o `entradaManualOpen` não
  // fecha nada, porque `entradaOpen` reabre pelo ramo `!focusedDiscoveryId`.
  // Fica por último de propósito: é o único ponto do teste que abre uma
  // sessão `claude` fora das contagens de PID acima.
  const entryModalFinal = window.locator('[data-testid="devmode-entry"]');
  await expect(entryModalFinal).toBeVisible({ timeout: 15_000 });

  // Sem repo escolhido o clique é RECUSADO — e a porta continua aberta de
  // propósito, porque é nela que o pedido se resolve (o dropdown do topo).
  await window.locator(`[data-testid="devmode-entry-card-${CARD_IMPL}"] button`).click();
  await expect(window.locator('[role="status"]')).toContainText('onde este card roda');
  await expect(entryModalFinal).toBeVisible();

  // Escolhido o projeto no dropdown, o mesmo clique passa — e AGORA a porta
  // fecha (era exatamente aqui que ele ficava preso).
  await entryModalFinal.getByRole('button', { name: /Escolher projeto|Escolher board/ }).click();
  await window.getByRole('option', { name: repoSlug }).click();
  await window.locator(`[data-testid="devmode-entry-card-${CARD_IMPL}"] button`).click();
  await expect(entryModalFinal).toHaveCount(0, { timeout: 15_000 });
  // A aba nasce com a FASE da coluna no nome — a prova de que o clique não
  // caiu no discovery. O texto do comando em si é contrato de
  // `entryPhaseForColumn` + `resolveCommandSequence` (testes unitários): subir
  // mais um `claude` só para reler o prompt aqui não pagaria o minuto extra.
  await expect(window.getByRole('tab', { name: new RegExp(`${CARD_IMPL}.*implementar`) })).toBeVisible({
    timeout: 30_000,
  });
});
