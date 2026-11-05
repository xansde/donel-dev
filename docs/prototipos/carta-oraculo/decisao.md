---
demanda: carta-oraculo
plano: invocação direta (tarefa do Oráculo Harrow, pedido do dono em 05/11)
taskdex: []  # Donel Dev não usa TaskDex; o registro é a tarefa no Oráculo Harrow
status: pendente-de-escolha
decidido-por: —
decidido-em: —
---

# Decisão de UI — Cartas do Oráculo que se entendem

## Pergunta

Que forma de carta faz o dono entender, em 5 segundos e sem abrir link, o que decide, a
recomendação, o efeito de cada opção, um visual e o risco (celular e desktop)?

## Base visual

- Carta: tokens de `src/main/celular/pwa/app.css` (claro e escuro) e glifos de
  `src/main/celular/pwa/app.js`, lidos em `origin/staging`.
- Moldura do desktop: `design-system/src/tokens.css` (dark-only).
- Jobu: `src/renderer/src/pet/assets/poses/talking.png` (copiado como `jobu.png`).
- Dados: `%APPDATA%\donel-dev\ledger.json` (só leitura, 05/11 ~14h): as tarefas da fase 2 da
  VPS, da conta sem limite e do painel de progresso.

## Ângulos gerados

- **A — Carta Harrow**: baralho de verdade; a frente decide, o verso explica.
- **B — Conversa com o Jobu**: o Jobu conta a história em falas; as opções ficam fixas embaixo.
- **C — Visual grande**: o visual primeiro (metade do celular, coluna larga no desktop); a decisão numa folha ao lado.
- **D — Escolha o caminho**: cada opção é um bloco com o futuro (sinal), o efeito e o risco daquele caminho.

Proposta de contrato e régua de quando sobe ao dono: `contrato.html`.

## Escolha

<Preenchido com o feedback do dono.>

## Descartado

<Preenchido com o feedback do dono.>

## Limitações do mock

- Os textos “para o dono” foram reescritos por mim a partir do critério, da nota e das provas:
  é o que o contrato novo pediria a quem entrega. Hoje nenhum agente escreve assim.
- A carta do painel de progresso é **simulada**: em 05/11 14h a tarefa ainda estava em
  execução. O antes/depois foi redesenhado com as tarefas reais do quadro, não é print do app.
- As cartas da VPS e da conta já tinham sido aceitas pelo dono; aparecem como pendentes.
- Nada grava: tocar numa opção só passa para a próxima carta.
- O gesto de arrastar (aceita/rejeita) da PWA atual não foi reproduzido.
