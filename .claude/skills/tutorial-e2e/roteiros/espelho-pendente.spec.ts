import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `espelho-pendente` — o board como CORTESIA, nunca como bloqueio
// (spec 010, D-11/D-12).
//
// O tracker virou plugue opcional: o Donel Dev é o sistema de registro, e o
// board só recebe reflexo — etiqueta, comentário de conclusão e movimentação
// por macro etapa, com o mapeamento etapa → coluna vindo de CONFIGURAÇÃO.
//
// Este roteiro fotografa exatamente o estado que a decisão existe para
// proteger: **o board caído, e o trabalho local seguindo**. Três estados que
// não podem ser confundidos:
//
//   espelho pendente  ≠  trabalho parado
//   board fora do ar  ≠  documento fora do contrato
//   fila com motivo   ≠  falha silenciosa
//
// Nenhuma chamada de rede sai daqui: o adapter é FAKE, dirigido por um arquivo
// de controle que o próprio roteiro reescreve no meio do caminho — é assim que
// o mesmo tutorial mostra o board caindo e voltando.

let ctx: RoteiroContexto;
let configRoot: string;
let controlPath: string;

/** O título é digitado na tela E declarado pela skill: texto diferente RENOMEIA o card no meio do roteiro. */
const TITULO = 'Importação de lotes trava sem sinal';

test.beforeAll(async () => {
  // A configuração precisa existir ANTES de o app subir: ela é lida no boot.
  configRoot = mkdtempSync(path.join(os.tmpdir(), 'donel-e2e-espelho-cfg-'));
  controlPath = path.join(configRoot, 'mirror-fake.json');

  writeFileSync(
    path.join(configRoot, 'donel-mirror.json'),
    JSON.stringify({
      provider: 'taskdex',
      // O mapeamento etapa → coluna mora AQUI, não no código: as colunas mudam.
      columnByStage: { discovery: 'Discovery', planned: 'Plano', execution: 'Implementar', done: 'Concluído' },
      phaseLabelPrefix: 'esteira:em-andamento:',
      maxAttempts: 3,
    }),
    'utf8',
  );
  // O board começa fora do ar.
  escreveControle('fail', 'o board não respondeu (503)');

  ctx = await abrirDonel({
    roteiro: 'espelho-pendente',
    env: {
      // Isola do `~/.claude/esteira-config` real: nem credencial nem board de
      // verdade entram num relatório que circula.
      DONEL_ESTEIRA_CONFIG_DIR: configRoot,
      DONEL_ESTEIRA_MIRROR_FAKE: controlPath,
    },
  });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
  rmSync(configRoot, { recursive: true, force: true });
});

test('o board cai, o trabalho local segue', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    // ── Entrar na tela ───────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'O espelho no tracker é assunto de trabalho de dev — vive na Esteira, dentro do Modo Dev.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await passo('Abra a Esteira', esteiraToggle, 'O board deste roteiro está fora do ar de propósito, e nada disso impede a tela de funcionar.');
    await esteiraToggle.click();

    await win.locator('section[aria-label="Esteira"]').waitFor({ timeout: 15_000 });

    // ── O card local ─────────────────────────────────────────────────────
    const titulo = win.getByLabel('Novo discovery');
    await passo('Descreva o problema', titulo, 'O card nasce LOCAL. A referência ao card do tracker é opcional e, aqui, vem depois — declarada pela própria skill.');
    await titulo.fill(TITULO);
    await win.getByLabel('Repo alvo (opcional)').fill('donel-dev');

    const criar = win.getByRole('button', { name: 'Criar' });
    await passo('Crie o card', criar, 'Nenhuma linha de rede sai deste clique: o registro é local e o tracker é plugue opcional.');
    await criar.click();

    const cardNaLista = win.locator('button', { hasText: TITULO }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });

    // ── Prepara e conclui a fase, com o board caído ──────────────────────
    const preparar = win.getByRole('button', { name: 'Preparar' });
    await passo('Prepare a fase discovery', preparar, 'O app separa o contexto e trava o card. A trava é FATO local — a etiqueta no board é só o reflexo dela.');
    await preparar.click();
    await win.getByText('Preparada — ninguém assumiu ainda').waitFor({ timeout: 10_000 });

    emitirResultadoDaSkill(ctx.esteiraRoot);
    const varrer = win.getByRole('button', { name: 'Varrer outbox' });
    await passo('Varra o outbox', varrer, 'A skill devolveu o resultado da fase — e é ele que traz a referência ao card do tracker.');
    await varrer.click();

    const blocoEspelho = win.getByTestId('mirror-pending');
    await blocoEspelho.waitFor({ timeout: 15_000 });
    await passo(
      'A fase concluiu, a etapa avançou — com o board fora do ar',
      cardNaLista,
      'O trabalho local aconteceu inteiro: a fase virou "concluída" e a etapa foi para Planejado. O board não participou disso, e não atrapalhou.',
    );

    await passo(
      'O card diz o que o board não recebeu, e por quê',
      blocoEspelho,
      'Uma linha por operação, com o motivo e quantas vezes já tentou. "Espelho pendente" é board atrasado — nunca trabalho parado, e a frase fala isso com todas as letras.',
    );

    // ── O gesto local continua funcionando com a fila cheia ──────────────
    await passo('Prepare a fase seguinte, mesmo com espelho pendente', preparar, 'A fila do espelho não trava gesto nenhum: preparar a fase seguinte funciona igual, e a nova trava só acrescenta uma etiqueta à fila.');
    await preparar.click();
    await win.getByText('aplicar a etiqueta').waitFor({ timeout: 15_000 });
    await passo('A etiqueta da nova trava entra na fila', blocoEspelho, 'Três operações esperando: a etiqueta da trava, a coluna da macro etapa e o comentário de conclusão. Nenhuma delas é pré-requisito de nada local.');

    // ── O board volta ────────────────────────────────────────────────────
    escreveControle('ok');
    const reenviar = win.getByRole('button', { name: 'Reenviar espelho' });
    await passo('Reenvie o espelho', reenviar, 'O board voltou. Reenviar é o único gesto do espelho que espera resposta — porque quem clicou quer saber se foi.');
    await reenviar.click();

    await blocoEspelho.waitFor({ state: 'hidden', timeout: 15_000 });
    await passo(
      'A fila drenou e o sinal sumiu',
      cardNaLista,
      'O chip "espelho pendente" some do card e o bloco desaparece: o board passou a refletir o que já era verdade aqui dentro.',
    );

    conferirQueNadaFoiParaRede();
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

/** O arquivo que decide se o adapter fake aceita ou recusa. Trocar isto é "o board cair" e "o board voltar". */
function escreveControle(mode: 'ok' | 'fail', error?: string): void {
  writeFileSync(controlPath, JSON.stringify({ mode, error: error ?? '' }), 'utf8');
}

/** O último `run-input.json` que o app gravou no inbox isolado. */
function ultimoInput(esteiraRoot: string): string {
  const inbox = path.join(esteiraRoot, 'inbox');
  const arquivo = readdirSync(inbox).filter((nome) => nome.endsWith('.json')).sort().pop();
  if (arquivo === undefined) throw new Error('nenhum run-input no inbox — o disparo não gravou');
  return path.join(inbox, arquivo);
}

/**
 * Roda o emissor REAL da skill 3.0. É ele que declara a referência ao card do
 * tracker (`tracker`) — o app nunca a inventa, e sem ela não há espelho nenhum.
 */
function emitirResultadoDaSkill(esteiraRoot: string): void {
  const inputPath = ultimoInput(esteiraRoot);
  const discoveryId = JSON.parse(readFileSync(inputPath, 'utf8')).subject.discovery_id;
  const factsPath = path.join(esteiraRoot, 'facts.json');

  writeFileSync(
    factsPath,
    JSON.stringify([
      {
        type: 'discovery.recorded',
        discovery_id: discoveryId,
        // MESMO texto digitado na tela: `discovery.created` faz upsert, e um
        // título diferente RENOMEIA o card no meio do roteiro.
        title: TITULO,
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        tracker: { provider: 'taskdex', card_id: 'card-4711' },
        target_repo: 'donel-dev',
        scope_repos: ['donel-dev'],
      },
      {
        type: 'plan.recorded',
        plan_id: 'pln-espelho-01',
        discovery_id: discoveryId,
        title: 'Tornar o estado da fila observável',
        summary: 'Instrumentar antes de mexer no consumo.',
      },
      {
        type: 'relation.recorded',
        relation: 'originated',
        from: { entity: 'discovery', id: discoveryId },
        to: { entity: 'plan', id: 'pln-espelho-01' },
      },
      // A18 — discovery concluída fecha com o que alguém disse.
      {
        type: 'decision.recorded',
        subject: { entity: 'discovery', id: discoveryId },
        decision: 'instrumentar antes de mexer no consumo',
        confirmed_by: 'dono do repo',
      },
      {
        type: 'phase.completed',
        subject: { entity: 'discovery', id: discoveryId },
        phase: 'discovery',
        outcome: 'done',
        summary: 'Um plano proposto.',
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
 * O adapter fake registra cada chamada em disco em vez de falar com o board.
 * Ler esse registro é o que prova o "pronto quando" do batch: o roteiro inteiro
 * rodou sem rede e sem token.
 */
function conferirQueNadaFoiParaRede(): void {
  const calls = readFileSync(`${controlPath}.calls.jsonl`, 'utf8')
    .split('\n')
    .filter((linha) => linha.trim().length > 0)
    .map((linha) => JSON.parse(linha) as { operation: string });

  const operacoes = new Set(calls.map((call) => call.operation));
  for (const esperada of ['applyLabel', 'moveColumn', 'comment']) {
    if (!operacoes.has(esperada)) throw new Error(`o adapter fake não recebeu "${esperada}" — recebeu ${[...operacoes].join(', ') || 'nada'}`);
  }
}
