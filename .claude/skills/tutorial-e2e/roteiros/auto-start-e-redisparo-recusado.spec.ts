import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `auto-start-e-redisparo-recusado` — dois achados da rodada de
// melhoria de 05/08 (relatório "etapa-3-ponta-a-ponta", P32/P33), ambos do
// lado dispatch/sessões:
//
//   B5 — o comando pré-digitado da fase aperta o PRÓPRIO Enter, uma vez que
//        o CLI prova que aceita input. O gesto explícito continua sendo
//        "Preparar"; o que some é a SEGUNDA confirmação (apertar Enter
//        dentro do terminal). Este roteiro NUNCA envia Enter — se o texto
//        "ENTER AUTOMATICO RECEBIDO" aparecer, foi o app que mandou.
//   A1 —  redisparar uma fase que já concluiu sobre o MESMO assunto é
//        RECUSADO sem confirmação explícita — nunca gera um run novo por
//        engano sobre trabalho que já tem desfecho.
//
// ── Por que o `claude` aqui é um dublê ────────────────────────────────────
// Mesmo motivo de `disparo-abre-sessao.spec.ts`: o CLI real abre o diálogo de
// confiança de pasta, que `isReadyForAutoStart` (com razão) recusa atravessar
// — o roteiro travaria esperando um clique humano, no passo que ele existe
// para provar que NINGUÉM precisa dar. O dublê aqui tem o papel INVERTIDO do
// da `disparo-abre-sessao`: aquele denuncia um `\r` que chega (a invariante
// era NUNCA enviar); este confirma um `\r` que chega (a invariante nova é
// SEMPRE enviar, só que sozinho — sem gesto humano).

const REPO_ALVO = path.basename(REPO_ROOT);
const TITULO_AUTO_START = 'Painel de custos não soma o rateio';
const TITULO_FASE_DONE = 'Cadastro de fornecedor duplica silenciosamente';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  prepararClaudeDeMentira();
  ctx = await abrirDonel({ roteiro: 'auto-start-e-redisparo-recusado' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('a sessão de fase aperta o próprio Enter, e redisparar fase concluída é recusado', async () => {
  test.setTimeout(240_000);
  const { win, passo } = ctx;
  const esteira = win.locator('section[aria-label="Esteira"]');

  try {
    // ── Entrar na tela ───────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'A esteira nova só existe no Modo Dev.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await passo('Abra a Esteira', esteiraToggle, 'O ícone de rota abre a tela da spec 010.');
    await esteiraToggle.click();
    await esteira.waitFor({ timeout: 15_000 });

    // ══════════════════════════════════════════════════════════════════
    // PARTE 1 — B5: auto-start aperta o próprio Enter
    // ══════════════════════════════════════════════════════════════════

    const titulo = esteira.getByLabel('Novo discovery');
    await passo('Descreva o card', titulo, 'Um discovery com repo alvo — a fase de "Preparar" abre sessão de verdade nele.');
    await titulo.fill(TITULO_AUTO_START);
    await esteira.getByLabel('Repo alvo (opcional)').fill(REPO_ALVO);

    const criar = esteira.getByRole('button', { name: 'Criar', exact: true });
    await passo('Crie o card', criar);
    await criar.click();

    const cardNaLista = esteira.locator('button', { hasText: TITULO_AUTO_START }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });
    await cardNaLista.click();

    const preparar = esteira.getByRole('button', { name: 'Preparar', exact: true });
    await passo(
      'Prepare a fase',
      preparar,
      'A partir daqui, o gesto humano ACABOU: o app abre a aba, digita o comando e aperta o Enter sozinho, sem esperar mais nada.',
    );
    await preparar.click();

    const blocoDaTrava = esteira.getByTestId('esteira-lock');
    await blocoDaTrava.filter({ hasText: 'Sessão aberta' }).waitFor({ timeout: 60_000 });
    await passo(
      'A sessão abriu — estado honesto até aqui: "sessão aberta", não "em andamento"',
      blocoDaTrava,
      'O CLI devolveu o id da sessão. O app ainda não sabe (e não afirma) que a fase está rodando — só que a aba existe. É o mesmo estado honesto de sempre; o que muda no B5 é o que acontece a seguir, sem gesto nenhum.',
    );

    // ── Volta pro terminal: o comando foi ENVIADO, não só escrito ────────
    const fecharEsteira = esteira.getByRole('button', { name: 'Fechar', exact: true });
    await passo('Volte para o terminal', fecharEsteira, 'A aba da fase já nasceu por baixo da tela da Esteira.');
    await fecharEsteira.click();

    const comandoNoTerminal = win.locator('.xterm-rows').filter({ hasText: '/esteira-discovery-3' }).first();
    await comandoNoTerminal.waitFor({ timeout: 15_000 });
    await passo(
      'O comando aponta para o FORK (sufixo -3), nunca para o plugin 2.1.0',
      comandoNoTerminal,
      'A2: se este texto não tivesse o sufixo, a sessão chamaria a skill errada — reincidiu em seis runs seguidos antes da correção.',
    );

    const enterAutomatico = win.locator('.xterm-rows').filter({ hasText: 'ENTER AUTOMATICO RECEBIDO' }).first();
    await enterAutomatico.waitFor({ timeout: 20_000 });
    await passo(
      'O Enter chegou — e ESTE roteiro nunca apertou uma tecla',
      enterAutomatico,
      'B5: o dublê grita quando recebe `\\r`, do mesmo jeito que o de `disparo-abre-sessao` grita quando recebe um que NÃO deveria. A diferença é que aqui a mensagem é a prova de que funcionou, não de que quebrou — nenhum `page.keyboard`/clique de Enter existe neste arquivo.',
    );

    // ══════════════════════════════════════════════════════════════════
    // PARTE 2 — A1: redisparar fase concluída é recusado
    // ══════════════════════════════════════════════════════════════════

    await esteiraToggle.click();
    await esteira.waitFor({ timeout: 15_000 });

    const seedToggle = win.getByTestId('esteira-seed-toggle');
    await passo(
      'Semeie um card cuja fase "discovery" já concluiu',
      seedToggle,
      'O caminho mais rápido para um desfecho já registrado, sem esperar a skill rodar de verdade — o mesmo gesto de D-2.',
    );
    await seedToggle.click();

    const documento = win.getByTestId('esteira-seed-doc');
    await documento.waitFor({ timeout: 10_000 });
    await documento.fill(DOCUMENTO_FASE_CONCLUIDA);
    const semear = win.getByRole('button', { name: 'Semear', exact: true });
    await passo('Plante o documento', semear, 'Um discovery cuja fase "discovery" já saiu com outcome "done".');
    await semear.click();

    const cardSemeado = esteira.locator('button', { hasText: TITULO_FASE_DONE }).first();
    await cardSemeado.waitFor({ timeout: 10_000 });
    await cardSemeado.click();

    const preparar2 = esteira.getByRole('button', { name: 'Preparar', exact: true });
    await passo(
      'Tente preparar a fase "Discovery" de novo, sobre o mesmo card',
      preparar2,
      'Nada na tela impede o clique hoje (a UI de "redisparar com confirmação" é outro trabalho) — quem recusa é o disparo em si.',
    );
    await preparar2.click();

    const recusaFaseDone = esteira.locator('p').filter({ hasText: 'já está' }).filter({ hasText: 'confirme' }).first();
    await recusaFaseDone.waitFor({ timeout: 15_000 });
    await passo(
      'A1: recusado — nenhum run novo nasceu sobre trabalho que já tem desfecho',
      recusaFaseDone,
      'A fase "discovery" deste card já concluiu. Sem `confirmReopen: true` explícito, o disparo para aqui: nenhum run-input.json novo, nenhuma trava nova, nenhuma aba nova.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

const DOCUMENTO_FASE_CONCLUIDA = `{
  "discovery": {
    "title": "${TITULO_FASE_DONE}",
    "problem": "Dois cadastros pro mesmo fornecedor, sem aviso.",
    "target_repo": "${REPO_ALVO}",
    "scope_repos": ["${REPO_ALVO}"]
  },
  "phases": [
    { "phase": "discovery", "outcome": "done", "summary": "Causa raiz encontrada: falta de índice único." }
  ]
}`;

/**
 * O dublê do `claude`, com o papel INVERTIDO do de `disparo-abre-sessao.spec.ts`:
 * ecoa o texto recebido (pra o comando aparecer na tela) e, ao receber
 * qualquer `\r`/`\n`, imprime uma linha de CONFIRMAÇÃO — aqui é a prova de
 * que o auto-start (B5) funcionou, não de que um invariante quebrou.
 */
const STUB_JS = `
process.stdout.write('\\r\\n  * Welcome to Claude Code (stub do roteiro e2e)\\r\\n\\r\\n> ');
process.stdin.setEncoding('utf8');
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  const semQuebra = chunk.replace(/[\\r\\n]/g, '');
  if (semQuebra) process.stdout.write(semQuebra);
  if (/[\\r\\n]/.test(chunk)) {
    process.stdout.write('\\r\\n[stub] ENTER AUTOMATICO RECEBIDO — fase auto-iniciada, sem gesto humano\\r\\n> ');
  }
});
process.stdin.resume();
`;

/**
 * Põe o dublê no PATH e tira dele o `claude` real — mesma técnica de
 * `disparo-abre-sessao.spec.ts` (não compartilhada por não haver um lar
 * comum hoje; ver descobertas do batch).
 */
function prepararClaudeDeMentira(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'donel-e2e-claude-stub-autostart-'));
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
