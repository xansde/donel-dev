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
    date: '2026-10-31',
    items: [
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
