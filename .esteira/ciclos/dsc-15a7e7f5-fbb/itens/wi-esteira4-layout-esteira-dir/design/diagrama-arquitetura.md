# Diagrama de arquitetura — o `.esteira/` como canal entre fases

> Fase **Design** do item `wi-esteira4-layout-esteira-dir` · plano
> `pln-esteira4-skills-portateis` · discovery `dsc-15a7e7f5-fbb` · repo
> `donel-dev` · 08/08/2026.
>
> **Forma** deste documento vence; **alcance e comportamento** continuam sendo
> da spec que a fase Implementar vai escrever. Onde este desenho e a spec
> divergirem em comportamento, a spec ganha — e a divergência vira nota, não
> silêncio.

Insumos lidos: o `.esteira/` que existe hoje neste repo (`[E]` — `design/`,
`documentar/`, `implementar/`, `plano/`, `validar/` mais `review-policy.json`),
o contrato v1 (`src/shared/esteira/contract/v1/`), o fork de skills 3.0.0
(`tools/read_input.py`, `tools/emit_result.py`) e as decisões do Discovery de
07/08 — em especial **`.esteira/` versionado** e **skills sem o Donel**.

Companheiro deste documento: `mockup-layout-esteira.html`, na mesma pasta — ele
mostra as quatro cenas (árvore, descoberta, erro, diff do PR); este mostra as
fronteiras.

---

## 1. O que muda: a ida deixa de ser escrita e passa a ser derivada

Hoje o canal tem **duas** mensagens e um dono: o app escreve o `run-input.json`
no inbox, a skill devolve o `result.json` no outbox, e o app é quem espelha
qualquer coisa em `.esteira/`. Tirar o app do meio, mantendo o `run-input`,
só transferiria o problema — alguém teria de escrevê-lo.

```mermaid
flowchart LR
  subgraph HOJE["hoje — 3.0.0, o app é o remetente"]
    APP1["Donel Dev"] -->|escreve| RIN[["inbox/run-input.json"]]
    RIN --> SK1["skill esteira-&lt;fase&gt;-3"]
    SK1 -->|emit_result.py| ROUT[["outbox/result.json"]]
    ROUT --> APP1
    APP1 -.->|espelha| MIR[(".esteira/ &lt;fase&gt;/&lt;id&gt;-ctx.md")]
  end

  subgraph AMANHA["proposta — o canal é a pasta, e só tem volta"]
    SK2["skill esteira-&lt;fase&gt;"] -->|1. lê e reduz| CANAL[(".esteira/ciclos/&lt;dsc&gt;/runs/*.json")]
    CANAL -->|2. ida DERIVADA, na tela| SK2
    SK2 -->|3. escreve UM arquivo novo| CANAL
    APP2["Donel Dev — adaptador"] -->|lê o mesmo canal| CANAL
  end

  classDef box fill:#151a21,stroke:#28303b,color:#d7dde5
  classDef store fill:#1c232c,stroke:#5fb0a8,color:#d7dde5
  class APP1,SK1,APP2,SK2 box
  class RIN,ROUT,MIR,CANAL store
```

**A consequência que carrega o resto do desenho:** com a ida derivada, não
existe mais um arquivo que só o app sabe escrever — e é isso, não a instalação
da skill, que a solta do Donel. O app deixa de ser remetente e vira mais um
leitor do mesmo canal.

---

## 2. Como uma fase descobre o assunto lendo só a pasta

Esta é a pergunta que a decisão do disparo abriu, e é o único caminho de
código que o layout **precisa** fixar. O desenho a responde em quatro degraus,
cada um com uma saída explícita quando falha — nenhum deles adivinha.

```mermaid
flowchart TB
  START(["esteira &lt;fase&gt;"]) --> HDR{"esteira.json existe<br/>e layout_version é conhecida?"}
  HDR -->|não| E1["✗ não é um canal v2<br/><i>ensina: esteira init</i>"]
  HDR -->|sim| RED["lê ciclos/*/runs/*.json<br/>em ordem lexicográfica<br/><b>reduz fatos → estado</b>"]
  RED --> CAND{"quantos itens o estado deixa<br/>prontos para esta fase?"}
  CAND -->|"1"| SUB["assunto resolvido"]
  CAND -->|"0"| E2["✗ nada pronto para esta fase<br/><i>mostra em que fase cada item parou</i>"]
  CAND -->|"&gt;1"| TIE{"desempate:<br/>branch atual → local/cursor.json"}
  TIE -->|resolveu| SUB
  TIE -->|"ainda ambíguo"| E3["✗ pergunta ao humano<br/><i>lista os candidatos</i>"]
  SUB --> REPO{"slug do alvo tem caminho<br/>em local/repos.json?"}
  REPO -->|não| E4["✗ repo sem caminho nesta máquina<br/><i>ensina: esteira repo add</i>"]
  REPO -->|sim| GO(["ida impressa · fase roda"])

  classDef ok fill:#151a21,stroke:#28303b,color:#d7dde5
  classDef bad fill:#1c232c,stroke:#f0684c,color:#d7dde5
  classDef good fill:#1c232c,stroke:#3dce8f,color:#d7dde5
  class HDR,RED,CAND,TIE,SUB,REPO ok
  class E1,E2,E3,E4 bad
  class START,GO good
```

Três fronteiras saem daqui, e valem para qualquer implementação do leitor:

1. **O estado é derivado, nunca guardado.** Não existe arquivo "estado atual"
   versionado. Se existisse, ele seria mutável e compartilhado — o campo de
   batalha que a seção 3 evita.
2. **O que é da máquina fica na máquina.** Caminho de checkout, cursor e trava
   moram em `local/`, fora do git. O slug do repo é contrato e viaja; o caminho
   não viaja porque não pode.
3. **Ambiguidade vira pergunta, não palpite.** Uma fila que anda sozinha só é
   confiável se souber parar — e "dois itens prontos" é exatamente onde ela
   precisa parar.

---

## 3. Por que a granularidade é contrato: o que o merge faz com cada zona

A pasta é versionada por decisão do Discovery. Isso põe o layout dentro do
`git merge`, e transforma "nome de arquivo" numa decisão com consequência
mecânica — não estética.

```mermaid
flowchart LR
  subgraph V["zona versionada — entra no PR"]
    RUNS[("runs/&lt;utc&gt;--&lt;fase&gt;--&lt;run_id&gt;.json<br/><i>append-only · autor único por arquivo</i>")]
    GRAFO[("grafo.json<br/><i>mutável · dono único: fase Plano</i>")]
    ART[("itens/&lt;wi&gt;/**<br/><i>artefatos · caminho contém o item</i>")]
    CFG[("esteira.json · review-policy.json<br/><i>config · autor humano</i>")]
  end
  subgraph L["zona local — .gitignore"]
    LOC[("local/repos.json · cursor.json · travas/")]
  end
  subgraph X["zona congelada"]
    LEG[("_legado-2x/**<br/><i>o .esteira/ da 2.1.0</i>")]
  end

  RUNS -->|"merge une árvores"| OK1(["conflito impossível"])
  ART -->|"caminhos disjuntos por item"| OK1
  GRAFO -->|"dois Planos no mesmo ciclo"| OK2(["conflito real, e útil"])
  CFG --> OK2
  LOC --> NA(["não existe no merge"])
  LEG --> NA2(["não muda mais · leitor v2 não lê"])

  classDef store fill:#1c232c,stroke:#5fb0a8,color:#d7dde5
  classDef res fill:#151a21,stroke:#28303b,color:#d7dde5
  class RUNS,GRAFO,ART,CFG,LOC,LEG store
  class OK1,OK2,NA,NA2 res
```

| Se o layout fizesse… | O que aconteceria no merge |
|---|---|
| um `index.json` reescrito por toda fase | duas fases em branches diferentes = conflito **em toda leva**, e o resolvedor precisa entender o contrato para arbitrar |
| um `<fase>-result.json` por item (o layout de hoje) | a segunda vez que a mesma fase roda no mesmo item **sobrescreve** a primeira — o histórico do laço fix↔validar desaparece |
| um arquivo por run, com `run_id` no nome | a árvore só cresce; o merge é união; o histórico do laço fica inteiro, e a ordem sai do próprio nome |

A terceira linha é a proposta. As duas primeiras não são hipóteses: a segunda é
o layout instalado hoje (`[E]` — `.esteira/validar/handoffs/<id>/validar-result.json`),
e o laço fix↔validar do catálogo das seis fases roda **até três vezes** no mesmo
item.

---

## 4. Onde este item se encaixa no plano e no sistema

O `.esteira/` é o **canal**; os outros cinco itens do plano são os que passam
por ele. Por isso este item abre a sequência de merge junto do pacote portátil.

```mermaid
flowchart TB
  subgraph ESTE["este item — o canal"]
    LAY["<b>Layout do .esteira/</b><br/>specs/&lt;n&gt;-layout-esteira/<br/><i>zonas, nomes, granularidade,<br/>descoberta do assunto</i>"]
  end

  subgraph IRMAOS["itens irmãos do mesmo plano"]
    PKG["Pacote em docs/esteira-dev/<br/><i>move a árvore das skills</i>"]
    VAL["Validador que viaja<br/><i>check.py — sem npm run</i>"]
    SOLTO["Modo solto: fases de conversa<br/>+ fases automáticas"]
    APOS["Aposentar a 2.1.0"]
  end

  subgraph CONSUMIDORES["quem lê o canal"]
    SKILLS["skills esteira-&lt;fase&gt;<br/><i>num terminal qualquer</i>"]
    ADAPT["Donel Dev — skill-adaptador<br/><i>encapsula as outras</i>"]
    GIT["git · PR · review humano"]
  end

  subgraph CONTRATO["contrato v1 — NÃO muda aqui"]
    SCH[["esteira-result.schema.json<br/><i>facts[] · x-required-facts</i>"]]
  end

  LAY --> SOLTO
  LAY --> VAL
  LAY --> ADAPT
  PKG --> VAL
  VAL --> SOLTO
  SOLTO --> APOS
  SCH -->|"o QUE cada arquivo contém"| LAY
  LAY -->|"ONDE cada arquivo mora"| SKILLS
  LAY --> GIT

  classDef este fill:#1c232c,stroke:#c97fa8,color:#d7dde5
  classDef normal fill:#151a21,stroke:#28303b,color:#d7dde5
  class LAY este
  class PKG,VAL,SOLTO,APOS,SKILLS,ADAPT,GIT,SCH normal
```

### O que este item toca e o que ele não toca

| Componente | Este item… | Por quê |
|---|---|---|
| Contrato v1 (`esteira-result.schema.json`) | **não muda** | o schema diz o que um result **contém**; o layout diz onde ele **mora**. São perguntas diferentes, e misturá-las é o que faria uma mudança de pasta virar mudança de contrato |
| `tools/read_input.py` | **é substituído** por um leitor que deriva | é o único ponto do fork que hoje exige um arquivo que alguém escreveu |
| `tools/emit_result.py` | **muda só o destino** | continua sendo a única porta de saída; passa a escrever em `runs/` com nome determinado pelo layout |
| `src/main/esteira-result-watcher.ts` (`[E]` linha 67) | **muda o caminho** | hoje monta `<stateRoot>/<repo>/<card>/<fase>`; passa a ler o canal versionado |
| `.esteira/review-policy.json` | **não muda** | já mora na raiz e já tem dono humano — a zona de config nasce dele |
| `.esteira/` de hoje (5 pastas de fase) | **é congelado**, não migrado | reescrever handoff antigo no formato novo é inventar fato que ninguém declarou; congelar preserva a leitura humana sem fingir contrato |
| Motor da fila / catálogo das seis fases | **é consumidor** | especificado pelo plano irmão `pln-esteira4-catalogo-e-grafo` |

---

## 5. O que fica em aberto para a spec resolver

Nenhum destes é forma — são todos alcance, e por isso saem daqui como pergunta,
não como desenho:

1. **A pasta é por ciclo ou por plano.** O desenho usa `ciclos/<discovery_id>/`
   porque a raiz de um card é o discovery. Mas um ciclo pode ter vários planos
   (este próprio ciclo tem sete), e o `grafo.json` é **por plano** — ou ele vira
   `planos/<pln>/grafo.json` dentro do ciclo, ou a pasta passa a ser por plano e
   perde a raiz comum.
2. **Sanitização do que é versionado.** O `result.json` de hoje carrega
   `workspace.repo_path` absoluto (`C:/Users/xansd/…`) e `actor.cli_session_id`.
   Versionar caminho de máquina contradiz a fronteira da seção 2 — mas removê-lo
   no arquivo de repo significa que o arquivo versionado **não** é byte-a-byte o
   que a skill emitiu, e o validador precisa saber disso.
3. **Retenção.** `runs/` cresce para sempre por construção. Poda de ciclo
   concluído (mover para `_arquivo/`) mantém o repo leve, mas quebra a promessa
   de que a ordem lexicográfica de `runs/` é o histórico inteiro.
4. **Item cujo alvo é outro repo.** O canal mora no repo âncora, e a fase
   Implementar escreve código no alvo. O run dessa fase cai no `.esteira/` do
   âncora (e não aparece no PR do alvo) ou no do alvo (e o ciclo se parte em
   dois)? A decisão de "âncora e escopo de repo" já existe no app; o layout
   precisa dizer onde o arquivo pousa.
5. **Quem cria o `esteira.json`.** `esteira init` num repo sem canal é um
   comando novo, e comando novo é alcance — este desenho só o nomeia no erro.
