import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `mapa-forma-e-leitura` — batch N5 (010, "mapa, forma e leitura").
//
// Base: `mapa-sobre-o-store.spec.ts` (B6) — mesmo dublê de `claude`, mesmo
// `emit_result.py` real, mesma disciplina de "âncora por testid, nunca por
// texto que o próprio fluxo altera". O que este roteiro prova é diferente:
//
//   C1  o card do item some com a FRASE ("issue · em curso · repo · ...") e
//       passa a mostrar só o TIPO — a frase inteira vira `title` (tooltip);
//   C2  o cabeçalho do mapa mostra o TÍTULO do discovery, não o id `dsc-...`;
//   C3  o item com artefato de tasks ganha a seção "O que roda junto" no
//       painel de detalhe: escopo compacto + cada task com o título humano
//       (lido do `tasks.md` REAL desta árvore, não um dublê);
//   C4  recolher a barra DIREITA não desmonta mais o mapa ESQUERDO — o
//       carrossel continua no mesmo nó depois de reabrir;
//   B1  uma fase CONCLUÍDA ganha "↺ Retomar": reabre a última sessão da
//       cadeia, sem disparo novo;
//   B2  navegar até um nó com sessão VIVA alterna a aba ativa sozinho.

/** O card aponta para o repo de onde a suíte roda — nome calculado, nunca literal (numa worktree o nome é outro). */
const REPO_ALVO = path.basename(REPO_ROOT);
const TITULO_CARD = 'Fila de importação trava sem sinal';
/** Um tasks.md REAL desta árvore (26 tasks, `T1301`–`T1326`) — usar o de verdade prova o parser contra o formato real, não um dublê. */
const TASKS_DOC_PATH = 'specs/011-contas-e-provedores/registry-classe-a/tasks.md';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  prepararClaudeDeMentira();
  ctx = await abrirDonel({ roteiro: 'mapa-forma-e-leitura' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o mapa fica denso, humano, sobrevive ao colapso da barra e sabe retomar/navegar por sessão viva', async () => {
  test.setTimeout(420_000);
  const { win, passo } = ctx;

  const mapa = win.getByTestId('devmode-map');
  const detalhe = win.getByTestId('devmode-details-panel');
  const painelDoStore = win.locator('section[aria-label="Esteira"]');
  const cardDoTipo = (kind: string) => mapa.locator(`[data-testid="devmode-map-card"][data-kind="${kind}"]`);
  // Âncoras por NOME da aba (ver `esteiraTabName`: `[<fase>] <título>`), não
  // por "selecionada agora" — a seleção muda ao longo do roteiro, e uma
  // locator que já embute `{ selected: true }` vira uma pergunta diferente a
  // cada vez que é reusada. `abaAtiva`, abaixo, é a ÚNICA que pergunta isso.
  const abaDoDiscovery = win.getByRole('tab').filter({ hasText: `[discovery] ${TITULO_CARD}` });
  const abaDoItem = win.getByRole('tab').filter({ hasText: `[implementar] ${TITULO_CARD}` });
  const abaAtiva = win.getByRole('tab', { selected: true });

  try {
    // ── 0. Ligar o Modo Dev e criar o card ────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);
    await mapa.waitFor({ timeout: 20_000 });

    const novoDiscovery = mapa.getByTestId('devmode-entry-trigger');
    await novoDiscovery.click();
    await painelDoStore.waitFor({ timeout: 15_000 });
    await painelDoStore.getByLabel('Novo discovery').fill(TITULO_CARD);
    await painelDoStore.getByLabel('Repo alvo (opcional)').fill(REPO_ALVO);
    await painelDoStore.getByRole('button', { name: 'Criar', exact: true }).click();
    await painelDoStore.locator('button', { hasText: TITULO_CARD }).first().waitFor({ timeout: 10_000 });
    await painelDoStore.getByRole('button', { name: 'Fechar', exact: true }).click();

    const cardDoDiscovery = cardDoTipo('discovery').first();
    await cardDoDiscovery.waitFor({ timeout: 15_000 });

    // ── C2 — o cabeçalho mostra o TÍTULO, o id vira tooltip ───────────────
    const cabecalhoId = mapa.getByTestId('devmode-map-discovery-id');
    await passo(
      'O cabeçalho do mapa mostra o título, não o id técnico',
      cabecalhoId,
      'Antes o cabeçalho mostrava o id cru (`dsc-...`) ao lado de "Esteira". Agora mostra o TÍTULO do discovery em foco — o id não sumiu, só desceu para o title/tooltip, pra quem precisa dele pra depurar.',
    );
    const textoCabecalho = (await cabecalhoId.innerText()).trim();
    if (textoCabecalho.startsWith('dsc-') || textoCabecalho === '') {
      throw new Error(`C2 regrediu: o cabeçalho do mapa mostra "${textoCabecalho}" em vez do título do discovery`);
    }

    // ── B1, primeira metade — abrir e interromper a fase "discovery" ──────
    // (mesma coreografia do roteiro B6: preparar → sessão aberta → fechar a
    // aba sem concluir → a fase fica pelo meio. A diferença começa depois:
    // este roteiro faz a fase CONCLUIR com essa mesma sessão já no histórico,
    // pra provar que "Retomar" reabre a cadeia real, não uma sessão forjada.)
    const trilhaDiscovery = mapa.getByTestId('devmode-map-trilha').first();
    await trilhaDiscovery.waitFor({ timeout: 10_000 });
    const prepararDiscovery = mapa.getByTestId('devmode-trilha-prepare').first();
    await prepararDiscovery.click();
    await win.locator('.xterm-rows').filter({ hasText: '/esteira-discovery' }).first().waitFor({ timeout: 60_000 });
    await mapa.getByTestId('devmode-trilha-step').filter({ hasText: 'sessão aberta' }).first().waitFor({ timeout: 60_000 });

    const fecharAbaDiscovery = win.getByRole('button', { name: `Fechar aba [discovery] ${TITULO_CARD}` });
    await fecharAbaDiscovery.waitFor({ timeout: 20_000 });
    await fecharAbaDiscovery.click();
    const confirmarFechar1 = win.getByRole('button', { name: 'Fechar sessão', exact: true });
    if (await confirmarFechar1.isVisible().catch(() => false)) await confirmarFechar1.click();
    await mapa.getByTestId('devmode-trilha-step').filter({ hasText: 'interrompida' }).first().waitFor({ timeout: 30_000 });

    // ── A skill responde: plano, DOIS itens, e o artefato do tasks.md ─────
    // Dois itens de propósito: `wki-b6` (o de trabalho, com artefato de
    // tasks — C1/C3) e `wki-companheiro` (simples, sem artefato) — é ele que
    // dá ao roteiro um "item anterior" pra navegar embora e provar B2 sem
    // ambiguidade (ver seção B2 mais abaixo).
    emitirResultadoDaSkill(ctx.esteiraRoot);
    await abrirPainelDoStore(ctx);
    await painelDoStore.getByRole('button', { name: 'Varrer outbox' }).click();
    await painelDoStore.getByText('Planejado').first().waitFor({ timeout: 20_000 });
    await painelDoStore.getByRole('button', { name: 'Fechar', exact: true }).click();

    // ── B1, segunda metade — a fase concluiu; "Retomar" aparece ───────────
    await cardDoDiscovery.waitFor({ timeout: 15_000 });
    await cardDoDiscovery.locator('[class*="cardTop"]').click();
    await assentar(win);
    const passoConcluido = mapa.getByTestId('devmode-trilha-step').filter({ hasText: 'concluída' }).first();
    await passoConcluido.waitFor({ timeout: 20_000 });
    const botaoRetomar = passoConcluido.getByTestId('devmode-trilha-resume');
    await passo(
      'A fase concluída ganha "↺ Retomar" — a mesma sessão, não uma nova',
      botaoRetomar,
      'A fase "discovery" tinha ficado interrompida (a aba foi fechada sem concluir); a skill depois declarou o desfecho, e o passo virou "concluída". A sessão de CLI que rodou ali continua no histórico — "Retomar" reabre ELA (`claude -r <id>`), no mesmo cwd, sem disparar nada novo e sem tocar o estado do card.',
    );
    await botaoRetomar.click();

    // `addTab` sempre foca a aba recém-criada (mesmo mecanismo de
    // "Preparar"): a aba retomada nasce E já é a ativa.
    await abaDoDiscovery.waitFor({ timeout: 20_000 });
    await abaAtiva.filter({ hasText: `[discovery] ${TITULO_CARD}` }).waitFor({ timeout: 10_000 });
    await win.locator('.xterm-rows').filter({ hasText: 'Welcome to Claude Code' }).last().waitFor({ timeout: 30_000 });
    await passo(
      'A sessão reabriu — sem passar pelo disparo de novo',
      win.locator('.xterm-rows').filter({ hasText: 'Welcome to Claude Code' }).last(),
      'Nenhum `run-input.json` novo foi escrito, nenhuma trava foi criada: o gesto de "Retomar" é só abrir a mesma conversa de novo. Quem muda o estado do card continua sendo só o que a skill declara.',
    );

    // ── Descer ao nível dos itens ──────────────────────────────────────────
    // O companheiro nasceu PRIMEIRO nos facts (índice 0, foco default do
    // carrossel); "próximo item" traz o item de trabalho pro FOCO — é o foco
    // do carrossel (eixo X), não a seleção do detalhe, que decide qual card
    // desenha a trilha (só o card em foco tem trilha, `esteiraMapView.ts`).
    await mapa.press('ArrowDown');
    await assentar(win);
    await mapa.press('ArrowDown');
    await assentar(win);
    await mapa.getByRole('button', { name: 'Itens — próximo item' }).click();
    await assentar(win);

    const itemComTasks = cardDoTipo('item').filter({ hasText: 'Expor o estado da fila' }).first();
    await itemComTasks.waitFor({ timeout: 20_000 });

    // ── C1 — densidade: o card do item mostra o TIPO, não a frase ─────────
    await passo(
      'O card denso: uma palavra no lugar da frase inteira',
      itemComTasks,
      'Antes o card imprimia a frase inteira embaixo do título — "issue · em curso · donel-dev · criado pela skill". Agora mostra só "issue" (o tipo); a frase completa não sumiu, ela é o tooltip deste texto — passe o mouse pra ver.',
    );
    const metaCurta = (await itemComTasks.locator('[class*="cardFooterMeta"]').first().innerText()).trim();
    if (metaCurta.includes('·')) {
      throw new Error(`C1 regrediu: o card do item mostra a frase inteira ("${metaCurta}") em vez do tipo curto`);
    }
    const tituloTooltip = await itemComTasks.locator('[class*="cardFooterMeta"]').first().getAttribute('title');
    if (!tituloTooltip || !tituloTooltip.includes('issue')) {
      throw new Error('C1 regrediu: o tooltip do card não carrega mais a frase honesta inteira');
    }

    // ── C3 — o que roda junto: abre o detalhe do item ─────────────────────
    await itemComTasks.locator('[class*="cardTop"]').click();
    await assentar(win);

    const secaoTasks = detalhe.getByTestId('devmode-details-tasks');
    await secaoTasks.waitFor({ timeout: 30_000 });
    await passo(
      'O card do item mostra O QUE RODA JUNTO',
      secaoTasks,
      `O item aponta pra um artefato de tasks (o \`${TASKS_DOC_PATH}\` real desta árvore, 26 tasks). O painel lê o arquivo, resume no cabeçalho ("26 tasks · T1301-T1326") e expande cada task com o título humano — não o id sozinho.`,
    );

    // ── C4 — recolher a barra direita NÃO desmonta o mapa esquerdo ────────
    const recolherPaineis = win.getByRole('button', { name: 'Recolher painéis do Modo Dev' });
    await passo(
      'Recolher os painéis do Modo Dev',
      recolherPaineis,
      'Este botão zera a coluna do mapa E a do detalhe. O bug (C4): recolher a barra DIREITA desmontava o mapa ESQUERDO — cada toggle perdia o nó em foco do carrossel.',
    );
    await recolherPaineis.click();
    await assentar(win);

    const mapaColapsado = win.getByTestId('devmode-map');
    const aindaMontado = await mapaColapsado.count();
    if (aindaMontado === 0) {
      throw new Error('C4 regrediu: o mapa desmontou ao recolher a barra direita');
    }
    const colapsadoAttr = await mapaColapsado.getAttribute('data-collapsed');
    if (colapsadoAttr !== 'true') {
      throw new Error('C4: o mapa está montado, mas não marcou data-collapsed="true" — a prop não chegou');
    }
    await passo(
      'O mapa continua no DOM — só a largura zerou',
      null,
      'O `data-testid="devmode-map"` continua presente (verificado no script, não só visualmente): o componente não desmontou, só encolheu por CSS. FIX #15 continua valendo do outro lado — colapsar a barra ESQUERDA (ícone ao lado) ainda desmonta o mapa, de propósito.',
    );

    await recolherPaineis.click();
    await assentar(win);
    const itemAindaEmFoco = detalhe.getByTestId('devmode-details-tasks');
    await itemAindaEmFoco.waitFor({ timeout: 15_000 });
    await passo(
      'Reabrindo: o mesmo nó continua selecionado',
      mapa,
      'Sem remontar, o estado do carrossel (o nível em foco, o nó selecionado) sobreviveu ao toggle — a seção "O que roda junto" do item ainda está aberta, sem precisar escolher o item de novo.',
    );

    // ── B2 — navegar até um nó com sessão viva alterna a aba sozinho ──────
    // Prepara "implementar" no item COM tasks (fica em foco) — a sessão
    // nasce VIVA (a aba não é fechada) e VIRA a aba ativa (mesmo mecanismo
    // do "Retomar": `addTab` sempre foca a aba recém-criada).
    const trilhaDoItem = mapa.getByTestId('devmode-map-trilha').first();
    await trilhaDoItem.waitFor({ timeout: 10_000 });
    const prepararImplementar = mapa.getByTestId('devmode-trilha-prepare').first();
    await prepararImplementar.click();
    await abaDoItem.waitFor({ timeout: 60_000 });
    await abaAtiva.filter({ hasText: `[implementar] ${TITULO_CARD}` }).waitFor({ timeout: 10_000 });
    await win.locator('.xterm-rows').filter({ hasText: '/esteira-implementar' }).first().waitFor({ timeout: 60_000 });

    // Troca a aba ativa manualmente pra a do discovery — é o "usuário olhando
    // outra coisa" que a navegação vai (ou não) desmentir a seguir.
    await abaDoDiscovery.click();
    await assentar(win);
    await abaAtiva.filter({ hasText: `[discovery] ${TITULO_CARD}` }).waitFor({ timeout: 10_000 });
    await passo(
      'Olhando outra aba — a do discovery, não a do item',
      abaAtiva,
      'Antes de navegar o mapa, a aba ativa é deliberadamente trocada pra outra: é o cenário real — o operador está numa aba, e o mapa vai (ou não) roubar o foco dele.',
    );

    // Vai pro item COMPANHEIRO (sem sessão viva) — a aba ativa NÃO deve mudar.
    const itemAnterior = mapa.getByRole('button', { name: 'Itens — item anterior' });
    await itemAnterior.click();
    await assentar(win);
    await abaAtiva.filter({ hasText: `[discovery] ${TITULO_CARD}` }).waitFor({ timeout: 10_000 });
    await passo(
      'Nó SEM sessão viva: navegar até ele não rouba o foco',
      mapa,
      'O item companheiro não tem sessão nenhuma rodando. Chegar nele pelo mapa não mexe na aba ativa — continua a do discovery. É a metade "não rouba foco" da regra do B2.',
    );

    // Volta pro item COM sessão viva — agora a aba ativa deve alternar sozinha.
    const proximoItem = mapa.getByRole('button', { name: 'Itens — próximo item' });
    await proximoItem.click();
    await assentar(win);
    await abaAtiva.filter({ hasText: `[implementar] ${TITULO_CARD}` }).waitFor({ timeout: 15_000 });
    await passo(
      'Nó COM sessão viva: navegar até ele alterna a aba sozinho',
      abaAtiva,
      'Voltar pro item com a sessão de "implementar" aberta troca a aba ativa automaticamente — sem clicar na aba, sem "Retomar": é o FATO (`SessionSnapshot.endedAt === null`) que decide, não o gesto de navegar.',
    );
  } catch (error) {
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

/** Espera o carrossel/detalhe assentarem (mesma folga de `mapa-sobre-o-store.spec.ts`). */
async function assentar(win: RoteiroContexto['win']): Promise<void> {
  await win.waitForTimeout(420);
}

/** Abre o painel do store pelo gesto do mapa e deixa o card selecionado — mesmo padrão do roteiro B6. */
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
 * Roda o emissor REAL da skill 3.0. Declara: a fase "discovery" concluída (a
 * MESMA sessão interrompida antes vira resumível — B1), um plano, DOIS itens
 * (o de trabalho com artefato de tasks — C1/C3/B2 — e o companheiro simples
 * — B2) e o artefato apontando pro `tasks.md` REAL desta árvore.
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
        title: TITULO_CARD,
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        target_repo: REPO_ALVO,
        scope_repos: [REPO_ALVO],
      },
      {
        type: 'plan.recorded',
        plan_id: 'pln-n5-01',
        discovery_id: discoveryId,
        title: 'Tornar o estado da fila observável',
        summary: 'Instrumentar antes de mexer no consumo.',
      },
      {
        type: 'work_item.recorded',
        work_item_id: 'wki-n5-companheiro',
        plan_id: 'pln-n5-01',
        item_type: 'spike',
        title: 'Vale a pena reprocessar o lote automaticamente?',
      },
      {
        type: 'work_item.recorded',
        work_item_id: 'wki-n5-issue',
        plan_id: 'pln-n5-01',
        item_type: 'issue',
        title: 'Expor o estado da fila no endpoint de saúde',
        target_repo: REPO_ALVO,
      },
      {
        // C3 — o artefato que faz o item saber "o que roda junto". O caminho
        // é RELATIVO ao repo, resolvido no renderer contra o projeto
        // conhecido (D-6) — o mesmo jeito que o cwd da sessão é resolvido.
        type: 'artifact.recorded',
        owner: { entity: 'work_item', id: 'wki-n5-issue' },
        artifact_kind: 'tasks',
        location: 'repo',
        repo: REPO_ALVO,
        path: TASKS_DOC_PATH,
      },
      {
        // B1 — a fase que tinha ficado "interrompida" (a aba fechou sem
        // concluir) agora conclui: a sessão que rodou ali já está no
        // histórico (com cliSessionId + cwd) e vira a candidata do "Retomar".
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

/**
 * O dublê do `claude` — idêntico ao de `mapa-sobre-o-store.spec.ts` (mesmo
 * banner, mesmo eco, mesma denúncia de `\r`/`\n` recebido).
 */
const STUB_JS = `
process.stdout.write('\\r\\n  * Welcome to Claude Code (stub do roteiro e2e)\\r\\n\\r\\n> ');
process.stdin.setEncoding('utf8');
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  if (/[\\r\\n]/.test(chunk)) {
    process.stdout.write('\\r\\n[stub] ENTER RECEBIDO\\r\\n> ');
    return;
  }
  process.stdout.write(chunk);
});
process.stdin.resume();
`;

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
