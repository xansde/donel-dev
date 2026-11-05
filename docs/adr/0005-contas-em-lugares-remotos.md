---
name: Contas em lugares remotos
type: adr
status: accepted
created: 2026-11-04
updated: 2026-11-04
tags: [adr, contas, credenciais, vps, 011-contas-e-provedores]
aliases: [ADR-0005, lugares remotos, contas na VPS]
---

# ADR 0005 — Contas em lugares remotos (VPS)

## Contexto

Em 03/11/2026 o dono ganhou uma VPS (Linux, só por Tailscale) para rodar
sessões fora do PC. Ele não quer logar uma conta fixa lá: quer a mesma dinâmica
do Donel Dev, em que o motor de contas escolhe e troca a conta.

O risco é o mesmo do [ADR 0001](0001-motor-de-contas-e-mods.md): o refresh
token é de uso único. Se o CLI do PC e o da VPS usarem a mesma conta, os dois
renovam o mesmo token, e um deles (ou a família inteira) morre.

## Decisão

O motor de contas desta máquina passa a controlar também o `~/.claude` de
**lugares remotos** (`accounts.remotes` na config: id, rótulo, destino do `ssh`
e a conta ativa de cada lugar). O cofre continua só aqui.

1. **Uma conta, um lugar.** Uma conta ativa aqui não entra num lugar, e uma
   conta ativa num lugar não é escolhida aqui, nem à mão nem pela troca
   automática. As trocas (daqui e de lugar) passam por uma fila única do motor.
2. **Mesma ordem invariante, do outro lado do ssh.** Lê o par que está no lugar
   → guarda no cofre da conta dona dele (identidade pelo fingerprint do
   `oauthAccount` de lá) → grava o par novo → apaga `oauthAccount`. A escrita é
   compare-and-swap: se o CLI de lá renovou depois da leitura, ela recusa, e a
   segunda volta captura o par novo antes de gravar.
3. **O par só viaja pelo stdin do `ssh`.** O lado remoto é um programa `node -`
   gerado aqui, com a entrada como literal JSON. Nada em argv, log ou mensagem
   de erro. A identidade sai de lá já como sha256 do `accountUuid`.
4. **Quem renova a conta de um lugar é o CLI de lá.** A cada leitura de carga o
   motor copia o par do lugar para o cofre (só com prova de identidade), e o
   mod local nunca renova uma conta que está num lugar.
5. **Escrita de desfecho incerto** (o ssh caiu depois de mandar o par): o motor
   relê uma vez; sem resposta, marca o lugar e, enquanto a marca durar, um par
   sem prova de identidade só é atribuído pela igualdade de refresh token.
6. **Só contas do pool próprio.** Conta do pool Seazone tem posse e heartbeat
   por máquina; fica fora dos lugares remotos.

## Consequências

- A VPS usa as contas sem login próprio, e a troca automática vale para ela,
  **enquanto o app estiver aberto neste PC**. Com o PC desligado, o lugar segue
  na conta em que estava.
- A emenda da exceção de credencial está no `CLAUDE.md` (seção Credenciais).
- O próximo passo natural é o motor morar na própria VPS e o app virar cliente
  dele (troca 24h). Esta decisão não impede isso: o contrato do lugar remoto é
  o mesmo, só muda quem o chama.
