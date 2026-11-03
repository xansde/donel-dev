---
tema: auto-sem-permissao
data: 2026-11-03
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-11-03
---

# Refinamento — Modo auto não pede permissão

## Demanda

Dono, 03/11: "às vezes pede permissão para eu aceitar algo, mesmo no modo automático. Quero abolir
isso". O Launcher promete `auto` como "roda ferramentas sem confirmar".

## O que dispara pedido no modo auto (lido no binário do CLI 2.1.317)

O classificador do modo auto não cobre tudo. O CLI cai no diálogo normal, e o hook
`PermissionRequest` dispara, nestes casos:

| Motivo no CLI | O que é | Com o app |
|---|---|---|
| `safety_check` | Verificação de segurança que o classificador não pode aprovar (ex.: escrita em caminho protegido) | Aprovado, com rastro |
| `ask_rule` | Regra `ask` do `settings.json` | Aprovado, com rastro |
| `org_ask_ceiling` | Teto `ask` de servidor MCP vindo da organização | Aprovado, com rastro |
| `transcript_too_long` | Conversa grande demais para o classificador avaliar | Aprovado, com rastro |
| `mode_changed_while_queued` | O modo mudou com a chamada na fila | Vale o modo atual do pedido |
| `requires_user_interaction` | Ferramenta que pergunta algo à pessoa | Chega ao dono |
| Limite de bloqueios (3 seguidos ou 20 no total) | **O classificador barrou**, e o CLI troca a recusa por um diálogo | Chega ao dono |
| `personOnly` (sem classificador na sessão, bloqueio do Chrome, certos cartões) | Só uma pessoa aprova | O hook nem dispara: pede no terminal |

O `permission_mode` que vem no próprio pedido é `ae(ctx).mode`, o modo vivo da sessão: acompanha o
Shift+Tab. `plan` com auto ligado chega como `plan` e não é aprovado.

## Decisões

1. Com `permission_mode === 'auto'` no pedido, a ponte responde `allow` na hora, sem pendência, sem
   notificação e sem semáforo "esperando você". A decisão é pura: `autoApprovalVerdict`, em
   `src/shared/chat/pendingQueue.ts`.
2. Continuam com o dono: `AskUserQuestion`, `ExitPlanMode` e os cartões do CLI `OfferChromeSetup`,
   `ShowOnboardingRolePicker` e `PublishPlugin`.
3. **Bloqueio do modo auto continua valendo, e aqui a premissa do pedido não fechava.** Os bloqueios
   normalmente viram recusa, mas o terceiro seguido (ou o vigésimo no total) vira um
   `PermissionRequest` comum, sem nada que o distinga. Responder `allow` ali desfaria o bloqueio,
   justo no ponto em que o CLI manda revisar a conversa. Por isso a ponte conta os bloqueios pelo
   hook `PermissionDenied` e para de aprovar um antes do limite: com 2 seguidos ou 19 no total, o
   pedido vai ao dono. A sequência só zera depois de um `Bash`, `PowerShell` ou MCP concluído, os que
   certamente passaram pelo classificador. Conta por aba, somando subagentes. Erro para o lado de
   perguntar, nunca para o de aprovar. Fica em `chat-diagnostics.log` como `after-blocks`.
4. Rastro: linha "Permitido automaticamente: ‹resumo›" no chat, na posição em que aconteceu, e
   `{kind: 'auto-approval', ptyId, tool, outcome}` no `chat-diagnostics.log`. O log leva só o nome da
   ferramenta (contrato do log: nada de conteúdo da conversa). A linha do chat fica em memória, como
   o aviso de troca de conta: some ao reiniciar o app.
5. Preferências: "Modo auto nunca pede permissão", chave de topo `autoMode.neverAsks` (canal antigo
   preserva em `unknownFields`), ligada por padrão, valor inválido cai no padrão. Vale na hora.
6. Sem chat: barato, então foi feito. O hook entra no `--settings` da sessão também com o chat
   desligado, se o interruptor estiver ligado ao abrir a sessão. A ponte aprova o que é de auto e
   responde `{}` ao resto, e o terminal pede como sempre. Sem chat o rastro é só o log.

## O que ainda pode pedir no modo auto

- Pedidos `personOnly`: o CLI nem chama o hook, de propósito.
- O limite de bloqueios (decisão 3).
- `AskUserQuestion`, plano e cartões do CLI.
- Elicitação de MCP (formulário pedido por um servidor): não é permissão, tem hook próprio.
- Ferramenta MCP marcada com `anthropic/requiresUserInteraction`, ou recusada pela política de
  servidores: o CLI **ignora** o `allow` e mantém o diálogo no terminal. O payload não diz isso, então
  o rastro registra uma aprovação que não valeu. Raro, e cai no terminal, nunca executa sem a pessoa.

## Não muda

Regras `deny`, hooks `PreToolUse` do dono e recusas do classificador rodam antes e não viram pedido.
Os modos `default`, `acceptEdits`, `plan` e `bypassPermissions` seguem iguais.

## Risco aceito

O `allow` também passa por cima de regra `ask` do dono e de verificação de segurança que o CLI
pediria para confirmar. É o que o pedido quer ("abolir"), e fica no rastro. Quem quiser manter uma
ação sob confirmação usa regra `deny`, ou desliga o interruptor.

Os limites 3 e 20 são constantes do CLI 2.1.317 copiadas para o app. Se o CLI mudar, o app pode
aprovar um bloqueio no limite novo; conferir ao subir de versão.
