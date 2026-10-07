import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `ciclo-completo-de-item` — um item do plano ao desfecho, com os
// emissores REAIS das seis fases da skill 3.0 (spec 010, batch B7).
//
// O que ele existe para mostrar, estado por estado:
//
//   implementar declara o que dá para conferir  →  "verificação passou"
//   validar declara o PR ainda não verificado   →  "PR aberto, ainda não verificado"
//   documentar declara ONDE o documento ficou   →  a fase concluída, com ponteiro
//   concluir declara a evidência que fecha      →  "PR mergeado e verificado"
//   fase que promete e não cumpre               →  "não consegui ler", com o motivo
//
// O último é o que mais importa: desde B7, uma fase bem-sucedida que não
// declara os fatos que ela promete é RECUSADA na ingestão. Antes ela entrava
// calada e o card dizia "validar — concluída" sem nada por trás.
//
// Uma limitação aparece de propósito nos prints: o seletor da tela ainda não
// escolhe o ASSUNTO do disparo (é o batch B2), então só a fase Discovery é
// disparada pelo botão. As outras usam a mesma porta que o botão usa
// (`window.donel.esteira.dispatch`) — nenhum arquivo é forjado por fora.

const ID_PLANO = 'pln-ciclo-01';
const ID_ITEM = 'wi-ciclo-01';
const REPO_ALVO = 'donel-dev';
const URL_PR = 'https://github.com/exemplo/donel-dev/pull/128';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'ciclo-completo-de-item' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o ciclo completo de um item', async () => {
  test.setTimeout(300_000);
  const { win, passo } = ctx;

  try {
    // ── Entrar na tela ───────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'O ciclo da esteira só existe no modo de trabalho de dev.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await passo('Abra a Esteira', esteiraToggle, 'O mapa de hoje continua vivo por baixo, intocado.');
    await esteiraToggle.click();
    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });

    // ── O card ───────────────────────────────────────────────────────────
    const titulo = win.getByLabel('Novo discovery');
    await passo('Descreva o que está em jogo', titulo, 'O repo alvo aqui vira o default dos itens — e item de código sem repo não dispara.');
    await titulo.fill('Fila de importação trava sem sinal');
    await win.getByLabel('Repo alvo (opcional)').fill(REPO_ALVO);

    const criar = win.getByRole('button', { name: 'Criar' });
    await passo('Crie o card', criar);
    await criar.click();

    const cardNaLista = win.locator('button', { hasText: 'Fila de importação trava sem sinal' }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });

    // ── Discovery, pelo botão ────────────────────────────────────────────
    const preparar = win.getByRole('button', { name: 'Preparar' });
    await passo('Prepare a fase Discovery', preparar, 'O app separa o contexto no inbox e trava o card. Quem roda a fase é a skill.');
    await preparar.click();
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });

    const discoveryId = lerDiscoveryId(ctx.esteiraRoot);
    const varrer = win.getByRole('button', { name: 'Varrer outbox' });

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
      {
        type: 'relation.recorded',
        relation: 'originated',
        from: { entity: 'discovery', id: discoveryId },
        to: { entity: 'plan', id: ID_PLANO },
      },
      // A18 — a fase de conversa só fecha com o que alguém disse.
      { type: 'decision.recorded', subject: { entity: 'discovery', id: discoveryId }, decision: 'instrumentar antes de mexer no consumo', confirmed_by: 'dono do repo' },
      { type: 'phase.completed', subject: { entity: 'discovery', id: discoveryId }, phase: 'discovery', outcome: 'done', summary: 'Um plano proposto.' },
    ]);

    await passo('Varra o outbox', varrer, 'O watcher já ingere sozinho quando o arquivo chega; o botão força a leitura na hora.');
    await varrer.click();
    await win.getByText('Planejado').first().waitFor({ timeout: 10_000 });

    // ── Plano: o item nasce declarado pela skill (D-16) ──────────────────
    await prepararFase(win, { phase: 'plano', discoveryId, planId: ID_PLANO });
    emitir(ctx.esteiraRoot, [
      {
        type: 'work_item.recorded',
        work_item_id: ID_ITEM,
        plan_id: ID_PLANO,
        item_type: 'issue',
        title: 'Expor estado da fila no endpoint de saúde',
        target_repo: REPO_ALVO,
      },
      { type: 'decision.recorded', subject: { entity: 'plan', id: ID_PLANO }, decision: 'um item só, para o ciclo caber numa rodada', confirmed_by: 'dono do repo' },
      { type: 'phase.completed', subject: { entity: 'plan', id: ID_PLANO }, phase: 'plano', outcome: 'done', summary: 'Um item.' },
    ]);
    await varrer.click();
    await win.getByText('Expor estado da fila no endpoint de saúde').waitFor({ timeout: 10_000 });
    await passo(
      'O plano declara o item — e o app não cria item nenhum sozinho',
      win.getByText('Expor estado da fila no endpoint de saúde'),
      'Criação de item passa sempre pela skill. O item nasce "aberto": o estado dele é do modelo, e a tela o diz em português.',
    );

    // ── Implementar ──────────────────────────────────────────────────────
    await prepararFase(win, { phase: 'implementar', discoveryId, planId: ID_PLANO, workItemId: ID_ITEM });
    await varrer.click();
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });
    await passo(
      'A fase Implementar fica preparada — e a tela não a chama de "em andamento"',
      win.getByText('Preparada — ninguém assumiu ainda'),
      'A trava é fato com dono, hora e sessão. Ela aparece no card e sai num gesto: não existe arquivo .lock nem etiqueta remota. Repare no item logo abaixo: continua "aberto". Preparar não é começar — nem para a fase, nem para o item.',
    );

    emitir(ctx.esteiraRoot, [
      { type: 'verification.recorded', subject: item(), verification_kind: 'check', state: 'passed', ref: 'npm test' },
      { type: 'phase.completed', subject: item(), phase: 'implementar', outcome: 'done', summary: 'Endpoint e teste escritos.' },
    ]);
    await varrer.click();
    await win.getByText('verificação passou').waitFor({ timeout: 10_000 });
    await passo(
      'Implementar declara o que dá para conferir',
      win.getByTestId('esteira-verificacoes'),
      'O contrato cobra: fase Implementar bem-sucedida sem uma verificação declarada é recusada. "Implementei" sem nada conferível é afirmação sem lastro.',
    );

    // ── Validar ──────────────────────────────────────────────────────────
    await prepararFase(win, { phase: 'validar', discoveryId, planId: ID_PLANO, workItemId: ID_ITEM });
    emitir(ctx.esteiraRoot, [
      { type: 'verification.recorded', subject: item(), verification_kind: 'pull-request', state: 'pending', ref: URL_PR },
      { type: 'artifact.recorded', owner: item(), artifact_kind: 'review-report', location: 'disk', path: 'C:/tmp/review-wi-ciclo-01.md' },
      { type: 'phase.completed', subject: item(), phase: 'validar', outcome: 'done', summary: 'Review sem bloqueio.' },
    ]);
    await varrer.click();
    await win.getByText('PR aberto, ainda não verificado').waitFor({ timeout: 10_000 });
    await passo(
      'Validar registra o PR — aberto, ainda não verificado',
      win.getByText('PR aberto, ainda não verificado'),
      'O PR foi aberto por uma pessoa: nenhuma fase da esteira abre PR. A skill só REGISTRA o estado dele, e "aberto" não é "verificado".',
    );

    // ── Documentar ───────────────────────────────────────────────────────
    await prepararFase(win, { phase: 'documentar', discoveryId, planId: ID_PLANO, workItemId: ID_ITEM });
    emitir(ctx.esteiraRoot, [
      { type: 'artifact.recorded', owner: item(), artifact_kind: 'adr', location: 'repo', repo: REPO_ALVO, path: 'docs/adr/0007-estado-da-fila.md' },
      { type: 'phase.completed', subject: item(), phase: 'documentar', outcome: 'done', summary: 'ADR no repo âncora.' },
    ]);
    await varrer.click();
    await win.getByText('documentar — concluída').waitFor({ timeout: 10_000 });
    await passo(
      'Documentar só conclui com o ponteiro do documento',
      win.getByText('documentar — concluída'),
      'O contrato cobra `artifact.recorded` desta fase: documento sem endereço declarado não responde "cadê o artefato?". O ponteiro está no histórico — a tela ainda não o mostra.',
    );

    // ── Concluir ─────────────────────────────────────────────────────────
    await prepararFase(win, { phase: 'concluir', discoveryId, planId: ID_PLANO, workItemId: ID_ITEM });
    emitir(ctx.esteiraRoot, [
      // A MESMA referência do PR, agora verificada: a chave natural é
      // assunto+tipo+ref, então o card atualiza o estado em vez de mostrar dois PRs.
      { type: 'verification.recorded', subject: item(), verification_kind: 'pull-request', state: 'passed', ref: URL_PR },
      { type: 'phase.completed', subject: item(), phase: 'concluir', outcome: 'done', summary: 'PR mergeado e verificado.' },
    ]);
    await varrer.click();
    await win.getByText('PR mergeado e verificado').waitFor({ timeout: 10_000 });
    await passo(
      'Concluir exige a evidência que fecha o ciclo',
      win.getByTestId('esteira-verificacoes'),
      'Concluir com outcome "done" sem uma verificação que passou é recusado na emissão E na ingestão. Se não passou, o desfecho honesto é abandonado ou inconclusivo.',
    );

    await passo(
      'O card depois das seis fases',
      cardNaLista,
      'A etapa do card é calculada do grafo (D-13), nunca digitada: seis fases concluídas e o PR verificado deixam o item "concluído" e o card em "Concluído". Na primeira captura deste roteiro ele dizia "Planejado" com o item "aberto" — a etapa não mentia por desenho, mentia porque nada movia o item.',
    );

    // ── O estado ruim, de propósito ──────────────────────────────────────
    escreverFaseIncompleta(ctx.esteiraRoot, discoveryId);
    await varrer.click();
    await win.getByText('não consegui ler').first().waitFor({ timeout: 10_000 });
    await passo(
      'Fase que promete e não cumpre vira erro visível',
      win.getByText('não consegui ler').first(),
      'Uma fase "validar" bem-sucedida que não declara o que verificou é recusada inteira. Antes de B7 ela entrava calada, e o card dizia "concluída" sem nada por trás.',
    );
    await passo(
      'O erro tem caminho e motivo',
      win.locator('section', { hasText: 'Não consegui ler' }).last(),
      'O arquivo continua no outbox: o trabalho da skill não se perdeu — só não foi lido. "Não consegui ler" é um estado; "não realizada" seria uma afirmação.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou.
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

/**
 * Prepara uma fase pela MESMA porta que o botão usa. O seletor da tela ainda
 * não escolhe o assunto do disparo (batch B2), e forjar um `run-input.json` por
 * fora provaria o contrato contra um dublê — que é justamente o que a spec 010
 * existe para não fazer.
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

  if (!resultado.ok) throw new Error(`o app recusou preparar a fase "${alvo.phase}": ${resultado.reason ?? 'sem motivo'}`);
}

/**
 * A skill de verdade responde: o `emit_result.py` do fork, contra o input que o
 * app acabou de gravar. Sem dublê — assim o roteiro prova o contrato dos dois
 * lados, não só o do app.
 */
function emitir(esteiraRoot: string, facts: unknown[]): void {
  const inputPath = ultimoInput(esteiraRoot);
  const factsPath = path.join(esteiraRoot, 'facts.json');
  writeFileSync(factsPath, JSON.stringify(facts), 'utf8');

  execFileSync(
    'python',
    ['emit_result.py', '--input', inputPath, '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high'],
    { cwd: path.join(REPO_ROOT, 'skills', 'esteira-donel-3.0.0', 'tools'), encoding: 'utf8' },
  );
}

/**
 * Uma fase `validar` bem-sucedida que NÃO declara o que verificou. Escrita à
 * mão de propósito: o emissor da skill recusaria produzi-la, e é o app que
 * precisa provar que também recusa lê-la.
 */
function escreverFaseIncompleta(esteiraRoot: string, discoveryId: string): void {
  writeFileSync(
    path.join(esteiraRoot, 'outbox', 'validar-sem-verificacao.json'),
    JSON.stringify({
      contract_version: '1.0.0',
      kind: 'esteira.result',
      run: {
        run_id: 'run-validar-incompleto',
        phase: 'validar',
        status: 'success',
        started_at: '2026-08-04T12:00:00.000Z',
        finished_at: '2026-08-04T12:20:00.000Z',
        failure: null,
      },
      actor: { tool: 'esteira-donel', tool_version: '3.0.0' },
      subject: { discovery_id: discoveryId, plan_id: ID_PLANO, work_item_id: ID_ITEM },
      facts: [{ type: 'phase.completed', subject: { entity: 'work_item', id: ID_ITEM }, phase: 'validar', outcome: 'done' }],
    }),
    'utf8',
  );
}
