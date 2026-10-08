import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchIsolatedApp } from './helpers/launch';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';
import { median } from './statistics';

// T712 (007-favoritos-sessoes) — MEDIÇÃO OBRIGATÓRIA do CA-7: tempo do
// `domcontentloaded` até a sidebar pintada com o registro CHEIO (5 favoritos
// × 5 sessões recentes + 1 fixada cada = 30 linhas).
//
// DECISÃO DO ALEXANDRE, 2026-07-26: **desvio aceito**. O alvo original da spec
// era < 100 ms; a medição real deu 103–167 ms, e o diagnóstico mostrou que o
// custo é de BOOT PRÉ-EXISTENTE (bundle bloqueando o `domcontentloaded` +
// `config:get` e `projects:list` em dois `useEffect` sequenciais), não algo
// introduzido pela 007. Ele aceitou o número medido.
// Consequência para este teste: `CA7_TARGET_MS` deixa de ser ALVO e passa a ser
// CERCA DE REGRESSÃO — larga o suficiente (~1,5× o pior caso observado) para
// falhar só quando o boot piorar de verdade, e não por variação de carga da
// máquina. Se algum dia a otimização de boot entrar (§B20 do backlog), aperte
// esta cerca junto.
//
// G4 (batch n3) — MEDIANA DE N EXECUÇÕES, MANTENDO A CERCA. Achado: a cerca
// pegou uma regressão real que 1649 testes verdes não viram (prova de valor),
// mas uma ÚNICA amostra oscila 168–274 ms com a máquina sob carga (medido:
// 3 de 5 execuções abaixo da cerca de 250 ms, 2 acima só por variação de
// carga) — flaky vira "reroda até passar", que corrói o detector (ninguém
// confia mais no vermelho). Escolha (documentada aqui, não só no card): rodar
// `SAMPLE_COUNT` boots independentes e comparar a MEDIANA contra a cerca, em
// vez de alargar a cerca. Alargar a cerca perderia sensibilidade a uma
// regressão real e persistente; a mediana já resolve a flakiness sozinha —
// uma regressão de verdade desloca a DISTRIBUIÇÃO inteira pra cima (todas as
// amostras sobem), então a mediana também estoura a cerca; um pico isolado de
// carga da máquina (1–2 amostras altas em meio a várias normais) não desloca
// a mediana. Cada amostra é um boot INDEPENDENTE (Electron novo) — a medição
// é de boot fresco, então não dá pra reamostrar dentro da mesma janela sem
// medir outra coisa (repintura, não boot).
//
// Polling APERTADO (loop próprio abaixo, checando a cada round-trip do
// `locator.count()`), nunca `expect().toPass` — lição da 004
// (`specs/004-nomear-sessoes/medicao-t403.md`): o backoff exponencial do
// `toPass` do Playwright reportou 852 ms para algo que levava ~350 ms; o
// número medido era do AMOSTRADOR, não do app.
//
// O número em si é calculado inteiramente do lado do BROWSER
// (`performance.now()` − `domContentLoadedEventEnd`, os dois lidos na MESMA
// chamada de `evaluate`), pra não misturar o relógio do processo Node/
// Playwright com o do processo renderer — a única latência de fora que entra
// no número é o round-trip do `evaluate` final, inevitável em qualquer medição
// feita de fora do processo medido.

const RECENT_PER_PROJECT = 5;
const FAVORITES_COUNT = 5;
/** Cerca de regressão, não alvo (ver decisão de 26/07 no topo). Pior caso medido numa amostra isolada: 274 ms — a MEDIANA de N amostras fica bem abaixo disso (ver comentário G4). */
const CA7_REGRESSION_FENCE_MS = 250;
/** G4 — nº de boots independentes por medição. 5 é o tamanho da amostra do diagnóstico que motivou esta mudança (168–274 ms, 3 de 5 abaixo da cerca). */
const SAMPLE_COUNT = 5;

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

async function launchApp(): Promise<void> {
  ({ app: electronApp, window: appWindow } = await launchIsolatedApp({ userDataDir }));
}

/**
 * G4 — UM boot completo: abre o app (config já seedado no disco por quem
 * chama), faz polling apertado até a sidebar pintar o registro cheio, mede
 * (dentro do MESMO `evaluate`, ver comentário de topo) e fecha o app antes de
 * devolver — cada amostra é um processo Electron independente, igual a um
 * usuário fechando e reabrindo o app. Reusa o MESMO `userDataDir`/config.json
 * entre amostras (não recria a cada volta): a medição nunca chama nenhum IPC
 * que mute `appConfig` (só lê `projects.list`/pinta a sidebar), então não há
 * risco de uma amostra contaminar o config.json que a próxima vai ler.
 */
async function measureOneBoot(): Promise<number> {
  await launchApp();

  const rowsSelector = 'section[aria-label="Favoritos"] button[aria-pressed]';
  const expectedRows = FAVORITES_COUNT * (RECENT_PER_PROJECT + 1);
  const pollDeadlineMs = Date.now() + 10_000;
  let elapsedMs: number | null = null;
  let lastCount = 0;
  for (;;) {
    const result = await appWindow.evaluate(
      ({ selector, expectedRows }) => {
        const count = document.querySelectorAll(selector).length;
        if (count !== expectedRows) return { done: false, count };
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return { done: true, count, elapsedMs: performance.now() - nav.domContentLoadedEventEnd };
      },
      { selector: rowsSelector, expectedRows },
    );
    lastCount = result.count;
    if (result.done) {
      elapsedMs = result.elapsedMs!;
      break;
    }
    if (Date.now() > pollDeadlineMs) {
      throw new Error(`timeout aguardando a sidebar pintar o registro cheio: ${lastCount}/${expectedRows} linhas montadas`);
    }
  }

  await electronApp.close();
  return elapsedMs;
}

test.afterAll(async () => {
  test.setTimeout(90_000); // folga do B11 para o close com PTY vivo
  try {
    await electronApp?.close();
  } finally {
    if (userDataDir) removeIsolatedUserDataDir(userDataDir);
  }
});

test('T712/CA-7 — domcontentloaded → sidebar com o registro cheio (5×6 linhas), mediana de 5 boots independentes @perf', async () => {
  // G4 — orçamento generoso: SAMPLE_COUNT boots completos (cada um com seu
  // próprio polling de até 10s) mais o boot de descoberta abaixo.
  test.setTimeout(180_000);

  // 1. Descobre projetos REAIS já escaneados nesta máquina — nunca inventar
  // paths que não existem no disco (o "missing" da sidebar é um estado real
  // do produto, não o que queremos medir aqui: CA-7 é sobre o caso comum).
  userDataDir = createIsolatedUserDataDir('ca7-discover');
  await launchApp();
  const projects = await appWindow.evaluate(() => window.donel.projects.list());
  expect(projects.length, 'precisa de ao menos 5 projetos reais nesta máquina pra medir com o registro cheio').toBeGreaterThanOrEqual(
    FAVORITES_COUNT,
  );
  const chosenProjects = projects.slice(0, FAVORITES_COUNT);
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);

  // 2. Monta um config.json com os 5 favoritos + registro CHEIO, ESCRITO
  // DIRETO NO DISCO — a medição é do BOOT (D9/CA-7: ler bytes, nunca varrer
  // `.jsonl`), não de uma sequência de IPCs feita depois do app já de pé.
  // Escrito UMA VEZ (não a cada amostra) — reaproveitado pelos N boots do
  // laço abaixo (ver comentário de `measureOneBoot`).
  userDataDir = createIsolatedUserDataDir('ca7-measurement');
  const sessionRegistry: Record<string, unknown> = {};
  for (const project of chosenProjects) {
    for (let i = 0; i < RECENT_PER_PROJECT; i += 1) {
      const sessionId = randomUUID();
      sessionRegistry[sessionId] = {
        sessionId,
        projectPath: project.path,
        label: `sessão ${i + 1} de ${project.name}`,
        lastActivityAt: Date.now() - i * 1_000,
        pinned: false,
      };
    }
    const pinnedId = randomUUID();
    sessionRegistry[pinnedId] = {
      sessionId: pinnedId,
      projectPath: project.path,
      label: `fixada de ${project.name}`,
      lastActivityAt: Date.now() - 999_000,
      pinned: true,
    };
  }

  const config = {
    version: 1,
    projectRoots: [],
    favorites: chosenProjects.map((project) => project.path),
    activeProfileSlug: 'principal',
    launcherDefaults: { model: 'fable', effort: 'high', permissionMode: 'acceptEdits' },
    notificationPreference: 'permission-only',
    sessionNames: {},
    theme: 'dark',
    sessionRegistry,
    collapsedFavorites: [], // todos EXPANDIDOS — "registro cheio" tem de estar visível de verdade
  };
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(join(userDataDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  // 3. SAMPLE_COUNT boots independentes contra o MESMO config já pronto no
  // disco — cada `measureOneBoot()` abre um Electron novo, mede com polling
  // apertado (contagem + tempo na MESMA chamada de `evaluate`, ver comentário
  // de topo) e fecha antes da próxima volta.
  const samples: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    samples.push(await measureOneBoot());
  }
  const medianMs = median(samples);

  // eslint-disable-next-line no-console
  console.log(
    `CA-7 medido (${SAMPLE_COUNT} boots): [${samples.map((s) => s.toFixed(2)).join(', ')}] ms · mediana: ${medianMs.toFixed(2)} ms ` +
      `(faixa aceita em 26/07 p/ amostra isolada: 103–167 ms · cerca de regressão sobre a MEDIANA: ${CA7_REGRESSION_FENCE_MS} ms)`,
  );
  // Vermelho aqui significa **regressão de boot persistente** (a distribuição
  // inteira deslocou), não ruído de carga da máquina nem o desvio já aceito:
  // a mediana de N boots independentes já absorve o pico isolado que uma
  // amostra única não absorvia (ver decisão G4 no comentário de topo).
  // Diagnóstico e candidatos de otimização: specs/007-favoritos-sessoes/medicao-ca7.md e §B20 do backlog.
  expect(medianMs).toBeLessThan(CA7_REGRESSION_FENCE_MS);
});
