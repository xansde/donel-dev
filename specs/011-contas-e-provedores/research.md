# Research & Clarifications — 011, etapa 1 (motor de contas + mods)

> Escopo deste arquivo: **somente a etapa 1** da entrega 011 — motor de contas
> como interface, mod Seazone, mod local (pool próprio) e auto-switch 90/20.
> As etapas 2 (demolição de perfis + migração) e 3 (registry de providers
> classe A + OpenRouter) têm runs próprios da esteira e **não** são planejadas
> aqui.
>
> O detalhe integral do research (fatos de código, alternativas descartadas)
> vive em `.scratch/contas-e-provedores/issues/01..07`. Este arquivo só carrega
> (a) o que a etapa 1 reaproveita desses tickets e (b) as **lacunas da spec**
> resolvidas por julgamento na fase Plano, com a razão de cada uma.

## 1. Recorte da etapa 1

A spec 011 cobre a entrega inteira. A tabela abaixo fixa o corte.

| Item da spec | Etapa 1? | Nota |
|---|---|---|
| Princípio de mods + contrato `listAccounts/switchTo/captureRotatedPair/keepAlive?` | **Sim** | É o coração da etapa |
| Mod Seazone (list/switch/heartbeat, nunca renova token) | **Sim** | |
| Mod local (cofre `safeStorage`, switch-time-only, carga por endpoint OAuth) | **Sim** | Ver §2 (por que os dois mods juntos) |
| Auto-switch 90/20 power-of-two-choices, desligável | **Sim** | |
| MCPs em config única sobrevivendo à troca | **Sim** (como consequência) | A troca reescreve só `.credentials.json`; o motor nunca cria config dir por conta |
| Emenda à regra de credenciais confinada ao mod local | **Sim** | Atualização do `CLAUDE.md` entra com o código |
| Dropdown de headroom alimentado pelo motor | **Sim** (mínimo) | UI existente adaptada, **não** reescrita |
| Demolição de `profile-manager`/junctions, morte das 4 suítes | **Não** — etapa 2 | Perfis seguem vivos e intocados |
| Migração do dia da virada (credenciais, transcripts, MCPs, junctions) | **Não** — etapa 2 | |
| Registry de providers (classe A/B), OpenRouter | **Não** — etapa 3 | |
| `sessionAccountLabel` mudando de fonte, B8/auto-switch saindo do backlog, spec 002 superseded | **Não** — etapa 2 | A etapa 1 alimenta o rótulo pelo contrato **atual**, sem mexer nele (ver C10) |
| Fallback automático de provider, mods externos, UI de MCPs | Fora de escopo da 011 inteira | |

## 2. Por que os DOIS mods na etapa 1 (e não só o Seazone)

A "Cadência de entrega" da spec (`[T-7]`) nomeia a entrega 1 como
"**Motor + mod Seazone**". O card desta fase (`pln-motor-contas-mods`) nomeia
o mesmo lote incluindo **o mod local**. Não é ampliação de escopo: a spec, no
princípio de mods `[T-3]`, exige que a interface nasça **extraída dos dois
mods concretos** — com um mod só não há de onde extrair, e a interface sairia
sendo o formato da API da Seazone com outro nome, exatamente o acoplamento que
o discovery vetou. Além disso, a independência de infra ("funciona mesmo com
desligamento da Seazone") só é demonstrável com o mod local existindo.

Decisão: etapa 1 = motor + **os dois** mods + auto-switch. A frase da cadência
é lida como o nome curto do lote, não como exclusão do mod local.

## 3. Fatos de código reaproveitados (dos tickets)

- **Adoção sem reiniciar** `[T-2]`: escrever `~/.claude/.credentials.json` e
  **apagar o bloco `oauthAccount`** de `~/.claude.json` — a ausência força o
  CLI a re-fetch. Essas duas escritas, juntas e nessa ordem, são o switch.
- **Refresh é do servidor** `[T-2]`: o `anthropic_client.py` da Seazone renova;
  há ainda um monitor externo com `refresh_owner`/`token_version`. Refresh
  token da Anthropic é de **uso único** → renovar localmente uma conta do pool
  Seazone colide com o monitor. Por isso o mod Seazone **nunca** renova.
- **Auto-switch** `[T-2]`: `daemon.py` ~601-674 — troca quando `max(5h, 7d,
  sonnet) ≥ 90` E existe conta com folga `≥ 20` pontos; seleção
  power-of-two-choices.
- **Porta quase direta para TS** `[T-2]`: selection, limiares, `_needs_refresh`
  (buffer de expiração), timefmt. **Reescrever**: credentials (merge + write
  0600), limpeza do `oauthAccount`, keychain → `safeStorage`, scheduler →
  timer interno do Electron. **Irrelevante**: repository, auth Google,
  coordenação `refresh_owner`, ratelimit, migrations.
- **Colisão com a 010** `[T-1][T-7]`: hub de risco é `src/main/index.ts`
  (hospeda estado de perfil, spawn e os IPC da Esteira). Esta frente não toca
  `esteira-*`; a v1 **não precisa** mudar `openPhaseSession`/`commandBuilder`.

## 4. Clarifications — lacunas resolvidas nesta fase

Sem humano no loop; cada item traz a razão e fica marcado como suposição
revisável. **Nenhuma delas amplia o escopo além do que o Discovery decidiu** —
todas escolhem a leitura mais conservadora dentro do que já estava fechado.

**C1 — Coexistência com perfis durante a etapa 1.** A etapa 1 não demole nada,
mas motor e perfis não podem escrever credencial no mesmo lugar ao mesmo
tempo. Resolução: o motor tem um **alvo de config dir** (`claudeHome`), default
`~/.claude`. Enquanto um mod estiver ativo, sessões `claude` novas nascem **sem
override de `CLAUDE_CONFIG_DIR`** (ou seja, no `~/.claude` real) e a UI de
contas do motor substitui o seletor de perfis. Com mod desligado, o
comportamento de hoje segue **byte a byte** o de hoje.

**C2 — Qual mod é o default.** Nenhum. `accounts.mod` nasce `null` (motor
inerte, zero mudança de comportamento) e o operador escolhe `'seazone'` ou
`'local'` na UI. É o flag natural que torna a etapa 1 mergeável sem esperar a
demolição — e reduz o risco de conviver com a 010.

**C3 — Quem chama `keepAlive()`.** Timer do main process (15 min, espelhando o
daemon do switcher), **só enquanto o app está aberto** e **só se o mod ativo
implementa**. Mod Seazone implementa (`POST /session/heartbeat`); mod local
**não** implementa (switch-time-only é decisão fechada `[T-3]`). Nada roda com
o app fechado — nenhum agendador de SO é criado.

**C4 — Quando a carga é lida.** Sob demanda (abrir a UI de contas, botão
"atualizar") + poll de baixa frequência (5 min) enquanto existir ao menos uma
sessão `claude` viva. Auto-switch é avaliado nesses momentos. Sem leitura por
token, sem `npx quota-axi` no caminho quente `[T-3]`.

**C5 — Quando o auto-switch pode disparar.** A troca é global (reescreve o
`.credentials.json`) e atinge todas as sessões vivas na próxima chamada delas —
é o comportamento do switcher, aceito. Para não trocar no meio de uma resposta,
o auto-switch **adia** enquanto houver sessão com o semáforo em estado de
trabalho, reavaliando no ciclo seguinte. Reusa sinal que já existe
(`session-semaphore-manager`), não cria mecanismo novo.

**C6 — De onde sai o par rotacionado.** `captureRotatedPair()` lê o
`.credentials.json` vigente **antes** de sobrescrevê-lo e, se o par diferir do
guardado, grava o rotacionado como o par corrente da conta que sai. Chamado
pelo motor (a) antes de todo switch e (b) no encerramento do app. No mod
Seazone a operação é o próprio payload do `switch`/`heartbeat`; no mod local
grava no cofre.

**C7 — Onde vivem config e cofre.** Metadado **não sensível** (mod ativo,
política de auto-switch, lista de contas do pool local: id, label, plano) vai
para a chave `accounts` do `config.json` do `userData`, seguindo o padrão de
sanitize/versionamento do `config-store.ts`. Segredo vai para arquivo
**separado** (`accounts-vault.json`, mesmo `userData`), blob cifrado por
`safeStorage`. Separar evita que um print/backup do `config.json` — coisa
rotineira em suporte — passe perto de credencial.

**C8 — Identidade de conta (LGPD).** Conta é `{ id opaco, label }`. Nunca
e-mail, nunca nome de pessoa, em UI, log ou artefato. O mod Seazone usa o label
que a API devolve; o local usa o rótulo que o operador digitar. Segredo nunca
é ecoado para o renderer (write-only, padrão T3 `[T-3]`).

**C9 — Falha do backend do mod.** API fora / máquina offline: o motor reporta
"contas indisponíveis", **nunca** bloqueia abrir sessão, e o auto-switch pausa
até a próxima leitura bem-sucedida. Sem troca automática de mod — fallback
automático é fora de escopo por decisão de entrevista.

**C10 — Rótulo de conta da sessão.** O `sessionAccountLabel` **não muda de
contrato** na etapa 1 (isso é etapa 2). Com motor ativo, o main preenche
`PtyCreateResult.profile` com `{ slug: accountId, name: label }` vindo do
motor. A statusbar continua funcionando sem uma linha alterada em
`src/shared/sessionAccountLabel.ts`.

**C11 — Segredo do mod Seazone.** O `sessionRefreshToken` (30 dias) é o único
segredo do mod Seazone e vai para o **mesmo cofre** do mod local — o cofre é
infraestrutura do motor, a *exceção* de regra é o mod local **ler credencial
da Anthropic**. O core do Donel segue sem tocar credencial.

## 5. Alternativas consideradas e rejeitadas nesta fase

| Alternativa | Rejeitada porque |
|---|---|
| Clonar o heartbeat/daemon do switcher também no mod local | Refresh token de uso único: processo periódico local renovando conta do pool colide com o monitor externo da Seazone; e "nada toca credencial com o app fechado" é requisito `[T-3]` |
| Framework de mods genérico (loader, manifesto, sandbox) já na etapa 1 | Guard-rail explícito do discovery: interface **extraída** de dois mods concretos, framework só no 3º mod real |
| Entregar só o mod Seazone na etapa 1 | Interface sairia moldada na API da Seazone — o acoplamento que a frente existe para evitar (§2) |
| Manter `CLAUDE_CONFIG_DIR` por conta (reaproveitando junctions) | Mata o ganho central: config única de MCPs sobrevivendo à troca; e junction nunca foi necessária `[T-4]` |
| Guardar o cofre dentro do `config.json` | Um arquivo que é rotineiramente aberto/impresso em suporte não é lugar de segredo (C7) |
| Trocar de conta no meio de um turno | Resposta em voo com credencial trocada é falha silenciosa; adiar custa um ciclo de 5 min (C5) |
