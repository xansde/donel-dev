# Plano — Oráculo Harrow rodando na VPS pessoal

- Tarefa: t-d7a974d0 · prazo 10/11 · risco alto
- Pedido do dono: "E se o oráculo rodar dentro do VPS? Sei que é pedir demais para as 15h30, mas para a próxima
  vez, podemos organizar isso, né? No VPS pessoal"
- Pronto quando: vídeo ou prints do celular respondendo uma carta com o PC desligado, e `sessao_quem_sou` e
  `tarefa_listar` respondendo numa sessão da VPS.

## Limite desta rodada

O dono pediu "Parar e repensar" no Ledger v5. Por isso **o registro não muda**: o mesmo `ledger.json`
(`schemaVersion` 4), as mesmas provas em `ledger-provas/`, o mesmo `applyLedgerOp`. Muda só **onde** ele roda. A
cópia do PC para a VPS é byte a byte, sem conversão, e o arquivo do PC fica guardado como volta atrás.

## Topologia

```
 celular ──https (tailnet)──► VPS: donel-oraculo  (Node, sem tela, systemd --user; linger já ligado)
                                 ├─ ~/.donel/oraculo/ledger.json + ledger-provas/   ← a única cópia que grava
                                 ├─ PWA do celular + avisos (o servidor de hoje, src/main/celular)
                                 ├─ API do Oráculo   100.110.135.26:47816  (só tailnet, token)
                                 └─ portão MCP       127.0.0.1:47817       (só as sessões da VPS)
 PC (app) ───API (tailnet)───────┘  lê por um retrato em memória, grava pela API, empurra o retrato do quadro
 sessão na VPS ──MCP──► portão ──► túnel do PC (como hoje)  ou, sem PC, responde ele mesmo
```

- **Um processo, um escritor.** `donel-oraculo` roda o `createLedgerService` de hoje sobre
  `~/.donel/oraculo/ledger.json`. Todo `apply` passa por ele, em fila, como hoje passa pelo main do PC.
- **Código reaproveitado sem cópia**: `ledger-store.ts`, `shared/ledger/*`, `celular/*` já não dependem do Electron
  (só tipos). O daemon é um bundle Node (`vite build` próprio, `out/oraculo/oraculo.mjs`) que entra no
  `npm run build` e, portanto, no `verify`.
- **Instalação**: `scripts/oraculo-vps.sh instalar|atualizar|parar|status` builda a partir do checkout de `staging`
  na VPS e grava a unidade `~/.config/systemd/user/donel-oraculo.service`.

## Autenticação

| Quem | Por onde | Como prova quem é |
|---|---|---|
| App do PC | API, IP tailnet da VPS | Token de 256 bits que o daemon gera em `~/.donel/oraculo/pc.token` (0600). O PC **lê pelo ssh que já tem** para a VPS (`accounts.remotes`), a cada boot, e guarda só em memória. Nada novo para o dono digitar ou guardar. |
| Celular | PWA, `https://vps-alexandrelentz.tail8629f1.ts.net` | O pareamento de hoje (código de uso único → token; só o hash fica no disco). O link de parear sai das Preferências do PC (pela API) ou de `oraculo-vps.sh parear` na VPS. |
| Sessão da VPS | portão MCP, loopback | O `mcpToken` que a sessão já tem no `meta.json` dela. |

Toda porta recusa conexão que não venha da tailnet (ou do loopback, no portão), como o servidor do celular faz hoje.

**Pré-requisito do dono (uma vez):** os avisos do celular só funcionam em https, e o `tailscale serve` na VPS
pede root (sem `--operator` hoje, e a sessão não tem sudo). Rodar uma vez na VPS:
`sudo tailscale set --operator=alexandrelentz`. Sem isso, o celular lê e responde pela http da tailnet, mas não
recebe notificação.

## O app do PC

- Liga por um arquivo próprio, `<userData>/oraculo-remoto.json` (`{ "ssh": "<lugar remoto>", "url": ... }`), **não**
  pelo `config.json`: assim o canal beta/stable, que não conhece a chave, não a derruba no sanitize.
- `LedgerService` ganha uma segunda implementação, `remote`: `load()` devolve o retrato em memória (atualizado por
  SSE a cada mudança); `apply()` vira `Promise` e vai pela API. A versão local passa a devolver `Promise` também,
  então os ~25 chamadores mudam uma vez e a regra não muda.
- **Provas**: entregar do PC envia os bytes pela API; o PC mantém o espelho de `ledger-provas/` baixando o que
  faltar, então `proofPath`, `tarefa_ver` e o protocolo das provas no app seguem iguais.
- **Canais antigos (risco do `userData` compartilhado)**: ao ligar o modo remoto, o `ledger.json` local vira
  `ledger.antes-da-vps.json` e no lugar dele fica a cópia do retrato com `schemaVersion` acima da atual. O beta e o
  stable abrem só para ler ("gravado por uma versão mais nova") e não criam um segundo registro.
- Celular: com o modo remoto ligado, o servidor do celular **do PC** não sobe; as Preferências → Celular mostram o
  estado e o link de parear do daemon.

## PC desligado

- **Celular**: lê as cartas, abre as provas, decide e comenta direto no daemon. O aviso sai da VPS quando uma carta
  passa a esperar o dono (a lógica `newlyWaiting` de hoje).
- **Recado à sessão dona** (decisão e comentário do dono, `tellDecision`): se a sessão dona roda na VPS e o tmux
  dela está vivo, o daemon entrega lá (`tmux -L donel`, como o PC entrega pelo ssh hoje). Se é sessão do PC, o
  recado entra na **fila** (`~/.donel/oraculo/fila.json`).
- **Pedido pelo Oráculo** (ao Líder único, que vive no PC): entra na fila. Pedido por áudio fica fora com o PC
  desligado (a transcrição é o whisper do PC); o celular diz isso e oferece texto.
- **Sessões da VPS**: o `mcp.json` das sessões novas aponta para o portão. Com o túnel vivo, o portão só repassa.
  Com o túnel caído, responde ele mesmo `sessao_quem_sou`, `sessao_listar` e os `tarefa_*`, a partir do último
  retrato do quadro que o PC empurrou. O quadro mora no PC e **não muda com o PC desligado**, então o retrato é o
  quadro de verdade, menos o estado vivo das sessões (a resposta diz "quadro de HH:MM, PC desligado"). As outras
  ferramentas respondem "o PC está desligado". Prova em arquivo: o portão lê o arquivo na própria VPS.
- Sessões que já existiam antes da instalação seguem apontando direto para o túnel: só as abertas depois passam
  pelo portão.

## PC religado: fila e conflito

- No boot: lê o token pelo ssh, pega o retrato inteiro (dispara o `onChange` de hoje: faixa, Jobu, espelho
  Supabase, hill climbing), baixa as provas que faltam, empurra o retrato do quadro e **esvazia a fila**: cada
  item vai pelo `deliverOwnerMessage` de hoje e só sai da fila com o ack do PC (sem ack, tenta de novo; o id do
  item impede entregar duas vezes).
- **Conflito não existe por construção**: só o daemon grava. O PC desligado não tem o que reconciliar.
- **VPS fora do ar com o PC ligado**: o PC mostra o último retrato **só para ler** e recusa gravar com motivo
  claro ("o Oráculo da VPS não respondeu; nada foi gravado"). Não há fila de escrita no PC de propósito: com ela,
  o dono aceitaria no PC o que o celular recusou na VPS, e alguém teria de desempatar.

## Volta atrás

1. Nas Preferências (ou apagando `oraculo-remoto.json`), desligar o modo remoto: o PC baixa o `ledger.json` e as
   provas da VPS para o `userData`, no formato de sempre, e volta a ser o escritor. O celular volta a parear no PC.
2. `scripts/oraculo-vps.sh parar` desliga e desabilita a unidade; `~/.donel/oraculo/` fica na VPS como cópia.
3. Se a VPS sumiu: `ledger.antes-da-vps.json` é o registro do momento da troca.

## Fatias (cada uma: TDD, `npm run verify` verde, PR contra `staging`)

1. **Daemon com a API do Oráculo** — bundle Node, `ledger` local, `GET /v1/ledger`, `GET /v1/eventos` (SSE),
   `POST /v1/apply`, provas, token, recusa fora da tailnet; script de instalação. Testes: token, apply de ponta a
   ponta, recusa de origem.
2. **PC em modo remoto** — `apply` assíncrono, implementação remota, espelho das provas, troca e volta atrás do
   `ledger.json`, só-leitura com VPS fora. Testes: nada se perde na troca e na volta; gravação recusada sem VPS.
3. **Celular na VPS** — o servidor do celular dentro do daemon, avisos, pareamento pela API, fila de recados e
   pedidos com ack. Testes: fila sem duplicar nem perder.
4. **Sessões da VPS sem o PC** — retrato do quadro empurrado pelo PC, portão MCP com repasse e resposta própria,
   `mcp.json` novo no preparo da sessão remota. Testes: identidade vinda do retrato; repasse com PC ligado.
5. **Troca de verdade e prova** — instalar na VPS, copiar o registro, ligar o PC, parear o celular, desligar o PC,
   responder uma carta no celular e chamar `sessao_quem_sou`/`tarefa_listar` numa sessão da VPS.

## Fora desta rodada

Mudar o formato do registro (Ledger v5); abrir sessão nova na VPS com o PC desligado; transcrição de áudio na VPS;
mais de um PC escrevendo.
