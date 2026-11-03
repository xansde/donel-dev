---
demanda: mindscape-openrig
plano: docs/planos/mindscape-openrig.pda.md · item 14
taskdex: []  # ferramenta pessoal, sem card
status: pendente-de-escolha
decidido-por: —
decidido-em: —
---

# Decisão de UI — Mindscape como time de sessões (ideia do OpenRig)

## Pergunta

Como o Mindscape mostra e dirige várias sessões trabalhando juntas (papéis, ligações com
significado, quem espera quem e o que precisa do dono), no layout do Donel Dev? O dono pediu um
protótipo **bem explicativo, antes de qualquer desenvolvimento** (03/11).

## Base visual

Design system real do app, mesmo bloco de tokens de `docs/prototipos/mindscape/final.html`,
conferido contra `design-system/src/tokens.css` em 03/11 (superfícies, estados do semáforo, smart
zone, `--postit-bg`, chips de fase, tipografia, espaçamento). Cartão de sessão, post-it e casco
copiados da forma aprovada do Mindscape (`docs/prototipos/mindscape/decisao.md`). Cor dos selos de
papel reaproveita os chips de fase (`--phase-*`); não há token próprio de papel no repo.

O guia (fundo creme, à direita) **não faz parte do design avaliado**: é a camada de explicação.

Conteúdo: [estudo profundo do OpenRig](../../pesquisas/openrig-estudo-profundo-2026-11.md)
(seções 6, 6.1, 7 e 9).

## Ângulos gerados

O que muda entre eles é **onde o dono decide e como fala com o time**; o quadro (cartão-lugar,
papel, cartão rico, ligações com tipo, prévia do terminal, moldura) é o mesmo nos três.

- **A — Quadro-mesa**: tudo no quadro; uma faixa fina no topo lista o que precisa do dono e leva
  ao cartão.
- **B — Quadro + coluna de decisões**: coluna à direita no espírito do For You do OpenRig —
  decisões primeiro, com ações no próprio cartão (ir ao terminal, aprovar, negar, segurar),
  depois andamento e entregas.
- **C — Líder conversa com você**: uma sessão com papel Líder fala com o dono pelo chat, reparte
  pelas ligações "delega a" e avisa quando alguém para; nunca responde pedido de outra sessão.

Também no protótipo (não são variantes, são explicação do que vem):

- **Esteira montada** (item 15, próximo passo): molde Bugfix com estações, caminhos por desfecho/
  rota, fan-out, fan-in, laço com teto, "você decide" e Coordenador; simulação passo a passo.
- **CLI · TUI · MCP**: as três portas do OpenRig, como ficariam no Donel (`donel ps`,
  `donel tui`, ferramentas `sessao_*` no servidor `donel`).
- **Cenários** clicáveis: Dev pede permissão; Revisor devolve achado (mensagem retida enquanto o
  dono digita, entra depois); Dev renova em voo (B36).

## Para o dono decidir (além da forma)

1. A ligação **autoriza** mandar mensagem sem pedir OK? (proposta: sim, no sentido da ligação)
2. Mensagem retida enquanto ele digita entra **sozinha** depois? (proposta: sim)
3. Papel trocado numa sessão viva vale **na próxima retomada**? (proposta: sim, com aviso)
4. Esteira: pré-declarar o molde no quadro pode, e "YAML fora de escopo" vira "nunca YAML à mão"?
5. Com o app fechado, CLI/TUI/MCP param? (proposta: sim)

## Escolha

—

## Descartado

—

## Limitações do mock

- Posições fixas: não arrasta cartão, não cria ligação, não edita papel.
- Dados de exemplo (projeto `atlas`); nada fala com sessão, CLI ou MCP de verdade.
- Prévia do terminal é texto parado; "ao vivo" só muda o rótulo e o contador.
- Animação da ligação existe só no cenário "Revisor devolve achado".
- B e C encolhem o quadro com `zoom` para caber; no app real o quadro rola e dá zoom.
- Não testado em tela pequena nem no tema claro.
