# Plano: Faxineiro com gatilhos em cada quadro

- Tarefa: t-b3b26e60 · prazo 09/11 · risco baixo
- Pedido do dono: "ISso deveria ser papel de uma cadeira de faxineiro dentro de cada mindscape, com gatilhos
  específicos pow" (07/11, depois de a VPS pessoal chegar a carga 24, 33 sessões, 300 MB livres e "VPS · sem sinal").
- Pronto quando: o app acorda sozinho o Faxineiro de um quadro por gatilho, ele fecha o que terminou com cada ação
  registrada, e um `sessao_abrir` numa máquina cheia espera vaga em vez de afundar a máquina. Sem o Líder nem o dono
  no caminho.

## O que já existe e é reaproveitado

| Peça | Onde | Uso aqui |
|---|---|---|
| Leitura das VPS a cada 1 min (RAM, disco, carga 1/5/15, CPUs, sessões, "sem sinal") | `src/main/health/remote-health-service.ts`, `src/shared/health/remote.ts` | entrada dos gatilhos de máquina; falta só o swap |
| Saúde do PC (RAM, disco) | `src/main/health/collector.ts` | gatilhos do PC (Windows não tem carga média: no PC, só RAM e disco) |
| Rotinas em sombra (timer no main, estado e log em `<userData>/rotinas/`) | `src/main/rotinas/routine-runner.ts` | mesma casa, mesmo `config.json` editável à mão, mesmo cuidado de `schemaVersion` |
| Sessões vivas com semáforo e "último turno" | `listLive` do runner, `sessao_listar` | gatilho "parada há 30 min" |
| `sessao_abrir` / `sessao_fechar` | `src/renderer/src/Mindscape/agentBridge.ts` | o app acorda o Faxineiro pelo mesmo caminho; a fila entra no `sessao_abrir` |
| Regra de alcance | `src/shared/mindscape/reach.ts` | ganha um ramo para o Faxineiro (a regra continua morando só lá) |

## Desenho

**1. O gatilho é código; o julgamento é do Faxineiro.** Um avaliador puro (`src/shared/faxineiro/triggers.ts`)
recebe as leituras das máquinas, as sessões vivas e o relógio, e devolve os gatilhos que dispararam. Roda no main a
cada minuto, junto da leitura das VPS. Limites em `<userData>/rotinas/config.json`, seção `faxineiro` (criada com os
padrões na primeira rodada, como a `sessaoParada` de hoje):

| Gatilho | Padrão | Observação |
|---|---|---|
| RAM livre | < 15% | "livre" = `MemAvailable` (o que a VPS já lê) |
| Swap | troca ativa (si ou so > 0 em 1 s) ou swap em uso com RAM disponível < 1 GB | trocado em 08/11 (t-e3e8698a): "> 10% do swap" disparava com swap parado (18%, si/so 0, 3,6 GB livres) a cada leitura, e a faxina só baixava 35 MB |
| Carga | média de 5 min > 2 × CPUs | a média de 5 min já é o "por mais de 5 min"; só nas VPS |
| Sem sinal | 2 leituras seguidas sem resposta | uma leitura perdida sob carga é comum |
| Sessão parada | ≥ 30 min parada, sem pedir nada ao dono | o Faxineiro lê o último turno e decide se terminou |
| Disco | > 85% usado | PC e VPS |
| Ronda diária | 1 vez por dia, na primeira rodada depois das 06:00 | ronda completa do papel |

Freios: o mesmo gatilho na mesma máquina não acorda de novo antes de 30 min; no máximo 4 acordadas por hora no app
inteiro; um Faxineiro trabalhando nunca recebe um segundo acorda (o gatilho entra no próximo turno dele).

**2. Quem acorda.** O main manda ao renderer um "acorde o Faxineiro do quadro X, motivo Y" e o bridge faz o que o
`sessao_abrir` faz: se a cadeira Faxineiro do quadro tem sessão aberta e parada, entrega a mensagem; se não, abre.
A cadeira nasce no quadro na primeira vez (lugar `by: 'session'`, papel `faxineiro`, fora das setas). Gatilho de
máquina (RAM, carga, swap, disco, sem sinal) acorda só os quadros com sessões naquela máquina, **um de cada vez**,
começando pelo que tem mais sessões lá; o próximo só se o gatilho continuar depois que o primeiro terminar. Assim
uma VPS cheia não ganha quatro Faxineiros de uma vez.

**3. Onde o Faxineiro roda.** Numa máquina que não é a que está em apuros: "este computador" para gatilho de VPS e
uma VPS saudável para gatilho do PC (sem VPS saudável, no próprio PC). Ao terminar o turno da ronda e ficar 10 min parado, o
app fecha a própria sessão do Faxineiro, para ele não virar mais uma sessão pendurada.

**4. O que o Faxineiro pode fechar (garantido no código, não só no texto do papel).** `sessao_fechar` vindo de um
lugar com papel `faxineiro` alcança qualquer lugar de sessão **do próprio quadro**, sem precisar de seta, e recusa:
- o Líder do quadro e a própria sessão;
- sessão trabalhando (ele não corta turno: recusa, em vez de pedir pausa como o Líder faz);
- sessão com permissão aberta ou pedindo algo ao dono;
- aba que o dono abriu à mão (só fecha o que outra sessão abriu).

Cada pedido de fechar do Faxineiro, aceito ou recusado, vira uma linha em `<userData>/rotinas/faxineiro.log`
(JSON Lines, girado em 256 KB como o `sombra.log`): quando, quadro, lugar, estado, último turno, gatilho, resultado.
Os gatilhos que dispararam (e os segurados pelos freios) vão para o mesmo log.

**5. Fila de abertura.** No `sessao_abrir`, se a máquina de destino está acima de um limite de RAM/carga/sem sinal:
1. se o papel permite trocar de lugar e outra VPS está folgada, abre lá e diz isso na resposta;
2. senão, o lugar nasce no quadro marcado "na fila", e a resposta volta na hora ("na fila, posição N, a VPS está
   cheia"). Abre quando a máquina passar 2 leituras seguidas abaixo dos limites, na ordem de chegada.

A leitura de memória é de 60 s, então o limite sozinho deixa passar uma rajada (t-d1f072fd: quatro aberturas no mesmo
minuto, começando perto de 1,2 GiB disponíveis, levavam a VPS pessoal ao swap antes da leitura seguinte). Por isso cada
leitura diz também quantas sessões de 400 MB cabem antes do limite de RAM livre, e o app conta o que abriu na máquina
desde essa leitura (mais 60 s antes dela, porque a sessão recém-aberta ainda não cresceu). Esgotada a vaga, a próxima
abertura vai para a fila do mesmo jeito, e a fila também respeita a vaga ao abrir.

O Faxineiro também "põe na fila" uma sessão que ainda não começou: fechar pelo Faxineiro uma aba aberta que nunca
teve turno devolve o pedido dela à fila, sem perder o pedido. A fila mora na memória do app; se o app fechar, os
lugares da fila viram "não começou", que o Oráculo já trata.

**6. Papel.** O papel entra como papel de fábrica (`faxineiro` em `FACTORY_ROLES`), para todo quadro ter a cadeira
mesmo sem o arquivo. O arquivo `%APPDATA%\donel-dev\papeis\faxineiro.md` do dono continua valendo por cima (é assim
que papel editado funciona). A seção nova "Gatilhos" vai para os dois: no código e no arquivo do PC.

## Entregas (dois PRs contra staging, cada um com `npm run verify` verde)

1. **Cadeira + gatilhos + fechar com guarda + registro**: swap na leitura da VPS; avaliador puro com testes; acordar
   pelo bridge; ramo do Faxineiro em `reach.ts` e as recusas no `sessao_fechar`; log; papel de fábrica; nota em
   `patchnotes/notes.ts`.
2. **Fila de abertura**: fila no `sessao_abrir` (o lugar nasce no quadro e a sessão abre quando a máquina passar 2
   leituras seguidas abaixo dos limites, uma por minuto por máquina), troca de VPS quando o papel tem `lugar: qualquer`,
   o "não começou volta à fila" e **um verify por vez por máquina** (pedido do Líder na ronda de 07/11):
   `npm run verify` espera a vez com `flock ~/.donel/verify.lock`, o mesmo arquivo que as sessões já usam à mão, sem
   pedir a trava de novo quando quem chamou já a segura. Sem `flock` (Windows, macOS), roda direto.

Testes (regra de testes enxutos: só o que fecha sessão, abre sessão sozinho ou perde pedido): avaliador dos gatilhos
e freios; a regra de quem o Faxineiro pode fechar; a fila não perde nem duplica pedido.

## Decisões que tomei (diga se alguma muda)

- Swap conta quando troca agora (si/so) ou quando a RAM disponível está abaixo de 1 GB; o "acima de 10%" saiu em 08/11 (t-e3e8698a).
- O Faxineiro roda fora da máquina em apuros, e o app fecha a sessão dele quando a ronda acaba.
- "O que é do dono" = o Líder do quadro e toda aba que o dono abriu à mão. O Faxineiro só fecha o que uma sessão abriu.
- Ligado por padrão (`faxineiro.ligado: true` na config), com os freios acima.
- Troca de VPS na fila só para papel que tenha `lugar: qualquer` no arquivo do papel (nenhum de fábrica tem).

## Fora deste plano

- Carga do PC (o Windows não dá média de carga) e swap do PC.
- Tela própria do registro: nesta rodada o log é arquivo; a linha do dia pode entrar no painel de rotinas depois.
- Matar processo órfão continua sendo trabalho do Faxineiro pelo shell, como o papel já manda; o app não mata
  processo sozinho.
