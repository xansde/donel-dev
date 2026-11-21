---
name: Avisos no celular
type: adr
status: accepted
created: 2026-11-20
updated: 2026-11-20
tags: [adr, celular, oraculo, notificacao, t-b07b50ff]
aliases: [ADR-0011, aviso nativo, long-poll de avisos]
---

# ADR 0011 — Avisos no celular por long-poll assinado

## Contexto

Em 20/11/2026 o dono pediu: "Eu prefiro não receber mensagem do que receber uma mensagem vazia tua. Porque eu
pretendo que um dos próximos passos seja você me notificar como um aplicativo normal notifica." O app do celular é
Tauri 2 no Android; a WebView dele não tem Push API, então o Web Push que já existe (`src/main/celular/webpush.ts`)
não chega com o app fechado. O contrato fechado é o v1 (`~/seazone/_scratch/sondas/notificacao-celular/contrato.md`,
tarefa t-b07b50ff), escolhido por 3 juízes entre SSE, UnifiedPush/ntfy e long-poll.

## Decisão

1. **Long-poll assinado no entregador.** `GET /api/v2/avisos?desde=<cursor>&espera=<1..50>` na 47815, com a mesma
   assinatura `Donel-HMAC` do resto do `/api/v2` (a query entra na assinatura). A rota está em `CHAT_ROUTES`: quem
   responde é o entregador, onde mora o chat. O registro não tem a dependência e responde `404 nao-encontrada`.
2. **Flag local `celular-avisos`** (`~/.donel/flags/celular-avisos` na VPS), lida a cada pedido. Desligada, a resposta
   é `404 desligada` e o app para o serviço. Apagar o arquivo é a volta.
3. **Três fontes, um cursor opaco** (`base64url` de `{c:{em,id}, k, t}`):
   - o chat: linhas do Líder único em `chat-local.json`, comparadas pela tupla `(criada_em, id)`, nunca pela posição;
   - as cartas: o registro grava em `avisos-cartas.json` (600, 50 entradas) cada item de `CARD_KINDS` que passou a
     esperar o dono (`onFresh` do `service.ts`, chamado antes de qualquer conferência de inscrição de push). `seq` =
     `max(agora, último + 1)`, que nunca volta;
   - o teste: `POST /local/celular/aviso-teste` no portão 47817 (só loopback), em memória.
4. **Sem texto, sem aviso.** `avisavel` recusa texto vazio, só espaços, só `-`, a linha "↳ respondi junto com a
   mensagem seguinte." e título vazio; a linha do dono nunca vira aviso. Antes de conferir o vazio, título e texto
   (chat e carta) perdem os caracteres invisíveis, `replace(/[\p{Cc}\p{Cf}\p{Z}]/gu, '')`: um texto só de U+200B,
   U+2060, U+200C/U+200D, U+FEFF, controles ou espaços de qualquer tipo não vira aviso. O app confere de novo e
   **deve fazer a mesma limpeza** em Kotlin (`Regex("[\\p{Cc}\\p{Cf}\\p{Z}]")` antes do `isBlank`): o `isBlank`
   sozinho não pega U+200B nem U+2060, que não são espaço para ele.
5. **Tetos.** Título até 70 caracteres e texto até 300, cortados com `…`; cada aviso serializado até 2048 bytes. Até
   10 avisos por resposta, os mais antigos primeiro, com `mais: true` quando sobram. Nada com mais de 24 h sai. Um
   cursor velho (mais de 10 esperando e o mais antigo pendente com mais de 30 min: o aparelho ficou fora de verdade,
   como a noite) leva só os 10 mais recentes e salta para o fim, para a noite sem rede não virar dezenas de vibrações.
   As puladas não viram notificação, mas seguem no chat. Abaixo de 30 min (o Doze de alguns minutos numa rajada do
   Líder) tudo sai, página por página com `mais: true`; o limiar de 5 min da primeira versão pulava falas reais.
7. **Uma ordem só.** O chat é ordenado e comparado com o cursor pela tupla `(criada_em, id)` por unidade de código
   UTF-16 (`<`/`>`), nunca `localeCompare`: duas ordens diferentes perdiam ou repetiam linha na fronteira de 10.
6. **Um pedido em espera por aparelho.** O pedido novo do mesmo aparelho encerra o anterior com `avisos: []`.

## Consequências

- Nenhuma credencial nova e nenhum app novo no celular; o PC fica fora do caminho (VPS → tailnet → celular).
- O app (repo `donel-celular`) ganha um serviço em primeiro plano que segura o long-poll; é o PR 2 da tarefa.
- Carta que passa a esperar com o registro parado não avisa depois (o `newlyWaiting` recomeça ao subir). Aceito.
- O `seq` do teste recomeça quando o entregador reinicia. Aceito: é só teste.
- Plano B, com a mesma carga JSON, se o long-poll falhar no Doze: SSE (`GET /api/v2/eventos`).
