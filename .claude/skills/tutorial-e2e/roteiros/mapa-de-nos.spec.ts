import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, type RoteiroContexto } from '../lib/captura';

// Roteiro `mapa-de-nos` — o overlay de grafo em tela cheia (spec 010, D1): a
// mesma esteira, outra projeção (discovery → planos → itens, sem modelo
// novo), aberta por um botão de navegação rápida na titlebar.
//
// 012 Esteira 4.0 / wi-esteira4-mapa-grafos — a CAMADA VISUAL foi refeita de
// novo, agora com o motor ratificado pelo dono (A — d3-force + SVG próprio,
// `specs/012-esteira-4/mapa-grafos-escolha.md`), na forma fixada em
// D-M1..D-M8: grafo estilo Obsidian forçado à horizontal — círculos com
// rótulo embaixo, tamanho por tipo, cor por estado, hover com tooltip e
// realce de vizinhança. A versão React Flow (F25) foi reprovada e saiu.
// O que este roteiro prova:
//
//   abrir      →  o botão só existe no Modo Dev, e cobre a janela inteira
//   desenho    →  nós circulares COM arestas entre eles (a regressão do
//                 primeiro commit do F25 eram nós soltos), assentados pela
//                 simulação com o tempo correndo da esquerda pra direita
//   hover      →  um nó mostra o tooltip com título, estado e resumo, sem
//                 clicar ("difícil de identificar o mapa")
//   clique     →  fecha o overlay e leva o card ATÉ o nó clicado, COM a aba
//                 da sessão viva em foco quando ela existe — é navegação, não
//                 só desenho ("não navega corretamente")
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
    // A simulação de força assenta em alguns segundos (e o enquadramento
    // automático acontece quando ela TERMINA — `on('end')` → fit). Fotografar
    // durante o ajuste desenha o grafo no lugar errado (mesma cautela do
    // achado 5c da versão anterior), então a primeira foto espera a física.
    const canvas = win.getByTestId('node-graph-canvas');
    await canvas.waitFor({ timeout: 15_000 });
    await win.waitForTimeout(7_000);

    // Herança do achado real do F25 (nós SOLTOS, zero aresta desenhada,
    // pego pelo dono nos prints): a mesma asserção, agora sobre o SVG
    // próprio — toda aresta é um `<line>` dentro do canvas. O olhar continua
    // sendo a etapa que prova o visual (linha, direção, cor), não a contagem.
    const nosNoDom = await win.locator('[data-testid="node-graph-node"]').count();
    const arestasNoDom = await canvas.locator('svg line').count();
    if (nosNoDom > 1 && arestasNoDom === 0) {
      throw new Error(`${nosNoDom} nós no grafo e nenhuma aresta desenhada — a simulação entregou links vazios?`);
    }

    await passo(
      'O grafo cobre a janela inteira',
      null,
      'Círculos com o rótulo embaixo (D-M1/D-M3): discovery e plano grandes, itens médios, artefatos e verificações pequenos como satélites — e o tempo correndo da esquerda para a direita, assentado por simulação de força, não por coordenada à mão. A cor de cada círculo é o estado (D-M2): verde concluído, azul rodando, âmbar esperando o dono, vermelho travado, cinza vazado ainda não começou.',
    );

    // ── Enquadrar: o reencontro com o grafo depois de pan/zoom ──────────
    const enquadrar = win.getByTestId('node-graph-fit');
    await passo(
      'O botão Enquadrar fica no canto',
      enquadrar,
      'Depois de qualquer pan/zoom/arrasto, um clique traz o grafo inteiro de volta para a janela.',
    );

    // ── Hover: tooltip com título, estado e resumo, sem clicar (D-M4) ───
    const noDiscovery = win.locator('[data-testid="node-graph-node"][data-kind="discovery"]');
    await passo('Passe o mouse sobre um nó', noDiscovery, 'Nenhum clique ainda — só olhar já mostra do que se trata. O nó e os vizinhos ficam acesos; o resto do grafo apaga (o gesto do Obsidian).');
    await noDiscovery.hover();

    const tooltip = win.getByTestId('node-graph-tooltip');
    await tooltip.waitFor({ timeout: 10_000 });
    await passo(
      'O tooltip aparece ao lado do mouse',
      tooltip,
      'Título, estado (com a cor do nó) e o resumo de uma frase — o mesmo texto que o resto do app usa para este nó, nascido uma vez na projeção, nunca de novo aqui.',
    );

    // ── Clique: fecha o overlay e navega até o nó ───────────────────────
    const noItem = win.locator('[data-testid="node-graph-node"][data-kind="work_item"]', { hasText: 'O item que esta em curso' });
    await passo(
      'Clique num nó',
      noItem,
      'O grafo é controle de navegação, não só visualização: o clique fecha o mapa, leva o card até este item e alterna para a aba da sessão viva dele, quando existe.',
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
