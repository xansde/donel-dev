import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `esteira` — o caminho de uma fase, do clique ao card (spec 010).
//
// Vale como e2e E como tutorial: os mesmos prints provam que a tela diz a
// verdade em cada estado e ensinam quem nunca usou. Cobre os quatro estados
// que a spec existe para não confundir:
//
//   preparada  ≠  em andamento
//   sem plano  ≠  não realizada
//   falhou     ≠  nunca rodou
//   não li     ≠  não aconteceu

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'esteira' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o caminho de uma fase', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    // ── Entrar na tela ───────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'O controle do meio da barra de título troca a janela entre uso geral e trabalho de dev.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await passo('Abra a Esteira', esteiraToggle, 'O ícone de rota só existe no Modo Dev. O mapa de hoje continua vivo por baixo, intocado.');
    await esteiraToggle.click();

    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });
    await passo('A tela começa vazia — e diz isso', null, 'O histórico nasce limpo: nada é importado do modelo antigo.');

    // ── Criar o card ─────────────────────────────────────────────────────
    const titulo = win.getByLabel('Novo discovery');
    await passo('Descreva o que está em jogo', titulo, 'O título é o problema, não a solução. O repo é opcional: um discovery pode investigar algo que não pertence a repositório nenhum.');
    await titulo.fill('Fila de importação trava sem sinal');
    await win.getByLabel('Repo alvo (opcional)').fill('donel-dev');

    const criar = win.getByRole('button', { name: 'Criar' });
    await passo('Crie o card', criar);
    await criar.click();

    const cardNaLista = win.locator('button', { hasText: 'Fila de importação trava sem sinal' }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });
    await passo('O card aparece na hora', cardNaLista, 'Ele nasce na etapa Discovery. A etapa nunca é digitada: sai de uma tabela aplicada sobre os fatos, e muda sozinha conforme eles chegam.');

    // ── Preparar a fase ──────────────────────────────────────────────────
    const preparar = win.getByRole('button', { name: 'Preparar' });
    await passo('Prepare a fase', preparar, 'O app separa o contexto da fase e trava o card para ninguém atropelar.');
    await preparar.click();

    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });
    await passo(
      'Preparada — e a tela diz que ninguém assumiu',
      win.locator('code').first(),
      'O card está travado, mas NADA está rodando. Abrir a sessão ainda é manual, e a tela fala isso em vez de dizer "em andamento".',
    );
    await passo('Copie o comando ou libere a trava', win.getByRole('button', { name: 'Copiar comando' }), 'Liberar solta a trava num clique — ela é um fato no histórico, não um arquivo .lock solto.');

    // ── A skill responde ─────────────────────────────────────────────────
    emitirResultadoDaSkill(ctx.esteiraRoot);
    const varrer = win.getByRole('button', { name: 'Varrer outbox' });
    await passo('Varra o outbox', varrer, 'O watcher já ingere sozinho quando o arquivo chega; o botão força a leitura na hora.');
    await varrer.click();

    await win.getByText('Planejado').first().waitFor({ timeout: 10_000 });
    await passo(
      'O card se atualiza com o que a skill declarou',
      cardNaLista,
      'A trava cai, a fase vira "concluída" e a etapa avança para Planejado — porque a skill declarou um plano. Nada foi deduzido pelo app.',
    );

    // ── O documento fora do contrato ─────────────────────────────────────
    escreverResultadoQuebrado(ctx.esteiraRoot);
    await varrer.click();
    await win.getByText('não consegui ler').first().waitFor({ timeout: 10_000 });
    await passo('Documento fora do contrato vira erro visível', win.getByText('não consegui ler').first(), 'O chip vermelho no card. Este é o estado que o modelo antigo escondia atrás de "não realizada".');
    await passo(
      'O erro tem caminho e motivo',
      win.locator('section', { hasText: 'Não consegui ler' }).last(),
      'O arquivo continua no outbox: o trabalho da skill não se perdeu — só não foi lido.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

/** O último `run-input.json` que o app gravou no inbox isolado. */
function ultimoInput(esteiraRoot: string): string {
  const inbox = path.join(esteiraRoot, 'inbox');
  const arquivo = readdirSync(inbox).filter((nome) => nome.endsWith('.json')).sort().pop();
  if (arquivo === undefined) throw new Error('nenhum run-input no inbox — o disparo não gravou');
  return path.join(inbox, arquivo);
}

/**
 * Roda o emissor REAL da skill 3.0 contra o input do disparo. Sem dublê: é o
 * mesmo `emit_result.py` que a skill usa, então o e2e prova o contrato dos dois
 * lados, não só o lado do app.
 */
function emitirResultadoDaSkill(esteiraRoot: string): void {
  const inputPath = ultimoInput(esteiraRoot);
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const discoveryId = input.subject.discovery_id;
  const factsPath = path.join(esteiraRoot, 'facts.json');

  writeFileSync(
    factsPath,
    JSON.stringify([
      {
        type: 'discovery.recorded',
        discovery_id: discoveryId,
        // MESMO texto digitado na tela: `discovery.created` faz upsert, e um
        // título diferente aqui RENOMEIA o card no meio do roteiro.
        title: 'Fila de importação trava sem sinal',
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        target_repo: 'donel-dev',
        scope_repos: ['donel-dev'],
      },
      {
        type: 'plan.recorded',
        plan_id: 'pln-e2e-01',
        discovery_id: discoveryId,
        title: 'Tornar o estado da fila observável',
        summary: 'Instrumentar a fila antes de mexer no consumo.',
      },
      {
        type: 'relation.recorded',
        relation: 'originated',
        from: { entity: 'discovery', id: discoveryId },
        to: { entity: 'plan', id: 'pln-e2e-01' },
      },
      {
        type: 'note.recorded',
        subject: { entity: 'discovery', id: discoveryId },
        text: 'Duas hipóteses descartadas: timeout do worker e limite de conexão.',
      },
      // A18 — discovery concluída fecha com o que alguém disse. Sem este
      // fato o emissor recusa: fase que não perguntou nada não fecha.
      {
        type: 'decision.recorded',
        subject: { entity: 'discovery', id: discoveryId },
        decision: 'instrumentar a fila antes de mexer no consumo',
        confirmed_by: 'dono do repo',
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

  execFileSync(
    'python',
    ['emit_result.py', '--input', inputPath, '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high'],
    { cwd: path.join(REPO_ROOT, 'skills', 'esteira-donel-3.0.0', 'tools'), encoding: 'utf8' },
  );
}

/** Um `result.json` com um campo que o contrato não declara — o desencontro que originou a spec. */
function escreverResultadoQuebrado(esteiraRoot: string): void {
  const discoveryId = JSON.parse(readFileSync(ultimoInput(esteiraRoot), 'utf8')).subject.discovery_id;
  writeFileSync(
    path.join(esteiraRoot, 'outbox', 'fora-do-contrato.json'),
    JSON.stringify({
      contract_version: '1.0.0',
      kind: 'esteira.result',
      run: {
        run_id: 'run-fora-do-contrato',
        phase: 'discovery',
        status: 'success',
        started_at: '2026-08-04T12:00:00.000Z',
        finished_at: '2026-08-04T12:10:00.000Z',
        failure: null,
      },
      actor: { tool: 'esteira-donel', tool_version: '2.1.0' },
      subject: { discovery_id: discoveryId },
      facts: [
        { type: 'discovery.recorded', discovery_id: discoveryId, title: 'Card', fanout_cards: ['card-1'] },
        { type: 'phase.completed', subject: { entity: 'discovery', id: discoveryId }, phase: 'discovery', outcome: 'done' },
      ],
    }),
    'utf8',
  );
}
