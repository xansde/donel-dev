import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchIsolatedApp } from './helpers/launch';
import { PROJECT_NAME, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// CA-23 (009-modo-dev-v3, lote 3) — smoke da engrenagem de configuração por
// projeto: abre a tela de Sessões anteriores, abre o painel, preenche board
// (workspaceId/teamId) + repo GitHub, salva, reinicia o app inteiro e prova
// que os valores persistiram — E que os arquivos externos
// (`~/.claude/esteira-config/donel-board-credential.json` e `repos.json`)
// preservam qualquer campo desconhecido (token/baseUrl/outros repos), nunca
// são substituídos por inteiro.
//
// FIX (rodada de feedback 30/07, item 1) — "board é POR PROJETO agora": o
// formulário unificado (`ProjectConfigForm.tsx`) grava board+repo(s) NUM SÓ
// arquivo, `repos.json` (`repos.<repoSlug>.{github,github_extra,board}`);
// `donel-board-credential.json` deixa de ser ESCRITO por este caminho — só
// continua existindo intocado como fixture (prova de que nada nele foi
// tocado). "Repositório GitHub" virou uma LISTA editável (adicionar/remover,
// item 1) — este smoke cobre 1 repo só (o caminho de vários repos tem sua
// própria cobertura em tests/projectBinding.test.ts/esteira-config.test.ts).
//
// Isolado do `~/.claude/esteira-config` REAL da máquina via
// `DONEL_ESTEIRA_CONFIG_DIR` (mesmo espírito de `DONEL_ESTEIRA_STATE_ROOT`/
// `DONEL_DEVMODE_BOARD_FIXTURE`, ver dev-mode-espelho.spec.ts) e do
// `%APPDATA%` real via `--user-data-dir` (userDataIsolation.ts) — nenhuma
// escrita neste smoke toca a máquina real do Alexandre.

const FAKE_TOKEN = 'sk_smoke_never_shown_or_overwritten_1234567890';

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
let configDir: string;
let boardCredentialFile: string;
let reposConfigFile: string;

function boardCredentialOnDisk(): Record<string, unknown> {
  return JSON.parse(readFileSync(boardCredentialFile, 'utf8'));
}

function reposConfigOnDisk(): Record<string, unknown> {
  return JSON.parse(readFileSync(reposConfigFile, 'utf8'));
}

async function launchApp(): Promise<void> {
  ({ app: electronApp, window: window } = await launchIsolatedApp({ userDataDir, env: { ...process.env, DONEL_ESTEIRA_CONFIG_DIR: configDir } }));
}

// Item 11 (rodada de forma fix/009-board-real-e-modal) — a tela deixou de
// ser um `Modal` (role="dialog") e virou uma TELA no grid do `.shell`
// (`role="region"`, mesmo `aria-label` de antes — só o role mudou).
//
// FIX (item 1, rodada de feedback do teste de 30/07) — o botão "Sessões
// anteriores de X" morava numa linha da árvore "Projetos" da sidebar
// (removida); migrou pro popover "Projetos" do seletor no titlebar.
async function openSettingsPanel(): Promise<import('@playwright/test').Locator> {
  await window.getByRole('button', { name: 'Trocar de projeto' }).click();
  const projectsPopover = window.getByRole('dialog', { name: 'Projetos' });
  await expect(projectsPopover).toBeVisible();

  const historyButton = projectsPopover.getByRole('button', { name: `Sessões anteriores de ${PROJECT_NAME}`, exact: true });
  await expect(historyButton).toBeVisible({ timeout: 15_000 });
  await historyButton.click();

  const dialog = window.getByRole('region', { name: new RegExp(`Sessões anteriores · ${PROJECT_NAME}`) });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Configuração do projeto' }).click();
  const panel = dialog.locator('[data-testid="project-settings-panel"]');
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('project-config');
  configDir = mkdtempSync(join(tmpdir(), 'donel-smoke-esteira-config-'));
  boardCredentialFile = join(configDir, 'donel-board-credential.json');
  reposConfigFile = join(configDir, 'repos.json');

  // Fixture PRÉ-EXISTENTE, como se um humano/skill já tivesse editado os
  // arquivos à mão fora do app: token de serviço + outro repo já cadastrado —
  // o que este smoke prova é que a engrenagem NUNCA pisa nesses campos.
  writeFileSync(
    boardCredentialFile,
    JSON.stringify({ baseUrl: 'https://taskdex.example/api/mcp', token: FAKE_TOKEN, _comentario: 'fixture do smoke' }, null, 2),
    'utf8',
  );
  writeFileSync(
    reposConfigFile,
    JSON.stringify(
      {
        default_repo: 'C:/nao/importa/pro/smoke',
        repos: { 'outro-repo-ja-cadastrado': 'C:/outro/path' },
        round_limit_by_board: { SPOTSYSMAR: 3 },
      },
      null,
      2,
    ),
    'utf8',
  );

  await launchApp();
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('CA-23 — engrenagem lê vazio na 1ª vez, grava board+repo (num só repos.json), persiste a restart e preserva campos desconhecidos @projetos', async () => {
  test.setTimeout(120_000);

  // 1. Projeto ainda não tem entrada em repos.json — os campos nascem vazios (degradação por omissão, C4).
  const panel = await openSettingsPanel();
  await expect(panel.getByLabel('Workspace ID do board de tarefas')).toHaveValue('');
  await expect(panel.getByLabel('Team ID do board de tarefas')).toHaveValue('');
  await expect(panel.getByText('Nenhum repositório configurado.')).toBeVisible();

  // O token de serviço nunca aparece em lugar nenhum da UI.
  expect(await window.content()).not.toContain(FAKE_TOKEN);

  // 2. Preenche board + adiciona 1 repo (item 1 — lista editável), salva.
  await panel.getByLabel('Workspace ID do board de tarefas').fill('ws-smoke-test');
  await panel.getByLabel('Team ID do board de tarefas').fill('team-smoke-test');
  await panel.getByLabel('Novo repositório GitHub').fill('seazone-tech/smoke-fixture-repo');
  await panel.getByRole('button', { name: 'Adicionar' }).click();
  await expect(panel.getByText('seazone-tech/smoke-fixture-repo')).toBeVisible();
  await panel.getByRole('button', { name: 'Salvar' }).click();
  await expect(panel).toBeHidden();

  // 3. Confirma no ARQUIVO real — merge, não substituição. Board é POR
  //    PROJETO agora (repos.json), NUNCA escrito na credencial global.
  await expect(async () => {
    const board = boardCredentialOnDisk();
    expect(board.workspaceId).toBeUndefined(); // nunca escrito por este caminho
    expect(board.teamId).toBeUndefined();
    expect(board.token).toBe(FAKE_TOKEN); // preservado, intocado
    expect(board.baseUrl).toBe('https://taskdex.example/api/mcp'); // preservado, intocado
    expect(board._comentario).toBe('fixture do smoke'); // preservado, intocado

    const repos = reposConfigOnDisk() as { default_repo: string; repos: Record<string, unknown>; round_limit_by_board: unknown };
    expect(repos.default_repo).toBe('C:/nao/importa/pro/smoke'); // preservado
    expect(repos.round_limit_by_board).toEqual({ SPOTSYSMAR: 3 }); // preservado
    expect(repos.repos['outro-repo-ja-cadastrado']).toBe('C:/outro/path'); // preservado
    expect(repos.repos[PROJECT_NAME]).toEqual({
      path: REPO_ROOT,
      github: 'seazone-tech/smoke-fixture-repo',
      board: { workspaceId: 'ws-smoke-test', teamId: 'team-smoke-test' },
    });
  }).toPass({ timeout: 10_000 });

  // 4. Restart COMPLETO do app — mesmo requisito do config-persistence.spec.ts (T015 DoD).
  await electronApp.close();
  await launchApp();

  // 5. Reabre e confirma que a UI reflete o que persistiu.
  const panelAfterRestart = await openSettingsPanel();
  await expect(panelAfterRestart.getByLabel('Workspace ID do board de tarefas')).toHaveValue('ws-smoke-test');
  await expect(panelAfterRestart.getByLabel('Team ID do board de tarefas')).toHaveValue('team-smoke-test');
  await expect(panelAfterRestart.getByText('seazone-tech/smoke-fixture-repo')).toBeVisible();
  expect(await window.content()).not.toContain(FAKE_TOKEN);

  await panelAfterRestart.getByRole('button', { name: 'Cancelar' }).click();
  await expect(panelAfterRestart).toBeHidden();
});
