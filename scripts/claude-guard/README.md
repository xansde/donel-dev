# claude-guard — trava de MCP por regra, com inventário selado

Hook do Claude Code que só deixa uma chamada MCP rodar quando ela é **reconhecida
como segura**. Ferramenta fora do **inventário selado** ou com descrição mudada
fica barrada. Mora aqui porque os hooks de `~/.claude/hooks` não têm repo
próprio; é ferramenta de máquina, não parte do app, e `scripts/` não vai ao
repo público.

## Como decide

1. **Sem inventário**, ou com arquivos que o usuário do Claude pode gravar
   (modo sistema, POSIX), nada de MCP roda.
2. **Fora do inventário** (servidor novo, renomeado, ferramenta nova): barra.
3. **Descrição ou config mudada** desde o selo, vistas pela reconferência
   periódica: barra até reselar. O selo guarda também o hash da config de cada
   servidor (comando e argumentos, ou URL sem a porta de loopback). Outro
   servidor com o nome de um selado não herda a regra: o servidor inteiro fica
   barrado. A reconferência olha todos os projetos do `~/.claude.json`, qualquer
   que seja a pasta dela, e `status` diz o que ela não conseguiu reconferir.
4. **A regra da ferramenta**, fixada no selo pelo nome e pela descrição. É uma
   lista de permitidos: o que não se reconhece com certeza fica `blocked`.

| Regra | Quando o selo dá | Passa só se |
|---|---|---|
| `trusted` | servidor em `trustedServers` (donel, bot do Theo) | sempre |
| `read` | verbo de leitura (get, list, fetch, search…) e nenhuma ação de risco no nome | sempre |
| `write` | verbo de escrita comum (create, add, update, comment…) sem ação nem objeto de risco, por palavra e por raiz (`sharing`, `deployment`, `archived`) | nenhum parâmetro muda o efeito (público, `type: anyone`, lixeira/arquivar/`TRASH`, produção, `force`, convidado ou destinatário fora de `ownerDomains`), `project_id` só do staging, fora de `protectedRepos` |
| `slack-send` | envio/upload ao Slack | o servidor está em `letterGated.slack` (Composio, onde a carta do Donel decide) |
| `git-write` | push/commit/escrita de arquivo num repo | `branch` presente e fora de `protectedBranches` (main, master, staging), nenhuma outra chave de branch (`ref`, `base`…), repo fora de `protectedRepos` (`xansde/donel`) |
| `repo-create` | criar repositório | `private === true` |
| `sql`, `target-op` | SQL, migration, deploy | `project_id` está em `nonProdTargets` e nenhuma outra chave de alvo aponta para outro lugar. **Todo SQL fora do staging é barrado, leitura inclusive.** |
| `dispatch` | `COMPOSIO_MULTI_EXECUTE_TOOL` e afins | cada `tool_slug` está na **lista explícita** (`DEFAULT_SLUG_RULES`, só leituras e o envio ao Slack com carta, ou `slugRules` do dono) e passa pela regra dela. Slug nunca é liberado por inferência |
| `code` | workbench, bash remoto, execute/run | nunca: código não se julga antes de rodar |
| `blocked` | apagar, lixeira, merge, force, referência, segredo, permissão… ou não reconhecido | nunca (o dono pode reclassificar em `toolRules`) |

## Por que o agente não desliga nem resela

Não é por regex. No **modo sistema** (`--system`):

- Script, wrapper, inventário, policy e drift ficam em `/etc/claude-code/mcp-guard`,
  de **dono root, só leitura** para o usuário do Claude. O hook confere isso a
  cada chamada e barra tudo se algum arquivo estiver gravável por ele.
- O hook entra pelo **managed settings** (`/etc/claude-code/managed-settings.json`),
  que o usuário não edita e que o `settings.json` dele não remove.
- `hook.sh` roda o node com ambiente limpo (`env -i`): `MCP_GUARD_DIR` e
  `NODE_OPTIONS` do agente não chegam. Crash, node ausente ou saída vazia viram
  bloqueio.
- Selar exige root (`seal --system` recusa sem uid 0). A reconferência das
  descrições é um timer systemd **do root**, que lista os servidores com o uid
  do usuário (servidor nunca roda como root) e grava o drift só-root.

Isso **só vale se o usuário do Claude não vira root**: sem `sudo` sem senha e
fora dos grupos `docker`/`lxd`/`libvirt`/`disk`. O `install-linux.sh` avisa.

Prova reproduzível em contêiner (instala, sela e tenta as burlas da revisão
como usuário comum):

```sh
docker run --rm -v "$PWD/scripts/claude-guard:/src:ro" node:22-bookworm-slim sh /src/system/prova-sandbox.sh
```

## Instalar (Linux, uma vez, pelo dono)

```sh
sudo sh scripts/claude-guard/system/install-linux.sh <usuário que roda o Claude>
sudo node /etc/claude-code/mcp-guard/mcp-guard.mjs seal --system --user <usuário>   # confere e digita SELAR
```

`seal`/`check` acham os servidores em `~/.claude.json`, no `.mcp.json` da pasta
atual e nos `mcp.json` de sessão do Donel (`sessionMcpGlobs`, últimas 24 h).
`--mcp-config <arq>` soma um; `--from <dump.json>` importa o que não dá para
listar (conectores do claude.ai). `list` imprime o dump.

## Windows (plano; não testado)

- Pasta `C:\Program Files\ClaudeCode\mcp-guard`, managed settings em
  `C:\Program Files\ClaudeCode\managed-settings.json`, ambos só-admin. O UAC
  separa o usuário comum do admin.
- A listagem roda o `.cmd` pelo `cmd.exe` com cada argumento escapado (sem
  `shell: true`), expande `%VAR%` e acha o `mcp.json` das sessões locais do Donel
  em `%APPDATA%\donel-dev\browser-mcp\`.
- Selar em dois passos, para nenhum servidor rodar elevado: `list > dump.json`
  como usuário, depois `seal --system --from dump.json` num PowerShell admin,
  conferindo o diff. A reconferência de descrição não tem dono admin no
  Windows (rodar como SYSTEM exigiria lançar processo como o usuário). Fica
  pendente e é o maior furo no PC.
- O matcher é só `mcp__.*`: a ferramenta PowerShell não entra, porque a
  proteção não depende mais de olhar comandos.
- O `pretooluse-safety-check.ps1` do PC não está neste repo. A sessão do PC traz
  o arquivo para `scripts/claude-guard/windows/` num PR, antes de tirar dele a
  lista de MCP por nome.

## Limite estrutural: o agente pode falar direto com o servidor MCP

A trava é um hook do Claude Code: ela só vê o que passa pelo canal de ferramentas.
O usuário que roda o Claude também **lê** a config dos MCPs (`~/.claude.json`, os
`mcp.json` das sessões do Donel), com o comando, a URL e os tokens. Com isso ele
pode subir o servidor stdio sozinho, ou fazer `curl` na URL, e mandar
`tools/call` sem passar pelo Claude. O próprio `list` desta trava, rodado por
ele, faz isso. Vale o mesmo para o `gh` e qualquer token no ambiente do Bash.

O que a trava segura: erro do agente e prompt injection pelo canal de
ferramenta (MCP novo, renomeado, com descrição trocada, ou ação de risco). O que
ela **não** segura: um agente decidido a contornar, com acesso às credenciais.

### Proposta: credenciais dos MCPs fora do alcance do agente (decisão do dono)

1. **Um usuário de sistema `mcp`**, com home `0700`, guarda as credenciais e roda
   os servidores MCP (Composio, GitHub, Supabase). Os tokens saem do
   `~/.claude.json` do agente.
2. **Um gateway local, como serviço do `mcp`**, expõe cada servidor num socket
   em `/run/mcp-gateway/`, que o usuário do Claude só alcança pelo grupo. O
   gateway roda a **mesma decisão desta trava** (`decide()`) em cada
   `tools/call` antes de repassar. Assim a regra vale para qualquer cliente:
   Claude, `curl` ou script.
3. **A config do agente aponta só para o gateway**, sem token. O hook continua
   como segunda camada, e é o único lugar que vê a descrição ao vivo.
4. **`gh` e git**: o agente fica com um token fine-grained só dos repos de
   trabalho (sem admin, sem `xansde/donel`). Credencial de banco de produção
   nunca entra no ambiente dele.
5. **Pré-requisito**: o mesmo desta trava. O usuário do Claude não pode virar
   root: sem `sudo` sem senha e fora de `docker`/`lxd`/`libvirt`/`disk`. Senão
   ele lê os arquivos do `mcp`.

O donel não entra no gateway: o token dele é por sessão e o próprio app decide
hierarquia e carta.

## Limites conhecidos

- O PreToolUse não traz a descrição da ferramenta. Por isso a mudança de
  descrição só aparece na reconferência, que roda a cada 10 min.
- Conectores `claude_ai_*` entram por `--from` e não são reconferidos.
- Timeout do hook é erro não-bloqueante do Claude Code: a chamada passa. O
  timeout configurado é 15 s, para uma decisão de ~35 ms.
- Na VPS Homologações o Claude roda como root: lá a trava vale para MCP novo e
  para as regras, mas não segura um agente decidido a desligá-la.

## Testes e medição

```sh
npx vitest run scripts/claude-guard
node scripts/claude-guard/bench.mjs --before ~/.claude/hooks/trava-perigosa.py --v1 <mcp-guard v1> --rounds 10
```
