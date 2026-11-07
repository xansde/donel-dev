# Líder único na VPS

**Pedido do dono (07/11):** "RAM do PC está em 81%, quero abaixo de 50%. Delega tudo pra RAM da VPS". O Líder único
também vai ("sim"). Este plano cobre **só o Líder**; as outras sessões já podem nascer na VPS ("Onde roda").

## Por que hoje ele não vai para a VPS

1. **Quem abre o Líder não pergunta onde.** O Jobu abre o Líder em `liderDeliverRef` (`App.tsx`), com `addTab` sem
   `remoteId`: ele sempre roda no PC, na pasta `…\seazone` (`leaderHome`). O ADR 0007 deixou "Líder na VPS" para a V2.
2. **Ao reiniciar o app, um Líder remoto deixaria de ser o Líder.** A sessão remota volta pelo `meta.json` da VPS
   (`pty:remoteAlive`), que não guarda `roleId` nem a marca `leaderOfAll`; a aba voltaria como sessão comum, com a
   pasta no lugar do projeto, e o Jobu abriria um segundo Líder sem a conversa.
3. **Trocar de lugar começa outra conversa.** O transcript do Líder está no `~/.claude/projects` do PC; o CLI da VPS
   não o enxerga.

O resto já funciona numa sessão remota: chat pelo transcript espelhado, hooks e MCP `donel` por túnel reverso.

## O que muda

- **Escolha:** chave nova `leader.where` no `config.json` (`'local'` ou o id de um lugar remoto; ausente = este
  computador, como hoje). Em Preferências, ao lado de "Oráculo no lugar da conversa do Líder": **"Onde o Líder roda"**,
  com "Este computador" e os lugares remotos. O dono escolhe VPS uma vez.
- **Abrir:** sem Líder vivo, o Jobu abre o Líder no lugar escolhido (`remoteId`), na mesma pasta `…\seazone` (vira
  `~/seazone` na VPS pela regra de sempre, `remoteDirFor`).
- **Voltar depois de reiniciar:** o `meta.json` passa a levar `roleId` e `leaderOfAll`; a aba que volta da VPS é o
  Líder único de novo (sem projeto, fora da barra de abas como hoje). Versões antigas ignoram os campos extras.
- **Troca com a conversa junto (retomada, não resumo):** quando chega uma mensagem pelo Jobu e o Líder vivo está num
  lugar diferente do escolhido, e ele **não** está trabalhando:
  1. **copia a conversa antes de mexer no Líder** (`lider:carry`, `src/main/lider/transfer.ts`): por stream no ssh
     (`cat` de um lado, arquivo do outro), nunca embutida num script. Na ida, o maior transcript daqui sobe e o
     outro lado confere tamanho e sha256; antes, encerra o tmux de um Líder velho da mesma conversa que tenha ficado
     vivo lá (uma volta que não conseguiu encerrá-lo), para o novo nunca se ligar a ele. Na volta, desce o arquivo
     da VPS (não o espelho que foi chegando), conferido pelo mesmo hash. Nos dois lados fica a cópia maior, e a
     outra vira `<id>.jsonl.bak-<hora>`; uma cópia menor nunca sobrescreve;
  2. abre o Líder no lugar novo com `-r <mesmo id>` e entrega a mensagem a ele;
  3. **só quando o novo aceitou a mensagem** (`shared/lider/move.ts`), fecha o antigo. Se a cópia falha, o novo não
     sobe ou não aceita em 4 min, o novo fecha e o antigo segue onde estava, com a conversa, e recebe a mensagem e
     as que chegaram no meio, na ordem (aviso numa linha na tela).
  Medido: 19 MB por stream, 0,3 s sem rede (o script antigo levava 27 s a 460 s e o app desistia em 120 s).
- **Ligação caída (PC dormiu > ~1 min):** a aba do Líder fica com o processo encerrado; a próxima mensagem religa a
  mesma aba com `-r` do mesmo id, no lugar onde ele estava (na VPS, reanexa ao mesmo CLI no tmux). Só sem id de
  conversa abre um Líder novo.
  Mesmo id de conversa: o mesmo nome, o mesmo histórico, o mesmo chat no Jobu. Com o Líder trabalhando, a mensagem
  vai para ele onde está, e a troca espera a próxima.

## Navegador integrado

Fica no PC, onde o dono o vê ao lado da conversa. O Líder na VPS o controla pelas mesmas ferramentas `navegador_*` do
MCP `donel`, que o app serve no PC e que toda sessão remota já alcança pelo túnel reverso do ssh (ADR 0006). É o
caminho que esta sessão de Dev, rodando na VPS, já usa. Nada novo para construir. Limite: com o app fechado, o Líder
segue vivo no tmux, mas sem quadro, sessões, tarefas e navegador até o app voltar. O Jobu também depende do app.

## O que o dono perde ou muda com o Líder na VPS

- Ele lê arquivos só dos projetos que existem em `~/seazone/` na VPS, isto é, o que está no GitHub. O que só existe
  no PC (sem push) ele não vê. As ferramentas de quadro, sessão e tarefa não mudam.
- Ele usa a conta ativa da VPS e os MCPs e plugins do `~/.claude` da VPS, não os do PC.

## RAM: o que esperar, antes de construir

- Medido na VPS agora: cada sessão `claude` ocupa de 270 a 410 MB. Mover o Líder libera no PC um processo desses mais
  os servidores MCP que ele sobe. Fica entre **0,4 e 1 GB**, e o PC ganha só um `ssh`.
- **Isso sozinho não leva o PC de 81% para menos de 50%**, a não ser que o PC tenha uns 3 GB de RAM. O que mais pesa
  no PC são as outras sessões locais e o próprio app (Electron, abas, navegador). Para chegar a 50%, as sessões locais
  que restam também precisam ir para a VPS ("Onde roda"), e isso é trabalho do Líder, não deste PR.
- **A VPS está perto do teto:** 7,7 GB, 13 sessões `claude` vivas, 2,5 GB disponíveis e 1,1 GB de swap em uso. O
  Líder cabe, mas "tudo na VPS" vai para o swap. A outra VPS (Homologações) pode receber parte do time.
- **Medir o PC:** daqui (VPS) não alcanço o PC: o ssh para `seazone173` não responde. O print de RAM "antes" eu peço
  ao Líder atual, que ainda roda no PC. O "depois" peço a uma sessão local que ainda esteja no PC ou ao dono.

## Testes (só o que quebraria sem o dono ver)

- `meta.json` leva e devolve `roleId` e `leaderOfAll` (sem isso, o Líder some ao reiniciar).
- O transcript só é substituído por uma cópia maior, e a anterior fica guardada, dos dois lados: no PC
  (`carryTranscriptLocally`) e na VPS (`buildCarryTranscriptScript`, executado com bash). Sem isso, uma troca
  apagaria a conversa ou retomaria uma versão velha.
- `leader.where` sobrevive ao sanitize do config, e um lugar removido cai para "este computador".
- A decisão de trocar (lugar vivo ≠ escolhido e Líder parado) é uma função pura em `leader.ts`.

Verificação: `npm run verify`. Depois, um `npm run test:smoke`, porque o PR mexe em main e PTY. E2E no alfa: mandar
mensagem pelo Jobu, ver o processo `claude … -r <id>` na VPS (`ps`, `tmux -L donel ls`) e o Líder responder com o
histórico de antes.

## Volta atrás

- **Pelo dono, sem código:** Preferências → "Onde o Líder roda" → "Este computador". Na próxima mensagem o Líder volta
  ao PC com `-r` e o mesmo transcript (o espelho local vira o arquivo do CLI do PC, pela mesma regra da cópia maior).
- **Nada é apagado:** o transcript original fica no PC e a cópia fica na VPS.
- **Revert do PR:** a chave `leader.where` passa a ser ignorada, e o Líder volta a abrir no PC. Um Líder que estiver
  vivo na VPS voltaria como sessão comum: fechar a aba dele, e o Jobu abre outro no PC. A conversa da VPS segue
  retomável pela lista de sessões.
- **Canais antigos:** o beta e o stable não conhecem `leader`, mas guardam a chave de topo desconhecida
  (`unknownFields`) e a regravam intacta. Abrir um deles abre o Líder no PC, porque o código antigo não sabe da
  escolha, mas a escolha não se perde.
