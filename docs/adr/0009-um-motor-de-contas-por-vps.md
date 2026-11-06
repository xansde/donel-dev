---
name: Um motor de contas por VPS
type: adr
status: accepted
created: 2026-11-06
updated: 2026-11-06
tags: [adr, contas, credenciais, vps, servico, 011-contas-e-provedores]
aliases: [ADR-0009, motor por VPS, um motor por VPS]
---

# ADR 0009: Um motor de contas por VPS

Emenda o [ADR 0008](0008-contas-das-vps-sem-o-pc.md): substitui os itens 1 e 4
dele. Os outros itens do 0008 continuam valendo.

## Contexto

O ADR 0008 (05/11) punha **um** serviço com o motor de contas na VPS pessoal,
trocando a conta dela e, por ssh, a de Homologações ("Homologações escolhe
primeiro"). Isso tirava a dependência do PC, mas criava outra: Homologações
dependia da VPS pessoal ligada e do ssh entre as duas, que a política da tailnet
ainda recusa.

Em 06/11, a carta que decidia o caminho foi aceita por engano com "contas pelo
OpenRig". O dono corrigiu, por volta das 06:20, literal:

> "Contas pelo donel. Mas cada VPS deve ter sua própria ferramenta de troca de
> conta para não depender do meu pc ligado"

No fim de semana, o OpenRig roda o rig de homologação em Homologações com a
conta que o motor dela deixar ativa no `~/.claude`. As contas continuam sendo
do Donel, e o OpenRig só usa a conta que encontra.

## Decisão

1. **Um motor em cada VPS.** O mesmo `donel-servico` (systemd, `Restart=always`,
   habilitado no boot) é instalado em **cada** VPS: a pessoal e Homologações.
   Cada um troca só o `~/.claude` do usuário do serviço daquela máquina (em
   Homologações, `root`). O motor não tem lugar remoto nem ssh. O serviço
   descarta qualquer `remotes` da config, e os comandos `lugar ...` saíram.
   O código continua em `src/main/accounts/servico/` (perímetro de credencial
   de sempre) e `src/servico/` (entrada sem segredo). O bundle é o mesmo nas
   duas.
2. **Um conjunto de contas por máquina.** São três conjuntos: o do PC, o da
   VPS pessoal e o de Homologações. Cada VPS tem o seu cofre
   (`~/.donel/accounts-vault.json`), cifrado com uma chave que o systemd
   **daquele host** cifra (`/etc/donel/vault-key.cred`). Copiar o cofre para
   outra máquina não abre nada. Uma conta entra no conjunto de uma VPS só
   por um gesto do dono na própria VPS:
   - `contas adotar`: a conta que já está logada ali;
   - `contas colher`: login isolado feito ali.

   Passar uma conta do PC para uma VPS, ou de uma VPS para a outra, continua
   sendo um gesto explícito do dono: tirar de um conjunto e pôr no outro.
3. **Como duas VPS não usam a mesma conta ao mesmo tempo:**
   - **Por construção.** Cada motor só escolhe contas do próprio cofre. Nenhum
     motor lê o cofre, a config ou o `~/.claude` de outra máquina, e nenhum
     comando ou resposta leva par. Não existe caminho automático que ponha a
     mesma conta em dois conjuntos.
   - **Pela regra do gesto.** Uma conta, um conjunto. Para mudar de conjunto,
     primeiro `contas remover` (ou Remover no PC) e depois o login ou a adoção
     no destino. O passo a passo está no `docs/servico-vps.md`.
   - **Um lugar, um motor.** Antes de ligar o motor numa VPS, o dono tira essa
     VPS de Contas › Lugares do PC (o ADR 0005 continua valendo para lugares
     que o PC controla). Se esquecer, a escrita do PC é compare-and-swap. Ela
     volta `changed` e não atropela o par que o motor da VPS escreveu. Mas o PC
     ainda guardaria cópia da conta, então o passo continua obrigatório.
   - **Se mesmo assim acontecer**, o refresh token de uso único denuncia. A
     primeira renovação num lado mata o par do outro, e essa conta aparece com
     `reconectar` no `donel-servico estado` (e
     `account-pair-refresh-failed` no log). A correção é remover a conta de um
     dos conjuntos e logar de novo no outro.
4. **Com o PC desligado.** Cada VPS lê a carga das próprias contas (de 1 a 5
   min) e troca a 90%, com folga de 20, como no PC. Se o processo cai, o systemd
   o religa, e ele volta no boot. Nada no motor chama o PC ou a outra VPS. Se o
   conjunto de uma VPS estiver todo acima do limiar, ela fica na menos cheia, e
   o aviso é a fatia 06. Para mexer nas contas com o PC desligado, o dono usa
   os comandos do serviço no terminal da VPS.
5. **Com o PC ligado**, nada muda para o PC. Ele segue com o próprio conjunto e
   a preferência ("Prefiro preferência no meu pc"). Ver o conjunto das VPS no
   app é a fatia 05.
6. **Sai do ADR 0008:**
   - o item 4 ("Homologações escolhe primeiro", `remotePlacesFirst`): a opção
     saiu do motor;
   - a dependência do ssh da VPS pessoal até Homologações: o passo de liberar
     isso na tailnet deixa de existir.

   A regra "carga cega 10 min = cheia" (item 5) fica. Ela vale para os lugares
   que o PC ainda controla.

## Consequências

- Homologações troca de conta sozinha, sem o PC e sem a VPS pessoal. O rig do
  fim de semana usa a conta que o motor dela deixa ativa.
- A instalação vira um passo por VPS, com o mesmo script
  (`scripts/servico/instalar.sh`). Em Homologações, tudo roda como `root`, e o
  script aceita `DONEL_SERVICO_USER=root`.
- Cada VPS precisa de reservas próprias. Com uma conta só, não há para onde
  trocar. As contas se dividem entre três conjuntos em vez de dois.
- O Oráculo continua sendo **um** só, na VPS pessoal (fatia 02, ADR 0008 e o PR
  do Oráculo). O motor de contas é por VPS. O registro de tarefas, não.
- Instalar em cada VPS só com o aval do dono. O comando de instalar e o de
  desfazer estão em `docs/handoffs/2026-11-06-motor-por-vps.md`.
