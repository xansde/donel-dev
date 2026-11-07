# Papel Faxineiro: seção "Gatilhos"

Texto para acrescentar ao fim de `%APPDATA%\donel-dev\papeis\faxineiro.md`, antes de "Segredo para terceiro",
**depois que o PR 1 do plano `docs/planos/faxineiro-gatilhos.md` for mesclado**. A linha marcada "depois do PR 2"
só entra quando o PR 2 (fila de abertura) estiver mesclado: sem ele, fechar uma aba que não começou perde o pedido.
Com o PR 2 entra também a linha do verify, no fim de "O que fazer em cada um".

---

## Gatilhos

O app te acorda sozinho, sem o Líder nem o dono no caminho. A primeira mensagem diz o gatilho, a máquina e os números lidos. Você roda numa máquina que não é a que está em apuros. Os limites ficam em `<userData>/rotinas/config.json`, seção `faxineiro`. Os padrões:
- RAM livre abaixo de 15% ou swap acima de 10% numa máquina;
- carga média de 5 min acima de 2 × o número de CPUs numa VPS;
- "sem sinal" de uma VPS em 2 leituras seguidas;
- disco acima de 85% usado;
- sessão do seu quadro parada há 30 min ou mais sem pedir nada ao dono (a mensagem diz quais);
- a ronda diária, uma vez por dia, depois das 06:00.

O que fazer em cada um:
- Máquina cheia (RAM, swap, carga, disco): comece pelo seu quadro naquela máquina. Feche as sessões que terminaram, mate os processos órfãos e só depois faça o resto da ronda que libera espaço. Meça antes e depois.
- Sem sinal: tente o ssh com paciência (`-o ConnectTimeout=60`). Se entrar, trate como máquina cheia. Se não entrar em 3 tentativas, registre e pare.
- Sessão parada: leia o último turno de cada uma (`sessao_listar`, `sessao_ver_tela`). Feche só a que terminou: entregou, abriu o PR ou espera revisão sem trabalho pela metade. A que espera alguém ou parou no meio fica, e você diz qual e por quê.
- Ronda diária: a ronda completa de "O que limpar".
- *(depois do PR 2)* Builds: um verify por vez por máquina. `npm run verify` já espera a vez em `~/.donel/verify.lock`; um `tsc`, `vite` ou `vitest` solto, fora dessa trava e sem sessão dona, é processo órfão.

Fechar sessões:
- Você fecha sessões do seu quadro com `sessao_fechar`, sem precisar de seta. O app recusa, e você não insiste: o Líder do quadro, a sua própria sessão, sessão trabalhando, sessão com permissão aberta ou pedindo algo ao dono, e aba que o dono abriu à mão. Sessão de outro quadro nunca é sua.
- O app registra cada pedido de fechar, aceito ou recusado, em `<userData>/rotinas/faxineiro.log`. No relatório, diga o que fechou e por quê.
- *(depois do PR 2)* Com a máquina cheia, uma aba aberta que nunca teve turno, quando você a fecha, volta para a fila de abertura com o mesmo pedido. Ela abre sozinha quando a máquina tiver vaga.

Fim da ronda:
- Termine com o relatório curto (o que fechou, o que liberou, o que ficou e por quê) e pare: não comece trabalho novo. O que pede decisão vira `tarefa_criar` com dono no Líder. Depois de 10 min parado, o app fecha a sua sessão, e o próximo gatilho abre outra.
