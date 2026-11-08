# Plano — Oráculo Harrow rodando na VPS pessoal

- Tarefa: t-d7a974d0 · prazo 10/11 · risco alto
- Pedido do dono: "E se o oráculo rodar dentro do VPS? Sei que é pedir demais para as 15h30, mas para a próxima
  vez, podemos organizar isso, né? No VPS pessoal"
- Pronto quando, **com o PC desligado**, há prints (ou vídeo) de:
  1. uma sessão da VPS respondendo `sessao_quem_sou` e `tarefa_listar`;
  2. a mesma sessão criando uma tarefa (`tarefa_criar`) e entregando-a (`tarefa_entregar`) com prova em arquivo
     lida na própria VPS;
  3. a carta dessa entrega chegando ao celular com notificação, e o dono respondendo nela.

## Limite desta rodada

O dono pediu "Parar e repensar" no Ledger v5. Por isso **o registro não muda**: o mesmo `ledger.json`
(`schemaVersion` 4), as mesmas provas em `ledger-provas/`, o mesmo `applyLedgerOp`. Muda só **onde** ele roda. A
cópia do PC para a VPS é byte a byte, sem conversão, e o arquivo do PC fica guardado como volta atrás.

## Uma linha só (PRs #248 e #249)

O #249 (05/11) levava o Oráculo para um serviço `donel-servico` na mesma porta 47816, com outro registro
(`~/.donel/ledger.json`) e migração por parse. Decisão do Líder (07/11): fica **esta** linha, porque copia byte a
byte e não mexe no formato, e o dono pediu "parar e repensar" o Ledger v5. O #249 fecha. Deste plano em diante,
só existe um Oráculo na VPS: `~/.donel/oraculo/`, unidade `donel-oraculo`. O `donel-servico` não está instalado na
VPS (conferido em 07/11: não há unidade, só um drop-in do proxy de saída, que fica de fora).

O que veio do #249 para cá:
- **Conferência da troca** (fatia 5): antes de ligar o modo remoto, recusar se o parse do contrato perderia alguma
  tarefa do arquivo (ele descarta tarefa malformada em silêncio) ou se falta alguma prova em arquivo; depois de
  copiar, reler na VPS e conferir ids e número de eventos; recusar um Oráculo da VPS que já tenha tarefas, salvo
  pedido explícito, e nesse caso guardar cópia antes.
- **Só o hash do token no disco da VPS** (ver Autenticação).
- **Celular pareia de novo uma vez**: o PWA guarda o token por origem, então o endereço novo pede um pareamento,
  mesmo levando o `celular.json`.
- O quadro empurrado pelo PC para a VPS usar com o PC desligado (a proposta da fatia 04 dele, que é a fatia 4 daqui).

O #248 (motor de contas em cada VPS) é outro assunto e não disputa porta nem registro com esta linha.

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
| App do PC | API, IP tailnet da VPS | Token de 256 bits que **o PC gera a cada boot** e guarda só em memória. Ele grava o sha256 em `~/.donel/oraculo/pc.token.sha256` (0600) **pelo ssh que já tem** para a VPS (`accounts.remotes`); o daemon só conhece o hash. Nada novo para o dono digitar ou guardar. (A fatia 1 ainda gera um `pc.token` em claro; a fatia 2 troca pelo hash e apaga o arquivo.) |
| Celular | PWA, `https://vps-alexandrelentz.tail8629f1.ts.net` | O pareamento de hoje (código de uso único → token; só o hash fica no disco). O link de parear sai das Preferências do PC (pela API) ou de `oraculo-vps.sh parear` na VPS. |
| Sessão da VPS | portão MCP, loopback | O `mcpToken` que a sessão já tem no `meta.json` dela. |
| Serviço sem tela (menções do Slack; t-a1ea2798) | API, IP tailnet da VPS | Token próprio por serviço, criado com `oraculo-vps.sh servico <nome>`: só o sha256 fica em `~/.donel/oraculo/servicos/<nome>.sha256`; apagar o arquivo (`revogar`) corta na hora. Alcança **só** `POST /v1/servico/apply` (criar, assumir, entregar, prova em texto ou link) e assina como o lugar `servico:<nome>`, seja o que for que o corpo diga. Não lê o registro, não mexe na troca, na volta nem no celular. Tarefa de serviço nunca vira órfã. |

Toda porta recusa conexão que não venha da tailnet (ou do loopback, no portão), como o servidor do celular faz hoje.
O token do PC age como `dono`, de propósito; por isso ele **nunca** serve ao celular nem ao portão MCP, que têm os
seus.

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
- **Canais antigos (risco do `userData` compartilhado)**: ao ligar o modo remoto, **primeiro** o `ledger.json` sai
  para a VPS (cópia byte a byte, `schemaVersion` 4, e lá fica 4). **Depois** o local vira
  `ledger.antes-da-vps.json`, e no lugar dele o PC grava a cópia do retrato marcada com `schemaVersion` **1000** e
  `oraculoRemoto: { lugar, desde }`. O 1000 fica longe da sequência para não ocupar o número do Ledger v5: um app
  futuro com versão 5 também lê o espelho só para ler, em vez de tomá-lo por um v5. O beta e o stable abrem só para
  ler ("gravado por uma versão mais nova") e não criam um segundo registro.
- Ao abrir, o app que encontra o espelho marcado (1000) **sem** o `oraculo-remoto.json` (alguém apagou com o app
  fechado) não grava nada: tenta baixar o registro da VPS que a marca aponta e, se não conseguir, fica só leitura
  e mostra o caminho manual abaixo.
- Celular: com o modo remoto ligado, o servidor do celular **do PC** não sobe; as Preferências → Celular mostram o
  estado e o link de parear do daemon.
- **Ida automática (Líder único, 08/11):** na primeira abertura da versão, ~15 s depois do início, o app faz sozinho o
  que o botão "Levar o Oráculo para a VPS" faz, para o primeiro lugar remoto com o daemon instalado. Antes de gravar
  qualquer coisa, uma sondagem só lê `~/.donel/oraculo/url`, e nenhum hash fica num lugar sem daemon. Se o celular
  estava ligado no PC, ele é ligado na VPS. A marca `<userData>/oraculo-ida-automatica.json` só é gravada depois de uma
  ida que deu certo; a ida não roda de novo nem depois de uma volta feita à mão. Qualquer falha devolve o registro ao
  PC: o `ledger.json` guardado volta ao lugar, a cópia da VPS é declarada morta (`/v1/devolver`) e, se só o
  `oraculo-remoto.json` falhou, o registro volta pela volta normal. A próxima abertura tenta de novo. O pareamento do
  celular não se mantém (o endereço muda de origem, e o token do celular fica preso à origem antiga): escanear o QR
  novo é a única ação do dono.

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

## Um escritor durante a troca e a volta (revisão do #295)

- O app fica **só leitura** do começo ao fim da troca e da volta: toda gravação dele é recusada com "o Oráculo está
  mudando de lugar", nunca um "ok" que se perde, e a troca só começa depois que as gravações em voo terminaram.
- Na ida, outro canal aberto no mesmo `userData` ainda pode gravar o `ledger.json`: logo antes de guardar o arquivo
  do PC, os bytes têm de ser os copiados. Se mudaram, a cópia recomeça por cima da cópia velha da VPS (pelo hash
  dela), até três vezes.
- Na volta, a VPS é avisada primeiro (**devolvido**): dali em diante todo escritor dela (API, celular, portão MCP)
  recusa, inclusive depois de reiniciar. O arquivo vem só se não mudou entre o começo e o fim; se a volta falha no
  meio, a VPS retoma o registro. Levar de novo substitui a cópia devolvida e a guarda como
  `ledger.devolvido-<hora>.json`.
- Com o `oraculo-remoto.json` esquecido e um `ledger.json` normal no PC, o app não entra no modo remoto (não grava
  por cima) e diz por quê.

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

**Pelo app (o caminho normal):** nas Preferências, desligar o modo remoto. O PC baixa o `ledger.json` (4) e as
provas da VPS para o `userData`, troca o espelho por ele, apaga o `oraculo-remoto.json` e volta a ser o escritor.
Depois, `scripts/oraculo-vps.sh parar` na VPS; `~/.donel/oraculo/` fica lá como cópia. O celular volta a parear
no PC.

**À mão, com o app fechado** (o `oraculo-remoto.json` sumiu, ou o app não abre). No `userData` do PC
(`%APPDATA%\donel-dev\`), com **todos** os canais do Donel fechados:

1. VPS no ar (o registro mais novo):
   `scp <lugar>:.donel/oraculo/ledger.json ledger.json` e `scp -r <lugar>:.donel/oraculo/ledger-provas/. ledger-provas/`
   (substitui o espelho marcado; as provas que já estão no PC ficam). Antes, pare o daemon
   (`scripts/oraculo-vps.sh parar`) para nada gravar no meio da cópia.
2. VPS fora do ar: o espelho marcado é o último retrato que o PC viu. Abra o `ledger.json` e troque
   `"schemaVersion": 1000` por `"schemaVersion": 4` (o campo `oraculoRemoto` pode ficar: o parse descarta).
3. Sem espelho também: renomeie `ledger.antes-da-vps.json` para `ledger.json`. É o registro do momento da troca; o
   que mudou depois dela só existe na VPS.

Em todos os casos, apague o `oraculo-remoto.json` se ele ainda existir, e só então abra o app.

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
5. **Troca de verdade e prova** — instalar na VPS, copiar o registro com a conferência acima, ligar o PC, parear o
   celular, desligar o PC e produzir as três provas do "Pronto quando" (identidade e lista, criar e entregar com
   prova em arquivo, carta no celular com notificação e resposta).

## Fora desta rodada

Mudar o formato do registro (Ledger v5); abrir sessão nova na VPS com o PC desligado; transcrição de áudio na VPS;
mais de um PC escrevendo.
