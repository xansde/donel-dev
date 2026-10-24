---
demanda: mindscape
titulo: Mindscape — quadro visual de sessões e post-its
cliente: Alexandre Lentz (dono e usuário diário do Donel Dev)
responsavel: Claude por delegação de Alexandre Lentz
canal-slack: "não existe — ferramenta pessoal (decidido por delegação do dono, 2026-10-23)"
taskdex: []  # ferramenta pessoal, sem card — esta execução não conta na adoção
origem: docs/produto/mindscape.spec.md
criado: 2026-10-23
status: em-execucao
aprovado-por: Claude por delegação de Alexandre Lentz, 2026-10-23
---

# PDA — Mindscape

## Destino

Regras e versões do Mindscape fechadas para a `/arquitetura` começar: V1 = caminho feliz do
spec (sessões como post-its com destaque, post-it escrito pela sessão, post-its do dono,
ligações, um mindscape por projeto, ir ao terminal), para o Alexandre usar no canal alfa.

## Notas

- Ferramenta pessoal: sem card TaskDex, sem canal Slack, PR livre para `staging`, merge humano.
- Rodada com decisões delegadas pelo dono em 2026-10-23 ("Você pode seguir a estrutura atual
  da esteira, só que vai tomando as decisões"). Critério: opção mais simples que respeita o
  spec; o dono quer ver resultado rápido.
- Forma: variante A, Canvas livre (`docs/prototipos/mindscape/final.html`).
- Excalidraw como base do quadro é decisão da `/arquitetura` (spec, Pendências), não deste plano.
- Perímetro proibido: `src/main/accounts/`. Fixtures com nomes genéricos (atlas, beacon, vega).
- Vocabulário: `docs/glossario.md`. Índice na numeração do repo: `specs/017-mindscape/README.md`.

## Decisões até agora

- **01 — Forma da tela do Mindscape** → variante A, Canvas livre, escolhida pelo dono ([protótipo](../prototipos/mindscape/decisao.md))
- **02 — De onde vem o texto do post-it escrito pela sessão** → campo `last_assistant_message` do hook `Stop`, que já chega ao app; fallback na cauda do `.jsonl` ([pesquisa](../pesquisas/mindscape-fonte-postit-sessao.md))
- **03 — Regras de comportamento do Mindscape** → 13 regras fechadas por delegação: post-it no `Stop`, erro destacado, ligações livres, paleta de aba sem vermelho para o dono, persistência no `userData`, terceiro modo "Mindscape", baselines adiados ([refinamento](../refinamentos/mindscape-regras-v1.md))

## Ainda não especificado

- Mindscape por sequência de esteira: o spec pede "por projeto ou por esteira"; a V1 fica só
  por projeto, e a forma do "por esteira" depende do corte de versões.

## Fora de escopo

- Texto de terminal ao vivo no quadro e qualquer mudança no Modo Dev (spec).
- Completar as buscas de anti-duplicação (GitHub seazone-tech e KB): ferramenta pessoal, Tomo
  já achado no repo e forma já escolhida; o retorno não muda a V1 (decidido por delegação do
  dono, 2026-10-23).
- Shadow do processo e "MVP em 1 dia": o cliente é o próprio executor e o protótipo já existe
  (decidido por delegação do dono, 2026-10-23).
- Contador de baselines na V1 (refinamento, regra 12).

---

## Itens

### 01 — Forma da tela do Mindscape

- **Tipo**: prototipo
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: —
- **Pergunta**: como o Mindscape estrutura a visão de sessões e post-its para o dono
  acompanhar de relance vários projetos e esteiras? (spec, Produto-alvo)
- **Resolução**: variante A, Canvas livre, escolhida pelo dono em 2026-10-23 ([decisao.md](../prototipos/mindscape/decisao.md))

### 02 — De onde vem o texto do post-it escrito pela sessão

- **Tipo**: pesquisa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: —
- **Pergunta**: o post-it escrito pela sessão deve sair sem chamar modelo. De onde o app tira
  esse texto hoje, com o menor custo, e quando ele fica disponível? (spec, Pendências)
- **Resolução**: `last_assistant_message` do hook `Stop`, já recebido pelo `SessionSemaphoreManager`; fallback na cauda do `.jsonl` ([pesquisa](../pesquisas/mindscape-fonte-postit-sessao.md))

### 03 — Regras de comportamento do Mindscape

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 02
- **Pergunta**: fechar as pendências do spec — quando a sessão escreve o post-it, destaque em
  erro, significado das ligações, cores, persistência, onde mora, baselines e convenção
  `specs/NNN`.
- **Resolução**: 13 regras fechadas por delegação do dono, 2026-10-23 ([refinamento](../refinamentos/mindscape-regras-v1.md))

### 04 — Cortar as versões do Mindscape

- **Tipo**: tarefa (executada pela skill de apoio `/versionamento`)
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 03
- **Pergunta**: separar V1 (caminho feliz do spec com as regras do item 03, um mindscape por
  projeto) de V2+ (mindscape por esteira, histórico de post-its da sessão, rabisco, prints,
  sessão que lê post-its, captura relâmpago Ctrl+Alt+N, cartas do dia, baselines medidos).
  Tipo `tarefa` porque a tabela de tipos não tem versionamento (decidido por delegação do
  dono, 2026-10-23).
- **Resolução**: —

### 05 — Validar MVP e versionamento com o cliente

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 04
- **Pergunta**: apresentar ao Alexandre o MVP proposto e as versões (V1..Vn); registrar o
  OK — quem validou, quando, onde (sem canal Slack: registrar na conversa/handoff).
  Bloqueia a `/arquitetura` em diante.
- **Resolução**: —
