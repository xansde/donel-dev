---
demanda: ancora-proxy
plano: docs/planos/ancora-proxy.md · seção 3 (invocação direta, pedido do Líder do quadro)
taskdex: []  # Donel Dev é ferramenta pessoal, sem .taskdex.json (CLAUDE.md do repo)
status: pendente-de-escolha
decidido-por: —
decidido-em: —
---

# Decisão de UI — Âncora do proxy

## Pergunta

Como o dono escolhe e troca, no app, qual dos dois PCs de casa é a âncora do proxy de saída das VPS? E o que ele vê
quando a âncora cai (as VPS param, nunca saem pela nuvem)?

## Base visual

Tokens copiados literalmente de `design-system/src/tokens.css` (superfícies, texto, estados, zonas, acento do Donel,
tipografia, espaçamento, raio, densidade). Casca (sidebar 240px, barra de status) no formato do app. Sem fontes
remotas: Inter e JetBrains Mono caem para as do sistema.

## Ângulos gerados

- **A — Uma linha em Preferências**: prioriza o menor gesto. Um select ao lado de "Onde o Líder roda", o estado de
  cada VPS embaixo e os passos da troca conferidos (alcança, mesmo IP, gravado, saída conferida).
- **B — Mapa das máquinas**: prioriza entender o caminho. Os PCs lado a lado (proxy, IP de casa, gateway, há quanto
  tempo ligado), as linhas até as VPS, "Tornar âncora" no cartão e o histórico de trocas.
- **C — Chip na barra de status**: prioriza saber a qualquer momento e agir na queda. "Âncora: X ●" sempre à vista, um
  popover para trocar e a faixa vermelha com "Passar para Y" quando as VPS param.

## Escolha

<Pendente: escolha do dono.>

## Descartado

<Pendente.>

## Limitações do mock

- Nada fala com VPS: os passos da troca são animação.
- O nome "pc-24h" e o IP 100.101.44.7 são inventados (o segundo PC ainda não está na tailnet).
- Não mostra o fluxo de "Acrescentar PC" nem o erro de IP diferente (só o aviso no diálogo).
- O switcher só lê a variante do endereço ao abrir a página; troque pelas setas.
