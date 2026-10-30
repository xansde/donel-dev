# Glossário — Donel Dev

**Mindscape**:
Quadro visual livre onde o dono acompanha sessões e anotações de um projeto; o app tem um
mindscape por projeto, trocado por abas.
_Evitar_: canvas, mural, quadro (sozinho), mapa

**Post-it de sessão**:
Cartão do Mindscape que representa uma sessão viva, com selo "SESSÃO", glifo de estado e nome
em mono. Não mostra texto de terminal.
_Evitar_: card de sessão, nó, terminal

**Post-it escrito pela sessão**:
Cartão ao lado do post-it de sessão com a última resposta do assistente, gravado pelo app no
fim de cada turno, sem modelo.
_Evitar_: resumo, resumo da IA, nota da sessão

**Post-it do dono**:
Cartão criado pelo dono no Mindscape, com cor e posição livres; é a carta do Tomo do Donel.
_Evitar_: nota, anotação, card

**Ligação**:
Seta ou linha presa a dois post-its do mesmo mindscape; acompanha os post-its quando eles se
movem. Nasce ao desenhar com `A` ou `L` de um post-it a outro.
_Evitar_: conexão, aresta, seta (sozinha)

**Desenho**:
Elemento que o dono põe no Mindscape com as ferramentas — rabisco, seta ou linha solta,
retângulo, elipse, print. Não se prende a post-it e fica sempre abaixo deles.
_Evitar_: forma (para o conjunto), anotação, elemento

**Rabisco**:
Traço à mão livre do lápis (`P`); um tipo de desenho.
_Evitar_: freehand, desenho (para o traço)

**Aviso de sessão**:
Notícia de que uma sessão fora da vista do dono terminou, precisa dele, parou com erro ou
encerrou sozinha. Nasce num lugar só (`src/shared/attention/rule.ts`) e sai pelo balão do Jobu
ou, com ele desligado, pelo toast do Windows; a aba em foco com a janela em foco nunca avisa.
_Evitar_: alerta, notificação (para a notícia em si; toast é só um dos canais)

**Selo da barra de tarefas**:
Número sobre o ícone do Donel na barra de tarefas do Windows com as sessões esperando o dono
(pendência ou terminou sem ver); some quando ele olha a aba.
_Evitar_: badge (no texto da UI), contador
