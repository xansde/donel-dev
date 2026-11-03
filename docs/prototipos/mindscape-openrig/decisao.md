---
demanda: mindscape-openrig
plano: docs/planos/mindscape-openrig.pda.md · item 14
taskdex: []  # ferramenta pessoal, sem card
status: decidido
decidido-por: Alexandre Lentz
decidido-em: 2026-11-03
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

## O centro (dono, 03/11)

"A ideia desse excalidraw é conseguir me comunicar contigo exatamente como eu funciono:
graficamente. Palavras não são meu forte." e "quero o excalidraw bem mais coerente com o
mindscape, bem co-relato". Por isso o protótipo abre em **Falar desenhando** (ele desenha, manda
um trecho, o agente recebe print + leitura do desenho e responde no quadro, em azul tracejado, até
ele aceitar) e **Desenho = quadro** (seta vira ligação, retângulo vira moldura, rabisco gruda no
cartão). Quadro, ligações, cartões e esteira usam o mesmo traço do app: roughjs embutido, com os
parâmetros de `src/renderer/src/Mindscape/roughShapes.ts`, e as ferramentas reais (V H A L R O P E).

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

0. Falar desenhando é o centro, antes de papéis e conexões? (proposta: sim)
1. A ligação **autoriza** mandar mensagem sem pedir OK? (proposta: sim, no sentido da ligação)
2. Mensagem retida enquanto ele digita entra **sozinha** depois? (proposta: sim)
3. Papel trocado numa sessão viva vale **na próxima retomada**? (proposta: sim, com aviso)
4. Esteira: pré-declarar o molde no quadro pode, e "YAML fora de escopo" vira "nunca YAML à mão"?
5. Com o app fechado, CLI/TUI/MCP param? (proposta: sim)

## Escolha

**A + C, com o Jobu no papel de Líder** (dono, 03/11: "Gostei do protótipo C + A. Mas o chat
poderia ser direto com o Jobu, né? Ele abrir um chat direto com ele, que eu possa mover e se
adapte à tela. Assim consigo aproveitar melhor meus monitores").

- Do **A**: o quadro inteiro na tela, com a faixa "Precisa de você" no topo.
- Do **C**: um Líder que conversa com o dono e reparte o trabalho, sem responder pedido de outra
  sessão.
- **Novo**: o Líder é o **Jobu**. A conversa sai do painel lateral e vira uma janela própria,
  aberta pelo Jobu, que o dono arrasta, redimensiona, leva a outro monitor e deixa (ou não) sempre
  por cima; ela encosta nas bordas e se ajusta à tela. O selo de pendências fica no próprio Jobu.
  O motor do Jobu é o que o dono escolher (regra "LLM agnóstico").

Ajuste do dono (03/11): "espero algo mais orientado ao lúdico, como se fosse uma caixa de fala
com ele". A conversa é um **balão de quadrinho saindo do Jobu**: a última fala dele em destaque,
escrita letra a letra, com a pose mudando conforme o assunto (surpreso no que precisa do dono,
lendo no andamento, rindo no que deu certo), respostas em botões de um clique, o histórico
recolhido num ≡, e um campo "você:" para escrever. Jobu e balão andam juntos; clicar no Jobu abre
e fecha o balão. Urgente deixa a borda vermelha.

Compilado em [`final.html`](final.html).

## Descartado

- **B — coluna de decisões**: ocupa largura fixa do quadro; a faixa do A + o Jobu cobrem o
  "o que precisa de mim" sem tirar espaço.
- **C como painel lateral**: a conversa presa à janela do app desperdiça os outros monitores.

## Limitações do mock

- Desenhar, arrastar, ligar e criar moldura funcionam só na memória da página (recarregar zera).
- A leitura do desenho e a resposta do agente são roteiro fixo; nenhum agente real lê nada.
- Dados de exemplo (projeto `atlas`); nada fala com sessão, CLI ou MCP de verdade.
- Prévia do terminal é texto parado; "ao vivo" só muda o rótulo e o contador.
- Animação da ligação existe só no cenário "Revisor devolve achado".
- B e C encolhem o quadro com `zoom` para caber; no app real o quadro rola e dá zoom.
- Não testado em tela pequena nem no tema claro.
