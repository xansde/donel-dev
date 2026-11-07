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
"ledger legível no Supabase" (`feature/ledger-legivel`, ainda sem PR).

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
rotina, nome, canal }`. Se a sessão não sabe, grava `não informado` — e a linha aparece marcada em
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
   Sem `pedidoPor` na origem → `não informado` (nunca o papel).
4. **Conferência antes de ativar**: mesma quantidade de tarefas e de eventos, todo id presente,
   e a projeção reconvertida para o formato v4 bate com o original nas tarefas sem marca. Se não
   bater, a migração não ativa, o v4 segue gravando e a caixa mostra "migração recusada" com o
   motivo.
5. O `ledger.json` passa a ser **regravado como projeção**, com `schemaVersion: 5`, tarefas no
   formato v4 + campos novos. Um app v4 (Alfa 0.4.0, beta atual) que abre esse arquivo vê a
   versão maior e **fica só-leitura** — mecanismo que já existe (`isNewerLedger`): ele lê as
   tarefas, não consegue gravar, e portanto **não apaga nada**. A fonte de verdade
   (`eventos.jsonl`) ele nem conhece. Para o parse v4 não descartar tarefas com estado novo, o
   campo `state` da projeção leva o estado v4 mais próximo (bloqueada e esperando você →
   em execução; concluída → aceita; cancelada e duplicada → rejeitada com a marca de hoje) e o
   estado real vai em `estado` — o v4 ignora o campo que não conhece.
6. A partir do v5 não há mais "subir versão": tipo e versão são por evento, e o leitor tolerante
   preserva o que não conhece (1.5).

**Custo assumido (D1):** depois da migração, o Alfa 0.4.0 e o beta atual só leem o Oráculo — não
criam tarefa nem liberam carta de Slack. Para trabalhar, o dono abre um Donel Dev v5. É a decisão
explícita que o diagnóstico pede para sair do congelamento.

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

**Recomendação: B com a caixa da A no topo** (a caixa recolhe quando está vazia). A tabela é o
que ele já abriu no Supabase e criticou; a B responde direto às duas falas ("quem pediu",
"top de linha"), e a caixa no topo garante que nada que espera por ele fique escondido. A C é a
mais bonita para pedidos grandes, mas esconde o que não veio dele (sinais do Curador, rotinas).

## 4. Colunas, alinhadas com o Dev do espelho

O Dev "ledger legível no Supabase" (tarefa t-a627741e, branch `feature/ledger-legivel`, sem PR
aberto até agora) está trocando a tabela `demandas` por `tarefas`. **O v5 mantém todos os nomes
dele e só acrescenta.** Nenhuma renomeação depois que o PR dele entrar.

| Coluna (dele) | No v5 passa a vir de | Coluna nova do v5 | O que mostra |
|---|---|---|---|
| `quadro`, `titulo`, `pedido`, `risco`, `prazo`, `id` | igual | `codigo` | chave curta "H-142" |
| `estado` | estado v5 em português (aberta, em execução, bloqueada, esperando você, entregue, concluída, cancelada, duplicada; carta: aprovada, enviando, enviada, falhou, sem confirmação) | `pai_id` | a tarefa-raiz |
| `esperando_dono` | "está na caixa Esperando você" (qualquer tipo da 1.8) | `com_quem_esta` | "você decide", "Revisor confere", "ninguém — falta executor" |
| `quem_pediu` | `pedidoPor` (campo, não mais a marca `⟦pedido por⟧`) | `responsavel` | papel · quadro |
| `quem_criou` | `registradaPor`, nome congelado | `quem_decide` | você / Revisor |
| `quem_faz_agora` | `executor` (a sessão), nome congelado | `prazo_status` | no prazo · em risco · vencido · cumprido |
| `ultima_entrega`, `link_da_prova`, `prova_texto` | igual | `prova_nivel` | verificada · declarada |
| `decisao`, `motivo` | decisão em três verbos; motivo sem marcas | `motivo_fechamento` | aceita · concluída por prova · recusada · não vai sair · substituída · duplicada |
| `criada_em`, `entregue_em`, `decidida_em`, `atualizado_em` | igual | `rodadas`, `criterio_pronto`, `envio_link`, `ultima_atividade`, `ultima_atividade_em` | — |

Mais a tabela `tarefas_eventos` (uma linha por evento do log: `id`, `seq`, `tarefa_id`, `tipo`,
`em`, `por_nome`, `via`, `canal`, `texto`, `hash`) e a vista `esperando_voce`.

## 5. Fatiamento em PRs pequenos

Ordem pensada para o dono **sentir a diferença na primeira fatia**, antes de qualquer mudança de
schema. Cada PR < 50 arquivos, contra `staging`, com `npm run verify`. Testes só onde a regra do
projeto manda (dado persistido que um canal pode apagar, mensagem que some ou duplica).

| # | PR | O que o dono sente | Schema | Risco |
|---|---|---|---|---|
| 1 | **Caixa "Esperando você" completa, sobre o v4** — derivada do que já existe: cartas aceitas não enviadas, envios "sem confirmação" e "falhou" (lendo o texto de hoje), entregues de risco baixo paradas há 24 h, órfãs para repassar, amostra do Revisor. Faixa com total e o mais antigo. Celular usa a mesma lista. | "Agora eu vejo tudo o que espera por mim." O 0 vira o número de verdade. | não muda | baixo |
| 2 | **Tabela legível no app (variante B)** — vista "Tudo" do Oráculo com as colunas da seção 4 derivadas do v4, busca, filtros prontos, painel com linha do tempo. | "Dá para entender de quem é cada coisa." | não muda | baixo |
| 3 | **Contrato v5 puro + upcaster v4→v5** — tipos, envelope, estados, regras novas em `applyLedgerOp`, upcaster das marcas. Sem gravar nada. Teste: importar um v4 de amostra não perde tarefa nem evento e reconverte igual. | nada visível (base) | define o v5 | médio |
| 4 | **Log só de acréscimo + trava + hash + migração** — `eventos.jsonl`, `oraculo.lock`, conferência da cadeia, backups, projeção `ledger.json` v5; migração com conferência e recusa. Teste: migração, dois escritores, cadeia quebrada vira alerta. | Alfa antigo fica só-leitura (avisado antes). | **sobe para 5** | **alto** (D1) |
| 5 | **Papéis e fim da órfã** — `pedidoPor` obrigatório (preenchido sozinho no chat do dono), executor separado, nomes congelados, sessão fechada → "aberta, sem executor" na caixa do Líder. | "Quem pediu: Alexandre", nunca "Dev". Órfãs zeram. | v5 | médio |
| 6 | **Estados de verdade + idempotência + tarefa-pai** — bloqueada, esperando você (com pergunta), concluída, cancelada tipada, duplicada; `chave`; `paiId`/`dependeDe`; título obrigatório. Faxina fecha `concluida-por-prova`. | Um pedido = uma linha com filhas; sem 5 cópias; "cancelada" quer dizer cancelada. | v5 | médio |
| 7 | **Carta com recibo** — estados de envio, `ts` + permalink, reenvio pela mesma chave, envio por qualquer lugar com Slack ou pelo app, conferência do "sem confirmação". | "Cadê a mensagem do Slack?" tem resposta com link. | v5 | médio (Slack em nome dele) |
| 8 | **Prova verificada + Revisor + teto de retrabalho** — `sha256`, `gh` no entregar, nível da prova, checklist do critério, regra do Revisor (D3), 3 rodadas → caixa, "parada" em 4 h. | Prova com selo "conferida pelo app"; nada aceito no escuro. | v5 | médio |
| 9 | **Espelho v5** — `tarefas` com as colunas novas + `tarefas_eventos` + vista `esperando_voce`, por outbox. Depende do PR do Dev das colunas ter entrado. | O Supabase conta a mesma história que o app. | v5 | baixo |

As fatias 1 e 2 podem sair **em paralelo** e já amanhã; a 3 pode andar junto delas (não grava
nada). A 4 só entra com o D1 decidido. Da 5 à 8, sequência (mexem no mesmo contrato). Se o PR #249
(Oráculo na VPS) entrar antes da 4, o log nasce no serviço da VPS — o formato é o mesmo.

## 6. Decisões que são do dono

- **D1 — Alfa antigo só-leitura.** Depois da fatia 4, o Alfa 0.4.0 e o beta atual só leem o
  Oráculo (não criam tarefa nem liberam carta). Recomendo **aceitar**: é o único jeito de parar a
  perda de campo; o custo é abrir sempre um app v5.
- **D2 — Responsável = papel no quadro.** A tarefa deixa de ser da sessão. Recomendo **aceitar**
  (V1).
- **D3 — Revisor mais exigente.** Só aceita sozinho com prova verificada e checklist completo;
  senão sobe para você. Recomendo **aceitar**, sabendo que a caixa enche mais na primeira semana.
- **D4 — Ordem.** Começar pelas fatias 1 e 2 (sem schema) antes de decidir o D1. Recomendo
  **aceitar**: você sente a diferença sem risco, e decide o D1 vendo a caixa funcionando.

## Fora de escopo

- Código: nada implementado aqui; o dono decide antes.
- Assinatura criptográfica, Merkle, Sigstore no ledger (só no release do stable, se um dia).
- CRDT/local-first, vários escritores.
- Saída de comando capturada por hook e trace do Playwright como prova (fatia futura).
- Notas internas separadas das notas para você (V10).
- Permissões por linha no Supabase.

## Ainda não especificado

- Texto exato de cada verbo na caixa e no celular (sai do protótipo escolhido).
- Prazo para "carta parada" (30 min proposto) e "parada" (4 h proposto): ajustar com uso.
- Como a sessão sem Slack pede que outra envie uma carta aprovada (provável: tarefa filha
  automática para o lugar com Slack do quadro).
