import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `decisoes-revisao-e-canal` — o que o card passou a contar sobre GENTE
// e sobre DESTINO (spec 010, itens A9, A18, A10, A19, A16, A15).
//
// Cada bloco novo existe por causa de uma frase que sumia:
//
//   o gate confirmado    vivia como blockquote no tasks.md   → bloco Decisões
//   a decisão tomada     idem, e fase fechava sem perguntar   → recusa na emissão
//   a revisão humana     vivia como frase corrida no summary  → checklist
//   o gesto humano       virava "needs_attention" (falha)     → "aguardando você"
//   o roteiro e2e        gate conferia se o ARQUIVO existia   → "esperando você rodar"
//   o canal da entrega   ausente = lido como "está na main"   → "em staging (alfa)"
//
// Os fatos são emitidos pelo `emit_result.py` REAL da skill 3.0: o roteiro
// prova o contrato dos dois lados, não só o do app.

const ID_PLANO = 'pln-humano-01';
const ID_ITEM = 'wi-humano-01';
const REPO_ALVO = 'donel-dev';
const URL_PR = 'https://github.com/exemplo/donel-dev/pull/141';
const ROTEIRO_E2E = '.claude/skills/tutorial-e2e/roteiros/fila-observavel.spec.ts';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'decisoes-revisao-e-canal' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o card conta o que gente disse, o que falta de você e onde a entrega chegou', async () => {
  test.setTimeout(300_000);
  const { win, passo } = ctx;

  try {
    // ── Entrar na tela ───────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'A esteira só existe no modo de trabalho de dev.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await esteiraToggle.click();
    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });

    // ── O card ───────────────────────────────────────────────────────────
    const titulo = win.getByLabel('Novo discovery');
    await passo('Descreva o que está em jogo', titulo, 'O repo alvo aqui vira o default dos itens.');
    await titulo.fill('Fila de importação trava sem sinal');
    await win.getByLabel('Repo alvo (opcional)').fill(REPO_ALVO);

    const criar = win.getByRole('button', { name: 'Criar' });
    await passo('Crie o card', criar);
    await criar.click();

    const cardNaLista = win.locator('button', { hasText: 'Fila de importação trava sem sinal' }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });

    const preparar = win.getByRole('button', { name: 'Preparar' });
    await passo('Prepare a fase Discovery', preparar, 'O app separa o contexto no inbox e trava o card.');
    await preparar.click();
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });

    const discoveryId = lerDiscoveryId(ctx.esteiraRoot);
    const varrer = win.getByRole('button', { name: 'Varrer outbox' });
    const dsc = { entity: 'discovery', id: discoveryId };

    // ── A9 + A18: a discovery fecha com o que uma pessoa disse ───────────
    emitir(ctx.esteiraRoot, [
      {
        type: 'discovery.recorded',
        discovery_id: discoveryId,
        // MESMO texto digitado na tela: `discovery.created` faz upsert, e um
        // título diferente aqui RENOMEIA o card no meio do roteiro.
        title: 'Fila de importação trava sem sinal',
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        target_repo: REPO_ALVO,
        scope_repos: [REPO_ALVO],
      },
      { type: 'plan.recorded', plan_id: ID_PLANO, discovery_id: discoveryId, title: 'Tornar o estado da fila observável' },
      // Gate COMPOSTO: duas condições, dois fatos. Como blockquote no tasks.md
      // isto virava UMA linha, e meia-confirmação não cabia nela.
      { type: 'gate.confirmed', subject: dsc, condition: 'o repo alvo do card é donel-dev', confirmed_by: 'dono do repo' },
      { type: 'gate.confirmed', subject: dsc, condition: 'o painel entra numa rodada seguinte', confirmed_by: 'dono do repo' },
      {
        type: 'decision.recorded',
        subject: dsc,
        decision: 'instrumentar antes de mexer no consumo',
        confirmed_by: 'dono do repo',
        rationale: 'Sem medir onde o lote para, qualquer mexida no consumo é chute.',
      },
      { type: 'phase.completed', subject: dsc, phase: 'discovery', outcome: 'done', summary: 'Um plano proposto.' },
    ]);

    await passo('Varra o outbox', varrer, 'O watcher já ingere sozinho quando o arquivo chega; o botão força a leitura na hora.');
    await varrer.click();

    const decisoes = win.getByTestId('esteira-decisoes');
    await decisoes.waitFor({ timeout: 10_000 });
    await passo(
      'O que GENTE disse aparece no card, condição por condição',
      decisoes,
      'Duas confirmações e uma decisão, cada uma com quem confirmou. Como texto no tasks.md, o gate composto virava uma linha só — e "confirmado" aparecia na tela com metade dele em aberto. A decisão traz o motivo na mesma frase: nomear a escolha e esconder o porquê é contar a conversa pela metade.',
    );

    // Fase de conversa que NÃO perguntou nada não fecha: a recusa acontece na
    // EMISSÃO, então o print é do erro do emissor — antes de qualquer arquivo
    // chegar ao outbox.
    const recusa = tentarFecharDiscoverySemGente(ctx.esteiraRoot, discoveryId);
    await passo(
      'Fase que não perguntou nada não fecha',
      null,
      `A skill recusou emitir uma discovery "concluída" sem nenhum fato humano. A mensagem foi: ${recusa}`,
    );

    // ── A16 + A10 + A19: validar deixa o roteiro e a lista ───────────────
    await prepararFase(win, { phase: 'plano', discoveryId, planId: ID_PLANO });
    emitir(ctx.esteiraRoot, [
      { type: 'work_item.recorded', work_item_id: ID_ITEM, plan_id: ID_PLANO, item_type: 'issue', title: 'Expor estado da fila', target_repo: REPO_ALVO },
      { type: 'decision.recorded', subject: { entity: 'plan', id: ID_PLANO }, decision: 'um item só nesta rodada', confirmed_by: 'dono do repo' },
      { type: 'phase.completed', subject: { entity: 'plan', id: ID_PLANO }, phase: 'plano', outcome: 'done' },
    ]);
    await varrer.click();
    await win.getByText('Expor estado da fila').first().waitFor({ timeout: 10_000 });

    await prepararFase(win, { phase: 'implementar', discoveryId, planId: ID_PLANO, workItemId: ID_ITEM });
    emitir(ctx.esteiraRoot, [
      { type: 'verification.recorded', subject: item(), verification_kind: 'check', state: 'passed', ref: 'npm test' },
      // A19 — o gesto que a fase NÃO podia dar vai nomeado, e não rebaixa nada.
      {
        type: 'human_review.recorded',
        subject: item(),
        phase: 'implementar',
        checklist: [{ item: 'abrir o PR contra staging', kind: 'action', state: 'pending', detail: null }],
      },
      { type: 'phase.completed', subject: item(), phase: 'implementar', outcome: 'done', summary: 'Endpoint e teste escritos; falta o PR, que é gesto seu.' },
    ]);
    await varrer.click();

    const revisao = win.getByTestId('esteira-revisao');
    await revisao.waitFor({ timeout: 10_000 });
    await passo(
      'Esperar por você não é falha da fase',
      revisao,
      'A fase saiu CONCLUÍDA com um gesto humano pendente, e a pendência aparece nomeada — "Você precisa: abrir o PR contra staging — aguardando você". Falha é o que a fase deveria ter feito e não fez; pintar espera de vermelho ensina a ignorar o vermelho.',
    );

    await prepararFase(win, { phase: 'validar', discoveryId, planId: ID_PLANO, workItemId: ID_ITEM });
    emitir(ctx.esteiraRoot, [
      { type: 'verification.recorded', subject: item(), verification_kind: 'pull-request', state: 'pending', ref: URL_PR, base: 'staging' },
      // A16 — o roteiro e2e é uma verificação de tipo próprio, e ela fica
      // `pending` até o dono rodar e reportar.
      { type: 'verification.recorded', subject: item(), verification_kind: 'e2e-manual', state: 'pending', ref: ROTEIRO_E2E },
      {
        type: 'human_review.recorded',
        subject: item(),
        phase: 'validar',
        checklist: [
          { item: 'rodar o roteiro e2e e me dizer o que viu', kind: 'action', state: 'pending', detail: ROTEIRO_E2E },
          { item: 'o teste novo cobre lote vazio, que é o caso que quebrou', kind: 'review', state: 'pending', detail: 'tests/fila.test.ts' },
        ],
      },
      { type: 'phase.completed', subject: item(), phase: 'validar', outcome: 'done', risk: 'sensivel', summary: 'Review sem bloqueio; o roteiro e2e espera você.' },
    ]);
    await varrer.click();

    await win.getByText('roteiro e2e escrito, esperando você rodar').waitFor({ timeout: 10_000 });
    await passo(
      '"Escrito" e "rodado" deixam de ser a mesma coisa',
      win.getByTestId('esteira-verificacoes'),
      'O gate antigo conferia se o ARQUIVO do roteiro estava na branch — e foi assim que uma fase fechou verde sem ninguém ter validado. Agora o roteiro é um check próprio, e o estado dele só sai de "esperando você rodar" com o resultado que VOCÊ colheu.',
    );
    await passo(
      'A lista da revisão, com o que é para conferir e o que é para fazer',
      revisao,
      'Duas naturezas na mesma lista porque as duas respondem "o que falta de mim?". Antes isto era uma frase corrida no summary da fase, que ninguém lê como lista e ninguém marca como feita.',
    );

    // O aval humano NÃO sai junto de um e2e que ninguém rodou: a recusa é do
    // emissor, antes de qualquer arquivo chegar ao outbox.
    const recusaAval = tentarAprovarComE2ePendente(ctx.esteiraRoot);
    await passo(
      'Aprovação com o roteiro pendente é recusada em risco sensível',
      null,
      `O e2e PODE ficar pendente — esperar você é legítimo. O que não sai junto é o aval. A skill respondeu: ${recusaAval}`,
    );

    // ── A15: o canal da entrega ──────────────────────────────────────────
    await prepararFase(win, { phase: 'concluir', discoveryId, planId: ID_PLANO, workItemId: ID_ITEM });
    emitir(ctx.esteiraRoot, [
      { type: 'verification.recorded', subject: item(), verification_kind: 'e2e-manual', state: 'passed', ref: `${ROTEIRO_E2E} — rodado por você, passou` },
      { type: 'verification.recorded', subject: item(), verification_kind: 'pull-request', state: 'passed', ref: URL_PR, base: 'staging' },
      { type: 'phase.completed', subject: item(), phase: 'concluir', outcome: 'done', channel: 'alfa', summary: 'PR mergeado em staging e verificado.' },
    ]);
    await varrer.click();

    await win.getByText('Entregue em staging (alfa).').waitFor({ timeout: 10_000 });
    await passo(
      'O card diz ONDE a entrega chegou',
      win.getByTestId('esteira-verificacoes'),
      'Num repo com escada alfa→beta→stable, "concluído" sem destino se lê como "está na main". A base do PR e o apelido do canal são campos separados, e nenhum se deduz do outro: traduzir staging para alfa é conhecimento da escada deste repo, que o contrato não tem.',
    );
    await passo(
      'O card inteiro, depois do ciclo',
      cardNaLista,
      'Decisões, revisão e destino convivem com as fases e as verificações. Nenhuma dessas frases nasce na tela: todas vêm da camada pura, que tem teste — foi montar frase no JSX que fez a tela se contradizer três vezes.',
    );
  } catch (error) {
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

function item(): { entity: string; id: string } {
  return { entity: 'work_item', id: ID_ITEM };
}

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

let sequencia = 0;

/** Roda o emissor REAL da skill 3.0 contra o input do disparo. Sem dublê. */
function emitir(esteiraRoot: string, fatos: unknown[]): void {
  sequencia += 1;
  const inputPath = ultimoInput(esteiraRoot);
  const factsPath = path.join(esteiraRoot, `fatos-${sequencia}.json`);
  writeFileSync(factsPath, JSON.stringify(fatos), 'utf8');

  execFileSync(
    'python',
    ['emit_result.py', '--input', inputPath, '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high'],
    { cwd: path.join(REPO_ROOT, 'skills', 'esteira-donel-3.0.0', 'tools'), encoding: 'utf8' },
  );
}

/** Emite esperando FALHA e devolve o motivo, para o print contar o que o gate disse. */
function emitirEsperandoRecusa(esteiraRoot: string, fatos: unknown[]): string {
  try {
    emitir(esteiraRoot, fatos);
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '').trim();
    return stderr.length > 0 ? stderr : String(error);
  }
  throw new Error('esperava recusa do emissor, e ele aceitou');
}

/** A18 — discovery "concluída" sem nenhum fato humano não é sequer emitida. */
function tentarFecharDiscoverySemGente(esteiraRoot: string, discoveryId: string): string {
  return emitirEsperandoRecusa(esteiraRoot, [
    { type: 'discovery.recorded', discovery_id: discoveryId, title: 'Fila de importação trava sem sinal' },
    { type: 'phase.completed', subject: { entity: 'discovery', id: discoveryId }, phase: 'discovery', outcome: 'done' },
  ]);
}

/** A16 — aprovação humana com o roteiro e2e ainda pendente, em risco sensível. */
function tentarAprovarComE2ePendente(esteiraRoot: string): string {
  return emitirEsperandoRecusa(esteiraRoot, [
    { type: 'verification.recorded', subject: item(), verification_kind: 'e2e-manual', state: 'pending', ref: ROTEIRO_E2E },
    { type: 'verification.recorded', subject: item(), verification_kind: 'review', state: 'passed', ref: 'aprovado por 1 revisor' },
    { type: 'phase.completed', subject: item(), phase: 'validar', outcome: 'done', risk: 'sensivel' },
  ]);
}

/**
 * Prepara uma fase pela MESMA porta que o botão usa. Forjar um
 * `run-input.json` por fora provaria o contrato contra um dublê — que é
 * justamente o que a spec 010 existe para não fazer.
 */
async function prepararFase(
  win: Page,
  alvo: { phase: string; discoveryId: string; planId?: string; workItemId?: string },
): Promise<void> {
  const entrada = {
    phase: alvo.phase,
    discoveryId: alvo.discoveryId,
    planId: alvo.planId ?? null,
    workItemId: alvo.workItemId ?? null,
    workspace: { target_repo: REPO_ALVO, repo_path: null, worktree_path: null, branch: 'feat/fila-observavel' },
    continuesSessionId: null,
    handoffReason: null,
  };

  const resultado = await win.evaluate(async (input) => {
    const api = (window as unknown as {
      donel: { esteira: { dispatch(entrada: unknown): Promise<{ ok: boolean; reason?: string }> } };
    }).donel.esteira;
    return api.dispatch(input);
  }, entrada);

  if (!resultado.ok) throw new Error(`o disparo da fase ${alvo.phase} foi recusado: ${resultado.reason ?? 'sem motivo'}`);
}
