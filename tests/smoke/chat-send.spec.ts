import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chatHelpers, launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { launchClaudeTab } from './helpers/ui';

// 014-chat, T072 - smoke do ENVIO (Fase 3), contra o `claude` FALSO (T040): nunca o CLI real.
//
// SC-003: varias linhas; `/mod` com o menu fechado nao vira `/model`; comando desconhecido -> "nao foi" com motivo; enviando ->
// entrou; na fila -> entrou (`demorar`); interromper e mandar; `!cmd`; Enter perdido reenviado sem duplicar
// (`DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER=1`). SC-006: alternar chat <-> terminal 10x com rascunho.
// O auto-start da Esteira nao tem caso aqui: ele exige um store da Esteira com card e disparo de fase, que o
// fake nao simula; a escolha do driver e o fluxo de falha ficam cobertos por `tests/chat-send-driver.test.ts`.

const input = (page: Page): Locator => page.locator('[data-testid="chat-composer-input"]:visible');
const timeline = (page: Page): Locator => page.locator('[data-testid="chat-timeline"]:visible');

async function send(page: Page, text: string): Promise<void> {
  const box = input(page);
  await box.fill(text);
  await box.press('Enter');
}

/** Every user line the fake wrote to the transcripts of this run. */
function userLines(sessionsDir: string): { text: string; raw: string }[] {
  const out: { text: string; raw: string }[] = [];
  for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(path.join(sessionsDir, file), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
        if (entry.type !== 'user') continue;
        const content = entry.message?.content;
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((b: { text?: string }) => b.text ?? '').join('') : '';
        out.push({ text, raw: line });
      } catch {
        // partial line while the fake is writing
      }
    }
  }
  return out;
}

function allTranscriptText(sessionsDir: string): string {
  return readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => readFileSync(path.join(sessionsDir, f), 'utf8'))
    .join('\n');
}

async function withChatApp(name: string, env: Record<string, string>, body: (chat: ChatApp, page: Page) => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  let chat: ChatApp | null = null;
  try {
    chat = await launchChatApp({ name });
    await body(chat, chat.window);
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (chat) await chat.dispose();
  }
}

test('T072 - envio: linhas, /mod, desconhecido, enviando, na fila, interromper, !cmd e rascunho @chat', async () => {
  test.setTimeout(300_000);
  await withChatApp('chat-send', { DONEL_FAKE_CLAUDE_SLOW_MS: '4000' }, async (chat, page) => {
    const helpers = chatHelpers(page);
    await launchClaudeTab(page, {});
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });

    // A caixa ja nasce focada e aceita texto ainda durante "iniciando o Claude…" (G8): o envio espera na fila.
    await expect(input(page)).toBeFocused({ timeout: 10_000 });
    await page.evaluate(() => {
      const w = window as unknown as { __seenSending: boolean };
      w.__seenSending = false;
      new MutationObserver(() => {
        if (document.body.innerText.includes('enviando…')) w.__seenSending = true;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await send(page, 'primeira mensagem');
    await expect(timeline(page).getByText('primeira mensagem')).toBeVisible();
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    expect(await page.evaluate(() => (window as unknown as { __seenSending: boolean }).__seenSending)).toBe(true);
    await helpers.shot('send-01-entrou');

    // Varias linhas: Shift+Enter quebra, Enter envia; o CLI recebe as duas linhas numa mensagem so.
    await input(page).fill('linha um');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('linha dois');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(2, { timeout: 30_000 });
    expect(userLines(chat.sessionsDir).some((l) => l.text === 'linha um\nlinha dois')).toBe(true);

    // `/mod` enviado com o menu da caixa FECHADO (Esc antes; com ele aberto o Enter completaria para `/model `):
    // chega literal, o CLI nao o conhece e o cartao fecha em "nao foi" - sem duplicar nem ficar orfao.
    await input(page).fill('/mod');
    await input(page).press('Escape');
    await input(page).press('Enter');
    await expect(timeline(page).getByText('✕ não foi').first()).toBeVisible({ timeout: 30_000 });
    await expect(timeline(page).getByText(/comando desconhecido/).first()).toBeVisible();
    await expect(timeline(page).getByRole('button', { name: 'tentar de novo' }).first()).toBeVisible();
    expect(allTranscriptText(chat.sessionsDir)).not.toContain('<command-name>/model');
    await helpers.shot('send-02-nao-foi');

    // Comando desconhecido: tambem "nao foi" com motivo.
    await send(page, '/foobar');
    await expect(timeline(page).getByText('✕ não foi')).toHaveCount(2, { timeout: 30_000 });

    // Os dois "não foi" chegam ao chat-diagnostics.log com o detalhe do portão, nunca com o texto enviado.
    const diagnostics = (): string => {
      try {
        return readFileSync(path.join(chat.userDataDir, 'chat-diagnostics.log'), 'utf8');
      } catch {
        return '';
      }
    };
    const sendFailures = (): Array<Record<string, unknown>> =>
      diagnostics()
        .split('\n')
        .filter((l) => l.includes('"kind":"send-failed"'))
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    await expect.poll(() => sendFailures().length, { timeout: 10_000 }).toBe(2);
    for (const failure of sendFailures()) {
      expect(failure).toMatchObject({ reason: 'comando desconhecido', step: 'await-ack', sendKind: 'slash', screenRead: true, alive: true });
    }
    expect(diagnostics()).not.toContain('foobar');
    expect(diagnostics()).not.toContain('/mod');

    // Comando nativo conhecido entra. `/cost` e nativo SEM tela propria: um que abre tela (`/status`) agora chega
    // marcado `opensScreen` (T087) e segura a fila ate a tela aparecer - o falso nao a desenha.
    await send(page, '/cost');
    await expect(timeline(page).getByText('/cost').first()).toBeVisible({ timeout: 30_000 });
    await expect(timeline(page).getByText('✕ não foi')).toHaveCount(2);

    // Na fila -> entrou: durante a rodada (`demorar`) a segunda mensagem espera a proxima pausa.
    await send(page, 'demorar um pouco');
    await expect(timeline(page).getByText('demorar um pouco')).toBeVisible();
    await expect
      .poll(async () => (await timeline(page).getByText('✓ entrou').count()) >= 3, { timeout: 30_000 })
      .toBe(true);
    await send(page, 'mensagem da fila');
    await expect(timeline(page).getByText('na fila', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(timeline(page).getByText('entra na próxima pausa do Claude')).toBeVisible();
    await helpers.shot('send-03-na-fila');
    await expect(timeline(page).getByText('na fila', { exact: true })).toHaveCount(0, { timeout: 40_000 });
    await expect(timeline(page).getByText('mensagem da fila')).toHaveCount(1);
    expect(userLines(chat.sessionsDir).filter((l) => l.text === 'mensagem da fila').length).toBe(1);

    // Interromper e mandar agora: com o Claude trabalhando o Enviar vira SplitButton.
    await send(page, 'demorar de novo');
    await expect(timeline(page).getByText('demorar de novo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mais opções de Enviar' })).toBeVisible({ timeout: 20_000 });
    await input(page).fill('para tudo e responde isto');
    await page.getByRole('button', { name: 'Mais opções de Enviar' }).click();
    await page.getByRole('menuitem', { name: 'Interromper e mandar agora' }).click();
    await expect(timeline(page).getByText('para tudo e responde isto')).toBeVisible();
    await expect
      .poll(() => userLines(chat.sessionsDir).filter((l) => l.text === 'para tudo e responde isto').length, { timeout: 40_000 })
      .toBe(1);
    expect(allTranscriptText(chat.sessionsDir)).toContain('Request interrupted by user');
    await expect(timeline(page).getByText('na fila', { exact: true })).toHaveCount(0, { timeout: 40_000 });
    await helpers.shot('send-04-interrompeu');

    // `!cmd`: modo shell do CLI (risco conhecido: a caixa em modo shell le "!" mesmo vazia).
    await send(page, '!echo oi');
    await expect.poll(() => allTranscriptText(chat.sessionsDir), { timeout: 40_000 }).toContain('<bash-input>echo oi</bash-input>');
    // O cartão do `!` fica no nível de cima da conversa (não dentro de um grupo recolhido) e recebe "entrou".
    const shellCard = timeline(page).getByText('! echo oi');
    await expect(shellCard).toBeVisible({ timeout: 30_000 });
    await expect(shellCard.locator('xpath=../..').getByText('✓ entrou')).toBeVisible({ timeout: 30_000 });
    await expect(timeline(page).getByText('✕ não foi')).toHaveCount(2);
    await expect(page.getByText(/Há texto não enviado no terminal/)).toHaveCount(0);
    // E o que vem depois ainda entra (a caixa nao ficou presa em modo shell).
    await send(page, 'depois do shell');
    await expect
      .poll(() => userLines(chat.sessionsDir).filter((l) => l.text === 'depois do shell').length, { timeout: 40_000 })
      .toBe(1);

    // SC-006: alternar chat <-> terminal 10x preserva o rascunho.
    await input(page).fill('rascunho que nao pode sumir');
    for (let i = 0; i < 10; i += 1) {
      await helpers.showView('terminal');
      await helpers.showView('chat');
    }
    await expect(input(page)).toHaveValue('rascunho que nao pode sumir');
    await helpers.shot('send-05-rascunho');
  });
});

test('T072 - Enter perdido e reenviado uma vez, sem duplicar a mensagem @chat', async () => {
  test.setTimeout(180_000);
  await withChatApp('chat-send-enter', { DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER: '1' }, async (chat, page) => {
    await launchClaudeTab(page, {});
    await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await send(page, 'mensagem do enter perdido');
    await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
    await expect(timeline(page).getByText('mensagem do enter perdido')).toHaveCount(1);
    expect(userLines(chat.sessionsDir).filter((l) => l.text === 'mensagem do enter perdido').length).toBe(1);
  });
});

// 30/10 - decisão do dono: "Só envia, sem esperar ele finalizar, e acompanha se o próprio Claude coleta". Com o
// Claude no meio de um turno longo que ESCONDE a caixa (`DONEL_FAKE_CLAUDE_HIDE_BOX_WHILE_WORKING`), a mensagem é
// escrita na hora, o Enter sai sem a caixa visível, o cartão diz "na fila" e ela entra na pausa - sem interromper.
test('mensagem mandada no meio de um turno longo, com a caixa escondida, entra sem interromper @chat', async () => {
  test.setTimeout(180_000);
  await withChatApp(
    'chat-send-midturn',
    { DONEL_FAKE_CLAUDE_SLOW_MS: '15000', DONEL_FAKE_CLAUDE_HIDE_BOX_WHILE_WORKING: '1' },
    async (chat, page) => {
      const helpers = chatHelpers(page);
      await launchClaudeTab(page, {});
      await expect(page.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });

      await send(page, 'demorar bastante');
      await expect(timeline(page).getByText('✓ entrou')).toHaveCount(1, { timeout: 60_000 });
      // Hooks dizem que o turno está em andamento (o Enviar vira SplitButton) e a caixa do terminal sumiu.
      await expect(page.getByRole('button', { name: 'Mais opções de Enviar' })).toBeVisible({ timeout: 10_000 });

      await send(page, 'mensagem no meio do turno');
      await expect(timeline(page).getByText('mensagem no meio do turno')).toBeVisible();
      await expect(timeline(page).getByText('na fila', { exact: true })).toBeVisible({ timeout: 12_000 });
      await expect(timeline(page).getByText('entra na próxima pausa do Claude')).toBeVisible();
      // O próprio CLI guardou a mensagem na fila dele DURANTE o turno (queue-operation enqueue).
      await expect
        .poll(() => allTranscriptText(chat.sessionsDir), { timeout: 10_000 })
        .toMatch(/"operation":"enqueue"[^\n]*mensagem no meio do turno/);
      await helpers.shot('send-06-fila-caixa-escondida');

      await expect(timeline(page).getByText('✓ entrou')).toHaveCount(2, { timeout: 40_000 });
      await expect(timeline(page).getByText('na fila', { exact: true })).toHaveCount(0);
      const delivered = userLines(chat.sessionsDir).filter((l) => l.text === 'mensagem no meio do turno');
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.raw).toContain('"promptSource":"queued"');
      expect(allTranscriptText(chat.sessionsDir)).not.toContain('Request interrupted by user');
      await expect(timeline(page).getByText('✕ não foi')).toHaveCount(0);
    },
  );
});
