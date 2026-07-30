import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { APP_MAIN, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Rodada de feedback 30/07, item 1 — o dono reportou "reiniciar uma sessão
// travou com um erro javascript". `restart-session.spec.ts` já prova o
// caminho feliz (Uso geral, sessão madura); este smoke prova a BORDA mais
// plausível apontada na investigação e que não tinha cobertura nenhuma: o
// botão "⟳ Reiniciar" (App.tsx `sessionHeader`) TAMBÉM aparece no Modo Dev
// (`(devModeOn ? selectedPhaseDetails !== null : tabs.length > 0)`), e lá
// pode ser clicado sobre uma sessão RECÉM-NASCIDA — aba criada por "⌁
// Preparar" (armPhaseCommands) com o comando ainda ARMADO, nunca enviado, o
// transcript `.jsonl` mal existe no disco ainda. `confirmRestart`
// (App.tsx) foi reforçado com try/catch (degradação — nunca exceção não
// tratada num handler de evento, que derruba a árvore React inteira) como
// rede de segurança; este smoke prova que o app segue de pé no cenário mais
// realista de "sessão recém-nascida sem transcript" do handoff.
const CARD_DISCOVERY = 'SZI-900';
const CARD_M1 = 'SZI-901';

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
let fixtureRepo: string;
let stateRoot: string;
let repoSlug: string;
let worktreeDir: string;
let worktreeDeclared: string;
let boardFixturePath: string;
const pageErrors: string[] = [];

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}
function ctxPath(fase: string, cardId: string): string {
  return path.join(stateRoot, repoSlug, cardId, fase, `${cardId}-ctx.md`);
}
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

test.beforeAll(async () => {
  fixtureRepo = mkdtempSync(path.join(os.tmpdir(), 'restart-devmode-'));
  stateRoot = mkdtempSync(path.join(os.tmpdir(), 'restart-devmode-state-'));
  repoSlug = path.basename(fixtureRepo);
  worktreeDir = mkdtempSync(path.join(os.tmpdir(), 'restart-devmode-wt-'));
  worktreeDeclared = worktreeDir.split(path.sep).join('/');

  write(ctxPath('discovery', CARD_DISCOVERY), '---\ncard_id: SZI-900\n---\n\n# ctx\n');
  write(
    resultPath('discovery', CARD_DISCOVERY),
    manifest(CARD_DISCOVERY, 'discovery', 'success', { summary: 'discovery ok', plan_cards: [{ card_id: CARD_M1, track: 'codigo', shadow: false }] }),
  );
  write(ctxPath('plano', CARD_M1), '---\ncard_id: SZI-901\n---\n\n# ctx do plano\n');
  write(
    resultPath('plano', CARD_M1),
    manifest(CARD_M1, 'plano', 'success', {
      summary: 'plano ok',
      artifact_paths: ['specs/003/spec.md'],
      fases: [{ fase_num: 1, titulo: 'Implementação única', garantia: { tipo: 'roteiro_e2e', descricao: 'x', roteiro_path: 'specs/003/e2e.md' } }],
    }),
  );
  write(ctxPath('implementar', CARD_M1), `---\ncard_id: ${CARD_M1}\nworktree_path: ${worktreeDeclared}\nbranch: feature/szi-901\n---\n\n# ctx\n`);

  boardFixturePath = path.join(fixtureRepo, 'board-fixture.json');
  write(
    boardFixturePath,
    JSON.stringify([
      { cardId: CARD_DISCOVERY, column: 'discovery', title: 'Frente grande' },
      { cardId: CARD_M1, column: 'plano', title: 'Marco 1' },
    ]),
  );

  userDataDir = createIsolatedUserDataDir('restart-devmode');
  const phaseEntry = (commandTemplate: string, opensOwnSession: boolean) => ({ model: 'haiku', effort: 'low', commandTemplate, opensOwnSession });
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
        discoveries: { [CARD_DISCOVERY]: { cardId: CARD_DISCOVERY, repoPath: fixtureRepo, epicId: null, openedAt: 1, closedAt: null } },
        focusedDiscoveryId: null,
        archivedPhaseSessions: {},
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
  // Prova direta de "não travou com erro javascript": qualquer exceção não
  // tratada no renderer vira `pageerror` — o gate deste smoke É essa lista
  // continuar vazia depois do reinício.
  window.on('pageerror', (err) => pageErrors.push(`${err.message}\n${err.stack ?? ''}`));
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await electronApp?.close();
  } finally {
    if (userDataDir) removeIsolatedUserDataDir(userDataDir);
    for (const dir of [fixtureRepo, stateRoot, worktreeDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort — mesmo espírito de dev-mode-conducao-mapa.spec.ts (EBUSY do Windows em cwd de worktree).
      }
    }
  }
});

test('Modo Dev — "⟳ Reiniciar" sobre sessão recém-armada (comando não enviado) não derruba o app', async () => {
  test.setTimeout(180_000);

  await window.locator('[data-testid="devmode-toggle"]').getByRole('radio', { name: 'Dev' }).click();
  await expect(window.locator('[data-testid="devmode-entry"]')).toBeVisible({ timeout: 15_000 });
  await window.locator(`[data-testid="devmode-entry-card-${CARD_DISCOVERY}"] button`).click();
  await expect(window.locator('[data-testid="devmode-map"]')).toBeVisible({ timeout: 15_000 });

  // "⌁ Preparar" na única etapa elegível (discovery, card recém-focado) — a
  // aba nasce com o comando ARMADO, nunca enviado (mesmo espírito de
  // dev-mode-conducao-mapa.spec.ts — nenhum Enter, nenhuma cota gasta).
  const prepareBtn = window.locator('[data-testid^="devmode-trilha-prepare-"]').first();
  await expect(prepareBtn).toBeVisible({ timeout: 15_000 });
  await prepareBtn.click();

  const pane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    const text = await pane.innerText();
    expect(text.length).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000 });

  await expect(async () => {
    const text = await pane.innerText();
    if (text.includes('trust this folder') || text.includes('Do you trust')) {
      await pane.click();
      await window.keyboard.press('Enter');
    }
    expect(text.toLowerCase()).toContain('claude code');
  }).toPass({ timeout: 60_000 });

  // O botão "⟳ Reiniciar" mora no header de 44px também no Modo Dev
  // (App.tsx `sessionHeader`, condição `devModeOn ? selectedPhaseDetails !== null : ...`).
  const restartButton = window.locator('[data-testid="restart-session-button"]');
  await expect(restartButton).toBeVisible({ timeout: 30_000 });
  await restartButton.click();

  const modal = window.getByRole('dialog', { name: 'Reiniciar sessão em foco?' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '⟳ Reiniciar' }).click();

  // O mapa/header do Modo Dev continua respondendo — nenhuma exceção
  // desmontou a árvore (o teste falharia mais cedo, num `pageerror`, se
  // tivesse desmontado).
  await expect(window.locator('[data-testid="devmode-map"]')).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    expect(pageErrors, `erros JS não tratados no renderer:\n${pageErrors.join('\n---\n')}`).toHaveLength(0);
  }).toPass({ timeout: 5_000 });
});
