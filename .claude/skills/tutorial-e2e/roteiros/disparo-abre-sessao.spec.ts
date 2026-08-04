import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// Roteiro `disparo-abre-sessao` — o batch B1 da spec 010: o "Preparar" deixa de
// parar no arquivo e passa a ABRIR a sessão.
//
// Ele fotografa as frases que o card diz sobre uma sessão, e cada uma existe
// porque descreve um estado diferente que já foi confundido com o vizinho:
//
//   preparada     ≠  em andamento      (disparar não é começar)
//   em andamento  ≠  interrompida      (a aba fechou; ninguém está tocando)
//   travado       ≠  preso             (fechar a aba tem que ter saída)
//   sem repo      ≠  repo qualquer     (D-6: zero palpite de alvo)
//
// E prova o invariante que atravessa o repo inteiro: **o Enter é gesto
// humano**. O comando aparece escrito no terminal e NUNCA é enviado.
//
// ── Por que o `claude` aqui é um dublê ────────────────────────────────────
// O roteiro troca o `claude` do PATH por um stub. Não é preguiça: o CLI real
// abre com o diálogo de confiança de pasta num diretório novo, e
// `isReadyToPreType` (com razão) recusa escrever nesse estado — o roteiro
// travaria esperando um clique humano, justamente no passo que ele existe para
// provar. O dublê também DENUNCIA a quebra do invariante: se qualquer `\r`
// chegar ao PTY, ele escreve "ENTER RECEBIDO" na tela e o roteiro falha. Um CLI
// real engoliria o Enter e ninguém saberia.
// Mesmo espírito do adapter fake do B5: falha do app não pode ser confundida
// com falha do ambiente.

/** O card aponta para o repo de onde a suíte roda — nome calculado, nunca literal (numa worktree o nome é outro). */
const REPO_ALVO = path.basename(REPO_ROOT);
const TITULO_CARD = 'Fila de importação trava sem sinal';
const NOME_DA_ABA = `[discovery] ${TITULO_CARD}`;

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  prepararClaudeDeMentira();
  ctx = await abrirDonel({ roteiro: 'disparo-abre-sessao' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o disparo abre a sessão, e fechar a aba não prende o card', async () => {
  test.setTimeout(240_000);
  const { win, passo } = ctx;
  // Tudo da tela nova é procurado DENTRO da seção da Esteira: o mapa antigo
  // continua montado por baixo e tem botões com nomes parecidos ("⌁ Preparar").
  const esteira = win.locator('section[aria-label="Esteira"]');
  const preparar = esteira.getByRole('button', { name: 'Preparar', exact: true });

  try {
    // ── Entrar na tela ───────────────────────────────────────────────────
    const devToggle = win.getByTestId('devmode-toggle');
    await devToggle.waitFor({ timeout: 30_000 });
    await passo('Ligue o Modo Dev', devToggle, 'A esteira nova só existe no Modo Dev — ela convive com o mapa de hoje, sem substituí-lo.');
    await devToggle.getByText('Dev', { exact: true }).click();
    await fecharPortaDeEntrada(win);

    const esteiraToggle = win.getByTestId('esteira-toggle');
    await esteiraToggle.waitFor({ timeout: 15_000 });
    await passo('Abra a Esteira', esteiraToggle, 'O ícone de rota abre a tela da spec 010, por cima do mapa atual.');
    await esteiraToggle.click();
    await esteira.waitFor({ timeout: 15_000 });

    // ── O card, com repo alvo ────────────────────────────────────────────
    const titulo = esteira.getByLabel('Novo discovery');
    await passo(
      'Descreva o que está em jogo',
      titulo,
      'O título é o problema. O repo alvo é o que diz ONDE a sessão vai abrir — e sem ele o app não escolhe um por você.',
    );
    await titulo.fill(TITULO_CARD);
    await esteira.getByLabel('Repo alvo (opcional)').fill(REPO_ALVO);

    const criar = esteira.getByRole('button', { name: 'Criar', exact: true });
    await passo('Crie o card', criar);
    await criar.click();

    const cardNaLista = esteira.locator('button', { hasText: TITULO_CARD }).first();
    await cardNaLista.waitFor({ timeout: 10_000 });
    await cardNaLista.click();

    // ── Preparar: a aba abre ─────────────────────────────────────────────
    await passo(
      'Prepare a fase',
      preparar,
      'O app separa o contexto, trava o card e abre a aba da sessão com o comando já escrito. Antes deste batch ele parava no arquivo, e a tela precisava avisar que abrir a sessão era manual.',
    );
    await preparar.click();

    const frasePreparada = esteira.locator('p').filter({ hasText: 'a sessão abriu na aba' }).first();
    await frasePreparada.waitFor({ timeout: 20_000 });
    await passo(
      'A tela diz onde a sessão abriu — e de quem é o Enter',
      frasePreparada,
      'O app escreve o comando; quem envia é você. Nenhuma quebra de linha sai do app, nunca.',
    );

    // ── A trava passa a ter dono só depois que a sessão existe ───────────
    // Âncora por `data-testid`, não por texto: filtrar `section` pelo título
    // pegava a LISTA DE FASES, que repete a mesma palavra, e o print do bloco
    // saía duplicado (erro nº 5 — âncora por texto que o próprio fluxo muda).
    const blocoDaTrava = esteira.getByTestId('esteira-lock');
    await blocoDaTrava.filter({ hasText: 'Sessão aberta' }).waitFor({ timeout: 60_000 });
    await passo(
      'Agora a trava tem dono: a sessão abriu',
      blocoDaTrava,
      'A frase saiu de "Preparada — ninguém assumiu ainda" para "Sessão aberta" porque o CLI devolveu o id da sessão. E para por aí: a aba existe, o comando está escrito, e o app não afirma que a fase está rodando — quem envia é você.',
    );

    const linhaDaFase = esteira.locator('li').filter({ hasText: 'discovery — sessão aberta' }).first();
    await linhaDaFase.waitFor({ timeout: 20_000 });
    await passo(
      'A lista de fases conta a mesma história',
      linhaDaFase,
      'As duas frases saem da MESMA decisão de estado. Foi por corrigir só uma delas que "em andamento" reapareceu aqui em 03/08 — e, no primeiro print deste roteiro, pela quarta vez.',
    );

    // ── O comando escrito no terminal, sem Enter ─────────────────────────
    const fecharEsteira = esteira.getByRole('button', { name: 'Fechar', exact: true });
    await passo('Volte para o terminal', fecharEsteira, 'A Esteira é uma tela por cima. A aba da fase já nasceu por baixo dela.');
    await fecharEsteira.click();

    const terminalComComando = win.locator('.xterm-rows').filter({ hasText: '/esteira-discovery' }).first();
    await terminalComComando.waitFor({ timeout: 60_000 });
    await passo(
      'O comando está escrito — e parado',
      terminalComComando,
      'A sessão abriu no repo alvo, com a skill da fase apontada para o run-input.json que o app deixou. O texto está no prompt e não foi enviado.',
    );

    // O dublê grita se qualquer `\r` chegar ao PTY. Aqui isso é ASSERÇÃO, não
    // decoração: é o invariante 2 (CA-3) provado no caminho real, e não só no
    // teste unitário da função que monta o texto.
    const enterVazado = await win.locator('.xterm-rows').filter({ hasText: 'ENTER RECEBIDO' }).count();
    if (enterVazado > 0) throw new Error('o app enviou Enter por conta própria — invariante 2 (CA-3) quebrado');

    // ── Fechar a aba sem concluir ────────────────────────────────────────
    const fecharAba = win.getByRole('button', { name: `Fechar aba ${NOME_DA_ABA}` });
    await fecharAba.waitFor({ timeout: 15_000 });
    await passo(
      'Feche a aba sem concluir a fase',
      fecharAba,
      'O caso que prendia o card no modelo antigo: alguém abre a fase, desiste, e a trava fica órfã esperando um /esteira-liberar.',
    );
    await fecharAba.click();

    const confirmarFechamento = win.getByRole('button', { name: 'Fechar sessão', exact: true });
    const pediuConfirmacao = await confirmarFechamento
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (pediuConfirmacao) {
      await passo(
        'O app confirma antes de matar uma sessão viva',
        confirmarFechamento,
        'Fechar aba com processo vivo pede confirmação — o gesto é destrutivo, e o app não o faz calado.',
      );
      await confirmarFechamento.click();
    }

    // ── O card não ficou preso, e diz o que houve ────────────────────────
    await esteiraToggle.click();
    await esteira.waitFor({ timeout: 15_000 });
    await esteira.locator('button', { hasText: TITULO_CARD }).first().click();

    const linhaInterrompida = esteira.locator('li').filter({ hasText: 'interrompida: a sessão terminou sem concluir' }).first();
    await linhaInterrompida.waitFor({ timeout: 20_000 });
    await passo(
      'A fase ficou pelo meio — e a tela diz isso',
      linhaInterrompida,
      'Não é "em andamento" (ninguém está tocando) nem "não realizada" (ela começou). A sessão acabou sem concluir, e essa é a frase.',
    );

    await passo(
      'E o card volta a aceitar disparo, sem depender de ninguém',
      preparar,
      'A trava caiu junto com a sessão: trava sem sessão é trava sem dono. A saída não depende de uma skill declarar nada nem de um comando de liberação.',
    );

    // ── Os estados ruins: alvo que o app não tem como resolver ───────────
    await esteira.getByLabel('Novo discovery').fill('Como o time decide a semana');
    await esteira.getByLabel('Repo alvo (opcional)').fill('');
    await criar.click();
    await esteira.locator('button', { hasText: 'Como o time decide a semana' }).first().click();

    await passo(
      'Prepare a fase de um card SEM repo alvo',
      preparar,
      'Um discovery pode investigar um problema que não pertence a repositório nenhum — isso é legítimo, e a fase é preparada assim mesmo.',
    );
    await preparar.click();

    const fraseSemRepo = esteira.locator('p').filter({ hasText: 'sem repo alvo' }).first();
    await fraseSemRepo.waitFor({ timeout: 20_000 });
    await passo(
      'Sem repo alvo a sessão não abre — e a tela diz por quê',
      fraseSemRepo,
      'O contexto está preparado em disco e a tela mostra o caminho. O que o app NÃO faz é escolher um repo por você.',
    );

    await passo(
      'O caminho manual continua à mão',
      esteira.locator('code').first(),
      'É o MESMO comando que a aba receberia — uma função só produz os dois, para a correção de um não envelhecer o outro.',
    );

    await esteira.getByLabel('Novo discovery').fill('Precificação fora da curva no fim de semana');
    await esteira.getByLabel('Repo alvo (opcional)').fill('vega');
    await criar.click();
    await esteira.locator('button', { hasText: 'Precificação fora da curva' }).first().click();
    await passo(
      'Prepare a fase apontando para um repo que o app não conhece',
      preparar,
      'O card declara "vega", que não está entre os projetos configurados.',
    );
    await preparar.click();

    const frasePalpite = esteira.locator('p').filter({ hasText: 'palpite' }).first();
    await frasePalpite.waitFor({ timeout: 20_000 });
    await passo(
      'Repo desconhecido não vira "o projeto em foco"',
      frasePalpite,
      'Este é o bug de 03/08 fechado na origem: uma fase abriu no repo errado porque havia um fallback silencioso, comentado no código como "palpite honesto". Palpite não é estado.',
    );
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor: o relatório mostra até
    // onde foi e por que parou, em vez de sumir.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});

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
  // Caminho absoluto do node: o filtro de PATH abaixo pode remover o diretório
  // onde ele mora (npm global e node dividem pasta em algumas instalações).
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
