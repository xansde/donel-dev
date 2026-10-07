import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// T1323 (011-contas-e-provedores, etapa 3) — entrada FICTÍCIA classe A (sem
// rede real): sessão nasce com o env da entrada aplicado (via `pty:create`
// -> `providerRegistry.resolveLaunch`) e com `<userData>/providers/<id>/`
// criado e VAZIO (nada copiado de `~/.claude`, D4). O provider aqui nunca é
// usado pra falar com um endpoint de verdade — o smoke mata o PTY assim que
// confirma o resultado.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('providers-session-env');
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: APP_CWD });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
});

test('T1323 — sessão nasce com o env da entrada e config dir próprio, vazio', async () => {
  test.setTimeout(60_000);

  const created = await appWindow.evaluate(() =>
    window.donel.providers.upsert({
      label: 'Provider fictício de teste',
      class: 'A',
      env: { FAKE_ENDPOINT_URL: 'https://fixture.invalid' },
      secretEnvKeys: ['FAKE_AUTH_TOKEN'],
    }),
  );
  expect(created.kind).toBe('ok');
  if (created.kind !== 'ok') throw new Error('setup falhou');
  const providerId = created.id;

  const secretResult = await appWindow.evaluate((id) => window.donel.providers.setSecret(id, 'FAKE_AUTH_TOKEN', 'fixture-token-nao-real'), providerId);
  expect(secretResult).toEqual({ kind: 'ok' });

  const list = await appWindow.evaluate(() => window.donel.providers.list());
  const summary = list.find((p) => p.id === providerId);
  expect(summary?.secretsStatus).toBe('configured');

  const result = await appWindow.evaluate(
    ({ id }) => window.donel.pty.create({ cols: 80, rows: 24, sessionType: 'claude', providerId: id }),
    { id: providerId },
  );
  expect(result.provider).toEqual({ id: providerId, label: 'Provider fictício de teste' });

  const providerConfigDir = path.join(userDataDir, 'providers', providerId);
  expect(existsSync(providerConfigDir)).toBe(true);
  expect(readdirSync(providerConfigDir)).toEqual([]); // vazio — nada copiado de ~/.claude (D4).

  await appWindow.evaluate((ptyId) => window.donel.pty.kill(ptyId), result.ptyId);
});
