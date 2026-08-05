import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, type RoteiroContexto } from '../lib/captura';

// Roteiro `mapa-de-nos` — o overlay de grafo em tela cheia (spec 010, D1): a
// mesma esteira, outra projeção (discovery → planos → itens, sem modelo
// novo), aberta por um botão de navegação rápida na titlebar.
//
// Vale como e2e E como tutorial. O que os prints precisam provar:
//
//   abrir     →  o botão só existe no Modo Dev, e cobre a janela inteira
//   hover     →  um nó mostra o resumo de UMA frase, sem clicar
//   clique    →  fecha o overlay e leva o card ATÉ o nó clicado — é
//                navegação, não só desenho
//
// A seedagem reaproveita a MESMA técnica de `seed-discovery.spec.ts`
// (Semear trabalho em curso → Exemplo → Semear): este roteiro não inventa um
// segundo jeito de colocar dado no histórico.

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'mapa-de-nos' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('abrir o mapa de nós, passar o mouse e navegar por um clique', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    // ── Ligar o Modo Dev e semear um card (mesma técnica de seed-discovery) ──
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'O mapa de nós só existe aqui — mesma condição do resto da Esteira nova.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await esteiraToggle.click();

    const seedToggle = win.getByTestId('esteira-seed-toggle');
    await seedToggle.waitFor({ timeout: 15_000 });
    await seedToggle.click();

    const exemplo = win.getByRole('button', { name: 'Exemplo', exact: true });
    await exemplo.waitFor({ timeout: 10_000 });
    await exemplo.click();

    const semear = win.getByRole('button', { name: 'Semear', exact: true });
    await semear.click();

    await win.locator('button', { hasText: 'O que ja esta em andamento' }).first().waitFor({ timeout: 10_000 });

    // ── Abrir o mapa de nós ──────────────────────────────────────────────
    const grafoToggle = win.getByTestId('node-graph-toggle');
    await passo(
      'Abra o mapa de nós',
      grafoToggle,
      'Botão de navegação rápida, ao lado do da Esteira — mesmo lugar, outro jeito de olhar o mesmo histórico.',
    );
    await grafoToggle.click();

    const overlay = win.getByTestId('node-graph-overlay');
    await overlay.waitFor({ timeout: 15_000 });
    await passo(
      'O grafo cobre a janela inteira',
      null,
      'Discovery → plano → itens, em colunas por profundidade (BFS a partir do discovery) — o mesmo histórico do card ao lado, só que de ponta a ponta.',
    );

    // ── Hover: o resumo de uma frase, sem clicar ────────────────────────
    const noDiscovery = win.locator('[data-testid="node-graph-node"][data-kind="discovery"]');
    await passo('Passe o mouse sobre um nó', noDiscovery, 'Nenhum clique ainda — só olhar já mostra do que se trata.');
    await noDiscovery.hover();

    const resumo = win.getByTestId('node-graph-hover-summary');
    await passo(
      'O resumo de uma frase aparece embaixo',
      resumo,
      'O mesmo texto que o resto do app usa para este nó — nasce uma vez, na camada pura, nunca de novo aqui.',
    );

    // ── Clique: fecha o overlay e navega até o nó ───────────────────────
    const noItem = win.locator('[data-testid="node-graph-node"][data-kind="work_item"]', { hasText: 'O item que esta em curso' });
    await passo(
      'Clique num nó',
      noItem,
      'O grafo é controle de navegação, não só visualização: o clique fecha o mapa e leva o card até este item.',
    );
    await noItem.click();

    await overlay.waitFor({ state: 'hidden', timeout: 15_000 });

    const detalhe = win.getByTestId('devmode-details-title');
    await detalhe.waitFor({ timeout: 10_000 });
    await passo(
      'O painel de detalhe mostra o item clicado',
      detalhe,
      'Fechou o overlay já em cima do nó certo — "O item que esta em curso", o mesmo que foi clicado no grafo, não o card genérico.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});
