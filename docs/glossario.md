# Glossário — Donel Dev

**Modo YOLO**:
Configuração por projeto, desligada por padrão, em que todo pedido de permissão é aprovado na hora, em
qualquer modo de permissão. Perguntas e aprovação de plano continuam chegando ao dono.
_Evitar_: bypass, auto (`auto` é um modo de permissão do CLI)

**Mindscape**:
Quadro visual livre onde o dono acompanha sessões e anotações de um projeto; o app tem um
mindscape por projeto, trocado por abas.
_Evitar_: canvas, mural, quadro (sozinho), mapa

**Post-it de sessão**:
Cartão do Mindscape que representa uma sessão viva, com selo "SESSÃO", glifo de estado e nome
em mono. Não mostra texto de terminal.
_Evitar_: card de sessão, nó, terminal

**Lugar**:
O post-it de sessão visto como posição estável no quadro, acima da conversa: guarda a conversa do
momento e as anteriores, e o papel. Renovar em voo, `/clear`, fork na mesma aba e retomar mudam a
conversa, nunca o lugar. Pode existir "ainda não começou" (sem conversa); dois cliques abre a sessão.
_Evitar_: seat, slot, cartão novo (quando é a mesma posição)

**Papel**:
Orientação fixa de um lugar (Dev, Revisor, Pesquisa…), arquivo do app em `<userData>/papeis/<id>.md`
com nome, cor e motor/modelo/esforço/permissão sugeridos. O app reentrega a orientação em todo
lançamento, retomada e renovação. Só troca enquanto o lugar ainda não começou; outro papel = outra
sessão, e o trabalho é delegado.
_Evitar_: persona, agente (para o papel), perfil

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
