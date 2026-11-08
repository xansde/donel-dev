# Mindscape: gargalos do ambiente e o que fechar (t-dda3571f)

Pedido do dono (08/11): "Hoje o dia é de melhora do ambiente. Preciso que o mindscape me permita ver gargalos no
ambiente de desenvolvimento. Além disso, saber quais sessões fechar. Tenho a impressão que as 48 sessões nas VPSs não
estão de fato trabalhando por conta".

Porta C da esteira (feature pequena): refinamento rápido, fatiamento, implementação. Um PR só, em três fatias por camada.

## O que se mede, e onde

| Sinal | Fonte | Por quê |
|---|---|---|
| Está trabalhando de verdade | tela do tmux da sessão (spinner `… (` ou "esc to interrupt") | o hook que chega ao app pode se perder; a tela não mente |
| Esperando a API / repetindo chamada | fim do transcript: última entrada é pedido, ou `system/api_error` sem resposta depois | separa "trabalhando" de "pendurada na API" |
| Travada e por quê | última mensagem do assistente é `isApiErrorMessage` e nada respondeu depois | 429 do gateway, limite da conta, gateway fora (ECONNREFUSED), tempo esgotado, login |
| Presa em permissão / pergunta | prompt na tela | é do dono, nunca "pode fechar" |
| Ociosa / pode fechar | turno fechado (`turn_duration`) há menos / mais de 60 min; ou sessão que nunca recebeu pedido | "terminou e ficou esquecida" |
| Peso | RSS e ticks de CPU da árvore de processos do pane (`/proc`) | CPU % sai da diferença entre duas leituras |
| Conta | gateway (`ANTHROPIC_BASE_URL` do lugar, só host:porta) ou a conta ativa do lugar no motor de contas | "qual conta ela usa e se está sem cota" |
| Máquina | saúde do PC e das VPS (já existia) | RAM, swap, carga |
| Quem espera quem | setas mãe → filha do quadro + o pulso das duas pontas | filha esperando mãe, mãe esperando filha, e o caso grave: esperando quem está travado |

## Decisões (reversíveis, do Dev)

1. **Ler na própria máquina, no mesmo ssh da saúde das VPS** (uma vez por minuto), em vez de confiar só nos hooks.
   É o único jeito de responder "está trabalhando de verdade?" quando o túnel de hooks caiu. Custo medido: 0,26 s
   para 17 sessões. Sem `python3` no lugar, o painel cai para o semáforo (os hooks) e diz "pelos sinais do app".
2. **O pulso é um eixo à parte.** Não substitui `sessionAxes.ts` nem decide vivo/fechado (isso é da t-31367b43,
   a pedido do Líder): só diz o que uma sessão aberta está fazendo.
3. **"Pode fechar" = turno fechado há 60 min ou mais, ou aberta há 60 min sem nenhum pedido.** Pré-marcadas só
   essas; ociosas e travadas aparecem desmarcadas (travada por gateway volta sozinha quando o gateway volta).
   Nunca oferecidas: trabalhando, esperando a API, esperando o dono, o Líder, sessão sem aba no app.
4. **Fechar em lote = o mesmo fechamento do `sessao_fechar`** (fecha a aba; a sessão remota termina com ela).
   A conversa fica guardada e dá para retomar.
5. **Forma: um botão "Gargalos" na faixa do quadro + painel por cima do quadro + uma linha no cartão.** Mesmo molde
   do "Números da factory" (já aprovado). Só uma forma defensável para uma lista acionável com caixas de marcar,
   por isso sem protótipo de variantes.

## Fora desta entrega

- Sessões vivas num lugar mas sem aba no app aparecem na lista, sem caixa de fechar.
- Peso (RAM/CPU) por sessão no PC: o PC mostra RAM da máquina; por sessão só nas VPS.
- "Retomar em lote" as travadas quando o gateway volta.
