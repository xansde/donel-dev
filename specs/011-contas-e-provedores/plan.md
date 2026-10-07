# Plano técnico — 011 Contas & Provedores · **Etapa 1**: motor de contas + mods

**Branch**: `esteira/contas-e-provedores` · **Data**: 2026-08-04 · **Spec**:
`specs/011-contas-e-provedores/spec.md` · **Card**: `pln-motor-contas-mods`

Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Complementos deste
plano: `research.md` (recorte + clarifications C1–C11), `data-model.md`,
`contracts/account-mod.md`, `contracts/backends-http.md`,
`contracts/ipc-accounts.md`.

## Sumário

A spec 011 cobre três entregas. **Este plano cobre só a primeira**: transformar
o motor de contas em interface, entregar dois mods concretos (Seazone e local /
pool próprio), absorver a política de auto-switch 90/20 e fazer a troca de
conta acontecer **sem reiniciar sessão** e **sem duplicar config de MCP**.
Nada é demolido: perfis, junctions e as 4 suítes deles seguem intactos, e o
motor nasce **inerte** (`accounts.mod = null`, C2) — quem não configurar um mod
não percebe diferença nenhuma.

O que fica explicitamente para os runs irmãos:

- **Etapa 2 — `pln-demolicao-perfis-migracao`**: morte de `profile-manager.ts`
  + junctions + doctor/repair, morte das 4 suítes de perfil, migração assistida
  do dia da virada, `sessionAccountLabel` mudando de fonte, limpeza do backlog
  (B8/US-12 e auto-switch), spec 002 marcada superseded.
- **Etapa 3 — `pln-registry-providers-classe-a`**: registry de providers,
  classe A com OpenRouter, env por provider no spawn, estrutura vazia da
  classe B.
- **Fora da 011**: fallback automático de provider, mods externos carregáveis,
  UI de MCPs/integrações.

## Contexto técnico

| | |
|---|---|
| **Linguagem** | TypeScript 5.x, Node do Electron (main process) + React (renderer) |
| **Dependências novas** | **nenhuma** — `safeStorage` e `net`/`fetch` já vêm do Electron/Node |
| **Storage** | `config.json` (`userData`, chave `accounts`) + `accounts-vault.json` (`userData`, cifrado) + arquivos do CLI (`~/.claude/.credentials.json`, `~/.claude.json`) |
| **Testes** | vitest nos módulos puros/injetáveis; smoke roteirizado (Playwright/Electron, padrão do repo) para UI e caminho de troca |
| **Plataforma-alvo** | Windows 11 (canal alfa); código sem dependência de junction ou de agendador de SO |
| **Restrição dura** | Nenhum processo periódico toca credencial com o app fechado |
| **Escala** | Pool de dezenas de contas; leitura de carga sob demanda + poll de 5 min (C4) |

## Gate de constituição

`.specify/memory/constitution.md` está **não preenchido** (template). A
constituição de fato deste repo é o `CLAUDE.md`; os gates aplicados são:

| Regra do repo | Como este plano cumpre |
|---|---|
| "O app NUNCA lê, grava ou exibe credenciais" | **Emenda explícita da spec**: a exceção é o mod local, confinada em `src/main/accounts/` (mods + cofre + `claude-state`). Nenhum outro módulo do app importa `CredentialPair`; o renderer nunca o recebe. O `CLAUDE.md` é atualizado **junto** com o código (T1128) |
| TDD com escopo | Módulos puros (auto-switch, sanitize, parsers, transformação do `oauthAccount`) nascem com vitest; UI/PTY por smoke roteirizado |
| UI em pt-BR, código em inglês | Respeitado |
| LGPD | Conta = id opaco + label; nunca e-mail nem nome (C8) |
| Nada fora das tasks sem atualizar a spec | Este plano recorta a spec; as clarifications C1–C11 estão registradas em `research.md` e resumidas em `spec.md` |

## Dependência de sequenciamento — **bloqueante** `[T-7]`

> **A implementação desta etapa só começa quando os batches da 010 (Esteira do
> Donel) fecharem em staging.** O hub `src/main/index.ts` hospeda ao mesmo
> tempo o estado de perfil, o spawn de PTY e os IPC da Esteira; dois refactors
> simultâneos nele recriam exatamente o desencontro de contrato que originou a
> 010.

Consequências operacionais:

- Este plano e o `tasks.md` são **documento**: podem ser revisados e commitados
  agora (é o que esta fase faz), mas nenhuma task de código roda antes do gate.
- Mitigação de merge: **99% do código novo mora em arquivos novos**
  (`src/main/accounts/**`, `src/shared/accounts.ts`, `src/renderer/src/Accounts*`).
  O toque em `index.ts` é deliberadamente mínimo e concentrado em **uma única
  task** (T1122): registrar os handlers do motor e consultar a conta ativa no
  spawn. Se a 010 ainda estiver quente, T1122 é a última a entrar.
- Esta frente **não toca** `esteira-*`, `openPhaseSession.ts` nem
  `commandBuilder.ts` — a v1 não precisa deles (mesmo binário `claude`).

## Arquitetura em uma tela

```
   RENDERER
     AccountsPanel.tsx  (nasce como adaptação do ProfileSwitcher, não reescrita)
       │  accounts:list / accounts:switch / accounts:getConfig|setConfig
       │  accounts:connectMod  ← ÚNICO ponto por onde segredo ENTRA (write-only)
       ▼  accounts:changed (push)
   ─────────────────────────────── preload (src/preload/index.ts) ──────────────
   MAIN
     src/main/index.ts  ── registra handlers + pergunta "qual conta está ativa?"
       │                    no spawn (T1122 — único arquivo compartilhado)
       ▼
     accounts/account-engine.ts        ← orquestrador (a "interface" em uso)
       ├─ accounts/auto-switch.ts      ← PURO: 90/20 + power-of-two-choices
       ├─ accounts/claude-state.ts     ← ÚNICA escrita de credencial do sistema
       │     .credentials.json (merge, atômico, 0600) + strip oauthAccount
       ├─ accounts/vault.ts            ← safeStorage; write-only; recusa texto plano
       ├─ accounts/accounts-config.ts  ← chave `accounts` no config-store
       └─ accounts/mods/
            ├─ seazone-mod.ts   list/switch/heartbeat · NUNCA renova token
            └─ local-mod.ts     cofre + usage OAuth · refresh SÓ fallback
                  └─ usage-client.ts / token-refresh.ts (HTTP injetável)
```

Fronteira de credencial: a caixa `accounts/` é a **única** que conhece
`CredentialPair`. Fora dela circulam apenas `AccountSummary`/`AccountsViewDto`.

## Decisões de desenho

### D1 — A interface é extraída, não projetada

`AccountMod` (ver `contracts/account-mod.md`) tem exatamente os quatro membros
que os dois mods concretos exigem: `listAccounts`, `switchTo`,
`captureRotatedPair` e `keepAlive?` (opcional, só o Seazone implementa). Nada
de registry de mods, manifesto ou loader — o motor escolhe entre dois
construtores com um `switch` de duas linhas. Framework só no 3º mod real
(guard-rail `[T-3]`).

### D2 — A escrita de credencial é uma só, e mora fora dos mods

`switchTo()` **devolve** o par; quem escreve é `claude-state.ts`. Isso mantém
uma única implementação da sequência crítica (`captura → escreve
.credentials.json → apaga oauthAccount`), impede que um mod novo a reimplemente
errado, e concentra em um arquivo o teste da ordem invariante.

### D3 — Mod Seazone nunca renova token

Fato de código `[T-2]`: o refresh é do servidor deles e há monitor externo
coordenado por `refresh_owner`/`token_version`; o refresh token da Anthropic é
de **uso único**. `seazone-mod.ts` não importa `token-refresh.ts` — a separação
é estrutural, não uma convenção que se esquece.

### D4 — Mod local é switch-time-only

Sem heartbeat, sem agendador. No switch: captura o par rotacionado da conta que
sai, grava no cofre, escreve o par da que entra; se o par da que entra estiver
vencido, tenta **um** refresh HTTP como fallback e grava o resultado no cofre
**antes** de usá-lo (uso único: perder o par novo inutiliza a conta).
Consequência aceita: conta parada por meses pede re-login uma vez.

> **Emenda (13/09/2026, decisão do dono na etapa 3, Fase 2).** O access token
> vence em ~8h e a carga era lida com o par do cofre: conta parada virava "sem
> dado" e nunca era destino do auto-switch (C9). Com o app aberto, a leitura de
> carga renova o par vencido de conta **parada**, com o mesmo protocolo do
> fallback acima — grava antes de usar, uma renovação por conta de cada vez
> (compartilhada com o switch), nunca a conta ativa, cuja carga passa a ser
> lida com o token vivo do `~/.claude`. Continua sem heartbeat e sem agendador:
> a renovação só acontece quando alguém lê a carga. Detalhe em
> `plan-etapa-3.md` §4, Fase 2, e `contracts/ipc-accounts.md`, regra 14.

### D5 — Auto-switch é função pura

```ts
selectSwitchTarget(accounts, active, policy, pickTwo): AccountId | null
```

Troca quando `max(5h, 7d, sonnet)` da ativa `≥ switchAtLoad` (90) **e** existe
conta com folga `≥ minAdvantage` (20) pontos; entre candidatas, escolhe a
melhor de duas sorteadas (power-of-two-choices, `pickTwo` injetável para
teste determinístico). Desligável (`autoSwitch.enabled`). Conta com carga
desconhecida nunca é destino (C9).

### D6 — Config única de MCPs cai de graça

O motor escreve só `.credentials.json` e limpa `oauthAccount`; **não** cria
nem aponta `CLAUDE_CONFIG_DIR` por conta. Com o motor ativo, sessões `claude`
nascem no `~/.claude` real (C1) — logo, MCP configurado uma vez sobrevive a
qualquer troca. É o requisito da spec sendo cumprido por ausência de mecanismo,
não por código novo. O teste que prova isso é de smoke (T1127).

### D7 — Motor inerte por default

`accounts.mod = null` (C2). Isso torna a etapa 1 mergeável sozinha e reversível
por config, sem esperar a demolição de perfis — e é o que permite dogfooding no
alfa sem risco para o fluxo atual.

## Estratégia de teste

**Vitest (módulo puro/injetável — onde a feature se decide):**

| Módulo | O que o teste fixa |
|---|---|
| `auto-switch.ts` | Limiares 90/20, power-of-two determinístico, desligado, carga desconhecida, empate |
| `claude-state.ts` | Ordem invariante; merge preservando chaves desconhecidas; `oauthAccount` removido sem perder o resto do `~/.claude.json`; atomicidade (temp+rename); nunca loga segredo |
| `accounts-config.ts` | `sanitizeAccountsConfig` resiliente (ausente/corrompido/tipos errados/valores fora de faixa) |
| `vault.ts` | Round-trip com `safeStorage` falso; recusa gravar quando indisponível; nunca devolve segredo em erro |
| `usage-client.ts` / parsers | Parse das janelas 5h/7d; payload malformado → `null`, nunca lança |
| `seazone-mod.ts` / `local-mod.ts` | Bateria de contrato compartilhada (`accountModContract.test.ts`) com HTTP falso; Seazone nunca chama `platform.claude.com`; local só refresca no caminho de fallback |
| `account-engine.ts` | Máquina de estados: inerte/pronto/indisponível, `deferred` com sessão ocupada, falha em cada passo |

**Smoke roteirizado (UI/PTY, isolado do `%APPDATA%` real, com `claudeHome`
temporário — nunca abrindo sessão `claude` real):**

- `accounts-switch.spec.ts` — conectar mod falso, listar, trocar, ver o
  `.credentials.json` do `claudeHome` de teste mudar e o `oauthAccount` sumir.
- `accounts-mcp-survives-switch.spec.ts` — MCP configurado uma vez continua na
  config após duas trocas (D6).
- `accounts-secret-never-leaks.spec.ts` — nenhum payload de IPC de leitura
  contém token (varredura dos canais).
- Regressão: as 4 suítes de perfil existentes continuam **verdes e intocadas**.

## Riscos

| Risco | Mitigação |
|---|---|
| Merge com a 010 no `index.ts` | Uma única task toca o arquivo (T1122), última da fila; gate de "batches da 010 fechados em staging" |
| Refresh token de uso único queimado por bug | Grava no cofre antes de usar; refresh só no caminho de fallback; mod Seazone estruturalmente incapaz de refrescar |
| `safeStorage` indisponível na máquina | Motor recusa conectar (`vault-unavailable`); nunca degrada para texto plano |
| Troca no meio de uma resposta | `deferred` enquanto o semáforo indicar sessão trabalhando (C5) |
| Segredo vazando para log/UI | Fronteira de módulo + teste de varredura de IPC + revisão do diff no gate de validação |
| Contrato da API do switcher mudar | Mod isolado; falha degrada para `unavailable`, nunca derruba o app |

## Achados do cruzamento spec × plan × tasks (`analyze`, 04/08)

Todos resolvidos nesta fase; nada ficou aberto.

| # | Severidade | Achado | Resolução |
|---|---|---|---|
| A1 | **HIGH** | A cadência da spec nomeia a entrega 1 como "Motor + mod Seazone", mas o card e este plano incluem o mod local — ambiguidade que faria a implementação entregar meia etapa | Resolvido como leitura, não como ampliação: a spec exige interface *extraída de dois mods concretos*, impossível com um mod só. Registrado como **C12** na spec e em `research.md` §2 |
| A2 | **HIGH** | O plano dizia "único arquivo compartilhado é `index.ts`", mas a injeção de env do spawn vive em `src/main/pty-manager.ts:39-134` — a task de integração tocaria um arquivo não previsto | Nota explícita em T1125: `pty-manager.ts` **não** é tocado pela 010 (ticket 01c) e sobrevive à demolição; se o ajuste passar de trivial, vira task própria |
| A3 | MEDIUM | Colisão de unidade: `AccountLoad` é **% consumido**, `ProfileQuota` da spec 002 é **% livre** — os dois convivem na tela enquanto perfis existirem | Invariante em `data-model.md` §1 + "cuidado de unidade" com teste em T1123 |
| A4 | MEDIUM | "MCPs sobrevivem à troca" é requisito da spec sem mecanismo próprio (cai por ausência de config dir por conta) — risco de virar promessa não verificada | Vira teste de smoke dedicado (T1127), não uma afirmação de plano |
| A5 | LOW | O template do spec-kit marca tarefas de teste como opcionais | Sobrescrito no cabeçalho do `tasks.md`: teste é obrigatório para todo código de produção, conforme o `CLAUDE.md` do repo |
| A6 | LOW | `.specify/memory/constitution.md` está em branco (template) | Gate de constituição roda contra o `CLAUDE.md` do repo; registrado na seção correspondente |

## Entregável desta etapa

Com o motor conectado a um mod, o operador vê a lista de contas com carga, troca
de conta **sem reiniciar sessão**, e o app troca sozinho quando a ativa passa de
90 com folga de 20 em outra. Perfis continuam existindo, intactos, até a etapa 2.
