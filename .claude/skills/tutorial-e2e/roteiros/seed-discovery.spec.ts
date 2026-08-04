import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, type RoteiroContexto } from '../lib/captura';

// Roteiro `seed-discovery` — plantar um discovery que JÁ está em andamento
// (spec 010, D-2), sem editar JSON na mão dentro do histórico.
//
// Vale como e2e E como tutorial. O que os prints precisam provar:
//
//   documento errado  →  nada é escrito, e a recusa diz QUAL campo
//   etapa             →  DERIVADA dos fatos semeados, nunca digitada
//   semeado           ≠  declarado por skill (afirmação ≠ fato observado)
//   disparo           →  funciona igual em cima de um card semeado
//
// O caminho ruim vem ANTES do feliz de propósito: é o estado que o leitor
// precisa reconhecer, e é onde a promessa "sem edição manual às cegas" se
// cumpre ou se desmente.

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'seed-discovery' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

/** Nomes genéricos de propósito: o relatório circula, e vocabulário interno não vaza nele. */
const TITULO = 'Relatorio mensal atrasa sem ninguem ver';

const DOCUMENTO_QUEBRADO = `{
  "discovery": { "titulo": "${TITULO}" },
  "items": [
    { "title": "Instrumentar o gerador", "type": "issue", "state": "in-progress", "plan": "p1" }
  ]
}`;

const DOCUMENTO_BOM = `{
  "discovery": {
    "title": "${TITULO}",
    "problem": "O fechamento sai dias depois e ninguem sabe onde travou.",
    "target_repo": "atlas",
    "scope_repos": ["atlas"]
  },
  "phases": [
    { "phase": "discovery", "outcome": "done", "summary": "Dois gargalos mapeados." }
  ],
  "plans": [
    { "ref": "p1", "title": "Tornar o fechamento observavel", "summary": "Medir antes de mexer." }
  ],
  "items": [
    { "title": "Instrumentar o gerador do relatorio", "type": "issue", "state": "in-progress", "plan": "p1" },
    { "title": "Medir o custo do log", "type": "spike", "state": "open", "plan": "p1" }
  ]
}`;

test('plantar trabalho que já existe', async () => {
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
    await passo('Abra a Esteira', esteiraToggle, 'O ícone de rota só existe no Modo Dev.');
    await esteiraToggle.click();

    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });
    await passo(
      'A tela começa vazia — e diz isso',
      null,
      'O histórico nasce limpo: nada é importado do modelo antigo, por decisão. Semear é o caminho explícito para o trabalho que já existe.',
    );

    // ── Abrir o seed ─────────────────────────────────────────────────────
    const seedToggle = win.getByTestId('esteira-seed-toggle');
    await passo(
      'Abra "Semear trabalho em curso"',
      seedToggle,
      'Gesto de exceção, fechado por default: o dia a dia é criar um discovery novo; semear é descrever o que já estava rolando antes do app existir.',
    );
    await seedToggle.click();

    const documento = win.getByTestId('esteira-seed-doc');
    await documento.waitFor({ timeout: 10_000 });
    const exemplo = win.getByRole('button', { name: 'Exemplo', exact: true });
    await passo(
      'Comece pelo exemplo',
      exemplo,
      'O botão preenche um documento válido para editar por cima — página em branco é o que empurra qualquer um de volta para o JSON na mão.',
    );
    await exemplo.click();

    await passo(
      'Um documento só: o card, os planos, os itens e o ponto em que estão',
      documento,
      'É aqui que "em que ponto estão" é dito: o estado de cada item e as fases que já terminaram. A etapa do card NÃO se digita — ela sai daí.',
    );

    // ── O estado ruim, de propósito ──────────────────────────────────────
    await documento.fill(DOCUMENTO_QUEBRADO);
    const semear = win.getByRole('button', { name: 'Semear', exact: true });
    await passo(
      'Semeie um documento fora do formato — de propósito',
      semear,
      'Este documento tem quatro defeitos: "titulo" em vez de "title", o título faltando, um item apontando para um plano que ninguém declarou e uma issue sem repo alvo.',
    );
    await semear.click();

    const recusa = win.getByTestId('esteira-seed-issues');
    await recusa.waitFor({ timeout: 10_000 });
    await passo(
      'Nada foi escrito — e a recusa diz qual campo',
      recusa,
      'O histórico continua vazio: documento fora do formato não grava metade. O texto segue na tela para ser corrigido — é isto que "sem edição manual às cegas" quer dizer.',
    );

    // ── O caminho feliz ──────────────────────────────────────────────────
    await documento.fill(DOCUMENTO_BOM);
    await passo(
      'Corrija e semeie',
      semear,
      'Agora o documento descreve o discovery, um plano e dois itens — um deles em curso.',
    );
    await semear.click();

    const cardNaLista = win.locator('button', { hasText: TITULO }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });
    await passo(
      'O card aparece na etapa Execução',
      cardNaLista,
      'A etapa não foi digitada em lugar nenhum: ela sai da mesma tabela de sempre, aplicada sobre os fatos semeados — discovery concluído + plano + item em curso ⇒ Execução.',
    );

    // O critério de pronto do batch, verificado no arquivo e não no olho: os
    // eventos do seed carregam a proveniência no DISCO. Se ela só existisse na
    // tela, o próximo leitor do log leria afirmação como observação.
    conferirProvenienciaNoDisco(ctx.esteiraRoot);

    await passo(
      'A tela diz que aquilo foi SEMEADO, não declarado por uma skill',
      win.locator('p[class*="seededNote"]').first(),
      'Semear é afirmação de uma pessoa; o que vem por skill é fato observado. O card não pode apresentar os dois iguais — e o chip "semeado" aparece em cada linha que veio da afirmação.',
    );

    await passo(
      'A fase e os itens carregam a mesma marca',
      win.locator('section', { hasText: 'Planos e itens' }).last(),
      'Dois itens, um em curso; a fase "discovery — concluída" com o chip. Nenhuma dessas frases é "não realizada": ausência de dado nunca vira negação, e afirmação nunca vira observação.',
    );

    // ── Disparar uma fase em cima do card semeado ────────────────────────
    const seletorDeFase = win.locator('button[aria-haspopup="listbox"]').first();
    await passo('Escolha a fase', seletorDeFase, 'O card semeado tem plano: dá para tocar a fase seguinte a partir dele.');
    await seletorDeFase.click();

    const opcaoPlano = win.getByRole('option', { name: 'Plano' });
    await passo('Selecione "Plano"', opcaoPlano);
    await opcaoPlano.click();

    const preparar = win.getByRole('button', { name: 'Preparar', exact: true });
    await passo(
      'Prepare a fase',
      preparar,
      'O disparo não pergunta de onde o card veio: separa o contexto no inbox e trava o card, igual a qualquer outro.',
    );
    await preparar.click();

    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });
    await passo(
      'Disparar em cima do card semeado funciona igual',
      win.locator('section', { hasText: 'Preparada — ninguém assumiu ainda' }).last(),
      'O card está travado e NADA está rodando — a tela fala isso em vez de dizer "em andamento". A trava é fato local, com hora, e sai num clique.',
    );

    await passo(
      'A fase que o app acabou de preparar NÃO tem a marca',
      win.locator('section', { hasText: 'Fases' }).last(),
      'Duas linhas, duas origens: a fase semeada continua marcada como afirmação; a que o app preparou agora é fato dele. É essa diferença que o card precisa deixar ver.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

/**
 * "Pronto quando o `events.jsonl` mostra `source.kind: "seed"` nos eventos do
 * seed" — o critério do batch, conferido no arquivo. A tela pode mostrar a
 * marca certa por acidente; o log é o que o próximo leitor vai ler.
 */
function conferirProvenienciaNoDisco(esteiraRoot: string): void {
  const linhas = readFileSync(path.join(esteiraRoot, 'store', 'events.jsonl'), 'utf8').trim().split('\n').slice(1);
  const eventos = linhas.map((linha) => JSON.parse(linha) as { type: string; source: { kind: string } });

  const semeados = eventos.filter((evento) => evento.source.kind === 'seed');
  if (semeados.length === 0) throw new Error('nenhum evento com source.kind "seed" no events.jsonl');

  const tipos = semeados.map((evento) => evento.type);
  for (const esperado of ['discovery.created', 'plan.created', 'work_item.created', 'phase.completed']) {
    if (!tipos.includes(esperado)) throw new Error(`o seed não gravou "${esperado}" — só ${tipos.join(', ')}`);
  }
  // O documento quebrado não pode ter deixado rastro: recusa não escreve metade.
  if (semeados.length !== eventos.length) throw new Error('há evento no log que não veio do seed — a recusa gravou algo');
}
