import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `gestos-do-card` — o que dá para FAZER num card depois que a skill
// declarou o trabalho (spec 010, batch B3).
//
// O store já entendia estes cinco fatos desde a fase 1; ninguém conseguia
// disparar nenhum deles. Os prints existem para provar as quatro coisas que a
// spec não deixa a tela errar:
//
//   1. a etapa é CALCULADA — mexer no item move o card sozinho;
//   2. e ela RETROCEDE — item reaberto puxa o card de volta (pedido de 01/08);
//   3. override existe, é marcado, e o cálculo continua visível ao lado (D-13);
//   4. descartar item é um gesto (D-16) — e o histórico guarda que ele existiu.
//
// O estado ruim é semeado de propósito: um item que a skill travou não pode ser
// descartado, e a tela precisa dizer por quê em vez de recusar calada.

const TITULO_CARD = 'Fila de importação trava sem sinal';
const TITULO_ITEM_1 = 'Expor o estado da fila no endpoint de saúde';
const TITULO_ITEM_2 = 'Desenhar o painel que consome o estado';
const ID_ITEM_1 = 'wi-b3-01';
const ID_ITEM_2 = 'wi-b3-02';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'gestos-do-card' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('os gestos que movem o card', async () => {
  test.setTimeout(240_000);
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
    await passo('Abra a Esteira', esteiraToggle, 'O ícone de rota só existe no Modo Dev.');
    await esteiraToggle.click();
    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });

    // ── O card e o que a skill declarou ──────────────────────────────────
    const titulo = win.getByLabel('Novo discovery');
    await passo('Descreva o que está em jogo', titulo, 'O card nasce do problema. Os ITENS não nascem daqui: criar item passa sempre pela skill.');
    await titulo.fill(TITULO_CARD);
    await win.getByLabel('Repo alvo (opcional)').fill('donel-dev');

    const criar = win.getByRole('button', { name: 'Criar' });
    await passo('Crie o card', criar);
    await criar.click();

    const cardNaLista = win.locator('button', { hasText: TITULO_CARD }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });
    await cardNaLista.click();

    const preparar = win.getByRole('button', { name: 'Preparar' });
    await passo('Prepare a fase', preparar, 'O app separa o contexto da fase no inbox e trava o card. Quem roda a fase é a skill.');
    await preparar.click();

    const varrer = win.getByRole('button', { name: 'Varrer outbox' });
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });

    emitirPlanoComDoisItens(ctx.esteiraRoot);
    await passo('Varra o outbox', varrer, 'A skill devolveu um plano e dois itens. O watcher já ingere sozinho; o botão força a leitura na hora.');
    await varrer.click();

    const etapa = win.getByTestId('esteira-stage');
    await expect(etapa).toContainText('Planejado', { timeout: 15_000 });
    await passo(
      'O card recebe o que a skill declarou — e a etapa muda sozinha',
      etapa,
      'Etapa "Planejado" porque existe plano e nenhum item começou. Ela é calculada dos fatos: nunca foi digitada por ninguém.',
    );

    const item1 = win.getByTestId('esteira-item').filter({ hasText: TITULO_ITEM_1 });
    const item2 = win.getByTestId('esteira-item').filter({ hasText: TITULO_ITEM_2 });
    await passo('Os dois itens, com os gestos que os movem', item1, 'Cada item diz seu tipo, seu estado, seu repo alvo — e que nasceu pela skill.');

    // ── 1. O item em curso puxa o card para Execução ─────────────────────
    const comecar = item1.getByRole('button', { name: 'Começar' });
    await passo('Comece o primeiro item', comecar, 'Nada é dito ao card: é o estado do item que move a etapa.');
    await comecar.click();

    await expect(etapa).toContainText('Execução', { timeout: 10_000 });
    await passo('A etapa vira Execução sozinha', etapa, 'Qualquer item em curso põe o card em Execução. Ninguém arrastou nada.');

    // ── 2. Todos fechados: Concluído ─────────────────────────────────────
    const concluir1 = item1.getByRole('button', { name: 'Concluir' });
    await passo('Conclua o primeiro item', concluir1);
    await concluir1.click();

    const concluir2 = item2.getByRole('button', { name: 'Concluir' });
    await passo('Conclua o segundo', concluir2, 'Falta um item fechar para o card inteiro fechar.');
    await concluir2.click();

    await expect(etapa).toContainText('Concluído', { timeout: 10_000 });
    await passo('Com todos os itens fechados, a etapa vira Concluído', etapa, 'Abandonar também fecha: desistir é desfecho válido, não pendência.');

    // ── 3. O retrocesso ──────────────────────────────────────────────────
    const reabrir = item1.getByRole('button', { name: 'Reabrir' });
    await passo('Reabra um item concluído', reabrir, 'O pedido de 01/08 em uma frase: "posso querer voltar e refazer alguma etapa sempre".');
    await reabrir.click();

    await expect(etapa).toContainText('Execução', { timeout: 10_000 });
    await passo(
      'A etapa RETROCEDE — o card volta para Execução',
      etapa,
      'Etapa que só avança é etapa que mente. Aqui ela é recalculada dos fatos a cada mudança, para os dois lados.',
    );

    // ── 4. O override, com o cálculo ao lado ─────────────────────────────
    const seletorEtapa = win.getByTestId('esteira-stage-picker');
    await passo('Force a etapa à mão', seletorEtapa, 'O ajuste manual existe — o trabalho pode ter acontecido fora do app.');
    await seletorEtapa.getByRole('button').click();
    await win.getByRole('option', { name: 'Concluído' }).click();

    const forcar = win.getByRole('button', { name: 'Forçar' });
    await passo('Grave o ajuste', forcar);
    await forcar.click();

    const linhaDoAjuste = win.getByTestId('esteira-stage-override-line');
    await linhaDoAjuste.waitFor({ timeout: 10_000 });
    await expect(linhaDoAjuste).toContainText('Concluído');
    await expect(linhaDoAjuste).toContainText('Execução');
    await passo(
      'O ajuste aparece — e o cálculo continua ao lado dele',
      linhaDoAjuste,
      'Este é o print que o batch existe para produzir: a tela mostra o valor forçado, quem forçou, E o que o cálculo diz. Override que esconde o cálculo é override que engana quem lê.',
    );

    const voltarAoCalculado = win.getByRole('button', { name: 'Voltar ao calculado' });
    await passo('Volte ao calculado', voltarAoCalculado, 'Desfazer o ajuste custa um clique: ajuste caro de desfazer vira ajuste esquecido — e etapa esquecida mente.');
    await voltarAoCalculado.click();
    await expect(linhaDoAjuste).toHaveCount(0, { timeout: 10_000 });
    await passo('Sem ajuste, a etapa é só o cálculo de novo', etapa);

    // ── 5. A nota, amarrada ao item ──────────────────────────────────────
    const alvoDaNota = win.getByTestId('esteira-note-target');
    await passo('Escolha sobre o que anotar', alvoDaNota, 'A nota se prende ao card ou a um item — quem lê precisa saber a que ela se refere.');
    await alvoDaNota.getByRole('button').click();
    await win.getByRole('option', { name: `Sobre o item — ${TITULO_ITEM_1}` }).click();

    const campoDaNota = win.getByLabel('Nota', { exact: true });
    await passo('Escreva a nota', campoDaNota);
    await campoDaNota.fill('Reaberto: a métrica saiu com o nome errado e o painel leu vazio.');

    const anotar = win.getByRole('button', { name: 'Anotar' });
    await passo('Registre', anotar);
    await anotar.click();

    const notas = win.getByTestId('esteira-notes');
    await expect(notas).toContainText('a métrica saiu com o nome errado', { timeout: 10_000 });
    await passo('A nota entra dizendo sobre o que ela é', notas, 'Nota de card e nota de item não se confundem na tela.');

    // ── O estado ruim, semeado de propósito ──────────────────────────────
    emitirTravaNoPrimeiroItem(ctx.esteiraRoot);
    await varrer.click();
    const blocoDaTrava = win.getByRole('heading', { name: 'Em andamento' });
    await expect(blocoDaTrava).toBeVisible({ timeout: 15_000 });
    await passo(
      'A skill assumiu o primeiro item — e a trava aparece no card',
      blocoDaTrava,
      'A trava é um fato local com dono, hora e sessão. Não é arquivo .lock nem etiqueta no board.',
    );

    const descartar1 = item1.getByRole('button', { name: 'Descartar' });
    await passo('Tente descartar o item travado', descartar1, 'O gesto está lá, e o app deixa clicar — o que ele não faz é recusar calado.');
    await descartar1.click();

    const recado = win.locator('section[aria-label="Esteira"] p').filter({ hasText: 'Libere a trava' }).first();
    await expect(recado).toBeVisible({ timeout: 10_000 });
    await passo(
      'A tela recusa e diz por quê',
      recado,
      'Descartar agora tiraria a trava da tela sem tirá-la do estado: uma trava sem dono, invisível, que ninguém consegue soltar. Já aconteceu uma vez neste app.',
    );

    // ── E o descarte que pode acontecer ──────────────────────────────────
    const descartar2 = item2.getByRole('button', { name: 'Descartar' });
    await passo('Descarte o item que a skill criou por engano', descartar2, 'Criar item passa sempre pela skill; descartar é um gesto daqui, sem bloqueio.');
    await descartar2.click();

    await expect(win.getByTestId('esteira-item')).toHaveCount(1, { timeout: 10_000 });
    await passo(
      'O item sai do card — e o histórico guarda que ele existiu',
      win.locator('section[aria-label="Esteira"] p').filter({ hasText: 'descartado' }).first(),
      'A entidade sai do snapshot; o evento fica no log append-only. Descartar não é apagar o passado.',
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
  const arquivo = readdirSync(inbox)
    .filter((nome) => nome.endsWith('.json'))
    .sort()
    .pop();
  if (arquivo === undefined) throw new Error('nenhum run-input no inbox — o disparo não gravou');
  return path.join(inbox, arquivo);
}

/** Roda o emissor REAL da skill 3.0 — sem dublê, o contrato é provado dos dois lados. */
function emitir(esteiraRoot: string, fatos: unknown[], nomeDoArquivoDeFatos: string, complemento = false): void {
  const inputPath = ultimoInput(esteiraRoot);
  const factsPath = path.join(esteiraRoot, nomeDoArquivoDeFatos);
  writeFileSync(factsPath, JSON.stringify(fatos), 'utf8');

  // A4 — acrescentar fatos a um run já ingerido é COMPLEMENTO, não regravação:
  // reescrever o mesmo `run_id` com outro conteúdo é recusado com erro visível.
  const runId: string = JSON.parse(readFileSync(inputPath, 'utf8')).run.run_id;
  const extras = complemento
    ? ['--kind', 'esteira.result.complement', '--complements-run-id', runId, '--run-id', `${runId}.c1`]
    : [];

  execFileSync(
    'python',
    ['emit_result.py', '--input', inputPath, '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high', ...extras],
    { cwd: path.join(REPO_ROOT, 'skills', 'esteira-donel-3.0.0', 'tools'), encoding: 'utf8' },
  );
}

function discoveryDoInput(esteiraRoot: string): string {
  return JSON.parse(readFileSync(ultimoInput(esteiraRoot), 'utf8')).subject.discovery_id;
}

/** O fato do card: mesmo TÍTULO digitado na tela — `discovery.recorded` faz upsert. */
function fatoDoCard(discoveryId: string): Record<string, unknown> {
  return {
    type: 'discovery.recorded',
    discovery_id: discoveryId,
    title: TITULO_CARD,
    problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
    target_repo: 'donel-dev',
    scope_repos: ['donel-dev'],
  };
}

function emitirPlanoComDoisItens(esteiraRoot: string): void {
  const discoveryId = discoveryDoInput(esteiraRoot);
  emitir(
    esteiraRoot,
    [
      fatoDoCard(discoveryId),
      {
        type: 'plan.recorded',
        plan_id: 'pln-b3',
        discovery_id: discoveryId,
        title: 'Tornar o estado da fila observável',
        summary: 'Instrumentar antes de mexer no consumo.',
      },
      { type: 'work_item.recorded', work_item_id: ID_ITEM_1, plan_id: 'pln-b3', item_type: 'issue', title: TITULO_ITEM_1, target_repo: 'donel-dev', scope_repos: [] },
      { type: 'work_item.recorded', work_item_id: ID_ITEM_2, plan_id: 'pln-b3', item_type: 'spec', title: TITULO_ITEM_2, target_repo: 'donel-dev', scope_repos: [] },
      // A18 — a fase de conversa fecha com o que alguém disse.
      {
        type: 'decision.recorded',
        subject: { entity: 'discovery', id: discoveryId },
        decision: 'os dois itens entram juntos',
        confirmed_by: 'dono do repo',
      },
      {
        type: 'phase.completed',
        subject: { entity: 'discovery', id: discoveryId },
        phase: 'discovery',
        outcome: 'done',
        summary: 'Um plano com dois itens.',
      },
    ],
    'fatos-plano.json',
  );
}

/**
 * O estado ruim: a skill assumiu o primeiro item e o travou. Isto chega como
 * COMPLEMENTO do run anterior (A4) — acrescenta um fato sem redeclarar a fase.
 *
 * Antes o roteiro reemitia o MESMO `run_id` e contava com a dedupe para deixar
 * só a trava entrar. Era o buraco: regravar um run com outro conteúdo passava
 * calado, e foi assim que a Concluir trocou um desfecho sem o card contar.
 * Agora o mesmo `run_id` com conteúdo diferente é recusado com erro visível, e
 * o complemento é o caminho certo — mais curto, inclusive: ele não precisa
 * repetir nenhum fato já declarado.
 */
function emitirTravaNoPrimeiroItem(esteiraRoot: string): void {
  emitir(
    esteiraRoot,
    [
      {
        // O emissor monta o `holder` (kind: skill) a partir destes dois campos —
        // é a forma que `esteira_contract.lock_acquired` aceita.
        type: 'lock.acquired',
        subject: { entity: 'work_item', id: ID_ITEM_1 },
        phase: 'implementar',
        acquired_at: '2026-08-04T15:00:00.000Z',
        cli_session_id: '0198f0bd-2d3e-7b02-8c5a-3d2e4f5a6b7c',
      },
    ],
    'fatos-trava.json',
    true,
  );
}
