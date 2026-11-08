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
- **Vigia sem o PC**: a fase 1 roda no app do PC. Com o PC desligado não há vigia; levar a regra ao daemon da VPS
  (`src/oraculo`) é a fase seguinte, já prevista no contrato das rotinas ("mover para a VPS").
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
