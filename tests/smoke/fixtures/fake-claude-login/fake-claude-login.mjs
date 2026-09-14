// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — corpo do `claude` FALSO
// usado só pelo smoke `accounts-add-login.spec.ts`. Simula o `/login` oficial
// dentro da aba de login isolado: espera um instante (como um operador
// digitando), grava `.credentials.json`/`.claude.json` no `CLAUDE_CONFIG_DIR`
// da sessão (nunca no `~/.claude` real — recusa se a variável faltar ou
// resolver pra lá) e fica vivo até o app matar o processo, do mesmo jeito que
// o `claude` de verdade continua rodando depois do `/login`.

import { realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const FALLBACK_FAKE_ACCOUNT_UUID = '11111111-1111-4111-8111-111111111111';
const LOGIN_WAIT_MS = 500;

function realClaudeConfigDir() {
  return join(homedir(), '.claude');
}

function resolvesToRealClaudeHome(dir) {
  const real = resolve(realClaudeConfigDir());
  try {
    return realpathSync(resolve(dir)).toLowerCase() === realpathSync(real).toLowerCase();
  } catch {
    // Um dos dois pode não existir ainda — compara os caminhos resolvidos
    // (case-insensitive, Windows) sem exigir que existam no disco.
    return resolve(dir).toLowerCase() === real.toLowerCase();
  }
}

function main() {
  const configDir = process.env.CLAUDE_CONFIG_DIR;

  // 011-contas-e-provedores, etapa 3, Fase 2 — modo SESSÃO: sem
  // `CLAUDE_CONFIG_DIR` é uma aba `claude` comum (a que segue a troca global),
  // aberta pelo smoke `accounts-fase-2.spec.ts` para ler a statusbar. Não grava
  // NADA em lugar nenhum — só fica vivo até o app matar o processo.
  if (!configDir) {
    console.log('Sessão falsa (fake) — nada é gravado.');
    setInterval(() => {}, 60 * 60 * 1000);
    return;
  }

  if (resolvesToRealClaudeHome(configDir)) {
    console.error('fake-claude-login: CLAUDE_CONFIG_DIR apontando pro ~/.claude real — recusando escrever.');
    process.exitCode = 1;
    return;
  }

  setTimeout(() => {
    const credentials = {
      claudeAiOauth: {
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
        expiresAt: Date.now() + 8 * 60 * 60 * 1000,
        scopes: ['user:inference'],
      },
    };
    writeFileSync(join(configDir, '.credentials.json'), JSON.stringify(credentials), 'utf8');

    const accountUuid = process.env.FAKE_CLAUDE_ACCOUNT_UUID || FALLBACK_FAKE_ACCOUNT_UUID;
    writeFileSync(join(configDir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid } }), 'utf8');

    console.log('Login successful (fake)');

    // Fica vivo até o app matar o processo (kill do PTY) — o colhedor real
    // só lê o par e mata a aba depois; este fake precisa continuar "aberto"
    // pelo mesmo tempo, senão o smoke não distingue "ainda aguardando" de
    // "já foi encerrado".
    setInterval(() => {}, 60 * 60 * 1000);
  }, LOGIN_WAIT_MS);
}

main();
