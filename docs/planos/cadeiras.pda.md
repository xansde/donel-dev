---
demanda: cadeiras
titulo: Cadeiras no Donel Dev — o Mindscape de cadeiras e a tela de cadeira
cliente: Alexandre Lentz (dono e usuário diário do Donel Dev)
responsavel: Claude (lugar Dev "Cadeiras: protótipo final e plano"), aberto pelo Líder único
canal-slack: "não existe — ferramenta pessoal, sem Slack (memória donel-dev-sem-taskdex-sem-slack)"
taskdex: []  # ferramenta pessoal, sem card; a tarefa vive no Oráculo (t-678f3cb3)
origem: porta B — escolha do dono entre os protótipos de cadeiras em 06/11 ("A: … Prefiro a facilidade de leitura da A3, com o layout da A1 / B: … B1: Coluna lateral de custo deve ser colapsavel. Mas é disparado o melhor") + resposta do Líder a "Teremos claude.md para cada rig?" (06/11)
criado: 2026-11-06
status: rascunho
---

# PDA — Cadeiras no Donel Dev

## Destino

O Alexandre usa no alfa um Mindscape que mostra **cadeiras** (não agentes) — rig e pod escritos em
texto, quem sentou dentro da cadeira, seu desenho livre por cima — e uma **tela de cadeira** onde
define instruções (com folhas de rig e de pod), skills, MCPs, plugins, modelo, hooks, travas e ciclo
de vida com a herança Rig → Pod → Cadeira à vista. Os quadros atuais viram cadeiras sem perder
conversa, histórico nem tarefa do Oráculo.

## Notas

- **Forma decidida (06/11):** protótipo final fora do repositório, em
  `%USERPROFILE%\Donel Dev Alfa - diario\prototipos-cadeiras\` (`final-mindscape.html`,
  `final-cadeira.html`, `decisao.md`, prints em `_prints/final-*.png`). Mindscape = layout da A1
  (planta por pod, canvas livre) + leitura da A3 (faixa de cadeiras por estado, nome grande, saúde
  escrita, "onde parou", configurado → observado, gaveta na ordem do inspetor). Tela de cadeira =
  B1 com a coluna de custo recolhível e lembrada. Árvore fixa e inspetor fixo da A3 ficaram fora.
- **Fundo conceitual:** dossiê do treinamento do Bill
  (`%USERPROFILE%\Donel Dev Alfa - diario\estudo-treinamento-bill\estudo-treinamento-bill.md`),
  seções i), j), l) e perguntas 17–22. Lema: "Os agentes mudam. As cadeiras ficam." Frase do dono:
  "Rig é um time de pods, que é um squad de cadeiras."
- **O que já existe (levantado em `origin/staging` af929de, 06/11):**
  - Lugar = `SessionPlaceCard` (`src/shared/mindscape/model.ts:52-62`): `sessionId`, `previous[]`,
    `roleId`, posição. Liga à conversa, não ao PTY. Renovar/`/clear`/fork/retomar mudam a conversa,
    nunca o lugar (`appendConversation`, `placeOne`). É o embrião da cadeira, mas quase não reaproveita
    (`previous[]` com conversa anterior: 0 de 50 no Donel Dev em 05/11).
  - `mindscape.json` em `MINDSCAPE_SCHEMA_VERSION = 5`; campo novo sobe a versão (canal antigo fica
    só leitura). Desenho do dono: pencil, line, rect, ellipse, image. **Não existe moldura tipada**;
    rig e pod hoje são retângulos que só o texto do dono distingue.
  - Papel = `SessionRole` (`src/shared/roles.ts:33-49`), arquivo `<userData>/papeis/<id>.md`;
    orientação entregue por `--append-system-prompt-file` em todo spawn. Modelo/esforço/permissão são
    só **sugeridos** (aplicados no Launcher, trocáveis sem rastro).
  - **PR #250 (mergeado 05/11):** `RoleScope` por papel (`mcps`, `plugins`, `skills`) →
    `buildRoleScopeSettings` (`src/shared/role-scope.ts`) gera `allowedMcpServers`, `enabledPlugins`,
    `skillOverrides`; `donel` fica sempre; inventário em `src/main/role-scope-inventory.ts`; editor em
    `RolesEditor.tsx`. **Não há eixo de hooks por papel.**
  - Oráculo: `LedgerTask.ownerPlaceId` (`src/shared/ledger/contract.ts:139`) — a tarefa aponta o
    **lugar**; autor `{kind:'lugar', placeId, roleId}`. `LEDGER_SCHEMA_VERSION = 4`.
  - Semáforo `working|waiting|permission|done(+error)` e regra de atenção
    (`src/shared/attention/rule.ts`). **Não existe** "onde parou" por lugar nem `RETOMAR.md` no app.
  - Rig, pod, cadeira, ocupante: **não existem** no código nem no glossário; "seat" está em _Evitar_
    no verbete Lugar (`docs/glossario.md:22`). Só aparecem em `docs/pesquisas/openrig-estudo-profundo-2026-11.md`.
- **Prova já feita (cadeira enxuta, 05/11, aceita no Oráculo):**
  `%USERPROFILE%\Donel Dev Alfa - diario\faixa-marrom\cadeira-enxuta.md`.
  `--setting-sources project,local` + `--settings` do app **mantém** o hook do app e **tira** os
  hooks do usuário — mas tira também skills de `~/.claude/skills`, plugins, MCPs do `~/.claude.json`
  e o `defaultMode` do usuário. RAM: quem pesa é MCP stdio (~0,9 GB numa sessão sem escopo); HTTP
  não sobe processo.
- **Planos vizinhos:** [mindscape-openrig](mindscape-openrig.pda.md) — o item 06 (molduras de grupo)
  e o 12 (papéis de sessão) se sobrepõem a este; o 03 deste plano decide se absorve o 06 de lá.
- **Regras que mandam:** dono pensa graficamente (mostrar, não escrever); LLM agnóstico (nada preso
  a uma IA no rótulo); `src/main/accounts/` é perímetro proibido (por isso conta por cadeira está
  fora); fixtures genéricas (atlas, beacon, vega); testes quase zero, mas **migração de
  `mindscape.json` e do ledger é dado persistido que um canal pode apagar — ganha teste**; todo
  merge visível ganha item em `patchnotes/notes.ts`.
- **Sementes "shadow" e "MVP em 1 dia" não entram:** o executor do processo é o próprio dono, e o
  protótipo final já cumpre o papel de "versão crua para reagir".

## Decisões até agora

- **Forma das telas** → layout A1 + leitura A3; B1 com custo recolhível (dono, 06/11;
  `prototipos-cadeiras\decisao.md`, fora do repositório).
- **Folhas de instrução por rig e por pod** → sim. Cada rig e cada pod tem a sua folha, editável na
  seção de instruções da tela de cadeira com selo "Rig"/"Pod"; o Donel injeta em camadas
  Donel → Rig → Pod → Cadeira; CLAUDE.md do projeto e `~/.claude` continuam valendo; **nunca** um
  CLAUDE.md por rig dentro de repositório (rig atravessa projetos); folhas guardadas e versionadas
  pelo Donel (dono, via Líder, 06/11). A forma de guardar e injetar é o item 04.

## Ainda não especificado

- **Sentar alguém / acordar a cadeira** com fila, watchdog e cadeira sob demanda: depende da decisão
  da faixa marrom (OpenRig na VPS × construir no `donel-servico`,
  `faixa-marrom\decisoes-para-o-dono.md`). A tela mostra o botão; o mecanismo fica para depois.
- **Arquivo do time** (pergunta 19): exportar/importar rig → pods → cadeiras como arquivo legível,
  para subir um rig numa VPS sem o app. Formato e casa ainda não claros.
- **Cadeiras do OpenRig no mesmo quadro**: se o rig de homologação rodar no OpenRig da VPS, o
  Mindscape mostra essas cadeiras? Como espelho só leitura ou como cadeiras de verdade?
- **Cadeiras no celular** (Ledger PWA): o desenho de 390 px existe no protótipo; o canal não.
- **Líder único × cadeiras**: o Líder não tem quadro; ele senta em qual rig?
- **Convivência com o hill climbing** na barra esquerda (decidido em 05/11, ainda não construído).

## Fora de escopo

- **Conta por cadeira**: colide com o motor de contas (só `~/.claude`) e com o perímetro de
  credencial; fica "a conta ativa".
- **B2 (cascata) e B3 (orçamento)** como telas ou visões dentro da B1; **fita de ocupantes da A2**;
  **árvore fixa e inspetor fixo da A3** — descartados pelo dono na escolha de 06/11.
- **CLAUDE.md de rig gravado em repositório** — decisão de 06/11.

---

## Itens

### 01 — Confirmar o protótipo final com o dono

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: a carta "É assim que você quer?" está no Oráculo (tarefa t-678f3cb3), com os prints
  do Mindscape (1920 e 390) e da tela de cadeira (aberta e recolhida). Registrar a resposta: "Sim,
  pode planejar a construção" aprova a forma; "Ajustar" traz o que mudar e volta ao protótipo antes
  dos itens 03 e 06.
- **Resolução**: —

### 02 — Modelo da cadeira: o que é cadeira, ocupante, rig e pod

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: a cadeira é o **Lugar** de hoje promovido (mesmo `SessionPlaceCard`, `previous[]` vira
  "quem já sentou") ou um objeto novo acima dele, que agrupa lugares? Decidir: endereço estável
  (`papel@rig`, pod opcional); cadeira **elástica** com teto (o Dev com 3 de 4 lugares — são 4
  lugares numa cadeira ou 4 ocupantes simultâneos de uma cadeira?); estados da cadeira (vaga,
  ocupada, dormindo, travada); se uma cadeira pertence a um só rig; se um quadro pode ter mais de
  um rig. Saídas: verbetes **Cadeira, Ocupante, Rig, Pod** no glossário (o verbete Lugar hoje manda
  evitar "seat"), ADR novo e a forma do `schemaVersion` 6. Perguntas 17 e 21 do dossiê.
- **Resolução**: —

### 03 — Rig e pod como molduras tipadas, com layout guiado

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: a moldura vira objeto do quadro com tipo (rig | pod), nome, missão, paradigma e
  contagem — distinguível em texto, cor só como reforço. Decidir: as cadeiras se arrumam sozinhas
  dentro do pod (grade, como no protótipo) e o dono só move o pod, ou o dono também posiciona a
  cadeira? Como o desenho do dono fica "por cima, esmaecido ou oculto" sem nunca ser movido pelo
  layout (pergunta 22). O que acontece com os retângulos que o dono já desenhou como rig/pod (viram
  moldura, ficam como desenho, ou o dono escolhe)? Este item absorve ou substitui o item 06
  "Molduras de grupo" de [mindscape-openrig](mindscape-openrig.pda.md)?
- **Resolução**: —

### 04 — Folhas de instrução do rig e do pod: guardar, versionar, injetar

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: a decisão de existir já foi tomada (ver "Decisões até agora"); falta a forma.
  Onde o Donel guarda a folha (`<userData>/rigs/<id>/…`, ao lado de `papeis/`?) e como versiona
  (versões numeradas com data, desfazer, comparar)? Como injeta em camadas Donel → Rig → Pod →
  Papel/Cadeira: um único `--append-system-prompt-file` montado no spawn (como o papel hoje) ou um
  arquivo por camada? Qual o teto de tamanho/tokens e como a tela mostra o custo de cada folha? A
  sessão em lugar remoto (VPS) recebe as mesmas folhas pelo mesmo caminho do papel? "Vale para quem
  sentar depois de salvar; os sentados pegam na próxima continuação" — confirmar.
- **Resolução**: —

### 05 — Herança Rig → Pod → Cadeira sobre o escopo do #250

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: hoje o escopo (MCPs, plugins, skills) é **por papel** (`RoleScope`). Decidir o que é
  do **papel reutilizável** e o que é da **cadeira** (o papel sentado num pod), e como cada nível só
  acrescenta ou tira. Modelo, esforço e permissão passam a ser **aplicados** pela cadeira no spawn
  (hoje só sugeridos no Launcher, sem rastro)? **Hooks:** adotar `--setting-sources project,local`
  + reinjeção pelo app, sabendo pela cadeira enxuta que isso também tira skills, plugins, MCPs do
  usuário e o `defaultMode` dele — o app reinjeta o que o escopo da cadeira listar? **Travas:**
  separar permissão de ferramenta, guarda por hook (ex.: Slack) e alçada (risco no Oráculo) como na
  B1. Saída: ADR da herança e a extensão do `RoleScope`.
- **Resolução**: —

### 06 — Saúde da cadeira, "onde parou" e configurado × observado

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: a faixa do topo conta cadeiras por **problema · atenção · bem · sem sinal**. Qual a
  regra a partir do semáforo, da regra de atenção e do Oráculo (no protótipo foi derivada à mão)?
  **Onde parou** (pergunta 20): quem escreve o estado da cadeira (a sessão, a cada entrega/evento do
  Oráculo? o app, a partir do transcript?), onde fica, e se é reinjetado como 1ª mensagem do próximo
  ocupante. **Observado:** registrar o argv real de cada spawn (modelo, esforço) para comparar com o
  configurado.
- **Resolução**: —

### 07 — Tarefas do Oráculo presas à cadeira

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: `ownerPlaceId` aponta o lugar. Com cadeiras, a tarefa aponta a **cadeira** e o
  ocupante que assumiu/entregou fica no evento? Isso sobe o `LEDGER_SCHEMA_VERSION` para 5 — como
  ficam as tarefas antigas e o PWA do celular, e o que a gaveta da cadeira mostra ("presas à
  cadeira")? Conferir com o Revisor a regra "quem entregou nunca aceita" quando dois ocupantes da
  mesma cadeira entram na cadeia.
- **Resolução**: —

### 08 — Migração dos quadros atuais para cadeiras

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02, 03, 07
- **Pergunta**: o quadro Donel Dev tem 58 lugares (dev 40, revisor 10, pesquisa 6, líder 2) que viram
  5 cadeiras; Dalton e Theo West também migram. Regra de agrupamento (mesmo papel no mesmo quadro =
  mesma cadeira? e cadeira elástica?), onde vão as notas de sessão (para dentro da cadeira) e os
  post-its do dono (intocados, por cima), backup antes de migrar, e o que o canal beta/stable vê
  (só leitura pelo `schemaVersion`). Tarefa associada: rodar a migração numa cópia do
  `mindscape.json` e do `ledger.json` reais e conferir o resultado com o dono antes de ligar.
- **Resolução**: —

### 09 — De onde vem o custo estimado por cadeira

- **Tipo**: pesquisa
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: a coluna de custo mostra contexto inicial (tokens) e memória (MB) que mudam ao
  ligar/desligar MCP, plugin, skill e folha. Que fonte o app consegue ler **sem tocar segredo**
  (o `~/.claude.json` tem chaves de MCP; o inventário do #250 já lê nomes)? Tokens: medir pelo
  `system/init` uma vez por item e guardar a tabela, ou estimar? RAM: usar a regra medida na cadeira
  enxuta (stdio sobe processo, HTTP não) com os números de 05/11? Saída:
  `docs/pesquisas/custo-por-cadeira.md`.
- **Resolução**: —

### 10 — Cortar em versões (V1..Vn)

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 01, 02, 03, 04, 05, 06, 07, 08, 09
- **Pergunta**: rodar `/versionamento`. Proposta de partida para reagir: **V1** = cadeiras no quadro
  (modelo, molduras rig/pod com texto, migração, ocupantes dentro, gaveta, faixa por estado, seu
  desenho por cima); **V2** = tela de cadeira (B1) com herança, folhas de rig/pod e travas; **V3** =
  custo ao vivo na coluna recolhível, onde parou reinjetado e configurado × observado medido.
  Celular, arquivo do time e sentar/acordar ficam na névoa até clarear.
- **Resolução**: —

### 11 — Validar MVP e versionamento com o cliente

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 10
- **Pergunta**: apresentar ao dono a V1 proposta e as versões seguintes (carta no Oráculo, com o
  visual primeiro); registrar o OK — quando e em qual carta. Bloqueia `/arquitetura` e tudo de
  execução técnica.
- **Resolução**: —
