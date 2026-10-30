import { appendFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PROJECT_NAME, SESSIONS_DIR } from './repoUnderTest';
import { launchIsolatedApp } from './helpers/launch';
import { openProjectClaudeTab, waitForClaudeBooted } from './helpers/ui';
import { removeIsolatedUserDataDir } from './userDataIsolation';

// Smoke da Fase C da 006 (T611/T612), adaptado duas vezes:
//
// 27/07 (commit 40c202c) — a toolbar SessionDetails (que mostrava o `%` de
// contexto POR ABA, com estado de alerta acima de 100% da smart zone) saiu dos
// dois modos: "não tem sido nem um pouco útil". A superfície virou a StatusBar
// (rodapé), GLOBAL para a aba em foco, mostrando tokens BRUTOS em milhares
// (`"<model>/<effort> · ctx Nk"`) — sem `%`, sem denominador, sem alerta.
//
// 29/07, CA-22 da 009 — "o acompanhamento de contexto % sumiu". O `%` voltou,
// ainda no rodapé, na forma que o design já previa para ele: o slot `smartZone`
// da StatusBar (mini `SmartZoneMeter`, barra + rótulo `"45% · 135k/300k"` +
// `data-zone`), com a régua da 006 (`min(300k, janela do modelo)`) passada pelo
// app. Isso REABRE a cobertura que a adaptação de 27/07 tinha declarado "não
// adaptável sem mexer em src/": o `%` relativo à zona (CA-6/CA-7) e o estado
// acima de 100% (CA-8/CA-9) voltaram a existir na árvore renderizada — agora
// como `data-zone="over"`, e não mais `data-over-zone`.
//
// O MECANISMO por trás (T610, transcript-watcher lendo `message.usage` do
// `.jsonl`) nunca mudou nas duas adaptações. `tests/contextWindow.test.ts`
// (régua/denominador) e `tests/smartZone.test.ts` (aritmética do `%` e as
// faixas de cor) cobrem a parte pura; aqui se prova a ligação ao vivo.
//
// Custo: uma sessão `claude` é aberta (o watcher só existe para abas claude) —
// desde 08/10 é o `claude` FALSO (fake-claude-chat, padrão do `launchIsolatedApp`),
// então nada vai à API e o transcript só recebe as linhas que ESTE teste escreve
// (o CLI real escrevia as próprias e disputava o arquivo).
// O que exercita a feature é a ESCRITA no `.jsonl`: o teste escreve a MESMA
// linha `assistant` com `message.usage` que o CLI escreveria ao fim de um turno
// (forma conferida no disco em 26/07 — ver `medicao-t606.md`). Depender de um
// turno real tornaria o teste ambiental (cota/rede), e foi exatamente o que
// deixou dois smokes vermelhos em 24/07 (backlog §B11).
//
// O truque para descobrir o `sessionId` da sessão VIVA sem API nova é o mesmo do
// `session-rename-live.spec.ts`: renomear pela UI faz o `main` persistir o nome
// sob a chave `sessionId`.

// T801/§B19 (008) — `APP_MAIN`/`PROJECT_NAME`/`REPO_ROOT`/`SESSIONS_DIR` vêm de `repoUnderTest.ts`: o nome do projeto na
// sidebar é o `basename` da PASTA (numa worktree, `donel-dev-wt-x`), e sai da
// MESMA fonte que o `SESSIONS_DIR` da fixture — divergir entre os dois era o
// bug do §B19 (o clique achava o `donel-dev` de verdade e a lista voltava vazia).


/**
 * Linha `assistant` como o CLI escreve: a `usage` fica em `message.usage` e o
 * id do modelo que respondeu em `message.model` (issue #21 — sem `model`, a
 * linha é como as das adaptações anteriores e o rodapé fica no modelo do launch).
 */
function usageLine(input: number, cacheRead: number, cacheCreation: number, model?: string): string {
  return `${JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      ...(model ? { model } : {}),
      usage: {
        input_tokens: input,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
        output_tokens: 1177,
      },
    },
  })}\n`;
}

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
/** Só é removido no fim se ESTE teste criou o arquivo. */
let createdTranscriptPath: string | null = null;

test.beforeAll(async () => {
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ name: 'session-context' }));
});

test.afterAll(async () => {
  test.setTimeout(90_000); // folga do B11 para o close com PTY vivo
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
    if (createdTranscriptPath && existsSync(createdTranscriptPath)) {
      try {
        unlinkSync(createdTranscriptPath);
      } catch {
        // já removido — ok
      }
    }
  }
});

test('T611/T612 (CA-22 da 009) — a StatusBar mostra o `%` de contexto da aba em foco, atualiza ao vivo com o turno novo, sinaliza acima da zona e cai quando o turno fica menor (não é acumulado) @sessoes', async () => {
  test.setTimeout(180_000);

  // T1227 (011-contas-e-provedores, etapa 2) — o guard de "só faz sentido com
  // o perfil Principal ativo" morreu junto com os perfis (T1222): sem
  // `CLAUDE_CONFIG_DIR` por perfil, o transcript SEMPRE fica em `~/.claude`.

  // 1. Abre uma sessão claude real clicando no projeto — FIX (item 1, rodada
  // de feedback do teste de 30/07) — a árvore "Projetos" da sidebar saiu;
  // abrir um projeto qualquer agora é sempre pelo popover do seletor no
  // titlebar.
  await openProjectClaudeTab(appWindow);

  const tab = appWindow.locator('[role="tab"]').first();
  await expect(tab).toBeVisible();
  await waitForClaudeBooted(appWindow, { startTimeout: 30_000 });

  // 2. CA-4 — sessão recém-nascida, sem nenhum turno → a StatusBar mostra
  // modelo/esforço da aba (tem "/"), mas NENHUM medidor de contexto: sem
  // leitura real do transcript-watcher, `activeSmartZone` é `undefined` e o
  // slot não renderiza (nunca um "0%" fabricado). Sem testid próprio pro span
  // de modelo/esforço (design-system só expõe `accountTestId`, ver
  // StatusBar.tsx) — o container inteiro (`div:has(> ...)`) é o locator
  // estável disponível; o medidor tem o seu (`[data-zone]`).
  const statusBar = appWindow.locator('div:has(> [data-testid="statusbar-account"])');
  const contextMeter = statusBar.locator('[data-zone]');
  await expect(statusBar).toContainText('/');
  await expect(statusBar).not.toContainText('contexto');
  await expect(contextMeter).toHaveCount(0);

  // 3. Descobre o `sessionId` da sessão viva renomeando pela UI (o main persiste
  //    sob essa chave) — nenhuma API de teste nova.
  const uiName = `ctx-${Date.now().toString(36)}`;
  await tab.getByText(PROJECT_NAME, { exact: true }).dblclick();
  const input = tab.getByRole('textbox');
  await expect(input).toBeVisible();
  await input.fill(uiName);
  await input.press('Enter');
  await expect(tab).toHaveAttribute('title', new RegExp(`^${uiName} —`));

  const config = await appWindow.evaluate(() => window.donel.config.get());
  const entries = Object.entries(config.sessionNames).filter(([, entry]) => entry.name === uiName);
  expect(entries, 'o rename pela UI tinha de ter persistido sob o sessionId da sessão viva').toHaveLength(1);
  const [sessionId] = entries[0];

  const transcriptPath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(transcriptPath)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    createdTranscriptPath = transcriptPath;
  }

  // 4. Turno novo: 290 + 132.807 + 1.505 = 134.602 tokens brutos → "45% ·
  // 135k/300k". A régua de 300k vem de `effectiveContextZone('fable')` — a
  // sessão nasce no default `fable` (clique na sidebar, sem `lastLaunch` neste
  // userData isolado), e o rótulo carrega o denominador junto de propósito: se o
  // default mudar para um modelo de janela menor, a falha mostra qual régua foi
  // usada em vez de só um `%` diferente do esperado.
  appendFileSync(transcriptPath, usageLine(290, 132_807, 1_505), 'utf8');
  await expect(statusBar).toContainText('contexto');
  await expect(contextMeter).toContainText('45% · 135k/300k', { timeout: 5_000 });
  await expect(contextMeter).toHaveAttribute('data-zone', 'ok');

  // 5. Turno maior — 380.000 = 300.000 + 60.000 + 20.000 → 127% da zona. Aqui
  // volta o antigo CA-8/CA-9: o `%` NÃO trava em 100 (127% e não "100%", que
  // tornaria 305k e 700k indistinguíveis) e a zona vira `over`, que é o que
  // pinta o número de vermelho.
  appendFileSync(transcriptPath, usageLine(300_000, 60_000, 20_000), 'utf8');
  await expect(contextMeter).toContainText('127% · 380k/300k', { timeout: 5_000 });
  await expect(contextMeter).toHaveAttribute('data-zone', 'over');

  // 6. C1: o número é o contexto AGORA, não acumulado — um turno menor (o que um
  //    `/compact` produz) faz o valor CAIR: 150 + 20.000 + 0 = 20.150 → 7%.
  appendFileSync(transcriptPath, usageLine(150, 20_000, 0), 'utf8');
  // Causa do flake (corrigida em src/main/transcript-watcher.ts): o evento deste
  // append caía no debounce com a leitura do append anterior ainda em voo e era
  // DESCARTADO; sem outro evento depois, o valor velho ficava para sempre.
  // Timeout maior que os anteriores por um motivo MEDIDO, não por superstição:
  // na primeira execução deste smoke este passo ficou 5 s inteiros exibindo o
  // valor anterior e passou com folga maior. Um append único seguido de silêncio
  // é o pior caso para `fs.watch` no Windows (evento coalescido/perdido não tem
  // nada depois para "consertá-lo"); numa sessão real o CLI escreve várias
  // linhas por turno, então o próximo evento chega em seguida. Registrado como
  // dívida nomeada em `specs/backlog.md` §B15.
  await expect(contextMeter).toContainText('7% · 20k/300k', { timeout: 20_000 });
  await expect(contextMeter).toHaveAttribute('data-zone', 'ok');

  // 6b. Issue #21 — `/model haiku` no CLI: a resposta seguinte grava outro id
  //     em `message.model`. O rodapé tem de trocar de `fable/…` para o modelo
  //     de fato, e a régua do medidor cair para a janela de 200k do Haiku 4.5
  //     (150 + 20.000 = 20.150 → 10% de 200k, não 7% de 300k).
  await expect(statusBar).toContainText('fable/');
  appendFileSync(transcriptPath, usageLine(150, 20_000, 0, 'claude-haiku-4-5-20251001'), 'utf8');
  await expect(statusBar).toContainText('haiku 4.5/', { timeout: 20_000 });
  await expect(statusBar).not.toContainText('fable/');
  await expect(contextMeter).toContainText('10% · 20k/200k', { timeout: 5_000 });

  // 7. Fecha a aba (mata o PTY e o watcher) — não deixa sujeira para os outros.
  await tab.getByRole('button', { name: new RegExp(`^Fechar aba ${uiName}`) }).click();
  const closeModal = appWindow.getByRole('dialog', { name: 'Fechar sessão?' });
  if (await closeModal.isVisible().catch(() => false)) {
    await closeModal.getByRole('button', { name: 'Fechar sessão', exact: true }).click();
  }
  await expect(appWindow.locator('[role="tab"]')).toHaveCount(0);
});

test('aba de terminal livre (shell) não mostra modelo/esforço nem medidor de contexto no rodapé (CA-4/CA-5 adaptado — a toolbar por-aba foi removida, a leitura agora é a StatusBar global) @sessoes', async () => {
  test.setTimeout(60_000);

  // FIX (teste manual 27/07) — `[data-testid="session-details"]`/
  // `[data-testid="session-context"]` não existem mais em NENHUMA aba
  // (SessionDetails.tsx não é mais montada nem para sessões claude — ver
  // cabeçalho do arquivo), então `toHaveCount(0)` contra esses testids
  // deixou de provar algo específico de shell. A prova equivalente agora é
  // no rodapé global: só sessões `claude` alimentam `activeModelEffort` e
  // `activeSmartZone` (App.tsx) — uma aba shell em foco não deve mostrar nem o
  // segmento "modelo/esforço" (sinalizado pela presença de "/") nem o medidor de
  // contexto. A ausência de "/" cobre os dois de uma vez desde o CA-22: o rótulo
  // do medidor é "N% · 135k/300k", que também tem barra.
  await appWindow.getByRole('button', { name: 'Mais opções de ＋ Nova sessão' }).click();
  await appWindow.getByRole('menuitem', { name: 'Terminal' }).click();

  await expect(appWindow.locator('[role="tab"]')).toHaveCount(1);
  const statusBar = appWindow.locator('div:has(> [data-testid="statusbar-account"])');
  await expect(statusBar).not.toContainText('contexto');
  await expect(statusBar.locator('[data-zone]')).toHaveCount(0);
  await expect(statusBar).not.toContainText('/');
});
