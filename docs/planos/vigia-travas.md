# Vigia de travas — fase 1 (t-f15b71a7)

Pedido do dono (06/11): "vc tem que saber quando isso acontece e, travamentos assim que congelam tudo, deve ser
avisado no oráculo ou com máxima prioridade" / "E você mesmo tem que ser capaz de destravar isso".

Decisão do Líder único (08/11): **fase 1 sem senha**. O app não guarda nem envia a senha mestra do cofre. A cura
automática do cofre fica de fora até o dono decidir, porque o CLAUDE.md limita credencial a `src/main/accounts/` e
proíbe generalizar a exceção. A entrega registra isso como pendência explícita.

## O que a fase 1 faz

A cada 5 min, o app do PC olha as VPS e as sessões delas. Quando uma trava se confirma em **duas rodadas seguidas**
(10 min), abre **uma carta urgente** no Oráculo. O próprio Oráculo já manda o push de prioridade máxima
(`Urgency: high`) ao celular, uma vez por carta. Quando a trava some, a carta é cancelada com o motivo "a trava passou
sozinha", e uma trava nova da mesma chave pode avisar de novo.

### Travas detectadas (determinísticas, sem modelo)

| chave | o que é | de onde vem |
|---|---|---|
| `vps-fora:<lugar>` | VPS inalcançável há duas rodadas | `RemoteHealthReport.status === 'unreachable'` |
| `vps-login:<lugar>` | o ssh pede verificação/login (ex.: Tailscale SSH) | stderr do ssh, hoje descartado pelo serviço de saúde: passa a guardar a última linha (limpa) e o `timedOut` |
| `sessoes:<lugar>` | sessões `travada` ou repetindo uma chamada que falhou (`retry`) há mais de 10 min, uma carta por lugar | `pulseOfRemote(reading, now)` (`shared/mindscape/bottlenecks.ts`) sobre `sessionDetails` |
| `cofre:<lugar>` | cofre trancado, sem login ou lento (> 20 s ou sem resposta) | **adaptador opcional** `vigia.cofre` na config (`command`, `sessionFile`), desligado por padrão: `<command> status` com prazo, só o campo `status` e o tempo |

**Cofre sem tocar segredo no app.** O script roda na VPS. A chave de sessão do `bw` é carregada pelo próprio shell da
VPS a partir de `~/.bw_session`, vai só no ambiente do `bw` (nunca em argumento) e nada além de `status` e do tempo
volta ao app. O app nunca lê, guarda ou registra a chave. Sem `bw` ou sem o arquivo, a linha diz "ausente" e não há
trava de cofre.

### Peças reusadas

- Leitura: `createRemoteHealthService` (60 s) — o vigia lê o último relatório de cada lugar; não abre ssh próprio.
- Rodada de 5 min: o mesmo relógio das rotinas (`routine-runner`), com o filtro de "duas rodadas seguidas".
- Carta: `ledgerService.apply` com `criar` (risco alto) → `assumir` → `entregar` com `forOwner`, como o
  `hillclimb_propor` (`hill-climb-store.ts`). Funciona com o Oráculo no PC ou na VPS (`ledger-remote`).
- Push: automático pelo item `decidir-entrega` (já `Urgency: high`, um por carta).

### Estado e repetição

`<userData>/vigia-travas.json`: chave → `{ desde, cartaId, rodadas }`. Grava só ids e horários, nunca texto do ssh
com segredo (a linha do stderr é cortada e passada pelo mesmo filtro de máscara do celular antes de entrar na carta).
Reinício do app não reabre carta de trava que já tem carta aberta.

### Testes (vitest, só lógica pura e o arquivo de estado)

1. Detecção: cada trava a partir de relatórios de exemplo; nada com VPS ok; sessão parada há 9 min não conta.
2. Confirmação: uma rodada não abre carta; duas abrem uma.
3. Não repetir: a mesma trava em rodadas seguidas e depois de reiniciar (estado em disco) não abre segunda carta nem
   segundo push; a trava que some cancela a carta; voltando, abre de novo.
4. Segredo: o script do cofre não põe chave em argumento; a carta e o estado nunca carregam o que veio do `bw` além de
   `status`/tempo; o stderr entra mascarado.

## Fora da fase 1 (pendências explícitas)

- **Cura do cofre** (destravar sozinho pelo PC): depende de o dono emendar a regra de credenciais. Até lá, a carta diz
  o que fazer à mão.
- ~~**Vigia sem o PC**~~: feito na fase 2 (abaixo).
- **"No topo"**: a caixa ordena por bloqueio, prazo e idade (desktop) e da mais antiga para a mais nova (celular).
  A carta nasce bloqueando e com prazo de hoje; garantir o primeiro lugar pede um campo novo no Oráculo (sobe o
  `schemaVersion`) — fica para depois de medir se a ordem atual basta.

## Revisão de 08/11 (Revisor, achados do #349)

1. **Cofre vira adaptador.** Nada do cofre do dono fica no código: `vigia.cofre = { command, sessionFile }` na config
   (chave de topo, como `homologacao`), desligada por padrão; sem ela o vigia olha só o genérico. Os valores passam por
   uma validação estrita (nome de programa, caminho relativo sem `..`) e entram no script entre aspas simples.
2. **O Oráculo pode ser quem caiu.** Desde o #331 ele mora na VPS; se ela cai, nem a carta nem o push saem. Quando a
   carta não pode ser feita, o PC mostra uma notificação nativa (uma vez por trava). A carta sai quando o Oráculo volta,
   com o horário da primeira leitura que viu a trava; se a trava já passou, sai uma carta de registro, com início e fim.
3. **"Esperando a API".** Escolha: contar só quando o CLI está repetindo uma chamada que falhou (`retry`). Subir o
   limiar para 20 min só moveria o alarme falso de uma resposta longa e legítima, que não repete nada.

## Fase 2 — o vigia no daemon do Oráculo (t-ffbf8e7d, 08/11)

Com o PC desligado, o daemon do Oráculo (`src/oraculo/vigia.ts`) vigia **a VPS onde ele mora** com as mesmas regras
e o mesmo serviço do PC (`createVigiaService`): cofre (só com o adaptador `vigia.cofre`) e sessões em laço. A carta
nasce no ledger dele, e o push ao celular sai dali mesmo, sem o PC.

- **O que vem do PC:** em cada aperto de mão (`handshakeScript`), o PC deixa `~/.donel/oraculo/vigia.json` com o id e
  o nome que ele dá ao lugar (as chaves das travas batem com as do PC), o quadro onde a carta é arquivada e o
  adaptador do cofre. Vai em base64 e não leva segredo. Sem o arquivo, o daemon não vigia nada.
- **Sem carta dobrada:** o daemon deixa `vigia.ativo`, e o aperto de mão responde `vigia-ativo`. A partir daí, o PC
  não abre carta de cofre nem de sessões daquele lugar (`delegated`), mas segue avisando se ele cair ou pedir login:
  ninguém vê a própria queda. PC novo com daemon velho, ou o contrário: quem não sabe do outro vigia tudo, como na
  fase 1.
- **Uma trava, uma carta, também quando a delegação muda** (revisão do #353): o critério da carta viva leva a chave
  da trava (`chave da trava: cofre:<lugar>`). Antes de abrir, o vigia (do PC ou do daemon, que usam o mesmo lugar de
  serviço) procura uma carta viva do `servico:vigia` com essa chave e a **adota**. Quando o PC passa a delegar com a
  trava ainda viva, ele **passa** a carta adiante (tira do estado dele sem cancelar) e o daemon a adota; só a trava
  que sumiu é cancelada como "passou sozinha". Na volta do Oráculo ao PC, o PC adota a carta do daemon.
- **Sem quadro, sem delegação:** o aperto de mão só responde `vigia-ativo` quando o PC tem um quadro para a carta. Sem
  ele, o daemon não vigiaria (`parseDaemonVigiaConfig` dá `null`) e o PC segue vigiando tudo.
- **Ressalva — a config só chega no aperto de mão** (boot do app ou depois de um 401). Ligar o `vigia.cofre` ou trocar
  o projeto com o app aberto só chega ao daemon no próximo aperto de mão; até lá, o daemon segue com a config velha.
- **Fora:** o daemon não vigia a outra VPS (exigiria ssh de VPS para VPS, que hoje não existe). Com o PC desligado e
  a homologações caída, ninguém avisa.

Testes: `tests/vigia-no-oraculo.test.ts`.
- O daemon, com o cofre trancado em 4 rodadas, abre uma carta só (risco alto, no quadro que o PC disse).
- Sem a config do PC, o daemon não vigia.
- O PC com o lugar delegado não abre a carta do cofre, mas abre a de "VPS fora".
- O aperto de mão grava a config e só diz `vigia-ativo` com o daemon vigiando, sem estragar a URL.
- Sem quadro, o aperto de mão não diz `vigia-ativo`.
- PC e daemon no mesmo Oráculo: na volta ao PC, no liga e desliga da delegação e no começo dela com a carta do PC
  aberta, sai uma carta só, e ela fecha quando a trava passa.
