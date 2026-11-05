# Cartas do Oráculo na forma A — passagem (05/11)

Sessão Dev na VPS, worktree `../donel-wt/cartas-a`. Spec: `docs/specs/cartas-forma-a.md` (branch
`proto/cartas`, commit 321c673). O MCP `donel` desta VPS dava 403, então todo o registro está nos PRs.

## O que está pronto

As 6 fatias da spec, cada uma num PR contra `staging`, **empilhadas** (cada branch nasce da anterior):

| Fatia | PR | O que você ganha |
|---|---|---|
| 1. Contrato | #236 | Entrega de risco alto chega com pergunta, 2 a 4 caminhos com efeito, a recomendação com o porquê e o risco. Texto com código volta para quem entregou reescrever. |
| 2. Carta A no celular | #237 | A frente decide (pergunta, print ou checagens, recomendação, caminhos); o verso explica. Dois toques num caminho decidem. Quem fez aparece pelo nome. |
| 3. Carta A no desktop | #238 | "Esperando você" no Mindscape abre a mão de cartas e a carta grande, igual ao celular. |
| 4. Protótipo na carta | #240 | O protótipo HTML roda dentro da carta, isolado (sem internet, sem ver os dados do app), no celular e no desktop. |
| 5. Escrever na carta | #242 | "✎ Escrever para…": vai na hora à sessão que fez a tarefa, ou ao Líder se ela estiver fechada, ou fica guardado. A resposta chega como carta nova; o verso mostra a conversa. |
| 6. Prova vinda da VPS | #244 | Sessão na VPS também anexa print, vídeo e protótipo. |

Cada PR diz o que mudou, por quê, como conferir e o que ficou de fora. Testes: só os que a spec lista,
em `tests/ledger.test.ts`, `tests/celular-server.test.ts` e `tests/session-messages.test.ts`.

## Como foi verificado

- `npm run verify` em cada fatia, na VPS (Linux): typecheck, testes e build verdes, **menos 2 testes
  que já falham em `staging` sem mudança nenhuma**: `config-store` ("cria o diretório pai", espera
  `C:\fake\nested`) e `remoteSessions` (aspas do `cd`). Os dois dependem de caminho do Windows, então no
  PC devem passar.
- **Não rodei smoke, nem abri o app, nem tirei print.** O Electron e o Chromium não sobem nesta VPS
  (faltam bibliotecas do sistema), e não instalei pacote de sistema na máquina. As fatias 2 a 5 mexem
  em main e preload, então vale um `npm run test:smoke` no PC e uma olhada no alfa.
- O leitor de prova da VPS (fatia 6) foi conferido de verdade aqui, com bash: um caminho malicioso não
  executou nada, e link simbólico e arquivo grande foram recusados.

## O que falta

- **Revisão e merge**, na ordem #236 → #237 → #238 → #240 → #242 → #244. Mergeando em ordem, o diff de
  cada PR seguinte fica só com a fatia dela, sem precisar mexer.
- **Conflito provável no `notes.ts`** com o #239 (Slack só com carta, de outra sessão): os dois
  acrescentam item no mesmo dia. Se o #239 entrar antes, o #236 precisa mesclar `staging` e juntar os
  dois itens. Pela regra do projeto, esse conflito é do Dev.
- **Conferir no alfa** o "Pronto quando" da spec que só se vê com o app aberto:
  - um protótipo com botões funcionando dentro da carta, no celular e no desktop;
  - no console, `fetch` para fora falha, o `localStorage` da PWA não é lido e `window.open` não abre nada;
  - um HTML de 2,1 MB volta recusado;
  - escrever numa carta chega uma vez só no chat da sessão; fechada, chega ao Líder; sem ninguém, a carta
    diz que ficou guardado;
  - um Dev na VPS entrega `.png` e `.html`, e os dois aparecem na carta.
- **Os agentes ainda não escrevem o bloco.** A descrição das ferramentas já ensina. Até cada sessão ler a
  descrição nova, uma entrega de risco alto sem o bloco volta recusada, e é a regra da spec. Se isso
  travar trabalho em andamento no dia da virada, a saída é pedir à sessão que reentregue com
  `paraODono`.

## Perguntas ao dono

1. **Dois toques para decidir.** Um toque marca o caminho e o segundo decide, para um esbarrão não fechar
   a tarefa. O protótipo decidia com um toque. Mantenho os dois toques? (Recomendo manter.)
2. **Arrastar a carta.** O gesto de arrastar (aceita ou rejeita) ficou só na carta antiga. Na carta A,
   arrastar para a direita não diz qual caminho, então lá só os botões decidem. Está bom assim, ou você
   quer arrastar para a direita escolhendo o caminho recomendado?
3. **Amostra do Revisor.** A carta que o Revisor já aceitou (a amostra do dia) continua na forma antiga,
   com "Confirmo" e "Rejeitar", porque não há caminhos para escolher. Quer que ela também vire forma A?
4. **Mesa no desktop.** As cartas abrem sobre a janela inteira, não só sobre o quadro como no protótipo.
   Prefere só sobre o quadro?
5. **Protótipo fora da carta.** O botão "abrir fora" foi tirado do protótipo de propósito: no navegador do
   sistema, o HTML de um agente rodaria com internet. Ele só roda dentro da carta. Concorda?
