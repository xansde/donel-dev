import { expect, test } from '@playwright/test';
import { assertNoLeak as assertNoLeakOf } from './helpers/leaks';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';

// T1324a (011-contas-e-provedores, etapa 3) — varredura de TODOS os payloads
// dos `PROVIDER_CHANNELS` (list/upsert/setSecret/remove), do `config:get` e
// do `pty:create` procurando o segredo PLANTADO no cofre de teste. Nenhum
// hit, nem truncado. Mesmo padrão de `accounts-secret-never-leaks.spec.ts`
// (T1128).

const PLANTED_SECRET = 'PLANTED-PROVIDER-SECRET-q7m4k1-nunca-deve-vazar';

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

const assertNoLeak = (payload: unknown): void => assertNoLeakOf(payload, PLANTED_SECRET);

test.beforeAll(async () => {
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ name: 'providers-secret-never-leaks' }));
});

test.afterAll(async () => {
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('T1324a — segredo plantado nunca aparece em list/upsert/setSecret/remove/config:get/pty:create nem no DOM @provedores', async () => {
  test.setTimeout(60_000);

  const created = await appWindow.evaluate(() =>
    window.donel.providers.upsert({ label: 'Provider com segredo plantado', class: 'A', env: {}, secretEnvKeys: ['FAKE_AUTH_TOKEN'] }),
  );
  expect(created.kind).toBe('ok');
  if (created.kind !== 'ok') throw new Error('setup falhou');
  const providerId = created.id;
  assertNoLeak(created);

  const secretResult = await appWindow.evaluate(({ id, secret }) => window.donel.providers.setSecret(id, 'FAKE_AUTH_TOKEN', secret), {
    id: providerId,
    secret: PLANTED_SECRET,
  });
  expect(secretResult).toEqual({ kind: 'ok' });
  assertNoLeak(secretResult);

  const list = await appWindow.evaluate(() => window.donel.providers.list());
  assertNoLeak(list);

  const configView = await appWindow.evaluate(() => window.donel.config.get());
  assertNoLeak(configView);

  const ptyResult = await appWindow.evaluate(({ id }) => window.donel.pty.create({ cols: 80, rows: 24, sessionType: 'claude', providerId: id }), {
    id: providerId,
  });
  assertNoLeak(ptyResult);
  await appWindow.evaluate((ptyId) => window.donel.pty.kill(ptyId), ptyResult.ptyId);

  const afterRemove = await appWindow.evaluate((id) => window.donel.providers.remove(id), providerId);
  assertNoLeak(afterRemove);

  // O DOM inteiro nunca contém o segredo digitado (write-only, C19).
  const bodyHtml = await appWindow.evaluate(() => document.body.innerHTML);
  expect(bodyHtml).not.toContain(PLANTED_SECRET);
});
