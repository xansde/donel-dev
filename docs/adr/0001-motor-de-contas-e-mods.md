---
name: Motor de contas plugável por mods
type: adr
status: accepted
created: 2026-08-04
updated: 2026-08-04
tags: [adr, contas, credenciais, 011-contas-e-provedores]
aliases: [ADR-0001, motor de contas, AccountMod]
---

# ADR 0001 — Motor de contas plugável por mods

<!-- managed:start -->

## Contexto

O operador do Donel Dev usa mais de uma conta Claude e hoje caça na mão qual
delas ainda tem cota, reiniciando a sessão para trocar. O mecanismo em uso —
perfis paralelos via `CLAUDE_CONFIG_DIR` + junctions em `~/.claude-profiles` —
não resolve o problema por três razões estruturais:

1. **Não troca sozinho.** O headroom aparece no dropdown, mas a troca é gesto
   manual e exige sessão nova; a sessão em andamento não sobrevive.
2. **Duplica configuração.** Cada perfil carrega o próprio `.claude.json`, então
   cada MCP é configurado N vezes e as cópias divergem em silêncio.
3. **É órfão de futuro.** As contas compartilhadas são de um pool corporativo
   (Seazone). O app não pode ficar acoplado a repositório ou infraestrutura de
   terceiro que pode sair do ar.

Existe um serviço interno (`claude-switcher`) que resolve a dor com auto-switch
por carga, sem reiniciar o CLI — mas é controlado por outra equipe. A decisão é
absorver a lógica para dentro do app, mantendo o pool alheio como **um** backend
entre outros.

O risco central que molda todo o desenho é o **refresh token de uso único** da
Anthropic: renová-lo invalida o anterior. Dois processos renovando a mesma conta
(o app e o monitor do pool compartilhado) queimam o par um do outro e a conta
morre. Perder o par novo em qualquer ponto — não gravá-lo antes de usar, deixar
de capturar o par que o CLI rotacionou — tem o mesmo efeito. Isso torna a ordem
das escritas de credencial parte do contrato, não detalhe de implementação.

## Decisão

Introduzir um **motor de contas** no main process, plugável atrás do contrato
`AccountMod` (`src/main/accounts/account-mod.ts`), com dois mods concretos —
Seazone (pool compartilhado) e local (pool próprio) — e auto-switch por carga.
A interface foi **extraída** dos dois mods reais, nunca projetada em abstrato:
quatro membros (`listAccounts`, `switchTo`, `captureRotatedPair` e o opcional
`keepAlive`). Não há loader externo, registry nem manifesto; o motor escolhe
entre dois construtores por config.

As sete invariantes abaixo são a decisão de fato — o resto é implementação.

### 1. O motor nasce inerte

`accounts.mod = null` por default (`sanitizeAccountsConfig`,
`src/main/accounts/accounts-config.ts`); o construtor de `AccountEngine`
(`src/main/accounts/account-engine.ts`) entra no estado `inert` e nenhum
caminho implícito o ativa. Assim a etapa é mergeável e instalável sozinha,
reversível por uma chave de config, e o fluxo atual de perfis segue intacto
enquanto o motor é exercitado no canal alfa.

### 2. `CredentialPair` não sai de `src/main/accounts/`

O tipo é declarado em `account-mod.ts` e nunca cruza o preload, nunca entra em
log (nem truncado) e nunca entra em mensagem de erro. Para fora circulam apenas
`AccountSummary`/`AccountsViewDto` (`src/shared/accounts.ts`). Segredo que só
existe dentro de uma pasta pode ser auditado lendo aquela pasta; segredo que
transita por DTO exige auditar o app inteiro a cada mudança.

### 3. A escrita de credencial é uma só, com ordem invariante

`applyAccountSwitch` (`src/main/accounts/claude-state.ts`) é a única função do
sistema que escreve credencial, sempre nesta ordem: captura do par rotacionado
da conta que sai → escreve `~/.claude/.credentials.json` (merge atômico,
preservando chaves desconhecidas) → apaga o bloco `oauthAccount` de
`~/.claude.json`. Inverter perde o par rotacionado e deixa a conta que saiu sem
credencial válida. Uma exceção na captura aborta o switch inteiro, antes de
qualquer escrita. Mod nenhum escreve em `~/.claude*`: `switchTo()` **devolve** o
par e o motor o aplica.

### 4. O mod Seazone é estruturalmente incapaz de renovar token

`src/main/accounts/mods/seazone-mod.ts` não importa `token-refresh.ts` — de
propósito. O refresh do pool compartilhado é do servidor deles, coordenado com
um monitor externo; renovar localmente queimaria o par (invariante do uso
único). A separação é estrutural para não depender de convenção que se esquece.
O que o mod mantém vivo é a própria sessão do switcher (`keepAlive` renova o JWT
curto a cada 15 min, timer do processo vivo — nunca agendador de sistema).

### 5. O mod local é switch-time-only

`src/main/accounts/mods/local-mod.ts` guarda os pares no cofre `safeStorage`
(`src/main/accounts/vault.ts`), sem heartbeat e sem agendador — não implementa
`keepAlive`. O refresh HTTP existe apenas como fallback, no switch, quando o par
da conta que entra já está vencido; o resultado é gravado no cofre **antes** de
ser usado, porque perder o par novo inutiliza a conta. Consequência aceita:
conta parada por meses pede re-login uma vez.

### 6. O auto-switch 90/20 é função pura e desligável

`selectSwitchTarget` (`src/main/accounts/auto-switch.ts`) não faz I/O e não
guarda estado: troca quando `max(5h, 7d, sonnet)` da conta ativa atinge
`switchAtLoad` (90) **e** existe candidata com folga de ao menos `minAdvantage`
(20) pontos; entre as candidatas escolhe a melhor de duas sorteadas
(power-of-two-choices, com o sorteio injetável para teste determinístico). Conta
com carga desconhecida nunca é destino. Um switch automático é adiado enquanto
houver sessão trabalhando (`evaluateAutoSwitch`, que apenas lê o semáforo);
switch manual nunca é adiado.

### 7. Nenhuma linha de perfis é removida nesta etapa

A demolição do mecanismo de perfis é etapa própria. Motor inerte e perfis vivos
coexistem de propósito: é o que permite validar o motor no alfa sem apostar o
fluxo que funciona hoje.

## Consequências

**Positivas**

- A etapa entra por PR sozinha, sem coordenar demolição, e volta atrás com uma
  chave de config.
- A superfície de credencial do app é uma pasta, não um fluxo — o resto do app e
  a UI seguem sem tocar segredo, e o formulário de conectar é write-only.
- Configuração de MCP deixa de ser duplicada por conta: o motor não cria nem
  aponta `CLAUDE_CONFIG_DIR`, então as sessões nascem no `~/.claude` real e
  sobrevivem a qualquer troca. O requisito é cumprido por ausência de mecanismo.
- Trocar o backend do pool compartilhado (ou perdê-lo) custa um mod novo, não um
  redesenho.

**Negativas e limitações conhecidas**

- **Perfis continuam de pé.** Enquanto a demolição não vier, há dois mecanismos
  de conta no app ao mesmo tempo, e textos de garantia escritos para um deles
  podem descrever mal o outro.
- **O formato do arquivo de credencial foi inferido — e depois confirmado.** A
  chave `claudeAiOauth` em `.credentials.json` foi deduzida do formato usado
  pelo CLI e coberta por testes com dublê; a execução manual do roteiro de e2e
  (`specs/011-contas-e-provedores/e2e.md`) pelo dono, durante a fase Validar em
  2026-08-04, confirmou o formato contra o CLI real. Fica registrado o método:
  dublê escrito a partir do contrato não prova o contrato — foi o e2e humano
  que fechou a inferência.
- **`expiresAt` fabricado na UI.** Ao conectar uma conta do pool próprio, o
  `AccountsPanel.tsx` monta o par com `expiresAt` de uma hora à frente, chutado.
  É esse campo que decide se o mod local tenta o refresh de fallback: um par já
  vencido é tratado como válido pela primeira hora, e um par de validade longa
  provoca refresh desnecessário. Limitação a resolver na etapa seguinte —
  o valor tem que vir do provedor ou ser perguntado.
- **Persistência do `activeAccountId` fora do motor.** A gravação em config
  acontece no handler IPC do gesto manual; um switch automático muda o estado em
  memória e pode ser desfeito por um `setConfig` posterior. Inerte hoje, real no
  dia em que um mod de verdade for ligado.
- O uso único do refresh token continua sendo a falha de maior custo do domínio:
  as invariantes 3, 4 e 5 existem só para cercá-la, e qualquer código novo que
  toque credencial precisa ser lido contra elas.

## Referências

- [`specs/011-contas-e-provedores/spec.md`](../../specs/011-contas-e-provedores/spec.md) — problema, modelo de mods e critérios.
- [`specs/011-contas-e-provedores/plan.md`](../../specs/011-contas-e-provedores/plan.md) — decisões de desenho D1–D7 que este ADR consolida.
- [`specs/011-contas-e-provedores/e2e.md`](../../specs/011-contas-e-provedores/e2e.md) — roteiro manual: o que só um humano com credencial e rede reais confere.
- [`tasks/lessons.md`](../../tasks/lessons.md) — lições de 2026-08-04 sobre a implementação e a validação do motor.
- `CLAUDE.md` (raiz), seção **Credenciais** — a exceção nomeada e confinada que este ADR aprofunda.

<!-- managed:end -->
