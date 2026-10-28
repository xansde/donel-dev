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
    date: '2026-10-28',
    items: [
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
