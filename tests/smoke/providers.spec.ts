import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { assertNoLeak as assertNoLeakOf } from './helpers/leaks';

// REVISÃO DE TESTES (08/10): fusão de providers-inert, providers-class-b-refused,
// providers-session-env, providers-secret-never-leaks e modal-focus-steal em UM
// arquivo / UMA abertura do app (userData isolado, nunca o %APPDATA% real).
//
// Estado entre testes: os dois primeiros (T1322) exigem o registry VAZIO, por
// isso rodam primeiro; o `afterEach` remove todo provedor criado, então cada
// teste seguinte também começa com o registry vazio. O modal-focus-steal vai por
// último porque deixa o painel de Provedores aberto.
//
// Origem de cada bloco:
// - T1322 (D6/C14): registry vazio — launcher sem o campo "Provedor" e uma sessão
//   claude nasce com o mesmo env/config dir de hoje (`pty:create` sem `providerId`
//   nunca devolve `provider`).
// - T1324b (C20/D5): entrada `class: 'B'` (aceita e persistida, "estrutura sim,
//   execução não") é listada como não suportada e o lançamento é RECUSADO com
//   mensagem. Escrita via `providers:upsert` direto, simulando config.json
//   editado à mão.
// - T1323: entrada FICTÍCIA classe A — sessão nasce com o env da entrada e com
//   `<userData>/providers/<id>/` criado e VAZIO (nada copiado de ~/.claude, D4).
//   Sem rede real; o PTY é morto logo após confirmar o resultado.
// - T1324a: varredura de TODOS os payloads dos PROVIDER_CHANNELS, do `config:get`
//   e do `pty:create` atrás do segredo PLANTADO. Nenhum hit, nem truncado.
// - modal-focus-steal (teste manual da T1325, 2026-08-04): digitar em campo do
//   painel "Provedores" roubava o foco para o "Nome" (o efeito de foco do Modal
//   dependia de `onClose`, recriado a cada render). Contrato: foco inicial UMA
//   vez por abertura; re-render nunca move o foco.

const PLANTED_SECRET = 'PLANTED-PROVIDER-SECRET-q7m4k1-nunca-deve-vazar';

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

const assertNoLeak = (payload: unknown): void => assertNoLeakOf(payload, PLANTED_SECRET);

test.beforeAll(async () => {
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ name: 'providers' }));
});

test.afterAll(async () => {
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

// Explicit reset between tests: whatever the previous test registered is removed.
test.afterEach(async () => {
  await appWindow.evaluate(async () => {
    for (const provider of await window.donel.providers.list()) await window.donel.providers.remove(provider.id);
  });
});

test('T1322 — providers:list devolve [] num app novo (registry inerte por default) @provedores', async () => {
  const list = await appWindow.evaluate(() => window.donel.providers.list());
  expect(list).toEqual([]);
});

test('T1322 — Launcher não mostra o campo "Provedor" com registry vazio @provedores', async () => {
  const trigger = appWindow.locator('button', { hasText: '＋ Nova sessão' }).first();
  if (await trigger.count()) await trigger.click();
  await expect(appWindow.locator('[data-testid="provider-picker"]')).toHaveCount(0);
});

test('T1322 — pty:create sem providerId nunca devolve `provider` no resultado (comportamento de hoje) @provedores', async () => {
  test.setTimeout(60_000);
  const result = await appWindow.evaluate(() => window.donel.pty.create({ cols: 80, rows: 24, sessionType: 'claude' }));
  expect(result.provider).toBeUndefined();
  await appWindow.evaluate((ptyId) => window.donel.pty.kill(ptyId), result.ptyId);
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

test('T1323 — sessão nasce com o env da entrada e config dir próprio, vazio @provedores', async () => {
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

// Last on purpose: leaves the Providers panel open.
test('digitar num campo do painel Provedores não move o foco para o campo Nome @provedores', async () => {
  await appWindow.click('[data-testid="providers-panel-trigger"]');
  await appWindow.waitForSelector('[data-testid="providers-panel"]');

  const envInput = appWindow.locator('[data-testid="provider-env-input"]');
  await envInput.click();
  await appWindow.keyboard.type('ANTHROPIC_BASE_URL=https://exemplo.invalido/api', { delay: 15 });

  // Com o bug, a primeira tecla re-rodava o efeito de foco do Modal e as teclas
  // seguintes caíam no TextInput "Nome": o textarea ficava com 1 caractere e o foco em outro lugar.
  await expect(envInput).toBeFocused();
  await expect(envInput).toHaveValue('ANTHROPIC_BASE_URL=https://exemplo.invalido/api');
});
