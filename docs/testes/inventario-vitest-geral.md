# Inventário vitest (geral; fora Esteira/DevMode/TaskDex/GitHub)

Contagem de testes por regex (it/test no início de linha; it.each conta 1). "Chat?" = afetado pela troca terminal -> chat. "Puro" = sem IO/timers reais.

| Arquivo | n | ms | Módulo(s) | Área | Protege | Tipo | Sobreposição / vivo? | Chat? | Lento por quê | Recomendação |
|---|---|---|---|---|---|---|---|---|---|---|
| accountEngine | 50 | 43 | account-engine, account-mod, reconnect-registry | contas | máquina de estados do motor: switch, auto-switch, poll, needsReconnect | puro (fakes) | núcleo; toca autoSwitch só na camada de decisão | não | - | manter |
| accountEngineHost | 8 | 23 | account-engine-host, local-mod, vault | contas | reconstrução do motor ao mudar config (F6) | puro | - | não | - | manter |
| accountModContract | 21 | 27 | account-mod, local-mod, seazone-mod, vault | contas | contrato comum dos mods | puro | seazone-mod ainda importado em engine/vault/index (código vivo, só fora da UI) | não | - | manter |
| accountPool | 38 | 19 | account-pool, isolated-login | contas | pool de contas locais | puro | vivo (engine-host) | não | - | manter |
| accountsConfig | 15 | 10 | accounts-config | contas | sanitize/persistência da config de contas | puro | vizinho de config-store | não | - | manter |
| accountsCredentialsFile | 15 | 12 | credentials-file | contas | ~/.claude/.credentials.json | I/O fs (tmp) | - | não | - | manter |
| accountsFormat | 18 | 36 | renderer accountsFormat | contas UI | formatação de carga/reset | puro | - | não | - | manter |
| accountsIsolatedLogin | 44 | 1219 | isolated-login, vault | contas | login isolado e colheita de credencial | fs + timers reais (4 sleep, vi.waitFor) | - | não | sleep(100) + waitFor reais | acelerar com vi.useFakeTimers (opcional) |
| accountsPastedPair | 14 | 9 | pasted-pair | contas | par colado | puro | - | não | - | manter |
| accountsTokenRefresh | 10 | 11 | token-refresh, usage-client | contas | refresh de token | puro (fetch fake) | fixtures parecidas com refreshCoordinator/localModFreshness | não | - | manter |
| accountsUsageClient | 10 | 7 | usage-client | contas | cliente de /usage | puro | - | não | - | manter |
| accountsVault | 15 | 24 | vault | contas | cofre | I/O fs | - | não | - | manter |
| accountsVaultReconciliation | 6 | 191 | vault-reconciliation, provider-secrets | contas | reconciliação do cofre | I/O fs | - | não | fs | manter |
| ansi | 7 | 4 | ansi | terminal | strip ANSI | puro | - | não (terminal oculto segue) | - | manter |
| archiveProfiles | 5 | 19 | migration/archive-profiles | migração | arquiva ~/.claude-profiles | I/O fs | vivo (index.ts, wizard); perfis demolidos mas a migração assistida existe | não | - | manter; remover junto do MigrationWizard quando a migração expirar |
| autoSwitch | 39 | 15 | auto-switch | contas | decisão de troca automática | puro | - | não | - | manter |
| carouselGeometry | 11 | 8 | design-system carouselGeometry | design-system | geometria do LevelCarousel | puro | não é usado em src/, só no design-system | não | - | mover para a suíte do design-system |
| chat-active-chain | 46 | 105 | activeChain, rows, transcriptEntry | chat | cadeia ativa | puro | camada sobre transcriptEntry (não duplica) | SIM | - | manter |
| chat-adapter | 62 | 585 | adapter, ipc, rows | chat | adapter transcript -> linhas | puro (fixtures grandes) | fixtures compartilhadas com active-chain/grouping | SIM | fixtures grandes + JSON.stringify de 200k | manter |
| chat-config | 5 | 9 | config-store (chat.*) | chat | defaults chat.enabled/focusMode | puro | sobrepõe config-store.test | SIM | - | fundir em config-store.test |
| chat-diagnostics-log | 4 | 28 | chat/diagnostics-log | chat | log de diagnóstico | I/O fs | - | SIM | - | manter |
| chat-focus-fold | 17 | 12 | focusFold | chat | dobra do modo foco | puro | - | SIM | - | manter |
| chat-grouping | 19 | 17 | grouping | chat | agrupamento | puro | - | SIM | - | manter |
| chat-screen | 20 | 116 | chat/screen, screenLine | chat | vista de tela | puro | usa screenLine como cliInputBox/terminalScreen | SIM | - | manter |
| chat-tool-summary | 29 | 22 | toolSummary, commandLabel | chat | resumo de tool | puro | - | SIM | - | manter |
| chat-transcript-entry | 29 | 40 | transcriptEntry | chat | classifica linhas | puro | - | SIM | - | manter |
| chat-transcript-io | 30 | 2850 | transcript-follower, transcript-pager | chat | follower/pager de JSONL | fs + timers reais (34 pontos de sleep/waitFor, sleep 60-200 ms) | MESMO mecanismo de transcriptWatcher (append em JSONL + debounce), helpers waitFor/sleep duplicados | SIM | sleeps fixos de 60-200 ms | manter; trocar sleeps por waitFor e unificar helper com transcriptWatcher |
| claude-executable | 12 | 133 | claude-executable | CLI | resolução do claude.exe | I/O fs | - | não | fs | manter |
| claudeState | 16 | 22 | claude-state, account-mod | contas | escrita de oauthAccount | I/O fs | - | não | - | manter |
| cli-user-settings | 4 | 5 | cli-user-settings | CLI | settings do usuário | puro | - | não | - | manter |
| cliColor | 17 | 9 | cliColor | terminal | cores | puro | - | não | - | manter |
| cliInputBox | 29 | 25 | cliInputBox, screenLine, trustDialog | terminal | detecta input box do CLI | puro | - | NÃO (terminal oculto segue) | - | manter |
| clipboard-bridge | 7 | 7 | clipboard-bridge | terminal | ponte de clipboard | puro (mock) | - | não | - | manter |
| commandBuilder | 34 | 22 | commandBuilder | sessões | argv do claude | puro | parcial com launchArgsForProvider | não | - | manter |
| config-store | 75 | 146 | config-store, devModeDefaults, sessionRegistry | config | persistência/sanitize | I/O fs | absorve chat-config | SIM (chat.*) | fs | manter |
| contextWindow | 32 | 36 | contextWindow | sessões | janela de contexto | puro | - | não | - | manter |
| credentialsImport | 8 | 12 | credentials-import | migração | import de credencial de perfil | I/O fs | vivo | não | - | manter |
| fake-claude-chat | 7 | 3013 | hooks-settings + processo fake-claude-chat.mjs | chat/fixture | valida o fake claude dos smokes | PROCESSO (spawn node) + waitFor 25 ms | testa a fixture, não o app | apoio do smoke | ~0,4 s por processo node | segmentar: rodar só com os smokes de chat (ou mover para tests/smoke) |
| hook-bridge.contract | 20 | 1735 | hook-bridge | semáforo | contrato HTTP (401/400/200) | SERVIDOR HTTP real + tick 30 ms | session-semaphore-manager usa o mesmo servidor | SIM (semáforo alimenta o chat) | servidor + sockets reais | manter; segmentar no grupo IO |
| hooks-settings | 18 | 44 | hooks-settings | semáforo | settings de hooks por pty | I/O fs | - | SIM | - | manter |
| launchArgsForProvider | 5 | 5 | renderer launchArgsForProvider | sessões | args por provedor | puro | parcial com commandBuilder | não | - | manter |
| liveSessionInjection | 12 | 8 | liveSessionInjection | sessões/Esteira | injeção em sessão viva | puro | vivo | NÃO (terminal oculto) | - | manter |
| localModFreshness | 31 | 38 | local-mod, token-refresh, vault | contas | frescor de token (D7/D9/R*) | puro | 3 arquivos montam local-mod com fixtures parecidas (com accountModContract e refreshCoordinator) | não | - | manter; extrair helper de fixtures |
| mcpDiff | 5 | 5 | mcp-diff | migração | diff de MCPs | puro | vivo | não | - | manter |
| migrationState | 10 | 7 | migration-plan/state/inventory | migração | estado da migração | puro | sobrepõe profileInventory | não | - | manter |
| newProject | 29 | 14 | newProject | projetos | validação | puro | vizinho de project-creator | não | - | manter |
| parse-claude-not-found | 4 | 5 | shared | CLI | detecta "claude not found" | puro | - | não | - | manter |
| possiblyBlockedOnPrompt | 6 | 6 | possiblyBlockedOnPrompt | semáforo | heurística de prompt travado | puro | - | NÃO (lê o terminal oculto) | - | manter |
| preTypeReadiness | 15 | 10 | preTypeReadiness, trustDialog | terminal | prontidão para digitar | puro | - | NÃO | - | manter |
| profileInventory | 12 | 13 | profile-inventory | migração | inventário de perfis antigos | I/O fs | vivo só para a migração | não | - | manter até o wizard sair |
| project-creator | 18 | 29 | project-creator | projetos | criação | I/O fs | - | não | - | manter |
| project-scanner | 14 | 8 | project-scanner | projetos | scan de repos | I/O fs | - | não | - | manter |
| projectBinding | 45 | 19 | projectBinding | projetos | vínculos board/GitHub | puro | fronteira com TaskDex/GitHub | não | - | manter |
| projectCatalog | 10 | 8 | projectCatalog, projects | projetos | catálogo | puro | sobrepõe projects.test | não | - | manter |
| projects | 3 | 21 | shared/projects | projetos | helpers | puro | 3 casos; sobrepõe projectCatalog | não | - | fundir em projectCatalog |
| providerEnv | 8 | 6 | provider-env | provedores | env por provedor | puro | - | não | - | manter |
| providerRegistry | 20 | 18 | provider-registry | provedores | registro | puro | - | não | - | manter |
| providerSecrets | 12 | 13 | provider-secrets, vault | provedores | segredos | I/O fs | - | não | - | manter |
| providersConfig | 18 | 13 | providers-config | provedores | config | puro | - | não | - | manter |
| pty-manager | 20 | 2318 | pty-manager | terminal | spawn de PTY + buildPtyEnv | PROCESSO (node-pty real) misturado com puro | 17 casos puros de env + 3 com PTY real | necessário | 3 PTYs reais (cmd.exe/PowerShell) | SEPARAR: buildPtyEnv puro (rápido) x spawn real (grupo IO) |
| reconnectRegistry | 6 | 6 | reconnect-registry | contas | registro de reconexão | puro | - | não | - | manter |
| refreshCoordinator | 7 | 14 | refresh-coordinator, local-mod | contas | serialização de refresh | puro | fixtures iguais a localModFreshness | não | - | manter |
| repoEntryList | 9 | 7 | repoEntryList | UI | lista de repos | puro | - | não | - | manter |
| resumeFailure | 17 | 8 | resumeFailure, sessionRegistry | sessões | falha ao retomar | puro | - | SIM (chat precisa do mesmo sinal) | - | manter |
| ring-buffer | 9 | 8 | ring-buffer | terminal | buffer circular | puro | - | NÃO (terminal oculto) | - | manter |
| ringBufferPreview | 3 | 3 | ringBufferPreview | UI | preview do buffer | puro | usado em TerminalPane | possível | - | manter |
| semaphore-state-machine | 21 | 11 | semaphore-state-machine | semáforo | máquina de estados | puro | - | SIM | - | manter |
| session-correlation | 4 | 5 | session-correlation | sessões | resolve sessão claude | puro | - | SIM | - | manter |
| session-indexer | 35 | 141 | session-indexer | sessões | índice de transcripts | I/O fs | - | SIM | fs | manter |
| session-seed | 14 | 15 | session-seed, session-indexer | sessões | semente | I/O fs | - | não | - | manter |
| session-semaphore-manager | 18 | 284 | session-semaphore-manager, hook-bridge | semáforo | manager | HTTP + vi.waitFor | usa o hook-bridge real | SIM | servidor | manter |
| sessionAccountLabel | 21 | 15 | sessionAccountLabel | sessões | rótulo de conta | puro | - | não | - | manter |
| sessionConfigDir | 7 | 3 | session-config-dir | sessões | dir de config | puro | - | não | - | manter |
| sessionName | 32 | 16 | sessionName | sessões | nome | puro | - | SIM | - | manter |
| sessionOrdering | 15 | 8 | sessionOrdering | sessões | ordenação | puro | vizinho de sessionShortcuts | não | - | manter |
| sessionRegistry | 26 | 15 | sessionRegistry | sessões | registro/poda | puro | - | não | - | manter |
| sessionShortcuts | 7 | 4 | sessionOrdering, sessionShortcuts | sessões | atalhos | puro | - | não | - | fundir em sessionOrdering |
| sessions | 31 | 14 | sessions | sessões | filtros/rótulos | puro | - | não | - | manter |
| smartZone | 8 | 7 | DS smartZone | design-system | zona inteligente | puro | usado em App.tsx | não | - | manter |
| smoke-project-name | 5 | 72 | lê tests/smoke/*.ts | meta-teste | cerca contra nome hardcoded (§B19) | I/O fs | - | não | - | manter (barato) |
| subscribeChannel | 6 | 12 | preload/subscribeChannel | IPC | assinatura de canal | puro | - | não | - | manter |
| tabAppearance | 16 | 11 | tabAppearance | UI | aparência de aba | puro | - | SIM (indicadores do chat) | - | manter |
| terminalKeymap | 19 | 14 | terminalKeymap | terminal | atalhos | puro | - | não | - | manter |
| terminalScreen | 11 | 9 | terminalScreen, screenLine | terminal | tela do terminal | puro | - | não | - | manter |
| transcriptConsolidation | 4 | 4 | migration/transcript-consolidation | migração | consolidação | I/O fs | vivo | não | - | manter |
| transcriptWatcher | 34 | 11299 | transcript-watcher | sessões | watcher de JSONL | fs.watch real + debounce 40 ms + waitFor 10 ms (28 pontos) | mesmo mecanismo de chat-transcript-io | SIM | ~330 ms por teste (escreve arquivo, espera debounce + evento fs.watch) | ACELERAR: injetar watchFn falso (o registry já aceita) nos casos de lógica; deixar 3-4 com fs.watch real |
| smoke/accountsCredentialGuard.test | 15 | 11 | guard local | smoke/contas | smoke não toca credencial real | puro | - | não | - | manter |
| smoke/statistics.test | 8 | 9 | statistics.ts | smoke | estatística da medição | puro | - | não | - | manter |

Fora deste escopo (outro agente): nodeGraph* (4), phaseChip, primeSequencer, tasksDoc, carregam dependência de Esteira/DevMode; listados no levantamento mas não analisados aqui. Os `tests/smoke/*.spec.ts` são Playwright (não vitest) e não entram.

## Conclusões

1. Seis arquivos concentram o tempo: transcriptWatcher 11,3 s, fake-claude-chat 3,0 s, chat-transcript-io 2,9 s, pty-manager 2,3 s, hook-bridge.contract 1,7 s, accountsIsolatedLogin 1,2 s (~22 s somados; paralelos dão ~19 s de parede). Os outros ~85 arquivos do escopo rodam em menos de 150 ms cada.
2. Os lentos usam relógio ou IO real: fs.watch + debounce, node-pty, processo node, servidor HTTP. Só accountsIsolatedLogin se resolve com vi.useFakeTimers.
3. Maior ganho: transcriptWatcher. O registry já aceita `watchFn` injetável; usá-lo nos casos de lógica e deixar 3-4 testes com fs.watch real. Estimativa: de ~11 s para ~2 s.
4. transcriptWatcher e chat-transcript-io testam o mesmo mecanismo (append em JSONL + debounce), com helpers waitFor/sleep duplicados. Unificar o helper e trocar os sleeps fixos (60-200 ms) por waitFor.
5. pty-manager.test mistura 17 casos puros de buildPtyEnv com 3 que criam PTY real. Separar em dois arquivos para a parte pura entrar no loop rápido.
6. fake-claude-chat.test valida a fixture dos smokes, não o app. Segmentar para rodar só junto dos smokes de chat (ou mover para tests/smoke).
7. Troca terminal -> chat: nenhum teste vira obsoleto. cliInputBox, trustDialog, preTypeReadiness, possiblyBlockedOnPrompt, liveSessionInjection, ring-buffer, terminalScreen e terminalKeymap seguem valendo, porque o terminal fica montado e oculto. Semáforo, transcript, session-indexer, sessionName e tabAppearance viram críticos para o chat.
8. Não achei teste de código morto: os módulos de migração/perfis (archive-profiles, profile-inventory, mcp-diff, migration-*, credentials-import, transcript-consolidation) e seazone-mod ainda são importados por index.ts/engine. Candidatos a remoção junto do código só quando o MigrationWizard sair. Único teste sem consumidor em src/: carouselGeometry (usado só no design-system, mover para a suíte dele).
9. Fusões pequenas (clareza, não tempo): chat-config (5) para config-store; projects (3) para projectCatalog; sessionShortcuts (7) para sessionOrdering.
10. Sobreposição de fixtures em contas: localModFreshness, accountModContract e refreshCoordinator montam local-mod/vault/usage-client de formas parecidas; extrair helper em tests/helpers em vez de remover casos.
11. Segmentação sugerida: (a) rápido = tudo puro (<3 s sem os seis); (b) IO = os seis lentos, rodar quando mexer em transcript, pty, hook-bridge, login isolado ou fixture do fake claude; (c) smokes Playwright à parte.
