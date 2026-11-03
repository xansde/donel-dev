---
demanda: mindscape-lugar-principal
titulo: Mindscape como lugar principal — sessões adormecidas, Organizar, favoritas fixas e diário de gestos
cliente: Alexandre Lentz (dono e usuário diário do Donel Dev)
responsavel: Claude por delegação de Alexandre Lentz
canal-slack: "não existe — ferramenta pessoal, sem Slack (memória donel-dev-sem-taskdex-sem-slack)"
taskdex: []  # ferramenta pessoal, sem card
origem: specs/backlog.md (B34, B35, B31) — pedidos do dono em 31/10
criado: 2026-10-31
status: em-execucao
aprovado-por: Claude por delegação de Alexandre Lentz, 2026-10-31 ("Pode começar a leva de estudo completa do próximo estágio do donel dev e seguir para desenvolvimento após definir a fatia de hoje!")
---

# PDA — Mindscape como lugar principal

## Destino

O Mindscape vira o lugar onde o Alexandre acha e retoma qualquer sessão de um projeto: as
fechadas aparecem adormecidas, o quadro se arruma num gesto, as favoritas ficam fixas, e cada
gesto dele vira exemplo local para a Laya aprender. A fatia de hoje chega ao alfa.

## Notas

- Ferramenta pessoal: sem card, sem Slack. PR e merge em `staging` livres com verificação verde.
- Decisões por delegação do dono (31/10). Critério: o mais simples que cumpre o pedido dele e
  não fecha porta para o agente (B34 Parte 2), a wiki (B31) e a Laya (B35).
- Pedidos literais do dono: "só aparece uma sessão"; favoritas "não poderão mudar" e "poderei
  favoritar quantas eu quiser"; barra lateral "cada vez mais recessiva"; agente "não é
  Organizar com o Claude", qualquer LLM, inclusive conta ativa; Laya "vá melhorando com o
  tempo, até saber de tudo".
- Base: Mindscape V1 + desenho (`docs/design/mindscape.md`, `docs/design/mindscape-desenho.md`).
  Favorita = sessão **fixada** do registro da 007 (`sessionRegistry`, `pinned`), já sem teto.
- Perímetro proibido: `src/main/accounts/`. Fixtures genéricas (atlas, beacon, vega).

## Decisões até agora

- **01 — Achados do Bill nos EUA (Slack)** → ver [pesquisa](../pesquisas/slack-bill-eua-2026-10.md)
- **02 — Estado atual do quadro e das favoritas** → ~44 post-its órfãos; sessão sem aba nunca é desenhada (regra 11); favorita = `pinned` do `sessionRegistry`, sem teto (C4 da 007) ([refinamento](../refinamentos/mindscape-lugar-principal.md#o-que-existe-hoje))
- **03 — Regras da fatia de hoje** → 12 regras: adormecidas, antigas recolhidas, favoritas fixas, Organizar, diário de gestos ([refinamento](../refinamentos/mindscape-lugar-principal.md))
- **04 — Fatia de hoje × depois** → hoje: F1 adormecidas + retomar, F2 Organizar, F3 diário de gestos; depois: nomes pelo primeiro pedido, favoritar no quadro, recolher a barra, agente, wiki, treino da Laya ([refinamento](../refinamentos/mindscape-lugar-principal.md#fatia-de-hoje))
- **05 — Validar MVP e versionamento com o cliente** → validado por delegação do dono, 2026-10-31; ele revê no alfa

## Ainda não especificado

- Contrato do motor do agente (B34 Parte 2): o que o app entrega ao LLM e o que recebe de volta.
- Forma da wiki (B31) e como um tema do Mindscape vira página.
- Como os gestos viram rótulo da Laya (qual janela de tempo conta como "precisava de você").
- Quando a barra lateral passa a nascer recolhida.

## Fora de escopo

- Treinar ou rodar a Laya nesta leva: primeiro medir quantos exemplos os gestos geram.
- Mudar o Modo Dev, o motor de contas ou o repo público.

---

## Itens

### 01 — Achados do Bill nos EUA (Slack)

- **Tipo**: pesquisa
- **Prioridade**: media
- **Status**: concluido
- **Bloqueado por**: —
- **Pergunta**: o que o Bill trouxe dos EUA (outubro/2026) que vale estudar, e o que disso
  melhora o Donel Dev?
- **Resolução**: ver [pesquisa](../pesquisas/slack-bill-eua-2026-10.md)

### 02 — Estado atual do quadro e das favoritas

- **Tipo**: pesquisa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: —
- **Pergunta**: por que o quadro mostra uma sessão só, quantos órfãos existem e onde mora a
  "favorita" hoje?
- **Resolução**: regra 11 esconde sessão sem aba; `mindscape.json` real tem ~44 post-its órfãos; favorita = `pinned` do `sessionRegistry` ([refinamento](../refinamentos/mindscape-lugar-principal.md#o-que-existe-hoje))

### 03 — Regras da fatia de hoje

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 02
- **Pergunta**: quem aparece no quadro, como a sessão fechada se comporta, o que o Organizar
  move, o que é "favorita fixa" e o que o diário de gestos grava?
- **Resolução**: 12 regras por delegação do dono ([refinamento](../refinamentos/mindscape-lugar-principal.md))

### 04 — Fatia de hoje × depois

- **Tipo**: tarefa (versionamento)
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 03
- **Pergunta**: o que entra hoje no alfa e o que fica para as próximas levas?
- **Resolução**: F1–F3 hoje; o resto em "Depois" ([refinamento](../refinamentos/mindscape-lugar-principal.md#fatia-de-hoje))

### 05 — Validar MVP e versionamento com o cliente

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 04
- **Pergunta**: apresentar ao Alexandre o corte de hoje e o que fica depois; registrar o OK.
- **Resolução**: validado por delegação do dono, 2026-10-31 (pedido literal acima); revisão real no alfa
