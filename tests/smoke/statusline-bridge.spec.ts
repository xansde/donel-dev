import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchIsolatedApp } from './helpers/launch';
import { seededUserDataDir } from './helpers/projectRoots';
import { openProjectClaudeTab, waitForClaudeBooted } from './helpers/ui';
import { removeIsolatedUserDataDir } from './userDataIsolation';

// Ponte da statusline — ponta a ponta com o `claude` falso: o app injeta o
// `statusLine` no `--settings` da sessão, o falso roda o comando com o JSON
// no stdin (como o CLI: shell, stdin, no início da sessão), o comando posta na
// ponte e o rodapé passa a mostrar o número OFICIAL:
//  - modelo/esforço do `model.id`/`effort.level` da statusline;
//  - medidor de contexto com os tokens e a JANELA ditos pelo CLI (200k aqui,
//    num modelo cuja tabela por id diria 1M — a prova de que a régua veio da
//    statusline, e não da inferência);
//  - cota da sessão (`rate_limits`) no rótulo de conta, com o motor inerte.
//
// Modo padrão: o userData isolado não tem statusline do usuário e o chat está
// ligado, e a ponte é injetada assim mesmo (o chat prova o turno pelo spinner,
// não pelas dicas do rodapé que a statusline esconde).

const RESETS_AT = Math.floor(Date.now() / 1000) + 3 * 3600;
const STATUS_LINE = {
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  effort: { level: 'max' },
  context_window: {
    total_input_tokens: 45_000,
    total_output_tokens: 900,
    context_window_size: 200_000,
    used_percentage: 23,
    remaining_percentage: 77,
    current_usage: { input_tokens: 1_000, output_tokens: 900, cache_creation_input_tokens: 4_000, cache_read_input_tokens: 40_000 },
  },
  cost: { total_cost_usd: 0.42, total_duration_ms: 1000, total_api_duration_ms: 500, total_lines_added: 3, total_lines_removed: 1 },
  rate_limits: { five_hour: { used_percentage: 23.4, resets_at: RESETS_AT }, seven_day: { used_percentage: 41.2, resets_at: RESETS_AT + 86400 } },
};

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = seededUserDataDir('statusline-bridge');
  ({ app: electronApp, window: appWindow } = await launchIsolatedApp({
    userDataDir,
    env: {
      ...process.env,
      DONEL_FAKE_CLAUDE_SCENARIO: JSON.stringify({ statusLine: STATUS_LINE }),
      DONEL_FAKE_CLAUDE_LOG: join(userDataDir, 'fake-claude-calls.jsonl'),
    },
  }));
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
  }
});

test('o rodapé usa a leitura oficial da statusline: modelo/esforço, contexto com a janela do CLI e cota da sessão @sessoes', async () => {
  test.setTimeout(180_000);
  await openProjectClaudeTab(appWindow);
  await waitForClaudeBooted(appWindow, { startTimeout: 30_000 });

  const statusBar = appWindow.locator('div:has(> [data-testid="statusbar-account"])');
  await expect(statusBar).toContainText('opus 5.5/max', { timeout: 20_000 });
  // 45.000 de min(300k, 200k) = 22,5% → 23%. A tabela por id daria 1M (régua 300k → 15%).
  await expect(statusBar.locator('[data-zone]')).toContainText('23% · 45k/200k');
  // Motor inerte no userData isolado: a cota que o CLI leu é a única conhecida.
  await expect(appWindow.getByTestId('statusbar-account')).toContainText('Sessão: conta do CLI · 41% usado');

  // O comando rodou de verdade e não imprimiu nada (a ponte responde vazio).
  const calls = readFileSync(join(userDataDir, 'fake-claude-calls.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { statusLine?: string; code?: number; stdout?: string });
  expect(calls.filter((c) => c.statusLine === 'ran')[0]).toMatchObject({ code: 0, stdout: '' });
});
