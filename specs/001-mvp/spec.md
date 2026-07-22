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

## Visão do produto

Uma janela única onde o Alexandre:

1. Vê seus projetos (`~/seazone`, `~/pessoal`) numa sidebar e abre uma sessão do
   Claude em qualquer um com um clique.
2. Mantém várias sessões simultâneas em abas de terminal de primeira classe.
3. Configura cada sessão antes de abrir: modelo, esforço, modo de permissão, nome.
4. Encontra e retoma sessões anteriores de cada projeto (ou forka).
5. Troca de conta compartilhada num dropdown, sem re-login e sem perder o setup.

## User stories (P0)

- **US-1 Projetos** — Como usuário, vejo meus repositórios de `~/seazone` e
  `~/pessoal` numa sidebar (com favoritos) e abro uma sessão `claude` em qualquer
  um com um clique.
- **US-2 Terminal em abas** — Como usuário, mantenho várias sessões em abas; a
  interação é idêntica a um terminal de verdade (cores, cursor, setas, Ctrl+C,
  colar, resize, scrollback).
- **US-3 Launcher** — Como usuário, antes de abrir uma sessão escolho modelo
  (`fable`/`opus`/`sonnet`/`haiku`), esforço (`low`→`max`), modo de permissão e um
  nome de exibição para a sessão.
- **US-4 Sessões anteriores** — Como usuário, vejo as sessões passadas do projeto
  selecionado (nome, data, preview da primeira mensagem) e as retomo (`-r <id>`)
  ou forko (`--fork-session`).
- **US-5 Perfis de conta** — Como usuário, cadastro N contas compartilhadas como
  perfis; troco de perfil num dropdown; novas sessões usam a conta ativa; skills,
  rules, CLAUDE.md e histórico são os mesmos em todos os perfis.
- **US-6 Status** — Como usuário, vejo na statusbar o perfil ativo, o
  modelo/esforço da aba em foco e quantas sessões estão abertas.

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
  `~/.claude/projects/<slug>/*.jsonl` (slug = path absoluto com separadores e
  `:` trocados por `-`; o mapeamento exato é validado na implementação contra
  diretórios reais). Exibe: session id (nome do arquivo), data (mtime), tamanho
  e preview (primeira mensagem de usuário, lida por streaming — nunca o arquivo
  inteiro). Ações: retomar e forkar, cada uma abrindo nova aba.
- **FR-005 Perfis de conta.** Criar perfil `<nome>` = criar
  `~/.claude-profiles/<slug>/` contendo: junctions (`mklink /J`) para
  `projects`, `skills`, `commands`, `rules`, `plugins` e `templates` de
  `~/.claude`; cópia inicial de `settings.json` e `CLAUDE.md`. O perfil
  "principal" é o próprio `~/.claude` (sem override de env). Trocar de perfil
  afeta apenas sessões novas; as abas abertas mantêm a conta com que nasceram.
  O app inclui um "profile doctor" que verifica e recria junctions quebradas.
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

- **P1:** toggles de MCP por sessão (`--mcp-config`/`--strict-mcp-config`),
  painel de skills (ativar/desativar), busca full-text em sessões antigas, quota
  por perfil (integração `quota-axi`), temas/personalização visual.
- **P2:** viewer de transcript com markdown renderizado, split de terminais,
  templates de prompt, git status na sidebar, atalhos configuráveis, suporte
  a worktrees (`-w`) no launcher.

## Requisitos não-funcionais

- Windows 11 primeiro (a máquina-alvo); nada deve impedir port futuro.
- Startup < 3 s; < 400 MB de RAM com 3 abas abertas.
- Sem telemetria; nenhum dado sai da máquina.
- LGPD: o app exibe conteúdo de transcripts locais apenas ao usuário; nenhum log
  do app persiste conteúdo de conversas.
- Idioma da UI: pt-BR. Código e identificadores em inglês.
