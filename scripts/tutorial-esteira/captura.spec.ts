import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test';

// Captura os prints do tutorial da Esteira nova (spec 010). NÃO é teste de
// regressão: é um roteiro que dirige o app buildado e fotografa cada passo,
// com um anel destacando o alvo do clique.
//
// Roda ISOLADO do estado real: `--user-data-dir` temporário e
// `DONEL_ESTEIRA_{STORE,INBOX,OUTBOX}_DIR` em tmpdir. Nada do que acontece aqui
// toca o histórico de verdade da máquina.
//
//   npx playwright test -c scripts/tutorial-esteira/playwright.config.ts
//
// Os PNGs saem em `--output-dir` (default: `.tutorial-shots/` na raiz do repo).

const REPO_ROOT = path.resolve(__dirname, '../..');
const APP_MAIN = path.join(REPO_ROOT, 'out', 'main', 'index.js');
const SHOTS_DIR = process.env.TUTORIAL_SHOTS_DIR ?? path.join(REPO_ROOT, '.tutorial-shots');

let app: ElectronApplication;
let win: Page;
let userDataDir: string;
let esteiraRoot: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(os.tmpdir(), 'donel-tutorial-ud-'));
  esteiraRoot = mkdtempSync(path.join(os.tmpdir(), 'donel-tutorial-esteira-'));
  mkdirSync(path.join(esteiraRoot, 'inbox'), { recursive: true });
  mkdirSync(path.join(esteiraRoot, 'outbox'), { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });

  app = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      DONEL_ESTEIRA_STORE_DIR: path.join(esteiraRoot, 'store'),
      DONEL_ESTEIRA_INBOX_DIR: path.join(esteiraRoot, 'inbox'),
      DONEL_ESTEIRA_OUTBOX_DIR: path.join(esteiraRoot, 'outbox'),
    },
  });

  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.setViewportSize({ width: 1400, height: 860 });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(esteiraRoot, { recursive: true, force: true });
});

/**
 * Desenha o anel sobre o elemento e fotografa. O anel é um elemento REAL no
 * DOM (posicionado pelo bounding box), não uma anotação posterior na imagem —
 * assim ele acompanha o layout de verdade, em vez de chutar coordenadas.
 */
async function shot(name: string, locator: ReturnType<Page['locator']> | null): Promise<void> {
  if (locator !== null) {
    const box = await locator.first().boundingBox();
    if (box === null) throw new Error(`sem bounding box para o passo ${name}`);
    await win.evaluate(
      ({ x, y, width, height }) => {
        const ring = document.createElement('div');
        ring.id = '__tutorial_ring__';
        Object.assign(ring.style, {
          position: 'fixed',
          left: `${x - 10}px`,
          top: `${y - 10}px`,
          width: `${width + 20}px`,
          height: `${height + 20}px`,
          border: '3px solid #f0684c',
          borderRadius: `${Math.min(width, height) > 60 ? 12 : 999}px`,
          boxShadow: '0 0 0 4px rgba(240,104,76,0.22), 0 0 22px rgba(240,104,76,0.5)',
          pointerEvents: 'none',
          zIndex: '9999',
        });
        document.body.appendChild(ring);
      },
      { x: box.x, y: box.y, width: box.width, height: box.height },
    );
  }

  await win.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
  await win.evaluate(() => document.getElementById('__tutorial_ring__')?.remove());
}

test('captura os passos do tutorial', async () => {
  test.setTimeout(180_000);

  // ── 1. Ligar o Modo Dev ────────────────────────────────────────────────
  const devToggle = win.getByTestId('devmode-toggle');
  await devToggle.waitFor({ timeout: 30_000 });
  await shot('01-ligar-modo-dev', devToggle);
  await devToggle.getByText('Dev', { exact: true }).click();

  // Ligar o Modo Dev abre sozinho a porta de entrada do modelo ANTIGO (modal
  // "Abrir discovery"). Ela cobre a tela nova e — pior para um tutorial —
  // mostra os cards reais do board. Fecha antes de fotografar qualquer coisa.
  await win.keyboard.press('Escape');
  await win.locator('div[class*="overlay"]').first().waitFor({ state: 'hidden', timeout: 10_000 });

  // ── 2. Abrir a Esteira ─────────────────────────────────────────────────
  const esteiraToggle = win.getByTestId('esteira-toggle');
  await esteiraToggle.waitFor({ timeout: 15_000 });
  await shot('02-abrir-esteira', esteiraToggle);
  await esteiraToggle.click();

  const screen = win.locator('section[aria-label="Esteira"]');
  await screen.waitFor({ timeout: 15_000 });
  await shot('03-tela-vazia', null);

  // ── 3. Criar o card ────────────────────────────────────────────────────
  const titulo = win.getByLabel('Novo discovery');
  await shot('04-campo-titulo', titulo);
  await titulo.fill('Fila de importação trava sem sinal');

  const repo = win.getByLabel('Repo alvo (opcional)');
  await repo.fill('donel-dev');
  await shot('05-campos-preenchidos', repo);

  const criar = win.getByRole('button', { name: 'Criar' });
  await shot('06-botao-criar', criar);
  await criar.click();

  await win.locator('button', { hasText: 'Fila de importação trava sem sinal' }).first().waitFor({ timeout: 10_000 });
  await shot('07-card-criado', win.locator('button', { hasText: 'Fila de importação trava sem sinal' }).first());

  // ── 4. Preparar a fase ─────────────────────────────────────────────────
  const preparar = win.getByRole('button', { name: 'Preparar' });
  await shot('08-botao-preparar', preparar);
  await preparar.click();

  await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });
  await shot('09-fase-preparada', win.locator('code').first());

  const copiar = win.getByRole('button', { name: 'Copiar comando' });
  await shot('10-copiar-comando', copiar);

  // ── 5. A skill responde (emissor real, contra o inbox isolado) ──────────
  const emitted = await emitResultForLastInput();
  const varrer = win.getByRole('button', { name: 'Varrer outbox' });
  await shot('11-varrer-outbox', varrer);
  await varrer.click();
  await win.getByText('Planejado').first().waitFor({ timeout: 10_000 });
  await shot('12-card-atualizado', win.locator('button', { hasText: 'Fila de importação trava sem sinal' }).first());
  test.info().annotations.push({ type: 'emitido', description: emitted });

  // ── 6. O documento fora do contrato ────────────────────────────────────
  writeFileSync(
    path.join(esteiraRoot, 'outbox', 'quebrado.json'),
    JSON.stringify({
      contract_version: '1.0.0',
      kind: 'esteira.result',
      run: {
        run_id: 'run-quebrado',
        phase: 'discovery',
        status: 'success',
        started_at: '2026-08-04T12:00:00.000Z',
        finished_at: '2026-08-04T12:10:00.000Z',
        failure: null,
      },
      actor: { tool: 'esteira-donel', tool_version: '2.1.0' },
      subject: { discovery_id: await currentDiscoveryId() },
      facts: [
        { type: 'discovery.recorded', discovery_id: await currentDiscoveryId(), title: 'Card', fanout_cards: ['card-1'] },
        { type: 'phase.completed', subject: { entity: 'discovery', id: await currentDiscoveryId() }, phase: 'discovery', outcome: 'done' },
      ],
    }),
    'utf8',
  );

  await varrer.click();
  await win.getByText('não consegui ler').first().waitFor({ timeout: 10_000 });
  await shot('13-erro-de-leitura', win.getByText('não consegui ler').first());
  await shot('14-erro-detalhe', win.locator('section', { hasText: 'Não consegui ler' }).last());
});

/** O id do discovery em foco, lido do `run-input.json` que o disparo gravou. */
async function currentDiscoveryId(): Promise<string> {
  const { readdirSync, readFileSync } = await import('node:fs');
  const inbox = path.join(esteiraRoot, 'inbox');
  const file = readdirSync(inbox).filter((name) => name.endsWith('.json')).sort().pop();
  if (file === undefined) throw new Error('nenhum run-input no inbox');
  return JSON.parse(readFileSync(path.join(inbox, file), 'utf8')).subject.discovery_id;
}

/** Roda o emissor REAL da skill contra o último `run-input.json` — sem dublê. */
async function emitResultForLastInput(): Promise<string> {
  const { execFileSync } = await import('node:child_process');
  const { readdirSync, readFileSync } = await import('node:fs');
  const inbox = path.join(esteiraRoot, 'inbox');
  const file = readdirSync(inbox).filter((name) => name.endsWith('.json')).sort().pop();
  if (file === undefined) throw new Error('nenhum run-input no inbox');

  const input = JSON.parse(readFileSync(path.join(inbox, file), 'utf8'));
  const discoveryId = input.subject.discovery_id;
  const factsPath = path.join(esteiraRoot, 'facts.json');
  writeFileSync(
    factsPath,
    JSON.stringify([
      {
        type: 'discovery.recorded',
        discovery_id: discoveryId,
        // MESMO texto digitado na tela: `discovery.created` faz upsert, e um
        // título diferente aqui RENOMEIA o card no meio do tutorial.
        title: 'Fila de importação trava sem sinal',
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        target_repo: 'donel-dev',
        scope_repos: ['donel-dev'],
      },
      {
        type: 'plan.recorded',
        plan_id: 'pln-tutorial-01',
        discovery_id: discoveryId,
        title: 'Tornar o estado da fila observável',
        summary: 'Instrumentar a fila antes de mexer no consumo.',
      },
      {
        type: 'relation.recorded',
        relation: 'originated',
        from: { entity: 'discovery', id: discoveryId },
        to: { entity: 'plan', id: 'pln-tutorial-01' },
      },
      {
        type: 'note.recorded',
        subject: { entity: 'discovery', id: discoveryId },
        text: 'Duas hipóteses descartadas: timeout do worker e limite de conexão.',
      },
      {
        type: 'phase.completed',
        subject: { entity: 'discovery', id: discoveryId },
        phase: 'discovery',
        outcome: 'done',
        summary: 'Um plano proposto.',
      },
    ]),
    'utf8',
  );

  return execFileSync(
    'python',
    ['emit_result.py', '--input', path.join(inbox, file), '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high'],
    { cwd: path.join(REPO_ROOT, 'skills', 'esteira-donel-3.0.0', 'tools'), encoding: 'utf8' },
  ).trim();
}
