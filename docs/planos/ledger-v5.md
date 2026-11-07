---
demanda: ledger-v5
titulo: Ledger v5 — o Oráculo Harrow em padrão top de linha
cliente: Alexandre Lentz (dono e usuário diário do Donel Dev)
responsavel: Dev · síntese do ledger top (tarefa t-921337a4)
canal-slack: "não existe — ferramenta pessoal, sem Slack"
taskdex: []  # ferramenta pessoal, sem card
origem: pedido do dono, 07/11 — "Primeiro de tudo, o ledger está uma bosta. Quero ele em padrão top de linha, manda as pesquisas todas." e "Tem o "Quem pediu" como Dev, que não é NADA esclarecedor."
criado: 2026-11-07
status: proposta — esperando a decisão do dono (nada de código antes)
aprovado-por: —
---

# PDA — Ledger v5

> Processo: as skills `esteira:pda` e `esteira:prototipo` não estão instaladas na VPS onde esta
> sessão roda, então segui o processo à mão: destino → diagnóstico → decisões com as
> divergências → modelo → protótipo ("como vai ficar") → fatiamento. Nenhuma linha de código foi
> escrita. Protótipo e prints: [`ledger-v5/`](ledger-v5/).

## Destino

O dono abre o Oráculo e, em cinco segundos, sabe **tudo o que espera por ele** (decidir,
aprovar uma carta, responder uma pergunta, destravar algo, conferir um envio) e **de quem é
cada coisa**: quem pediu (uma pessoa, não "Dev"), quem responde, quem está fazendo agora e quem
decide. Nada some quando uma sessão fecha, nada duplica quando alguém repete o pedido, nada é
"aceito" sem prova que o app conferiu, e um Alfa antigo aberto ao lado nunca apaga o que o novo
gravou.

## Fontes

As quatro pesquisas de 07/11, em `docs/pesquisas/` (branch `docs/pesquisas-ledger-top`):

- [diagnóstico](../pesquisas/ledger-diagnostico-2026-11-07.md) — o nosso, com números de um
  snapshot de 270 tarefas;
- [orquestração multiagente](../pesquisas/ledger-top-orquestracao-2026-11-07.md) — Claude Code
  teams/workflows, OpenAI SDK, Devin, Cursor, Copilot, CrewAI, LangGraph, Magentic-One, OpenRig…;
- [registro e prova](../pesquisas/ledger-top-registro-prova-2026-11-07.md) — event sourcing,
  idempotência, CloudEvents, hash encadeado, in-toto/SLSA, SQLite, outbox;
- [ferramentas de trabalho](../pesquisas/ledger-top-ferramentas-2026-11-07.md) — Linear, Jira,
  Zendesk, ServiceNow, Shortcut, Asana, Notion, GitHub Projects.

Lido também: `src/shared/ledger/contract.ts` e `src/main/ledger-store.ts` em `origin/staging`
(v4), o PR #249 (Oráculo no serviço da VPS), o PR #260 (espelho no Supabase) e a branch do Dev
"ledger legível no Supabase" (PR #279).

## O problema numa frase

O defeito é de **modelo**, não de tela: a tarefa pertence à sessão que fecha; não existe "quem
pediu"; os estados novos moram em marcas `⟦…⟧` no texto porque o schema ficou travado na v4; não
há idempotência nem tarefa-pai; a prova só é checada na forma; o dono só vê "entregue de risco
alto"; o Slack sai sem recibo; e o arquivo é reescrito inteiro, sem trava entre canais.

Os números que provam (diagnóstico, 270 tarefas): **13% órfãs** (eram 102 em 06/11);
`esperandoDono: 0` com **53 abertas de risco alto, 7 cartas aceitas nunca enviadas e 8 entregues
de risco baixo sem decisão**; **74% dos envios "sem confirmação"**; 5 envios que falharam estão
"aceitos"; o mesmo pedido aparece 5×, 5×, 4× e 3×; **28% sem título**; 12 de 28 "canceladas"
foram na verdade feitas; 23 aceitas com prova só em texto.

## O que já é bom e fica

Regras em função pura (`applyLedgerOp`), um único escritor, "sem prova não entrega", "quem
entregou não aceita" (`cannotDecide`), carta para o dono no risco alto, histórico com todas as
rodadas. As pesquisas concordam que nisso estamos **à frente** do mercado (só o Copilot tem trava
parecida). O v5 não troca nada disso; troca o chão por baixo.

---

## 1. O modelo novo

### 1.1 Papéis separados (o fim do "Quem pediu: Dev")

Cada papel é um campo próprio, gravado no evento com o **nome congelado** no momento (o nome do
lugar não depende mais de o card ainda estar no quadro):

| Papel | Campo | Quem é | Exemplo | Hoje (v4) |
|---|---|---|---|---|
| **Pedido por** | `pedidoPor` | a **pessoa** ou a fonte de quem veio a frase | "Alexandre · chat", "Bill · Slack #produto", "Rotina das 7h", "Sinal do Curador: chat-diagnostics.log" | não existe; o espelho usava o autor do `criada` |
| **Registrado por** | `registradaPor` | o lugar que chamou `tarefa_criar` | "Líder · Donel Dev" | é o único que existe |
| **Responsável** | `responsavel` | quem **responde** pelo resultado: um papel num quadro, durável | "Dev · quadro Donel Dev" | é a sessão (`ownerPlaceId`) |
| **Executado por** | `executor` | a **sessão** que está fazendo agora (troca sem transferência) | "Dev · ledger legível no Supabase" | é a mesma sessão dona |
| **Decide** | `decide` | quem aceita: você ou o Revisor (sai do risco e do nível da prova) | "você" | implícito no risco |
| **Com quem está** | derivado | a próxima ação, em texto de gente | "você decide", "Revisor confere", "ninguém — falta executor" | não existe |

`pedidoPor` é **obrigatório** em `tarefa_criar` e tem forma fixa `{ tipo: pessoa | sinal |
rotina, nome, canal }`. Se a sessão não sabe, grava `não registrado` (o mesmo texto do PR #279) — e a linha aparece marcada em
vermelho, nunca preenchida com o papel. Quando a frase veio do dono no chat da própria sessão, o
app preenche sozinho (`Alexandre · chat`), porque ele sabe de onde chegou a mensagem.

**Por que o responsável é um papel e não a sessão:** a sessão é efêmera; quando ela fecha, a
tarefa volta a "aberta, sem executor" com o mesmo responsável, e aparece na caixa do Líder como
"para repassar". Isso acaba com a órfã como categoria: a tarefa nunca fica sem dono, só sem mão.

### 1.2 Tarefa-pai e subtarefas

- `paiId` opcional. Um pedido do dono vira **uma** tarefa-raiz com a frase literal; o trabalho
  dela são filhas (`paiId = raiz`). A raiz mostra `3 de 5 prontas`.
- Filha herda `pedidoPor` e prazo da raiz (pode encurtar, nunca alongar além).
- A raiz fecha **sozinha** como `concluida` quando todas as filhas fecharam e nenhuma ficou
  recusada — se a raiz for de risco baixo. Raiz de risco alto entra na caixa do dono com a lista
  das filhas e as provas delas.
- `dependeDe: [ids]` para ordem entre irmãs: a dependente fica `bloqueada` até as anteriores
  fecharem, e destrava sozinha (agent teams, CrewAI `context`, OpenRig `depends_on`).
- **Título obrigatório** (até 60) em toda tarefa nova. O import do v4 gera um título das
  primeiras palavras do pedido para os 28% que não têm, marcado "título gerado".

### 1.3 Estados de verdade

Estado é campo, não marca. Categorias fixas (Linear) com nomes em português:

```
                      ┌──────────────► bloqueada ──(destrava)──┐
                      │                                        ▼
  aberta ──assumir──► em execução ──perguntar──► esperando você ──responder──► em execução
     ▲                │                                                           │
     │ (executor      └──entregar (com prova)──► entregue ──aceitar──► concluída   │
     │  fechou)                                     │                              │
     └──────────────────────────────────────────────┤──pedir ajustes (rodada+1)───┘
                                                    └──recusar──► cancelada
  qualquer estado aberto ──cancelar(motivo)──► cancelada
  qualquer estado aberto ──marcar duplicada(de)──► duplicada
```

| Estado | Significa | Fechado? |
|---|---|---|
| `aberta` | ninguém executando (nova, ou o executor fechou) | não |
| `em-execucao` | uma sessão está fazendo | não |
| `bloqueada` | espera outra tarefa (`porTarefa`) ou um fato externo (`porFato`), com motivo | não |
| `esperando-voce` | a sessão parou com uma **pergunta** ou **pedido de aprovação** para o dono, *antes* de entregar | não |
| `entregue` | entregue com prova, esperando quem `decide` | não |
| `concluida` | aceita, ou concluída por prova automática (ex.: PR mesclado verificado pelo app) | sim |
| `cancelada` | não vai sair; `motivoFechamento` obrigatório e tipado | sim |
| `duplicada` | igual a outra (`duplicadaDe`); a original segue | sim |

Fechamento tipado (`motivoFechamento`, regra "hot-potato" do OpenRig): `aceita`,
`concluida-por-prova` (com a prova), `recusada`, `nao-vai-sair`, `substituida` (→ id),
`duplicada` (→ id). **Nada mais fecha como "cancelada" tendo sido feito** — a faxina passa a
fechar como `concluida-por-prova` com o PR verificado.

**Decisão em três verbos** (Asana): `aceitar` (fecha), `pedir ajustes` (volta para em execução,
rodada + 1) e `recusar` (fecha, não sai). Hoje "rejeitar" quer dizer as duas últimas.

**Carta de Slack** é uma tarefa com `tipo: carta` e estados próprios de envio:

```
  esperando você (aprovar) ──aprovar──► aprovada ──enviar──► enviando ──recibo──► enviada (link + ts)
                          └─recusar─► cancelada            │            └─erro──► falhou (pode reenviar com a mesma chave)
                                                           └─sem resposta clara──► sem confirmação ──conferir──► enviada | falhou
```

- **Recibo**: só vira `enviada` com `ts` e permalink do Slack gravados. "Sem confirmação" é um
  estado **pendente** que entra na caixa do dono e numa conferência posterior (uma sessão com
  Slack procura a mensagem no canal pelo texto), nunca "gasto".
- **Qualquer lugar com Slack** (ou o app) envia uma carta aprovada, não só a sessão autora: a
  carta pertence ao responsável, como toda tarefa.
- O registro do bot deixa de nascer `aceita`: um envio que falhou é `falhou`.
- Na tela e no espelho, `aprovada` aparece com o texto que o PR #279 já usa: **"aceita, esperando
  envio"**. O nome interno muda; o que o dono lê, não.

### 1.4 Idempotência

- Toda operação de escrita aceita `chave` (Idempotency-Key, IETF; OpenAI SDK; LangGraph). Mesma
  chave + mesmo conteúdo → devolve o resultado original; mesma chave + conteúdo diferente →
  recusa ("essa chave já foi usada para outra coisa").
- Sem `chave`, `tarefa_criar` calcula uma: hash de `pedido + responsavel + quadro + paiId` numa
  janela de 24 h. Uma repetição devolve a tarefa existente com o aviso "já existia: H-142", em vez
  de criar a 5ª cópia.
- Carta e envio usam a chave do envio: reenviar depois de `falhou` ou `sem confirmação` **não
  precisa de carta nova** e não duplica a mensagem.
- `requestId` do celular vira um caso particular de `chave`.

### 1.5 Log só de acréscimo, com envelope e hash encadeado

O arquivo deixa de ser "o documento reescrito inteiro". Passa a ser um **log de eventos**, e o
estado é uma projeção que se refaz rodando o log (Fowler; OpenHands; KurrentDB).

```
<pasta do Oráculo>/
  eventos.jsonl          ← a fonte de verdade; uma linha por evento, só acrescenta (fsync)
  projecao.json          ← cache do estado, refeito do log se sumir ou não bater
  oraculo.lock           ← trava entre processos (pid + canal + hora; expira se o pid morreu)
  backups/               ← N cópias rotativas do log, cada uma com o hash final
  provas/                ← arquivos de prova, nomeados pelo sha256
ledger.json              ← projeção v5 compatível, só para leitura de apps antigos (ver 1.9)
```

**Envelope** de cada evento (CloudEvents, com o mínimo útil):

```jsonc
{
  "id": "ev-01JC…",                // único; (origem.instancia + id) descarta duplicata
  "seq": 4182,                       // número local, sem buracos
  "tipo": "tarefa.entregue@1",       // tipo e versão POR EVENTO (upcaster por tipo)
  "em": "2026-11-07T14:03:11.204Z",
  "tarefa": "t-62864af6",
  "por": { "kind": "lugar", "placeId": "place:…", "papel": "revisor",
           "nome": "Revisor · consertos do bypass" },   // nome congelado
  "via": "mcp",                      // app | celular | mcp | rotina | faxina | importacao
  "origem": { "canal": "alfa", "versao": "0.5.0-alfa.2026-11-08", "maquina": "PC" },
  "chave": "…",                      // idempotência, quando houver
  "dados": { … },                    // o fato em si
  "prev": "sha256:…",                // hash do evento anterior
  "hash": "sha256:…"                 // sha256(prev + JSON canônico deste evento sem o hash)
}
```

- **Hash encadeado simples**, conferido ao carregar. Quebra vira um item "integridade" na caixa
  do dono e um aviso na faixa; nunca é aceita em silêncio, e o app não apaga nada. Árvore de
  Merkle, assinatura e Sigstore ficam fora (exagero para um dono só — registro-prova).
- **Concorrência**: a gravação pega `oraculo.lock` e confere o `seq` esperado (concorrência
  otimista). Dois canais abertos: o segundo espera a trava ou recebe "outro Donel Dev está
  gravando; tento de novo" — nunca sobrescreve.
- **Leitor tolerante** (Fowler, Protobuf): evento de `tipo` desconhecido é **preservado** e
  contado na projeção como "evento de uma versão mais nova"; campos desconhecidos dentro de um
  evento conhecido são mantidos intactos. Como o log só acrescenta, um app que não entende um
  evento novo nunca o reescreve. **Este é o fim das marcas `⟦…⟧` e do "subir versão trava o
  canal antigo"** daqui em diante.
- **Onde mora**: onde mora o único escritor. Hoje, o `userData` do PC; quando o PR #249 + 02b
  levarem o Oráculo para o serviço da VPS, o mesmo log mora em `~/.donel/` e o PC vira cliente.
  O formato não muda.
- Snapshot periódico (`projecao.json`) + backups rotativos: um arquivo corrompido deixa de parar
  o Oráculo inteiro (hoje para).

### 1.6 Prova verificada pelo app

Cada prova ganha um **nível**: `verificada` (o app conferiu) ou `declarada` (o agente disse).

| Prova | O app faz no `entregar` | Fica congelado no evento |
|---|---|---|
| Arquivo (print, vídeo, `.html`) | copia, calcula `sha256` e tamanho | `sha256`, bytes, tipo; o nome do arquivo é o hash |
| Link de PR do GitHub | `gh pr view --json state,mergedAt,headRefOid,statusCheckRollup` | estado, SHA da cabeça, checks (verde/vermelho/pendente), hora da consulta |
| Link de execução do CI | `gh run view --json conclusion,headSha` | conclusão e SHA |
| Texto ("saída de comando") | nada | `declarada` |

- Ao abrir a carta, o app reconfere o `sha256` do arquivo; diferente = "a prova mudou depois da
  entrega".
- PR que estava pendente é reconferido pela faxina; quando fica verde e mesclado, a tarefa pode
  fechar `concluida-por-prova`.
- **Critério em checklist**: o "pronto quando" pode vir em itens; a entrega diz qual prova cobre
  cada item. Item sem prova aparece vazio na carta. Opcional no v5.0 (o texto livre continua
  valendo), obrigatório para o Revisor aceitar sozinho (ver D3).
- `gh` indisponível (sem rede, sem login) → a prova fica `declarada` com o motivo, nunca bloqueia
  a entrega.
- **Rastro carimbado** (prática 8 da pesquisa de orquestração): no `entregar`, o app grava no
  evento a sessão, a branch e o commit da cabeça da worktree do executor, sem depender do que o
  agente escreveu. Entra na fatia 12.

### 1.7 Limite de retrabalho

- `rodadas` = número de entregas. Cada "pedir ajustes" soma uma.
- **Na 3ª reprovação** (Magentic-One: estagnação > 2; CrewAI: 3 tentativas), a tarefa não volta
  sozinha à mesma sessão: entra na caixa do dono como **"travou em 3 rodadas"**, com o histórico
  das três provas e dos três motivos, e verbos *trocar executor*, *mudar o critério*, *cancelar*.
- Parada: `em execução` sem nenhum sinal da sessão (evento, hook ou transcript que o main já vê)
  por **4 h** vira o derivado "parada" e acorda o Líder — não só a faxina de 24 h.

### 1.8 A caixa "Esperando você" cobre tudo

Hoje ela é só `entregue + risco alto`. No v5 é uma **lista de itens tipados, cada um com o seu
verbo**, derivada da projeção (nunca gravada à parte):

| Tipo | Entra quando | Verbos |
|---|---|---|
| Decidir entrega | `entregue` com `decide = você` | aceitar · pedir ajustes · recusar |
| Responder | `esperando-voce` com pergunta | responder |
| Aprovar plano/ação | `esperando-voce` com pedido de aprovação | aprovar · negar |
| Aprovar carta | carta esperando aprovação | aprovar · pedir mudança · recusar |
| Conferir envio | carta `sem confirmação` ou `falhou` | reenviar · marcar enviada (link) · desistir |
| Carta parada | carta `aprovada` sem envio há mais de 30 min | enviar pelo app · passar a outro lugar |
| Travou | 3 rodadas, ou `bloqueada` por fato que só você destrava | trocar executor · mudar critério · cancelar |
| Atrasado | pedido seu com prazo vencido | novo prazo · cancelar |
| Amostra do Revisor | a amostra diária (D2 de 04/11) | conferir · derrubar o aceite |
| Integridade | cadeia de hash quebrada, gravação recusada, evento de versão mais nova | ver detalhe |

- Ordem: primeiro o que bloqueia alguém, depois prazo, depois idade.
- **Adiar** (*snooze*, Linear Inbox): some até a hora escolhida e volta sozinha.
- A faixa mostra o número total e o mais antigo ("7 esperando você · a mais antiga há 2 dias").
- A mesma lista alimenta o celular e a vista `esperando_voce` do espelho.
- **Aviso para fora** (a outra metade da prática 10 da pesquisa de orquestração): cada item novo
  da caixa dispara o aviso do celular que hoje só existe para carta. Entra na fatia 2.

### 1.9 Migração v4 → v5 sem perder dado e sem o Alfa antigo apagar nada

1. **Na primeira abertura do v5**, com `oraculo.lock` tomado: copia `ledger.json` para
   `backups/ledger.v4.<data>.json` e as provas para `provas/` (renomeadas pelo hash; o mapa
   nome-antigo→hash vai no evento).
2. Cada tarefa v4 vira **um** evento `tarefa.importada@1` que carrega a tarefa v4 **inteira,
   byte a byte** (`dados.v4`), mais a leitura interpretada (`dados.v5`). Nada é jogado fora: se a
   interpretação errar, a origem está ao lado.
3. O upcaster lê as marcas e as converte em campos de verdade:
   `⟦cancelada⟧` → `cancelada` + motivo; `⟦transferida de A para B⟧` → evento `executor.trocado`;
   `⟦feito por X⟧` → `executor` da entrega; `⟦substitui id⟧` → `substituida`; `⟦pedido por X⟧`
   (do PR do Dev das colunas) → `pedidoPor`; texto da faxina "concluída: PR #n" →
   `concluida-por-prova` com o link; registro do bot com "o envio falhou" → `falhou`.
   Sem `pedidoPor` na origem → `não registrado` (nunca o papel).
4. **Conferência antes de ativar**: mesma quantidade de tarefas e de eventos, todo id presente,
   e a projeção reconvertida para o formato v4 bate com o original nas tarefas sem marca. Se não
   bater, a migração não ativa, o v4 segue gravando e a caixa mostra "migração recusada" com o
   motivo.
5. O `ledger.json` passa a ser **regravado como projeção**, com `schemaVersion: 5`, tarefas no
   formato v4 + campos novos. Um app v4 (o Alfa 0.4.0) que abre esse arquivo vê a
   versão maior e **fica só-leitura** — mecanismo que já existe (`isNewerLedger`): ele lê as
   tarefas, não consegue gravar, e portanto **não apaga nada**. A fonte de verdade
   (`eventos.jsonl`) ele nem conhece. Para o parse v4 não descartar tarefas com estado novo, o
   campo `state` da projeção leva o estado v4 mais próximo (bloqueada e esperando você →
   em execução; concluída → aceita; cancelada e duplicada → rejeitada com a marca de hoje) e o
   estado real vai em `estado` — o v4 ignora o campo que não conhece.
6. A partir do v5 não há mais "subir versão": tipo e versão são por evento, e o leitor tolerante
   preserva o que não conhece (1.5).

**Custo assumido (D1):** depois da migração, o Alfa 0.4.0 só lê o Oráculo — não cria tarefa nem
libera carta de Slack. Para trabalhar, o dono abre um Donel Dev v5. É a decisão explícita que o
diagnóstico pede para sair do congelamento. O beta (`main`) **não muda nada**: ele tem
`LEDGER_SCHEMA_VERSION = 2` e, pelo `isNewerLedger`, já é só-leitura com o ledger v4 de hoje.

---

## 2. Divergências entre as pesquisas e a minha escolha

| # | Assunto | O que cada pesquisa diz | Escolha | Por quê |
|---|---|---|---|---|
| V1 | **De quem é a tarefa** | Diagnóstico: de uma pessoa ou de um papel durável; a sessão só executa. Ferramentas: `responsavel` = "o lugar que faz" (substitui `dono`) + `executado_por` quando outro fez. Orquestração (Linear): o humano segue responsável, o agente é delegado. | **Responsável = papel num quadro** ("Dev · Donel Dev"); **executor = sessão**. | Pessoa como responsável não ajuda: só há um humano. Lugar como responsável repete a órfã. Papel no quadro sobrevive à sessão e cai naturalmente na caixa do Líder. |
| V2 | **Onde guardar o log** | Registro-prova: SQLite é "bom candidato" (WAL, transação), mas avisa da ABI nativa. Diagnóstico: trava de arquivo **ou** um dono único. PR #249: o Oráculo vai para o serviço da VPS. | **JSONL só de acréscimo + trava de arquivo + `seq` otimista.** Sem SQLite. | Driver nativo reabre a dor do node-pty com o Electron, nos três canais. O volume é pequeno (centenas de tarefas). JSONL é legível à mão e funciona igual no PC e no serviço da VPS. |
| V3 | **Sair do congelamento do v4** | Diagnóstico: "aposentar o v4 de propósito", subir o schema. Registro-prova: leitor tolerante + campos desconhecidos preservados + upcaster, para nunca mais precisar subir. | **As duas, em sequência:** uma última subida (v5, com o v4 ficando só-leitura) e, dentro do v5, leitor tolerante por evento. | Sem a subida, o Alfa 0.4.0 continua reescrevendo o arquivo e descartando campo. Sem o leitor tolerante, a próxima mudança repete o problema. |
| V4 | **Hash encadeado** | Registro-prova: encadeamento simples, conferido ao carregar; Merkle é exagero. As outras não tratam. | **Encadeamento simples; quebra = alerta na caixa, nunca bloqueio.** | Pega reescrita silenciosa por canal ou script a custo quase zero. Bloquear o Oráculo por um alerta seria pior que o problema. |
| V5 | **"Rejeitar" e retrabalho** | Ferramentas: separar "pedir ajustes" de "rejeitar" e contar rodadas (Asana). Orquestração: teto de 3 rodadas e escalar (Magentic-One, CrewAI; Cursor usa 10). | **Três verbos (aceitar / pedir ajustes / recusar) + teto de 3 rodadas → caixa do dono.** | 3 é o número das duas fontes de agente; 10 (Cursor) é para CI automático, não para retrabalho com revisão. |
| V6 | **Até onde verificar a prova** | Orquestração: `gh` no `entregar` (CI, PR, SHA); "declarada" quando não deu. Registro-prova: além disso, saída de comando capturada por hook, trace do Playwright, proveniência estilo in-toto. Diagnóstico: checklist por item do critério; Revisor rejeita prova que não reproduz a frase. | **v5.0: `sha256` + `gh` (PR e CI) + nível verificada/declarada + checklist opcional. Hook de comando, trace e proveniência completa ficam para depois.** | `gh` e hash custam pouco e cobrem a maior parte das provas (PR + print). Hook de comando exige mexer no harness de cada motor; fica como fatia própria. |
| V7 | **Quem o Revisor pode aceitar sozinho** | Diagnóstico: 13% aceitas sem o dono; duas aceitas por Revisor e derrubadas pelo dono. Orquestração: manter o Revisor (Copilot). Nenhuma pesquisa fecha a regra. | **Revisor aceita sozinho só risco baixo com ao menos uma prova verificada e o checklist completo; senão a decisão sobe para o dono.** (D3) | Ataca o "péssima prova, de nada vale" sem acabar com o Revisor. Custo: mais itens na caixa no começo. |
| V8 | **Parada / prazo** | Orquestração: pulso de execução, "parada" depois de N horas, acorda o Líder. Ferramentas: `prazo_status` com pausa enquanto espera você (Linear SLA, Jira SM). | **As duas, derivadas (nunca gravadas):** "parada" após 4 h sem sinal; `prazo_status` no prazo / em risco / vencido / cumprido, com o relógio pausado em `esperando-voce`. | São leituras do log, não fatos novos. Gravá-las criaria estado que envelhece. |
| V9 | **Espelho fora do PC** | Ferramentas: tabela `demandas` com 22 colunas + `demandas_eventos`. Registro-prova: outbox, adaptador desligado por padrão, CDC é exagero. Diagnóstico: o espelho do PR #260 está órfão. | **Tabela `tarefas` do Dev das colunas + `tarefas_eventos` (uma linha por evento do log) + vista `esperando_voce`, enviados por outbox.** | O log já é a fonte; empurrar eventos é mais simples e mais fiel que reconstruir linhas. Os nomes seguem os do Dev (seção 4). |
| V10 | **Notas internas × notas para você** | Ferramentas: separar work notes de comments (ServiceNow). As outras não tratam. | **Fica fora do v5.0.** O `paraODono` já é a nota para você; a nota da entrega é a interna. | Já existe na prática; virar campo novo não muda o que o dono sente agora. |
| V11 | **CRDT / local-first** | Registro-prova: não (as regras são máquina de estados com invariantes). | **Não.** | Concordo; um escritor só é mais simples e correto. |

---

## 3. Como o dono vê (protótipo)

Protótipo autocontido: [`ledger-v5/prototipo.html`](ledger-v5/prototipo.html) (abre no
navegador, sem rede). Três variantes, com dados no formato do snapshot real de 07/11:

- **A — Caixa primeiro** ([print](ledger-v5/variante-a-caixa.png)): o Oráculo abre na caixa
  "Esperando você", agrupada por tipo, cada item com o seu verbo; a tabela vem abaixo, recolhida.
- **B — Tabela com "com quem está"** ([print](ledger-v5/variante-b-tabela.png)): a tabela
  legível é a tela; colunas na ordem de leitura, filtros prontos (Esperando você, Sem executor,
  Cartas, Travadas, Tudo), raiz com filhas que abrem, painel lateral com a linha do tempo e as
  provas (verificada/declarada).
- **C — Pedidos seus** ([print](ledger-v5/variante-c-pedidos.png)): agrupa por pedido do dono
  (a frase dele no topo, filhas e progresso embaixo) e deixa a caixa numa coluna fixa à direita.

Na tela, o nível `verificada` aparece como "✔ conferida" (pelo app) e `declarada` como
"◌ declarada". Os dados do protótipo são de exemplo, montados a partir das tarefas reais de 07/11.

**No celular** (390 px) as três variantes cabem sem rolagem lateral: a grade vira uma coluna, o
seletor de variante ocupa a largura toda, o painel da B desce para baixo da tabela, a caixa da C
sobe para o topo, e a tabela da B esconde Responsável, Decide e Rodadas e rola só dentro do próprio
cartão. Prints: [A](ledger-v5/celular-a-caixa.png), [B](ledger-v5/celular-b-tabela.png),
[C](ledger-v5/celular-c-pedidos.png). Conferido no Chromium em 390×844 e 1920×1080: largura da
página igual à da tela nas três, os três botões do seletor dentro da tela, painel da B sem cruzar a
tabela, nenhum erro de console e nenhuma requisição de rede.

**Recomendação: B com a caixa da A no topo** (a caixa recolhe quando está vazia). A escolha é
do dono: é a **D5** (seção 6). A tabela é o
que ele já abriu no Supabase e criticou; a B responde direto às duas falas ("quem pediu",
"top de linha"), e a caixa no topo garante que nada que espera por ele fique escondido. A C é a
mais bonita para pedidos grandes, mas esconde o que não veio dele (sinais do Curador, rotinas).

## 4. Colunas, alinhadas com o Dev do espelho

O Dev "ledger legível no Supabase" (tarefa t-a627741e, PR #279) está trocando a tabela `demandas` por `tarefas`. **O v5 mantém todos os nomes
dele e só acrescenta.** Nenhuma renomeação depois que o PR dele entrar.

| Coluna (dele) | No v5 passa a vir de | Coluna nova do v5 | O que mostra |
|---|---|---|---|
| `quadro`, `titulo`, `pedido`, `risco`, `prazo`, `id` | igual | `codigo` | chave curta "H-142" |
| `estado` | estado v5 em português (aberta, em execução, bloqueada, esperando você, entregue, concluída, cancelada, duplicada; carta: **aceita, esperando envio** — o mesmo texto do #279, que no v5 vem do estado `aprovada` —, enviando, enviada, falhou, sem confirmação) | `pai_id` | a tarefa-raiz |
| `esperando_dono` | "está na caixa Esperando você" (qualquer tipo da 1.8) | `com_quem_esta` | "você decide", "Revisor confere", "ninguém — falta executor" |
| `quem_pediu` | `pedidoPor` (campo, não mais a marca `⟦pedido por⟧`); sem ele, **"não registrado"**, como no #279 | `responsavel` | papel · quadro |
| `quem_criou` | `registradaPor`, nome congelado | `quem_decide` | você / Revisor |
| `quem_faz_agora` | `executor` (a sessão), nome congelado | `prazo_status` | no prazo · em risco · vencido · cumprido |
| `ultima_entrega`, `link_da_prova`, `prova_texto` | igual | `prova_nivel` | verificada · declarada |
| `decisao`, `motivo` | decisão em três verbos; motivo sem marcas | `motivo_fechamento` | aceita · concluída por prova · recusada · não vai sair · substituída · duplicada |
| `criada_em`, `entregue_em`, `decidida_em`, `atualizado_em` | igual | `rodadas`, `criterio_pronto`, `envio_link`, `ultima_atividade`, `ultima_atividade_em` | — |

Mais a tabela `tarefas_eventos` (uma linha por evento do log: `id`, `seq`, `tarefa_id`, `tipo`,
`em`, `por_nome`, `via`, `canal`, `texto`, `hash`) e a vista `esperando_voce`.

**As duas vistas convivem.** A `tarefas_em_aberto` do #279 **fica, com o mesmo nome**: é "tudo o
que ainda não fechou". No v5 o filtro dela passa a incluir os estados novos que também não fecharam
(bloqueada, esperando você, enviando, falhou, sem confirmação), além dos quatro de hoje (aberta, em
execução, entregue, aceita, esperando envio). A `esperando_voce` é nova e mais estreita: só o que
está na caixa, um item por linha, com o tipo e o verbo da 1.8.

## 5. Fatiamento em PRs pequenos

Ordem pensada para o dono **sentir a diferença na primeira fatia**, antes de qualquer mudança de
schema. Cada fatia é **vertical**: muda algo que o dono vê na tela, no celular ou no Supabase, e
tem um **"pronto quando"** que o Revisor confere sem precisar perguntar ao Dev. Cada PR fica abaixo
de 50 arquivos, vai contra `staging` e passa no `npm run verify`. Teste só onde a regra do projeto
manda (dado persistido que um canal pode apagar, mensagem que some ou duplica, apagar coisa).

**Base de conferência:** "o snapshot" é uma cópia do `ledger.json` de 07/11 (as 270 tarefas do
diagnóstico), aberta num `userData` de teste e nunca no do dono. Os números esperados abaixo vêm
do [diagnóstico](../pesquisas/ledger-diagnostico-2026-11-07.md).

### Sem mexer no schema (v4)

| # | Fatia | O dono vê | Pronto quando (o Revisor confere) | Risco |
|---|---|---|---|---|
| 1 | **Caixa "Esperando você" completa** — lista derivada do que já existe: cartas aceitas não enviadas, envios "sem confirmação" e "falhou" (lendo o texto de hoje), entregues de risco baixo paradas há 24 h, órfãs para repassar, amostra do Revisor. Faixa com total e o item mais antigo. | "Agora eu vejo tudo o que espera por mim." O 0 vira o número de verdade. | Sobre o snapshot, a caixa mostra **as 7 cartas aceitas e não enviadas** (os 7 ids do diagnóstico), **os 17 envios sem confirmação** e **as 8 entregues de risco baixo**, em vez de 0. A faixa mostra o total e "a mais antiga há N dias". Prints da faixa e da caixa. | baixo |
| 2 | **Aviso no celular para todo item da caixa** — o sino do celular, que hoje só avisa de carta, passa a avisar de cada item novo da caixa da fatia 1. É a metade "avisar quando nasce um item" da prática 10 da pesquisa de orquestração. | O celular toca quando alguma coisa passa a esperar por ele, não só carta. | Com o celular pareado e o sino ligado, uma entrega de risco alto e um envio "sem confirmação" criados no `userData` de teste geram **um aviso cada**, com o título do item. Reabrir o app não repete o aviso, e o toque abre o item. Print do celular com os dois avisos. | baixo |
| 3 | **Tabela legível no app (variante B com a caixa da A no topo, se o D5 confirmar)** — vista "Tudo" do Oráculo com as colunas da seção 4 derivadas do v4, busca, filtros prontos e painel com a linha do tempo. | "Dá para entender de quem é cada coisa." | Sobre o snapshot, **nenhuma linha mostra um papel ("Dev", "Líder") em "Quem pediu"**: aparece a pessoa ou a fonte, ou "não registrado" em vermelho. Os filtros "Esperando você" e "Tudo" dão o mesmo total da caixa e 270. Prints em 1920 px e em 390 px (no celular, sem rolagem lateral). | baixo |
| 4 | **As marcas viram leitura de verdade** — contrato v5 e upcaster v4→v5, só para leitura: a tabela da fatia 3 passa a mostrar o estado e o motivo reais em vez de "cancelada ⟦…⟧". Nada é gravado. | "Cancelada" passa a querer dizer cancelada. As feitas aparecem como feitas. | Sobre o snapshot, **nenhuma célula mostra `⟦`**. **As 12 "canceladas" que foram feitas** aparecem como "concluída por prova" ou "enviada", e as 7 substituídas como "substituída por H-n". Teste: o upcaster lê o snapshot sem perder tarefa, e reconvertê-lo para v4 dá o mesmo arquivo nas tarefas sem marca. | médio |

Nenhuma fatia é só base. O contrato e o upcaster, que antes eram "nada visível", entram na 4,
junto com um efeito na tela: as marcas somem. O log e a migração entram na 5, com o cartão
"Integridade" e o aviso do Alfa antigo como o que se vê.

### A subida para o v5 (depende do D1)

| # | Fatia | O dono vê | Pronto quando | Risco |
|---|---|---|---|---|
| 5 | **Log com trava, hash e migração** — `eventos.jsonl`, `oraculo.lock`, cadeia de hash conferida ao abrir, backups, projeção `ledger.json` v5; migração com conferência e recusa (1.9). | O cartão "Integridade" na caixa ("cadeia de N eventos conferida às hh:mm"). Um Alfa 0.4.0 aberto ao lado avisa "este Donel Dev só lê o Oráculo". | Migrar o snapshot dá **270 tarefas e 270 eventos de importação**, e a conferência passa. Com o Alfa 0.4.0 aberto sobre o arquivo migrado, criar tarefa falha com o aviso, e o `sha256` do `eventos.jsonl` é **igual antes e depois**. Editar uma linha do log à mão faz aparecer um item "Integridade" na caixa. Testes: migração, dois escritores, cadeia quebrada. | **alto** (D1) |
| 6 | **Papéis e fim da órfã** — `pedidoPor` obrigatório (o app preenche sozinho quando a frase veio do dono no chat), executor separado, nomes congelados; sessão fechada → "aberta, sem executor" na caixa do Líder. | "Quem pediu: Alexandre", nunca "Dev". As órfãs zeram. | **Nenhuma tarefa nova mostra um papel em "Quem pediu"**. `tarefa_criar` sem `pedidoPor` grava "não registrado", em vermelho. Fechar uma sessão de teste com uma tarefa em execução põe a tarefa em "aberta, sem executor" na caixa do Líder, e **o contador de órfãs vai a 0**. | médio |

### Dentro do v5 (cada uma confere sozinha)

| # | Fatia | O dono vê | Pronto quando | Risco |
|---|---|---|---|---|
| 7 | **Estados de espera** — `bloqueada` (por tarefa ou por fato, com motivo) e `esperando você` com pergunta ou pedido de aprovação; destravar sozinho. | Itens "Responder" e "Aprovar" na caixa; a tarefa bloqueada diz por quê. | Uma sessão de teste faz uma pergunta → aparece um item "Responder" na caixa; a resposta chega no chat dela, e a tarefa volta a "em execução". Uma tarefa que depende de outra fica "bloqueada · espera H-n" e **destrava sozinha** quando a outra fecha. | médio |
| 8 | **Fechamento tipado e três verbos** — concluída, cancelada com motivo, duplicada e substituída; aceitar · pedir ajustes · recusar; a faxina fecha como "concluída por prova". | O botão "Pedir ajustes" separado de "Recusar"; a contagem de rodadas na linha. | Rodar a faxina sobre o snapshot **não cria nenhuma "cancelada" nova com PR mesclado**: elas saem como "concluída por prova", com o link. "Pedir ajustes" numa tarefa de teste mostra "2ª rodada"; "Recusar" fecha com o motivo. | médio |
| 9 | **Sem cópias do mesmo pedido** — `chave` de idempotência em toda escrita; sem chave, hash de pedido + responsável + quadro + pai em 24 h. | "Já existia: H-142" em vez da 5ª cópia. | Chamar `tarefa_criar` duas vezes com o mesmo pedido cria **uma** tarefa só, e a segunda chamada responde "já existia: H-n". A mesma chave com outro conteúdo é recusada. Teste: chave repetida não duplica. | médio |
| 10 | **Tarefa-pai e título obrigatório** — `paiId`, `dependeDe`, progresso na raiz, título até 60. | Um pedido = uma linha com as filhas embaixo e "3 de 5 prontas". | Um pedido de teste com 3 filhas aparece como **uma linha com "0 de 3 prontas"**, e o número sobe quando uma filha fecha. `tarefa_criar` sem título é recusada. **As 75 tarefas sem título do snapshot** aparecem com um título marcado "título gerado". | médio |
| 11 | **Carta com recibo** — estados de envio, `ts` + permalink, reenvio pela mesma chave, envio por qualquer lugar com Slack ou pelo app, conferência do "sem confirmação". | "Cadê a mensagem do Slack?" tem resposta com link. | Uma carta de teste (com `carta_slack` aceita pelo dono) num canal de teste dele vira "enviada" com um **link que abre a mensagem**. Uma falha simulada vira "falhou", e reenviar com a mesma chave deixa **uma** mensagem no canal. Uma carta de uma sessão já fechada sai pelo botão "Enviar pelo app". | médio (Slack em nome dele) |
| 12 | **Prova conferida pelo app e rastro carimbado** — `sha256` dos arquivos, `gh` no entregar (PR e CI), nível conferida/declarada. O app carimba **sessão, branch e commit** na entrega sem depender do agente: é a prática 8 da pesquisa de orquestração. | O selo "✔ conferida" e, na linha do tempo, de onde a entrega saiu. | Entregar com o link de um PR mostra "✔ conferida" com o SHA e o estado dos checks; entregar só com texto mostra "◌ declarada". Trocar o arquivo de prova depois da entrega faz a carta dizer "a prova mudou". A entrega de uma sessão de teste mostra a sessão, a branch e o commit **sem que o agente os tenha escrito**. | médio |
| 13 | **Revisor mais exigente (D3) e "pronto quando" em checklist** | Item sem prova aparece vazio na carta; o que o Revisor não pode aceitar sobe para a caixa. | Um Revisor de teste tenta aceitar uma entrega de risco baixo com prova só declarada → **o aceite é recusado** e a decisão aparece na caixa do dono. Com uma prova conferida e o checklist completo, o aceite passa. | médio |
| 14 | **Teto de 3 rodadas** | O item "Travou" na caixa, com as três provas e os três motivos. | Na 3ª vez que alguém pede ajustes numa tarefa de teste, ela **não volta à sessão**: aparece em "Travou", com os verbos trocar executor, mudar critério e cancelar. | baixo |
| 15 | **"Parada" em 4 h** | A linha diz "parada há N h", e o Líder recebe um aviso. | Uma tarefa em execução sem nenhum sinal da sessão por 4 h (com o relógio adiantado no teste) aparece como **"parada"** na tabela, e o Líder recebe **uma** mensagem. Um sinal novo tira a marca. | baixo |
| 16 | **Espelho v5** — `tarefas` com as colunas novas, `tarefas_eventos`, `tarefas_em_aberto` com o filtro novo e a vista `esperando_voce`, por outbox. Depende do #279 ter entrado. | O Supabase conta a mesma história que o app. | No Supabase do dono, `select count(*) from tarefas` dá o total do app, `esperando_voce` tem **o mesmo número da faixa**, e `tarefas_eventos` tem uma linha por evento do log. Desligar a rede e religar não perde nem duplica linha. | baixo |

As fatias 1 a 4 podem sair **já**, em paralelo duas a duas (1 e 3 primeiro; a 2 depende da lista
da 1, e a 4 depende da tabela da 3). A 5 só entra com o D1 decidido. A 6 vem logo depois dela;
da 7 à 15 a ordem é a da tabela, porque todas mexem no mesmo contrato (a 13 depende da 12). Se o
PR #249 (Oráculo na VPS) entrar antes da 5, o log nasce no serviço da VPS: o formato é o mesmo.

## 6. Decisões que são do dono

- **D1 — Alfa antigo só-leitura.** Depois da fatia 5, o Alfa 0.4.0 só lê o Oráculo (não cria
  tarefa nem libera carta). O beta não muda: ele já só lê o ledger de hoje. Recomendo **aceitar**:
  é o único jeito de parar a perda de campo; o custo é abrir sempre um app novo.
- **D2 — Responsável = papel no quadro.** A tarefa deixa de ser da sessão. Recomendo **aceitar**
  (V1).
- **D3 — Revisor mais exigente.** Só aceita sozinho com prova verificada e checklist completo;
  senão sobe para você. Recomendo **aceitar**, sabendo que a caixa enche mais na primeira semana.
- **D4 — Ordem.** Começar pelas fatias 1 a 4 (sem schema) antes de decidir o D1. Recomendo
  **aceitar**: você sente a diferença sem risco, e decide o D1 vendo a caixa funcionando.
- **D5 — Qual tela.** Das três variantes do protótipo (A caixa primeiro, B tabela, C pedidos seus),
  qual vira o Oráculo. Recomendo **B com a caixa da A no topo**: a tabela responde ao "quem pediu"
  e ao "top de linha", e a caixa no topo garante que nada que espera por você fique escondido. A C
  esconde o que não veio de você (sinais do Curador, rotinas). A fatia 3 só começa com o D5
  respondido.

## Fora de escopo

- Código: nada implementado aqui; o dono decide antes.
- Assinatura criptográfica, Merkle, Sigstore no ledger (só no release do stable, se um dia).
- CRDT/local-first, vários escritores.
- Saída de comando capturada por hook e trace do Playwright como prova (fatia futura).
- Notas internas separadas das notas para você (V10).
- Permissões por linha no Supabase.

## Ainda não especificado

- Texto exato de cada verbo na caixa e no celular (sai da variante escolhida no D5).
- Prazo para "carta parada" (30 min proposto) e "parada" (4 h proposto): ajustar com uso.
- Como a sessão sem Slack pede que outra envie uma carta aprovada (provável: tarefa filha
  automática para o lugar com Slack do quadro).
