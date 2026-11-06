# Escopo do papel: MCPs, plugins e skills por sessão

Pedido do dono (05/11): "parte do problema é todas as sessões terem todos os MCPs, mesmo sem precisar. O mesmo vale para skills e hooks."

## Como o papel declara

O cabeçalho do arquivo do papel (`%APPDATA%\donel-dev\papeis\<id>.md`) ganha três chaves, uma lista separada por vírgula cada:

```
---
nome: Homologador
cor: discovery
mcps: github, taskdex, seazone-eks
plugins: homologacao
skills:
---
```

- `mcps`: nomes dos servidores MCP (os de `~/.claude.json`, do projeto, dos plugins e os conectores do claude.ai). O `donel` entra sempre.
- `plugins`: nome do plugin (`dev`) ou id completo (`dev@seazone-skills`). Os da lista ficam como o usuário deixou (o app nunca liga um plugin desligado); os outros são desligados.
- `skills`: as skills e comandos soltos do usuário (`~/.claude/skills`, `~/.claude/commands` e as sincronizadas do claude.ai, `anthropic-skills:<nome>`). As skills de plugin seguem o plugin, e as embutidas do CLI ficam.
- Chave ausente: aquele eixo como antes. Lista vazia (`skills:`): nenhum. `*`: tudo, e não herda a lista de fábrica.

Papéis de fábrica: Dev e Revisor `mcps: github`, `plugins: dev, esteira`, `skills:` (nenhuma). Pesquisa: `mcps: kb, nekt, google-workspace`, `plugins: esteira`, `skills:`. Líder: sem declaração (é quem roteia). Um Dev ou Revisor editado num arquivo sem essas chaves continua com o escopo de fábrica; `mcps: *` libera. Papel sem declaração nenhuma abre como antes.

## Como chega ao CLI

Tudo vai no `--settings` da sessão, o mesmo arquivo dos hooks do app (`hook-settings/<ptyId>.json`, ou `settings.json` na pasta da sessão remota). O CLI só aplica o último `--settings` da linha de comando, por isso não há um segundo arquivo.

| Eixo | Chave no `--settings` | Inventário |
|---|---|---|
| MCPs | `allowedMcpServers: [{serverName}]` | nenhum: só nomes |
| Plugins | `enabledPlugins: { id: false }` para os que não estão na lista | ids de `plugins/installed_plugins.json` e de `enabledPlugins` (settings do usuário e do projeto) |
| Skills | `skillOverrides: { nome: "off" }` para as que não estão na lista | nomes de pasta e arquivo; nenhum conteúdo lido |

Na sessão remota (VPS), o inventário é o do `~/.claude` de lá, lido por um script ssh só de leitura (`buildRemoteInventoryScript`) antes de montar a sessão. Só nomes saem de lá.

## Por que `allowedMcpServers` e não `--strict-mcp-config`

O pedido sugeria montar um `mcp.json` com o MCP do app mais os do papel e passar `--strict-mcp-config`. Funciona no CLI, mas obriga o app a copiar a definição de cada servidor de `~/.claude.json` para o arquivo da sessão, e várias têm token no cabeçalho ou no env (github, nekt, taskdex, slack, google-workspace...). Isso quebraria a regra de credenciais do CLAUDE.md. O `allowedMcpServers` tem o mesmo efeito medido e só precisa dos nomes.

## Medido com o CLI 2.1.318 (05/11)

- `--strict-mcp-config` corta também os MCPs de plugin (`plugin:geral:sia-prod`, `sia-stg`) e os conectores do claude.ai: com `--mcp-config` só do github, o `init` listou 1 servidor, contra 44 sem a flag.
- `allowedMcpServers` no `--settings`: só os nomes listados sobem, inclusive contra plugin e claude.ai. Já `deniedMcpServers` não serve, porque o conjunto de conectores do claude.ai muda (ao negar o `nekt` local, apareceu o `claude.ai Nekt App`).
- `enabledPlugins: false` desliga o plugin inteiro: skills, hooks (o `trava_sessao.py` do `geral` deixou de rodar), agentes e MCPs.
- `skillOverrides: "off"` tira a skill da lista, inclusive comandos de `~/.claude/commands` e as `anthropic-skills:*`.

## O que não dá para filtrar

- **Hooks do `~/.claude/settings.json` do usuário.** O `--settings` soma hooks, nunca tira (testado: `hooks: { SessionStart: [] }` não removeu nenhum). `disableAllHooks` derruba também os hooks do app (semáforo, chat, guarda do Slack), inclusive os entregues por `--plugin-dir`. E `--setting-sources project,local` tira a camada do usuário inteira: some também `~/.claude/skills`, os plugins e as permissões (entre elas os `deny` de push em main). Por isso o papel não tem chave `hooks`: os hooks de plugin seguem o plugin, e os do settings do usuário rodam em toda sessão. Hoje são 5: três `PreToolUse` (guardas de segurança, de worktree e de artefato, que convém manter) e dois `SessionStart` (`bw-refresh.ps1`, 17 a 26 s, e `wiki-ingest-on-session-start.ps1`, 8 a 11 s). Para torná-los filtráveis, o caminho é movê-los para um plugin local do dono, que aí entra ou sai pela chave `plugins`.
- **Plugins embutidos do CLI** (`cc-plugin-*`) e skills embutidas (`dataviz`, `code-review`...): não são do usuário e ficam.
- **Skills do projeto** (`.claude/skills` da pasta): são escolha do projeto e ficam.
- **Transporte legado de hooks** (`DONEL_HOOKS_TRANSPORT=legacy`): o arquivo é um só para todas as sessões, então o escopo não se aplica.

## Números (05/11, sessão aberta pelo app numa instância isolada, CLI real, pasta Donel Dev)

| Sessão | `/mcp` | Plugins | Processos filhos do claude.exe aos 35 s | RAM dos filhos |
|---|---|---|---|---|
| Dev | 2 (github, donel) | dev, esteira | 0 | 0 MB |
| Líder (sem declaração) | 45 | 8 | 28 | 898 MB |
| Sem papel | 45 | 8 | 13 (ainda subindo) | 560 MB |

Com `claude -p` (mesma máquina): 19 processos e 805 MB → 5 processos e 298 MB, e os 5 que sobram são os hooks `SessionStart` do usuário, que terminam. Skills listadas: 153 → 38.
