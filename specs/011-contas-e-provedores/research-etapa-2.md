# Research & Clarifications — 011, etapa 2 (demolição de perfis + migração)

> Escopo deste arquivo: **somente a etapa 2** da entrega 011 — morte do
> mecanismo de perfis paralelos e a migração assistida do dia da virada.
> A etapa 1 (motor + mods) está planejada em `plan.md`/`tasks.md`/`research.md`
> e é **pré-condição implementada** desta aqui; a etapa 3 (registry de
> providers classe A + OpenRouter) tem run próprio.
>
> O detalhe integral do discovery vive em
> `.scratch/contas-e-provedores/issues/01,04,06`. Este arquivo carrega
> (a) o **inventário real de código** medido nesta fase, (b) as lacunas da spec
> resolvidas por julgamento (C23–C34) e (c) as alternativas rejeitadas.

## 1. Recorte da etapa 2

| Item da spec | Etapa 2? | Nota |
|---|---|---|
| `profile-manager.ts` + junctions + doctor/repair morrem sem herdeiro | **Sim** | Núcleo da etapa |
| As suítes de perfil morrem | **Sim** | A conta real é maior que "4" — ver C34 |
| Dropdown de headroom (spec 002) vira UI do motor | **Sim** | O painel já nasceu na etapa 1 (`AccountsPanel`); aqui ele **substitui** o `ProfileSwitcher` |
| `sessionAccountLabel` muda de fonte | **Sim** | C10 da etapa 1 disse explicitamente "isso é etapa 2" |
| Migração assistida (credenciais, transcripts, MCPs, junctions, arquivamento) | **Sim** | Tickets 06 |
| Backlog: B8/US-12 e auto-switch saem; B10 fica e simplifica | **Sim** | Documento, não código |
| Spec 002 + histórico 001 marcados superseded | **Sim** | Marcação, nunca deleção (C32) |
| Injeção de env no spawn (`pty-manager.ts`) | **Não morre** | Fica; vira env por provider da classe A na etapa 3 (C33) |
| Registry de providers, classe A/B, OpenRouter | **Não** — etapa 3 | |
| Motor, mods, cofre, auto-switch, `claude-state` | **Não** — etapa 1 | Já planejados |

## 2. Inventário real medido nesta fase (04/08)

Números conferidos no checkout da branch `esteira/contas-e-provedores`
(`wc -l`, `grep -n`). O ticket 01 já havia mapeado a superfície; aqui ela está
com tamanho e ponto de corte.

### 2.1 Morre inteiro (módulo + dono do teste)

| Arquivo | Linhas | Papel |
|---|---|---|
| `src/main/profile-manager.ts` | 673 | Junctions (6), doctor, repair, delete, bootstrap `claude -p` |
| `src/main/quota-headroom.ts` | 366 | `readAllProfilesHeadroom` — quota-axi por `CLAUDE_CONFIG_DIR` |
| `src/main/transcript-copy.ts` | 87 | Cópia de transcript **entre perfis** (CA-24/009) |
| `src/shared/transcriptCopy.ts` | — | Decisão pura da cópia entre perfis |
| `src/shared/profiles.ts` | 131 | `PROFILE_CHANNELS`, `ProfileQuota`, `ProfileHeadroomMap` |
| `src/renderer/src/ProfileSwitcher.tsx` | 619 | Dropdown de perfis (+ `.module.css`) |

### 2.2 Suítes que morrem com seus donos

| Suíte | Linhas |
|---|---|
| `tests/profile-manager.test.ts` | 726 |
| `tests/quota-headroom.test.ts` | 495 |
| `tests/smoke/profiles.spec.ts` | 360 |
| `tests/smoke/profile-quota.spec.ts` | 170 |
| `tests/smoke/profile-switcher-focus.spec.ts` | 77 |
| `tests/transcript-copy.test.ts` | 102 |
| `tests/transcriptCopy.test.ts` | 67 |

**Total ≈ 1 997 linhas de teste + ≈ 1 876 linhas de produção removidas.**

### 2.3 Cirurgia pontual (muda, não morre)

| Arquivo | Ponto (linhas medidas) | O que muda |
|---|---|---|
| `src/main/index.ts` (1 369 L) | imports (:27, :36–38, :76, :95, :138–155, :164); estado de módulo (:337–348, inclui `headroomCache`); `resolveTranscriptPath` (:460–463); spawn de PTY (:527 `claudeConfigDir`, :536, :551 `profile`); `legacyConfigPaths` (:595–601); `archivePhaseSession` (:741); `sessions:forgetIfOrphan` (:1049); `sessions:seedProject` (:1073); helpers `currentProfileList`/`toProfileSummaryDto`/`resolveProfileOrSynthesize` (:1202–1216); `registerProfileIpcHandlers` inteiro (:1226–1303); boot do perfil (:1329–1338) e sua chamada (:1343) | Estado e handlers de perfil saem; a fonte passa a ser o motor. **Único arquivo compartilhado com a 010** |
| `src/preload/index.ts` (325 L) | imports (:11, :23–25, :47); bloco `profiles: {…}` (:170–187) | Removidos; `accounts.*` (etapa 1) fica |
| `src/main/pty-manager.ts` (223 L) | `PtyCreateOptions.claudeConfigDir` (:26–47), `buildPtyEnv` (:56–86), chamada (:150) | **Fica intacto** (C33) — o parâmetro sobrevive para a classe A da etapa 3 |
| `src/shared/sessionAccountLabel.ts` (105 L) | entrada `profile` (:36–41), `computeSessionAccountLabel` (:64–82), `formatArchivedAccountLabel` (:103–105), import de `./profiles` (:34) | **Módulo sobrevive, contrato muda** (C24): entrada vira `account`, cota vem do motor. Sua suíte (104 L) é **adaptada**, não morta |
| `src/shared/index.ts` (378 L) | :11, :44, :46–55 (barrel de `./profiles`), :80 (`isArchivedSessionProfileMismatch`), :260–268 (`PtyCreateResult.profile`), :361 (`profiles: DonelProfilesApi`) | Exports de perfil saem; `PtyCreateResult.account` entra |
| `src/shared/devMode.ts` (381 L) | `ArchivedPhaseSession.profileSlug` (:37), `isArchivedSessionProfileMismatch` (:160–161), validação (:284, :297–298) | `profileSlug` → `accountId`, com leitura tolerante do legado (C30) |
| `src/main/config-store.ts` (643 L) | import (:21), `AppConfig.activeProfileSlug` (:79, :103), `sanitizeArchivedPhaseSessions` (:390, :393), `sanitizeAppConfig` (:495–498), legado (:554–557, :570–579, :581–589) | Deixa de ser escrito; leitura tolerante (C30). Ganha a chave `accounts.migration` (C28) |
| `src/renderer/src/App.tsx` (3 031 L) | ~25 pontos: import (:112), `accountLabel` (:369), `profileHeadroom` (:377), `sessionProfiles` (:418), `activeProfileSlug` (:560–563), `handleProfileResolved` (:589–591), limpeza (:707), deps (:1324–1326), toast de conta arquivada (:1718–1721), restart cross-profile (:1781–1782, :1812–1875, :2065), rótulo/cota da sessão (:2315–2323), montagem do `ProfileSwitcher` (:2393–2397), props (:2776, :2828, :2895), textos do diálogo (:2954–2958) | Reaponta para o motor; o fluxo cross-profile some (C31) |
| `src/renderer/src/TerminalPane.tsx` (629 L) | comentário (:92–97), prop `onProfileResolved` (:100), ref (:224–225), leitura de `result.profile` (:324) | Vocabulário de conta |
| `src/main/session-seed.ts` (85 L), `src/main/session-indexer.ts` (484 L) | `claudeHome` (:14, :52, :58) — **zero menção a perfil** | **Nenhuma cirurgia**: o parâmetro é agnóstico; só o chamador (`index.ts:1073`) deixa de passar config dir de perfil |
| `src/main/claude-executable.ts`, `hooks-settings.ts`, `session-correlation.ts`, `session-semaphore-manager.ts`, `shared/commandBuilder.ts`, `DevMode/openPhaseSession.ts` | **verificado: nenhuma dependência de perfil** (os hits de grep são `-NoProfile` do PowerShell) | **Não mudam nesta etapa.** A premissa Claude-only que carregam é o binário fixo — tema da etapa 3, não da demolição |
| `src/renderer/src/ProjectSwitcher.tsx` (458 L) | :22 — só um comentário citando componente de badge compartilhado | Conferir o componente compartilhado antes de apagar o `ProfileSwitcher` |

### 2.4 Suítes tocadas de raspão (ajuste, nunca morte)

`tests/config-store.test.ts` (893 L, 38 menções), `tests/pty-manager.test.ts`
(160 L, 6), `tests/sessionAccountLabel.test.ts` (104 L, 12),
`tests/devMode.test.ts` (293 L, 12), `tests/phaseDetailsView.test.ts` (302 L, 5),
`tests/discovery-tree.test.ts` (411 L, 2), `tests/claude-executable.test.ts` (1),
`tests/openPhaseSession.test.ts` (1), e os smokes
`restart-session.spec.ts` (5), `restart-session-devmode.spec.ts`,
`dev-mode-*.spec.ts`, `previous-sessions.spec.ts`, `session-*.spec.ts`,
`config-persistence.spec.ts`, `terminal.spec.ts`, `empty-state.spec.ts`,
`ca7-measurement.spec.ts`, `model-injection.spec.ts` (1–2 cada).

Padrão observado: fora das 7 suítes acima, "profile" aparece como **campo de
fixture** ou **rótulo de tela**, não como objeto do teste.

## 3. Anatomia real de um perfil em disco (base da migração)

Lida em `profile-manager.ts:51–62, 155–200`:

```
~/.claude-profiles/<slug>/
├── .donel-profile.json     metadado do app (nome de exibição)
├── projects/   ─┐
├── skills/      │
├── commands/    ├─ 6 JUNCTIONS para ~/.claude/<dir>  (PROFILE_LINK_DIRS)
├── rules/       │
├── plugins/     │
├── templates/  ─┘
├── settings.json           CÓPIA de ~/.claude/settings.json na criação
├── CLAUDE.md               CÓPIA de ~/.claude/CLAUDE.md na criação
├── .claude.json            do CLI: oauthAccount, machineID, projects, mcpServers
└── .credentials.json       do CLI: o par OAuth da conta
```

Consequências que mandam no desenho da migração:

1. **`projects` é junction** → todos os perfis apontam para o **mesmo**
   `~/.claude/projects` físico. O passo "copiar transcripts" da spec, na
   topologia real desta máquina, **não tem o que copiar** (C26). O próprio
   `transcript-copy.ts:13–21` registra isso como achado medido em 30/07.
2. **O que de fato diverge por perfil** é só: `.credentials.json` (o alvo da
   importação), `.claude.json` (donde sai o diff de MCP) e as duas cópias
   (`settings.json`, `CLAUDE.md`).
3. **As junctions nascem em dois lugares só**: `createSystemProfileCreationIoDeps`
   (`profile-manager.ts:308`, executada pelo case `'junction'` em `:236`) e
   `createSystemProfileRepairIoDeps` (`:580`) — ambas
   `fs.symlinkSync(target, link, 'junction')`. Nenhum outro módulo do `src/`
   toca `~/.claude-profiles` em disco: todo acesso passa por
   `profilesRootDir`/`profileDirPath`/`claudeHomeDir` (verificado por varredura).
4. **Junction desfeita ANTES do rename não é preciosismo**: o próprio
   `deleteProfileDirectory` (`profile-manager.ts:624–644`) desfaz as 6 antes de
   remover o diretório, exatamente porque uma remoção recursiva que atravesse
   um junction apagaria o conteúdo **real** de `~/.claude` (C27).

## 4. Clarifications — lacunas resolvidas nesta fase

Sem humano no loop. Cada uma escolhe a leitura mais conservadora do que o
discovery já decidiu (tickets 04 e 06). Resumidas em `spec.md`; a razão está
aqui.

**C23 — Pré-condição de demolição.** A etapa 2 só roda com a etapa 1
**implementada, validada em dogfooding no alfa e com um mod ativo**
(`accounts.mod ≠ null`). Motivo: o motor nasce inerte (C2); demolir perfis com
o motor inerte deixaria o app sem nenhum meio de trocar de conta — o pior
estado possível. É a primeira task (T1201), no mesmo lugar em que a etapa 1 pôs
o gate da 010.

**C24 — Rótulo de sessão: muda de fonte e de vocabulário, não de forma.**
`PtyCreateResult.profile` passa a `account: { id, label }`, preenchido pelo
motor **no momento do disparo** e **imutável pela vida da aba** (mesma regra
"por valor na criação" que o `claudeConfigDir` já seguia, T014). Nenhum
repositório novo de persistência é criado: onde o slug de perfil já era
persistido (`devMode.archivedPhaseSessions[].profileSlug`, `config-store.ts:390`)
passa a ser `accountId`. "Gravada como fato da sessão" = gravada no ponto onde a
sessão nasce, não reconsultada depois — não implica store novo.

**C25 — Uma unidade só.** Com a morte do dropdown de perfis, `ProfileQuota`
(**% livre**) sai de cena e sobra `AccountLoad` (**% consumido**). A conversão
acontece uma vez, na borda de apresentação. Isso **fecha** o achado A3 do
analyze da etapa 1 (duas unidades convivendo na tela), que era um risco
temporário por desenho.

**C26 — Transcripts: inventariar antes de copiar.** O passo 2 da migração vira
"copiar **só o que for diretório real**": para cada perfil, comparar
`realpath(<perfil>/projects)` com `realpath(~/.claude/projects)`; iguais →
registrar "já consolidado", nada a fazer. Diferentes (perfil criado à mão,
junction quebrada, outra máquina) → copiar os `.jsonl` preservando o id de
sessão, sem sobrescrever destino existente. A spec não fica menor: ela fica
verdadeira.

**C27 — Ordem obrigatória do arquivamento.** Desfazer as 6 junctions de **cada**
perfil **antes** de renomear `~/.claude-profiles` para
`~/.claude-profiles.old`. Se o `.old` já existir, sufixar com data
(`.old-YYYYMMDD`). **Nunca deletar** — nem o `.old`, nem perfil nenhum. Motivo
em §3.3: um `rm -rf` humano semanas depois, com junction viva, é o cenário que
destrói `~/.claude`.

**C28 — Idempotência e estado da migração.** O progresso vive na chave
`accounts.migration` do `config.json` (`{ startedAt, completedAt, profiles:
{ <slug>: { credentials: 'imported'|'skipped'|'absent', transcripts: …,
mcpReviewed: boolean } }, archivedTo: string|null }`), com o mesmo padrão de
sanitize resiliente do `config-store.ts`. O assistente é **reexecutável**: nunca
reimporta o que já entrou, e um perfil pulado pode ser retomado depois. A
migração é única por decisão de produto, não por impossibilidade técnica.

**C29 — Diff de MCP é leitura, e é sobre nomes.** O relatório lista **nomes de
servidor** presentes no `.claude.json` de um perfil e ausentes do
`~/.claude.json` (e vice-versa), **nunca** o conteúdo do bloco — argumentos de
MCP carregam token com frequência. Sem merge automático, sem botão "aplicar".
*Suposição revisável*: o mesmo relatório aponta também divergência das cópias
`settings.json`/`CLAUDE.md` (só "difere/igual", sem conteúdo). Se o Alexandre
achar ruído, cortar essa linha não afeta mais nada.

**C30 — Config legada é tolerada, não apagada.** `activeProfileSlug` e
`archivedPhaseSessions[].profileSlug` deixam de ser **escritos**, mas o sanitize
continua **aceitando-os sem erro** e o `profileSlug` legado é **lido como**
`accountId` quando o novo campo não existir. Motivo direto do `CLAUDE.md`: os
canais alfa/beta/stable compartilham `userData`, e um canal antigo aberto depois
não pode ter seu estado destruído por um sanitize novo (é o risco "sanitize com
passthrough" já registrado).

**C31 — "Reiniciar sessão em foco" morre inteiro (decisão do dono,
2026-08-04, revisão da fase Plano).** A resolução original do analyze (A9) era
conservadora: manter o gesto e matar só a cópia de transcript. O Alexandre
decidiu na revisão que **o botão sai também**: com credencial única e global,
"reiniciar em outra conta" vira apenas "trocar a conta ativa no motor +
retomar por Sessões anteriores" — um botão dedicado é redundância que só
existia por causa dos perfis. Morrem: o botão "⟳ Reiniciar"
(`App.tsx:2717`), o diálogo (`App.tsx:2940–2962`), `handleOpenRestart`/
`confirmRestart`/`restartTarget`/`lastRestartSession`, `transcript-copy.ts` e
`transcriptCopy.ts`, e os smokes `restart-session.spec.ts` e
`restart-session-devmode.spec.ts` (contados na C34). Isto **remove o CA-24 da
009** — comportamento de entrega já feita — com decisão humana registrada; o
registro da 009 fica intacto (superseded é marcação, C32).

**C32 — Superseded é marcação, nunca deleção.** `specs/002-quota-headroom/*` e
os artefatos históricos da 001 (`spike-t001-resultado.md`,
`spike-t002-resultado.md`, `analise-switch-account-amanda.md`) ganham um bloco
de cabeçalho apontando para a 011 e continuam onde estão, íntegros. Vale a mesma
regra do repo já usada no `backlog.md` (itens riscados com nota, não apagados).

**C33 — `CLAUDE_CONFIG_DIR` não morre como mecanismo.** Morre como **meio de
trocar de conta**. `PtyManager` mantém o parâmetro `claudeConfigDir` e o
`buildPtyEnv` (`pty-manager.ts:72–83`) intactos: na etapa 3 eles passam a ser
alimentados pelo **provider da classe A** (env por provider + config dir próprio,
ticket 05). Nenhuma task desta etapa pode remover esse parâmetro nem seu teste —
é a porta que a etapa 3 atravessa.

**C34 — A conta honesta das suítes.** A spec fala em "4 suítes"
(`profile-manager.test` + os 3 smokes). O inventário acrescenta
`quota-headroom.test.ts` (495 L), `transcript-copy.test.ts` (102 L) e
`transcriptCopy.test.ts` (67 L) — todas morrem **porque seus módulos morrem**,
consequência direta de "dropdown vira UI do motor" e de `transcript-copy` estar
na lista "morre inteiro" do ticket 01. Com a decisão da C31 (o fluxo de
reinício morre inteiro), somam-se `tests/smoke/restart-session.spec.ts` e
`tests/smoke/restart-session-devmode.spec.ts`. São **9 suítes**, não 4.
Nenhuma outra é removida: as tocadas de raspão (§2.4) são **ajustadas**.

## 5. Alternativas consideradas e rejeitadas nesta fase

| Alternativa | Rejeitada porque |
|---|---|
| Deletar `~/.claude-profiles` na virada (é backup, o cofre já tem as credenciais) | Decisão explícita do discovery: arquivar, nunca deletar. E o cofre só tem o que o humano aprovou perfil a perfil — deletar o resto no mesmo gesto transforma um erro de importação em perda definitiva |
| Renomear `~/.claude-profiles` **com** as junctions vivas | Um `rm -rf` humano semanas depois pode atravessar a junction e apagar `~/.claude` real. Desfazer primeiro custa 6 chamadas por perfil (C27) |
| Merge automático dos `mcpServers` dos perfis no global | Vetado pelo discovery. Além do risco de sobrescrever config boa, argumento de MCP carrega segredo — merge cego é vazamento silencioso (C29) |
| Manter `profile-manager.ts` como "isolamento de provider externo" | O provider da classe A precisa de **diretório comum**, não de junction (ticket 04). Manter 673 linhas de junction/doctor/repair para reusar um `mkdir` é dívida disfarçada de reuso |
| Deixar `sessionAccountLabel` intacto (motor já preenche `PtyCreateResult.profile`, C10) | Funcionaria, e é justamente por isso que a etapa 1 pôde ser mergeada. Mas manter o vocabulário "perfil" num app sem perfis é a receita do próximo leitor procurar `profile-manager.ts` e não achar |
| Criar store novo para "conta como fato da sessão" | O ponto de nascimento da aba já é fato imutável hoje; um registro novo seria estado a manter, invalidar e migrar, sem pergunta que ele responda (C24) |
| Fazer a migração rodar sozinha no primeiro boot, sem OK | O discovery pediu humano no loop **perfil a perfil**. Importar credencial em silêncio é exatamente o tipo de ação que a regra "o app nunca lê credenciais" existe para tornar visível |
| Adiar a demolição até a etapa 3 (fazer tudo de uma vez) | O valor da etapa é a config única virar **o único caminho**; conviver com dois mecanismos é o estado que produz divergência silenciosa de MCP — o defeito nº 2 que a spec existe para matar |
