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

## Etapa 3, Fase 1 — devolver o cadastro (bateria de 13/09/2026)

Plano: `plan-etapa-3.md` §4, Fase 1. Branch `feature/contas-fase-1-cadastro`.

**Veredito — PASSOU (13/09/2026, canal Alfa, build da branch, PR #73).** O dono
rodou os 5 passos com o Beta fechado. Estado conferido na máquina depois da
bateria: cofre com 5 chaves (4 contas + `provider:openrouter:*`), nenhuma pasta
`accounts-login-*`, uma linha só no `accounts-maintenance.log`, a Interno 4
recadastrada por login isolado (única com impressão) e a Interno 1 ativa de
novo. Passo 5 relatado por ele: 4 contas após reiniciar, sem "Pool Seazone",
OpenRouter "configurado".

Tropeço no passo 3, que vale como lição: a primeira tentativa perguntou à
sessão "qual email dessa sessão?", e ela respondeu a conta antiga. Esse email
é o carimbo `userEmail` que o harness grava no contexto **no início da
sessão** — não muda com a troca e não é evidência. Refeito com `/usage` antes
e depois, na mesma aba, a janela semanal mudou: a troca em voo funcionou.

Cobertura automatizada já fechada (não repetir aqui): o motor reconstrói quando
a lista de contas muda (F6) e persiste a conta ativa que ele mesmo trocou; faxina
do cofre com fixture que inclui `provider:*` e prova que ele sobrevive; planos de
remover e desconectar, com o bloqueio da ativa; par colado sem validade (F2);
colhedor do login isolado (ordem cofre → encerrar PTY → apagar diretório, conta
repetida, aba que fecha antes do login, sobras varridas no boot); e o smoke
`accounts-add-login`, com `claude` falso e mod falso.

O que só a máquina do dono prova: o `/login` do CLI real num config dir efêmero,
a credencial real entrando no pool vivo sem reiniciar, a troca em voo para a
conta recadastrada e a faxina no cofre de verdade.

**Pré-condições**

- **Beta fechado por completo.** Alfa e Beta dividem `config.json` e cofre — um
  canal aberto por vez. `Get-Process 'Donel Dev Beta' -ErrorAction SilentlyContinue`
  não pode listar nada.
- Donel Dev Alfa instalado com o build desta branch.
- Cofre antes de abrir o Alfa — só nomes de chave, nunca valor:
  `(Get-Content "$env:APPDATA\donel-dev\accounts-vault.json" -Raw | ConvertFrom-Json).entries.PSObject.Properties.Name`
  Medido em 13/09, antes da fase: **14** chaves — 4 contas, 8 órfãs (dos perfis
  `tech-*`), `seazone:session` e `provider:openrouter:*`.
- **A faxina já rodou no cofre real, e não foi pelo Alfa.** Às 17:53 de 13/09 a
  suíte de smokes rodou com o build desta branch, e o
  `config-persistence.spec.ts` sobe o app contra o userData real (exceção
  deliberada, descrita em `tests/smoke/userDataIsolation.ts`). O boot dele
  removeu as 9 entradas previstas. Conferido às 18:11, sem ler valor: **5**
  chaves (as 4 contas + `provider:openrouter:*`), ids do cofre iguais aos da
  config, Interno 1 ativa e **uma** linha `vault-reconciled` com 9 removidas em
  `%APPDATA%\donel-dev\accounts-maintenance.log`. Por isso o passo 1 mudou.

### 1. Boot num cofre já limpo + remover uma conta não ativa

- [x] Abrir o Alfa. O cofre segue com **5** chaves (4 ids de conta +
      `provider:openrouter:*`), e o `accounts-maintenance.log` continua com
      **uma** linha só, a de 17:53: num cofre limpo, o boot não remove nada nem
      escreve no log.
- [x] Contas → na linha de uma conta **não** ativa (ex.: Interno 4) → Remover →
      Remover. A linha some e o cofre fica com **4** chaves.

### 2. Readicionar por login isolado, sem reiniciar

- [x] Contas → Rótulo `Interno 4` → **Entrar com login**. O painel fecha e abre a
      aba `Login · Interno 4`.
- [x] Na aba, seguir o fluxo do CLI (tema → "Claude account with subscription" →
      navegador) com **a mesma conta** que era a Interno 4. Antes de autorizar,
      conferir que a conta logada no claude.ai é essa — se não for, abrir a URL
      que o CLI mostra numa janela anônima. **Nunca** digitar `/logout`.
- [x] Segundos depois do login, a aba fecha sozinha e o painel reabre com
      "Conta «Interno 4» adicionada." A linha aparece **com carga**, sem
      reiniciar o app.
- [x] Nenhuma pasta `accounts-login-*` em `%APPDATA%\donel-dev`; o cofre volta a
      **5** chaves.

### 3. Trocar para ela numa sessão viva

- [x] Abrir uma sessão `claude` num projeto, mandar uma mensagem e rodar `/usage`.
- [x] Trocar para a Interno 4 pelo painel. Na mesma aba, mandar outra mensagem e
      rodar `/usage` de novo: janela semanal e reset são outros — é a conta nova.
      O `/status` mostra "Claude API account" por alguns minutos e não serve de
      evidência.

### 4. Remover a conta ativa é bloqueado

- [x] Contas → Remover na linha da Interno 4 (agora ativa) → Remover. Aparece
      "«Interno 4» é a conta em uso — troque para outra antes de removê-la…", e
      ela continua na lista e no cofre.

### 5. Reiniciar

- [x] Fechar e reabrir o Alfa: as 4 contas no painel, e a seção de adicionar não
      oferece mais "Pool Seazone".
- [x] Cofre com **5** chaves; em **Provedores**, o OpenRouter segue "configurado".

## Etapa 3, Fase 2 — verdade na tela + rodízio (bateria de 13/09/2026)

Plano: `plan-etapa-3.md` §4, Fase 2. Branch `feature/contas-fase-2-verdade-na-tela`,
PR #76.

**Veredito — PASSOU (14/09/2026, canal Alfa, build da branch do PR #76).** O
dono rodou os 5 passos e relatou que todos passaram: carga das 4 contas (paradas
renovadas e ativa), linhas `account-pair-refreshed`, frase da troca global;
statusbar em voo (aba A com "trocou em voo", aba B sem, aba de provedor);
auto-switch adiado com sessão trabalhando, troca ao terminar e aviso "sem conta
com folga"; "Reconectar" da `Teste vencida` (caixa sem clicar, clique não troca,
login cancelado, remoção); e reinício (4 contas com carga, Contas ✓, cofre com 5,
OpenRouter configurado). Conferido por esta sessão em 14/09: cofre com **5**
chaves (4 contas + `provider:openrouter:*`, só nomes).

**Pendência de estado, não de comportamento:** o limiar do auto-switch **não**
foi devolvido no fim do passo 3 — o `config.json` seguia em `switchAtLoad: 0,
minAdvantage: 1` em 14/09. Devolver 90/20 com o comando do passo 3, **com o
Alfa fechado**, antes do uso normal (com 0/1 o rodízio troca a cada leitura).

Cobertura automatizada já fechada (não repetir aqui): o rótulo da statusbar em
todos os ramos (conta vigente, "trocou em voo", provedor, login, terminal, sem
conta com folga, sem leitura das outras contas); os textos do auto-switch; o
motor marcando "Reconectar" na troca recusada e limpando na troca ou no login;
conta marcada fora do auto-switch; a última decisão (trocou, adiou, falhou) e o
estado (`off`/`idle`/`armed`/`saturated`/`blind`); refresh recusado × sem rede;
renovação na leitura (uma por conta, nunca a ativa, recusa não se repete, a troca
que chega no meio espera a mesma renovação); carga da ativa pelo par vivo;
reconectar com conta sumida, conta de outra linha e fingerprint divergente; e o
smoke `accounts-fase-2`, com `claude` e mod falsos.

O que só a máquina do dono prova: a carga real das contas paradas voltando
depois de ~8h sem uso e a da ativa lida do `~/.claude`; a statusbar acompanhando
uma troca com sessão de verdade; o auto-switch com carga real, adiado pelo
semáforo de uma sessão trabalhando de verdade; e a recusa do servidor a um
refresh token inválido.

**Pré-condições**

- **Beta fechado por completo** (`Get-Process 'Donel Dev Beta' -ErrorAction
  SilentlyContinue` não lista nada). Alfa e Beta dividem `config.json` e cofre.
- Donel Dev Alfa instalado com o build desta branch.
- Cofre com **5** chaves, só nomes:
  `(Get-Content "$env:APPDATA\donel-dev\accounts-vault.json" -Raw | ConvertFrom-Json).entries.PSObject.Properties.Name`
- Linhas do log de manutenção antes de abrir o Alfa:
  `(Get-Content "$env:APPDATA\donel-dev\accounts-maintenance.log").Count`
- Nunca `/logout`.

### 1. Carga das 4 contas, inclusive as paradas e a ativa

- [x] Abrir o Alfa → **Contas ✓**. As 4 linhas mostram carga (`5h NN% · semana
      NN%`), nenhuma "sem dado": as paradas há mais de ~8h (renovadas na leitura)
      e a ativa (lida do `~/.claude`).
- [x] O log de manutenção ganhou uma linha `account-pair-refreshed` com
      `trigger: read` para cada conta parada há mais de ~8h, e nenhuma para a
      ativa. O cofre segue com **5** chaves.
- [x] Abaixo dos botões do painel: "A troca vale para todas as sessões abertas:
      cada uma passa a usar a conta nova na próxima mensagem. Sessões de provedor
      não mudam."

### 2. A statusbar acompanha a troca em voo

- [x] Abrir uma sessão `claude` (aba A), mandar uma mensagem e rodar `/usage`.
      Statusbar: `Sessão: <ativa> · N% usado`, com N igual ao maior número da
      linha dela no painel.
- [x] Trocar pelo painel para outra conta. Sem mandar nada, a statusbar da aba A
      passa a `Sessão: <nova> · M% usado · trocou em voo (era <ativa de antes>)`.
- [x] Na aba A, mandar outra mensagem e rodar `/usage`: a janela semanal é a da
      conta nova.
- [x] Abrir a aba B: `Sessão: <nova> · M% usado`, sem "trocou em voo".
- [x] Abrir uma sessão com o provedor OpenRouter, sem mandar mensagem: a
      statusbar mostra `Sessão: <rótulo do provedor> · provedor`. Fechar a aba.

### 3. Auto-switch adia com sessão trabalhando e troca quando ela termina

Com 90/20 a troca só dispara quando uma conta passa de 90%, o que não cabe numa
bateria. O passo baixa o limiar para 0/1 com o Alfa fechado e devolve 90/20 no
fim. A carga continua a real.

- [x] No painel, trocar para a conta de **maior** carga. Fechar o Alfa e
      conferir: `Get-Process 'Donel Dev Alfa' -ErrorAction SilentlyContinue`
      vazio.
- [x] Baixar o limiar (imprime a política antes e depois):
      `node -e "const fs=require('fs');const f=process.env.APPDATA+'/donel-dev/config.json';const c=JSON.parse(fs.readFileSync(f,'utf8'));console.log('antes',c.accounts.autoSwitch);c.accounts.autoSwitch={...c.accounts.autoSwitch,enabled:true,switchAtLoad:0,minAdvantage:1};fs.writeFileSync(f,JSON.stringify(c,null,2));console.log('agora',c.accounts.autoSwitch)"`
- [x] Abrir o Alfa e uma sessão `claude`. Mandar um pedido que leve cerca de um
      minuto e, **enquanto a resposta sai**, Contas → **Atualizar**: aparece
      "Troca automática adiada às HH:MM: há sessão trabalhando. Ela sai quando a
      sessão terminar.", e a conta ativa não muda.
- [x] Quando a resposta termina, sem clicar em nada: em poucos segundos a
      statusbar passa para outra conta, com "trocou em voo", e o painel mostra
      "Troca automática às HH:MM: de «<maior carga>» para «<outra>»."
- [x] Contas → **Atualizar**, repetindo até a ativa ser a de menor carga (no
      máximo 3 vezes): aparece "A conta ativa passou de 0% e nenhuma outra tem 1
      ponto de folga — a troca automática não tem para onde ir.", o botão vira
      **Contas ⚠** e a statusbar termina com `· sem conta com folga`.
- [ ] Fechar o Alfa e devolver 90/20:
      `node -e "const fs=require('fs');const f=process.env.APPDATA+'/donel-dev/config.json';const c=JSON.parse(fs.readFileSync(f,'utf8'));c.accounts.autoSwitch={...c.accounts.autoSwitch,switchAtLoad:90,minAdvantage:20};fs.writeFileSync(f,JSON.stringify(c,null,2));console.log(c.accounts.autoSwitch)"`
      **(14/09: não feito na bateria — pendente, ver veredito.)**
      O toggle "Trocar automaticamente" fica ligado; desligue no painel se
      preferir (estava desligado desde a Fase 0).

### 4. Credencial recusada vira "Reconectar"

- [x] Contas → Rótulo `Teste vencida` → **Colar token (avançado)** → Access
      token `x`, Refresh token `y`, validade vazia → **Adicionar**. Em segundos,
      sem clicar na linha, aparece embaixo dela "A credencial de «Teste vencida»
      venceu e o servidor recusou a renovação. Reconecte para voltar a usar esta
      conta." e o botão **Reconectar**. (A leitura de carga tentou renovar o par
      e o servidor recusou o `y`.)
- [x] Clicar na linha da `Teste vencida`: a conta ativa não muda, a statusbar
      também não, e a caixa continua.
- [x] **Reconectar** → o painel fecha e abre a aba `Login · Teste vencida`. Não
      fazer login. Reabrir Contas → **Cancelar login** → "Login de «Teste
      vencida» cancelado.", e a caixa continua na linha.
- [x] Remover a `Teste vencida`. O cofre volta a **5** chaves.

### 5. Reiniciar

- [x] Fechar e reabrir o Alfa: 4 contas com carga, nenhum aviso de troca
      automática, **Contas ✓**, cofre com **5** chaves e OpenRouter
      "configurado" em Provedores.
