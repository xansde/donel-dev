---
demanda: mindscape
solicitante: Alexandre Lentz — Coordenador de AI Builders
canal-slack: não existe  # ferramenta pessoal; registrado em Pendências
taskdex: []  # URLs dos cards do TaskDex (registro de uso)
data: 2026-10-23
status: aprovado # em-discovery | aprovado
aprovado-por: Alexandre Lentz, 2026-10-23
---

# Mindscape

## Pedido original

"Contribuir com o Donel Dev organizando algo similar ao Maestri (https://www.themaestri.app/pt-br), com o nome de funcionalidade Mindscape, inspirado no ritual Mindscape de Pathfinder 2e" (o espaço mental compartilhado onde várias mentes se encontram).

## Dor real

- **Cliente**: Alexandre Lentz
- **Quem sofre**: o próprio Alexandre, usuário diário do Donel Dev, que trabalha com várias sessões do Claude e várias esteiras ao mesmo tempo

Os problemas do dia a dia:

1. Ele é muito visual, e abas de terminal não mostram o conjunto do que está acontecendo.
2. Para entender o que uma sessão fez, precisa perguntar a ela, e a resposta se perde no terminal.
3. Não tem onde deixar anotações (post-its) ao lado do trabalho. É um desejo antigo.
4. O Modo Dev foi pensado para uma esteira só. Com mais e mais esteiras ele não escala, e o mapa de nós que o Alexandre queria não chegou.

Por que agora: ver o Maestri mostrou uma forma concreta de resolver isso.

Nas palavras do solicitante: "Eu sou extremamente visual. Precisava de uma maneira fácil e prática de acompanhar o que está sendo feito. Além de acompanhar finalizações de sessões e de fato entender o que estava acontecendo."

## Como é hoje

- O trabalho é feito em várias abas de terminal, uma por sessão.
- Cada sessão tem um semáforo (trabalhando, aguardando, pedindo permissão, erro, encerrada) na aba e na barra lateral, com "há X min".
- Quando uma sessão em segundo plano fica esperando ou pede permissão, o Windows avisa por notificação.
- Para saber o que a sessão fez, o Alexandre pergunta a ela ("o que você fez?").
- Não há post-its nem resumo automático do que foi feito.
- O Modo Dev conduz uma esteira por vez (mapa, painel de fase e quadro de cards).

Fonte: handoffs/modo-dev-estado-atual.md.

## O que já existe

Anti-duplicação com desfecho **parcial** (relatório completo em `docs/pesquisas/visao-visual-multi-sessao-postit.md`):

- **Tomo do Donel**: o quadro de post-its já pedido nas histórias US-10 e US-16 do MVP (`specs/001-mvp/spec.md`) e desenhado no Brief 13 (`design/design-handoff.md`, linhas 702-745): cartas, captura relâmpago (Ctrl+Alt+N), cartas do dia, ações manter / virar prompt / arquivar, e a voz do Donel só nos post-its e nos estados vazios. Foi desenhado e nunca construído; só o desenho do cartão existe. **Decisão: o Tomo mora no Mindscape.** Os post-its do Alexandre são as cartas do Tomo.
- **Semáforo por sessão e notificações**: já existem e serão reaproveitados.
- **Mapa de nós do Modo Dev**: cobre uma esteira por vez e não tem post-its.
- **Maestri**: não serve como está, porque o centro dele são terminais ao vivo.
- **GitHub seazone-tech**: nada equivalente encontrado. Duas buscas não rodaram por limite, e a base de conhecimento (KB) não foi consultada. Fica registrado.

## Produto-alvo

Um quadro visual livre, o Mindscape, funcionando para o Alexandre: nele ele acompanha de relance suas sessões e suas anotações, organizado por projeto ou por esteira, sem nenhum texto de terminal. Do Maestri **não** vem o terminal ao vivo no quadro ("não espero ver o texto subindo nos terminais [...] não tenho olho bom pra isso [...] nem RAM"): a sessão no quadro é um post-it leve. Protótipo escolhido: variante A, "Canvas livre" (`docs/prototipos/mindscape/final.html`; decisão em `docs/prototipos/mindscape/decisao.md`).

Caminho feliz:

- Como dono do Donel Dev, quero ver o conjunto, com cada sessão como um post-it com selo "sessão" e o estado dela, para acompanhar tudo de relance.
- Como dono do Donel Dev, quero que o destaque de cada sessão siga o que ela pede de mim: **destacada** quando finalizou ou está esperando uma decisão minha; **normal** quando está em curso; **apagadinha** quando não tem novidade desde a última vez que acessei a sessão, para não chamar atenção.
- Como dono do Donel Dev, quero que a sessão deixe post-its com o que fez, ao lado do dela e marcados "escrito pela sessão", para entender o que aconteceu sem perguntar a ela.
- Como dono do Donel Dev, quero criar meus próprios post-its (as cartas do Tomo), com cor e liberdade de arrastar, distinguíveis dos da sessão, para anotar ao lado do trabalho.
- Como dono do Donel Dev, quero ligar sessões entre si, com ligações com direção ou sem, para relacioná-las. O significado das ligações será explorado depois, mas o Alexandre quer que elas existam desde o início ("talvez criar isso desde o princípio fica melhor no futuro").
- Como dono do Donel Dev, quero ter vários mindscapes, por projeto ou por sequência de esteira, trocados por abas, para separar os assuntos.
- Como dono do Donel Dev, quero selecionar uma sessão e ir ao terminal dela no Uso geral, para ir do panorama ao trabalho.

## Métricas de sucesso

- **Baseline**: desconhecido; medir é parte da entrega (Pendência abaixo).
- **Meta**: (1) o Alexandre para de perguntar às sessões "o que você fez?"; (2) o Mindscape vira o lugar onde ele começa o dia, indo dele para o terminal da sessão. Sem número definido ainda.
- **Como medir**: (1) contagem semanal de vezes em que ele pergunta "o que você fez?" a uma sessão; (2) a definir na entrega.

O Alexandre descartou "aposentar o Modo Dev" como métrica.

## Fora de escopo

- Texto de terminal ao vivo no quadro: o Alexandre não quer olhar texto subindo, e a sessão no quadro é só um post-it leve.
- Mexer no Modo Dev: "deixa ele ali quietinho"; o Alexandre falará dele depois.

## Pendências

- Ideias para depois, a decidir no corte de versões: rabiscar no quadro, prints no quadro, a sessão ler os post-its, captura relâmpago (Ctrl+Alt+N), cartas do dia.
- Avaliar o Excalidraw (open source) como base inteira do quadro, o que traria rabisco, ligações e prints juntos — decisão da etapa de arquitetura, comparando com alternativas. Preferência do dono: "Eu adoro o traço feito à mão e combina MUITO com o Jobu". A avaliar: post-its de sessão vivos dentro dele e o peso de memória.
- Quando a sessão escreve o post-it dela: só ao terminar, ou também em marcos do trabalho.
- Como fica o destaque de uma sessão em erro (a regra de destaque do dono cobre finalizada, esperando decisão, em curso e sem novidade).
- Significado das ligações entre sessões (direção, o que representam).
- Significado de cada cor (o vermelho atual coincide com "permissão pendente").
- Se a arrumação do quadro fica guardada ao fechar o app (assumido que sim, a confirmar).
- Onde o Mindscape mora no app: o protótipo o pôs como modo ao lado de "Uso geral" (a confirmar).
- Medir os baselines das duas métricas.
- Contexto Seazone ausente: sem card no TaskDex, sem canal no Slack (ferramenta pessoal), pasta do projeto no vault Obsidian inexistente nesta máquina.
- Buscas de anti-duplicação não concluídas: duas no GitHub seazone-tech não rodaram por limite; a KB não foi consultada.
- Convenção do repo é `specs/NNN-<slug>/` e este spec está em `docs/produto/`; a /pda decide se migra.

## Referências

- handoffs/maestri-referencia.md (leitura do produto Maestri, 2026-10-23)
- handoffs/modo-dev-estado-atual.md
- handoffs/prototipo-mindscape.md
- docs/pesquisas/visao-visual-multi-sessao-postit.md
- docs/prototipos/mindscape/ (index.html, final.html, decisao.md)
- design/design-handoff.md (Brief 13, linhas 702-745)
- specs/001-mvp/spec.md (US-10, US-16)
