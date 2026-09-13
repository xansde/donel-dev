# Plano — etapa 3: pool próprio com 4 contas e troca em voo

> Origem: pedido do dono em 13/09/2026 — "quero 4 contas no alfa e conseguir
> migrar entre elas **durante** sessões". Duas decisões dele na mesma conversa:
> **(a) o pool Seazone está fora** ("não usarei mais o pool"); **(b) isto já
> existiu** ("nós já tivemos isso, de ter várias contas cadastradas").
>
> Esta etapa sucede a etapa 2 (demolição de perfis + migração assistida). Não
> amplia a emenda de credenciais do `CLAUDE.md`: tudo que toca segredo continua
> dentro de `src/main/accounts/`.

## 1. Onde estamos (medido na máquina do dono, 13/09/2026)

| Item | Estado |
|---|---|
| App instalado | Alfa **0.3.2** (build 13/08) — tem o motor da etapa 1 e o assistente da etapa 2 |
| `config.json` (userData) | `mod: null`, `localAccounts: []` → **motor inerte, zero contas** |
| Cofre `accounts-vault.json` | **10 entradas órfãs**: `seazone:session`, 8 pares `tech-*` (migrados em 04/08) e `provider:openrouter:*` — a config não sabe mais que existem |
| Perfis antigos | `~/.claude-profiles.old` (tech-1..tech-8, credenciais de 30/07). O assistente lê `~/.claude-profiles` — **não os enxerga mais** |
| CLI | Logado numa conta **Max**, par válido no `~/.claude/.credentials.json` |

O motor já entrega, testado em unidade/smoke: mods, cofre `safeStorage`, switch
na ordem invariante (`claude-state.ts`), auto-switch puro 90/20 com
power-of-two e adiamento por sessão ocupada, poll de 5 min com sessão viva,
carga real pelo endpoint OAuth de usage.

## 2. A regressão que o pedido expõe

"Já tivemos várias contas cadastradas" está certo: o mecanismo de **perfis**
(`CLAUDE_CONFIG_DIR` por perfil) dava N contas, e morreu na etapa 2. O motor
que o substituiu **suporta N contas no backend** — `connectMod`
(`index.ts:1581`) faz append em `localAccounts`, e o importador da migração
registra uma conta por perfil —, mas a **UI perdeu o gesto**:

- o formulário de conectar só existe quando `view.mod === null`
  (`AccountsPanel.tsx:191`); assim que a primeira conta entra, ele some;
- não há "Adicionar conta", nem "Remover conta";
- o único caminho de volta ao formulário é **Desconectar**, que reseta para
  `defaultAccountsConfig()` (`index.ts:1610`) — apaga a lista e **deixa o
  segredo no cofre**. É exatamente a origem dos 8 pares órfãos medidos acima.

O modelo novo é melhor que os perfis (config única, MCP não duplica, troca sem
reiniciar sessão). O que falta é devolver o gesto que os perfis tinham.

## 3. Os cinco furos entre hoje e o pedido

| # | Furo | Evidência |
|---|---|---|
| **F1** | Cadastro só aceita **uma** conta pela UI | `AccountsPanel.tsx:191` + `index.ts:1610` |
| **F2** | Par entra por copiar-colar e com **validade chutada** (`expiresAt = agora + 1h`) — se o token colado vencer antes, o mod acha que está válido, não dispara o refresh de fallback e o switch grava um par morto | `AccountsPanel.tsx:146` |
| **F3** | **A promessa central nunca foi provada com CLI real**: "trocar de conta sem reiniciar sessão" está `[ ]` no `e2e.md` §3. Os smokes usam mod falso; a adoção sem reiniciar é hipótese de research (C5), não fato medido | `e2e.md` §3 |
| **F4** | Depois da troca, **a tela mente**: o rótulo e a cota da aba são da conta de **nascimento** (`PtyCreateResult.account`, imutável pela vida da aba — `sessionAccountLabel.ts`), não da vigente | `index.ts:824`, `App.tsx:1755` |
| **F5** | A troca é **global** e isso não está dito em lugar nenhum da UI: atinge todas as sessões vivas na próxima chamada delas. 4 abas **não** podem rodar em 4 contas ao mesmo tempo | `research.md` C5 |

## 4. Fases

Fatiadas pelo custo de **validação manual** (cada entrega custa uma bateria do
dono), não pelo tamanho do diff.

### Fase 0 — Provar a promessa e já sair com as 4 contas (sem código)

Hoje mesmo, usando só o que existe. Os 4 logins não são desperdiçados: eles são
o cadastro real das 4 contas do pool.

Para cada conta, um **login isolado** num PowerShell fora do Donel — a pasta do
perfil é o próprio `CLAUDE_CONFIG_DIR` do login, e o `~/.claude` não é tocado:

```powershell
$env:CLAUDE_CONFIG_DIR = "$env:USERPROFILE\.claude-profiles\conta-a"; New-Item -ItemType Directory -Force $env:CLAUDE_CONFIG_DIR | Out-Null; claude
# onboarding → login com a conta → /exit → fechar a janela. Repetir com conta-b, conta-c, conta-d.
```

Sem `.donel-profile.json`, o rótulo no painel cai no slug ("Conta A").

> **Corrigido na execução (13/09).** A versão anterior mandava `/logout` →
> `/login` no `~/.claude` e copiar o `.credentials.json`. Não serve: (1) o
> `/logout` **revoga no servidor** o refresh token que acabou de ser copiado
> (`research-etapa-3-cli.md` A3); (2) atinge as sessões vivas, que dividem o
> mesmo `~/.claude`; (3) a primeira troca depois da importação **não captura** o
> par do `~/.claude` — `activeAccountId` nasce `null` e o motor só captura com
> `fromId` (`account-engine.ts`, `switchTo`) —, então uma cópia que divida a
> família de token com o CLI morre na primeira renovação. Com login isolado,
> cada conta tem família própria. Condição: a conta logada hoje no `~/.claude`
> precisa ser uma das 4, senão a primeira troca descarta o login dela da máquina.

Depois, no Donel Dev → botão **Contas** → **"Migrar perfis antigos"** →
**Importar** nas 4 linhas (uma por clique, é o design D10). Alfa ou Beta: os dois
0.3.2 instalados têm o código de contas idêntico (bundles comparados em 13/09),
mas **um canal aberto por vez**, porque dividem o `config.json`. Isso grava os 4
pares no cofre com o `expiresAt` **real** do arquivo, registra as 4 em
`localAccounts` e liga o mod local sozinho (`index.ts:1676`). Fechar com
**Arquivar** (renomeia a pasta; já trata a colisão com o `.old` existente).

**Gate — o teste que decide o resto do plano** (`e2e.md` §3, em aberto desde
04/08):

1. abrir uma sessão `claude` de verdade, mandar uma mensagem e rodar `/usage` e
   `/status` (anotar os números e a conta);
2. **sem fechar a aba**, trocar pelo painel para uma conta com carga
   **diferente** da atual — é o que deixa o `/usage` distinguir as duas;
3. mandar uma mensagem nova na **mesma** aba e rodar `/usage` e `/status` de
   novo. A evidência é o `/usage`, que usa o token em memória; o `/status` lê a
   config vigiada e pode divergir (`research-etapa-3-cli.md` A4);
4. abrir uma aba **nova** e rodar `/usage` — a troca vale para sessão nova?;
5. confirmar que um MCP configurado continua respondendo na aba do passo 1.

Previsão pelo código (`research-etapa-3-cli.md` A1): o passo 3 mostra a conta
**antiga** — a sessão viva só adota a nova na próxima renovação do token (≤5 min
do vencimento) ou num 401 —, e o passo 4 mostra a nova.

- **Passou** → o desenho está certo; seguem as fases 1 e 2 como escritas.
- **Reprovou** (o CLI cacheia o par em memória por processo) → o modelo de
  "troca global em voo" cai, e o plano vira: `CLAUDE_CODE_OAUTH_TOKEN` por PTY
  (conta fixa por aba, o spawn já sabe aplicar env e `CLAUDE_CONFIG_DIR` por
  sessão) ou troca com reinício explícito da sessão. **Nenhuma linha das fases
  1–2 deve ser escrita antes deste veredito.**

Saída da fase: 4 contas cadastradas e funcionando + veredito registrado no
`e2e.md` §3.

### Fase 1 — Devolver o cadastro (o gesto que os perfis tinham)

1. **"Adicionar conta"** disponível com o pool já conectado — o formulário deixa
   de depender de `mod === null`.
2. **Login isolado, sem copiar-colar** (mata o F2): o app cria
   `<userData>/accounts-login-<uuid>/`, abre uma aba `claude` com
   `CLAUDE_CONFIG_DIR` nesse diretório, o dono faz o `/login` oficial **dentro
   do terminal** (regra de credenciais intacta), e o colhedor lê o
   `.credentials.json` de lá — com `expiresAt` real — direto para o cofre,
   apagando o diretório em seguida. Mecanismo já vivo e testado: `ensureConfigDir`
   (`provider-registry.ts:173`) + `resolveSessionConfigDir`
   (`providers/session-config-dir.ts:19`), usados hoje pelos providers classe A.
   Colar token continua existindo como fallback, aí **com campo de validade**.
3. **Remover conta** (apaga do cofre **e** da config) e **Desconectar** que não
   some com a lista em silêncio — some com ela dizendo o que vai acontecer.
4. **Faxina** das 10 entradas órfãs do cofre (uma passada de reconciliação
   `cofre × localAccounts` no boot, registrando o que removeu).
5. **"Pool Seazone" sai do seletor** (decisão (a) do dono). O mod continua no
   código, inerte, até ele mandar removê-lo de vez.

Testes: vitest para o colhedor (arquivo ausente/malformado/válido), para o ciclo
add→list→remove e para a reconciliação do cofre; smoke Playwright do fluxo de
adicionar com mod falso. PR para `staging`, **uma** bateria manual.

### Fase 2 — Verdade na tela + rodízio automático

1. Rótulo e cota da aba passam a refletir a conta **vigente** (o `accounts:changed`
   que o motor já emite reetiqueta as abas), com marca de que a aba **trocou em
   voo** — a conta de nascimento vira histórico, não a verdade exibida (mata F4).
2. Frase explícita no painel: a troca vale para **todas** as sessões vivas (F5).
3. `expired-credentials` vira ação — "reconectar esta conta" reabre o login
   isolado da Fase 1.2 em vez de um erro sem saída.
4. Auto-switch exercitado com carga real das 4 contas: limiar 90/20, adiamento
   com sessão trabalhando, e o comportamento quando **todas** passam de 90
   (hoje: não troca e não avisa — decidir se avisa).

PR para `staging`, **uma** bateria manual.

### Fase 3 — Dogfooding

`npm run dist:alfa` do checkout de `staging`, instalar, e rodar a semana nas 4
contas. Alfa é liberado sem pedir permissão; `main` e o repo público seguem no
bloqueio total.

## 5. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | O CLI pode cachear o par em memória por processo → troca em voo não pega | É o gate da Fase 0. Se cair, o plano muda de forma antes de qualquer código |
| R2 | Refresh token é de **uso único**: perder o par rotacionado mata a conta | Já é o desenho (`captureRotatedPair` antes de qualquer escrita, `claude-state.ts`). Cobrir com teste a captura no encerramento do app |
| R3 | Conta parada semanas expira (refresh só acontece no switch) | Aceito na spec; a Fase 2.3 transforma isso em "reconectar", um gesto, não um beco |
| R4 | 4 contas × poll de 5 min = ~48 chamadas/h ao endpoint de usage | Observar na Fase 3; se irritar, ler carga só da ativa + sob demanda das outras |
| R5 | Trocar para conta de plano diferente no meio da sessão pode tirar o modelo em uso | Mostrar o plano na lista e no aviso de troca |

## 6. Fora de escopo

- **Pool/mod Seazone** — decisão do dono. Sai da UI nesta etapa; remoção do
  código fica para quando ele mandar.
- **Uma conta por aba simultânea** — é tecnicamente possível (o spawn aceita
  `CLAUDE_CONFIG_DIR`/env por sessão), mas contradiz o modelo de config única
  que a 011 escolheu, e não é o que foi pedido ("migrar **entre** elas durante
  sessões"). Fica nomeado aqui como alternativa, não como plano.
- **Providers alternativos** (OpenRouter e afins) — ortogonal, já entregue.
