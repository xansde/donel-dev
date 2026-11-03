---
tema: sessao-renovada-em-voo
plano: docs/planos/mindscape-openrig.pda.md
item: 07
data: 2026-11-03
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-11-03 ("pode dar início em TUDO do que está listado"; regras de delegação do item 07 passadas na abertura da frente)
---

# Refinamento — Sessão renovada em voo (B36)

## Demanda

Dono, 03/11: "Quando chegar no limite de contexto proposto, abrir uma sessão nova no background e
fazer todo esse processo que acabou de fazer, de maneira que se o usuário estiver na versão 'chat'
nem perceba o que aconteceu (claro, pode deixar avisado, como fica o 'Trocou em voo (era a {nome
da conta})')." E: "registrar tudo, matar o terminal e reiniciar ele com um handoff pronto de maneira
que nunca passe muito do limite proposto. Assim podendo manter sessões longuíssimas sem chegar na
dumb zone." Origem e "em aberto": `specs/backlog.md`, B36.

## O que já existia

- **Medição de contexto**: `transcript-watcher.ts` lê a cauda do `.jsonl` e empurra
  `contextTokens` por sessão (`transcript:changed`); a statusbar já mostra uso/limite.
- **Fim de turno**: o semáforo (`session-semaphore-manager.ts`) vira `waiting` no `Stop`, e desde o
  #109 sabe quando o `Stop` ainda lista subagente em segundo plano (`awaitingBackgroundAgents`).
  `permission` cobre pergunta e permissão pendentes.
- **Envio ao PTY**: a mesma porta do auto-start da Esteira — o `SendDriver` do chat (fila única,
  espera o CLI, confirma o aceite) e, sem chat, `armEsteiraAutoStart` (digita e confirma o Enter).
- **Troca de processo na mesma aba**: `TerminalPane.respawn` (o "Retomar") já mata a PTY sem passar
  por "encerrada" e sobe outra com os mesmos flags; o main impõe um `--session-id` novo no spawn.
- **Troca de conversa no chat**: `/clear` e `/resume` já re-apontam o chat da aba
  (`onSessionSwitched`), levando nome e cor da aba para o id novo.
- **Troca de conta em voo**: o sufixo "trocou em voo (era a …)" da statusbar
  (`sessionAccountLabel.ts`); a conta ativa vale para todo spawn novo.

## Regras fechadas

1. **Limite em tokens de contexto**, configurável (`sessionRenewal.limitTokens`, padrão **250k**, o
   orçamento com que o dono já trabalha), ligado por padrão (`sessionRenewal.enabled`). Chave de
   topo nova no `config.json` (como `pet`), sanitize campo a campo, limite preso entre 50k e 1M.
   Preferências ganham o interruptor e o limite (150k a 500k).
2. **Gatilho só no fim de turno**: renova quando o contexto ≥ limite **e** a aba está `waiting`
   **e** o `Stop` não listou subagente vivo. Nunca no meio de ferramenta, com pergunta ou permissão
   aberta, nem em aba que encerrou. Decisão pura: `checkRenewal` (`shared/sessionRenewal.ts`).
3. **Aviso discreto antes**: faixa compacta acima da sessão ativa a partir de 20k do limite
   ("Contexto em 236k de 250k…"), e enquanto a renovação está em curso. **"Agora não"** adia por
   **+50k** de contexto (N = 50k: um quinto do orçamento, folga para fechar o que está em mãos sem
   cair na dumb zone); no meio da renovação, cancela e deixa a sessão como está.
4. **Passagem de bastão pedida à própria sessão**, numa linha, apontando para um arquivo de
   instruções do app. Formato fixo: cabeçalho lido pelo app (`donel-passagem: 1`, `sessao-anterior`,
   `projeto`, `trabalho-vivo`) e seções Prioridade, Frentes, Decisões tomadas, Rascunhos (aprovados ×
   esperando OK), Comandos prontos, Trabalho vivo (agentes, processos, cron/loop) e Primeira ação da
   sessão nova. A sessão atualiza a memória/vault **se o projeto tiver essa convenção** (não cria uma).
5. **A passagem mora em `<userData>/handoffs/`**, nunca no repo do projeto (nome:
   `AAAA-MM-DD-hhmmss-<projeto>-<id8>.md`, com o `.instrucoes.md` ao lado).
6. **Nunca matar com trabalho vivo**: a troca espera enquanto o `Stop` listar subagente vivo **ou** a
   passagem declarar `trabalho-vivo` diferente de `nenhum` (cabeçalho sem o campo conta como vivo). A
   sessão reescreve o cabeçalho quando o trabalho termina; o app confere a cada fim de turno.
   Agendamentos de cron/loop **não** seguram a troca: vão listados para a sessão nova recriar.
7. **Sessão que não escreve a passagem**: depois de dois fins de turno sem arquivo (um pode ter sido
   mensagem do próprio dono à frente do pedido), o app desiste, avisa e adia por +50k.
8. **Troca**: mata o processo velho e abre o novo **na mesma aba**, mesma pasta, mesma conta ativa,
   mesmos flags do launch (sem `-r`/`--resume`/`--session-id`/`--fork-session`/`-c`); o modo de
   permissão trocado com Shift+Tab passa para o processo novo (só `default`, `acceptEdits`, `plan`,
   os que não pedem opt-in). A primeira mensagem da sessão nova manda ler a passagem, seguir a
   "Primeira ação", tratar como aprovado só o que a passagem marca como aprovado, resumir em poucas
   linhas e **esperar** — ela não sai trabalhando sozinha.
9. **Chat**: a conversa velha continua acima de um divisor "Sessão renovada em voo (contexto cheio)
   · passagem: ‹arquivo›" com "abrir"; rola para trás pela conversa velha depois que a nova chega ao
   início. Um nível só: renovações mais antigas ficam em Sessões anteriores. Um `/clear` depois tira
   a conversa velha da vista (vira a conversa anterior, como sempre).
10. **Statusbar**: mesmo padrão do "trocou em voo": " · sessão renovada em voo" no rótulo da aba.
11. **Mindscape**: o cartão é o lugar, não o processo (o "seat" do OpenRig). Cartão, post-it e
    ligações passam da sessão velha para a nova na mesma posição (`carrySessionCard`), antes de a
    aba receber o id novo — o quadro nunca põe um segundo cartão. Não muda o formato do
    `mindscape.json` (só reescreve chaves), então o `schemaVersion` fica.
12. **Nada preso a uma IA**: a UI fala em "sessão" e "passagem de bastão"; o texto enviado é sobre o
    mecanismo. Ponto de extensão para outro CLI: `main/session-renewal.ts` (instruções e leitura do
    cabeçalho) e as duas portas do renderer (`send` e `renew` em `useSessionRenewal`).

## "Em aberto" do B36, respondidos

- **Onde fica o handoff sem vault?** Sempre na pasta do app (`<userData>/handoffs/`), com ou sem
  vault; o vault/memória do projeto só é atualizado quando o projeto tem a convenção.
- **Limite por sessão ou por custo?** Por tokens de contexto da sessão — é o que mede a dumb zone e o
  que o app já lê; custo varia por modelo e não diz nada sobre a qualidade do contexto.
- **O dono pode vetar?** Sim: "Agora não" adia +50k (o app volta a avisar perto do novo limite) e
  desliga de vez em Preferências.
- **Quanto o app espera?** Pelo fim do turno, sem prazo; pelo trabalho vivo, sem prazo (nunca mata);
  pela sessão nova responder, 60 s, depois avisa que a passagem ficou salva.

## Fora desta entrega

- Abas "Isolar em worktree": a worktree é liberada quando o processo sai, e a sessão nova correria
  contra a limpeza. Ficam sem renovação até isso ter um caminho próprio.
- Modelo trocado com `/model` no meio da sessão: a sessão nova nasce com os flags do launch (o
  `/model` do CLI costuma persistir como padrão, mas o app não força).
- Esconder do chat a mensagem do pedido e a da primeira leitura: aparecem como mensagens, marcadas
  `[Donel Dev · …]` — o dono pediu "pode deixar avisado".
- Faxina de passagens antigas em `<userData>/handoffs/`.

## Precisa de validação no alfa (não deu para provar sem rodar o app)

Pela regra de testes enxutos, nada aqui abriu o app nem rodou smoke. Ficam para o dono ver no alfa:
o pedido chegando à sessão (chat e terminal), a sessão escrevendo a passagem no formato, a troca
sem o overlay de "encerrada", o divisor e a conversa velha acima no chat, o "abrir" da passagem, o
cartão do Mindscape parado no lugar, e a espera com subagente em segundo plano.
