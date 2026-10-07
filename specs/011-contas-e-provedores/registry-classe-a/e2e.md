# Roteiro e2e manual — 011, etapa 3 (registry de providers, classe A)

Passo a passo para o Alexandre validar no alfa aquilo que os testes
automatizados **não** cobrem: integração real, UI de ponta a ponta, e o
piloto OpenRouter de verdade. Os 4 smokes roteirizados do plano
(`tests/smoke/providers-*.spec.ts`) já cobrem registry inerte, env de
sessão, "segredo nunca vaza" e "classe B recusada" com fixtures — este
roteiro é sobre o que só um humano vendo a tela consegue confirmar.

## Pré-requisito

- Build do alfa mais recente instalado (`npm run dist:alfa` ou
  `npm run dev`), com a branch `esteira/contas-e-provedores` (esta etapa).
- Chave do OpenRouter à mão no Bitwarden (item "OpenRouter - API Key").

## 1. Registry vazio — comportamento de hoje intocado

1. Abrir o Donel Dev num perfil/`userData` sem nenhum provider cadastrado.
2. Abrir o Launcher ("＋ Nova sessão").
3. **Verificar**: não existe nenhum campo "Provedor" na tela. O launcher é
   idêntico ao que já existia antes desta etapa.
4. Lançar uma sessão normal (conta/motor, sem provider) e confirmar que ela
   funciona exatamente como antes (login, MCPs, hooks, semáforo).

## 2. Cadastrar o provider OpenRouter (piloto real)

1. Clicar no botão "Provedores" da titlebar.
2. Criar um novo provider classe A:
   - Nome: "OpenRouter" (ou outro rótulo livre, sem nome de pessoa).
   - Variáveis de ambiente (uma por linha):
     ```
     ANTHROPIC_BASE_URL=https://openrouter.ai/api
     ANTHROPIC_MODEL=claude-sonnet-5
     ```
     **Atenção ao achado do spike T1302**: o valor é `https://openrouter.ai/api`
     — **sem** `/v1` no final. Com `/v1` a sessão falha (o CLI concatena
     `/v1/messages` por conta própria; ver `spike-t1302-openrouter.md`).
   - Nomes das variáveis secretas: `ANTHROPIC_AUTH_TOKEN`.
3. Clicar em "Criar provedor".
4. **Verificar**: o provider aparece na lista com "Segredo: não configurado".
5. Ler a chave do OpenRouter do Bitwarden e colar no campo de segredo
   `ANTHROPIC_AUTH_TOKEN` deste provider, clicar "Salvar" (T1325 — gesto
   humano, a chave nunca deve ser digitada em nenhum outro lugar: nem chat,
   nem arquivo, nem terminal do app).
6. **Verificar**: o status muda para "Segredo: configurado". Fechar o painel
   e reabrir — nunca aparece o valor digitado de volta (write-only, C19).

## 3. Lançar sessão com provider e outra com conta lado a lado

1. Abrir o Launcher, selecionar o projeto de teste.
2. No campo "Provedor", escolher "OpenRouter".
3. **Verificar**: os controles de Modelo/Esforço ficam desabilitados, com a
   explicação de uma linha (C18).
4. Clicar "▶ Iniciar".
5. **Verificar**: a aba abre e o `claude` sobe conversando com o OpenRouter
   (mandar uma mensagem simples, ex. "diga oi", e confirmar resposta).
6. Abrir uma SEGUNDA aba, desta vez sem selecionar provider (ou selecionando
   "Claude (conta)").
7. **Verificar**: as duas abas convivem lado a lado, uma com o provider e
   outra na conta normal, sem interferência entre elas.

## 4. Ver o semáforo funcionando com provider

1. Na aba do provider, mandar um comando que gere uma edição de arquivo (ou
   qualquer ação que dispare o semáforo — "working"/"waiting"/"permission").
2. **Verificar**: os indicadores de estado da aba (StateDot) mudam
   normalmente — hooks/`--settings` não dependem do config dir (A7 do plan.md).

## 5. Ver o transcript nascer no config dir do provider

1. Com a sessão do provider ainda aberta, localizar
   `<userData>/providers/<id>/projects/<slug-do-cwd>/<sessionId>.jsonl`
   (`<userData>` = `%APPDATA%\donel-dev` no Windows).
2. **Verificar**: o arquivo existe e cresce conforme a conversa acontece —
   mesmo mecanismo de sempre, só que na raiz do provider (C17), não em
   `~/.claude`.
3. Fechar a aba, reabrir "Sessões anteriores" do mesmo projeto.
4. **Verificar**: a nota de origem (C17) explica que a lista vem do provider
   selecionado — nunca uma lista vazia sem explicação.

## 6. Remover o provider

1. No painel "Provedores", clicar "Remover" no OpenRouter cadastrado.
2. **Verificar**: o provider some da lista; o Launcher volta a não mostrar o
   campo "Provedor" (se este era o único cadastrado).
3. **Verificar** (C16/contrato "remoção preserva o config dir"): a pasta
   `<userData>/providers/<id>/` — e o `.jsonl` gravado no passo 5 — continua
   no disco (a remoção apaga só a entrada + o segredo do cofre, nunca os
   transcripts do operador).

## O que este roteiro NÃO precisa reconfirmar

Os itens abaixo já têm suíte automatizada verde (vitest + smoke com
fixtures) e não precisam de nova checagem manual:

- Sanitização do `config.json` (entrada corrompida descartada, `entries: []`
  default) — `tests/providersConfig.test.ts`.
- `buildProviderEnv`/`missing-secret` nomeando a variável, nunca o valor —
  `tests/providerEnv.test.ts`.
- Cofre (`provider-secrets.ts`): round-trip, `vault-unavailable`, remoção —
  `tests/providerSecrets.test.ts`.
- Precedência `resolveSessionConfigDir` (provider > motor > perfil), tabela
  verdade completa — `tests/sessionConfigDir.test.ts`.
- As 6 invariantes do registry (segredo nunca sai, classe B recusada, env
  não sequestra `CLAUDE_CONFIG_DIR`, `missing-secret` aborta, `vault-unavailable`,
  remoção preserva config dir) + duas entradas de formatos diferentes —
  `tests/providerRegistry.test.ts`.
- `buildPtyEnv` com `envOverrides` (regressão byte a byte sem overrides,
  `CLAUDE_CONFIG_DIR` só pelo parâmetro próprio) — `tests/pty-manager.test.ts`.
- Argv sem `--model`/`--effort` com provider — `tests/launchArgsForProvider.test.ts`.
- Os 4 smokes roteirizados do plano (registry inerte, env de sessão fictícia,
  segredo plantado nunca vaza, classe B recusada com mensagem) —
  `tests/smoke/providers-inert.spec.ts`, `providers-session-env.spec.ts`,
  `providers-secret-never-leaks.spec.ts`, `providers-class-b-refused.spec.ts`.
