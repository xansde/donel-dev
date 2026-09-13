# Roteiro de teste manual — 011 Contas & Provedores

Este arquivo é cumulativo por etapa. Cada seção cobre só o que a suíte
automatizada (vitest + smoke Playwright) **não** cobre — integração real,
UI de verdade, fluxo ponta a ponta no alfa. Execução é sempre gesto humano.

## Etapa 1 — motor de contas + mods (2026-08-04)

Cobertura automatizada já fechada (não repetir aqui): `sanitizeAccountsConfig`,
cofre (round-trip/recusa sem `safeStorage`), `claude-state.ts` (ordem
invariante, merge, atomicidade), auto-switch (limiares/power-of-two),
contrato dos dois mods, máquina de estados do motor, adiamento por sessão
ocupada, formatador de carga (conversão de unidade), e os três smokes com mod
falso (`accounts-switch`, `accounts-mcp-survives-switch`,
`accounts-secret-never-leaks`).

**Captura visual de 04/08/2026** (`captura-visual-etapa-1.md`): as seções **1**
e **7** deste roteiro passaram a ser cobertas por dois roteiros de print
(`.claude/skills/tutorial-e2e/roteiros/contas-motor-{inerte,ativo}.spec.ts`),
que também fotografam os estados do motor **ativo** com o mod falso. Elas
seguem listadas abaixo como referência do que a captura verifica — o que
continua exigindo gesto humano é tudo que depende de **credencial real, rede
real ou máquina sem `safeStorage`**: seções 2, 3, 4, 5 e 6.

O que os automatizados **não** provam e só um humano confere:

### 1. Motor nasce inerte — app abre igual a hoje

- [ ] Instalar/abrir o alfa numa máquina SEM `accounts.mod` configurado
      (config.json novo ou sem a chave `accounts`).
- [ ] Abrir uma sessão `claude` normalmente. Confirmar que o comportamento é
      **idêntico** ao de antes desta etapa: perfil ativo de sempre,
      `CLAUDE_CONFIG_DIR` aplicado como sempre, dropdown de perfis
      funcionando.
- [ ] Abrir o painel "Contas" (novo botão no titlebar, ao lado do badge de
      perfil). Confirmar que mostra "Nenhum provedor conectado" sem travar a
      tela nem afetar o resto do app.

### 2. Conectar o mod local com credencial REAL (fora de teste)

- [ ] No painel "Contas", escolher "Pool próprio", preencher rótulo + um
      `accessToken`/`refreshToken` REAIS de uma conta Anthropic (obtidos fora
      do app — o app nunca os gera).
- [ ] Confirmar que a lista de contas aparece com carga real (5h/semana) lida
      do endpoint `api.anthropic.com/api/oauth/usage` — o smoke usa fixture,
      isto aqui é a chamada de rede de verdade.
- [ ] Confirmar visualmente que o campo de token digitado nunca reaparece em
      lugar nenhum da UI (reabrir o painel, inspecionar DOM se quiser) — o
      smoke automatizado varre `window.donel.accounts.*` e o DOM, mas com
      dados FALSOS; aqui é o mesmo teste com o dado real.

### 3. Trocar de conta sem reiniciar sessão (com sessão `claude` REAL aberta)

> **Veredito 13/09/2026 — PASSOU** (Fase 0 da etapa 3, `plan-etapa-3.md` §4;
> Donel Dev Beta 0.3.2, CLI 2.1.270, troca da conta 3 para a Interno 1). Leitura
> do código do CLI e detalhe da medição em `research-etapa-3-cli.md`.

- [x] Com uma sessão `claude` aberta e ativa (trabalhando de verdade, não
      simulada), trocar de conta pelo painel "Contas". *(13/09: aba nova com
      mensagem enviada antes; troca pelo painel para a Interno 1, primeira troca
      do pool — `activeAccountId` era `null`.)*
- [x] Sem fechar/reabrir a aba, mandar uma mensagem nova nessa sessão e
      confirmar que ela responde usando a conta NOVA (ex.: rodar `/status`
      dentro da sessão `claude`, ou observar a cota da conta mudando).
      *(13/09: na mesma aba, o `/usage` foi de 4%/45% com reset em 17/09 para
      0%/14% com reset em 18/09 — outra conta —, e a request pós-troca teve 1
      miss do prompt cache. O `/status` **não** serve de evidência: logo depois
      da troca ele mostra "Claude API account", sem conta, até o CLI refazer o
      fetch do perfil. Uma aba aberta depois da troca também nasceu na conta
      nova.)*
- [x] Confirmar que o MCP já configurado (`~/.claude.json` → `mcpServers`)
      continua funcionando nessa mesma sessão depois da troca (D6 — promessa
      central da spec). O smoke prova que o arquivo não muda; isto aqui prova
      que o MCP FUNCIONA de fato depois. *(13/09: a aba que trocou manteve os
      mesmos 11 servidores conectados no `/status`; o MCP do GitHub respondeu
      numa aba aberta depois da troca; e a sessão que conduziu a Fase 0, viva
      desde antes da troca, chamou o MCP filesystem com sucesso depois dela.)*

### 4. Auto-switch em tempo real (90/20)

- [ ] Deixar o auto-switch ligado e usar a conta ativa até ela realmente
      passar de 90% numa das janelas (5h/semana/sonnet) — ou, mais rápido,
      simular no `config.json` de teste um valor de carga alto para forçar o
      cálculo (ainda assim rodando o app de verdade, não vitest).
- [ ] Confirmar que o app troca sozinho para uma conta com folga ≥ 20 pontos,
      **sem** nenhuma sessão `claude` trabalhando no momento.
- [ ] Abrir uma sessão `claude` e deixá-la "trabalhando" (heurística do
      semáforo, ver `session-semaphore-manager.ts`) durante a janela em que o
      auto-switch deveria disparar; confirmar que ele **adia** (C5) e só troca
      depois que a sessão volta a ficar ociosa.
- [ ] Desligar o auto-switch pelo toggle do painel e confirmar que a troca
      automática para de acontecer mesmo com carga alta.

### 5. Mod Seazone com backend real

- [ ] Conectar o mod Seazone com um `sessionRefreshToken` real e `baseUrl`
      apontando pro switcher de verdade.
- [ ] Confirmar `listAccounts`/`switchTo`/heartbeat (15 min, deixar o app
      aberto e observar que a sessão do switcher não expira) funcionando
      contra o servidor real — os testes automatizados usam HTTP falso.
- [ ] Confirmar que o mod Seazone realmente NUNCA tenta renovar token Anthropic
      (checar logs/tráfego de rede — não deve haver chamada a
      `platform.claude.com` vinda do app com esse mod ativo).

### 6. `safeStorage` indisponível (se houver máquina de teste sem ele)

- [ ] Numa máquina/ambiente onde `safeStorage.isEncryptionAvailable()` é
      `false` (raro no Windows, mas verificável em VM sem keyring), confirmar
      que o app recusa conectar qualquer mod (`vault-unavailable`) e nunca
      grava segredo em texto plano.

### 7. Regressão visual dos perfis

- [ ] Com o motor **inerte**, abrir o dropdown de perfis (`ProfileSwitcher`)
      e confirmar visualmente que nada mudou: criar perfil, ativar, doctor,
      excluir — tudo como antes desta etapa.
- [ ] Com o motor **ativo** (mod configurado), confirmar que o dropdown de
      perfis continua existindo e não quebra (mesmo que o app tenha duas UIs
      de troca de conta ao mesmo tempo nesta etapa — é o esperado, a
      demolição de perfis é a etapa 2).
