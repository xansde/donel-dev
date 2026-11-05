# Handoff — Slack só com carta, e aviso no celular (`slack-carta`)

- **Data**: 2026-11-05 (prazo do dono: 06/11)
- **Pedido** (dono, 05/11 ~14h50): "Preciso que toda mensagem que for enviada para o slack em meu nome seja uma
  carta no oráculo antes de qualquer coisa. Também preciso que ele tenha notificação no meu celular."
- **Onde**: sessão Dev na VPS, worktree `../donel-wt/slack-carta`. Só git e gh: o MCP `donel` daqui dava 403
  (é justamente o que a fatia 1 corrige).
- **Fatiamento**: seção `slack-carta` no `BACKLOG.md`, feita à mão (a skill `esteira:fatiamento` não está
  instalada na VPS).

## O que está pronto

Três PRs contra `staging`, **empilhados**: cada um contém o anterior até ele entrar. A ordem de merge é
01 → 02 → 03 → 04.

| Fatia | PR | Branch | O que faz |
|---|---|---|---|
| 01 | #239 | `feat/slack-so-com-carta` | Sessão na VPS conecta no MCP `donel`: o gate aceita o `Host` da porta do túnel `ssh -R` só com o token da sessão daquele túnel (B38, primeiro item). Nenhuma porta nova. |
| 02 | #241 | `feat/slack-so-com-carta-02` | Carta "mensagem para o Slack" (`carta_slack`: destino, thread, texto exato, motivo), nasce esperando o dono. A ponte de hooks recusa no `PreToolUse` todo envio ao Slack (MCP do Slack, Composio, curl `chat.postMessage`, webhook, `canal-produto.js postar/responder`) sem carta aceita de mesmo destino, thread e texto; cada carta libera um envio. |
| 03 | #243 | `feat/slack-so-com-carta-03` | Web Push no PWA: service worker, sino para ligar, aviso com o título humano quando uma carta passa a esperar o dono, toque abre a carta. Criptografia RFC 8291 + VAPID feitas com `node:crypto` (bate com o vetor da RFC), sem dependência nova. |
| 04 | (PR da fatia 4) | `feat/slack-so-com-carta-04` | Falha fechada (pedido do Líder, 05/11 à noite): a sessão remota ganha um hook de comando que, com o app fora do ar ou sem reconhecer a sessão, **recusa** o envio ao Slack e diz por quê. Com o app no ar, a ponte segue decidindo pela carta. |

Verificação em cada fatia, na VPS: typecheck verde, `npm test` com só as 2 falhas que já existem em
`staging` no Linux (`config-store` e `remoteSessions`, caminho do Windows), `electron-vite build` verde.
Smoke não rodou.

## O passo do dono (para o aviso no celular)

O navegador só deixa registrar service worker (e receber push) em `https`. O app do celular hoje é
`http://<IP Tailscale>:47815`. Uma vez só:

1. No painel da Tailscale (login.tailscale.com → **DNS**): ligar **MagicDNS** e **HTTPS Certificates**.
2. No PowerShell do PC: `tailscale serve --bg --https=443 http://<IP Tailscale do PC>:47815`.
   O IP aparece em Preferências → Celular ("No ar em …"), e o comando pronto também está ali.
3. Preferências → Celular → **Parear um celular** de novo. Com o `serve` no ar, o QR já sai com
   `https://<pc>.<tailnet>.ts.net`. O pareamento antigo (http) continua valendo para decidir, mas não avisa.
4. No celular:
   - **iPhone**: abrir no Safari, **Adicionar à Tela de Início**, abrir pelo ícone e tocar no sino (iOS 16.4+).
   - **Android**: tocar no sino e permitir.

Sobre "sem serviço de terceiros": o aviso com o app fechado só existe pelo serviço de push do próprio
navegador (Google no Android, Apple no iPhone). O que passa por ele vai cifrado com as chaves que o celular
gerou (RFC 8291), então eles não leem o título. Todo o resto (inscrição, fila, decisão) fica na tailnet.

## O que falta / ficou de fora

- **Merge**: os 3 PRs esperam o Revisor · Donel (VPS).
- **Conflito com a forma A** (#236, #237, outro Dev, mesmos arquivos): quem entrar por último resolve. Se a
  forma A entrar antes, esta demanda mescla `staging`:
  - sobe `LEDGER_SCHEMA_VERSION` para 4;
  - dá à carta de Slack um bloco `forOwner` automático ("Enviar"/"Não enviar");
  - passa a usar o `titulo` da forma A no aviso (`pushTitle` já lê `title` quando existir);
  - roda o verify de novo.
- **Decisão pendente do dono: trava para um `claude` aberto à mão.** Hoje a trava vem no `--settings` das
  sessões que o Donel abre. Um `claude` aberto à mão num terminal fica fora, porque o `~/.claude/settings.json`
  do dono não é tocado (regra do projeto). Fechar isso exige o dono autorizar um hook no settings global dele
  (no PC e na VPS). Decisão do Líder (05/11): fica de fora por enquanto.
- **Falha fechada (fatia 4)**: vale para a sessão remota, que é quem sobrevive ao app. A sessão local é filha
  do app e morre com ele, por isso fica só com o hook `http`. Com o app no ar, o hook de comando confia na
  ponte. Se a ponte responder ao `/h/Ping` e falhar no hook `http` no mesmo instante, o envio passaria; essa
  janela é estreita e está aceita. Sem o app, a recusa é ampla de propósito: recusa até rascunho do Slack.
  Sessões remotas abertas antes desta versão continuam sem o hook até serem reabertas.
- **A sessão não é avisada da decisão da carta**: ela confere com `tarefa_ver`. A entrega à sessão é a
  fatia 5 da forma A.
- **O aviso usa o pedido como título** até a forma A trazer o `titulo` humano. A carta de Slack já tem título
  próprio ("Mensagem no Slack para #canal").
- **Outros itens do B38**: falha visível no cartão, arquivo da VPS no painel e anexos do chat.
- **Validação no alfa**:
  1. sessão na VPS responde `sessao_quem_sou`;
  2. "manda 'oi' no #teste" leva recusa, cria a carta e, depois do aceite, envia uma vez;
  3. carta nova faz o celular vibrar com o app fechado.
