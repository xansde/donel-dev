import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `mapa-sobre-o-store` — o batch B6 da spec 010: o mapa continua sendo
// a tela do Modo Dev, agora comendo do STORE.
//
// O mapa não saiu por ser ruim; ele saía de FOME. Lia `~/.claude/esteira-state/`
// fase a fase, e a skill 3.0 parou de escrever ali (D-3). A forma sobrevive
// inteira — carrossel de dois eixos, chips de fase, trilha no card em foco,
// painel de detalhe —, e o que muda é o que os nós significam:
//
//   discovery → cards de plano → fases (PR)   ⇒  discovery → planos → ITENS
//   7 fases fixas                             ⇒  fases em aberto [P-4]
//   tudo termina em PR                        ⇒  cada tipo tem seu ciclo [D-4]
//   estado lido do disco                      ⇒  macro etapa DERIVADA [D-13]
//
// Os quatro estados que os prints existem para separar (os mesmos de sempre):
//
//   preparada   ≠  em andamento
//   concluído   ≠  pela metade      ← o `spike` que respondeu "não dá"
//   não li      ≠  não aconteceu    ← a issue #35, revertida na origem
//   sem plano   ≠  não realizada
//
// ── Por que o `claude` aqui é um dublê ────────────────────────────────────
// Mesma razão do roteiro `disparo-abre-sessao` (B1): o CLI real abre com o
// diálogo de confiança de pasta num diretório novo, e `isReadyToPreType` — com
// razão — recusa escrever nesse estado; o roteiro travaria esperando um clique
// humano no passo que ele existe para provar. O dublê ainda DENUNCIA a quebra
// do invariante: qualquer `\r` que chegue ao PTY vira "ENTER RECEBIDO" na tela.

/** O card aponta para o repo de onde a suíte roda — nome calculado, nunca literal (numa worktree o nome é outro). */
const REPO_ALVO = path.basename(REPO_ROOT);
const TITULO_CARD = 'Fila de importação trava sem sinal';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  prepararClaudeDeMentira();
  ctx = await abrirDonel({ roteiro: 'mapa-sobre-o-store' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o mapa lê o store, e o que ele mostra é o modelo novo', async () => {
  test.setTimeout(300_000);
  const { win, passo } = ctx;

  const mapa = win.getByTestId('devmode-map');
  const detalhe = win.getByTestId('devmode-details-panel');
  const painelDoStore = win.locator('section[aria-label="Esteira"]');
  // Âncoras por `data-testid` + atributo, nunca por texto que o fluxo altera
  // (erro conhecido nº 5): o id do nó é gerado, então ele é atributo, não parte
  // do testid.
  const cardDoTipo = (kind: string) => mapa.locator(`[data-testid="devmode-map-card"][data-kind="${kind}"]`);

  try {
    // ── 1. O Modo Dev abre NO MAPA ───────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'O controle do meio da barra de título troca a janela entre uso geral e trabalho de dev.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    await mapa.waitFor({ timeout: 20_000 });
    await passo(
      'O mapa abre vazio — e diz por quê',
      mapa.getByTestId('devmode-map-empty'),
      'O histórico nasce limpo: nada foi importado do modelo antigo (D-2). O mapa não inventa card nem nível para preencher a tela.',
    );

    // ── 2. Criar o card — a criação mora no painel do store ──────────────
    const novoDiscovery = mapa.getByTestId('devmode-entry-trigger');
    await passo(
      'Abra o painel do store para criar o card',
      novoDiscovery,
      'A porta de entrada antiga listava cards do BOARD; o tracker deixou de ser consultado para saber estado (D-1). Criar continua sendo um gesto só, e ele mora no painel do store — o app não ganha um segundo formulário.',
    );
    await novoDiscovery.click();
    await painelDoStore.waitFor({ timeout: 15_000 });

    const titulo = painelDoStore.getByLabel('Novo discovery');
    await passo('Descreva o que está em jogo', titulo, 'O título é o problema, não a solução. O repo alvo é o que diz ONDE a sessão vai abrir — sem ele, o app não escolhe um por você (D-6).');
    await titulo.fill(TITULO_CARD);
    await painelDoStore.getByLabel('Repo alvo (opcional)').fill(REPO_ALVO);

    const criar = painelDoStore.getByRole('button', { name: 'Criar', exact: true });
    await passo('Crie o card', criar);
    await criar.click();
    await painelDoStore.locator('button', { hasText: TITULO_CARD }).first().waitFor({ timeout: 10_000 });

    const fecharPainel = painelDoStore.getByRole('button', { name: 'Fechar', exact: true });
    await passo('Volte ao mapa', fecharPainel, 'O painel do store é onde se AGE e se depura; o mapa é a projeção. São dois papéis, não dois desenhos da mesma coisa.');
    await fecharPainel.click();

    const cardDoDiscovery = cardDoTipo('discovery').first();
    await cardDoDiscovery.waitFor({ timeout: 15_000 });
    await passo(
      'O card veio do store, com a etapa CALCULADA',
      cardDoDiscovery,
      'Discovery é a macro etapa derivada do grafo (D-13) — ela nunca é digitada. Abaixo do título, o repo alvo e a contagem de planos e itens.',
    );

    const trilha = mapa.getByTestId('devmode-map-trilha').first();
    await trilha.waitFor({ timeout: 10_000 });
    await passo(
      'A trilha volta — mas sem fase fixa',
      trilha,
      'O mapa antigo desenhava 7 fases fixas por card. Aqui só aparecem as fases que ROADARAM neste assunto e a que vem a seguir: nome de fase é string livre até o horizontal pequeno ([P-4]), e desenhar uma fase que ninguém declarou é a issue #35 de volta.',
    );

    // ── 3. O ciclo do B1, inteiro, pela trilha do mapa ───────────────────
    const preparar = mapa.getByTestId('devmode-trilha-prepare').first();
    await passo(
      'Prepare a fase pela trilha',
      preparar,
      'O "⌁ Preparar" do mapa e o "Preparar" do painel do store são o MESMO gesto: separam o contexto, travam o card e abrem a aba com o comando já escrito. O Enter é seu.',
    );
    await preparar.click();

    const passoDaSessao = mapa.getByTestId('devmode-trilha-step').filter({ hasText: 'sessão aberta' }).first();
    await passoDaSessao.waitFor({ timeout: 60_000 });
    await passo(
      'A trilha diz "sessão aberta" — e para por aí',
      passoDaSessao,
      'A aba existe e o CLI devolveu o id da sessão. O app NÃO diz "em andamento": ele não sabe se você já apertou o Enter, e não pode afirmar o que não sabe.',
    );

    const blocoDaTrava = detalhe.getByTestId('devmode-details-lock');
    await blocoDaTrava.waitFor({ timeout: 20_000 });
    await passo(
      'A trava tem dono, hora e saída num gesto',
      blocoDaTrava,
      'D-11: a trava é fato local, não etiqueta remota nem arquivo .lock. Ela nomeia a sessão que a segura e sai daqui num clique — a trava órfã da evidência 3 não tem como acontecer.',
    );

    // Fechar a aba sem concluir: o card não pode ficar preso.
    const fecharAba = win.getByRole('button', { name: `Fechar aba [discovery] ${TITULO_CARD}` });
    await fecharAba.waitFor({ timeout: 20_000 });
    await passo(
      'Feche a aba sem concluir a fase',
      fecharAba,
      'O teste do estado preso: encerrar a sessão pelo meio não pode deixar o card travado sem saída — foi a trava órfã que matou o modelo anterior.',
    );
    await fecharAba.click();

    // Passo condicional: a confirmação só existe com o processo VIVO.
    const confirmarFechar = win.getByRole('button', { name: 'Fechar sessão', exact: true });
    if (await confirmarFechar.isVisible().catch(() => false)) {
      await passo('O app confirma antes de matar uma sessão viva', confirmarFechar, 'Confirmação destrutiva: há um PTY vivo do outro lado.');
      await confirmarFechar.click();
    }

    const passoInterrompido = mapa.getByTestId('devmode-trilha-step').filter({ hasText: 'interrompida' }).first();
    await passoInterrompido.waitFor({ timeout: 30_000 });
    await passo(
      'A fase ficou pelo meio — e a palavra é essa',
      passoInterrompido,
      '"Interrompida" não é "falhou" nem "em andamento": a sessão terminou sem concluir. A trava caiu junto, e o card volta a aceitar disparo.',
    );

    // ── 4. A skill responde: plano, itens, PR e a resposta do spike ──────
    emitirResultadoDaSkill(ctx.esteiraRoot);
    await abrirPainelDoStore(ctx);
    const varrer = painelDoStore.getByRole('button', { name: 'Varrer outbox' });
    await passo('Varra o outbox', varrer, 'O watcher ingere sozinho quando o arquivo chega; o botão força a leitura na hora. A varredura mora no painel do store — o mapa mostra o efeito.');
    await varrer.click();
    await painelDoStore.getByText('Planejado').first().waitFor({ timeout: 20_000 });
    await painelDoStore.getByRole('button', { name: 'Fechar', exact: true }).click();

    await cardDoTipo('plan').first().waitFor({ timeout: 20_000 });
    await passo(
      'Os níveis novos: discovery → planos → itens',
      mapa,
      'O carrossel de dois eixos é o mesmo do design v3; os nós é que mudaram. Onde havia "cards de plano" e fases numeradas (a unidade era o PR), agora há PLANOS e ITENS — e o item é a unidade (D-5).',
    );

    // A trilha só é desenhada no nó EM FOCO (o carrossel tem um foco por vez);
    // fotografar o plano sem escolhê-lo mostraria um card apagado e sem trilha
    // — o roteiro estaria fotografando o nível de trás.
    const cardDoPlano = cardDoTipo('plan').first();
    await cardDoPlano.locator('[class*="cardTop"]').click();
    await assentar(win);
    await passo(
      'O plano conta quantos itens dele já fecharam',
      cardDoPlano,
      'Nada aqui é digitado: a contagem sai do estado de cada item, e o estado do item é o que move a etapa do card.',
    );

    // ── 5. O spike que respondeu "não dá" ────────────────────────────────
    await abrirPainelDoStore(ctx);
    const linhaDoSpike = painelDoStore.getByTestId('esteira-item').filter({ hasText: 'spike' }).first();
    const concluirSpike = linhaDoSpike.getByRole('button', { name: 'Concluir' });
    await passo(
      'Feche o spike: a pergunta foi respondida',
      concluirSpike,
      'O gesto de estado do item vive no painel do store (B3). "Não dá" é resposta — e resposta fecha o ciclo de um spike (D-4).',
    );
    await concluirSpike.click();
    await painelDoStore.getByRole('button', { name: 'Fechar', exact: true }).click();

    // O eixo X do nível: o spike é o SEGUNDO item, e o carrossel só mostra o
    // que está em foco — sem andar até ele, o roteiro fotografaria o card
    // clipado pela borda do mapa (o anel circulando o vazio).
    const cardDoSpike = cardDoTipo('item').filter({ hasText: 'transcript' }).first();
    await cardDoSpike.waitFor({ timeout: 20_000 });
    const proximoItem = mapa.getByRole('button', { name: 'Itens — próximo item' });
    await proximoItem.click();
    await cardDoSpike.locator('[class*="cardTop"]').click();
    await assentar(win);
    await passo(
      'O spike aparece CONCLUÍDO, não pela metade',
      cardDoSpike,
      'Este é o print que o batch existe para produzir. O mapa antigo desenhava tudo como trilha de PR: um spike respondido ficava com etapas "não realizadas" penduradas, parecendo trabalho inacabado. Aqui ele está fechado, com a resposta — inclusive negativa — escrita embaixo do título, e sem próxima fase pendurada.',
    );

    const fechoDoCiclo = cardDoSpike.getByTestId('devmode-map-closure').first();
    await passo(
      'O ciclo do tipo, dito com todas as letras',
      fechoDoCiclo,
      'Cada tipo termina de um jeito (D-4): entrega de código fecha com PR mergeado e verificado; artefato revisado, com o documento aceito; pergunta respondida, com a conclusão registrada.',
    );

    // ── 6. O que dá para conferir, e onde está o artefato ────────────────
    const cardDaIssue = cardDoTipo('item').filter({ hasText: 'endpoint de saúde' }).first();
    await mapa.getByRole('button', { name: 'Itens — item anterior' }).click();
    await assentar(win);
    await passo('Escolha o item de entrega de código', cardDaIssue, 'O carrossel navega entre os itens no eixo horizontal, como fazia entre os cards de plano.');
    // O clique de SELEÇÃO é no topo do card (título): o corpo inteiro inclui a
    // trilha, e clicar nela escolheria uma etapa em vez do nó.
    await cardDaIssue.locator('[class*="cardTop"]').click();

    const verificacoes = detalhe.getByTestId('devmode-details-verifications');
    await verificacoes.waitFor({ timeout: 20_000 });
    await passo(
      'O PR da fase volta — e não só o PR',
      verificacoes,
      'As verificações estavam no histórico desde a fase 1 e NENHUMA tela as mostrava: a fase declarava o PR e o card não contava. Agora aparecem as quatro formas de conferir (PR, check, revisão, conclusão), cada uma com o estado dela.',
    );

    const artefatos = detalhe.getByTestId('devmode-details-artifacts');
    await artefatos.waitFor({ timeout: 20_000 });
    await passo(
      'Cadê o artefato? Tem uma resposta só',
      artefatos,
      'D-8: o store guarda o PONTEIRO — o repo âncora e o caminho, ou o disco quando não faz sentido versionar. O detalhe da etapa era o outro buraco que o inventário apontou.',
    );

    // ── 7. O documento fora do contrato — a #35 revertida ────────────────
    escreverResultadoQuebrado(ctx.esteiraRoot);
    await abrirPainelDoStore(ctx);
    await painelDoStore.getByRole('button', { name: 'Varrer outbox' }).click();
    await painelDoStore.getByText('não consegui ler').first().waitFor({ timeout: 20_000 });
    await painelDoStore.getByRole('button', { name: 'Fechar', exact: true }).click();

    // Voltar ao nível de cima pelo eixo Y — com a SETA, que é o gesto do
    // carrossel. Com o foco lá embaixo (itens), tanto o card do discovery
    // quanto o rótulo do nível estão fora do viewport, e o clique morre em
    // "element is outside of the viewport".
    await mapa.press('ArrowUp');
    await assentar(win);
    await mapa.press('ArrowUp');
    await assentar(win);
    await cardDoDiscovery.locator('[class*="cardTop"]').click();
    const etiquetaDeErro = mapa.getByTestId('devmode-map-tags').filter({ hasText: 'não consegui ler' }).first();
    await etiquetaDeErro.waitFor({ timeout: 20_000 });
    await passo(
      'Um result.json fora do contrato vira "não consegui ler"',
      etiquetaDeErro,
      'A issue #35 revertida na origem: o mapa antigo pintava de "não realizada" o que era "não consegui ler" — que é pior que o bug original, porque afirma que o trabalho não aconteceu. Aqui a etiqueta diz exatamente o que houve.',
    );

    const blocoDoErro = detalhe.getByTestId('devmode-details-ingest-errors');
    await blocoDoErro.waitFor({ timeout: 20_000 });
    await passo(
      'O erro tem caminho e motivo — e nada se perdeu',
      blocoDoErro,
      'O arquivo continua no outbox, com o código do que o contrato recusou. O que a skill fez não sumiu: só não foi lido.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

/**
 * Espera o carrossel parar de andar (transição de 320ms em
 * `LevelCarousel.module.css`). O anel é posicionado por `boundingBox` no
 * instante da foto: medir no meio da animação desenha o círculo no lugar onde
 * o card ESTAVA — o "anel errado" da lista de erros conhecidos.
 */
async function assentar(win: RoteiroContexto['win']): Promise<void> {
  await win.waitForTimeout(420);
}

/**
 * Abre o painel do store pelo gesto do mapa (o mesmo que o operador usa) e
 * deixa o card SELECIONADO.
 *
 * A seleção é estado do componente e o painel é desmontado no "Fechar": ele
 * reabre em "Escolha um card para ver o que aconteceu nele.", sem lista de
 * itens nenhuma. Sem este clique o roteiro morre procurando um botão que só
 * existe depois de escolher o card (erro de roteiro registrado em 04/08).
 */
async function abrirPainelDoStore(ctx: RoteiroContexto): Promise<void> {
  const painel = ctx.win.locator('section[aria-label="Esteira"]');
  if (!(await painel.isVisible().catch(() => false))) {
    await ctx.win.getByTestId('devmode-map').getByTestId('devmode-entry-trigger').click();
    await painel.waitFor({ timeout: 15_000 });
  }
  const card = painel.locator('button', { hasText: TITULO_CARD }).first();
  if (await card.isVisible().catch(() => false)) await card.click();
}

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
 * lados — e, aqui, prova também que o mapa desenha os nós do modelo NOVO a
 * partir do que a skill de verdade declara.
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
        // MESMO texto digitado na tela: `discovery.recorded` faz upsert, e um
        // título diferente aqui RENOMEIA o card no meio do roteiro (erro nº 5).
        title: TITULO_CARD,
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        target_repo: REPO_ALVO,
        scope_repos: [REPO_ALVO],
      },
      {
        type: 'plan.recorded',
        plan_id: 'pln-b6-01',
        discovery_id: discoveryId,
        title: 'Tornar o estado da fila observável',
        summary: 'Instrumentar antes de mexer no consumo.',
      },
      {
        type: 'work_item.recorded',
        work_item_id: 'wki-b6-issue',
        plan_id: 'pln-b6-01',
        item_type: 'issue',
        title: 'Expor o estado da fila no endpoint de saúde',
        target_repo: REPO_ALVO,
      },
      {
        type: 'work_item.recorded',
        work_item_id: 'wki-b6-spike',
        plan_id: 'pln-b6-01',
        item_type: 'spike',
        title: 'Dá para ler o transcript inteiro em memória?',
      },
      {
        // D-4 — a entrega de código termina com o PR verificado.
        type: 'verification.recorded',
        subject: { entity: 'work_item', id: 'wki-b6-issue' },
        verification_kind: 'pull-request',
        state: 'pending',
        ref: 'https://github.com/xansde/donel-dev/pull/44',
      },
      {
        type: 'verification.recorded',
        subject: { entity: 'work_item', id: 'wki-b6-issue' },
        verification_kind: 'check',
        state: 'passed',
        ref: 'npm test',
      },
      {
        // D-4 — a pergunta respondida termina com a conclusão registrada, e a
        // resposta NEGATIVA é desfecho válido. É o coração deste roteiro.
        type: 'verification.recorded',
        subject: { entity: 'work_item', id: 'wki-b6-spike' },
        verification_kind: 'conclusion',
        state: 'passed',
        ref: 'não dá: o transcript passa de 400 MB e o parser trava',
      },
      {
        type: 'artifact.recorded',
        owner: { entity: 'work_item', id: 'wki-b6-issue' },
        artifact_kind: 'spec',
        location: 'repo',
        repo: REPO_ALVO,
        path: 'specs/010-esteira-donel/spec.md',
      },
      {
        type: 'phase.completed',
        subject: { entity: 'discovery', id: discoveryId },
        phase: 'discovery',
        outcome: 'done',
        summary: 'Um plano proposto, dois itens declarados.',
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
        run_id: 'run-b6-fora-do-contrato',
        phase: 'discovery',
        status: 'success',
        started_at: '2026-08-04T12:00:00.000Z',
        finished_at: '2026-08-04T12:10:00.000Z',
        failure: null,
      },
      actor: { tool: 'esteira-donel', tool_version: '2.1.0' },
      subject: { discovery_id: discoveryId },
      facts: [
        // `fanout_cards` é do modelo ANTIGO — o campo que o app procurava e a
        // skill não gravava. É exatamente o desencontro da evidência 1.
        { type: 'discovery.recorded', discovery_id: discoveryId, title: 'Card', fanout_cards: ['card-1'] },
        { type: 'phase.completed', subject: { entity: 'discovery', id: discoveryId }, phase: 'discovery', outcome: 'done' },
      ],
    }),
    'utf8',
  );
}

/**
 * O dublê do `claude`: um REPL mínimo que desenha o banner que
 * `hasClaudeReadyMarker` procura, ecoa o que recebe (para o comando
 * pré-digitado aparecer na tela) e **denuncia** qualquer `\r`/`\n` que chegue.
 */
const STUB_JS = `
process.stdout.write('\\r\\n  * Welcome to Claude Code (stub do roteiro e2e)\\r\\n\\r\\n> ');
process.stdin.setEncoding('utf8');
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  if (/[\\r\\n]/.test(chunk)) {
    // O app NUNCA deveria chegar aqui: o Enter é gesto humano (invariante 2).
    process.stdout.write('\\r\\n[stub] ENTER RECEBIDO\\r\\n> ');
    return;
  }
  process.stdout.write(chunk);
});
process.stdin.resume();
`;

/**
 * Põe o dublê no PATH e tira dele o `claude` real. A remoção é necessária
 * porque `resolveClaudeExecutable` prefere um `.exe` a um shim `.cmd` mesmo
 * quando o shim vem antes — deixar o real visível faria o app ignorar o dublê.
 */
function prepararClaudeDeMentira(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'donel-e2e-claude-stub-'));
  writeFileSync(path.join(dir, 'claude-stub.js'), STUB_JS, 'utf8');
  writeFileSync(path.join(dir, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0claude-stub.js" %*\r\n`, 'utf8');

  const diretoriosDoReal = new Set<string>();
  try {
    for (const linha of execFileSync('where.exe', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)) {
      const limpa = linha.trim();
      if (limpa.length > 0) diretoriosDoReal.add(path.resolve(path.dirname(limpa)).toLowerCase());
    }
  } catch {
    // Sem `claude` no PATH: nada a filtrar.
  }

  const restante = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entrada) => entrada.trim().length > 0 && !diretoriosDoReal.has(path.resolve(entrada.trim()).toLowerCase()));
  process.env.PATH = [dir, ...restante].join(path.delimiter);

  const resolvido = execFileSync('where.exe', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0]?.trim() ?? '';
  if (path.resolve(path.dirname(resolvido)).toLowerCase() !== path.resolve(dir).toLowerCase()) {
    throw new Error(`o dublê do claude não venceu o PATH (o app resolveria ${resolvido || 'nada'})`);
  }
  return dir;
}
