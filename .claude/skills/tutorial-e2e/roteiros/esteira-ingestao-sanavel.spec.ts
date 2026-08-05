import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, type RoteiroContexto } from '../lib/captura';

// Roteiro `esteira-ingestao-sanavel` — o batch N9 (010): a ingestão ganha uma
// rota de correção, e o item descartado ganha lápide. Três estados que o
// modelo anterior não sabia dizer:
//
//   erro de ingestão   →  diz o CUSTO (o que nunca chegou a existir), não só o campo que quebrou (A5)
//   arquivo consertado →  o erro é ARQUIVADO como fato — "voltou a ler", não silêncio (A6)
//   item descartado    →  ganha lápide — o card responde "por que ele sumiu?" (E2)
//
// Um card só, uma narrativa só: semeia o card com um item; um result.json
// quebrado (que declara OUTRO item) chega ao outbox; conserta; descarta o
// item semeado. Cada passo fotografa o que a tela diz NAQUELE instante.

let ctx: RoteiroContexto;

const TITULO = 'Fila de importação trava sem sinal';
const ITEM_SEMEADO = 'Instrumentar a fila';
const ITEM_DO_ARQUIVO = 'Consumir a fila instrumentada';

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'esteira-ingestao-sanavel' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('erro diz o custo, arquivo consertado vira fato arquivado, item descartado ganha lápide', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    // ── Entrar na Esteira ────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'O controle do meio da barra de título troca a janela entre uso geral e trabalho de dev.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await esteiraToggle.click();
    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });

    // ── Semear o card, com o item que será descartado depois ───────────────
    // D-2: plantar trabalho que já está em curso é o caminho para não precisar
    // encenar uma fase inteira só para ter um item na tela.
    const seedToggle = win.getByTestId('esteira-seed-toggle');
    await passo('Abra o seed', seedToggle, 'D-2 — o caminho explícito para plantar um discovery que já existe, com plano e itens em curso. Nasce marcado como "semeado": afirmação de gente, não fato observado.');
    await seedToggle.click();

    const seedDoc = win.getByTestId('esteira-seed-doc');
    await seedDoc.fill(
      JSON.stringify({
        discovery: { title: TITULO, problem: 'Lotes grandes ficam pendentes sem erro e sem log.', target_repo: 'donel-dev', scope_repos: ['donel-dev'] },
        phases: [],
        plans: [{ ref: 'p1', title: 'Tornar o estado da fila observável', summary: null }],
        items: [{ title: ITEM_SEMEADO, type: 'spike', state: 'open', plan: 'p1' }],
      }),
    );
    const semear = win.getByRole('button', { name: 'Semear' });
    await passo('Semeie o card com o item em curso', semear);
    await semear.click();

    const cardNaLista = win.locator('button', { hasText: TITULO }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });
    await passo('O card nasce com o item já em curso — marcado como semeado', cardNaLista, 'O chip "semeado" ao lado do item diz que isto foi afirmado por uma pessoa, não observado de uma execução da skill.');

    // ── Um result.json fora do contrato chega ao outbox ────────────────────
    // Ele declara um SEGUNDO item (o que "nunca chegaria a existir" — A5),
    // mas tem um campo que só a skill conhece: o app recusa o documento
    // inteiro, não meio documento.
    const discoveryId = ultimoDiscoveryId(ctx.esteiraRoot);
    const resultPath = path.join(ctx.esteiraRoot, 'outbox', 'run-e2e-quebrado.json');
    escreverResultado(resultPath, discoveryId, { comCampoDesconhecido: true });

    const varrer = win.getByRole('button', { name: 'Varrer outbox' });
    await passo('Varra o outbox', varrer, 'O watcher já ingere sozinho quando o arquivo chega; o botão força a leitura na hora.');
    await varrer.click();

    const naoConsegui = win.getByText('Não consegui ler').first();
    await naoConsegui.waitFor({ timeout: 10_000 });
    await naoConsegui.scrollIntoViewIfNeeded();
    await passo('O documento fora do contrato vira erro visível', naoConsegui, 'O campo que só a skill conhece aparece com o caminho do arquivo e o motivo — nunca silêncio.');

    // A5 — o CUSTO: não é só "um campo quebrou", é "por isso a task não abre".
    const custo = win.getByText(/Sem este arquivo não existe/).first();
    await custo.waitFor({ timeout: 10_000 });
    await custo.scrollIntoViewIfNeeded();
    await passo(
      'A5 — o card diz o CUSTO, não só o campo que quebrou',
      custo,
      'É a diferença entre "unknown_field em facts[1].fanout_cards" e "por isso o item «Consumir a fila instrumentada» não existe". O dono viveu isso como "não consigo abrir as tasks".',
    );

    // ── O arquivo é consertado — o erro vira FATO ARQUIVADO ─────────────────
    escreverResultado(resultPath, discoveryId, { comCampoDesconhecido: false });
    await varrer.click();

    const itemChegou = win.locator('[data-testid="esteira-item"]', { hasText: ITEM_DO_ARQUIVO });
    await itemChegou.waitFor({ timeout: 10_000 });
    await passo('Consertado, o item que o arquivo declarava aparece de verdade', itemChegou, 'O mesmo arquivo, no mesmo caminho — agora dentro do contrato.');

    const arquivado = win.getByText('Erros arquivados').first();
    await arquivado.waitFor({ timeout: 10_000 });
    await arquivado.scrollIntoViewIfNeeded();
    await passo(
      'A6 — o erro superado vira FATO, não desaparecimento em silêncio',
      arquivado,
      '"Voltou a ler" — o `ingest.failed` original continua no histórico; isto diz que ele foi superado, não que nunca existiu.',
    );

    // ── Descartar o item semeado — ele ganha lápide ─────────────────────────
    const itemSemeado = win.locator('[data-testid="esteira-item"]', { hasText: ITEM_SEMEADO });
    const descartar = itemSemeado.getByRole('button', { name: 'Descartar' });
    await passo('Descarte o item semeado', descartar, 'D-16 — descartar é um gesto só, sem bloqueio. O item sai da lista viva; o fato de ele ter existido fica no histórico.');
    await descartar.click();

    const lapide = win.getByTestId('esteira-tombstones');
    await lapide.waitFor({ timeout: 10_000 });
    await lapide.scrollIntoViewIfNeeded();
    await passo(
      'E2 — a lápide: o item saiu, mas o card ainda responde "por que ele sumiu?"',
      lapide,
      'Ele não vira órfão calado: tipo, quando saiu, e — quando declarado — por quê. Notas e fases que apontavam para ele continuam contando como histórico do card.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

/** O id do discovery mais recente no store isolado — o seed não o mostra em texto plano na tela. */
function ultimoDiscoveryId(esteiraRoot: string): string {
  const eventsPath = path.join(esteiraRoot, 'store', 'events.jsonl');
  const linhas = readFileSync(eventsPath, 'utf8').split('\n').filter((linha) => linha.trim().length > 0);
  const eventos = linhas.map((linha) => JSON.parse(linha));
  const criado = [...eventos].reverse().find((evento) => evento.type === 'discovery.created');
  if (criado === undefined) throw new Error('nenhum discovery.created no log — o seed não gravou');
  return criado.payload.id as string;
}

/**
 * Um `result.json` que declara um item novo, com ou sem o campo que só a
 * skill conhece. Mesmo `run_id`, mesmo caminho: é a MESMA tentativa, corrigida
 * — não um arquivo novo — porque é assim que a recuperação (A6) se ancora.
 */
function escreverResultado(resultPath: string, discoveryId: string, options: { readonly comCampoDesconhecido: boolean }): void {
  const workItemFact: Record<string, unknown> = {
    type: 'work_item.recorded',
    work_item_id: 'wi-e2e-consumir',
    plan_id: null,
    item_type: 'issue',
    title: 'Consumir a fila instrumentada',
    target_repo: 'donel-dev',
    scope_repos: [],
  };
  if (options.comCampoDesconhecido) workItemFact.fanout_cards = ['card-1'];

  writeFileSync(
    resultPath,
    JSON.stringify({
      contract_version: '1.0.0',
      kind: 'esteira.result',
      run: {
        run_id: 'run-e2e-quebrado',
        phase: 'discovery',
        status: 'success',
        started_at: '2026-08-05T12:00:00.000Z',
        finished_at: '2026-08-05T12:10:00.000Z',
        failure: null,
      },
      actor: { tool: 'esteira-donel', tool_version: '3.0.0', executor: null, model: null, effort: null, cli_session_id: null },
      subject: { discovery_id: discoveryId, plan_id: null, work_item_id: null },
      workspace: null,
      facts: [
        { type: 'discovery.recorded', discovery_id: discoveryId, title: TITULO, problem: null, tracker: null, target_repo: 'donel-dev', scope_repos: [] },
        workItemFact,
        {
          type: 'decision.recorded',
          subject: { entity: 'discovery', id: discoveryId },
          decision: 'consumir a fila só depois de instrumentada',
          confirmed_by: 'dono do repo',
          rationale: null,
        },
        { type: 'phase.completed', subject: { entity: 'discovery', id: discoveryId }, phase: 'discovery', outcome: 'done', summary: null, risk: null, channel: null },
      ],
    }),
    'utf8',
  );
}
