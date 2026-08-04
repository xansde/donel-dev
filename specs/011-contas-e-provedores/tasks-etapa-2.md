# Tasks — 011 Contas & Provedores · **Etapa 2**: demolição dos perfis + migração assistida

**Entrada**: `spec.md` (seções "Demolição e destino dos dependentes" e
"Migração (dia da virada)", clarifications C23–C34), `plan-etapa-2.md`,
`data-model-etapa-2.md`, `contracts/migration-etapa-2.md`, e o inventário
medido em `research-etapa-2.md` §2.
**Card**: `pln-demolicao-perfis-migracao`. **Branch**: `esteira/contas-e-provedores`.

**32 tasks — `T1201`–`T1232`**, em ordem de dependência. `[P]` = pode rodar em
paralelo com a anterior (arquivos distintos). DoD = definition of done.
A numeração começa em `T12xx` para nunca colidir com as `T11xx` da etapa 1.

**Testes não são opcionais aqui.** O template do spec-kit marca tarefas de teste
como opcionais; vale a regra do repo, e ela é mais dura nesta etapa: este código
**lê credencial** e **mexe no home do usuário**. Módulo puro/injetável nasce com
vitest escrito **antes** (vermelho → mínimo → refatora); UI e virada validam por
**smoke roteirizado**. As únicas tasks sem teste são as de documento (T1201,
T1228, T1229, T1230, T1231).

## Regras duras que atravessam todas as tasks

1. **Nada de código antes do gate T1201** — etapa 1 implementada, validada em
   dogfooding no alfa **com mod ativo**, e batches da 010 fechados em staging.
2. **Nada é deletado.** Nenhuma task cria caminho de deleção de perfil ou do
   diretório arquivado. O verbo é **renomear**.
3. **Desfazer junction antes de renomear**, sempre, sem exceção (C27).
4. **`CredentialPair` nunca sai de `src/main/accounts/`** — nem em log, nem
   truncado, nem em mensagem de erro. A emenda do `CLAUDE.md` não é ampliada:
   ela já cobre `src/main/accounts/`, e a migração mora lá dentro.
5. **`pty-manager.ts` é intocável nesta etapa** (`claudeConfigDir`,
   `buildPtyEnv` e `tests/pty-manager.test.ts` na parte que os cobre) — é a
   porta da etapa 3 (C33/D16).
6. **Religar antes de remover**: nenhuma task da Fase 4 roda antes de a Fase 3
   estar verde.
7. **LGPD**: slug de perfil e nome de servidor MCP são dados de máquina e podem
   aparecer; e-mail e nome de pessoa, nunca — em código, log, fixture ou UI.

---

## Fase 0 — Gate (bloqueante)

- [ ] **T1201** — Confirmar as **duas** pré-condições: (a) etapa 1 implementada,
  mergeada e validada em dogfooding no alfa com `accounts.mod ≠ null` (o
  operador troca de conta pelo motor, sem reiniciar sessão); (b) batches da 010
  fechados em staging e `src/main/index.ts` estável. Registrar a confirmação no
  card. **Sem código.**
  **DoD**: confirmação escrita; se qualquer das duas for negativa, a fase para
  aqui.

---

## Fase 1 — Inventário e planejador da migração (puro, invisível ao app)

- [ ] **T1202** [P] Teste: `tests/profileInventory.test.ts` — raiz ausente ⇒ `[]`
  sem lançar; perfil sem `.credentials.json` ⇒ `hasCredentials: false`; perfil
  sem `.donel-profile.json` ⇒ nome derivado do slug; `projects` **junction** ×
  **diretório real** × **ausente**; entrada que não é diretório é ignorada;
  `.claude.json` corrompido ⇒ `mcpServerNames: []`.
  **DoD**: suíte vermelha por ausência de implementação.

- [ ] **T1203** Implementar `src/main/accounts/migration/profile-inventory.ts`
  (`ProfileInventoryEntry`, `readProfileInventory`, IO **injetável** conforme
  `contracts/migration-etapa-2.md` §3). **Nunca lê `.credentials.json`** — só
  verifica existência.
  **DoD**: T1202 verde; `npm run typecheck` verde.

- [ ] **T1204** [P] Teste: `tests/mcpDiff.test.ts` — `onlyInProfile`/`onlyInGlobal`
  por **nome**; arquivo ausente/corrompido ⇒ diff vazio sem lançar; **fixture com
  token plantado dentro do bloco do servidor e asserção de que ele não aparece
  em lugar nenhum da saída**.
  **DoD**: suíte vermelha.

- [ ] **T1205** Implementar `src/main/accounts/migration/mcp-diff.ts` — função
  pura, saída só de nomes (D14). Sem caminho de escrita.
  **DoD**: T1204 verde.

- [ ] **T1206** [P] Teste: `tests/transcriptConsolidation.test.ts` — `realpath`
  igual (junction) ⇒ `already-consolidated`, **zero** operações; diretório real
  distinto ⇒ uma operação por `.jsonl` com id de sessão preservado; destino já
  existente ⇒ `skip-existing`, nunca sobrescreve; `projects` ausente ⇒
  `nothing-to-copy`.
  **DoD**: suíte vermelha.

- [ ] **T1207** Implementar
  `src/main/accounts/migration/transcript-consolidation.ts` — **puro** (recebe
  os `realpath` já resolvidos e devolve o plano); o executor de disco é
  injetável.
  **DoD**: T1206 verde.

- [ ] **T1208** [P] Teste: `tests/migrationState.test.ts` — `sanitizeMigrationState`
  resiliente (chave ausente, JSON corrompido, `step` desconhecido, slug vazio);
  idempotência do plano (perfil `imported` não reaparece como pendente);
  `skipped`/`failed` são retomáveis; `canArchive` só com zero pendentes.
  **DoD**: suíte vermelha.

- [ ] **T1209** Implementar `src/main/accounts/migration/migration-plan.ts`
  (função pura `(inventário, estado, diffs) ⇒ MigrationPlan`) **e** a chave
  `accounts.migration` no `src/main/config-store.ts`, plugando nos 4 pontos do
  padrão do arquivo (default, sanitize, DTO, escrita atômica) **sem tocar nas
  chaves existentes**.
  **DoD**: T1208 verde; `tests/config-store.test.ts` continua verde.

---

## Fase 2 — Execução assistida (depende da Fase 1)

- [ ] **T1210** [P] Teste: `tests/credentialsImport.test.ts` — importa **um**
  perfil por chamada; par **nunca** aparece no retorno, em log ou em mensagem de
  erro (varredura da saída inteira procurando o segredo plantado); cofre
  indisponível ⇒ recusa **antes** de ler o arquivo; arquivo com formato inválido
  ⇒ `failed: invalid-format`, sem gravar nada; conta criada com `{ id opaco,
  label }`, nunca e-mail.
  **DoD**: suíte vermelha.

- [ ] **T1211** Implementar `src/main/accounts/migration/credentials-import.ts`
  **dentro** de `src/main/accounts/` (a exceção do `CLAUDE.md` já cobre esse
  diretório — **não** ampliar a emenda). Grava no cofre da etapa 1 e registra a
  conta no pool do mod local.
  **DoD**: T1210 verde.

- [ ] **T1212** [P] Teste: `tests/archiveProfiles.test.ts` — **ordem invariante**:
  todo unlink de junction acontece antes do rename (asserção sobre a ordem das
  chamadas do dublê); falha de unlink ⇒ `aborted` nomeando o perfil, **sem**
  rename; `.old` já existente ⇒ sufixo de data; raiz ausente ⇒
  `nothing-to-archive`; **o dublê de IO não expõe método de deleção e o teste
  afirma que nenhum é chamado**.
  **DoD**: suíte vermelha.

- [ ] **T1213** Implementar `src/main/accounts/migration/archive-profiles.ts`
  (`ArchiveIoDeps` sem verbo de deleção, D13; desfaz as 6 junctions de
  `PROFILE_LINK_DIRS` por perfil e renomeia a raiz).
  **DoD**: T1212 verde.

- [ ] **T1214** IPC + preload da migração: registrar os `MIGRATION_CHANNELS`
  (`contracts/migration-etapa-2.md` §1) no main e a ponte
  `window.donel.migration.*` no `src/preload/index.ts`, no mesmo padrão de
  `accounts.*`. `archive` valida `canArchive` **no main**.
  **DoD**: `donel.d.ts` atualizado; typecheck verde; nenhum canal devolve
  conteúdo de arquivo de perfil.

- [ ] **T1215** UI do assistente: `src/renderer/src/MigrationWizard.tsx`
  (+ `.module.css`), acessível pelo `AccountsPanel` da etapa 1. Uma linha por
  perfil, com estado e **botão de importar individual** (OK humano perfil a
  perfil); bloco read-only com o diff de MCP (nomes) e a marcação "revisado";
  botão de arquivar habilitado só com `canArchive`; textos em pt-BR; **nunca
  exibe segredo**. Aparece só enquanto `~/.claude-profiles` existir.
  **DoD**: renderiza com inventário vazio sem quebrar; smokes do T1216/T1217
  cobrem o caminho feliz e a proteção.

- [ ] **T1216** Smoke: `tests/smoke/migration-wizard.spec.ts` — árvore de perfis
  falsa em `mkdtemp`, isolada do `homedir()` e do `%APPDATA%` reais: inventário
  aparece, importar **um** perfil deixa os outros pendentes, reabrir o
  assistente mostra o estado persistido, arquivar fica bloqueado enquanto houver
  pendente.
  **DoD**: smoke verde.

- [ ] **T1217** [P] Smoke: `tests/smoke/migration-nunca-deleta.spec.ts` — após a
  virada completa na árvore falsa: o diretório original existe sob `.old`, as
  junctions foram desfeitas, e o **alvo** (`<home falso>/.claude/projects`)
  continua com todos os arquivos. É a asserção que protege contra o pior caso
  da etapa.
  **DoD**: smoke verde.

---

## Fase 3 — Trocar a fonte (depende da Fase 2; **antes** de qualquer remoção)

- [ ] **T1218** Adaptar `tests/sessionAccountLabel.test.ts` (104 L) para a
  entrada `account`: rótulo com a conta ativa **no disparo**, imutável pela vida
  da aba; cota vinda do motor (uma unidade, C25); `formatArchivedAccountLabel`
  sobre `accountId`; **caso legado**: entrada arquivada só com `profileSlug`
  ainda rotula corretamente.
  **DoD**: suíte vermelha contra o contrato novo.

- [ ] **T1219** Trocar o contrato e os consumidores: `PtyCreateResult.profile` →
  `account` (`src/shared/index.ts:260–268`), `src/shared/sessionAccountLabel.ts`
  (:36–41, :64–82, :103–105), `TerminalPane.tsx` (:100, :224–225, :324) e os
  pontos de `App.tsx` que propagam o dado (:369, :418, :589–591, :707, :2315–2323,
  :2776, :2895). O main passa a preencher `account` a partir do motor
  (`index.ts:551`).
  **DoD**: T1218 verde; app abre e a statusbar mostra a conta da sessão em foco.

- [ ] **T1220** `devMode.ts`/`config-store.ts`: `ArchivedPhaseSession.profileSlug`
  → `accountId` (`devMode.ts:37, :160–161, :284, :297–298`), com **leitura
  tolerante** do campo legado (C30/D15) em `sanitizeArchivedPhaseSessions`
  (`config-store.ts:390–393`); `activeProfileSlug` deixa de ser escrito mas
  continua aceito no sanitize (`:79, :103, :495–498`).
  **DoD**: `tests/config-store.test.ts` e `tests/devMode.test.ts` ajustados e
  verdes, incluindo um caso explícito de config gravada por canal antigo.

- [ ] **T1221** Tela de contas substitui o dropdown de perfis: `AccountsPanel`
  (etapa 1) assume o lugar do `<ProfileSwitcher>` em `App.tsx:2393–2397`,
  alimentando badge do titlebar e statusbar. **Uma unidade só** (C25): a
  conversão de `AccountLoad` (% consumido) para o texto exibido acontece num
  formatador único, com teste. Se o embelezamento de rótulo
  (`parseAccountNumber`) for desejado, ele **muda de casa** para o módulo de
  contas — não fica órfão em `shared/profiles.ts`.
  **DoD**: app abre sem `ProfileSwitcher` montado; smoke do T1226 cobre;
  formatador com teste de unidade.

---

## Fase 4 — Demolição (depende da Fase 3 verde)

- [ ] **T1222** Remover o mecanismo do main: apagar `src/main/profile-manager.ts`
  (673 L) e limpar `src/main/index.ts` — imports (:27, :36–38, :76, :95,
  :138–155), estado de módulo (:337–348), `registerProfileIpcHandlers` inteiro
  (:1226–1303) e sua chamada (:1343), helpers (:1202–1216), boot do perfil
  (:1329–1338), `claudeConfigDir` do spawn (:527, :536), `legacyConfigPaths`
  (:595–601), e os usos em `:1049`/`:1073` (passam a não informar config dir).
  Remover a ponte `profiles.*` do preload (:11, :23–25, :47, :170–187) e
  `src/shared/profiles.ts` (131 L) com seus exports no barrel
  (`shared/index.ts:11, :44, :46–55, :361`).
  **Se a etapa 3 já tiver entrado**: remover também o ramo "perfil" da função
  pura de precedência `resolveSessionConfigDir`
  (`registry-classe-a/plan.md` D3/C21) — a tabela-verdade dela já cobre o mundo
  sem perfil, então o teste existente deve continuar verde com um caso a menos.
  **DoD**: `npm run typecheck` verde; app abre; nenhuma referência a
  `PROFILE_CHANNELS` no `src/`.

- [ ] **T1223** Remover a leitura de cota por perfil: apagar
  `src/main/quota-headroom.ts` (366 L), o `HeadroomCache` do `index.ts` (:348,
  :164) e o handler `profiles:headroom`. Conferir que nenhuma env de fixture
  (`DONEL_QUOTA_AXI_FIXTURE`) restou em script, smoke ou doc.
  **DoD**: typecheck verde; `grep -r "quota-axi" src/ tests/` sem hits em código
  executável.

- [ ] **T1224** Remover o fluxo "Reiniciar sessão em foco" **inteiro**
  (C31/A9 — decisão do dono, 2026-08-04): apagar `src/main/transcript-copy.ts`
  (87 L) e `src/shared/transcriptCopy.ts`; em `App.tsx`, remover o botão
  "⟳ Reiniciar" (:2717), o diálogo (:2940–2962), `handleOpenRestart`,
  `confirmRestart`, `restartTarget`, `lastRestartSession` e o `<pre>` de
  smoke `restart-last-session` (:2888–2890). O equivalente do gesto é trocar
  a conta ativa no motor + retomar por "Sessões anteriores" — nada novo a
  construir. O CA-24 da 009 fica **superseded** (marcação no registro da 009,
  mesma regra da C32 — nunca deleção).
  **DoD**: typecheck verde; `grep -ri "restart" src/` sem hits do fluxo morto;
  nenhum texto de UI referenciando reinício de sessão.

- [ ] **T1225** Remover `src/renderer/src/ProfileSwitcher.tsx` (619 L) e seu
  `.module.css`. **Antes de apagar**, conferir o componente de badge citado em
  `ProjectSwitcher.tsx:22` — se for compartilhado, ele **fica** (achado A15).
  **DoD**: app abre; `ProjectSwitcher` intacto e verde.

- [ ] **T1226** **Morte declarada das suítes** — remover nominalmente as **9**
  (C34/A8 + decisão C31): `tests/profile-manager.test.ts` (726 L),
  `tests/quota-headroom.test.ts` (495 L), `tests/transcript-copy.test.ts`
  (102 L), `tests/transcriptCopy.test.ts` (67 L),
  `tests/smoke/profiles.spec.ts` (360 L), `tests/smoke/profile-quota.spec.ts`
  (170 L), `tests/smoke/profile-switcher-focus.spec.ts` (77 L),
  `tests/smoke/restart-session.spec.ts` e
  `tests/smoke/restart-session-devmode.spec.ts` (fluxo de reinício morre
  inteiro, T1224).
  **O que prova que nada quebrou** (critério explícito, não opinião): (a)
  `npm test` **inteiro verde sem elas**, com a contagem de suítes antes/depois
  colada no card; (b) `npm run typecheck` verde; (c) `git diff --stat` mostrando
  que **nenhuma** outra suíte foi removida; (d) o smoke novo
  `accounts-panel-substitui-perfis.spec.ts` (T1227) cobrindo, pela tela de
  contas, o comportamento que os smokes mortos cobriam pelo dropdown.
  **DoD**: os quatro itens acima registrados no card.

- [ ] **T1227** **Ajuste (não morte)** das suítes de raspão + smoke substituto:
  `tests/config-store.test.ts` (893 L), `tests/pty-manager.test.ts` (160 L —
  **só** o que cita perfil; `buildPtyEnv` e `claudeConfigDir` continuam
  testados, C33), `tests/devMode.test.ts`, `tests/phaseDetailsView.test.ts`,
  `tests/discovery-tree.test.ts`, `tests/openPhaseSession.test.ts`,
  `tests/claude-executable.test.ts`, `tests/sessionOrdering.test.ts` e os smokes
  que só esperam o badge de conta aparecer (`terminal`, `session-context`,
  `session-rename*`, `previous-sessions`, `dev-mode-*`, `config-persistence`,
  `empty-state`, `ca7-measurement`, `model-injection`).
  Criar `tests/smoke/accounts-panel-substitui-perfis.spec.ts`: não existe mais
  dropdown de perfis; a tela de contas ocupa o lugar, com uma unidade só.
  **DoD**: suíte inteira verde; nenhuma dessas suítes removida.

---

## Fase 5 — Registro (documento; depende da Fase 4)

- [ ] **T1228** `specs/backlog.md`: **B8/US-12** e **auto-switch** saem da fila,
  cada um com uma linha de destino ("absorvido no motor — `specs/011-…`", no
  mesmo estilo dos itens já riscados do arquivo, ver B5/B19); **B10 fica e
  simplifica** (a frase sobre perfis compartilhados entre canais some — não há
  mais perfis; o fundo "dois canais, mesmo `~/.claude`" continua); menção a
  perfis em B14/B18/B24 revista para não descrever mecanismo inexistente.
  **Nada é apagado** — itens saem marcados, não deletados.
  **DoD**: `git diff` do backlog só com marcações e notas de destino.

- [ ] **T1229** Marcar **superseded** (C32): bloco de cabeçalho em
  `specs/002-quota-headroom/spec.md`, `plan.md`, `tasks.md` e `roteiro-e2e.md`,
  e nos artefatos históricos da 001 (`spike-t001-resultado.md`,
  `spike-t002-resultado.md`, `analise-switch-account-amanda.md`) apontando para
  `specs/011-contas-e-provedores/`. **Nenhum arquivo é deletado ou reescrito** —
  só ganha o bloco no topo.
  **DoD**: os 7 arquivos com o bloco; conteúdo original intacto abaixo dele.

- [ ] **T1230** Atualizar o `CLAUDE.md` do repo (e `README.md`,
  `docs/LEIA-ME-colegas.md`, `CHANGELOG` onde citarem perfis): a seção de
  gotchas perde "`~/.claude-profiles` nunca no OneDrive" como regra viva (vira
  nota histórica da migração), o vocabulário passa a ser **conta/motor**, e a
  emenda de credenciais aberta na etapa 1 **continua a mesma**, sem ampliação —
  agora citando também `accounts/migration/`.
  **DoD**: nenhum documento do repo descrevendo perfis como mecanismo atual.

- [ ] **T1231** Roteiro do dia da virada:
  `specs/011-contas-e-provedores/roteiro-e2e-etapa-2.md` — passo a passo manual
  no alfa (abrir o assistente, importar perfil a perfil, conferir o diff de MCP,
  consolidar, arquivar, verificar `~/.claude-profiles.old` com junctions
  desfeitas e `~/.claude/projects` intacto, abrir sessão e ver a conta na
  statusbar). Inclui **o que fazer se algo falhar no meio** (o assistente é
  retomável; nada foi deletado).
  **DoD**: roteiro escrito; execução é gesto humano no alfa.

- [ ] **T1232** Regressão declarada final: `npm test` inteiro + `npm run
  typecheck` + `npm run lint`, com a saída colada no card, e uma varredura de
  vocabulário (`grep -ri "perfil\|profile\|junction" src/`) confirmando que só
  sobraram (a) `claudeConfigDir`/`buildPtyEnv` do `pty-manager` (C33),
  (b) `-NoProfile` do PowerShell e (c) o módulo de migração, que fala de perfis
  por dever de ofício.
  **DoD**: saída colada; qualquer sobra não prevista vira decisão explícita, não
  silêncio.

---

## Dependências e paralelismo

```
T1201 (gate duplo)
  └─► Fase 1:  T1202─►T1203      (inventário)
               T1204─►T1205      (diff de MCP)
               T1206─►T1207      (transcripts)
               T1208─►T1209      (plano + estado)
        [as quatro trilhas rodam em PARALELO — arquivos novos e distintos]
             └─► Fase 2: T1210─►T1211 ; T1212─►T1213   [paralelas]
                          └─► T1214 ─► T1215 ─► T1216 ; T1217  [smokes paralelos]
                   └─► Fase 3: T1218─►T1219─►T1220─►T1221   [sequencial]
                         └─► Fase 4: T1222─►T1223─►T1224─►T1225
                               └─► T1226 ─► T1227
                                     └─► Fase 5: T1228 ; T1229 ; T1230 ; T1231  [paralelas]
                                           └─► T1232
```

- **Fase 1** é o maior ganho de paralelismo: quatro módulos novos, quatro
  arquivos distintos, nenhum toca código existente.
- **Fase 3 é sequencial de propósito**: é a troca de contrato (`profile` →
  `account`) atravessando main, shared e renderer; duas mãos nela recriam o
  desencontro que originou a 010.
- **Fase 4 é a única que remove**, e só depois de a Fase 3 estar verde (D8):
  cada remoção é de código comprovadamente sem consumidor.

## Fora do escopo destas tasks (etapas irmãs)

Motor de contas, mods Seazone/local, cofre, `claude-state`, auto-switch 90/20 e
a UI base de contas (**etapa 1**, `tasks.md`, T1101–T1131 — pré-condição
implementada). Registry de providers, classe A com OpenRouter, env por provider
no spawn e a estrutura vazia da classe B (**etapa 3**). Fallback automático de
provider, mods externos carregáveis e UI de MCPs/integrações (fora da 011
inteira). Deleção de `~/.claude-profiles.old` — gesto humano, semanas depois,
fora do app.
