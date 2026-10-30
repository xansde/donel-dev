# Pesquisa de mercado — o que outras ferramentas de agente têm (30/10/2026)

Levantamento feito para a rodada autônoma de 30/10, a pedido do dono ("não se limite às minhas
ideias, tem muita coisa legal rodando"). Fontes oficiais quando possível; "secundária" quando não.
Serve de insumo para o `specs/backlog.md` — nada aqui é decisão.

## Ferramentas olhadas

| Ferramenta | Destaques | Fonte |
|---|---|---|
| Claude Code Desktop | worktree por sessão; painel de diff com comentário por linha; status de CI dos PRs com auto-fix; painel de navegador que sobe o dev server (`.claude/launch.json`); notifica quando outra sessão termina | [docs](https://code.claude.com/docs/en/desktop) |
| Claude Code CLI | Agent View (`claude agents`: quem espera você, responder inline); Remote Control (`/rc`, celular); `/rewind`; JSON da statusline (`rate_limits`, `cost`, `context_window`, `pr`, `worktree`); `--chrome` | [agent view](https://claude.com/blog/agent-view-in-claude-code), [remote](https://code.claude.com/docs/en/remote-control), [statusline](https://code.claude.com/docs/en/statusline), [chrome](https://code.claude.com/docs/en/chrome) |
| Conductor (só macOS) | workspace isolado por tarefa; diff com comentários e revert por arquivo; aba Checks (CI, reviews, deploys) que segura o merge; "Create PR" com descrição; app iOS e controle remoto | [changelog](https://www.conductor.build/changelog), [checks](https://www.conductor.build/docs/reference/checks) |
| Nimbalyst (ex-Crystal, roda no Windows) | kanban com uma sessão por card; aceitar/rejeitar diff por bloco | [secundária](https://www.implicator.ai/nimbalyst-claude-code-codex-mac-windows-linux/) |
| opcode (ex-Claudia) | timeline de checkpoints com fork; analytics de custo/tokens; gerenciador de MCP | [repo](https://github.com/winfunc/opcode) |
| Superset (sem Windows) | scripts de setup/run por projeto; navegador com portas detectadas; badge e som quando o agente precisa de você; abrir no editor | [repo](https://github.com/superset-sh/superset) |
| Warp | abas com branch/worktree/PR; central de notificações de agentes de CLI; comentário de review vai para a sessão; voz | [blog](https://www.warp.dev/blog/universal-agent-support-level-up-coding-agent-warp) |
| Cursor | controle remoto pelo iOS; gatilhos de PR/CI/cron; navegador integrado (secundária) | [changelog](https://cursor.com/changelog) |
| Zed | roda o `claude` como "thread de terminal" com título vivo — adotado porque o Agent SDK passou a gastar créditos à parte nos planos (confirma a escolha PTY do Donel) | [blog](https://zed.dev/blog/terminal-threads) |
| VS Code | Agent Sessions juntando Copilot, Claude e Codex; sessão em worktree; PR a partir da sessão | [changelog](https://github.blog/changelog/2026-10-01-github-copilot-in-vs-code-september-2026-releases) |
| Google Antigravity | subagente de navegador em perfil isolado; screenshots como artefatos comentáveis | [docs](https://antigravity.google/docs/ide/browser) |
| vibe-kanban (em desativação), Sculptor, Claude Squad, cmux, Emdash, Kiro, GitHub Agent HQ | navegador com devtools; container por agente; worktree por sessão; painel de não-lidas; issue vira workspace; hooks em JSON | ver links no relato da pesquisa |

Conductor, Superset e cmux são só macOS: ser bom no Windows já é diferencial.

## Candidatas para o Donel Dev

Legenda: P/M/G = tamanho · Exec = só execução · Decisão = precisa do dono.

| # | Funcionalidade | Quem faz | Tam. | Tipo | Status em 30/10 |
|---|---|---|---|---|---|
| 1 | Caixa de atenção "quem está me esperando", com atalho para a próxima | Agent View, cmux, Warp | M | Decisão (onde mora) | proposta |
| 2 | Notificações de terminou/erro/limite + badge na barra de tarefas | Claude Desktop, Superset | P | Exec | em execução |
| 3 | Ponte da statusline do CLI (cota 5h/7d, contexto, PR, worktree oficiais por sessão) | Claude Code | P–M | Exec | em execução |
| 4 | Analytics de uso por projeto/modelo | opcode | M | Decisão (o que medir) | proposta |
| 5 | Painel de PRs e checks por projeto/sessão (B3) | Claude Desktop, Conductor | M | Decisão | decidido (sidebar, por projeto); em PR |
| 6 | "Consertar CI/comentários" com um botão (depende do 5) | Claude Desktop, Conductor | M | Decisão | junto do 5; em PR |
| 7 | "Criar PR" com descrição escrita pelo agente | Conductor, VS Code | P | Exec | fila |
| 8 | Sessão a partir de uma issue | Emdash, Superset | M | Decisão (fronteira com a Esteira) | proposta |
| 9 | Painel "Alterações" com comentário por linha que volta para a sessão | Claude Desktop, Conductor, Warp | G | Exec no núcleo | proposta |
| 10 | "Isolar em worktree" no Launcher | Claude Desktop, Conductor | M | Decisão (pasta, convívio com a Esteira) | proposta |
| 11 | Scripts de setup/run por projeto (`.claude/launch.json`) | Superset, Claude Desktop | M | Decisão | proposta |
| 12 | Painel de navegador para preview (localhost) | Claude Desktop, Superset, Antigravity | G | Decisão (o agente controla?) | proposta |
| 13 | Toggle "Navegador (Chrome/Edge)" no Launcher (`--chrome`) | Claude Code | P | Exec | em execução |
| 14 | Remote Control em um clique | Claude Code, Conductor, Cursor | P | Decisão + spike (troca de conta) | proposta |
| 15 | Timeline de checkpoints / botão Rewind | opcode, CLI | P–G | Decisão | proposta |
| 16 | Voz no composer | Warp, Cursor | M | Decisão | proposta |
| 17 | Mandar seleção/arquivo como contexto para a sessão ativa | Warp | P | Exec | fila |
| 18 | Branch e "abrir no editor" na sidebar | cmux, Superset | P | Exec | em execução |

## Top 5 recomendado

1. Ponte da statusline (3) — base de quase tudo.
2. Caixa de atenção + notificações completas (1 e 2) — a dor de várias sessões em vários repos.
3. Painel de PRs e checks (5) — a leitura por `gh` já existe e é segura.
4. Painel "Alterações" com comentários (9) — todas as ferramentas sérias têm.
5. Navegador: primeiro o `--chrome` (13), depois o painel (12) se o dono quiser.
