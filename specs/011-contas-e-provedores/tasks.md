# Tasks — 011 Contas & Provedores · **Etapa 1**: motor de contas + mods

**Entrada**: `spec.md` (recortada em `research.md` §1), `plan.md`,
`data-model.md`, `contracts/*` deste diretório.
**Card**: `pln-motor-contas-mods`. **Branch**: `esteira/contas-e-provedores`.

**31 tasks — `T1101`–`T1131`**, em ordem de dependência. `[P]` = pode rodar em
paralelo com a task anterior (arquivos distintos, sem dependência). DoD =
definition of done.

**Testes não são opcionais aqui.** Tudo abaixo é código de produção
(funcionalidade nova em main process), então vale a regra do repo: módulo
puro/injetável nasce com vitest, escrito **antes** da implementação
(vermelho → mínimo → refatora); UI e caminho de PTY validam por **smoke
roteirizado**. As únicas tasks sem teste são as de documento (T1101, T1129,
T1131).

## Regras duras que atravessam todas as tasks

1. **Nada de código antes do gate T1101** — os batches da 010 precisam estar
   fechados em staging (`plan.md` §Dependência de sequenciamento).
2. **`CredentialPair` nunca sai de `src/main/accounts/`** — não cruza o
   preload, não entra em log (nem truncado), não entra em mensagem de erro.
3. **A escrita de credencial acontece em um lugar só**: `claude-state.ts`.
   Mod nenhum escreve em `~/.claude*`.
4. **Nenhum agendador de SO** é criado; qualquer periodicidade é timer do
   processo vivo e morre com o app.
5. **Nada de perfis é removido ou alterado** nesta etapa — `profile-manager.ts`,
   junctions, `PROFILE_CHANNELS` e as 4 suítes continuam intactos e verdes.
6. **LGPD**: conta é id opaco + label; nunca e-mail, nunca nome de pessoa, em
   código, log, fixture ou UI.

---

## Fase 0 — Gate (bloqueante)

- [ ] **T1101** — Confirmar que os batches da 010 fecharam em staging e que
  `src/main/index.ts` está estável (sem refactor em voo). Registrar a
  confirmação no card. **Sem código.**
  **DoD**: confirmação escrita; se negativo, a fase para aqui.

---

## Fase 1 — Contratos e fundação (invisível ao app)

- [ ] **T1102** [P] Teste: `tests/accountsConfig.test.ts` — `sanitizeAccountsConfig`
  resiliente (chave ausente, JSON corrompido, tipos errados, limiares fora de
  0–100, `mod` desconhecido → `null`), defaults `90`/`20`/`enabled: true`.
  **DoD**: suíte vermelha por ausência de implementação.

- [ ] **T1103** Criar `src/shared/accounts.ts` — `AccountId`, `AccountLoad`,
  `AccountSummary`, `ModId`, `AutoSwitchPolicy`, `AccountsConfigDto`,
  `AccountsViewDto`, `ConnectModInput`, `SwitchOutcome`, `ACCOUNT_CHANNELS`
  (`contracts/ipc-accounts.md`). Exportar em `src/shared/index.ts`. **Sem I/O.**
  **DoD**: `npm run typecheck` verde; nenhum tipo com campo de segredo.

- [ ] **T1104** [P] Criar `src/main/accounts/account-mod.ts` — interface
  `AccountMod` + `CredentialPair` + `ListAccountsResult`/`SwitchToResult`
  (`contracts/account-mod.md`). Comentário de topo declarando a fronteira de
  credencial.
  **DoD**: `CredentialPair` não é exportado por `src/shared/**`.

- [ ] **T1105** Implementar `src/main/accounts/accounts-config.ts`
  (`sanitizeAccountsConfig`, leitura/escrita da chave `accounts`) e plugar nos
  4 pontos do padrão de `src/main/config-store.ts` (default, sanitize, DTO,
  escrita atômica), **sem tocar nas chaves existentes**.
  **DoD**: T1102 verde; `tests/config-store.test.ts` continua verde.

- [ ] **T1106** [P] Teste: `tests/accountsVault.test.ts` — round-trip com
  `safeStorage` falso; recusa gravar quando `isEncryptionAvailable()` é
  `false`; erro nunca contém o segredo; escrita atômica.
  **DoD**: suíte vermelha.

- [ ] **T1107** Implementar `src/main/accounts/vault.ts` — `<userData>/accounts-vault.json`,
  `VaultRecord v1`, cifra por `safeStorage`, IO e `safeStorage` **injetáveis**,
  0600 onde o SO suportar. Write-only para fora (nenhum getter público devolve
  segredo ao renderer).
  **DoD**: T1106 verde.

- [ ] **T1108** [P] Teste: `tests/claudeState.test.ts` — ordem invariante
  (captura → escreve `.credentials.json` → apaga `oauthAccount`); merge
  preservando chaves desconhecidas do `.credentials.json`; `~/.claude.json`
  perde **só** `oauthAccount`; escrita atômica (temp+rename); falha de escrita
  aborta sem corromper o arquivo anterior.
  **DoD**: suíte vermelha.

- [ ] **T1109** Implementar `src/main/accounts/claude-state.ts` com `claudeHome`
  parametrizado (default `~/.claude`, C1) e IO injetável. **Única** escrita de
  credencial do sistema.
  **DoD**: T1108 verde; nenhum `console.*` com conteúdo de par.

- [ ] **T1110** [P] Teste: `tests/autoSwitch.test.ts` — `selectSwitchTarget`:
  não troca abaixo de 90; não troca sem folga de 20; power-of-two-choices
  determinístico com `pickTwo` injetado; `enabled: false` nunca troca; conta
  com carga desconhecida nunca é destino; ativa nunca é destino de si mesma.
  **DoD**: suíte vermelha.

- [ ] **T1111** Implementar `src/main/accounts/auto-switch.ts` — função pura,
  limiares vindos de `AutoSwitchPolicy`, `overallLoad = max(5h, 7d, sonnet)`.
  **DoD**: T1110 verde.

---

## Fase 2 — Mods concretos (depende da Fase 1)

- [ ] **T1112** [P] Teste: `tests/accountsUsageClient.test.ts` — parse das
  janelas 5h/7d do payload de `api.anthropic.com/api/oauth/usage`; payload
  malformado/HTTP 5xx → `null`, nunca lança; token nunca aparece em erro.
  **DoD**: suíte vermelha.

- [ ] **T1113** Implementar `src/main/accounts/usage-client.ts` (HTTP
  injetável, timeout 10 s).
  **DoD**: T1112 verde.

- [ ] **T1114** [P] Teste: `tests/accountsTokenRefresh.test.ts` — chamada de
  refresh só no caminho de fallback; par novo é **gravado no cofre antes de
  ser usado**; recusa do servidor → `expired-credentials`; falha de gravação
  aborta o switch.
  **DoD**: suíte vermelha.

- [ ] **T1115** Implementar `src/main/accounts/token-refresh.ts` (`POST
  platform.claude.com/v1/oauth/token`, client_id público, HTTP injetável).
  **DoD**: T1114 verde.

- [ ] **T1116** Teste de contrato compartilhado:
  `tests/accountModContract.test.ts` — a mesma bateria roda contra os dois
  mods (HTTP e cofre falsos): as 5 invariantes de `contracts/account-mod.md`,
  shapes de retorno, `listAccounts` nunca lança, mod não escreve em
  `~/.claude*`, **`seazone-mod` nunca chama `platform.claude.com`**.
  **DoD**: suíte vermelha (nenhum mod ainda).

- [ ] **T1117** Implementar `src/main/accounts/mods/seazone-mod.ts` —
  `/auth/exchange|refresh|revoke`, `GET /accounts`, `POST /session/switch`,
  `POST /session/heartbeat` (`keepAlive`); JWT curto renovado a partir do
  `sessionRefreshToken` lido do cofre. **Não importa `token-refresh.ts`**
  (D3).
  **DoD**: metade Seazone do T1116 verde.

- [ ] **T1118** Implementar `src/main/accounts/mods/local-mod.ts` — cofre por
  conta, carga via `usage-client`, `switchTo` com fallback de refresh,
  `captureRotatedPair` gravando o par rotacionado. **Sem `keepAlive`** (D4).
  **DoD**: metade local do T1116 verde.

---

## Fase 3 — Motor (depende das Fases 1 e 2)

- [ ] **T1119** Teste: `tests/accountEngine.test.ts` — máquina de estados
  (`inert`/`ready`/`unavailable`); `switch` com motor inerte falha; falha em
  cada passo do switch degrada sem corromper; `unavailable` pausa o
  auto-switch; escolha do mod por config.
  **DoD**: suíte vermelha.

- [ ] **T1120** Implementar `src/main/accounts/account-engine.ts` — compõe
  mod + `claude-state` + `auto-switch` + `vault`; sequência do switch na ordem
  invariante; `keepAlive` chamado a cada 15 min **só se o mod implementar**
  (C3); releitura de carga sob demanda + poll de 5 min com sessão viva (C4);
  emite `accounts:changed`.
  **DoD**: T1119 verde.

- [ ] **T1121** Adiamento por sessão ocupada (C5): motor consulta o
  `session-semaphore-manager` (**leitura apenas**) e devolve
  `{ kind: 'deferred', reason: 'session-busy' }` no auto-switch enquanto
  houver sessão trabalhando; reavalia no ciclo seguinte. Switch **manual** não
  é adiado. Teste no próprio `accountEngine.test.ts`.
  **DoD**: teste verde; nenhuma alteração em `session-semaphore-manager.ts`.

---

## Fase 4 — Integração visível (depende da Fase 3)

- [ ] **T1122** Ponte no `src/preload/index.ts`: `window.donel.accounts.{list,
  switch,getConfig,setConfig,connectMod,disconnectMod,onChanged}` espelhando
  `ACCOUNT_CHANNELS`, no mesmo padrão de `profiles.*`.
  **DoD**: `donel.d.ts` atualizado; typecheck verde.

- [ ] **T1123** `src/renderer/src/AccountsPanel.tsx` (+ `.module.css`) —
  **adaptação** do `ProfileSwitcher.tsx`, não reescrita: lista de contas com as
  duas janelas explícitas (5h / 7d), conta ativa, botão atualizar, toggle do
  auto-switch. Textos em pt-BR. Nunca exibe segredo.
  **Cuidado de unidade** (achado do `analyze`): `AccountLoad` é **% consumido**
  e o `ProfileQuota` da spec 002 é **% livre** (`percentRemaining`) — os dois
  convivem na tela enquanto perfis existirem. Nunca comparar, somar ou
  reaproveitar formatador entre eles sem converter.
  **DoD**: painel renderiza com motor inerte sem quebrar a tela atual; teste de
  unidade do formatador de carga cobrindo a conversão.

- [ ] **T1124** Formulário de conectar/desconectar mod (write-only): campos de
  segredo nunca são relidos do main, nunca preenchidos de volta;
  `vault-unavailable` mostra recusa explícita. Escolha entre mod Seazone e mod
  local.
  **DoD**: smoke do T1128 cobre; nenhum canal de leitura devolve o que foi
  digitado.

- [ ] **T1125** **Única task que toca o hub** `src/main/index.ts`: registrar os
  handlers de `ACCOUNT_CHANNELS`, instanciar o motor no boot (inerte se
  `accounts.mod === null`) e, no spawn de PTY, (a) passar `configDir:
  undefined` quando o motor estiver ativo e (b) preencher
  `PtyCreateResult.profile` com `{ slug: accountId, name: label }` do motor
  (C10). **Nenhuma linha de perfil é removida.**
  **Nota do `analyze`**: a injeção de env do spawn vive em
  `src/main/pty-manager.ts` (:39-134), não no hub. Esta task pode precisar de um
  ajuste pontual lá para aceitar "sem config dir" como caso explícito — é
  permitido: `pty-manager.ts` **não** é tocado pela 010 (ticket 01c) e o módulo
  sobrevive à demolição de perfis (ganha "env por provider" na etapa 3). Se o
  ajuste passar de trivial, quebrar em task própria antes de T1125.
  **DoD**: app abre; com motor inerte, comportamento idêntico ao de hoje;
  `tests/pty-manager.test.ts` e as suítes de perfil continuam verdes.

---

## Fase 5 — Verificação e fechamento

- [ ] **T1126** Smoke: `tests/smoke/accounts-switch.spec.ts` — mod falso,
  `claudeHome` temporário, isolado do `%APPDATA%` real: conectar → listar →
  trocar; verificar `.credentials.json` reescrito e `oauthAccount` ausente do
  `.claude.json` de teste. **Nunca** abre sessão `claude` real.
  **DoD**: smoke verde.

- [ ] **T1127** [P] Smoke: `tests/smoke/accounts-mcp-survives-switch.spec.ts` —
  MCP configurado uma vez continua presente após duas trocas de conta (D6, a
  promessa central da spec sobre config única).
  **DoD**: smoke verde.

- [ ] **T1128** [P] Smoke: `tests/smoke/accounts-secret-never-leaks.spec.ts` —
  varredura de todos os payloads de leitura dos `ACCOUNT_CHANNELS` e do evento
  `accounts:changed` procurando o segredo plantado no cofre de teste; nenhum
  hit. Inclui o formulário do T1124.
  **DoD**: smoke verde.

- [ ] **T1129** Regressão declarada: rodar `npm test` inteiro e confirmar que
  as 4 suítes de perfil (`profile-manager.test.ts`, smokes de perfil/quota/
  foco) seguem **verdes e não modificadas** (`git diff` vazio nelas).
  **DoD**: saída da suíte colada no card; diff vazio confirmado.

- [ ] **T1130** Emenda no `CLAUDE.md` do repo: a regra "o app NUNCA lê, grava
  ou exibe credenciais" ganha a exceção **nomeada e confinada** a
  `src/main/accounts/` (mod local + cofre + `claude-state`), com a frase de que
  o core e a UI seguem sem tocar segredo. Não generalizar a exceção.
  **DoD**: parágrafo commitado junto com o código desta etapa.

- [ ] **T1131** Roteiro e2e no alfa:
  `specs/011-contas-e-provedores/roteiro-e2e-etapa-1.md` — passo a passo manual
  (conectar mod, listar, trocar sem reiniciar sessão, ver MCP sobreviver,
  forçar carga alta e observar o auto-switch, desligar o auto-switch).
  **DoD**: roteiro escrito; execução é gesto humano no alfa.

---

## Dependências e paralelismo

```
T1101 (gate)
  └─► Fase 1:  T1102─►T1105       (config)
               T1103 ─┬─► T1104
               T1106─►T1107       (cofre)
               T1108─►T1109       (claude-state)
               T1110─►T1111       (auto-switch)
        [as quatro trilhas da Fase 1 rodam em PARALELO]
             └─► Fase 2:  T1112─►T1113 ; T1114─►T1115  [paralelas]
                          T1116 ─┬─► T1117
                                 └─► T1118            [T1117 e T1118 paralelas]
                   └─► Fase 3: T1119─►T1120─►T1121     [estritamente sequencial]
                         └─► Fase 4: T1122─►T1123─►T1124─►T1125
                               └─► Fase 5: T1126 ; T1127 ; T1128  [paralelas]
                                     └─► T1129 ─► T1130 ─► T1131
```

- **Fase 1** é o maior ganho de paralelismo: quatro trilhas independentes
  (config, cofre, claude-state, auto-switch), quatro arquivos novos distintos.
- **Fase 3** é sequencial de propósito: o motor é o ponto onde o contrato se
  fecha; duas mãos nele recriam o desencontro que originou a 010.
- **T1125 é a última do caminho de código** e a única que toca o hub
  `src/main/index.ts` (o ajuste possível em `pty-manager.ts` está descrito nela).

## Fora do escopo destas tasks (etapas irmãs)

Demolição de `profile-manager`/junctions e das 4 suítes; migração assistida
(credenciais, transcripts, MCPs, arquivamento de `~/.claude-profiles`);
mudança de fonte do `sessionAccountLabel`; limpeza do `specs/backlog.md`
(B8/US-12, auto-switch) e marcação da spec 002 como superseded; registry de
providers, classe A, OpenRouter, classe B; UI de MCPs/integrações; fallback
automático de provider.
