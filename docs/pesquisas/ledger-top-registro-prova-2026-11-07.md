# Oráculo Harrow: registro e prova em padrão top de linha (pesquisa, 07/11/2026)

Pedido do dono, repassado pelo Líder: "o ledger está uma bosta. Quero ele em padrão top de linha". Este é o ângulo
**registro e prova**. Código lido em `origin/staging` @ `8baa5ad`. Marco **[lido]** o que está no código ou na fonte e
**[suposição]** o que eu infiro.

## Resumo

O ledger já acerta o que é difícil: as regras moram numa função pura (`applyLedgerOp`), há um único processo que grava,
e "quem entregou não aceita" está no código. O que falta é o chão de um registro de verdade. (1) O arquivo é reescrito
inteiro a cada operação, então todo evento antigo pode ser alterado. (2) Dois canais abertos ao mesmo tempo podem perder
uma gravação. (3) O leitor descarta campos que não conhece, e isso obrigou a esconder fatos novos dentro de texto
(`⟦cancelada⟧`). (4) A prova é declarada pelo agente, não verificada: não há hash do arquivo, o link do CI não é
consultado e a "saída de comando" é texto digitado. Recomendação: gravar um log só de acréscimo com envelope de evento,
concorrência otimista, campos desconhecidos preservados e uma prova com hash e proveniência. CRDT, Sigstore e CDC não
compensam aqui.

## Como está hoje [lido]

- **Documento inteiro reescrito a cada operação.** A gravação faz temp → rename (`src/main/ledger-store.ts:162-174`),
  com fsync (`src/main/config-store.ts:408-430`). Os eventos ficam dentro de cada tarefa, e o `state` fica gravado ao
  lado deles (`src/shared/ledger/contract.ts:168-171`, `step()` em `:427`). Na prática são dois registros mutáveis, não
  um log.
- **Sem trava entre processos.** `apply` relê o arquivo, aplica e grava (`ledger-store.ts:178-191`). O app não chama
  `requestSingleInstanceLock` (a busca em `src/main` não acha nada). Alfa, Beta e Stable dividem o mesmo `userData` de
  propósito (CLAUDE.md, "Canais instalados coexistindo"). [suposição] Se dois canais gravam quase juntos, o segundo
  apaga a gravação do primeiro sem aviso.
- **O leitor descarta o que não conhece.** Por isso cada campo novo pede um salto de versão (`contract.ts:27-39`). Para
  fugir do salto, transferência, cancelamento, "feito por" e "substitui" viraram marcas no início do texto
  (`:263-271`), e a carta com arquivo leva `text: ''` para um app v4 ignorá-la (`:113-119`). Um app mais novo deixa o
  mais velho só lendo (`:1168-1171`, `ledger-store.ts:185`).
- **Idempotência só no celular.** Só as decisões vindas do celular levam `requestId` (v2, `contract.ts:29,143`).
  `criar` e `entregar` pelo MCP não levam nenhum. Os eventos não têm id nem número de sequência, só `at`, que vem do
  relógio (`:135-151`).
- **Prova.** O arquivo é copiado com nome aleatório (`ledger-store.ts:196`), mas nenhum hash é gravado
  (`contract.ts:51-54`). Do link se confere só que é http(s) (`ledger-store.ts:194`). O texto é o que o agente escreveu.
- **Um só escritor.** Só o main do PC grava (`ledger-store.ts:1-9`). A VPS chega por túnel SSH reverso
  (`src/main/remote-session.ts:9-10`). [suposição] Com o PC desligado ou o túnel caído, uma sessão da VPS não registra
  nada e o pedido se perde.
- **Arquivo corrompido trava tudo.** Ele não volta vazio (o que é bom), mas não existe cópia de segurança nem
  recuperação (`ledger-store.ts:142-153,183`).
- **Separação de funções já existe.** `cannotDecide` (`contract.ts:432-439`) aplica o princípio dos "quatro olhos".

## Práticas

| Prática | O que é | Vale para um ledger pessoal de agentes? | Custo |
|---|---|---|---|
| **Event sourcing / log só de acréscimo** [1] | Toda mudança vira um evento guardado em ordem. O estado é derivado e pode ser refeito rodando o log de novo, inclusive "como estava em tal dia". Fowler avisa que isso complica efeitos externos durante o replay. | **Sim.** O estado já é quase só a projeção dos eventos. Basta parar de gravar `state` e de reescrever eventos. Efeito externo (o Slack) já tem trava própria. | Médio: migrar o v4 para o log e refazer a projeção. |
| **Concorrência otimista** [2] | A gravação diz em que revisão espera encontrar o registro. Se outro escritor mexeu antes, ela falha em vez de sobrescrever. | **Sim.** Resolve o caso dos canais simultâneos. | Baixo: um contador `revision` mais uma trava de arquivo, ou de graça com SQLite. |
| **SQLite como arquivo do app** [3][4] | Transação atômica, gravação incremental e acesso coordenado entre processos. No modo WAL, leitores não bloqueiam o escritor, mas há um escritor por vez e só na mesma máquina. | **Bom candidato** para guardar o log: troca o "reescreve tudo" e a trava caseira de uma vez. Não serve para dividir o arquivo entre PC e VPS. | Médio. [suposição] Driver nativo precisa casar com a ABI do Electron, a mesma dor do node-pty. |
| **Chave de idempotência** [5][2][6] | O cliente gera um id por pedido. Uma repetição recebe a resposta original. O mesmo id com conteúdo diferente é recusado (422). | **Sim**, em toda operação do MCP, não só no celular. | Baixo. |
| **Envelope de evento (CloudEvents)** [6] | Todo evento leva `id`, `source`, `type` e `specversion`. O par `source`+`id` é único e serve para descartar duplicatas. | **Sim.** `source` = canal, versão do app e máquina; mais um `seq` local. Ajuda na auditoria e em qualquer espelho. | Baixo. |
| **Leitor tolerante e campos desconhecidos preservados** [7][8] | Ler só o que precisa, ignorar o resto **e devolver o resto intacto ao regravar**. O Protobuf preserva campo desconhecido no parse e na serialização. | **Crítico.** É o que acaba com as marcas `⟦…⟧` e com o "canal velho só lê". | Baixo. |
| **Upcasting e mudança paralela** [9][10][11] | Evento antigo nunca é alterado. Um upcaster converte a revisão x para x+1 na leitura. Uma quebra passa por expandir → migrar → contrair. | **Sim**, junto com a linha acima. Tipo e versão ficam por evento, não no documento inteiro. | Baixo a médio. |
| **Registro à prova de adulteração** [12][13][14] | Cada entrada encadeia o hash da anterior (ou entra numa árvore de Merkle), e o auditor confere que nada foi alterado nem removido, como no Rekor e no Certificate Transparency. | **Só o encadeamento simples**, conferido ao carregar. Ele pega reescrita silenciosa por canal ou script. Árvore de Merkle, provas de inclusão e testemunhas são exagero para um só dono. | Baixo (cadeia); alto (Merkle). |
| **Prova endereçada por conteúdo** [15] | O artefato é identificado pelo digest (`sha256`), não pelo nome. A atestação vale para aquele conteúdo exato. | **Sim.** Gravar `sha256` e tamanho de cada prova e conferir ao abrir a carta. | Baixo. |
| **Proveniência (W3C PROV, in-toto, SLSA)** [16][15][17] | Quem (agente), fez o quê (atividade), produzindo o quê (entidade). A SLSA registra `subject`+digest, os parâmetros externos e o `builder.id`. | **O modelo sim, a assinatura não.** A entrega vira um "statement": as provas com digest, o commit, o comando, o código de saída, a máquina e o lugar. Assinar com chave própria só faria sentido se o ledger saísse do PC. | Médio. |
| **Sigstore e atestações do GitHub** [14][18] | Assinatura sem gerenciar chave e log público de transparência. O GitHub atesta builds (SLSA L2) e recomenda usar em release, não em build de teste. Em repo privado não há log de transparência. | **Só no release do canal stable** (`xansde/donel`). Não para cada tarefa. | Baixo para release; não se aplica ao ledger. |
| **Aceite baseado em evidência (QA/CI)** [18][19] | Quem decide confere um artefato que a máquina gerou: status do CI, trace do Playwright (ações, DOM antes e depois, rede, console). | **Sim.** O main consulta o link do CI (`gh`) e congela conclusão e `headSha` no evento. A "saída de comando" é capturada por hook, não digitada. O trace do Playwright vale como prova de tela. | Médio. |
| **Separação de funções** | Quem executa não aprova. | Já temos (`cannotDecide`). Manter. | — |
| **CRDT / local-first** [20] | Dados replicados que se fundem sem servidor (Automerge). Ideais: offline, vários aparelhos, posse dos dados. | **Não.** As regras do ledger (só o dono do lugar entrega, quem entregou não aceita) são uma máquina de estados com invariantes, e fusão automática não as garante [suposição]. Um só escritor é mais simples e correto. | Alto. |
| **Outbox transacional** [21] | A mensagem é gravada na mesma transação que o dado, e um repetidor a entrega pelo menos uma vez. O consumidor precisa ser idempotente. | **Sim, para a VPS sem PC.** Fila local na VPS que reenvia com a chave de idempotência quando o túnel volta. Também serve de base para o espelho. | Médio. |
| **Espelho em banco (CDC, Supabase Realtime)** [22][23] | O Debezium lê o WAL do Postgres, entrega pelo menos uma vez e pode duplicar. O Supabase Realtime transmite mudanças da tabela com RLS. Acima de ~3 mil assinantes, a recomendação é o Broadcast. | **Opcional.** Basta empurrar os eventos do log para uma tabela (via outbox), para ter backup fora do PC e um painel. CDC é exagero: o log já é a fonte. Precisa ser um adaptador desligado por padrão (regra do CLAUDE.md para integrações). | Médio. |
| **Snapshot e cópia de segurança** [1] | Uma foto periódica do estado evita refazer tudo e permite recuperar. | **Sim.** Rotacionar N cópias com hash. Hoje um arquivo corrompido para o Oráculo inteiro. | Baixo. |

## As 10 práticas que mais faltam no nosso (ordem de valor por custo)

1. **Preservar campos desconhecidos ao regravar**, com upcaster por evento. Acaba com as marcas `⟦…⟧` e com o canal velho
   que só lê.
2. **Concorrência otimista** (`revision` mais trava de arquivo, ou SQLite). Acaba com a perda de gravação entre Alfa, Beta
   e Stable abertos juntos.
3. **Log só de acréscimo** (JSONL ou SQLite), com o estado como projeção que se refaz. Nenhum evento passado é
   reescrito.
4. **Chave de idempotência em toda operação do MCP** (`criar`, `entregar`…), com 422 para a mesma chave e outro conteúdo.
5. **`sha256` e tamanho de cada prova**, conferidos ao abrir a carta e no celular.
6. **Envelope de evento**: `id`, `seq`, `type@versão` e `source` (canal, versão do app, máquina).
7. **Hash encadeado entre eventos**, conferido ao carregar. Uma quebra vira alerta, não dado aceito em silêncio.
8. **Prova verificada pelo main**: o status do CI consultado e congelado, a saída de comando capturada por hook, o trace
   do Playwright como prova de tela.
9. **Proveniência por entrega**, num formato parecido com o in-toto, sem assinatura: commit, comando, código de saída,
   máquina, lugar e digest das provas.
10. **Outbox na VPS e espelho opcional** (backup rotativo local mais uma tabela fora do PC), para não perder registro com o
    PC desligado nem perder tudo num arquivo corrompido.

## Fontes

1. Fowler, *Event Sourcing* — https://martinfowler.com/eaaDev/EventSourcing.html
2. KurrentDB (EventStoreDB), *Appending events* (streamState, dedupe por id) — https://docs.kurrent.io/clients/node/v1.0/appending-events.html
3. SQLite, *As an Application File Format* — https://www.sqlite.org/appfileformat.html
4. SQLite, *Write-Ahead Logging* — https://www.sqlite.org/wal.html
5. IETF, *The Idempotency-Key HTTP Header Field* (draft-08, 22/10/2026) — https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
6. CloudEvents, *Spec v1.0* — https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
7. Fowler, *Tolerant Reader* — https://martinfowler.com/bliki/TolerantReader.html
8. Protocol Buffers, *proto3 — Unknown fields* — https://protobuf.dev/programming-guides/proto3/
9. Greg Young, *Versioning in an Event Sourced System* — https://leanpub.com/esversioning
10. Axon Framework, *Event versioning / upcasters* — https://docs.axoniq.io/axon-framework-reference/4.10/events/event-versioning/
11. Fowler, *Parallel Change* — https://martinfowler.com/bliki/ParallelChange.html
12. RFC 6962, *Certificate Transparency* — https://www.rfc-editor.org/rfc/rfc6962
13. Crosby & Wallach, *Efficient Data Structures for Tamper-Evident Logging*, USENIX Security 2009 — https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf
14. Sigstore, *Rekor overview* — https://docs.sigstore.dev/logging/overview/
15. in-toto, *Statement v1* — https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md
16. W3C, *PROV Overview* — https://www.w3.org/TR/prov-overview/
17. SLSA, *Provenance v1.0* — https://slsa.dev/spec/v1.0/provenance
18. GitHub, *Artifact attestations* — https://docs.github.com/en/actions/concepts/security/artifact-attestations
19. Playwright, *Trace viewer* — https://playwright.dev/docs/trace-viewer
20. Ink & Switch, *Local-first software* — https://www.inkandswitch.com/essay/local-first/
21. microservices.io, *Transactional outbox* — https://microservices.io/patterns/data/transactional-outbox.html
22. Debezium, *PostgreSQL connector* — https://debezium.io/documentation/reference/stable/connectors/postgresql.html
23. Supabase, *Realtime: Postgres Changes* — https://supabase.com/docs/guides/realtime/postgres-changes
