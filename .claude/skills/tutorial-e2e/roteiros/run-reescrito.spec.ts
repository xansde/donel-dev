import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `run-reescrito` — o buraco que engolia um desfecho em silêncio
// (spec 010, itens A4 e A13).
//
// O caso real: a fase Concluir regravou o MESMO `run_id` com o desfecho
// revisto. A segunda leitura casou com a `dedupe_key` da primeira — o mecanismo
// que torna a reingestão segura — e cada evento novo foi descartado como "já
// visto". O card continuou dizendo "terminou sem conclusão" enquanto o arquivo
// em disco dizia o contrário, e nenhum erro apareceu em lugar nenhum.
//
// O que este roteiro mostra, nesta ordem:
//
//   1. reingerir o MESMO arquivo             → nada acontece, e está certo
//   2. reescrever o run com outro desfecho   → ERRO VISÍVEL, com a saída escrita
//   3. o caminho certo para acrescentar      → COMPLEMENTO
//   4. o caminho certo para rever o desfecho → REVISÃO

const REPO_ALVO = 'donel-dev';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'run-reescrito' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('um run não se reescreve', async () => {
  test.setTimeout(300_000);
  const { win, passo } = ctx;

  try {
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await esteiraToggle.click();
    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });

    const titulo = win.getByLabel('Novo discovery');
    await passo('Descreva o que está em jogo', titulo);
    await titulo.fill('Fila de importação trava sem sinal');
    await win.getByLabel('Repo alvo (opcional)').fill(REPO_ALVO);

    const criar = win.getByRole('button', { name: 'Criar' });
    await criar.click();

    const cardNaLista = win.locator('button', { hasText: 'Fila de importação trava sem sinal' }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });

    const preparar = win.getByRole('button', { name: 'Preparar' });
    await passo('Prepare a fase Discovery', preparar, 'O app separa o contexto no inbox e trava o card.');
    await preparar.click();
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });

    const discoveryId = lerDiscoveryId(ctx.esteiraRoot);
    const runId = lerRunId(ctx.esteiraRoot);
    const dsc = { entity: 'discovery', id: discoveryId };
    const varrer = win.getByRole('button', { name: 'Varrer outbox' });

    // ── 1. O run original ────────────────────────────────────────────────
    emitir(ctx.esteiraRoot, [
      {
        type: 'discovery.recorded',
        discovery_id: discoveryId,
        // MESMO texto digitado na tela: `discovery.created` faz upsert.
        title: 'Fila de importação trava sem sinal',
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        target_repo: REPO_ALVO,
      },
      { type: 'gate.confirmed', subject: dsc, condition: 'o repo alvo é donel-dev', confirmed_by: 'dono do repo' },
      { type: 'phase.completed', subject: dsc, phase: 'discovery', outcome: 'done', summary: 'Um caminho proposto.' },
    ]);
    await passo('Varra o outbox', varrer);
    await varrer.click();
    await win.getByText('discovery — concluída').waitFor({ timeout: 10_000 });
    await passo('O run entra e a fase fecha', cardNaLista, 'Até aqui, o caminho normal.');

    // ── 2. O MESMO arquivo, relido ───────────────────────────────────────
    await varrer.click();
    await passo(
      'Reler o MESMO arquivo não muda nada — e está certo',
      win.getByTestId('esteira-fases'),
      'A ingestão é idempotente por desenho: o watcher relê a pasta sem medo. Nenhuma linha nova, nenhum erro. É este mecanismo que o passo seguinte quase virou do avesso.',
    );

    // ── 3. O run REESCRITO, com outro desfecho ───────────────────────────
    reescreverDesfecho(ctx.esteiraRoot, discoveryId, runId);
    await varrer.click();
    await win.getByText('não consegui ler').first().waitFor({ timeout: 10_000 });
    await passo(
      'Reescrever o run com outro desfecho vira ERRO VISÍVEL',
      win.locator('section', { hasText: 'Não consegui ler' }).last(),
      'Este é o caso real: a Concluir regravou o mesmo run com o desfecho revisto. A segunda leitura casava com a dedupe da primeira e sumia — o card seguia dizendo "terminou sem conclusão" enquanto o arquivo dizia o contrário, e nenhum erro aparecia. Agora aparece, e com a SAÍDA escrita na frase: complemento para acrescentar, revisão para rever.',
    );
    await passo(
      'E o desfecho antigo continua de pé',
      cardNaLista,
      'Recusar não é engolir metade: a fase continua concluída, como o run que de fato entrou a declarou. O arquivo segue no outbox — o trabalho não se perdeu, só não foi lido.',
    );

    // ── 4. O caminho certo para ACRESCENTAR ──────────────────────────────
    emitirComplemento(ctx.esteiraRoot, discoveryId, runId);
    await varrer.click();
    await win.getByText('O relatório ficou pronto depois que o run fechou.').waitFor({ timeout: 10_000 });
    await passo(
      'Complemento: acrescenta fatos sem redeclarar a fase',
      cardNaLista,
      'O complemento se ancora no run anterior e traz o sufixo dele no nome (`.c1`), então o parentesco é visível a olho nu na pasta. Ele NÃO declara phase.completed: a fase já respondeu por ela, e contá-la duas vezes viraria duas passagens sobre uma execução.',
    );

    // ── 5. O caminho certo para REVER o desfecho ─────────────────────────
    emitirRevisao(ctx.esteiraRoot, discoveryId, runId);
    await varrer.click();
    await win.getByText('discovery — abandonada').waitFor({ timeout: 10_000 });
    await passo(
      'Revisão: o desfecho muda, e a mudança é um FATO',
      cardNaLista,
      'A revisão é um run NOVO (`.rev2`), com o run revisado gravado no livro dos runs. O desfecho anterior continua legível — a diferença entre revisar e reescrever é exatamente esta: uma deixa rastro, a outra apaga.',
    );
  } catch (error) {
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

/** O `run-input.json` mais recente do inbox isolado — por mtime, não por nome (os ids são uuid). */
function ultimoInput(esteiraRoot: string): string {
  const inbox = path.join(esteiraRoot, 'inbox');
  const arquivos = readdirSync(inbox)
    .filter((nome) => nome.endsWith('.json'))
    .map((nome) => path.join(inbox, nome))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  const ultimo = arquivos.pop();
  if (ultimo === undefined) throw new Error('nenhum run-input no inbox — o disparo não gravou');
  return ultimo;
}

function lerDiscoveryId(esteiraRoot: string): string {
  return JSON.parse(readFileSync(ultimoInput(esteiraRoot), 'utf8')).subject.discovery_id as string;
}

function lerRunId(esteiraRoot: string): string {
  return JSON.parse(readFileSync(ultimoInput(esteiraRoot), 'utf8')).run.run_id as string;
}

let sequencia = 0;

/** Roda o emissor REAL da skill 3.0. `extras` carrega as portas de A4/A13. */
function emitir(esteiraRoot: string, fatos: unknown[], extras: string[] = []): void {
  sequencia += 1;
  const inputPath = ultimoInput(esteiraRoot);
  const factsPath = path.join(esteiraRoot, `fatos-${sequencia}.json`);
  writeFileSync(factsPath, JSON.stringify(fatos), 'utf8');

  execFileSync(
    'python',
    ['emit_result.py', '--input', inputPath, '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high', ...extras],
    { cwd: path.join(REPO_ROOT, 'skills', 'esteira-donel-3.0.0', 'tools'), encoding: 'utf8' },
  );
}

/**
 * O defeito, reproduzido: o MESMO `run_id` com outro desfecho, escrito num
 * arquivo à parte do outbox. Aqui o JSON é montado à mão de propósito — o
 * emissor da skill não tem como gerar isto sem passar pelas portas de
 * complemento/revisão, que é justamente o ponto.
 */
function reescreverDesfecho(esteiraRoot: string, discoveryId: string, runId: string): void {
  writeFileSync(
    path.join(esteiraRoot, 'outbox', 'run-reescrito.json'),
    JSON.stringify({
      contract_version: '1.0.0',
      kind: 'esteira.result',
      run: {
        run_id: runId,
        phase: 'discovery',
        status: 'success',
        started_at: '2026-08-04T12:00:00.000Z',
        finished_at: '2026-08-04T12:40:00.000Z',
        failure: null,
      },
      actor: { tool: 'esteira-donel', tool_version: '3.0.0' },
      subject: { discovery_id: discoveryId },
      facts: [
        { type: 'discovery.recorded', discovery_id: discoveryId, title: 'Fila de importação trava sem sinal' },
        { type: 'gate.confirmed', subject: { entity: 'discovery', id: discoveryId }, condition: 'o repo alvo é donel-dev', confirmed_by: 'dono do repo' },
        // O desfecho revisto, escrito por cima do run original.
        { type: 'phase.completed', subject: { entity: 'discovery', id: discoveryId }, phase: 'discovery', outcome: 'abandoned' },
      ],
    }),
    'utf8',
  );
}

/** A4 — acrescentar fatos ao run já ingerido, pela porta certa. */
function emitirComplemento(esteiraRoot: string, discoveryId: string, runId: string): void {
  emitir(
    esteiraRoot,
    [
      {
        type: 'note.recorded',
        subject: { entity: 'discovery', id: discoveryId },
        text: 'O relatório ficou pronto depois que o run fechou.',
      },
    ],
    ['--kind', 'esteira.result.complement', '--complements-run-id', runId, '--run-id', `${runId}.c1`],
  );
}

/** A13 — rever o desfecho, pela porta certa. */
function emitirRevisao(esteiraRoot: string, discoveryId: string, runId: string): void {
  emitir(
    esteiraRoot,
    [
      { type: 'discovery.recorded', discovery_id: discoveryId, title: 'Fila de importação trava sem sinal' },
      {
        type: 'decision.recorded',
        subject: { entity: 'discovery', id: discoveryId },
        decision: 'o problema é do provedor, não da fila — não seguimos',
        confirmed_by: 'dono do repo',
      },
      { type: 'phase.completed', subject: { entity: 'discovery', id: discoveryId }, phase: 'discovery', outcome: 'abandoned', summary: 'Desfecho revisto.' },
    ],
    ['--revises-run-id', runId, '--run-id', `${runId}.rev2`],
  );
}
