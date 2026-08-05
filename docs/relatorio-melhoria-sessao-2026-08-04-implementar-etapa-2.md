# Relatório de melhoria — sessão de 04/08/2026 (Implementar da etapa 2 da 011)

Sessão disparada pelo Modo Dev (`run-c35a259f-dae`, fase Implementar do item
`wi-demolicao-perfis-migracao`) — o **redisparo** do run que havia parado no
gate T1201. Resolveu o gate sem escrever código, disparou um worker
(sonnet/medium) que executou as 32 tasks da etapa 2 — migração assistida +
demolição completa do mecanismo de perfis — e fechou com verificação própria
da cockpit e result no outbox. Sucede
`relatorio-melhoria-sessao-2026-08-04-validacao-etapa-1.md`; a numeração de
achados continua de lá (P24+).

A frase que resume a sessão: **a esteira rodou em cima de um repo que estava
sendo escrito por outra sessão ao mesmo tempo** — e tudo deu certo por
disciplina barata (medir antes de agir, `git add` por path explícito), não por
proteção do processo. As duas coisas que quase deram errado vêm daí.

## O que a sessão produziu

- **Gate T1201 resolvido sem código.** A medição inicial da cockpit apontava a
  pré-condição (a) como insatisfeita; a pergunta foi feita ao dono com as três
  evidências na mesa, ele confirmou o gate — e a confirmação **já estava
  registrada** no `tasks-etapa-2.md` (commit `3aa2705`), escrita pela sessão de
  validação da etapa 1 que terminou minutos antes (ver falha de processo #1).
- **Worker in-session (sonnet/medium)**: T1202–T1232 completas em ~113 min,
  537 tool calls, ~665k tokens. 9 commits de trabalho + 1 de manifesto
  (`06cfa85..1d27f6c`):
  - **Fase 1** — 4 módulos puros de migração (inventário, diff de MCP,
    consolidação de transcripts, plano) + `accounts.migration` no
    config-store, TDD vermelho→verde.
  - **Fase 2** — `credentials-import` (par direto pro cofre, formato real
    `{claudeAiOauth}` da ADR 0001), `archive-profiles` (unlink de junction →
    rename, **nenhum verbo de deleção existe**), 5 canais IPC,
    `MigrationWizard`, 2 smokes em árvore de perfis falsa (`mkdtemp`).
  - **Fase 3** — religação: rótulo de sessão vem da conta (C24/C25), sessões
    arquivadas leem legado com tolerância (C30/D15), `AccountsPanel` substitui
    o `ProfileSwitcher` no titlebar.
  - **Fase 4** — demolição: `profile-manager` (673L), `quota-headroom`,
    `transcript-copy`, `ProfileSwitcher`, `shared/profiles` e 8 suítes
    apagados; spawn nunca mais aplica `CLAUDE_CONFIG_DIR` de perfil;
    `pty-manager.ts` intocado (porta da etapa 3).
  - **Fase 5 + T1232** — backlog e specs antigas SUPERSEDED (conteúdo
    intacto), docs atualizados, `roteiro-e2e-etapa-2.md`, e um achado real
    corrigido na regressão final (ver P26).
- **Verificação própria da cockpit**: `npm test` (94 arquivos, **1649/1649**)
  e `npm run typecheck` (limpo) re-executados pela sessão principal antes de
  declarar a fase pronta — não confiança no relatório do worker. A queda de
  1709→1649 testes é a demolição: 8 suítes de perfil morreram, suítes novas de
  migração entraram; saldo esperado, não regressão.
- **Result no outbox** (`run-c35a259f-dae.json`) com os 5 fatos do contrato,
  `verification.recorded` com enum correto (`passed`) e a nota de que a
  verificação foi re-executada pela cockpit.
- Duas lições novas em `tasks/lessons.md` (formato real do `.credentials.json`;
  assinatura duplicada de IPC).

## Falhas de processo do agente (e correções)

### 1. Perguntei ao dono com evidência que já tinha vencido

A cockpit mediu o gate (grep no `tasks-etapa-2.md`, `merge-base` contra
`staging`, leitura do `validar-result.json`) e montou a pergunta com três
fatos: rodada 2 não mergeada, switch nunca exercitado, confirmação não
registrada. **Os três eram verdade no momento da medição e falsos minutos
depois**: a sessão de validação da etapa 1 estava terminando exatamente esse
trabalho em paralelo, na mesma árvore. A denúncia veio do próprio erro — o
`Edit` que ia marcar o T1201 falhou porque o checkbox **já estava marcado**
por commit alheio (`3aa2705`) que entrou entre a minha leitura e a minha
escrita.

O dano foi nulo (a resposta do dono coincidiu com o estado real), mas a forma
era errada: numa máquina com sessões concorrentes, decisão e pergunta se
montam com medição **imediatamente anterior**, e falha de `Edit` por "não
achei o texto" é sinal de corrida, não de typo.

**Correção adotada:** re-medir na hora de agir, não reutilizar medição do
início do turno; e tratar mismatch de `Edit` em arquivo de estado como
gatilho para reler o arquivo e o `git log` antes de qualquer outra coisa.

### 2. Disparei o worker na árvore que outra sessão ainda estava usando

O worker rodou na árvore principal do repo (convenção herdada dos runs da
etapa 1) — e, durante a execução dele, dois commits de outra sessão entraram
**entrelaçados** na mesma branch (`d094b5c` política de review, `e523a6e`
ADR 0001), no meio dos commits do worker. Nada quebrou porque os dois lados
commitaram por path explícito e não tocaram os mesmos arquivos — mas duas
sessões e um worker escrevendo a mesma árvore ao mesmo tempo é exatamente o
desencontro que worktree isolada existe para impedir. A skill da esteira
prescreve recriar worktree (FR-013); a esteira local do Donel não seguiu a
prescrição e desta vez cobrou o risco em dobro.

**Correção adotada:** virou o achado P24 — a decisão de produto é do dono,
mas até lá a cockpit passa a conferir `git log` por commits alheios recentes
(< 1h) antes de disparar worker na árvore principal, e a avisar quando houver.

### 3. O result do outbox segue sem validação de contrato (P18 ainda aberto)

Gravei o `run-c35a259f-dae.json` copiando a estrutura de um result **já
aceito pelo app** (o da etapa 1) — o que evita a família P5/P7 por herança,
não por verificação. O `scripts/valida-result.mjs` sugerido no P18 continua
não existindo, então "validei antes de declarar" continua impossível de
cumprir ao pé da letra. Não é falha nova; é a mesma dívida, agora com mais um
arquivo confiando nela.

## Nota positiva — o que funcionou e vale manter

- **O gate segurou como gate.** O run anterior parou no T1201 sem escrever
  código; o redisparo só codou depois de confirmação humana explícita — e a
  pergunta foi uma só, com opções e recomendação, como o dono pede.
- **Verificação própria antes de declarar** (regra da sessão de validação,
  cumprida desta vez sem cobrança): a cockpit rodou a suíte e o typecheck ela
  mesma antes do result e do relatório ao dono.
- **A lição P20 foi aplicada, não só registrada**: o dublê inicial do
  `credentials-import` assumiu o par solto; o worker corrigiu contra o formato
  **confirmado por e2e humano** (ADR 0001, `{claudeAiOauth}`) ainda na fase 2,
  com lição gravada. A reincidência da família "contrato inventado" foi
  interceptada pela ADR que a sessão anterior deixou pronta.
- **`git add` por path explícito** foi o que permitiu commits alheios
  entrelaçados sem varrer nada de ninguém — disciplina barata que pagou caro.

## Achados de produto

### P24 — A esteira local do Donel não isola o worker da árvore compartilhada

A fase Implementar da esteira (kit SZI) manda **recriar worktree do zero**
(FR-013) justamente para o worker nunca dividir árvore com ninguém. A esteira
local do Donel herdou a convenção dos runs da etapa 1 — worker na árvore
principal — e esta sessão mostrou o custo: commits de duas origens
entrelaçados na mesma branch em tempo real, com colisão evitada por sorte
disciplinada. O run-input já tem o campo `workspace.worktree_path` (veio
`null`); preenchê-lo e fazer a cockpit criar/destruir a worktree fecharia o
buraco sem mudar o contrato. Alternativa mínima: o lock do item passar a
declarar a **árvore** que o run ocupa, e cockpit recusar disparo quando outra
sessão declarou a mesma.

### P25 — A cerca de performance é o único detector de uma classe real de bug, e é flaky

O smoke `ca7-measurement` (cerca de ~250ms no boot) pegou uma regressão
funcional de verdade (P26) que 1649 testes verdes não viram — prova de valor.
Mas depois da correção as medições oscilaram **168–274ms** (3/5 abaixo da
cerca) por carga de máquina: numa máquina ocupada o gate fica vermelho sem
regressão, e o hábito de "reroda que passa" corrói exatamente o detector que
acabou de pagar a conta. Vale endurecer a estatística (mediana de N execuções,
ou margem explícita) **mantendo** a cerca.

### P26 — Canal IPC com dois assinantes fazendo o mesmo trabalho não tem detector

O `App.tsx` assinava `window.donel.accounts` que o `AccountsPanel` já
assinava — trabalho dobrado no boot, ~80ms de custo, zero efeito funcional
visível. Só a cerca de performance denunciou. A classe "segundo assinante
silencioso no mesmo canal" não tem guarda: um helper de assinatura única (ou
aviso em dev quando um canal ganha o segundo listener) transformaria o
próximo caso em erro visível em vez de lentidão misteriosa.

### P27 — A pergunta do P23 agora tem endereço, mas segue sem resposta

O P23 registrou: no primeiro switch, o par que está no disco é descartado sem
aviso (guard de segurança correto, efeito colateral mudo), e "a etapa 2 é
onde a pergunta 'de quem é a credencial que está aqui?' ganha dono". A etapa
2 criou o dono — `src/main/accounts/migration/` importa credencial de perfil
direto pro cofre — mas o **aviso antes do primeiro switch** não estava nas
tasks e não foi implementado. A pergunta ao trocar de conta com credencial
desconhecida no disco continua sem ninguém fazê-la. Herdar isso para a
Validar conferir e para o backlog decidir (custo baixo: `fromId === null` +
par não-nulo já estão em mãos no ponto exato da decisão).

## Prioridade sugerida

| # | Achado | Custo | Risco se ficar |
|---|---|---|---|
| 1 | P24 worktree (ou lock de árvore) para o worker | médio | próxima corrida não termina em commits entrelaçados inofensivos |
| 2 | P18 (reiterado) validador de result por linha de comando | baixo | cada result novo confia em herança de exemplo, não em verificação |
| 3 | P25 estatística na cerca de performance | baixo | o único detector da classe P26 vira ruído e é ignorado |
| 4 | P26 guarda contra segundo assinante de canal IPC | baixo | próxima duplicação volta como lentidão sem nome |
| 5 | P27 aviso do primeiro switch (herda P23) | baixo | quem troca perde a credencial do disco sem saber que perdeu |

## Estado ao fim da sessão

- Card `wi-demolicao-perfis-migracao`: fase **Implementar concluída**
  (`success`, 1649/1649, typecheck limpo), result no outbox, próxima fase
  sugerida **Validar**. 12 commits novos na branch `esteira/contas-e-provedores`
  (10 do worker/cockpit + 2 da sessão paralela); **sem push, sem PR**.
- **Política de review mudou no meio da sessão** (`d094b5c`): repo de
  mantenedor único, **1 revisor** para qualquer risco, inclusive sensível —
  substitui o default de 2 da esteira. Validar/Concluir da etapa 2 devem usar
  essa régua.
- A **virada real da migração nunca rodou** — por design: os smokes provam o
  fluxo em árvore falsa; o `roteiro-e2e-etapa-2.md` é o passo humano pendente
  (rodar o wizard no alfa contra os perfis reais, com `~/.claude-profiles` →
  `~/.claude-profiles.old`).
- Pendências herdadas da etapa 1, ainda abertas: seções 2, 4, 5 e 6 do
  `e2e.md` (pool próprio real, auto-switch em tempo real, heartbeat de 15 min,
  máquina sem `safeStorage`); P22 (o `'io'` do `switchTo` + race do
  `sessionRefused`); `vault.write` da rotação dentro do `catch`.
