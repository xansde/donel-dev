// Novidades da versão — o que o dono vê na primeira abertura depois de atualizar.
// Uma entrada por dia, a mais nova primeiro. Texto de usuário: o que muda para
// quem usa, sem nome de arquivo, PR ou jargão de código.

export interface PatchNoteItem {
  readonly title: string;
  readonly text: string;
}

export interface PatchNoteDay {
  /** `AAAA-MM-DD`; ordena e decide o que já foi visto. */
  readonly date: string;
  readonly items: readonly PatchNoteItem[];
}

export const PATCH_NOTES: readonly PatchNoteDay[] = [
  {
    date: '2026-11-06',
    items: [
      {
        title: 'O endereço https do Oráculo abre no celular',
        text: 'O QR de Preferências → Celular, com o https da Tailscale ligado, agora abre o Oráculo no celular, em vez de ficar carregando até dar erro. O comando mostrado ali para ligar o https mudou: rode o novo uma vez e pareie o celular de novo. Pelo https o Oráculo grava áudio pelo microfone e avisa quando uma carta espera você.',
      },
      {
        title: 'Pedido falado: ouça antes de mandar',
        text: 'No "Pedir" do Oráculo pelo celular, depois de parar a gravação o áudio aparece para você ouvir. Aí você escolhe "Usar este áudio", e ele vira texto para você conferir, ou "Descartar" e grava de novo. Anexar um áudio que já está no celular continua possível, pelo link discreto embaixo do Gravar, e passa pelo mesmo ouvir antes de usar. Se a página estiver no endereço sem https, o Gravar explica que precisa do endereço https em vez de abrir a pasta de arquivos. E o texto ditado pelo teclado não chega mais cortado: ao tocar em Enviar, o Oráculo espera o teclado terminar de escrever antes de mandar.',
      },
      {
        title: 'Os avisos das sessões não atropelam mais o que você digita',
        text: 'Quando você digita no terminal de uma sessão, os avisos das outras ("◆ … terminou") e as mensagens entre sessões esperam você enviar. Os que chegarem nesse meio-tempo entram juntos, num aviso só, logo depois da sua mensagem. Se um aviso estiver sendo escrito no exato momento em que você começa a digitar, as suas teclas entram logo depois do Enter dele, nunca no meio. E o que você manda pelo chat, pelo Jobu, pelo "Pedir" do celular ou escrevendo numa carta passa na frente dos avisos que ainda não começaram e nunca entra grudado a eles. Nenhum aviso se perde.',
      },
      {
        title: 'Escrever na carta pelo celular não perde mais o texto',
        text: 'Quando o que você escreve numa carta não sai (a Tailscale caiu, o computador demorou a responder), a carta mostra em vermelho o motivo e guarda o texto no celular, mesmo se você fechar o Oráculo ou a lista recarregar. O botão vira "Tentar de novo", e tentar de novo nunca manda duas vezes. Quando sai, aparece o aviso "Saiu" e o texto fica na carta com para quem foi; na próxima vez que você abrir, ele continua lá. Ao abrir "Escrever", o botão Enviar aparece na tela, sem ficar escondido embaixo.',
      },
      {
        title: 'Pedir ao Líder pelo celular, escrevendo ou falando',
        text: 'O Oráculo no celular ganhou o botão "Pedir", no topo. Escreva ou grave o que você quer: o áudio é transcrito no seu computador, pelo OpenWhispr, e você confere e corrige o texto antes de enviar. O pedido vai direto para o chat do Líder. Se ele estiver fechado, o computador guarda o pedido e entrega quando o Líder abrir, mesmo que o Donel reinicie no meio. Em "Seus pedidos" você vê cada um: na fila, entregue, ou a tarefa que ele virou. Para gravar direto na página, use o endereço https do Oráculo.',
      },
      {
        title: 'O Oráculo no lugar da conversa do Líder',
        text: 'Você fala com o Líder pelo Jobu, então a janela do Donel não repete mais essa conversa. No lugar dela, o centro mostra o Oráculo Harrow com as cartas que esperam você, de todos os quadros. As sessões continuam a um clique: "Terminais", no alto (ou Ctrl+Shift+O), e "Conversa do Líder" quando quiser ver a dele. Abrir uma sessão, clicar numa aba ou numa notificação já leva aos terminais, e o Donel lembra onde você parou. Para voltar ao jeito antigo, desligue "Mostrar o Oráculo no centro" em Preferências, em Avisos e Jobu.',
      },
      {
        title: 'Cartas do Oráculo grandes no celular, com zoom',
        text: 'No Oráculo pelo celular, o print ou o protótipo agora ocupa quase a carta toda, e a letra ficou maior. Embaixo fica a opção recomendada, a um toque, e "caminhos" abre as outras com o porquê. "⤢ Tela cheia" abre a prova na tela inteira: no print dá zoom com a pinça ou a roda do mouse e dá para arrastar; o protótipo fica navegável. Para sair, o ✕, o voltar do celular, o Esc ou, no print, arrastar para baixo. No computador, a prova fica à esquerda e a decisão num painel à direita.',
      },
    ],
  },
  {
    date: '2026-11-05',
    items: [
      {
        title: 'Cada sessão só com as ferramentas do papel',
        text: 'Uma sessão aberta com papel agora carrega só os conectores (MCPs), plugins e skills que o papel usa, e não tudo o que está instalado. Dev e Revisor veem só o GitHub e o Donel; Pesquisa, a base de conhecimento, a Nekt e o Google Workspace; o Líder continua com tudo. A sessão sobe mais rápido e gasta bem menos memória. Um papel seu que não diga nada continua como antes; o que ele usa se escreve no topo do arquivo do papel (veja "mcps", "plugins" e "skills").',
      },
      {
        title: 'Sem o Donel, nada vai ao Slack',
        text: 'Uma sessão na VPS continua rodando mesmo com o Donel fechado no computador. Agora, se ela tentar mandar mensagem no Slack nessa hora, o envio é recusado, porque não dá para conferir a sua carta. A sessão fica sabendo o motivo e espera o Donel voltar.',
      },
      {
        title: 'Aviso no celular quando uma carta espera você',
        text: 'O app do Oráculo no celular ganhou um sino. Toque nele e permita as notificações: quando uma carta passar a esperar você, o celular avisa com o título dela, mesmo com o app fechado, e o toque abre a carta. O aviso precisa do endereço https da Tailscale: o passo a passo está nas Preferências do celular, e depois você pareia de novo pelo QR. No iPhone, adicione o Oráculo à Tela de Início antes de tocar no sino.',
      },
      {
        title: 'Mensagem no Slack em seu nome só com a sua carta',
        text: 'Antes de mandar qualquer mensagem no Slack em seu nome, a sessão agora cria uma carta no Oráculo Harrow com o destino, a thread, o texto exato e o motivo, e espera você. Aceitar libera aquele texto, para aquele destino, uma vez. Rejeitar não envia nada, e o motivo que você escreve diz à sessão o que ajustar. Sem carta aceita, o Donel bloqueia o envio por qualquer caminho: o Slack, o Composio, um comando ou um script.',
      },
      {
        title: 'Sem limite de sessões abertas por um Líder',
        text: 'Um Líder (ou o Líder único, em cada quadro) agora abre quantas sessões precisar sem pedir sua permissão. Se quiser um teto, escolha em Preferências, em "Limite de sessões abertas por um Líder": passando dele, volta a aparecer "Precisa de você" para permitir ou negar.',
      },
      {
        title: 'Sessões na VPS também anexam print e protótipo',
        text: 'Uma sessão que roda na VPS agora entrega print, vídeo ou protótipo como prova, e eles aparecem na carta como os das sessões do computador. O app busca o arquivo pela conexão com a VPS, recusa atalho e arquivo grande demais, e guarda uma cópia aqui.',
      },
      {
        title: 'Escreva na carta para quem fez',
        text: 'Na frente da carta, "✎ Escrever para…" abre uma caixa de texto (no celular, dá para ditar). "Enviar" manda na hora para a sessão que fez a tarefa; se ela estiver fechada, vai para o Líder; se ninguém estiver aberto, fica guardado na carta. A carta mostra para onde foi e continua esperando você, e a resposta chega como uma carta nova. Se você escolher um caminho com algo escrito, o texto vai junto da decisão. O verso mostra a conversa em ordem.',
      },
      {
        title: 'Protótipos dentro da carta',
        text: 'Quando quem fez a tarefa anexa um protótipo, ele roda dentro da carta, no celular e no Mindscape: dá para clicar nos botões dele ali mesmo, sem abrir link nenhum. "⤢ Tela cheia" amplia. O protótipo roda isolado: não acessa a internet, não vê os seus dados do app nem abre outra janela. Vídeos agora tocam dentro da carta também no Mindscape.',
      },
      {
        title: '"Esperando você" no Mindscape abre as cartas',
        text: 'No Mindscape, o botão "esperando você" da faixa do Oráculo Harrow agora abre as cartas sobre o quadro: a mão de cartas à esquerda e a carta grande no centro, igual ao celular. Na frente, a pergunta, o print ou as checagens, a recomendação e os caminhos; clique num caminho e clique de novo para decidir. "↻ Virar" mostra o verso com o que aconteceu, o risco de cada caminho, quem fez pelo nome e, recolhidos, o seu pedido e os detalhes técnicos. Esc ou "Fechar" volta ao quadro.',
      },
      {
        title: 'Cartas do celular: a frente decide, o verso explica',
        text: 'No app do celular, a carta de uma entrega que espera você mostra na frente a pergunta, o print ou o quadro de checagens, a recomendação com o porquê e os caminhos com o efeito de cada um. Toque num caminho e toque de novo para decidir: a tarefa fecha do jeito que aquele caminho diz, e o nome dele fica no histórico. "↻ Virar" mostra o verso: o que aconteceu, o risco de cada caminho, quem fez (pelo nome no quadro), o seu pedido e os detalhes técnicos, recolhidos. Entrega sem pergunta para você continua na carta de antes.',
      },
      {
        title: 'Entregas que esperam você chegam com pergunta e opções',
        text: 'Toda entrega de risco alto agora traz, para você, a pergunta que você decide, de 2 a 4 caminhos com o efeito de cada um, a recomendação com o porquê e o risco. Um texto com código (número de tarefa, branch, PR, caminho de arquivo, link) volta para quem entregou reescrever. As cartas que mostram isso chegam nas próximas versões. Atenção: depois desta versão, um Donel Dev mais antigo aberto ao mesmo tempo só consegue ler o Oráculo Harrow, sem decidir nada, até ser atualizado.',
      },
      {
        title: 'Sessões na VPS conversam com o Donel',
        text: 'Uma sessão que você abre na VPS pelo Donel agora conecta nas ferramentas do Donel, como acontece no computador: ela lê o quadro, abre sessões e cria tarefas e cartas no Oráculo Harrow. Antes ela subia sem essas ferramentas.',
      },
      {
        title: 'Progresso do Jobu só com o que está rolando',
        text: 'O painel de progresso do Jobu mostra só as tarefas abertas, em execução, entregues esperando decisão e rejeitadas. Uma tarefa aceita sai do painel na hora e deixa de contar nas barras. Quando não há nada em andamento, o painel diz "Nada rodando agora".',
      },
      {
        title: 'Botão direito move o Mindscape',
        text: 'No Mindscape, segurar o botão direito e arrastar move o quadro igual à ferramenta mão, com qualquer ferramenta escolhida, inclusive a de seleção. O botão esquerdo continua selecionando e desenhando como antes.',
      },
      {
        title: '"Esperando você" só quando a sessão pede algo',
        text: 'A lista "Esperando você" do Jobu (e o número na barra de tarefas) agora mostra só as sessões com pergunta, permissão ou diálogo aberto na tela. Sessão que só terminou o que fazia não entra mais nela; o aviso de "terminou" continua. E a marca some assim que a sessão volta a trabalhar depois de você responder, em vez de ficar até o próximo passo dela.',
      },
      {
        title: 'O registro de tarefas agora se chama Oráculo Harrow',
        text: 'A faixa de tarefas no topo do Mindscape, o progresso no balão do Jobu, a seção de Preferências e o app do celular passam a chamar o registro de tarefas entre sessões de Oráculo Harrow, para combinar com o resto do Donel. Nada muda no funcionamento: as tarefas, as provas e as decisões que já existiam continuam lá. Se o app do celular já estava na tela inicial, o nome novo aparece quando você adicioná-lo de novo.',
      },
      {
        title: 'Saúde das VPS ao lado da saúde do computador',
        text: 'Ao lado de "PC · RAM · disco", no rodapé, aparece agora uma linha para cada VPS configurada, com a memória em uso e o disco livre. O painel de saúde ganhou uma seção por VPS com memória, disco, carga do processador e quantas sessões do Donel rodam lá. As VPS são lidas a cada minuto e na hora em que você abre o painel. Quando uma não responde, ela aparece como "sem sinal", com a hora da última leitura boa, e o resto do app segue normal.',
      },
      {
        title: 'Progresso das tarefas no Jobu, quando você quiser',
        text: 'O balão do Líder ganhou o botão ▤, que abre o progresso das tarefas: uma linha por quadro e, recuadas embaixo, as tarefas dele, cada uma com uma barra e uma data estimada de fim. A barra conta as etapas da tarefa (assumida, entregue, aceita), e cada linha diz de onde veio a data: do prazo enquanto ninguém assumiu, do ritmo das etapas depois, avisando quando passa do prazo. O painel fica fechado por padrão, sem som nem notificação, e o Jobu lembra se você o deixou aberto. Ele se atualiza a cada tarefa assumida, entregue, aceita ou rejeitada e a cada sessão que termina, e mostra a hora da última atualização. Quando algo muda e o balão está fechado, aparece só um pontinho no Jobu; um clique nele abre o progresso.',
      },
      {
        title: 'Um Líder só, para todos os quadros',
        text: 'O Jobu agora fala com um Líder único, que não pertence a nenhum quadro: ele lê e mexe no Donel Dev, na Homologação e no BizOps, abre sessões em qualquer um deles, manda mensagem, cria tarefas e fecha sessões. Ele fica acima do topo de cada quadro, então alcança quem está no topo e quem está abaixo pelas setas que você desenhou ou que nasceram quando uma sessão abriu outra; uma seta que uma sessão desenha sozinha não muda isso. Quem ele abre nasce ligado a ele, e ele é avisado quando essas sessões terminam. Só é Líder único a sessão aberta pelo Jobu: um Líder aberto pela VPS ou pelo Launcher continua sendo uma sessão comum. Os Líderes que cada quadro tinha viram lugares comuns: continuam no quadro com a conversa e as setas, mas o Jobu não fala mais com eles.',
      },
      {
        title: 'Só o Líder do Jobu se acha o Líder único',
        text: 'Uma sessão com o papel Líder aberta num quadro (pelo Launcher, pela VPS ou por outra sessão) agora recebe a orientação de Líder daquele quadro; só a aba que o Jobu abriu recebe a de Líder único. E a seta que nasce quando uma sessão abre outra só pode ser apagada por quem abriu (ou por você): outra sessão não tira mais esse alcance.',
      },
      {
        title: 'Conversa do Jobu do tamanho que você quiser',
        text: 'O balão de conversa com o Líder no Jobu pode ser aumentado: arraste o canto de cima (o lado oposto ao Jobu) ou use o botão ⤢ para levá-lo ao maior tamanho que cabe na tela, e ⤡ para voltar ao normal. O tamanho escolhido fica guardado para as próximas vezes.',
      },
      {
        title: 'Celular: o que precisa antes do QR',
        text: 'Em Preferências → Celular, antes de parear, a tela explica que o celular precisa do app Tailscale instalado e logado na mesma conta deste PC, e mostra se já há algum celular na sua Tailscale (e se está conectado). Se o celular não abrir a página, "O celular não abriu a página?" confere o Firewall do Windows e, se faltar, oferece liberar só a porta do app para quem está na sua Tailscale, com a confirmação de administrador do Windows.',
      },
      {
        title: 'Rotina em sombra: sessão parada e ninguém vê',
        text: 'Com o app aberto, uma rotina olha os quadros a cada 5 minutos e anota quando uma sessão está parada (ou sem sinal) há mais de 8 horas, ou esperando você há mais de 30 minutos. Por enquanto ela só observa: ninguém é acordado e nada muda nas sessões. Na barra do Mindscape, "em sombra: N achados hoje" mostra quantas vezes ela teria chamado o Líder daquele quadro; um clique abre a lista. Ela só avisa a mesma sessão uma vez, espera confirmar em duas olhadas seguidas, chama no máximo 5 por hora e 15 por dia, e se desliga sozinha por uma semana quando a maior parte do que aponta se resolve sozinha.',
      },
      {
        title: 'Pasta de envio do navegador: Permitir ou Negar, e fica lembrada',
        text: 'Quando a sessão quer enviar um arquivo por uma página e a pasta dele ainda não está autorizada, o navegador abre mostrando qual é a pasta, com os botões Permitir e Negar. Antes ela não sabia como pedir e o aviso não dizia o que fazer. A pasta permitida fica guardada: vale para todas as sessões e não some mais quando o app reinicia. Para ver e remover as pastas, abra Regras no navegador, em Envio de arquivos.',
      },
      {
        title: 'Pasta larga no envio de arquivos pede confirmação',
        text: 'O pedido de pasta agora mostra também o nome do arquivo que a sessão quer enviar. Se a pasta for larga, como Documentos, Área de Trabalho ou Downloads (também dentro do OneDrive), aparece um aviso e o Permitir pede um segundo clique, "Sim, liberar a pasta inteira"; pelo seletor em Regras, uma caixa de confirmação. E uma sessão só pede uma pasta de cada vez.',
      },
      {
        title: 'Tarefas com prova no topo do Mindscape',
        text: 'As sessões agora registram as tarefas que passam entre elas: a frase de quem pediu, quando está pronto, o prazo, quem faz e o risco. Ninguém marca uma tarefa como entregue sem anexar prova (print, vídeo, a saída de um comando ou o link do CI), e quem entregou não pode aceitar a própria entrega. Um Revisor aceita as de risco baixo; as de risco alto esperam você. No topo de cada quadro aparece uma faixa, o Oráculo Harrow, com os números: abertas, em execução, entregues sem aceite, esperando você (com a mais velha) e quantas foram validadas sem você. Clique em "esperando você" para ver cada entrega com a prova e aceitar ou rejeitar com um motivo. Na primeira semana, até três aceites do Revisor por dia também aparecem ali, para você conferir.',
      },
      {
        title: 'O Revisor só aceita depois de ver a prova, e de fora da cadeia',
        text: 'O Revisor agora lê a prova inteira (o texto, o link e o print) antes de aceitar ou rejeitar; sem isso o aceite é recusado. Ele só decide tarefas do próprio quadro e nunca as de quem o abriu. E uma tarefa criada em risco baixo pelo próprio dono do trabalho, ou por uma sessão que ele abriu, passa a esperar você.',
      },
      {
        title: 'Validar entregas pelo celular',
        text: 'Em Preferências, Celular, ligue "App do celular para validar entregas" e toque em "Parear um celular": aponte a câmera do celular para o QR e adicione a página à tela inicial. Cada entrega que espera você vira uma carta, uma por tela: arraste para a direita para aceitar ou para a esquerda para rejeitar, contando o motivo (dá para ditar). Os botões embaixo fazem o mesmo, e o que você decide pelo celular conta como validação sua. Só funciona pela sua Tailscale, nada sai para a internet, e você revoga um celular na mesma tela.',
      },
      {
        title: 'No celular, a saída de comando vem resumida e sem senhas',
        text: 'A carta mostra só o começo da saída de um comando; toque em "Ver a saída inteira" para ler o resto. Chaves e tokens que aparecem nela (como sk-…, ghp_…, "Bearer …" ou API_KEY=…) chegam ao celular escondidos. E uma decisão que você mandou não grava duas vezes, nem se o app reiniciar no meio.',
      },
      {
        title: 'O time do Líder continua fora das abas depois de atualizar',
        text: 'As sessões que o Líder abriu voltavam para as abas depois de atualizar o app ou de reabri-lo com sessões vivas na VPS. Agora elas voltam como estavam: trabalhando, fora das abas, acompanhadas pelo lugar delas no Mindscape. Dois cliques no lugar continuam trazendo a sessão para as abas.',
      },
      {
        title: 'Retomar avisa enquanto procura a conversa na VPS',
        text: 'Ao retomar uma sessão cuja conversa não está neste computador, o app pergunta à VPS onde ela está, o que pode levar alguns segundos. Antes o clique parecia não fazer nada; agora aparece "Procurando a conversa…" até a resposta chegar.',
      },
      {
        title: 'Mensagens entre sessões não ficam mais paradas na caixa',
        text: 'Com o PC carregado, o pedido de uma sessão recém-aberta, e às vezes a mensagem para uma sessão parada, ficava na caixa do terminal (como "[Pasted text #1 …]" ou o próprio texto) e nunca era enviado, até você apertar Enter. Agora o app espera o Claude de lá mostrar a mensagem, aperta o Enter e confere se ela saiu, repetindo só o Enter se precisar (o texto nunca vai duas vezes). Quem mandou só ouve "Entregue" depois que entrou de verdade. E o estado fala a verdade: "começando" enquanto a sessão não pegou o pedido e, depois de um minuto e meio, "não começou" com o motivo, avisado também a quem a abriu.',
      },
      {
        title: 'O Enter do app não leva o que você digitou junto',
        text: 'Se você escrever na caixa de uma sessão logo depois que chegou uma mensagem de outra sessão, o app não aperta mais o Enter por ela: sua digitação não sai misturada com a mensagem. E a sessão que mandou ouve que não deve repetir enquanto a primeira ainda não entrou, para nada chegar duas vezes.',
      },
    ],
  },
  {
    date: '2026-11-04',
    items: [
      {
        title: 'O navegador abre arquivo deste computador',
        text: 'O HTML que uma sessão gerou agora abre direto no navegador ao lado da conversa, sem sair do app. Vale para página HTML, imagem e PDF: a sessão abre pelo caminho do arquivo, e você também pode colar o caminho (C:\\pasta\\relatorio.html) na barra de endereço. A página aberta não navega para outro arquivo nem mostra a pasta onde está.',
      },
      {
        title: 'O Líder fecha as sessões que abriu',
        text: 'Uma sessão agora fecha as sessões que estão abaixo dela no quadro (pelas setas, direto ou em cadeia), em vez de deixar as abas para você fechar. Nunca fecha a si mesma nem quem está acima ou ao lado. Só valem as setas que você desenhou e as que nascem quando uma sessão abre outra; uma seta que a própria sessão desenha não a põe acima de ninguém. Para fechar em outro quadro, só o Líder que você pôs num quadro marcado com "Alcance: todos os quadros", botão novo na barra do Mindscape; sem marcar, cada quadro só alcança a si mesmo. Se a outra está trabalhando, recebe antes um aviso para pausar e espera o turno acabar (até 20 segundos). Com um pedido de permissão aberto lá, não fecha. O lugar continua no quadro como "fechada" e dois cliques retomam a conversa. A cópia isolada (worktree) sem mudanças é recolhida como ao fechar a aba; com trabalho pendente, nada se apaga.',
      },
      {
        title: 'Mensagem entre sessões chega sozinha',
        text: 'A mensagem que uma sessão manda para outra, e o aviso de que uma sessão terminou, agora entram na hora, mesmo com a outra trabalhando: vão para a fila do próprio Claude de lá, como quando você digita no terminal com ele ocupado. Nada fica mais "Retida" esperando você abrir a aba. Só uma permissão aberta na tela de lá segura a mensagem, e ela entra sozinha quando a permissão fecha. Sessão que terminou o turno sem pedir nada não aparece mais como "precisa de você", e cada aviso de término chega uma vez só.',
      },
      {
        title: 'Retomar abre a sessão onde ela vive',
        text: 'Uma sessão que nasceu na VPS agora retoma na VPS, mesmo que você esteja retomando deste computador: dois cliques no lugar dela no Mindscape ou um clique nos Favoritos. Antes ela abria aqui e falhava, porque a conversa está gravada lá. Se a VPS não responder, o app avisa em vez de abrir uma sessão vazia.',
      },
      {
        title: 'Só o Líder nas abas; o time fica no Mindscape',
        text: 'As sessões que o Líder abre não aparecem mais nas abas nem na lista da barra lateral: continuam trabalhando e você acompanha cada uma pelo lugar dela no Mindscape. Dois cliques no lugar trazem a sessão para as abas; fechar a aba a esconde de novo, sem parar a sessão. Quando uma delas precisa de você, o aviso continua chegando pelo Jobu, e clicar nele também traz a sessão.',
      },
      {
        title: 'Régua de contexto vai até 500k',
        text: 'A barra de contexto da sessão agora mede até 500k (antes 300k): 250k usados aparecem como 50%. No Haiku a régua continua sendo a janela dele, 200k.',
      },
      {
        title: 'Chat das sessões na VPS volta a enviar',
        text: 'Na VPS, o chat não conseguia mandar mensagem: a sessão abria, mas o texto nunca chegava ao Claude de lá, e às vezes aparecia lixo como ";23;24;28c" na caixa. As sessões novas na VPS agora recebem as mensagens normalmente.',
      },
      {
        title: 'Uma sessão daqui abre sessões na VPS',
        text: 'Uma sessão que roda neste computador agora pode abrir uma sessão com papel na VPS (ou o contrário), em vez de só no mesmo lugar onde ela roda. Ela vê os lugares disponíveis e escolhe pelo nome.',
      },
      {
        title: 'Converse com o Jobu, o Líder do time, num balão de fala',
        text: 'Clique no Jobu e sobe dele um balão de conversa, que vai junto quando você o arrasta. Quem responde é o Líder do projeto aberto: a primeira mensagem abre a sessão dele, onde as sessões novas rodam por padrão (a VPS, quando tem conta). A última fala dele aparece em destaque, o ≡ mostra a conversa toda, e você escreve em "você:" (Enter envia). Quem está esperando você aparece dentro do balão, com um clique para ir até a sessão, e a borda fica vermelha. Esc ou outro clique no Jobu fecha.',
      },
      {
        title: 'Sessões montam o Mindscape e trabalham em time',
        text: 'Uma sessão agora monta o quadro ao vivo, sem reabrir o app: põe lugares com papel, post-its, retângulos, setas e ligações, e cada leva entra como um gesto só, que o Ctrl+Z desfaz. Ela mexe só no que uma sessão criou, nunca no que é seu. Ela também abre outras sessões com papel (nascem ligadas a ela por uma seta, no mesmo lugar onde ela roda), manda mensagem pelas setas do quadro e é avisada quando cada uma termina. A mensagem entra direto no chat da outra, sem pedir aprovação, e só espera se houver uma permissão aberta na tela de lá. Até 4 sessões abertas por uma mesma sessão; a partir da 5ª, aparece "Precisa de você" para permitir ou negar. Novo papel pronto: Líder, que reparte o trabalho e só traz a você o que o time não resolve.',
      },
      {
        title: 'Sessão na VPS abre direto, sem tela de primeiro uso',
        text: 'Numa VPS nova, a sessão parava na escolha de tema e de login do Claude, mesmo com a conta já posta lá. Agora ela abre direto na conversa, e a pasta do projeto já vem marcada como confiável.',
      },
      {
        title: 'Lugar do Mindscape abre na VPS',
        text: 'Dois cliques num lugar com papel (○) abrem a sessão onde as sessões novas rodam por padrão, a VPS quando ela tem conta, igual ao Launcher. Antes ela abria sempre neste computador.',
      },
      {
        title: 'O app se atualiza sozinho, em qualquer PC',
        text: 'A versão nova baixa em segundo plano (a barra de baixo mostra o progresso). Quando termina, aparece "Versão nova pronta · Reiniciar": o clique espera as sessões pararem, reinicia já na versão nova e reabre as mesmas abas. Não tem instalador para procurar. Vale em qualquer computador com o gh logado no GitHub. Esta é a última vez que você instala na mão.',
      },
      {
        title: 'Preferências em tela cheia, com menu lateral',
        text: 'A engrenagem abre as Preferências na janela inteira, separadas por Projetos, Sessões, Chat, Avisos e Jobu e Papéis, com uma busca que acha qualquer ajuste pelo nome. Em Sessões dá para escolher onde a sessão nova roda por padrão. A VPS já vem escolhida quando tem conta; o Launcher lembra a última escolha. Esc fecha.',
      },
      {
        title: 'Sessões rodando na VPS, controladas daqui',
        text: 'No Launcher, o campo "Onde roda" escolhe a VPS. A sessão roda lá, com a memória e a conta de lá, e aparece aqui como qualquer outra aba: chat, terminal, Mindscape, "Precisa de você" e o navegador integrado. Se o projeto ainda não existe na VPS, ele é clonado na hora (o que não foi enviado ao GitHub não vai junto). Fechar a aba encerra a sessão lá; fechar o app não: ela continua trabalhando, e ao abrir o app de novo a aba volta sozinha.',
      },
      {
        title: 'Suas contas também numa VPS',
        text: 'No painel Contas, "Adicionar lugar remoto" cadastra uma máquina que você acessa por ssh sem senha (por exemplo a VPS pelo Tailscale). Cada lugar escolhe a sua conta numa lista, e o Claude Code de lá passa a usá-la na próxima mensagem, sem login nenhum lá. Uma conta nunca fica em dois lugares ao mesmo tempo: a que está na VPS aparece como "em uso em VPS" e não dá para escolher aqui, e vice-versa. A troca automática vale para a VPS também, enquanto o app estiver aberto. "Nenhuma" tira a conta do lugar.',
      },
    ],
  },
  {
    date: '2026-11-03',
    items: [
      {
        title: 'Atualizar o alfa sem sair do app',
        text: 'Quando a versão nova da manhã fica pronta, aparece "Versão nova · Atualizar" na barra de baixo. O clique espera as sessões pararem (nada é cortado no meio de uma resposta ou de uma pergunta para você; dá para cancelar), fecha o app, instala e abre de novo com as mesmas abas, cada conversa retomada no mesmo lugar do Mindscape. Se a instalação falhar, a versão de antes volta e a barra diz o que houve. Se a build da manhã falhar, a barra avisa e abre o log.',
      },
      {
        title: 'Cartão da sessão mais completo no Mindscape',
        text: 'Cada cartão mostra o motor (por exemplo "opus 5.5") e quanto do contexto já foi usado ("38% · 152k", na mesma cor do rodapé do chat). Um anel em volta do ícone diz o estado num relance: vermelho quando precisa de você, azul trabalhando, tracejado quando o app ainda não sabe. Embaixo, "aberta · trabalhando · viva" separa o processo, a atividade e se dá para retomar, e "! 2 · permissão, pergunta" conta o que espera você e por quê. O Organizar ganhou a coluna "parada com pendência", primeiro à esquerda.',
      },
      {
        title: 'Papéis prontos: Dev, Revisor e Pesquisa',
        text: 'Três papéis já vêm prontos. Dev faz a mudança e pede revisão; Revisor confere se o prometido aconteceu, sem ser o autor, e devolve o que achou; Pesquisa lê e resume, sem mexer no código. Em "Papéis…" (no menu de "＋ Sessão com papel…" ou ao lado do campo Papel do Launcher) você muda o texto, a cor e as sugestões de modelo, esforço e permissão, ou cria um papel novo. A mudança vale na próxima vez que uma sessão com aquele papel abrir ou for retomada.',
      },
      {
        title: 'O cartão da sessão vira um lugar, com papel',
        text: 'No Mindscape, "＋ Sessão com papel…" põe no quadro um lugar que ainda não começou (○), com um papel como Revisor ou Pesquisa no selo do canto. Dois cliques nele abrem a sessão já com esse papel. O papel acompanha o lugar quando a sessão é retomada ou renovada, e o cartão continua no mesmo ponto do quadro, com o post-it e as ligações. O papel só troca antes de começar: precisa de outro, abra outro lugar e passe o trabalho. No Launcher também dá para escolher o papel, e a aba mostra "◆ Revisor".',
      },
      {
        title: 'Modo YOLO, projeto por projeto',
        text: 'Ligue na engrenagem do projeto, ou no botão "YOLO neste projeto" do próprio pedido: nesse projeto o agente age sem perguntar, inclusive em ações de fora, como abrir PR e publicar. Vale na hora, também para as sessões abertas. Perguntas e aprovação de plano continuam chegando para você, a sessão mostra a marca YOLO e a engrenagem desliga em um clique.',
      },
      {
        title: 'Modo auto não pede mais permissão',
        text: 'Quando o Claude pediria para você confirmar algo no modo auto, o Donel agora aprova na hora e deixa uma linha discreta no chat, "Permitido automaticamente: ...", para você conferir depois. Perguntas do Claude e aprovação de plano continuam chegando para você. Depois de duas ações seguidas barradas pelo próprio modo auto, o pedido também chega para você: ali o Claude Code quer alguém olhando. Há um interruptor em Preferências, "Modo auto nunca pede permissão", ligado por padrão.',
      },
      {
        title: 'Você decide onde o agente navega',
        text: 'Em "Regras", no navegador da sessão, escolha se o agente pode abrir qualquer site, só alguns domínios ou qualquer site menos alguns. Vale para aquela sessão e só para o agente: você continua navegando livre. Quando ele tenta sair do combinado, a página não muda e o rodapé do navegador mostra o bloqueio.',
      },
      {
        title: 'Senha, cartão e pagamento são com você',
        text: 'O agente não digita mais em campos de senha ou de cartão e não clica em botões de comprar, pagar ou excluir: ele para e chama você para fazer na própria página. O reconhecimento é pelo que a página diz sobre o campo ou o botão, então um site muito fora do padrão pode escapar: continue de olho quando houver dinheiro envolvido.',
      },
      {
        title: 'Abas no navegador da sessão',
        text: 'Link que abre em nova janela e popup agora viram uma aba nova no navegador da sessão, em vez de trocar a página em que você estava. As abas aparecem no topo do painel, até quatro por sessão, e o agente também sabe trocar e fechar.',
      },
      {
        title: 'O agente escolhe em listas, procura texto e envia arquivos',
        text: 'No navegador, o agente agora abre listas e escolhe uma opção, rola até um texto da página e coloca um arquivo num campo de envio. O envio só funciona de uma pasta que você autorizar em "Regras", no próprio navegador, e vale só para aquela sessão. Pastas com credenciais não podem ser autorizadas.',
      },
      {
        title: 'O agente enxerga melhor as páginas',
        text: 'Quando o agente lê uma página, ele vê só o que está na tela de verdade: o que está escondido atrás de um aviso ou de uma janela fica de fora, e o que está mais abaixo ou mais acima aparece só como contagem ("12 abaixo"). Ele também passa a enxergar e usar o que está dentro de quadros embutidos de outros sites, como formulários e players. E ganhou um jeito de ler a página inteira como texto organizado, com títulos, listas, tabelas e links.',
      },
      {
        title: 'Segundo plano à vista, sem abrir o terminal',
        text: 'Comandos, agentes e monitores que a sessão deixou rodando em segundo plano agora aparecem no chat, logo acima da caixa de texto: "⟳ 2 em segundo plano", mesmo depois que o turno acaba. Clique para ver a lista (o que é, desde quando, se terminou, falhou ou foi parada) e clique num item para ir até onde ele começou na conversa. A aba ganha um "⟳ 2" discreto, o cartão da sessão no Mindscape também, e a barra de status mostra o total de todas as sessões, com uma lista que leva até a aba certa.',
      },
      {
        title: 'Mindscape mostra todas as sessões do projeto',
        text: 'As sessões fechadas voltam ao quadro como cartões adormecidos (☾, apagados, com a data em que fecharam), com o post-it delas logo embaixo. Dê dois cliques num adormecido para retomar a conversa numa aba nova. As fechadas há mais de 7 dias ficam recolhidas em "N antigas", e as favoritas ganham ★ e nunca saem do lugar.',
      },
      {
        title: 'Botão Organizar no Mindscape',
        text: 'Um clique arruma os cartões em colunas: o que precisa de você, o que está trabalhando, o que está em espera e as fechadas, da mais recente para a mais antiga. Favoritas, seus post-its e desenhos não se mexem, e o Ctrl+Z desfaz tudo de uma vez.',
      },
      {
        title: 'Navegador dentro do Donel',
        text: 'Cada sessão ganhou um navegador de verdade, ao lado da conversa: clique em "Navegador" no topo da sessão, digite o endereço e use voltar, avançar e recarregar. Ele tem os próprios cookies, separados do seu Chrome, e um login que você fizer nele fica guardado para as próximas vezes. A opção "Navegador (Chrome/Edge)" do painel de nova sessão saiu: o navegador agora é este, integrado.',
      },
      {
        title: 'O agente usa o navegador',
        text: 'O agente da sessão agora abre páginas, lê, clica, digita e tira print no navegador da própria sessão, e cada página que ele abre aparece no rodapé do navegador; com o navegador fechado, o botão "Navegador" mostra quantas novidades chegaram. Clique em "Assumir" para usar você mesmo: o agente espera até você clicar em "Devolver ao agente". Quando ele precisar de você (um login, um captcha), o navegador abre com o pedido dele.',
      },
      {
        title: 'Sessão renovada em voo',
        text: 'Quando o contexto de uma sessão passa de 250k, no fim de um turno ela escreve uma passagem de bastão e o Donel abre uma sessão nova na mesma aba, mesma pasta e mesma conta, que começa lendo essa passagem. O chat continua mostrando a conversa anterior acima de um divisor "Sessão renovada em voo", com o link da passagem, e o cartão do Mindscape fica no mesmo lugar. Um aviso discreto aparece antes, com "Agora não" para adiar; a troca nunca acontece no meio de uma tarefa nem com trabalho em segundo plano rodando. O limite e o interruptor ficam em Preferências.',
      },
    ],
  },
  {
    date: '2026-10-31',
    items: [
      {
        title: 'Sessão numa cópia isolada do projeto',
        text: 'Marque "Isolar em worktree" no painel de nova sessão e o Claude trabalha numa cópia separada do repositório, que começa da branch em que você está, marcada com ⎇ na aba. Ao fechar a aba, a cópia some sozinha se não tiver trabalho pendente; se tiver, nada é apagado e o Donel avisa, com um botão para abrir a pasta. A faxina do Jobu também passa a recolher as cópias esquecidas.',
      },
      {
        title: 'Chat funciona com statusline configurada',
        text: 'O chat agora percebe quando o Claude está trabalhando mesmo com uma statusline configurada. Por isso cota, contexto e PR da sessão aparecem sempre no rodapé, e "Interromper e mandar agora" e o Parar funcionam também enquanto há texto na caixa.',
      },
      {
        title: 'PR de cada projeto na barra lateral',
        text: 'Cada projeto mostra o número do PR da branch, verde, amarelo ou vermelho conforme os checks, e avisa quando pediram mudanças. Clique nele para ver os checks e reviews e, se algo quebrou, mande o Claude consertar com um botão.',
      },
      {
        title: 'Observação nas perguntas do Claude',
        text: 'Agora dá para escrever uma observação em cada pergunta do Claude: clique em "+ observação" e ela vai junto com a sua resposta.',
      },
      {
        title: 'Mande mensagem com o Claude trabalhando',
        text: 'A mensagem vai na hora, aparece "na fila" e entra quando ele terminar o que está fazendo, sem precisar interromper. Se ele não pegar a mensagem, o chat avisa e oferece tentar de novo. E "Interromper e mandar agora" volta a interromper de verdade: o app espera o Claude parar antes de mandar.',
      },
      {
        title: 'Quem espera você aparece na barra de tarefas',
        text: 'O ícone do Donel mostra quantas sessões esperam você e pisca quando alguma termina, quebra ou pede algo enquanto você está em outra janela. Com o Jobu desligado, o Windows avisa "terminou", "precisa de você" ou "parou com erro: limite de uso", e um clique leva direto à aba.',
      },
      {
        title: 'O Jobu avisa uma vez só',
        text: 'Ele não avisa mais a cada agente em segundo plano que termina: fica lendo enquanto os agentes trabalham e diz "terminou" quando a sessão termina de fato.',
      },
      {
        title: 'Navegador para o Claude',
        text: 'Ligue "Navegador (Chrome/Edge)" no painel de nova sessão e o Claude passa a usar o seu Chrome ou Edge para abrir e testar páginas. O app lembra a escolha.',
      },
      {
        title: 'Branch e editor na barra lateral',
        text: 'Cada sessão e cada favorito mostram em qual branch estão e têm um botão para abrir a pasta no VS Code (ou no Cursor).',
      },
      {
        title: 'O rodapé mostra o modelo de verdade',
        text: 'Se você trocar com /model ou retomar uma sessão de outro modelo, o rodapé acompanha na próxima resposta, e o percentual de contexto usa o tamanho certo da janela. Quem tem statusline própria passa a ver também a cota de 5h e da semana lida pela sessão, sem perder a statusline.',
      },
      {
        title: 'Favoritos não perdem a sessão recém-aberta',
        text: 'Favoritar um projeto e abrir uma sessão nele logo em seguida já não tira essa sessão do grupo Favoritos.',
      },
      {
        title: 'Mindscape não perde o quadro',
        text: 'Se ele não conseguir abrir o quadro salvo, avisa e não grava nada por cima, com um botão para tentar de novo. Se não conseguir gravar, tenta mais algumas vezes, avisa e guarda suas mudanças até conseguir, inclusive ao fechar o app. Um print que não carregou também é tentado de novo sozinho.',
      },
      {
        title: 'Mindscape: barra de desenho',
        text: 'O quadro ganhou uma barra de ferramentas: retângulo (R), elipse (O), linha (L) e seta (A), com 3 cores e 3 espessuras. Uma seta puxada de um post-it a outro vira ligação, e o botão "Ligar" saiu. V volta para a seleção e H (ou espaço segurado) arrasta o quadro.',
      },
      {
        title: 'Mindscape: selecionar, mover e arrumar',
        text: 'Clique para selecionar, Shift+clique para somar, arraste no fundo para laçar vários e Ctrl+A para pegar tudo. A seleção anda junta, sai com Delete, cresce pelas alças, troca de cor e espessura pela barra e vai para frente ou para trás.',
      },
      {
        title: 'Mindscape: lápis e borracha',
        text: 'Com P você rabisca à mão livre. Com E, um círculo segue o cursor e apaga só o pedaço que toca: um rabisco pode virar dois, retângulos e ligações saem inteiros, post-it nunca sai.',
      },
      {
        title: 'Mindscape: desfazer e refazer',
        text: 'Ctrl+Z desfaz e Ctrl+Shift+Z refaz o que você fez no quadro, um gesto por vez, sem apagar o que a sessão escreveu nos post-its dela no meio do caminho.',
      },
      {
        title: 'Mindscape: zoom',
        text: 'Ctrl+roda do mouse (ou pinça no touchpad) aproxima e afasta de 25% a 400%, centrado no mouse. A roda sozinha move o quadro, com Shift para os lados. No canto inferior esquerdo, "− 100% +" ajusta, e clicar no número volta a 100%. Cada projeto lembra o próprio zoom.',
      },
      {
        title: 'Mindscape: prints no quadro',
        text: 'Cole um print com Ctrl+V ou arraste um arquivo de imagem para o quadro: ele aparece onde está o mouse, e dá para mover, redimensionar sem distorcer, apagar e desfazer. Acima de 10 MB aparece um aviso, e imagens que o quadro não usa mais são limpas sozinhas na abertura seguinte.',
      },
      {
        title: 'Mensagem mandada com o Claude ocupado não cai mais em "não foi"',
        text: 'Ainda acontecia: com o Claude rodando um comando demorado, a mensagem ficava meio minuto esperando e virava "não foi · o Claude não ficou pronto". Agora ela fica "na fila", dizendo que espera o Claude terminar o que está fazendo, e entra sozinha assim que ele libera.',
      },
      {
        title: 'Agente em segundo plano não engana mais o chat',
        text: 'Quando o Claude deixava um agente trabalhando em segundo plano e terminava a resposta, o chat continuava em "Trabalhando" e mostrava o aviso amarelo "Não estou recebendo a conversa", sem nada errado. Agora o chat fica livre e o agente aparece só no cartão dele.',
      },
    ],
  },
  {
    date: '2026-10-30',
    items: [
      {
        title: 'Janela de novidades mais fácil de ler',
        text: 'Esta janela ficou mais larga, o texto não escapa mais da caixa e cada novidade vem num cartão próprio. Com muitas novidades, só a lista rola e o botão Entendi fica sempre à vista.',
      },
      {
        title: 'Botão Novidades no rodapé',
        text: 'No canto direito do rodapé, ao lado de "PC", o botão Novidades abre esta janela de novo quando você quiser, com o que mudou nas últimas versões.',
      },
    ],
  },
  {
    date: '2026-10-28',
    items: [
      {
        title: 'Saúde do computador',
        text: 'No canto direito do rodapé aparece "PC · RAM · disco", verde, amarelo ou vermelho conforme o computador está. Clique para ver quanto de memória e de disco sobra, se o disco está enchendo e em quanto tempo enche, quem mais usa memória e qual programa está gravando demais no disco. Um programa que ficou rodando sozinho depois que quem o abriu fechou pode ser encerrado ali mesmo, com confirmação, e um botão abre a pasta temporária para apagar o que sobrou.',
      },
      {
        title: 'Novidades a cada atualização',
        text: 'Esta janela. Ela aparece uma vez na primeira abertura depois de cada versão nova, com o que mudou.',
      },
      {
        title: 'O chat mostra se o Claude está vivo',
        text: 'A barra "trabalhando" diz "pensando" quando nenhum comando roda, há quanto tempo o comando atual está rodando e quantos subagentes seguem junto. Não precisa mais abrir o terminal para conferir.',
      },
      {
        title: 'Mensagem na fila não vira mais "não foi"',
        text: 'Com o computador sem memória, mensagens mandadas enquanto o Claude trabalhava ficavam amarelas e depois eram recusadas, mesmo já estando na fila do Claude. Agora elas ficam "na fila" até a vez delas.',
      },
      {
        title: 'Contas preferidas do pool Seazone',
        text: 'No painel Contas, o botão ☆ Preferir marca contas do pool. Com alguma marcada, a troca automática só usa essas. Você ainda pode clicar em qualquer conta para trocar na mão.',
      },
      {
        title: 'Pool Seazone ao lado das suas contas',
        text: 'As contas Seazone · ... aparecem no fim da lista, junto das suas. Enquanto você usa uma delas, o Donel avisa o switcher a cada 5 minutos; se o switcher entregar a conta a outra pessoa, o Donel sai dela sozinho.',
      },
    ],
  },
];
