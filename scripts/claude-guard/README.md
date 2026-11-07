# claude-guard — trava de MCP por capacidade

Hook do Claude Code que barra chamada MCP pelo **que ela faz**, não por uma lista
de nomes, mais um **inventário selado** das ferramentas MCP em que a máquina
confia. Mora aqui porque os hooks de `~/.claude/hooks` não têm repo próprio; é
ferramenta de máquina, não parte do app, e `scripts/` não vai ao repo público.

## O que barra

1. **MCP fora do inventário**: servidor novo, servidor renomeado
   (`mcp__gh__…` no lugar de `mcp__github__…`) ou ferramenta nova.
2. **Descrição mudada desde o selo**: o `check` do SessionStart relista os
   servidores e compara `sha256(nome + "\n" + descrição)`. Fica barrada até o
   dono reselar.
3. **Capacidade**, deduzida do nome, da descrição selada e da entrada da chamada
   (slugs do Composio, inclusive dentro do código do workbench):

| Capacidade | Barra | Passa |
|---|---|---|
| `prod-write` | SQL que grava, migration, deploy em projeto que não está em `nonProdTargets` | SELECT em qualquer lugar; escrita no staging `fxjpnamoafzomqlncdyn` |
| `send-as-owner` | mensagem em nome do dono: Slack fora do Composio, e-mail, outros canais | Slack via Composio (o gate de carta do Donel decide); bot do Theo; mensagem entre sessões |
| `delete` | delete/remove/drop/purge…, `DROP`/`TRUNCATE` fora do staging | — |
| `push-main` | escrita em `main`/`master`, escrita sem branch (cai na padrão), merge por MCP | escrita em branch de feature; PR para `staging` |
| `repo-visibility` | `private: false`, `visibility: public` | repo privado |

Também barra o próprio agente de reselar ou editar o inventário (Bash com
`mcp-guard … seal`, Write/Edit em `~/.claude/mcp-guard/`). O `seal` no
inventário real só grava com uma pessoa num terminal digitando `SELAR`.

## Arquivos na máquina

- `~/.claude/hooks/mcp-guard.mjs` — o hook (Node, sem dependência).
- `~/.claude/mcp-guard/inventory.json` — o selo.
- `~/.claude/mcp-guard/drift.json` — o que o `check` viu mudar.
- `~/.claude/mcp-guard/policy.json` — opcional; sobrepõe o `DEFAULT_POLICY`
  (`nonProdTargets`, `letterGated`, `agentBotServers`, `sessionMcpConfigs`,
  `capOverrides`).

## Comandos

```sh
node ~/.claude/hooks/mcp-guard.mjs seal                      # lista os MCPs de ~/.claude.json e .mcp.json da pasta atual
node ~/.claude/hooks/mcp-guard.mjs seal --mcp-config <mcp.json>   # soma um --mcp-config (ex.: o do Donel)
node ~/.claude/hooks/mcp-guard.mjs seal --from <dump.json>        # servidor que não dá para listar daqui
node ~/.claude/hooks/mcp-guard.mjs check --force             # relista agora e marca o que mudou
```

`--from` recebe `[{ "server": "<nome>", "tools": [{ "name", "description" }] }]`.

## Limites conhecidos

- O hook não recebe a descrição da ferramenta (o Claude Code não a manda no
  PreToolUse); por isso a mudança de descrição só é vista no `check`, que roda
  assíncrono no SessionStart com TTL de 10 min. Entre a mudança e o próximo
  `check`, a ferramenta passa pelas regras de capacidade, não pela de descrição.
- Conectores do claude.ai (`mcp__claude_ai_*`) usam OAuth do CLI e não dá para
  listá-los daqui: entram por `--from` e o `check` não os reconfere.
- O agente em bypass ainda pode tirar o hook do `~/.claude/settings.json`; a
  trava de Bash/Write cobre o inventário, não o settings.
- Inferência por palavra erra para os dois lados; o `seal` mostra as capacidades
  de cada ferramenta antes de gravar, e `capOverrides` corrige uma ferramenta.

## Testes e medição

```sh
npx vitest run scripts/claude-guard
node scripts/claude-guard/bench.mjs --before ~/.claude/hooks/trava-perigosa.py --rounds 10 --real-mcp-config <mcp.json>
```
