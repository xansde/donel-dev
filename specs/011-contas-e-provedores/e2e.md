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

- [ ] Com uma sessão `claude` aberta e ativa (trabalhando de verdade, não
      simulada), trocar de conta pelo painel "Contas".
- [ ] Sem fechar/reabrir a aba, mandar uma mensagem nova nessa sessão e
      confirmar que ela responde usando a conta NOVA (ex.: rodar `/status`
      dentro da sessão `claude`, ou observar a cota da conta mudando).
- [ ] Confirmar que o MCP já configurado (`~/.claude.json` → `mcpServers`)
      continua funcionando nessa mesma sessão depois da troca (D6 — promessa
      central da spec). O smoke prova que o arquivo não muda; isto aqui prova
      que o MCP FUNCIONA de fato depois.

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
