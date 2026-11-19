# Canal do Donel fora do PC (t-e195b35c, prazo 19/11)

Pedido do dono (18/11): "Quero dar um ajuste nele" / "espera por mim não safado. Só aplica". Itens 1, 13, 5 (parte
do app) e o campo novo do item 4 da seção 4 do relatório `~/seazone/_scratch/analise-semana-1118/relatorio.html`, e a
causa da trava de 18/11 08h13–08h45.

**Pronto quando:** derrubar o app do PC por 5 min (ou cortar o túnel) não afeta nenhuma sessão da VPS: elas registram
tarefa e mandam recado normalmente, os recados chegam com confirmação. Recados falhos < 1%, zero "a mensagem pode ter
entrado".

**Regra dura:** o lado VPS tem de funcionar com o app ATUAL do PC (o app só muda quando o dono instalar versão nova).

## O que existe hoje (lido no código, 18/11)

- VPS pessoal: `donel-oraculo` (user unit) = registro (Supabase é a fonte; o daemon é o único escritor), API 47816
  (tailnet, token do PC), **portão MCP 127.0.0.1:47817** (`src/oraculo/portao.ts`), relay `fila.json` (VPS→PC,
  com ack). Sessões preparadas depois do daemon apontam o MCP para `127.0.0.1:47817/s/<sid>/mcp`.
- O portão hoje **só repassa** ao túnel do PC (prazo 10 min) e só responde sozinho com `ECONNREFUSED`. App travado
  com túnel vivo = sessão presa (é a trava de hoje). `tarefa_*` dá a volta VPS → PC (renderer: 2 idas de até 15 s
  para saber quem chama) → VPS.
- Retrato do quadro: o PC empurra `POST /v1/retrato` a cada 30 s, **só das sessões do lugar do Oráculo** (VPS
  pessoal). Homologações não tem portão nem retrato: suas 24+ sessões vão direto ao túnel (`mcp.json` =
  `127.0.0.1:<mcpPort>/mcp`).
- Hooks de toda sessão remota: `type:http` direto ao túnel `127.0.0.1:<hookPort>/h/<Evento>`, 10 s (PreToolUse e cia),
  **86400 s** no PermissionRequest, 2 s no SessionEnd (`src/main/hooks-settings.ts:86-100`). Escritos pelo setup em
  `~/.donel/s/<sid>/settings.json`; o `claude.sh` da sessão faz `. ~/.donel/proxy-saida.env` antes de `exec claude`.
- `~/.donel/s/<sid>/meta.json` traz `sid, mcpPort, mcpToken, hookPort, hookToken, roleId, openedBy, projectName, name,
  createdAt` (sem o lugar). Arquivos dessa pasta têm segredo: **nunca leia com ferramenta**; código/script pode.
- Recado (`sessao_enviar`) só existe no renderer do PC: cola o texto no PTY da aba (paste); daí "Claude não ficou
  pronto" e "a mensagem pode ter entrado" (`board-bridge.ts:105`).
- Chave contra duplicata: `withCallKey` (`ledger-store.ts:765`) em criar/cancelar/transferir/carta/andamento, janela
  30 min (`contract.ts:652`). Sem chave: assumir, entregar, aceitar/rejeitar, frente. A resposta não devolve o
  registro relido.
- Tarefa pertence ao **lugar** (`ownerPlaceId`). Lugar que fecha passa as tarefas a `whoHears` (acima / Líder do
  quadro / Líder único) depois de 60 s (`agentBridge.ts:433-493`, `ledger-store.ts:402-426`), nunca ao lugar novo do
  mesmo papel. "dalton" é um `roleId` (papel próprio do quadro de Homologação), não apelido.
- Veredito (`tarefa_aceitar/rejeitar`) não avisa ninguém; entrega avisa só quem está acima (`urgentLedgerNotice`).

## Causa da trava de 18/11 (prova em `~/seazone/_scratch/canal-fora-do-pc/trava.md`)

107 `tarefa_frente` do Líder único (no PC), 07h49–08h27, ~1 a cada 13,6 s; CPU do PC de 26–29% para 55–86% junto.
Cada escrita no PC: `patch` manda o ledger inteiro (~12 MB) às janelas; `void service.refresh()` depois da resposta
leve (`ledger-remote.ts:409`) baixa os 8–10 MB de novo, regrava o espelho de 10 MB síncrono (`ledger-remote.ts:124`)
e manda tudo às janelas de novo; o SSE `ledger` do daemon dispara mais um refresh. 2–3 cópias inteiras por escrita,
sem freio, enquanto todo `tarefa_*`/`sessao_*` depende de 2 respostas do renderer com prazo de 15 s. O renderer
afogou → "O app não respondeu a tempo". Erros também depois da leva (08h33, 09h00) com outros picos de CPU do PC.
Não provado (sem acesso ao PC): CPU por processo e `main-events.log`.

## Desenho

### 1. Portão responde as tarefas e os recados na VPS (item 1)

- **`tarefa_*` sempre na VPS**: com retrato da sessão, o portão nunca repassa `tarefa_*` ao PC; executa
  `runLedgerTool` no registro do daemon (como já faz com o PC desligado). Sem retrato, repassa como hoje.
- **`sessao_quem_sou`/`sessao_listar`** respondidos do retrato quando o PC não responde em 3 s (não 10 min).
- **`initialize`, `tools/list`**: se o PC não responde em 3 s, o portão responde a lista local (mesmas ferramentas).
- **Repasse ao PC** (as que só ele faz: navegador, quadro_aplicar, sessao_abrir/fechar/ver_tela…): conexão em 2 s;
  sem conexão = "PC fora" (resposta local `PC_OFF`). 502 continua 502 (não repetir o que pode ter rodado lá).
- **Avisos imediatos** que o PC dava (`aviso_imediato`): o portão calcula com `urgentLedgerNotice` e entrega pelo
  recado (abaixo) a `whoHears(board, lugar)` do retrato; alvo fora desta máquina → relay `fila.json` (o PC atual
  entrega com `deliverOwnerMessage` ao voltar).
- **Satélite (Homologações)**: o mesmo bundle roda lá em modo satélite (`DONEL_PORTAO_SATELITE=<url da API pessoal>`),
  só com o portão: o retrato é montado por sonda pelo túnel quando o PC responde (`sessao_quem_sou`, `sessao_listar`,
  `quadro_ler` com `abertaPor` → setas `opened`), guardado em disco; o registro vai ao daemon da VPS pessoal por uma
  rota nova `POST /v1/portao/ferramenta` com token de portão (`<dir>/portoes/<nome>.sha256`, como os serviços), que
  roda o mesmo executor local de lá.

### 2. Recado em fila com confirmação

- Fila por máquina no portão: `<dir>/recados.json` (gravação temp → rename, como `relay.ts`). Item:
  `{id, chave, de:{lugar, nome, sid?}, para:{lugar, sid}, texto, criado, estado:'fila'|'entregue', via?, entregueEm?}`.
- `sessao_enviar` no portão: resolve o "para" (id de lugar, `lider-quadro`, `quem-me-abriu`, `lider`, **ou um
  `roleId` como "dalton"**: o lugar vivo único com esse papel no quadro); confere a seta como o app (`canSend`) **ou a
  ligação de revisão** (item 5); alvo com sessão viva nesta máquina → fila local e resposta na hora
  `{"entregue":"na-fila","id":...,"confirmacao":"..."}`. Alvo fora desta máquina → repassa ao PC; PC fora → relay.
- Entrega, sem colar em sessão ocupada:
  - **fim de turno**: hook `Stop` de usuário (`~/.claude/settings.json` da VPS, `type: command`, 2 s):
    `curl -s --max-time 2 --data-binary @- -H "X-Donel-Tmux: $(tmux display -p '#S')" http://127.0.0.1:<portão>/recados/fim-de-turno`.
    O portão devolve `{"decision":"block","reason":"<recados>"}` com tudo que espera aquela sessão e marca
    `entregue` (`via:'fim-de-turno'`); sem recado, `{}` e marca a sessão **parada**.
  - **sessão parada**: hook `UserPromptSubmit` de usuário marca **ocupada** (e confirma recado digitado: o `prompt`
    do payload contém o rótulo do recado). Recado para sessão parada → `tmux -L donel send-keys -l` + Enter só com o
    campo livre (`campo_livre` do despertador); `entregue` só quando o `UserPromptSubmit` (ou o transcript) mostrar o
    rótulo; sem confirmação em 20 s, volta para a fila (o fim de turno seguinte entrega). Nunca digita duas vezes o
    mesmo item.
- O remetente vê o estado com `sessao_enviar` respondendo o id; métrica: `recados.json` (fila/entregue/tempo).

### 3. Chave contra duplicata e registro relido

- Parâmetro opcional `chave` (até 80) em todo `tarefa_*` que grava (criar, assumir, andamento, entregar, aceitar,
  rejeitar, cancelar, transferir, frente). Com chave: `requestId = k + sha256(lugar|tool|chave)`, e a repetição com a
  mesma chave devolve `repetida: true` e o estado atual, sem gravar. Sem chave: o `withCallKey` de hoje; assumir,
  entregar, frente, aceitar e rejeitar entram no `REPEATABLE_OPS`.
- Toda resposta de escrita traz `tarefa: {id, estado, dono, ultimoEvento:{tipo, em}}` relido do registro depois de
  gravar.

### 4. "precisa-do-dono" com motivo de lista fechada (campo do item 4)

- `tarefa_andamento` ganha `motivo`, enum: `credencial-nova`, `pagamento`, `dado-do-dono`,
  `main-ou-producao-sem-pedido`, `repo-publico`. `estado: precisa-do-dono` sem `motivo` (ou fora da lista) é recusado
  na camada da ferramenta (`runLedgerTool`), com a lista no erro. Grava como hoje, com `[motivo]` à frente do
  `precisa` (formato do registro não muda). Vale no portão já; no PC, quando o dono instalar.

### 5. Dev ↔ Revisor ligados direto, veredito ao Dev (item 5, parte do app)

- **Ligação de revisão** (sem desenhar seta, sem schema novo): `sessao_enviar` vale entre quem entregou (dono ou
  `feitoPor`) uma tarefa `entregue` e um Revisor vivo de fora da cadeia dele no mesmo quadro (`liveReviewersOutside`),
  nos dois sentidos.
- Entrega para aceite → aviso aos Revisores de fora vivos (além de quem está acima). `tarefa_aceitar`/`rejeitar` →
  aviso ao dono da tarefa e ao `feitoPor` ("o Revisor X aceitou/devolveu t-…: <motivo>").

### 6. Tarefa segue a renovação; "dalton" como apelido (item 13)

- `reach.ts` ganha `successorOf(board, places, placeId)`: lugar vivo do mesmo `roleId`, aberto pelo mesmo lugar
  (`abertaPor`/seta `opened`), aberto depois; único → ele. O passa-adiante (`passOnTasks`, PC) e o portão usam antes
  de `whoHears`. No portão: chamada de um lugar P em tarefa de um lugar Q fechado cujo sucessor é P → transfere a P e
  segue (motivo "renovação").
- Endereço: `roleId` vale como "para" (sessao_enviar, tarefa_transferir) = o lugar vivo único com esse papel no
  quadro; vários vivos → erro listando os ids. Sem nome fixo no código.

### 7. Prazos das travas (item 1)

- App (instalação nova): hooks http 10 s → 2 s; PermissionRequest 86400 s → 30 s (`hooks-settings.ts`).
- VPS (já): `~/.donel/bin/claude` à frente no PATH (pelo `proxy-saida.env`, lido só pelas sessões do Donel):
  com `--settings`/`--mcp-config` de `~/.donel/s/<sid>/`, grava cópias `settings.vps.json` (10→2, 86400→30) e
  `mcp.vps.json` (URL → portão, se houver portão e a URL for o túnel) e chama o claude real com elas. Qualquer outro
  uso do `claude` passa direto.

### 8. Freio no app do PC (a trava de hoje; vale na instalação nova)

- `onChange` do ledger remoto agrupado (no máx. 1 a cada 1,5 s) e sem mandar o documento se nada mudou; sem
  `refresh()` depois de resposta leve; espelho em disco com atraso e assíncrono; quem chama resolvido sem 2 idas ao
  renderer (cache por pty, renovado a cada 30 s com o retrato).
- Daemon (já): SSE `ledger` agrupado (no máx. 1 a cada 2 s).

## Implantação e volta

- VPS pessoal: `scripts/oraculo-vps.sh atualizar` (backup do bundle anterior em `~/.donel/oraculo/bin/oraculo.mjs.antes-<hora>`;
  volta = copiar de volta e `systemctl --user restart donel-oraculo`).
- Homologações: `scripts/portao-satelite.sh instalar|voltar` (root): unidade de sistema `donel-portao`, wrapper,
  hooks de usuário; backup de `~/.claude/settings.json` e `proxy-saida.env` com hora; `voltar` restaura e para a
  unidade. Sessões já abertas passam a usar o portão ao reiniciar (renovar).

## PRs (pequenos, para staging, revisor Opus cético pela merge-direto)

1. Portão: tarefa_* sempre na VPS, prazos curtos, chave + registro relido, motivo, SSE agrupado.
2. Recados: fila, entrega no fim de turno/tela, endereço por papel, ligação de revisão, avisos (entrega, veredito).
3. App: prazos das travas, freio do ledger remoto, sucessor na renovação, endereço por papel, veredito ao Dev.
4. Satélite: rota de portão na API, modo satélite, sonda de retrato, wrapper, script de instalação.
