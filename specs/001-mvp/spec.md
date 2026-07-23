# Spec 001 — Donel Dev MVP (P0)

**Projeto:** Donel Dev — IDE próprio com terminal embedado para o Claude Code CLI
**Status:** draft — aguardando revisão do Alexandre
**Criado:** 2026-07-22
**Autor:** Claude (Fable), sessão de planejamento com o Alexandre

## Contexto e motivação

Em 2026-07-23 o Alexandre perde a conta individual do Claude e passa a operar com
contas compartilhadas. O Claude Code desktop app deixa de ser viável nessa dinâmica;
o `claude` CLI continua funcionando normalmente. Toda a configuração local
(`~/.claude`: CLAUDE.md, skills, rules, hooks, MCPs, memória, transcripts) é da
máquina, não da conta — sobrevive à troca.

O Donel Dev é o cockpit gráfico próprio construído em volta do CLI: um app desktop
Windows com terminal embedado rodando o `claude` real, cercado por painéis de
organização (projetos, sessões anteriores, launcher de modelo/esforço/permissões,
perfis de conta). O app **não reimplementa o agente** — orquestra o CLI por fora,
então hooks, skills, MCPs e Esteira continuam funcionando sem nenhuma adaptação.

## Discovery — uso real (entrevista com o Alexandre, 2026-07-22)

Fatos trazidos por ele, na ordem em que vieram. Tudo nesta seção é **fonte
primária**; user stories e FRs derivam daqui ou são marcados como hipótese.

- **Rotina:** abre o dia pelo "chat de setup do dia" e alterna entre **~6
  sessões paralelas**.
- **O que faz o desktop app ser superior ao terminal (sentiria falta):**
  1. Conversas fixadas e organizadas por projeto — visualização fácil de onde
     trabalhar;
  2. Facilidade de **mudar modelo/esforço durante a sessão**;
  3. Acompanhamento fácil de **uso de tokens** na conversa;
  4. Acompanhamento fácil do **andamento dos subagentes**;
  5. Ver o **status de uma sessão sem estar com ela ativa**.
- **Contas:** **15 contas compartilhadas** disponíveis para migrar; já existe
  um projeto para acompanhar os limites de uso delas (integrar, não
  reinventar — identificar qual no clarify). Sessões sempre locais, com
  `/resume` quando necessário.
- **Usuários:** o Alexandre e o Claude — não é ferramenta de squad.
- **Extras pedidos:** (a) dois modos de operação, **Dev** (sessões dentro da
  "smart zone", seguindo o processo da Esteira de desenvolvimento; referência
  citada: HumanLayer) e **Uso geral**; (b) área de **post-its** para capturar
  ideias rápidas e recapitular depois; (c) acompanhamento fácil da **todo do
  projeto**.

**Clarify (mesma data):**

- **Smart zone** = a faixa de contexto em que os tokens ainda não ocuparam
  mais do que o necessário — na prática, os primeiros **~400k tokens** da
  sessão. "Funcionar dentro da smart zone" = o app monitora o contexto de cada
  sessão e ajuda a não passar do ponto (medidor + alerta + incentivo a sessão
  fresca/handoff por fase).
- **Modo Dev** = organizar o trabalho como no TaskDex hoje: task (card) com as
  fases da Esteira — **Discovery, Plano, Implementar, Validar, Concluir** —
  cada fase com sua(s) sessão(ões), status e artefatos (referência visual: tela
  de Tasks do CodeLayer/HumanLayer, screenshot compartilhado pelo Alexandre;
  o preset de fases deles — Questions, Research, Design, Structure, Plan,
  Implement — fica disponível como alternativa configurável).
- **Chat de setup do dia** = pode ser um **botão que executa uma sequência de
  skills** (rotina configurável) ao abrir a sessão.
- **Quota das 15 contas** = integrar o monitor já existente
  **https://claude-monitor.seazone.dev/**; as contas seguirão a nomenclatura
  **"Tecnologia Claude {número}"** (usar como nome default dos perfis).

## Visão do produto

Um cockpit para operar **muitas sessões Claude em paralelo sem perder o fio**:
saber de relance qual sessão precisa de atenção, quanto cada uma consumiu, o
que os subagentes estão fazendo — e, em volta disso, organização por projeto,
retomada de sessões, troca entre as 15 contas compartilhadas e captura rápida
de ideias. Terminal de primeira classe embaixo; painel de controle em cima.

## User stories

Origem de cada uma: `[E]` = entrevista de 2026-07-22 (número = item da seção
Discovery); `[H✓]` = hipótese minha confirmada pela entrevista; `[H]` =
hipótese ainda não confirmada pelo Alexandre.

**P0 — operar o dia seguinte:**

- **US-1 Organização por projeto** `[H✓ E2.1]` — Vejo meus repositórios numa
  sidebar, com sessões **fixadas** e agrupadas por projeto — visualização
  fácil de onde trabalhar.
- **US-2 Sessões paralelas** `[H✓ E1]` — Mantenho ~6 sessões simultâneas em
  abas de terminal de primeira classe (cores, setas, Ctrl+C, colar, resize,
  scrollback).
- **US-3 Semáforo de sessões** `[E2.5]` — Sem estar com a aba ativa, vejo o
  status de cada sessão (trabalhando / aguardando minha resposta / permissão
  pendente / encerrada) — é o que permite alternar entre 6 sessões sem perder
  o fio.
- **US-4 Launcher** `[H✓]` — Antes de abrir, escolho modelo, esforço, modo de
  permissão e nome da sessão.
- **US-5 Mudar modelo/esforço em sessão viva** `[E2.2]` — Com a sessão
  rodando, troco modelo/esforço por UI, sem digitar comando.
- **US-6 Retomar sessões** `[H✓ E3]` — Vejo as sessões passadas do projeto
  (nome, data, preview) e as retomo (`-r`) ou forko (`--fork-session`).
- **US-7 Perfis das 15 contas** `[H✓ E3]` — Cadastro as contas compartilhadas
  como perfis; troco num dropdown; skills/rules/CLAUDE.md/histórico idênticos
  em todas; vejo o headroom de quota de cada uma antes de escolher.

**P1 — logo depois (ordem a validar com o Alexandre):**

- **US-8 Tokens + smart zone** `[E2.3 + clarify]` — Vejo o consumo de tokens
  da sessão em curso sem pedir, como um medidor de contexto com a smart zone
  (~400k) marcada: dentro da zona / atenção / hora de handoff. Alerta quando
  uma sessão sai da zona.
- **US-9 Subagentes** `[E2.4]` — Vejo quais subagentes/tasks a sessão disparou
  e o andamento deles.
- **US-10 Post-its** `[E extra]` — Capturo uma ideia em segundos (atalho
  global), num quadro de post-its que recapitulo depois, sem interromper a
  sessão em que estou.
- **US-11 Todo do projeto** `[E extra]` — Vejo a todo do projeto selecionado
  ao lado das sessões (fonte a clarificar: todo.md do vault × TaskDex).
- **US-12 Quota das 15 contas** `[E3 + clarify]` — Painel integrado ao
  **claude-monitor.seazone.dev** (embed/link + API se existir); perfis nomeados
  "Tecnologia Claude {n}" por default.
- **US-14 Rotinas** `[E1 + clarify]` — Botões configuráveis (ex.: "Setup do
  dia") que abrem uma sessão já executando uma sequência de skills definida
  por mim.
- **US-15 Novo projeto decente** `[E 22/07, adição]` — O botão "＋ Novo
  projeto" da sidebar abre um **formulário dinâmico**: pessoal × profissional,
  nome, tema (opcional), tem todo?, tem repositório (criar × vincular)? —
  campos seguintes dependem das respostas (ex.: profissional → oferecer
  vínculo TaskDex; repositório → perguntar remoto). Ao confirmar, o app
  executa o scaffolding via a skill **`/new-project`** já existente
  (diretório + vault Obsidian + pointer L1 + TaskDex opcional) numa sessão —
  o formulário coleta, a skill executa.

**P2 — modo Dev:**

- **US-13 Modos Dev / Uso geral** `[E extra + clarify]` — No modo Dev, a
  navegação vira **task (card) → fases da Esteira** (Discovery, Plano,
  Implementar, Validar, Concluir — default; preset HumanLayer configurável),
  cada fase com sua(s) sessão(ões), status do semáforo, medidor de smart zone
  e artefatos produzidos (referência de UI: tela de Tasks do CodeLayer).
  Incentivo ativo a **uma sessão fresca por fase** (handoff em vez de arrastar
  contexto). No modo Uso geral, sessão livre como hoje.
  *Decisão proposta:* fases default = Esteira, por já ser o processo do squad
  (cards TaskDex + skills `/esteira-*`); o preset HumanLayer fica como
  configuração alternativa para experimentar.
- **US-16 Donel, o buddy** `[E 22/07, adição]` — O app carrega a identidade do
  **Donel** (Jobu Donel), personagem de RPG do Alexandre — o buddy/companheiro
  com humor e falas próprias com quem ele jogava conversando. No app: a área
  de **post-its é uma conversa com o Donel** — eu conto, ele guarda a memória
  e devolve depois. Explicitamente **não prioritário**; entra no design system
  desde já (mascote, tom de voz, onde aparece e onde NÃO aparece) para a
  identidade nascer junto. **Persona em definição — papo de personagem
  pendente com o Alexandre.**

## Requisitos funcionais

Cada FR é testável isoladamente.

- **FR-001 Scan de projetos.** O app varre roots configuráveis (default:
  `~/seazone` e `~/pessoal`), até 2 níveis, listando diretórios que contenham
  `.git/` ou `CLAUDE.md`. Favoritos são persistidos no config e aparecem no topo.
- **FR-002 Abrir sessão.** Abrir projeto = spawn de um PTY (ConPTY) com
  `cwd = <projeto>`, executando o comando montado pelo launcher, com
  `CLAUDE_CONFIG_DIR` do perfil ativo injetado no ambiente (omitido no perfil
  principal).
- **FR-003 Launcher → flags.** O launcher gera exatamente estas flags:

  | Controle | Flag |
  |---|---|
  | Modelo | `--model <alias>` |
  | Esforço | `--effort <low\|medium\|high\|xhigh\|max>` |
  | Permissões | `--permission-mode <manual\|acceptEdits\|auto\|plan\|dontAsk\|bypassPermissions>` |
  | Nome da sessão | `-n "<nome>"` |
  | Retomar | `-r <session-id>` |
  | Fork | `-r <session-id> --fork-session` |
  | Continuar última | `-c` |

  Controle não preenchido = flag omitida (o CLI usa o default do usuário).
- **FR-004 Índice de sessões.** Para o projeto selecionado, o app lê
  `~/.claude/projects/<slug>/*.jsonl` (slug = path absoluto com **todo
  caractere não-alfanumérico trocado por `-`** — confirmado contra diretórios
  reais, ex.: `.no-mistakes` → `-no-mistakes`; travar com fixtures no T009).
  Exibe: session id (nome do arquivo), data (mtime), tamanho e preview lido por
  streaming — nunca o arquivo inteiro. **Regras do preview** (o formato real
  contém registros de controle antes da conversa): pular linhas cujo `type` não
  seja `user`; dentro das `user`, pular `isMeta: true` e payloads de
  slash-command (conteúdo com tags `<command-*>` ou `<local-command-*>`);
  preview = primeira mensagem de usuário genuína, com fallback "(sem mensagem
  de usuário)" . Ações: retomar e forkar, cada uma abrindo nova aba.
- **FR-005 Perfis de conta.** Criar perfil `<nome>` = criar
  `~/.claude-profiles/<slug>/` contendo: junctions (`mklink /J`) para
  `projects`, `skills`, `commands`, `rules`, `plugins` e `templates` de
  `~/.claude`; cópia inicial de `settings.json` e `CLAUDE.md`. O perfil
  "principal" é o próprio `~/.claude` (sem override de env). Trocar de perfil
  afeta apenas sessões novas; as abas abertas mantêm a conta com que nasceram.
  O app inclui um "profile doctor" que verifica e recria junctions quebradas.
  **Atenção:** a identidade da conta não vive só em `.credentials.json` — o
  arquivo `~/.claude.json` (irmão de `~/.claude/`, fora da árvore de junctions)
  guarda `oauthAccount`, `mcpServers` globais e projetos confiados. O Spike
  T001 verifica se `CLAUDE_CONFIG_DIR` também o redireciona e define o
  tratamento por perfil (nunca junction — identidade deve ser isolada; questão
  aberta: como manter `mcpServers` sincronizados entre perfis).
- **FR-006 Ciclo de vida de abas.** Fechar aba mata o PTY; se a sessão estiver
  ativa (processo vivo), pede confirmação. Quando o processo `claude` termina
  sozinho, a aba mostra "sessão encerrada" com ações reabrir/fechar.
- **FR-007 Config do app.** Persistido em `%APPDATA%\DonelDev\config.json`:
  roots de scan, favoritos, perfil ativo, defaults do launcher, tema. Escrita
  atômica (temp + rename).
- **FR-008 Terminal livre.** Além de abas de sessão Claude, o usuário pode abrir
  uma aba de terminal comum (PowerShell) no diretório do projeto.
- **FR-009 Statusbar.** Perfil ativo, modelo/esforço da aba em foco, contagem de
  sessões abertas.
- **FR-010 Semáforo de sessões (US-3).** Cada aba exibe, na lista de abas e sem
  estar em foco, um de 5 estados: **trabalhando** (Claude gerando/executando),
  **aguardando resposta** (turno terminou), **permissão pendente** (aprovação
  travando a sessão), **falha/quota esgotada** (sessão morreu por erro ou
  quota da conta estourada — detecção por exit code ≠ 0 ou padrão de erro do
  CLI; distinta de "encerrada"; ação inline "trocar de conta e retomar") e
  **encerrada**. Ordenação da lista: o estado do semáforo sempre vence
  (permissão pendente > falha/quota > aguardando resposta > trabalhando >
  encerrada); pin (US-1) só desempata dentro do mesmo estado. Entre 2+ sessões
  com permissão pendente simultaneamente, a mais antiga aparece primeiro, com
  contador de tempo visível em cada uma. Mecanismo candidato (validar em
  spike): hooks do Claude Code (`Stop`, `Notification`) registrados pelo app
  apontando para um endpoint local, com fallback heurístico por output do
  PTY/título do terminal. Opcional: notificação do Windows quando uma sessão
  em background passa a aguardar o usuário.
- **FR-011 Modelo/esforço em sessão viva (US-5).** Controle na UI que injeta o
  comando correspondente no PTY da sessão (`/model <alias>`; equivalente de
  esforço a confirmar na implementação). O app só injeta quando o prompt está
  ocioso (nunca no meio de digitação do usuário); se não houver comando nativo
  para o ajuste, a UI degrada oferecendo reiniciar a sessão com a flag.
- **FR-012 Headroom por perfil (US-7).** O dropdown de perfis mostra o % de
  quota restante de cada conta (leitura sob demanda via `quota-axi` executado
  com o `CLAUDE_CONFIG_DIR` do perfil; "—" quando indisponível). As leituras
  dos 15 perfis rodam em paralelo, com timeout de 3s por perfil e cache de
  60s; "—" aparece apenas no perfil que falhar ou estourar o timeout — o
  dropdown nunca bloqueia esperando as 15 respostas. Painel completo de quota
  das 15 contas é P1 (US-12), integrado ao projeto já existente.
- **FR-013 Atalhos de troca de sessão (US-3).** `Ctrl+1`..`Ctrl+9` focam a
  sessão na posição N da lista priorizada (ranking do FR-010); `Ctrl+Tab`
  foca a próxima sessão que precisa de atenção (permissão pendente >
  aguardando resposta). Atalhos fixos nesta versão — atalhos configuráveis
  continuam P2.

## Critérios de aceitação (cenários-chave)

- **CA-1** Dado o launcher com modelo=`sonnet`, esforço=`high`, permissões=
  `acceptEdits`, nome=`radar`, quando clico Iniciar no projeto `spotsys`, então
  uma aba abre executando exatamente
  `claude --model sonnet --effort high --permission-mode acceptEdits -n "radar"`
  com cwd `C:\Users\xansd\seazone\spotsys`.
- **CA-2** Dado um projeto com 3 transcripts em `~/.claude/projects/<slug>/`,
  quando o seleciono na sidebar, então as 3 sessões aparecem ordenadas por data
  com preview, e "retomar" abre aba com `claude -r <id>` que restaura a conversa.
- **CA-3** Dado dois perfis (A ativo, B cadastrado), quando troco para B e abro
  sessão nova, então a nova sessão autentica como B e a aba antiga (A) continua
  intacta; skills e CLAUDE.md aparecem idênticos nas duas.
- **CA-4** Dado que digito Ctrl+C num processo em execução dentro da aba, então o
  processo recebe o sinal e o `claude` se comporta como num Windows Terminal.
- **CA-5** Dado que o `claude` não está no PATH, quando abro o app, então recebo
  um aviso claro com o caminho esperado (`~/.local/bin/claude.exe`) em vez de uma
  aba quebrada.
- **CA-6** Dadas 3 sessões abertas (uma gerando resposta, uma com pedido de
  permissão pendente, uma com turno concluído) e a quarta aba em foco, então a
  lista de sessões mostra simultaneamente os 3 estados corretos sem que eu
  foque nenhuma delas, e a que aguarda permissão se destaca acima das demais.
  Dadas 2 sessões com permissão pendente simultaneamente (uma pedida há 1min,
  outra há 6min), então a mais antiga (há 6min) aparece acima da mais recente,
  cada uma com seu contador de tempo visível.

## Edge cases

- Perfil recém-criado sem login: a primeira sessão do perfil cai no fluxo oficial
  de `/login` dentro do próprio terminal. **O app nunca toca, armazena ou exibe
  credenciais** — autenticação acontece exclusivamente dentro do CLI.
- Transcript corrompido/truncado: entra na lista com preview "(ilegível)", nunca
  derruba o índice.
- Junction quebrada (ex.: antivírus/limpeza): profile doctor detecta e oferece
  recriar.
- `~/.claude-profiles` fica no home local — nunca dentro do OneDrive (sync
  quebraria junctions).
- Projeto favorito removido do disco: aparece esmaecido com ação de remover.

## Fora de escopo do P0

- **P1** (ordem a validar): tokens + smart zone (US-8), subagentes (US-9),
  post-its (US-10), todo do projeto (US-11), quota via claude-monitor (US-12),
  rotinas/"setup do dia" (US-14); toggles de MCP por sessão
  (`--mcp-config`/`--strict-mcp-config`), painel de skills, busca full-text em
  sessões antigas, temas.
- **P2:** modo Dev com fases da Esteira (US-13, já clarificada); viewer de
  transcript com markdown, split de terminais, templates de prompt, git status
  na sidebar, atalhos configuráveis, worktrees (`-w`) no launcher.

## Requisitos não-funcionais

- Windows 11 primeiro (a máquina-alvo); nada deve impedir port futuro.
- Startup < 3 s; < 400 MB de RAM com 3 abas abertas.
- Sem telemetria; nenhum dado sai da máquina.
- LGPD: o app exibe conteúdo de transcripts locais apenas ao usuário; nenhum log
  do app persiste conteúdo de conversas.
- Idioma da UI: pt-BR. Código e identificadores em inglês.
