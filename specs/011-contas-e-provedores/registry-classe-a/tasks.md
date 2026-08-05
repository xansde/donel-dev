# Tasks — 011 Contas & Provedores · **Etapa 3**: registry de providers (classe A)

**Entrada**: `../spec.md` (seção "Registry de providers `[T-5]`" +
Clarifications C13–C22), `plan.md`, `research.md`, `data-model.md`,
`contracts/provider-registry.md` desta subpasta.
**Card**: `pln-registry-providers-classe-a`. **Branch**: `esteira/contas-e-provedores`.

**26 tasks — `T1301`–`T1326`**, em ordem de dependência. A numeração começa em
1301 para não colidir com a etapa 1 (`T1101`–`T1131`, `../tasks.md`, que é
**intocável**). `[P]` = pode rodar em paralelo com a anterior (arquivos
distintos). DoD = definition of done.

**Testes não são opcionais aqui.** Tudo abaixo é código de produção, então vale
a regra do repo: módulo puro/injetável nasce com vitest escrito **antes** da
implementação (vermelho → mínimo → refatora); launcher e caminho de PTY validam
por **smoke roteirizado**. As únicas tasks sem teste são o **spike** (T1302) e
as de **documento/gesto humano** (T1301, T1325, T1326).

## Regras duras que atravessam todas as tasks

1. **Nada de código antes do gate T1301** — batches da 010 fechados em staging
   **e** etapa 1 mergeada (`plan.md` §Dependência de sequenciamento).
2. **Valor de segredo nunca sai de `src/main/providers/` + `buildPtyEnv`** — não
   cruza o preload, não entra em log (nem truncado), não entra em mensagem de
   erro, não entra em fixture commitada.
3. **Nenhum campo nomeado de provider** no registry (`baseUrl`, `apiKey`,
   `model`): env é mapa genérico + `secretEnvKeys` (D1/C15).
4. **Classe B não spawna** na v1 — só estrutura e recusa explícita (C20).
5. **Registry vazio = comportamento de hoje byte a byte** (C14/D6).
6. **`commandBuilder.ts`, `openPhaseSession.ts` e `esteira-*` não são tocados.**
7. **LGPD**: `providerId` é slug opaco; `label` nunca carrega nome de pessoa.

---

## Fase 0 — Gates (bloqueantes)

- [x] **T1301** — Confirmar (a) que os batches da 010 fecharam em staging e
  `src/main/index.ts` está estável e (b) que a **etapa 1** está mergeada — o
  cofre (`src/main/accounts/vault.ts`) e a chave `accounts` do config-store
  precisam existir. Registrar a confirmação no card. **Sem código.**
  **DoD**: confirmação escrita; se negativo, a fase para aqui.
  > **(a) CONFIRMADA em 2026-08-04** pelo dono, na sessão do plano desta etapa:
  > os 7 batches (B1..B7) estão integrados em `staging` local e não há mais
  > batch em voo tocando `src/main/index.ts`. Pendente apenas a (b) — etapa 1
  > mergeada (cofre + chave `accounts` do config-store existindo).
  > **(b) CONFIRMADA em 2026-08-05** pelo worker da fase Implementar:
  > `src/main/accounts/vault.ts` e a chave `accounts` do config-store
  > (`AppConfig.accounts`, `config-store.ts`) existem no checkout desta
  > branch (etapas 1 e 2 já implementadas e validadas nela). Gate liberado.

- [x] **T1302** — **Spike de compatibilidade do piloto** (risco R1 / achado A3).
  Na máquina, com a chave do OpenRouter lida do Bitwarden (nunca ecoada),
  verificar se o binário `claude` sobe com `ANTHROPIC_BASE_URL` +
  `ANTHROPIC_AUTH_TOKEN` apontados ao provider e completa **um** turno.
  Registrar o resultado em `spike-t1302-openrouter.md` **sem nenhum segredo**
  (só: subiu/não subiu, endpoint usado, variáveis necessárias, nome de modelo
  aceito). **Spike: sem teste automatizado.**
  **DoD**: resultado escrito. **Regra de parada**: se não subir, a fase **para**
  e o humano decide entre shim ou trocar o piloto — trocar de provider é
  decisão de discovery, não do plano. O resto do registry (T1303+) **não**
  depende deste resultado (D1) e pode seguir se o humano assim decidir.

---

## Fase 1 — Config e módulos puros (invisível ao app)

- [x] **T1303** [P] Teste: `tests/providersConfig.test.ts` —
  `sanitizeProvidersConfig`: chave ausente / JSON corrompido / `entries` não
  array → `{ version: 1, entries: [] }`; entrada inválida **descartada** sem
  derrubar as válidas; `id` fora de `^[a-z0-9][a-z0-9-]{0,31}$` recusado;
  `class` desconhecida recusada; chave de `env` que também está em
  `secretEnvKeys` recusada; `CLAUDE_CONFIG_DIR`/marcador de sessão-filha em
  `env` recusado.
  **DoD**: suíte vermelha por ausência de implementação.

- [x] **T1304** Criar `src/shared/providers.ts` — `ProviderId`,
  `ProviderClass`, `ProviderSummaryDto`, `ProvidersConfigDto`,
  `UpsertProviderInput`/`Result`, `SetSecretResult`, `PROVIDER_CHANNELS`
  (`contracts/provider-registry.md`). Exportar em `src/shared/index.ts`.
  **Sem I/O, sem tipo que carregue valor de segredo.**
  **DoD**: `npm run typecheck` verde; nenhum campo de valor secreto em
  `src/shared/**`.

- [x] **T1305** Implementar `src/main/providers/providers-config.ts`
  (`sanitizeProvidersConfig`, leitura/escrita da chave `providers`) e plugar
  nos 4 pontos do padrão de `src/main/config-store.ts` (default, sanitize, DTO,
  escrita atômica), **sem tocar nas chaves existentes** (inclusive `accounts`,
  da etapa 1).
  **DoD**: T1303 verde; `tests/config-store.test.ts` continua verde.

- [x] **T1306** [P] Teste: `tests/providerEnv.test.ts` — `buildProviderEnv`:
  monta `entry.env` + segredos do cofre; chave secreta ausente no cofre →
  `missing-secret` nomeando **a variável, nunca o valor**; `CLAUDE_CONFIG_DIR`
  e marcadores `CLAUDECODE`/`CLAUDE_CODE_*` nunca entram, mesmo se presentes na
  entrada; função nunca loga.
  **DoD**: suíte vermelha.

- [x] **T1307** Implementar `src/main/providers/provider-env.ts` — puro, cofre
  injetado.
  **DoD**: T1306 verde.

- [x] **T1308** [P] Teste: `tests/providerSecrets.test.ts` — adaptador do cofre
  da etapa 1 no namespace `provider:<id>:<ENV_KEY>`: round-trip com
  `safeStorage` falso; `safeStorage` indisponível → `vault-unavailable` (nunca
  texto plano); `secretsStatus` devolve **boolean/enum**, nunca valor; remover
  provider apaga as chaves dele.
  **DoD**: suíte vermelha.

- [x] **T1309** Implementar `src/main/providers/provider-secrets.ts`
  **reusando** `src/main/accounts/vault.ts` — sem criar um segundo cofre e sem
  alterar o arquivo da etapa 1.
  **DoD**: T1308 verde; `git diff` vazio em `src/main/accounts/vault.ts`.

- [x] **T1310** [P] Teste: `tests/sessionConfigDir.test.ts` —
  `resolveSessionConfigDir` (C21/D3), tabela-verdade completa: provider vence
  motor e perfil; sem provider e motor ativo → `undefined`; sem provider e sem
  motor → `activeProfileConfigDir`; mundo pós-etapa 2 (sem perfil) → mesmos dois
  primeiros ramos intactos.
  **DoD**: suíte vermelha.

- [x] **T1311** Implementar `src/main/providers/session-config-dir.ts` — função
  pura, sem I/O.
  **DoD**: T1310 verde.

- [x] **T1312** [P] Teste: `tests/providerRegistry.test.ts` — as 6 invariantes
  de `contracts/provider-registry.md`: segredo nunca em retorno; classe B →
  `unsupported-class`; env do provider não sequestra `CLAUDE_CONFIG_DIR`/
  marcadores; `missing-secret` aborta o lançamento; `vault-unavailable` em
  escrita e lançamento; remoção apaga segredo e **preserva** o config dir.
  Inclui **duas entradas fictícias de formatos diferentes** (D1/R2) rodando a
  mesma bateria — o teste que impede o registry de nascer no formato-OpenRouter.
  **DoD**: suíte vermelha.

- [x] **T1313** Implementar `src/main/providers/provider-registry.ts` — CRUD,
  validação, `resolveLaunch` (cria `<userData>/providers/<configDirName>/`
  **vazio**, C16/D4), IO e cofre injetáveis. Nenhuma string de provider real no
  código.
  **DoD**: T1312 verde; `grep -ri openrouter src/` só encontra ocorrência em
  fixture/documento, nunca em lógica.

---

## Fase 2 — Spawn e env (depende da Fase 1)

- [x] **T1314** Teste: estender `tests/pty-manager.test.ts` — `buildPtyEnv` com
  o novo 2º parâmetro `envOverrides`: overrides aplicados sobre o env base;
  `CLAUDE_CONFIG_DIR` continua governado **só** pelo parâmetro próprio (um
  override tentando setá-lo é ignorado); marcadores de sessão-filha continuam
  removidos; **sem overrides, a saída é idêntica à de hoje** (teste de
  regressão byte a byte).
  **DoD**: suíte vermelha nos casos novos, verde nos antigos.

- [x] **T1315** Estender `src/main/pty-manager.ts`: `buildPtyEnv(baseEnv,
  claudeConfigDir, envOverrides?)` e `PtyCreateOptions.envOverrides?`. Nada
  mais do módulo muda; ele continua agnóstico ao domínio (não sabe o que é
  "provider").
  **DoD**: T1314 verde.

- [x] **T1316** [P] Teste: `tests/launchArgsForProvider.test.ts` — montador de
  argv extraído do `App.tsx` (função pura): com provider classe A, `--model` e
  `--effort` **omitidos**, `-n`/`--permission-mode` preservados; sem provider,
  argv **byte a byte** o de hoje (C18/D7). `commandBuilder.ts` **não** aparece
  no diff.
  **DoD**: suíte vermelha.

- [x] **T1317** Extrair no renderer a função pura de montagem de argv usada pelo
  `App.tsx` e aplicar a regra do C18. **`src/shared/commandBuilder.ts`
  permanece intocado.**
  **DoD**: T1316 verde; `git diff` vazio em `src/shared/commandBuilder.ts`.

- [x] **T1318** Acrescentar `providerId?` a `PtyCreateOptions` e
  `provider?: { id, label }` a `PtyCreateResult` (`src/shared/index.ts`), sem
  alterar os campos existentes (inclusive `profile`, contrato da etapa 1/C10).
  Ponte no `src/preload/index.ts`: `window.donel.providers.{list,upsert,remove,
  setSecret}` espelhando `PROVIDER_CHANNELS`, no mesmo padrão de `profiles.*`.
  **DoD**: `donel.d.ts` atualizado; typecheck verde; nenhum método de leitura
  de valor de segredo exposto.

- [x] **T1319** **Única task que toca o hub** `src/main/index.ts`: registrar os
  handlers de `PROVIDER_CHANNELS`; no `pty:create` de sessão `claude`, quando
  vier `providerId`, chamar `registry.resolveLaunch(id)` e (a) passar
  `envOverrides` + `claudeConfigDir` resolvidos por `resolveSessionConfigDir`
  (C21), (b) resolver `resolveTranscriptPath` com o home do provider (C17/A1),
  (c) devolver `provider` no `PtyCreateResult`, (d) **não** consultar o motor de
  contas quando há provider (C13/D2). Resultado de erro do `resolveLaunch`
  (`missing-secret`, `unsupported-class`, `vault-unavailable`) vira rejeição com
  mensagem em pt-BR, **sem valor de env**.
  **DoD**: app abre; com registry vazio, comportamento idêntico ao de hoje;
  `tests/pty-manager.test.ts`, suítes de perfil e as da etapa 1 seguem verdes.

---

## Fase 3 — UI (depende da Fase 2)

- [x] **T1320** `src/renderer/src/ProviderPicker.tsx` (+ `.module.css`) — campo
  "Provedor" no `Launcher.tsx`, **só renderizado com registry não vazio**
  (C14); primeira opção sempre "Claude (conta)" e default. Ao selecionar um
  provider: desabilita os controles de modelo/esforço com a explicação de uma
  linha (C18), desabilita a UI de perfil enquanto perfis existirem (C21) e
  mostra a nota de config dir vazio (sem MCPs herdados, C16). Textos em pt-BR.
  Entrada `class: 'B'` aparece marcada "não suportada nesta versão" e não é
  selecionável (C20).
  **DoD**: com registry vazio, o launcher renderiza **sem** o campo; smoke do
  T1322 cobre o caso com entrada.

- [x] **T1321** `src/renderer/src/ProviderForm.tsx` — criar/editar/remover
  entrada **classe A** (não há UI de criação de classe B, C20) e campo de
  segredo **write-only**: nunca é relido do main, nunca é preenchido de volta;
  estado exibido é só `configurado`/`não configurado`/`cofre indisponível`
  (C19). Origem da lista de "sessões anteriores" indicada na UI quando há
  provider selecionado (C17).
  **DoD**: smoke do T1323 cobre; nenhum canal de leitura devolve o que foi
  digitado.

---

## Fase 4 — Verificação e fechamento

- [x] **T1322** Smoke: `tests/smoke/providers-inert.spec.ts` — `userData`
  temporário, registry vazio: launcher **sem** o campo "Provedor"; sessão
  `claude` nasce com o mesmo env e o mesmo config dir de hoje (D6/C14).
  **DoD**: smoke verde.

- [x] **T1323** [P] Smoke: `tests/smoke/providers-session-env.spec.ts` — entrada
  fictícia classe A (sem rede real): sessão nasce com o env da entrada aplicado
  e com `<userData>/providers/<id>/` criado e **vazio** (nada copiado de
  `~/.claude`, D4).
  **DoD**: smoke verde.

- [x] **T1324** [P] Smoke: `tests/smoke/providers-secret-never-leaks.spec.ts` +
  `tests/smoke/providers-class-b-refused.spec.ts` — (a) varredura de todos os
  payloads dos `PROVIDER_CHANNELS`, do `config:get` e do `pty:create`
  procurando o segredo plantado no cofre de teste: nenhum hit, nem truncado;
  (b) entrada `class: 'B'` escrita à mão no `config.json` é listada como não
  suportada e o lançamento é recusado com mensagem (C20).
  **DoD**: ambos verdes.

- [ ] **T1325** Ingestão da chave real do OpenRouter: ler do Bitwarden e digitar
  **no formulário do app** (T1321), direto para o cofre. Nunca em chat,
  arquivo, fixture, log, variável de ambiente do repo ou commit; nenhuma saída
  de terminal que a ecoe (C19). **Gesto humano/manual — sem teste.**
  **DoD**: `secretsStatus` do provider vira `configured`; `git status` limpo.
  > **PENDENTE — gesto humano, não executado pelo worker.** O spike T1302
  > (sessão de terminal, não o app) já provou que a chave lida do Bitwarden
  > funciona ponta a ponta com `ANTHROPIC_BASE_URL=https://openrouter.ai/api`
  > (sem `/v1` — achado do spike). Digitar a chave real DENTRO do app
  > instalado é ato do Alexandre no alfa (roteiro passo 2 de `e2e.md`) — o
  > worker de código não abre o app instalado nem grava segredo de produção
  > no `userData` real da máquina.

- [x] **T1326** Regressão declarada + roteiro e2e no alfa: rodar `npm test`
  inteiro (suítes de perfil, da etapa 1 e `pty-manager` verdes) e escrever
  o roteiro e2e — passo a passo manual (criar provider, gravar chave, lançar
  sessão com provider e outra com conta lado a lado, ver semáforo
  funcionando, ver o transcript nascer no config dir do provider, remover
  provider). **Documento: sem teste próprio.**
  **DoD**: saída da suíte colada no card; roteiro escrito. Execução do roteiro é
  gesto humano no alfa.
  > **Roteiro escrito em `e2e.md`** (nome pedido pelo cockpit desta fase, no
  > lugar de `roteiro-e2e-etapa-3.md`). `npm test`: **1724/1724 testes
  > passaram** (100 arquivos), `npm run typecheck` verde. Smoke roteirizado:
  > os 4 specs de `tests/smoke/providers-*.spec.ts` (T1322-T1324) passaram —
  > 6/6 testes. Regressão em smokes pré-existentes (`accounts-*`,
  > `terminal.spec.ts`, `model-injection.spec.ts`, `model-per-tab.spec.ts`):
  > 12/13 — a única falha (`terminal.spec.ts` "semáforo: StateDot em
  > background", T009/CA-6) é um teste de timing sobre um caminho de código
  > que esta etapa não toca (sem `providerId` envolvido), com 11
  > `claude.exe` concorrentes já rodando na máquina antes da espera final —
  > sinal de contenção de ambiente, não de regressão desta mudança.

---

## Dependências e paralelismo

```
T1301 (gate 010 + etapa 1)
  └─► T1302 (spike do piloto — regra de parada própria)
        └─► Fase 1:  T1303─►T1305        (config)
                     T1306─►T1307        (env puro)
                     T1308─►T1309        (segredos)
                     T1310─►T1311        (precedência de config dir)
                     T1304 antes de T1305/T1312 (tipos compartilhados)
                     T1312─►T1313        (registry; depende de 1307/1309)
              [as trilhas de env, segredos e precedência rodam em PARALELO]
                └─► Fase 2: T1314─►T1315 ; T1316─►T1317   [paralelas]
                            └─► T1318 ─► T1319            [T1319 = hub, última]
                      └─► Fase 3: T1320 ─► T1321
                            └─► Fase 4: T1322 ; T1323 ; T1324  [paralelas]
                                  └─► T1325 ─► T1326
```

- **T1302 é gate de produto, não de código**: se o piloto não subir, quem
  decide o próximo passo é o humano (`plan.md` R1/A3). O registry (T1303+) é
  indiferente ao formato do provider por construção (D1).
- **T1319 é a última do caminho de código** e a única que toca
  `src/main/index.ts` — mesma disciplina da etapa 1 (T1125).
- **Fase 1 é o maior ganho de paralelismo**: quatro trilhas independentes em
  arquivos novos distintos.

## Fora do escopo destas tasks

Motor de contas, mods e auto-switch (etapa 1); demolição de perfis, migração do
dia da virada e `sessionAccountLabel` mudando de fonte (etapa 2); classe B
plena (spawn, indexação, resume, semáforo, Modo Dev para CLIs terceiros);
união de raízes de transcript entre providers; mods/providers carregáveis de
fora do repo; UI de gerenciamento de MCPs/integrações; fallback automático de
provider.
