---
demanda: ledger-bom
plano: docs/planos/ledger-bom.md · item 04
taskdex: []  # ferramenta pessoal, sem card
status: pendente-de-escolha
decidido-por: —
decidido-em: —
---

# Decisão de UI — fila por quadro, prioridade e "Progresso - Seus pedidos"

## Pergunta

Como o dono vê e opera as linhas em andamento de cada quadro, o limite, a puxada e a prioridade dos pedidos dele —
e o que precisa ser limpo antes de ligar a puxada.

## Base visual

Tokens copiados de `design-system/src/tokens.css` (tema escuro do Donel Dev: fundos, borda, texto, cores de estado e
de zona, fonte, espaçamentos, raios, altura de linha). Densidade e vocabulário da tela atual de progresso do Jobu
(`src/renderer/src/pet/JobuProgress.tsx`). Dados: `tarefa_listar` de todas as tarefas em 08/11 22:28 (406 tarefas),
cruzado com a cópia de 07/11 para o quadro de cada tarefa.

## Ângulos gerados

- **A — Colunas por quadro**: cada quadro é uma coluna com "N em andamento · limite L", as linhas em andamento e a
  fila dele com ↑↓ e "Puxar a próxima"; o limite se ajusta ali (− +).
- **B — Seus pedidos numa lista só**: uma ordem única dos pedidos do dono (repetidos viram um pedido com "N de M
  prontas"); medidores de cada quadro no topo; o quadro puxa o primeiro da lista que é dele.
- **C — Faxina primeiro, depois faixas**: painel da faxina (órfãs, repetidos, sem título) com "Aceitar a faxina" e a
  capacidade das máquinas; os pedidos em faixas Agora / Próximas / Depois / Algum dia, sem posição exata.

## Escolha

<Preenchido com a resposta do dono na carta.>

## Descartado

<Preenchido com a resposta do dono na carta.>

## Limitações do mock

- As 75 tarefas mais novas não trazem o quadro na leitura de 08/11 e aparecem como "Quadro não informado".
- A ordem inicial da fila é uma regra simples (pedido do dono primeiro, risco alto, sem dono vivo por último); a
  ordem real nasce do primeiro arranjo do dono.
- O destino proposto para as órfãs usa o prazo vencido como sinal de "velha" (a leitura não traz a data de criação).
- A memória do PC e a cota das contas não foram medidas; a capacidade mostrada é a da VPS de homologação.
- Nada é gravado: botões só mudam a tela.
