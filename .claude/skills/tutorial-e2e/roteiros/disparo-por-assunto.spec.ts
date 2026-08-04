import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';
import { parseRunInput } from '../../../../src/shared/esteira/contract/runInput';

// Roteiro `disparo-por-assunto` — batch B2 da spec 010.
//
// O que prova: o app só oferece disparo que o modelo comporta, e nunca recusa
// calado. Três estados que o tutorial precisa ensinar a reconhecer:
//
//   fase que o card não comporta  → desabilitada, COM a razão escrita
//   fase de item                  → só existe depois que existe item
//   issue sem repo alvo (D-6)     → a tela recusa ANTES do clique, e diz por quê
//
// De propósito o card nasce SEM repo: é o que deixa o item `issue` sem alvo
// nenhum para herdar, e é assim que a recusa do D-6 aparece de verdade em vez
// de ser encenada.

// `discovery.created` faz upsert: o título declarado pela skill precisa ser o
// MESMO que foi digitado, senão o card é renomeado no meio do roteiro e os
// locators param de resolver (erro conhecido nº 5).
const TITULO_DO_CARD = 'Lote grande fica pendente sem erro';
const ITEM_COM_REPO = 'Instrumentar a fila';
const ITEM_SEM_REPO = 'Publicar o painel de fila';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'disparo-por-assunto' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o disparo que a tela oferece é o que o modelo comporta', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    // ── Entrar na tela ───────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'A Esteira só existe no Modo Dev — o controle do meio da barra de título troca a janela.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await passo('Abra a Esteira', esteiraToggle, 'O ícone de rota abre a tela nova. O mapa de hoje segue vivo por baixo, intocado.');
    await esteiraToggle.click();
    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });

    // ── Um card recém-nascido: sem plano, sem item, sem repo ─────────────
    const titulo = win.getByLabel('Novo discovery');
    await passo(
      'Descreva o que está em jogo',
      titulo,
      'Este card nasce SEM repo de propósito: é o que faz a exigência de repo alvo aparecer mais adiante, em vez de ficar escondida.',
    );
    await titulo.fill(TITULO_DO_CARD);

    const criar = win.getByRole('button', { name: 'Criar' });
    await passo('Crie o card', criar);
    await criar.click();

    const cardNaLista = win.locator('button', { hasText: TITULO_DO_CARD }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });
    await cardNaLista.click();

    // ── 1. A fase que o card não comporta ────────────────────────────────
    const fasePlano = win.getByTestId('dispatch-phase-plano');
    await fasePlano.waitFor({ timeout: 10_000 });
    await passo(
      'A fase "Plano" não aceita clique — e o card não tem plano nenhum',
      fasePlano,
      'Ela continua visível, desabilitada. Sumir com a opção pouparia pixel e faria a tela mentir por omissão.',
    );

    await passo(
      'A razão vem escrita, não escondida num tooltip',
      win.getByTestId('dispatch-phase-reasons'),
      'Uma linha por fase indisponível: a fase Plano detalha um plano que já existe, e implementar/validar precisam de um item — que nasce pela skill, nunca por formulário do app (D-16).',
    );

    // ── 2. Preparar o que dá: a fase Discovery ───────────────────────────
    const preparar = win.getByRole('button', { name: 'Preparar' });
    await passo(
      'Prepare a única fase que este card comporta hoje',
      preparar,
      'Discovery está habilitada porque o assunto dela é o próprio card. O app separa o contexto no inbox e trava o card.',
    );
    await preparar.click();
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });

    // ── 3. A skill responde: nascem o plano e dois itens ─────────────────
    const discoveryId = emitirResultadoDaSkill(ctx.esteiraRoot);
    const varrer = win.getByRole('button', { name: 'Varrer outbox' });
    await passo('Varra o outbox', varrer, 'A skill devolveu um plano e dois itens. O watcher já ingere sozinho; o botão força a leitura na hora.');
    await varrer.click();

    // As duas esperas são pelo chip HABILITADO: o chip em si existe desde
    // sempre (o catálogo não muda), e esperar só por ele passaria antes da
    // ingestão acontecer.
    await win.locator('[data-testid="dispatch-phase-plano"]:not([disabled])').waitFor({ timeout: 10_000 });
    await win.locator('[data-testid="dispatch-phase-implementar"]:not([disabled])').waitFor({ timeout: 10_000 });
    await passo(
      'Agora a fase "Plano" aceita clique',
      win.getByTestId('dispatch-phase-plano'),
      'Nada mudou na tela: mudou o card. O plano passou a existir porque a skill o declarou — e a fase que dependia dele habilitou sozinha.',
    );

    // ── 4. O assunto do disparo: um ITEM, não o card ─────────────────────
    const faseImplementar = win.getByTestId('dispatch-phase-implementar');
    await passo(
      'Escolha uma fase de item',
      faseImplementar,
      'Implementar e validar rodam sobre um item de trabalho. Foi a existência do item que as destravou.',
    );
    await faseImplementar.click();

    const assunto = win.getByTestId('dispatch-subject');
    await passo(
      'O assunto do disparo passa a ser o item',
      assunto,
      'O card tem dois itens; o disparo escolhe QUAL. Era daqui que saía o run-input com o assunto pela metade.',
    );

    await passo(
      'O repo alvo aparece antes do clique',
      win.getByTestId('dispatch-repo'),
      'O alvo é explícito (D-6): o repo do próprio item. O app nunca completa esse campo com o projeto em foco.',
    );

    const inputsAntes = contarInputs(ctx.esteiraRoot);
    await passo('Prepare a fase do item', preparar, 'O mesmo gesto de antes, agora com um item como assunto.');
    await preparar.click();
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });
    conferirRunInputDoItem(ctx.esteiraRoot, inputsAntes, discoveryId);
    await passo(
      'O contexto gravado é o do item — e passa no contrato de ida',
      win.locator('code').first(),
      'O run-input recém-escrito traz work_item_id e o repo alvo, e foi validado por parseRunInput dentro do próprio roteiro.',
    );

    // ── 5. D-6: o item issue sem repo não dispara ────────────────────────
    await assunto.locator('button[aria-haspopup="listbox"]').click();
    const opcaoSemRepo = win.getByRole('option', { name: new RegExp(ITEM_SEM_REPO) });
    await passo(
      'Troque para o item que não tem repo alvo',
      opcaoSemRepo,
      'Os dois itens são do tipo issue. O que muda entre eles é só um campo: um tem repo, o outro não.',
    );
    await opcaoSemRepo.click();

    await win.getByTestId('dispatch-blocked').getByText('não tem repo alvo', { exact: false }).waitFor({ timeout: 10_000 });
    await passo(
      'A tela recusa e explica, antes de o clique falhar',
      win.getByTestId('dispatch-blocked'),
      'Item do tipo issue exige exatamente um repo alvo (D-6). Sem repo — nem dele, nem herdado do card — a fase não dispara, e o app não escolhe um repositório por ninguém.',
    );
    await passo(
      'E o botão "Preparar" fica desabilitado junto',
      preparar,
      'A frase e o botão contam a mesma história. Botão vivo com clique que falha depois é a versão anterior deste mesmo bug.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

function inbox(esteiraRoot: string): string {
  return path.join(esteiraRoot, 'inbox');
}

function contarInputs(esteiraRoot: string): number {
  return readdirSync(inbox(esteiraRoot)).filter((nome) => nome.endsWith('.json')).length;
}

/**
 * O último `run-input.json` que o app gravou no inbox isolado. Ordena por
 * mtime, não por nome: o nome é `run-<uuid>`, e ordenar uuid dá "o último"
 * errado quando há mais de um disparo no mesmo roteiro.
 */
function ultimoInput(esteiraRoot: string): string {
  const arquivo = readdirSync(inbox(esteiraRoot))
    .filter((nome) => nome.endsWith('.json'))
    .map((nome) => path.join(inbox(esteiraRoot), nome))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    .pop();
  if (arquivo === undefined) throw new Error('nenhum run-input no inbox — o disparo não gravou');
  return arquivo;
}

/**
 * Roda o emissor REAL da skill 3.0 contra o input do disparo. Sem dublê: é o
 * mesmo `emit_result.py` que a skill usa, então o e2e prova o contrato dos dois
 * lados. Declara um plano e DOIS itens `issue` — um com repo, outro sem —,
 * porque é a diferença entre eles que o passo do D-6 fotografa.
 */
function emitirResultadoDaSkill(esteiraRoot: string): string {
  const inputPath = ultimoInput(esteiraRoot);
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const discoveryId: string = input.subject.discovery_id;
  const factsPath = path.join(esteiraRoot, 'facts.json');

  writeFileSync(
    factsPath,
    JSON.stringify([
      {
        type: 'discovery.recorded',
        discovery_id: discoveryId,
        title: TITULO_DO_CARD,
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        // Sem repo: é o que faz o item sem alvo não ter de quem herdar.
        target_repo: null,
        scope_repos: [],
      },
      {
        type: 'plan.recorded',
        plan_id: 'pln-b2-01',
        discovery_id: discoveryId,
        title: 'Tornar o estado da fila observável',
        summary: 'Instrumentar antes de mexer no consumo.',
      },
      {
        type: 'work_item.recorded',
        work_item_id: 'wi-b2-01',
        plan_id: 'pln-b2-01',
        item_type: 'issue',
        title: ITEM_COM_REPO,
        target_repo: 'donel-dev',
        scope_repos: ['donel-dev'],
      },
      {
        type: 'work_item.recorded',
        work_item_id: 'wi-b2-02',
        plan_id: 'pln-b2-01',
        item_type: 'issue',
        title: ITEM_SEM_REPO,
        target_repo: null,
        scope_repos: [],
      },
      {
        type: 'phase.completed',
        subject: { entity: 'discovery', id: discoveryId },
        phase: 'discovery',
        outcome: 'done',
        summary: 'Um plano e dois itens propostos.',
      },
    ]),
    'utf8',
  );

  execFileSync(
    'python',
    ['emit_result.py', '--input', inputPath, '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high'],
    { cwd: path.join(REPO_ROOT, 'skills', 'esteira-donel-3.0.0', 'tools'), encoding: 'utf8' },
  );

  return discoveryId;
}

/**
 * O passo 3 do batch: o `run-input.json` do disparo de item precisa sair com
 * `work_item_id` E passar no `parseRunInput`. Conferir aqui, dentro do roteiro,
 * é o que impede o print de "parecer certo" com um arquivo errado por baixo.
 */
function conferirRunInputDoItem(esteiraRoot: string, inputsAntes: number, discoveryId: string): void {
  const agora = contarInputs(esteiraRoot);
  if (agora <= inputsAntes) throw new Error(`o disparo do item não gravou run-input novo (antes ${inputsAntes}, agora ${agora})`);

  const raw = JSON.parse(readFileSync(ultimoInput(esteiraRoot), 'utf8'));
  const parsed = parseRunInput(raw);
  if (!parsed.ok) throw new Error(`run-input do item fora do contrato: ${parsed.issues.map((issue) => `${issue.code}@${issue.path}`).join(', ')}`);
  if (parsed.input.subject.work_item_id !== 'wi-b2-01') {
    throw new Error(`o run-input saiu com work_item_id=${String(parsed.input.subject.work_item_id)} — o assunto do disparo não chegou`);
  }
  if (parsed.input.subject.plan_id !== 'pln-b2-01') {
    throw new Error('o run-input não levou o plano do item junto');
  }
  if (parsed.input.subject.discovery_id !== discoveryId) throw new Error('o run-input mudou de card no meio do caminho');
  if (parsed.input.workspace?.target_repo !== 'donel-dev') throw new Error('o repo alvo do item não chegou ao run-input');
  if (parsed.input.run.phase !== 'implementar') throw new Error(`o run-input saiu com a fase ${parsed.input.run.phase}`);
}
