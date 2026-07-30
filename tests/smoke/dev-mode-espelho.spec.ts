import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { APP_MAIN, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// T329 (003-modo-dev, Batch D) — smoke completo da Fatia 2: o ESPELHO.
//
// Isolado do board real (fixture em arquivo, `DONEL_DEVMODE_BOARD_FIXTURE` —
// nenhuma chamada de rede, nenhum token), do `%APPDATA%` real (userData temp)
// e da raiz v3 do handoff (`DONEL_ESTEIRA_STATE_ROOT`, CA-4, 009-modo-dev-v3
// — `~/.claude/esteira-state` isolada em tmpdir, escrita por este arquivo).
//
// Cobre: overlay dos fatos do board (T327), trava do BOARD acendendo o slot do T314
// e a ação "Liberar trava…" (D1/CA-16), divergência marcada e divergência
// ESPERADA filtrada (T326/CA-13), sessão de conciliação pré-digitada (T328) e
// a ausência total de escrita — nem no disco, nem no board — em qualquer
// caminho exercitado.
//
// UMA sessão `claude` real é aberta de propósito (a da conciliação): o que a
// spec exige provar é que o texto aparece ESCRITO no prompt e NÃO é enviado, e
// isso só existe contra um PTY real. **Nenhum Enter cai sobre texto armado.**

const CARD_DISCOVERY = 'SZI-900';
const CARD_M1 = 'SZI-901';
const CARD_M2 = 'SZI-902';

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
let fixtureRepo: string;
/** CA-4 (009-modo-dev-v3) — raiz v3 do handoff, `~/.claude/esteira-state` isolada via `DONEL_ESTEIRA_STATE_ROOT`. */
let stateRoot: string;
/** `repo_slug` é o basename do checkout local — mesma resolução de `resolveRepoSlug` (main/index.ts). */
let repoSlug: string;
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

/** Impressão digital de TODO arquivo sob `dir`: caminho + tamanho + mtime + conteúdo. É o assert de I/O do DoD do T327. */
function fingerprint(dir: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const stats = statSync(full);
      snapshot[path.relative(dir, full)] = `${stats.size}:${stats.mtimeMs}:${readFileSync(full, 'utf8')}`;
    }
  };
  walk(dir);
  return snapshot;
}

/** PIDs vivos de `imageName` agora — mesmo helper do smoke da Fatia 1 (diferença de PID, nunca contagem absoluta). */
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
  fixtureRepo = mkdtempSync(path.join(os.tmpdir(), 'modo-dev-espelho-'));
  stateRoot = mkdtempSync(path.join(os.tmpdir(), 'modo-dev-espelho-state-'));
  repoSlug = path.basename(fixtureRepo);

  // --- Fixture da raiz v3 do handoff (o que a Esteira já gravou em disco) --
  write(ctxPath('discovery', CARD_DISCOVERY), '---\ncard_id: SZI-900\n---\n\n# ctx\n');
  write(
    resultPath('discovery', CARD_DISCOVERY),
    manifest(CARD_DISCOVERY, 'discovery', 'success', {
      summary: 'discovery ok',
      // CA-17 — plan_cards[] substitui fanout_cards[]: sem marco_id, com track/shadow.
      plan_cards: [
        { card_id: CARD_M1, track: 'codigo', shadow: false },
        { card_id: CARD_M2, track: 'codigo', shadow: false },
      ],
    }),
  );

  // M1 — `plano` concluído e o board JÁ na coluna `implementar`: progresso
  // normal, nenhuma divergência. É o card de plano que carrega a TRAVA do board.
  write(ctxPath('plano', CARD_M1), '---\ncard_id: SZI-901\n---\n\n# ctx do plano\n');
  write(resultPath('plano', CARD_M1), manifest(CARD_M1, 'plano', 'success', { summary: 'plano ok' }));
  write(ctxPath('implementar', CARD_M1), '---\ncard_id: SZI-901\n---\n\n# ctx\n');

  // M2 — os DOIS casos do CA-13/CA-19 no mesmo card de plano:
  //  · `plano` concluído no disco e card ainda na coluna `plano` →
  //    divergência de verdade (marca): Plano MOVE o card pra Implementar
  //    (contrato v3 §B), então ficar em `plano` é atraso real.
  //  · `implementar`/`validar` concluídas no disco e card ainda na coluna
  //    `plano` → NÃO marcam: CA-19 (009-modo-dev-v3, lote 8) — Implementar
  //    NÃO move o card na v3 (fica em Implementar até o PR mergear, D20) e
  //    Validar nunca moveu (invariante antiga, preservada). Duas fases sem
  //    divergência simultânea prova que o fix não é "sorte" de uma só.
  for (const fase of ['plano', 'implementar', 'validar']) {
    write(ctxPath(fase, CARD_M2), `---\ncard_id: ${CARD_M2}\n---\n\n# ctx\n`);
    write(resultPath(fase, CARD_M2), manifest(CARD_M2, fase, 'success', { summary: `${fase} ok` }));
  }
  // O manifesto REAL da skill grava `artifact_paths` como OBJETO nomeado, não
  // array — foi o shape que derrubou o renderer no 1º teste com card de
  // verdade (28/07, tela preta). O `implementar` do M2 usa o formato real de
  // propósito: o clique no nó divergente (abaixo) só passa se o painel de
  // detalhes renderizar os paths em vez de crashar.
  write(
    resultPath('implementar', CARD_M2),
    manifest(CARD_M2, 'implementar', 'success', {
      summary: 'implementar ok',
      artifact_paths: { spec: 'specs/demo/spec.md', plan: 'specs/demo/plan.md' },
    }),
  );

  // --- Board mockado (arquivo, nunca rede) --------------------------------
  // `facts` traz de propósito campos que o CA-12 NÃO exibe (descrição,
  // comentários, checklist): o teste prova que eles nunca chegam à tela.
  boardFixturePath = path.join(fixtureRepo, 'board-fixture.json');
  write(
    boardFixturePath,
    JSON.stringify({
      cards: [
        { cardId: CARD_DISCOVERY, column: 'discovery', title: 'Frente grande' },
        { cardId: CARD_M1, column: 'plano', title: '[M1] Marco 1' },
      ],
      facts: {
        [CARD_M1]: {
          column: 'implementar',
          title: '[M1] Marco 1',
          labels: ['esteira:em-andamento:implementar', 'esteira:precisa-atencao'],
          pullRequest: { url: 'https://github.com/org/repo/pull/482', approved: false },
          description: 'DESCRICAO-QUE-NAO-DEVE-APARECER',
          comments: ['COMENTARIO-QUE-NAO-DEVE-APARECER'],
          checklist: ['CHECKLIST-QUE-NAO-DEVE-APARECER'],
        },
        [CARD_M2]: {
          column: 'plano',
          title: '[M2] Marco 2',
          labels: [],
          pullRequest: null,
        },
        // CA-12 — card FORA do discovery em foco: nunca é consultado nem
        // anotado (a lista pedida é a dos marcos desta árvore).
        'SZI-777': { column: 'backlog', title: 'CARD-FORA-DO-FOCO', labels: [] },
      },
    }),
  );

  // --- Config semeado no userData isolado ---------------------------------
  userDataDir = createIsolatedUserDataDir('dev-mode-espelho');
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
        // Já EM FOCO: este smoke é sobre o espelho, não sobre a porta de
        // entrada (essa é a Fatia 1, coberta por `dev-mode-conducao-mapa`).
        focusedDiscoveryId: CARD_DISCOVERY,
        archivedPhaseSessions: {},
        // "Tudo ou nada" (config-store.ts sanitizePhaseDefaultsTable): as 7
        // fases têm de estar presentes, senão cai no default inteiro.
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
    env: { ...process.env, DONEL_DEVMODE_BOARD_FIXTURE: boardFixturePath, DONEL_ESTEIRA_STATE_ROOT: stateRoot },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp?.close();
  if (userDataDir) removeIsolatedUserDataDir(userDataDir);
  // Limpeza best-effort: no Windows o `claude.exe` pode segurar o handle do
  // diretório por alguns ms depois do app fechar (EBUSY). Falhar a suíte por
  // um rmdir de fixture seria falso vermelho — o diretório é temp.
  for (const dir of [fixtureRepo, stateRoot]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignorado de propósito — ver comentário acima
    }
  }
});

test('Modo Dev — Fatia 2: espelho anota a árvore, avisa a trava, marca divergência e prepara a conciliação', async () => {
  test.setTimeout(240_000);
  const claudeBaseline = listPids('claude.exe');
  const diskBefore = fingerprint(fixtureRepo);
  const stateBefore = fingerprint(stateRoot);

  await window.locator('[data-testid="devmode-toggle"] input[role="switch"]').check();
  await expect(window.locator('[data-testid="devmode-map"]')).toBeVisible();

  // === T327/CA-12/Decisão B — as 4 etiquetas do card de plano =============
  // CA-17 — o testid usa o card_id real (não há mais marco_id no disco). M1
  // é `planCards[0]`: foco default, sem precisar clicar.
  const marcoM1 = window.locator(`[data-testid="devmode-map-plano-${CARD_M1}"]`);
  await expect(marcoM1).toHaveAttribute('data-focused', 'true');
  await expect(marcoM1).toContainText('board: implementar', { timeout: 30_000 });
  await expect(marcoM1).toContainText('esteira:precisa-atencao');
  // D1/Decisão B — a trava exibida é a ETIQUETA do board, com esse nome
  // literal (nunca "arquivo de trava").
  await expect(marcoM1).toContainText('trava: esteira:em-andamento:implementar');
  // Decisão B — a URL do PR e "PR sem aprovação" MORRERAM como etiqueta.
  await expect(marcoM1).not.toContainText('PR sem aprovação');
  await expect(marcoM1).not.toContainText('https://github.com/org/repo/pull/482');

  // === CA-12 (negativa) — o que o espelho NÃO mostra ======================
  const map = window.locator('[data-testid="devmode-map"]');
  await expect(map).not.toContainText('DESCRICAO-QUE-NAO-DEVE-APARECER');
  await expect(map).not.toContainText('COMENTARIO-QUE-NAO-DEVE-APARECER');
  await expect(map).not.toContainText('CHECKLIST-QUE-NAO-DEVE-APARECER');
  // Card fora do discovery em foco nunca entra na anotação.
  await expect(window.locator('body')).not.toContainText('CARD-FORA-DO-FOCO');

  // === Invariante 4/CA-5 — a ação da trava (foco atual) é SEMPRE clicável =
  await expect(window.locator(`[data-testid="devmode-map-plano-action-${CARD_M1}"]`)).toContainText('Liberar trava');
  await expect(window.locator(`[data-testid="devmode-map-plano-action-${CARD_M1}"]`)).toBeEnabled();

  // === T326/CA-13/CA-19 — divergência marcada × divergência ESPERADA filtrada ===
  const marcoM2 = window.locator(`[data-testid="devmode-map-plano-${CARD_M2}"]`);
  await expect(marcoM2).toContainText('⇄ disco: done · board: plano');
  // `implementar`/`validar` concluídas com o card ainda em `plano` são os
  // casos esperados na v3 (CA-19: Implementar não move; Validar nunca
  // moveu): só `plano` diverge — UMA etiqueta de divergência, não três.
  expect((await marcoM2.innerText()).match(/⇄ disco/g)?.length).toBe(1);

  // === T328/Decisão B — a ação de conciliar mora NA ETIQUETA, sem passo
  // intermediário (o card em foco já mostra "⇄ Preparar conciliação"). Focar
  // M2 (clique no card, LevelCarousel move o foco no eixo X) e disparar. O
  // conteúdo rico do nó (artefatos, disco×board lado a lado) migrou pro
  // painel de 316px, que o lote 8 povoa — a regressão do `artifact_paths`
  // objeto (tela preta 28/07) continua coberta por unidade
  // (`tests/esteira-reader.test.ts`).
  await marcoM2.click();
  await expect(marcoM2).toHaveAttribute('data-focused', 'true');
  const conciliateAction = window.locator(`[data-testid="devmode-map-plano-action-${CARD_M2}"]`);
  await expect(conciliateAction).toContainText('Preparar conciliação');
  expect(newPids(claudeBaseline)).toHaveLength(0);

  // === T328 — a sessão de conciliação: texto ESCRITO, nada enviado ========
  await conciliateAction.click();

  const activePane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(activePane).toHaveCount(1);
  // Diálogo de confiança de pasta (tmpdir nunca é confiada): responde como
  // humano. É o ÚNICO Enter deste teste — e ele nunca cai sobre texto armado,
  // que só é escrito depois disto.
  await expect(async () => {
    const text = await activePane.innerText();
    if (text.includes('trust this folder') || text.includes('Do you trust')) {
      await activePane.click();
      await window.keyboard.press('Enter');
    }
    expect(text.toLowerCase()).toContain('claude code');
  }).toPass({ timeout: 90_000 });

  const armed = window.locator('[data-testid="devmode-armed"]');
  await expect(armed).toContainText('Conciliação de divergência no card SZI-902', { timeout: 60_000 });
  // Os DOIS fatos divergentes estão no texto preparado (CA-19: a fase que
  // diverge agora é `plano`, não mais `implementar` — ver comentário da
  // fixture do M2 acima).
  await expect(armed).toContainText('a fase plano está "done"');
  await expect(armed).toContainText('coluna "plano"');
  // O app não corrige o board — e diz isso no próprio prompt.
  await expect(armed).toContainText('não altere o board');

  // O texto está no PROMPT do CLI (escrito de verdade) e NÃO foi submetido.
  await expect(async () => {
    expect(await activePane.innerText()).toContain('Conciliação de divergência');
  }).toPass({ timeout: 30_000 });
  expect(await activePane.innerText()).not.toContain('Unknown slash command');

  // === T327/CA-16/D1 — "Liberar trava…" pré-digita, e não apaga nada ======
  // Focar M2 (acima) trouxe o M2 ao foco, e a trava é do M1: devolve o foco
  // clicando no CARD de M1 (a trilha só aparece no card focado — clicar uma
  // linha dela abriria sessão, então o clique aqui é fora da trilha).
  await marcoM1.click();
  await expect(marcoM1).toHaveAttribute('data-focused', 'true');
  await window.locator(`[data-testid="devmode-map-plano-action-${CARD_M1}"]`).click();
  const modal = window.locator('[role="dialog"]');
  await expect(modal).toBeVisible();
  // D1 — o texto fala em remover a ETIQUETA do board e NEGA explicitamente o
  // arquivo de trava (que era o erro do mockup: "só remove o arquivo").
  await expect(modal).toContainText('etiqueta');
  await expect(modal).toContainText('esteira:em-andamento:implementar');
  await expect(modal).toContainText('não há arquivo de trava');
  await expect(modal).not.toContainText('só remove o arquivo');

  await window.locator('[data-testid="devmode-confirm-release-lock"]').click();
  await expect(armed).toContainText(`/esteira-liberar ${CARD_M1}`, { timeout: 60_000 });
  await expect(async () => {
    expect(await activePane.innerText()).toContain(`/esteira-liberar ${CARD_M1}`);
  }).toPass({ timeout: 30_000 });
  // Não foi ENVIADO: o CLI nunca processou o comando.
  const paneText = await activePane.innerText();
  expect(paneText).not.toContain('Unknown slash command');
  expect(paneText).not.toContain('esteira-liberar: ');

  // Exatamente UMA sessão nasceu em todo o fluxo (a da conciliação): liberar
  // trava usa a aba em foco, e o nó divergente abriu artefato, não sessão.
  await expect(async () => {
    expect(newPids(claudeBaseline)).toHaveLength(1);
  }).toPass({ timeout: 30_000 });

  // === Invariante 5 — NADA foi escrito, nem em disco nem no board =========
  // O board deste teste É o arquivo de fixture: byte-idêntico depois de todo
  // o fluxo. (A garantia principal é estrutural: o tipo `BoardReadTool` não
  // admite nenhuma tool de escrita — este assert é a rede de segurança.)
  // Cobre os DOIS diretórios: o repo (`fixtureRepo`, onde mora o
  // `board-fixture.json`) e a raiz v3 do handoff (`stateRoot`, CA-4) — o app
  // só LÊ dos dois.
  expect(fingerprint(fixtureRepo)).toEqual(diskBefore);
  expect(fingerprint(stateRoot)).toEqual(stateBefore);
  // E nenhum arquivo de trava foi criado (D1: ele não existe).
  expect(Object.keys(fingerprint(stateRoot)).filter((file) => file.includes('.lock'))).toHaveLength(0);
});
