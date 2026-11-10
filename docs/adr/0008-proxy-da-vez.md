---
name: Proxy da vez
type: adr
status: accepted
created: 2026-11-10
updated: 2026-11-10
tags: [adr, proxy, credenciais, vps, 018-proxy-da-vez]
aliases: [ADR-0008, proxy da vez, seletor de proxy]
---

# ADR 0008 — Proxy da vez

## Contexto

As sessões de cada máquina do dono (PC, VPS pessoal, VPS Homologações) saem para a API pelo
`ANTHROPIC_BASE_URL` + `apiKeyHelper` do `~/.claude/settings.json` daquela máquina. Há mais de um caminho (o
gateway de contas num PC do dono, um portal de API) e a troca era por script, máquina a máquina. Em 10/11/2026 o
dono pediu um cadastro, um seletor de um clique e a saúde do proxy atual, com a chave guardada no cofre do app
([spec](../../specs/018-proxy-da-vez/spec.md)).

## Decisão

1. **A troca age no `settings.json` da máquina** (camada user), como os scripts: só `ANTHROPIC_BASE_URL`,
   `apiKeyHelper`, o host no `NO_PROXY` (quando a lista existe) e a remoção de `ANTHROPIC_AUTH_TOKEN`/`API_KEY`. O
   resto do arquivo fica. Sessões vivas não são tocadas.
2. **O "da vez" é lido na máquina**, não guardado no app: quem trocar por script continua visto certo.
3. **Segunda exceção de credencial, confinada a `src/main/proxies/`.** A chave de um proxy é guardada no cofre do
   app (o mesmo `accounts-vault.json`, namespace `proxy:<proxyId>:<machineId>`), uma por máquina, porque o portal
   pareia uma chave por máquina. Ela sai do cofre só dentro do programa que a máquina executa (stdin do node local ou
   do `ssh`, nunca argv) e fica lá num arquivo 600 (`~/.donel/proxy/<id>.key`) que o `apiKeyHelper` lê. Entra no
   cofre por digitação (write-only, nunca volta à tela) ou por "Importar a chave desta máquina", que roda o
   `apiKeyHelper` atual na máquina e devolve a chave pela saída do programa direto para o cofre. Nunca em log, em
   mensagem de erro, no `config.json` ou no renderer. **Não generalizar**: nenhum outro módulo ganha licença de
   tocar credencial por causa desta.
4. **Volta automática na troca**: a máquina chama `GET /v1/models` com a chave pelo novo caminho antes de gravar
   (sem 200, nada muda) e de novo pelo `apiKeyHelper` recém-gravado (sem 200, o `settings.json` anterior volta).
5. **Saúde sem chave**: o app sonda cada proxy a cada minuto, do próprio computador, sem chave. Resposta abaixo de
   500 = de pé. Uma queda do proxy em uso vira aviso com sugestão de troca, nunca troca sozinha.
6. **Nada da Seazone no código**: nenhuma URL de portal ou gateway fixa. O cadastro nasce vazio (com o lugar
   genérico "Outro PC") e se completa com o que as máquinas já usam.

## Consequências

- Uma troca feita pelo app troca também o `apiKeyHelper` daquela máquina para o arquivo do app; voltar pelo script
  antigo continua funcionando, porque o script restaura a cópia inteira do `settings.json`.
- A sonda vê o proxy a partir do computador do app; um proxy alcançável só de uma VPS aparece como fora. A checagem
  que vale para a troca é a da própria máquina.
- O `userData` é compartilhado entre canais: um canal mais antigo preserva a chave `proxies` do `config.json` como
  campo desconhecido.
