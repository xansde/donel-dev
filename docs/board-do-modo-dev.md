# Ligar a porta de entrada do Modo Dev (board do TaskDex)

A Zona 1 do Modo Dev ("Abrir discovery") lista os cards do **seu** board nas
colunas Backlog, Discovery e Plano. Cada pessoa aponta o próprio board com a
própria chave — o app não tem board embutido nem credencial compartilhada.

## O arquivo

`~/.claude/esteira-config/donel-board-credential.json` (no Windows,
`C:\Users\<você>\.claude\esteira-config\`). Fora do repo, **nunca commitado**:

```json
{
  "baseUrl": "https://taskdex.seazone.dev/api/mcp",
  "token": "<sua chave X-MCP-Key do TaskDex>",
  "workspaceId": "<id do workspace>",
  "teamId": "<id do time/board>"
}
```

- `baseUrl` + `token`: o endpoint MCP do TaskDex e a sua chave pessoal (a mesma
  que o Claude Code usa em `~/.claude.json`, se você já tem o MCP configurado).
- `workspaceId` + `teamId`: **qual** board a porta de entrada mostra. São
  opcionais — sem eles a credencial só autentica, e o board vem do
  `devMode.boardConfig` do `config.json` do app, se houver.

Descubra os ids com o MCP do TaskDex (`list_my_workspaces` devolve workspaces e
times com seus ids) ou pela URL do board.

Depois de criar o arquivo, **reinicie o app** — a credencial é lida uma vez, na
subida.

## Como o app escolhe a fonte

1. `DONEL_DEVMODE_BOARD_FIXTURE` apontando um JSON — usada pelos smokes e pelo
   roteiro de teste manual; tem precedência para que teste nenhum fale com o
   board de verdade.
2. A credencial acima — o board real, via JSON-RPC no MCP do TaskDex.
3. Nada — a porta de entrada fica vazia, sem erro. É o estado de quem não
   configurou nada.

## Limites conhecidos

- **Só leitura.** As tools acessíveis são uma lista fechada no tipo
  `BoardReadTool` (`get_task_details`, `list_tasks_by_team`); o app não tem como
  escrever no board, nem por engano.
- **Trava e etiquetas de atenção não aparecem.** Nenhuma tool de leitura do
  TaskDex expõe as labels do card hoje, então o espelho não mostra
  `esteira:em-andamento:<fase>` nem `esteira:escalado`. O que aparece é coluna
  real, título e PR — o resto fica de fora em vez de ser adivinhado.
- **PR mergeado não conta como aprovado.** `prApproved` só é verdadeiro quando o
  board diz `approved`; inferir aprovação de "merged" seria afirmar um fato que
  o board não deu.
