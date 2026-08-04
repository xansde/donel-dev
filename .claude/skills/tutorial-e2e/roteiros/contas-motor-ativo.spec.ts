import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { abrirDonel, fecharDonel, REPO_ROOT, type RoteiroContexto } from '../lib/captura';

// 011-contas-e-provedores, etapa 1 — o painel com um provedor CONECTADO, usando
// o mod falso (`DONEL_ACCOUNTS_FAKE_MOD_FIXTURE`, o mesmo seam dos smokes): sem
// rede, sem cofre, mas passando pelo MESMO motor e pelo MESMO `claude-state.ts`
// do caminho real. O que este roteiro NÃO prova: a chamada de rede de verdade e
// o formato do payload real — isso é a bateria manual do `e2e.md` (seções 2 e 5).
//
// ISOLAMENTO — a razão de o HOME ser trocado aqui:
// `applyAccountsClaudeStateSwitch` (main/index.ts) monta o alvo das escritas
// assim: `claudeHome = accounts.claudeHome ?? claudeHomeDir(profilePathDeps)`,
// mas o segundo arquivo, `claudeJsonPath: globalClaudeJsonPath(profilePathDeps)`,
// é resolvido SEMPRE por `homedir()` — o override `accounts.claudeHome` não o
// alcança. Ou seja: um switch com o HOME real apaga o bloco `oauthAccount` do
// `~/.claude.json` DA MÁQUINA, derrubando o login do CLI de quem roda o teste.
// Trocar `USERPROFILE`/`HOME` no processo do app é o único jeito de mover os
// dois arquivos de uma vez. O smoke `accounts-switch.spec.ts` isola só o
// primeiro — ver o registro de iterações.

const FIXTURE_PATH = path.join(REPO_ROOT, 'tests/fixtures/accounts-fake-mod.json');

let ctx: RoteiroContexto;
let homeFalso: string;
let claudeJsonFalso: string;
let credenciaisFalsas: string;

/** Espera a transição do modal terminar — o anel e a opacidade são medidos no instante da foto. */
async function assentar(win: Page): Promise<void> {
  await win.waitForTimeout(400);
}

test.beforeAll(async () => {
  homeFalso = mkdtempSync(path.join(tmpdir(), 'donel-e2e-contas-home-'));
  claudeJsonFalso = join(homeFalso, '.claude.json');
  credenciaisFalsas = join(homeFalso, '.claude', '.credentials.json');
  mkdirSync(join(homeFalso, '.claude'), { recursive: true });
  // Semeia o estado de uma máquina já logada no CLI: é o `oauthAccount` que o
  // switch tem que remover, e o `mcpServers` que ele tem que preservar (D6).
  writeFileSync(
    claudeJsonFalso,
    JSON.stringify({ oauthAccount: { emailAddress: 'exemplo@exemplo' }, mcpServers: { exemplo: { command: 'echo' } } }, null, 2),
    'utf8',
  );

  ctx = await abrirDonel({
    roteiro: 'contas-motor-ativo',
    env: { DONEL_ACCOUNTS_FAKE_MOD_FIXTURE: FIXTURE_PATH, USERPROFILE: homeFalso, HOME: homeFalso },
  });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('com um provedor conectado, o painel lista contas e troca sem reiniciar sessão', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    const trigger = win.getByTestId('accounts-panel-trigger');
    await trigger.waitFor();
    await trigger.click();
    const form = win.getByTestId('accounts-connect-form');
    await form.waitFor();
    await assentar(win);

    const seletorProvedor = form.getByRole('button').first();
    await seletorProvedor.click();
    await win.getByRole('option', { name: 'Pool próprio' }).click();

    await win.getByPlaceholder('ex.: Conta B').fill('Conta de exemplo');
    const campos = form.locator('input[type="password"]');
    await campos.nth(0).fill('exemplo-access');
    await campos.nth(1).fill('exemplo-refresh');

    const conectar = win.getByRole('button', { name: 'Conectar' });
    await passo(
      'Conectar o provedor',
      conectar,
      'Os tokens vêm de fora do app — ele nunca os gera. Daqui em diante nada do que foi digitado volta por nenhum canal de leitura: o formulário é a única porta de entrada, e ela é de mão única.',
    );
    await conectar.click();

    const lista = win.getByTestId('account-row').first();
    await lista.waitFor();
    await assentar(win);
    await passo(
      'As contas do pool, com a carga de cada uma',
      win.getByTestId('accounts-panel'),
      'A carga é a maior das três janelas que a Anthropic mede (5 horas, semana, e a do modelo). É por ela que o app decide sozinho quando trocar.',
    );

    const marcaTitlebar = win.getByTestId('accounts-panel-trigger');
    await passo(
      'O botão muda quando há provedor',
      marcaTitlebar,
      'Com provedor conectado o botão ganha "✓". Se o provedor ficar inacessível — rede fora, sessão expirada — ele passa a "⚠", e a razão aparece dentro do painel.',
    );

    const toggle = win.getByText('Trocar automaticamente');
    await passo(
      'A troca automática',
      toggle,
      'Ligada, o app troca sozinho quando a conta ativa passa de 90% e existe outra com pelo menos 20 pontos de folga. Desligada, a decisão volta a ser toda sua.',
    );

    const contaBeta = win.getByTestId('account-row').filter({ hasText: 'Conta Beta' }).getByRole('button').first();
    await passo(
      'Trocar de conta',
      contaBeta,
      'Um clique. As abas abertas continuam abertas — a troca reescreve a credencial que o CLI lê, sem reiniciar sessão nenhuma.',
    );
    await contaBeta.click();

    await win.getByTestId('account-row').filter({ hasText: 'ativa' }).first().waitFor();
    await assentar(win);
    await passo(
      'A conta ativa depois da troca',
      win.getByTestId('account-row').filter({ hasText: 'ativa' }).first(),
      'A conta que passou a valer aparece marcada. O painel nunca mostra token nem segredo — só rótulo e carga.',
    );

    // O efeito real em disco, no HOME falso: é isto que a troca de conta faz.
    const credenciais = JSON.parse(readFileSync(credenciaisFalsas, 'utf8'));
    expect(credenciais.claudeAiOauth.accessToken).toBe('fixture-access-beta');
    const claudeJson = JSON.parse(readFileSync(claudeJsonFalso, 'utf8'));
    expect(claudeJson.oauthAccount).toBeUndefined();
    expect(claudeJson.mcpServers.exemplo).toBeDefined();

    const desconectar = win.getByTestId('accounts-disconnect');
    await passo(
      'Desconectar o provedor',
      desconectar,
      'Volta ao estado inerte do primeiro tutorial: os perfis seguem funcionando, e o app deixa de trocar conta sozinho.',
    );
  } catch (error) {
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});
