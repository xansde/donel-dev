import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';

// T1324b (011-contas-e-provedores, etapa 3, C20/D5) — entrada `class: 'B'`
// (aceita e persistida pelo registry — D5, "estrutura sim, execução não") é
// listada como não suportada e o lançamento é RECUSADO com mensagem, nunca
// silêncio. Não há UI de criação de classe B (T1321) — esta entrada é
// escrita via `providers:upsert` direto (o próprio contrato aceita `class:
// 'B'`; só a UI não oferece o formulário), simulando o "config.json editado
// à mão" que o contrato também cobre.


let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ name: 'providers-class-b-refused' }));
});

test.afterAll(async () => {
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('T1324b — classe B é listada como não suportada e o lançamento é recusado com mensagem @provedores', async () => {
  test.setTimeout(60_000);

  const created = await appWindow.evaluate(() =>
    window.donel.providers.upsert({ label: 'CLI terceiro (classe B)', class: 'B', command: 'algum-cli-terceiro', env: {}, secretEnvKeys: [] }),
  );
  expect(created.kind).toBe('ok');
  if (created.kind !== 'ok') throw new Error('setup falhou');
  const providerId = created.id;

  const list = await appWindow.evaluate(() => window.donel.providers.list());
  const summary = list.find((p) => p.id === providerId);
  expect(summary?.supported).toBe(false);

  let rejection: unknown = null;
  try {
    await appWindow.evaluate(({ id }) => window.donel.pty.create({ cols: 80, rows: 24, sessionType: 'claude', providerId: id }), { id: providerId });
  } catch (error) {
    rejection = error;
  }
  expect(rejection).not.toBeNull();
  expect(String(rejection)).toMatch(/não suportado|classe b/i);
});
