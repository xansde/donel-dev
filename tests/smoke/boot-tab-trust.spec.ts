import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Smoke da rodada 5 do feedback E2E (specs/001-mvp/feedback-e2e.md — "BUG
// modelo/esforço não selecionável SOMENTE na primeira aba").
//
// CAUSA RAIZ confirmada por investigação prévia: a aba default de boot
// (App.tsx INITIAL_TABS, sem `cwd`) roda o `claude` em `os.homedir()`
// (pty-manager.ts `cwd ?? os.homedir()`). O CLI abre o diálogo pré-REPL de
// confiança de pasta ("Quick safety check"/"trust this folder") TODA vez
// nesse cwd — o trust de home nunca é persistido pelo próprio binário.
// Enquanto o diálogo está na tela, nenhum dos 6 hooks do semáforo dispara
// (hooks-settings.ts SEMAPHORE_HOOK_EVENTS — nenhum turno rodou ainda), o
// que deixa `semaphoreState` da aba preso em `undefined` e
// `canInjectLiveCommand` (liveSessionInjection.ts) desabilitado pra sempre —
// A MENOS que alguém aperte Enter no terminal na mão. É exatamente isso que
// TODOS os outros smokes deste diretório fazem (ver o guard
// `if (text.includes('trust this folder')) press Enter` em terminal.spec.ts
// e companhia) — o que mascarava o bug real: um usuário que não sabe desse
// diálogo (ou um teste que não o trata manualmente, como este) fica preso.
//
// Este smoke reproduz o fluxo REAL, sem nenhum contorno manual de ENTER no
// diálogo (nunca somos NÓS quem aceita): espera (polling de verdade, não um
// único check) até o banner da versão do CLI aparecer — prova positiva e
// inequívoca de que o diálogo já foi resolvido, só possível se o app tiver
// auto-aceitado por baixo dos panos (TerminalPane.tsx
// `maybeAutoAcceptTrustDialog`) — só então digita um prompt trivial e prova
// que a resposta chega e a toolbar de Modelo/Esforço libera sozinha. Essa
// espera ANTES de digitar (só leitura, nenhuma tecla nossa) não é "contorno
// manual" — é sincronização: sem ela, digitar pode correr contra o diálogo
// ainda visível na tela, o mesmo timing não-determinístico que os outros
// smokes deste diretório já documentam (ver terminal.spec.ts) — e foi
// exatamente essa corrida que a validação deste teste pegou (ver dossiê da
// rodada 5: a 1ª rodada, pré-fix, falhou presa no diálogo, como esperado;
// rodadas pós-fix sem essa sincronização robusta também falharam, por
// corrida de digitação contra o diálogo ainda visível).
//
// SEM o fix, a espera pelo banner da versão abaixo é quem expira — o
// diálogo continua na tela indefinidamente (é assim que este teste captura
// o bug antes do fix; validado rodando 1x antes/1x depois).

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: [APP_MAIN], cwd: APP_CWD });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

test('aba boot (home, sem cwd) libera modelo/esforço sozinha, sem contorno manual do diálogo de confiança de pasta', async () => {
  test.setTimeout(200_000);

  // A aba "Sessão" default (App.tsx INITIAL_TABS) já está aberta e ativa no
  // boot do app — não passa pelo Launcher (sem `openLauncherPanel`, ao
  // contrário de model-injection.spec.ts).
  const terminalPane = window.locator('[data-testid="terminal-pane"]');
  await expect(terminalPane).toBeVisible();

  // Boot da sessão claude real: xterm monta e `pty:create` resolve.
  await expect(async () => {
    const text = await terminalPane.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('CLAUDE_NOT_FOUND');
    expect(text).not.toContain('Falha ao iniciar');
  }).toPass({ timeout: 20_000 });

  // Estado inicial: toolbar de Modelo/Esforço visível (aba 'claude') mas
  // DESABILITADA — nenhum turno rodou ainda (`canInjectLiveCommand` exige
  // semáforo 'waiting'). Prova que o cenário de partida é o mesmo do bug
  // relatado, antes de provar que ele se resolve sozinho.
  const sessionDetails = window.locator('[data-testid="session-details"]');
  await expect(sessionDetails).toBeVisible();
  const modelOption = sessionDetails.getByRole('radio', { name: 'fable', exact: true });
  await expect(modelOption).toBeDisabled();

  // FIX (validação deste smoke) — PROVA POSITIVA, não "ausência do
  // diálogo": checar só `not.toContain(TRUST_DIALOG_MARKER)` é frágil
  // porque `toPass` resolve no PRIMEIRO poll que não lança — se esse poll
  // cair ANTES do diálogo sequer ter aparecido no buffer (achado da
  // validação: sob carga, o round-trip de `getPreview`/render pode não ser
  // instantâneo), a asserção passa por coincidência de timing, sem provar
  // que o diálogo foi de fato resolvido — e digitar em cima disso corrompe
  // o prompt (mesmo timing não-determinístico documentado em
  // terminal.spec.ts). O banner da versão ("Claude Code v") só aparece
  // DEPOIS que o CLI passa do "Quick safety check" — esperar por ELE
  // (polling de verdade) é uma prova inequívoca de "passou do diálogo",
  // nos dois sentidos: só aparece se o diálogo foi resolvido, e continua
  // aparecendo mesmo se o diálogo nunca existiu nesta execução (pasta já
  // confiável).
  await expect(async () => {
    expect(await terminalPane.innerText()).toContain('Claude Code v');
  }).toPass({ timeout: 20_000 });

  // Só digita DEPOIS do diálogo confirmadamente resolvido — sem essa
  // sincronização, digitar pode correr contra o diálogo ainda em tela
  // (mesmo timing não-determinístico documentado em terminal.spec.ts),
  // corrompendo o prompt em vez de testar o auto-aceite de verdade.
  const marker = '741';
  await terminalPane.click();
  await window.keyboard.type('Quanto é 733 mais 8? Responda só o número, nada mais.', { delay: 30 });
  await window.keyboard.press('Enter');

  // Checkpoint intermediário barato: prova que o prompt virou um turno DE
  // VERDADE (o hook `UserPromptSubmit` disparou — semaphore-state-machine.ts
  // `transition('working', ...)`) sem depender da resposta completa do
  // modelo chegar. `session-details-hint` (SessionDetails.tsx) troca pra
  // "Sessão trabalhando" só quando o semáforo sai de `undefined`.
  const hint = window.locator('[data-testid="session-details-hint"]');
  await expect(hint).toHaveText(/trabalhando/, { timeout: 20_000 });

  // FIX (validação deste smoke) — 120s, não 45-60s: achado real da
  // validação — a aba boot herda o MODELO PADRÃO GLOBAL do perfil ativo
  // (sem `--model` explícito, ao contrário dos outros smokes deste
  // diretório), que pode ser mais pesado que haiku (ex.: Sonnet, se um
  // `/model` anterior salvou um novo default — comportamento real do CLI,
  // fora do controle deste app) + o ambiente desta máquina tem dezenas de
  // MCPs configurados. Folga generosa aqui não mascara o bug original — o
  // checkpoint "trabalhando" logo acima já provou que o turno é real (hook
  // disparou); só o tempo de resposta do modelo varia.
  await expect(async () => {
    expect(await terminalPane.innerText()).toContain(marker);
  }).toPass({ timeout: 120_000 });

  // Prova final (o achado relatado no feedback E2E): a toolbar de
  // Modelo/Esforço libera sozinha — o semáforo saiu de `undefined` porque o
  // turno completou (`Stop` -> 'waiting', ver semaphore-state-machine.ts).
  await expect(modelOption).toBeEnabled({ timeout: 15_000 });
});
