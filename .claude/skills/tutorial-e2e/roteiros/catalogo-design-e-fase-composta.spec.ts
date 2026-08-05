import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, type RoteiroContexto } from '../lib/captura';

// Roteiro `catalogo-design-e-fase-composta` — N8 (05/08): o catálogo de fases
// ganhou DESIGN (E1), antes de Implementar, e perdeu a linha própria de
// Documentar (E5): Validar e Documentar viram UMA fase composta, porque
// nenhuma das três fronteiras que justificam fase separada (gate humano ·
// olho novo · orçamento de contexto) separa as duas.
//
// Roteiro curto de propósito: a mudança é de catálogo — a oferta que a tela
// faz —, não de tela nova. O que os prints precisam provar:
//
//   Design aparece         → antes de Implementar, na ordem do catálogo
//   Validar mostra os dois → o rótulo diz "Validar + Documentar"
//   Documentar sozinho     → NÃO existe mais como linha própria
//   o mapa concorda        → a trilha de um item sem histórico oferece
//                              Design como próxima, não mais Implementar
//
// O item usado é o do próprio exemplo de seed (`SEED_DOCUMENT_EXAMPLE`): ele
// não tem NENHUMA fase própria registrada (só o discovery, ao nível do card,
// está `done`) — candidato certo para mostrar qual fase o catálogo oferece
// primeiro a um item que ainda não andou.

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'catalogo-design-e-fase-composta' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o catálogo novo aparece no disparo e no mapa', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    // ── Entrar no Modo Dev — ele abre no mapa ────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'O controle do meio da barra de título troca a janela entre uso geral e trabalho de dev. O Modo Dev abre no mapa.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const mapa = win.getByTestId('devmode-map');
    await mapa.waitFor({ timeout: 20_000 });

    // ── Semear o exemplo padrão — o item sem fase própria ainda ──────────
    const abrirPainel = mapa.getByTestId('devmode-entry-trigger');
    await passo('Abra o painel do store para semear', abrirPainel, 'O painel do store é onde se cria e se semeia; o mapa é a projeção do que ele guarda.');
    await abrirPainel.click();

    const painel = win.locator('section[aria-label="Esteira"]');
    await painel.waitFor({ timeout: 15_000 });

    const seedToggle = painel.getByTestId('esteira-seed-toggle');
    await passo('Abra "Semear trabalho em curso"', seedToggle, 'O exemplo padrão traz um discovery concluído, um plano e dois itens — nenhum dos dois com fase própria registrada ainda.');
    await seedToggle.click();

    const documento = painel.getByTestId('esteira-seed-doc');
    await documento.waitFor({ timeout: 10_000 });
    const exemplo = painel.getByRole('button', { name: 'Exemplo', exact: true });
    await passo('Comece pelo exemplo', exemplo, 'O botão preenche o documento canônico — é ele que dá o item "fresco" que este roteiro precisa.');
    await exemplo.click();

    const semear = painel.getByRole('button', { name: 'Semear', exact: true });
    await passo('Semeie', semear, 'O card nasce e se seleciona sozinho — é aqui que o catálogo de disparo aparece.');
    await semear.click();

    await painel.locator('button', { hasText: 'O que ja esta em andamento' }).first().waitFor({ timeout: 10_000 });

    // ── O catálogo de disparo, com a linha nova e a linha fundida ────────
    // Alvo é o CHIP, não a linha inteira (`dispatch-phases`): a legenda do
    // relatório usa a primeira linha do innerText do alvo, e um container com
    // seis botões vira "Circulado: Discovery" — a foto mostra o anel em volta
    // de tudo, a legenda nomeia só o primeiro. Achado da própria captura
    // (05/08); os roteiros irmãos (disparo-por-assunto) já ancoram no chip.
    const chipDesign = painel.getByTestId('dispatch-phase-design');
    await chipDesign.waitFor({ timeout: 10_000 });
    await passo(
      'Design entrou no catálogo, antes de Implementar',
      chipDesign,
      'E1 — mockup e diagrama de arquitetura se veem ANTES de codar (F11). O nome da fase é livre (run.phase continua string) — só a OFERTA da tela ganhou a linha nova, o contrato não mudou. (A linha inteira do catálogo aparece no print — Discovery, Plano, Design, Implementar, Validar+Documentar, Concluir, nessa ordem.)',
    );

    const chipValidar = painel.getByTestId('dispatch-phase-validar');
    await passo(
      'Validar e Documentar viram uma linha só',
      chipValidar,
      'E5 — nenhuma das três fronteiras que justificam fase separada (gate humano, olho novo, orçamento de contexto) separa as duas: Documentar escreve com o que Validar acabou de construir, na mesma sessão. A fase composta declara os dois `phase.completed` (A22); o catálogo mostra uma linha.',
    );

    // O ponto que uma omissão deixaria passar batido: sem chip próprio para
    // "documentar", a fusão da E5 realmente aconteceu na tela, não só no texto.
    const chipDocumentar = painel.getByTestId('dispatch-phase-documentar');
    if ((await chipDocumentar.count()) > 0) {
      throw new Error('o catálogo ainda oferece "documentar" como fase própria — a fusão da E5 não chegou à tela');
    }

    const fecharPainel = painel.getByRole('button', { name: 'Fechar', exact: true });
    await passo('Volte ao mapa', fecharPainel, 'O painel é onde se AGE; o mapa é a projeção — a trilha do item conta a mesma história do outro lado.');
    await fecharPainel.click();

    // ── O mapa concorda: a trilha do item oferece Design primeiro ────────
    const itemFresco = mapa
      .locator('[data-testid="devmode-map-card"][data-kind="item"]')
      .filter({ hasText: 'O item que esta em curso' })
      .first();
    await itemFresco.waitFor({ timeout: 15_000 });
    await passo('Escolha o item que ainda não tem fase própria', itemFresco, 'O clique de seleção é no topo do card — o corpo inteiro inclui a trilha, que escolheria uma etapa em vez do nó.');
    await itemFresco.locator('[class*="cardTop"]').click();
    await win.waitForTimeout(420); // o carrossel assenta a transição de foco antes da foto

    const trilha = mapa.getByTestId('devmode-trilha-step').filter({ hasText: 'design' }).first();
    await trilha.waitFor({ timeout: 15_000 });
    await passo(
      'A trilha do item concorda: a próxima é Design',
      trilha,
      'Nenhuma fase rodou neste item ainda — o mapa lê a mesma tabela do catálogo (`catalogPhasesFor`) para achar a próxima, e agora ela começa em Design em vez de Implementar.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});
