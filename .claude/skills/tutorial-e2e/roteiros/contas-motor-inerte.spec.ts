import { test, type Page } from '@playwright/test';
import { abrirDonel, fecharDonel, type RoteiroContexto } from '../lib/captura';

/** Espera a transição do modal terminar — o anel e a opacidade são medidos no instante da foto. */
async function assentar(win: Page): Promise<void> {
  await win.waitForTimeout(400);
}

// 011-contas-e-provedores, etapa 1 — seções 1 e 7 do roteiro manual
// (`specs/011-contas-e-provedores/e2e.md`), a parte que NÃO precisa de
// credencial nenhuma: o motor nasce inerte (`accounts.mod = null`), o painel
// abre e diz que não há provedor, e os perfis de hoje continuam como sempre.
//
// Este roteiro é seguro por construção: sem mod conectado não existe switch, e
// sem switch `claude-state.ts` nunca é chamado — nenhuma escrita em
// `~/.claude*`. O roteiro irmão (`contas-motor-ativo`) é que precisa isolar o
// HOME, e a razão está no cabeçalho dele.

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'contas-motor-inerte' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o motor de contas nasce inerte e não atrapalha nada', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    await passo(
      'O app abre como sempre',
      null,
      'Primeira execução com o motor de contas embarcado. Sem a chave `accounts` no config, ele nasce inerte: nada na tela muda em relação à versão anterior.',
    );

    const trigger = win.getByTestId('accounts-panel-trigger');
    await trigger.waitFor();
    await passo(
      'O botão "Contas" na barra de título',
      trigger,
      'Fica à direita do badge de perfil. Com o motor inerte ele diz apenas "Contas" — a marca ✓ (conectado) ou ⚠ (indisponível) só aparece quando há provedor.',
    );
    await trigger.click();

    const painel = win.getByTestId('accounts-panel');
    await painel.waitFor();
    // O modal entra com transição: fotografar antes de ela terminar pega o
    // painel translúcido, com o conteúdo de trás atravessando o texto (erro
    // conhecido 5c, na variante opacidade).
    await assentar(win);
    const aviso = win.getByText('Nenhum provedor conectado', { exact: false });
    await passo(
      'O painel diz que não há provedor conectado',
      aviso,
      'A frase completa o essencial: os perfis de hoje continuam funcionando normalmente. O painel abre sem travar a tela e sem afetar o resto do app.',
    );

    const form = win.getByTestId('accounts-connect-form');
    const seletorProvedor = form.getByRole('button').first();
    await passo(
      'A escolha do provedor',
      seletorProvedor,
      'Dois provedores nesta etapa: o pool compartilhado (Seazone) e o pool próprio, de contas suas.',
    );
    await seletorProvedor.click();

    const opcaoLocal = win.getByRole('option', { name: 'Pool próprio' });
    await opcaoLocal.waitFor();
    await passo('As duas opções', win.getByRole('listbox'), 'O pool Seazone usa o servidor do switcher; o pool próprio guarda as credenciais no cofre da máquina.');
    await opcaoLocal.click();

    const conectar = win.getByRole('button', { name: 'Conectar' });
    await passo(
      'O formulário do pool próprio',
      form,
      'Rótulo, access token e refresh token. Os dois campos de segredo são do tipo senha e o formulário é write-only: nada do que se digita aqui volta por nenhum canal de leitura.',
    );

    // Estado ruim de propósito: o que aparece quando alguém clica sem preencher.
    await conectar.click();
    const erro = win.getByTestId('accounts-connect-error');
    await erro.waitFor();
    await passo(
      'Conectar sem preencher',
      erro,
      'O erro é específico ("dados incompletos"), não um "algo deu errado". Estados que o leitor precisa reconhecer também entram no tutorial.',
    );

    await seletorProvedor.click();
    const opcaoSeazone = win.getByRole('option', { name: 'Pool Seazone' });
    await opcaoSeazone.waitFor();
    await opcaoSeazone.click();
    await passo(
      'O formulário do pool Seazone',
      form,
      'Aqui são outros dois campos: o endereço do switcher e o token de sessão. O app nunca gera credencial — ela vem de fora, sempre.',
    );

    await win.keyboard.press('Escape');
    await painel.waitFor({ state: 'hidden' });

    const badgePerfil = win.getByTestId('profile-switcher-trigger').getByRole('button').first();
    await passo(
      'Os perfis continuam onde estavam',
      badgePerfil,
      'A etapa 1 não remove nada de perfis: o badge segue no mesmo lugar, com a mesma função. A convivência das duas UIs é esperada nesta etapa.',
    );
    await badgePerfil.click();

    const painelPerfis = win.getByTestId('profile-switcher');
    await painelPerfis.waitFor();
    await assentar(win);
    await passo(
      'O painel de perfis, intacto',
      painelPerfis,
      'Listar, ativar, doctor e excluir seguem exatamente como antes do motor de contas existir — é a regressão que a etapa 1 promete.',
    );
  } catch (error) {
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});
