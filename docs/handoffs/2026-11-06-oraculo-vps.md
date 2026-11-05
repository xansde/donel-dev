# Donel sem tela na VPS pessoal: estado em 05/11 (para 06/11)

Pedido do dono (05/11): a VPS pessoal autônoma, sem depender do PC, com o
switcher de contas, o Oráculo, as cartas no celular e o MCP donel morando lá.
Prazo: 06/11. Fatias em `BACKLOG.md`, demanda `donel-vps`.

## Pronto

**Fatia 01: switcher das VPS sem o PC** (branch `feat/donel-vps-switcher`).

- O serviço `donel-servico` (systemd, `Restart=always`) roda o mesmo motor de
  contas do PC na VPS pessoal, com um conjunto de contas só das VPS e um cofre
  próprio. O cofre usa AES-GCM com uma chave cifrada pelo systemd do host.
- Ele troca a VPS pessoal ("aqui") e Homologações a 90%. Homologações escolhe
  primeiro.
- O PC tem a preferência (decisão do dono, "Prefiro preferência no meu pc").
  O PR #245 não entra, e no PC a ordem continua a de antes.
- Causa 2 do handoff de 05/11: carga desconhecida por 10 minutos numa conta de
  lugar passa a contar como cheia. Vale no PC e no serviço.
- ADR 0008, emenda no `CLAUDE.md` e passo a passo do dono em `docs/servico-vps.md`.

Por que Homologações não trocou em 05/11: ver
`docs/handoffs/2026-11-05-switcher-remoto.md` (branch `fix/switcher-remoto`).
Em resumo, o PC pegou a única conta livre antes da VPS (Causa 1). Com conjuntos
separados, essa disputa deixa de existir.

## Falta

- Instalar o serviço na VPS pessoal depois do merge: `sudo bash
  scripts/servico/instalar.sh` num checkout de staging.
- Fatias 02 a 06: Oráculo, cartas, MCP, PC como painel e aviso "todas cheias"
  (detalhes no `BACKLOG.md`).

## Passos do dono (06/11)

Tudo em `docs/servico-vps.md`. Em resumo:

1. Liberar, na política da tailnet, o ssh de `vps-alexandrelentz` até
   `vps-time-homologacoes`, com `accept` e o mesmo usuário que o PC usa. Hoje a
   tailnet recusa.
2. No PC, com o Donel fechado: tirar as VPS de `accounts.remotes` e as contas
   delas de `accounts.localAccounts` no `config.json`, depois de copiar o
   arquivo.
3. Na VPS: `donel-servico contas adotar homologacoes "Conta 8"` e o mesmo para
   `aqui`.
4. Dar reservas às VPS: as 7 contas que estão em "Reconectar" no PC. Remover
   cada uma no PC, fazer login isolado na VPS e rodar `donel-servico contas
   colher`.
