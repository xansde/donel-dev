# Layout do `.esteira/` como canal entre fases — 012 Esteira 4.0

**Status:** 🟢 **DECIDIDA** (2026-08-09) — as cinco perguntas de **alcance** da
seção 8 (`[P-1]`…`[P-5]`) foram **ratificadas pelo dono**, cada uma pela
recomendação escrita; as **três zonas** da seção 2 foram ratificadas na mesma
leitura (o outro gate de gente que a seção 10 nomeia); e o **único ponto em
aberto** — o endereço do worktree por card — foi **fechado**. Nenhuma pendência
de alcance segue aberta. Os dois consertos que a Validar de 08/08 exigiu
(timestamp com milissegundos e `workspace.branch` obrigatória) já estão
aplicados e conferidos em disco.
**Item:** `wi-esteira4-layout-esteira-dir` · plano `pln-esteira4-skills-portateis` ·
discovery `dsc-15a7e7f5-fbb` · repo `donel-dev`.

**Item irmão (fonte).** `wi-esteira4-catalogo-fases` (`catalogo.md`, nesta mesma
pasta) diz **o que se percorre**: as seis fases, o grafo, as três paradas humanas.
Esta spec diz **por onde as fases falam entre si**. Onde as duas tocarem o mesmo
assunto — nome de fase, cardinalidade, quem dispara o quê — vence o catálogo.

> **Legenda de proveniência:** `[D-n]` decisão do dono, fechada ao vivo no
> Discovery de 07/08 — é requisito, não inventar além disto · `[F-n]` resolução de
> **forma**, proposta pela fase Design de 08/08 e aqui transformada em texto
> normativo · `[P-n]` pergunta de **alcance** devolvida pelo Design e decidida
> nesta spec (seção 8) · `[E]` evidência medida em disco/código, com caminho.

Insumos: os dois artefatos da fase Design deste item
(`.esteira/ciclos/dsc-15a7e7f5-fbb/itens/wi-esteira4-layout-esteira-dir/design/`),
o contrato v1 (`src/shared/esteira/contract/v1/`), o fork de skills 3.0.0
(`tools/read_input.py`, `tools/emit_result.py`) e as decisões do Discovery de
07/08 — em especial **`.esteira/` versionado** `[D]` e **skills sem o Donel** `[D]`.

---

## Problema

**Hoje o canal entre fases não está no repositório — está fora dele, em três
raízes que só a máquina conhece.** Medido `[E]`:

| Raiz | O que guarda | Onde fica |
|---|---|---|
| `~/.claude/esteira-donel/{inbox,outbox}/` | a ida (`run-input.json`) e a volta (`result.json`) da esteira **3.0** | `src/main/esteira-dispatch.ts:55` · `src/main/esteira-ingest.ts:58` |
| `~/.claude/esteira-state/<repo_slug>/<card>/<fase>/` | o handoff da esteira **2.x**, movido para fora do repo pela CA-4 da 009 | `src/main/index.ts:314` · `src/main/esteira-result-watcher.ts:23-24` |
| `<repo>/.esteira/<fase>/` | o resto da **2.1.0** que ficou versionado, mais `review-policy.json` | árvore deste repo |

Nenhuma das três é um canal que viaja. A primeira exige que **alguém escreva a
ida** — e esse alguém é o app, o que amarra a skill ao Donel Dev. A segunda mora
no home da máquina: quem clona o repo não recebe nada. A terceira é resto
histórico, com um formato que **perde histórico** (seção 1.2).

A decisão do Discovery — `.esteira/` **versionado** `[D]` — reverte a CA-4 de
propósito, e o motivo é diferente do que a CA-4 combatia. A CA-4 tirou o handoff
do repo para não sujar o diff; a esteira 4.0 põe o canal no diff **porque é lá que
ele precisa estar**: um canal que não viaja no clone não solta a skill do app, só
troca um dono por outro. O custo é real e conhecido — a pasta entra no `git merge`
—, e é esse custo que transforma "nome de arquivo" numa decisão de contrato.

---

## 1. As duas coisas que o layout de hoje não sabe fazer

### 1.1 Ninguém escreve a ida quando não há app

O `tools/read_input.py` do fork exige um `run-input.json` que o app escreveu `[E]`.
Sem o app, ou alguém digita esse arquivo à mão — e a fila para em cada item — ou a
fase adivinha o assunto. Adivinhar o assunto é o defeito que já custou uma fase
aberta no repo errado (evidência 2 da 010).

**A saída é não ter mensagem de ida `[F]`.** O canal só tem **voltas**: os
`result.json` em `runs/`, lidos em ordem e **reduzidos a estado**. A ida é uma
projeção calculada na hora e impressa na tela, nunca um arquivo. O redutor não é
código novo: é o mesmo que o app já usa para ingerir o outbox `[E]`
(`src/main/esteira-ingest.ts:309`, que ordena os nomes e reingere sem duplicar
evento, com `run.run_id` como chave de idempotência `[E]`).

### 1.2 A segunda rodada da mesma fase apaga a primeira

O layout 2.1.0 guarda **um** `<fase>-result.json` por item `[E]`
(`.esteira/validar/handoffs/wi-registry-providers-classe-a/validar-result.json`).
Rodar a mesma fase duas vezes no mesmo item sobrescreve a primeira.

Isso deixou de ser detalhe: o catálogo das seis fases roda o laço
`fix ↔ validar staging` **até três vezes** no mesmo item (`catalogo.md`, seção 5),
e o contador de rodadas é **derivado dos runs** — `[P-2]` do catálogo decidiu que
ninguém incrementa contador; a rodada é o número de runs da Validar com
verificação `failed`. Com um arquivo por fase, duas das três rodadas somem, e o
teto de 3 passa a contar sobre um histórico que não existe.

**Um arquivo por run é o que sustenta o teto do laço.** Não é preferência de
organização: é a condição para o número que a fila usa para desistir ser
verdadeiro.

---

## 2. Três zonas, um critério: quem escreve e o que o merge faz `[F]`

A pasta é versionada, logo entra no `git merge`. O layout separa por **regra de
escrita**, não por fase.

| Zona | Raiz | Versionada | Regra de escrita |
|---|---|---|---|
| **versionada** | `esteira.json`, `review-policy.json`, `ciclos/**` | sim | append-only, ou mutável **com dono único declarado** |
| **local** | `local/**` | **não** (`.gitignore`) | livre — é da máquina, e some no PR |
| **congelada** | `_legado-2x/**` | sim | ninguém escreve; o leitor v2 **não lê e não valida** nada aqui |

Três fronteiras saem daqui e valem para qualquer implementação do leitor:

1. **O estado é derivado, nunca guardado.** Não existe arquivo "estado atual"
   versionado. Se existisse, ele seria mutável e compartilhado — e um agregador
   reescrito por toda fase conflita em **toda leva**, com um resolvedor que
   precisa entender o contrato para arbitrar.
2. **O que é da máquina fica na máquina.** Caminho de checkout, cursor e trava
   moram em `local/`. O **slug** do repo é contrato e viaja; o **caminho** não
   viaja porque não pode.
3. **Ambiguidade vira pergunta, não palpite.** Uma fila que anda sozinha só é
   confiável se souber parar.

---

## 3. A árvore normativa

```
.esteira/
├── esteira.json                    ← cabeçalho do canal (seção 7)
├── review-policy.json              ← já existe hoje [E]; não muda
├── .gitignore                      ← uma linha: local/
│
├── local/                          ← ZONA LOCAL · não versionada
│   ├── repos.json                  slug → caminho do checkout NESTA máquina
│   ├── cursor.json                 em que item esta máquina está
│   └── travas/                     trava com dono, hora e sessão (D-3 da 010)
│
├── ciclos/                         ← ZONA VERSIONADA · uma pasta por CICLO [P-1]
│   └── <discovery_id>/
│       ├── runs/                   APPEND-ONLY · um arquivo por run
│       │   └── <utc-ms>--<fase>--<run_id>.json
│       ├── planos/
│       │   └── <plan_id>/
│       │       └── grafo.json      o esteira.grafo · dono único: a fase Plano
│       └── itens/
│           └── <work_item_id>/
│               └── <fase>/         artefatos daquela fase, naquele item
│
└── _legado-2x/                     ← ZONA CONGELADA · o .esteira/ da 2.1.0
    └── design/ documentar/ implementar/ plano/ validar/
```

**Quatro segmentos, e cada um é um id do contrato.** `<discovery_id>`,
`<plan_id>`, `<work_item_id>` e `<fase>` são exatamente `subject.discovery_id`,
`subject.plan_id`, `subject.work_item_id` e `run.phase` do `result.json` `[E]`. O
caminho não carrega nenhuma informação que o arquivo não carregue — ele é um
índice, não uma segunda fonte. Um leitor que discorde do arquivo está errado, e o
arquivo ganha.

---

## 4. O nome do arquivo de run é contrato `[F]`

```
<UTC compacto com ms>--<fase>--<run_id>.json
```

**Padrão normativo** (o teste da seção 9 lê esta linha do próprio documento):

```
^\d{8}T\d{9}Z--[a-z][a-z0-9-]*--[a-z][a-z0-9-]*(\.(c|rev)\d+)?\.json$
```

Exemplos que **casam**:

```
20260807T231245123Z--discovery--run-3f2ab1c4-902.json
20260808T001812045Z--plano--run-9c14e77a-4d1.json
20260808T012433981Z--design--run-65bc73cc-11e.json
20260808T093207512Z--implementar--run-b70e2f19-55c.c1.json
20260808T104115337Z--validar--run-b70e2f19-55c.rev2.json
```

Exemplos que **não casam**, e por quê:

```
validar-result.json                      ← o formato 2.1.0: não diz quando nem qual run
20260808--validar--run-abc.json          ← sem hora: dois runs do mesmo dia empatam
2026-08-08T09:32:00Z--validar--x.json    ← `:` é caractere inválido em caminho no Windows
20260808T0157Z--validar--run-abc.json    ← só até o minuto: quatro minutos do histórico real já têm mais de um run
```

O padrão resolve três coisas de uma vez, e nenhuma delas é estética:

1. **Ordena por leitura lexicográfica** — a ordem cronológica sai do `ls`, sem
   abrir arquivo. É o que o redutor já faz com o outbox `[E]`. Precisa dos
   milissegundos, não só do minuto: medidos os 64 runs reais do outbox, quatro
   minutos distintos têm mais de um run terminando neles — um deles com três
   (`2026-08-04T16:21`) e três com dois (`2026-08-04T17:10`,
   `2026-08-08T00:30`, `2026-08-08T01:43`). Com granularidade de minuto, a
   ordenação nesses casos cai no `run_id`, que é aleatório — e este item, sem
   fila paralela nenhuma ainda, já produz o empate.
2. **É único por run** — duas branches nunca escrevem o mesmo caminho, e o
   `git merge` une as árvores sem tocar conteúdo.
3. **Diz no próprio nome o que a pessoa procura no diff** — quem revisa o PR lê a
   fase e o momento antes de abrir o arquivo.

Os sufixos `.c<N>` e `.rev<N>` não são invenção deste layout: são a convenção que
o contrato v1 já cobra em `complements_run_id` e `revises_run_id` `[E]`. O nome do
arquivo os reflete porque um complemento **é um run novo**, não a edição do
anterior — e um layout que os fundisse num arquivo só reintroduziria a sobrescrita
da seção 1.2.

---

## 5. Como uma fase descobre o assunto lendo só a pasta `[F]`

Este é o único caminho de execução que o layout **precisa** fixar — é a pergunta
que a decisão do disparo abriu. Quatro degraus, cada um com uma saída explícita
quando falha. Nenhum adivinha.

| # | Degrau | Falhou → |
|---|---|---|
| 1 | `esteira.json` existe e `layout_version` é conhecida? | ✗ **não é um canal v2** · ensina `esteira init` |
| 2 | lê `ciclos/*/runs/*.json` em ordem lexicográfica e **reduz fatos → estado** | — |
| 3 | quantos itens o estado deixa prontos para esta fase? | `0` → ✗ **nada pronto** · mostra em que fase cada item parou · `>1` → desempate por **branch atual**, depois `local/cursor.json`; ainda ambíguo → ✗ **pergunta ao humano**, listando os candidatos |
| 4 | o slug do alvo tem caminho em `local/repos.json`? | ✗ **repo sem caminho nesta máquina** · ensina `esteira repo add <slug> <caminho>` |

**Regra dura dos quatro degraus:** enquanto o assunto não estiver resolvido,
**nada é escrito e nenhum run é aberto**. Uma fase que falha na descoberta não
deixa rastro — porque rastro de fase que não rodou é exatamente o fato inventado
que a esteira 4.0 existe para extinguir.

---

## 6. A regra de escrita, caminho por caminho `[F]`

| caminho | quem escreve | mutável? | versionado? | o que acontece num merge |
|---|---|---|---|---|
| `ciclos/<dsc>/runs/*.json` | a fase que fecha | **não** — append-only | sim | a árvore só ganha arquivo; conflito é impossível por construção |
| `ciclos/<dsc>/planos/<pln>/grafo.json` | **só a fase Plano** | sim, dono único | sim | conflito só se dois Planos rodarem no mesmo plano — e aí o conflito é real, e é útil |
| `ciclos/<dsc>/itens/<wi>/**` | a fase que produz o artefato | por artefato | sim | o caminho contém o item; fases de itens diferentes nunca se cruzam |
| `esteira.json` · `review-policy.json` | humano | raro | sim | igual a qualquer config de repo — conflito raro e legível |
| `local/**` | a máquina | sim | **não** | não existe no merge; some do PR por `.gitignore` |
| `_legado-2x/**` | ninguém | congelado | sim | não muda mais; o leitor v2 não olha e não valida nada aqui |

**Regra adicional da linha `runs/*.json`:** um run que pousa aqui tem
`workspace.branch` preenchida — regra do **layout**, não do schema v1 (seção 9
não muda). É cobrada pelo teste da seção 10 e, depois, pelo validador que viaja
(item `wi-esteira4-validador-que-viaja`).

**Critério de aceite do layout:** um PR que carrega duas fases do mesmo ciclo
mostra **só linhas novas** em `runs/` e em `itens/`. A única linha "alterado"
aceitável é a de um arquivo com **dono único declarado** nesta tabela. Se um dia
aparecer "alterado" numa linha append-only, o layout foi violado — e o diff é
onde isso se vê, sem ferramenta nenhuma.

---

## 7. O `esteira.json` — o cabeçalho que separa canal de pasta parecida

```json
{
  "layout_version": 2,
  "contract_version": "1.0.0",
  "anchor_repo": "donel-dev",
  "cycles_root": "ciclos"
}
```

| Campo | Para quê |
|---|---|
| `layout_version` | degrau 1 da descoberta. Versão desconhecida = o leitor **recusa**, nunca tenta ler mesmo assim |
| `contract_version` | qual `esteira-result.schema.json` valida os runs desta pasta |
| `anchor_repo` | o slug do repo **âncora** deste canal — o que resolve `[P-4]` |
| `cycles_root` | onde os ciclos moram, para que o nome da pasta não vire constante espalhada em código |

Sem este arquivo, **não é um canal v2**. Uma pasta `.esteira/` com as subpastas
certas mas sem cabeçalho é o `.esteira/` da 2.1.0 — e ler a 2.1.0 com o leitor v2
produziria exatamente a leitura errada que a zona congelada existe para impedir.

---

## 8. As cinco perguntas de alcance — decididas aqui, ratificadas em 09/08

A fase Design devolveu cinco perguntas **de propósito**, para esta spec não herdar
decisão tomada por acidente no desenho. Cada uma abaixo traz a decisão, o motivo e
**o custo da alternativa** — porque decisão sem custo declarado é preferência
disfarçada.

> **As cinco foram ratificadas pelo dono em 2026-08-09**, cada uma pela
> recomendação escrita. Não são mais propostas: são requisito. Onde o texto
> abaixo disser "decisão", leia "decisão ratificada".

### `[P-1]` A pasta é por ciclo ou por plano

**Decisão: por CICLO (raiz = `discovery_id`), com o grafo em
`planos/<plan_id>/grafo.json` dentro dele.**

O `subject` do contrato v1 exige **só** `discovery_id`; `plan_id` e
`work_item_id` são anuláveis `[E]`. Uma pasta por plano não teria onde pousar o
run da própria Discovery — que é a fase que **cria** os planos e, por construção,
roda antes de qualquer um existir. O ciclo é a única raiz que todo run tem.

O grafo continua sendo **por plano** (o catálogo o fixa assim), e por isso ganha
um nível: `planos/<pln>/`. Este ciclo tem sete planos; com o grafo solto na raiz
do ciclo, os sete disputariam o mesmo arquivo — e a linha "dono único: a fase
Plano" da seção 6 viraria falsa no primeiro plano paralelo.

**Divergência declarada com o Design:** os dois artefatos desenham
`ciclos/<dsc>/grafo.json`, plano. O nível `planos/<pln>/` é **alcance** — é a
resposta à pergunta que o próprio Design devolveu —, e por isso a spec decide. Os
artefatos ficam como registro do que foi proposto; onde eles mostram o grafo na
raiz do ciclo, vale esta seção.

**Custo da alternativa** (pasta por plano): o run de Discovery vira órfão, e a
redução `runs/ → estado` passa a precisar varrer duas raízes com regras
diferentes.

### `[P-2]` O que é sanitizado antes de virar arquivo de repo

**Decisão: o arquivo versionado é o result SANITIZADO. Três campos viram `null` ao
pousar em `runs/`:** `workspace.repo_path`, `workspace.worktree_path` e
`actor.cli_session_id`.

Os três são anuláveis no schema `[E]`, então o arquivo sanitizado **continua
válido pelo mesmo contrato** — não existe uma segunda forma a validar. O que fica
é o que viaja: `workspace.target_repo` (o slug) e `workspace.branch` são contrato,
e é com eles que outra máquina reencontra o trabalho.

O que sai é o que não pode viajar: `C:\Users\xansd\...` é topologia de máquina
(e este repo tem um espelho **público**), e `cli_session_id` não significa nada
fora da sessão que o gerou.

**Emenda (Validar, 08/08): `branch` deixa de ser opcional ao pousar.** O schema
v1 continua aceitando `null` — não é este item que muda o contrato —, mas o
**layout** exige `workspace.branch` preenchida em todo run de `runs/`: medido no
único run materializado antes desta emenda, ela veio `null`, e no histórico
completo do outbox só 22 dos 64 runs a preenchem. Quem preenche é o **emissor**,
derivando do checkout (`git rev-parse --abbrev-ref HEAD`) quando a ida não
trouxer o valor — caminho natural, porque a 4.0 extingue a ida escrita pelo app
(seção 1.1).

**Consequência declarada, para ninguém descobrir depois:** o arquivo versionado
**não** é byte-a-byte o que a skill emitiu. Isso não é perda de fidelidade
escondida porque o emissor escreve **já na forma sanitizada** — não existe uma
versão "crua" versionada em lugar nenhum, e o validador cobra a forma sanitizada
como a única forma. A cópia crua, quando alguém quiser, mora em `local/`.

**Custo da alternativa** (versionar byte a byte): caminho absoluto de máquina e id
de sessão entram no PR de todo mundo, e a fronteira "o que é da máquina fica na
máquina" da seção 2 passa a valer só para `local/` — ou seja, deixa de ser
fronteira e vira convenção.

### `[P-3]` Retenção de `runs/`

**Decisão: sem poda. `runs/` é append-only para sempre.**

Um `result.json` é da ordem de poucos KB de texto, e o git já é histórico
comprimido. Podar quebra a promessa de que a ordem lexicográfica de `runs/` é o
histórico **inteiro** — e foi exatamente a perda de histórico (seção 1.2) que
originou o arquivo por run. Um layout não pode extinguir a sobrescrita numa seção
e reintroduzi-la por poda em outra.

**Adiado e nomeado, não decidido:** se um dia doer, a saída é arquivar o **ciclo
concluído inteiro** em `_arquivo/<dsc>/` — movimento atômico que preserva a ordem
dentro do ciclo — e nunca podar runs de um ciclo vivo. Fica registrado aqui para
que a decisão futura não precise redescobrir a restrição.

**Custo da alternativa** (poda por idade ou por contagem): o teto do laço
`fix ↔ validar` conta rodadas **derivadas dos runs** `[P-2 do catálogo]`; podar
runs é mexer no número que a fila usa para desistir.

### `[P-4]` Item cujo alvo é outro repo

**Decisão: o run pousa SEMPRE no `.esteira/` do repo âncora.** O canal é do ciclo,
e o ciclo mora onde nasceu — o `anchor_repo` do `esteira.json`.

Partir o ciclo em dois repositórios faria a redução `runs/ → estado` depender de
ler dois checkouts, e a descoberta do assunto (seção 5) voltaria a precisar de um
mapa externo dizendo quais são eles. Esse mapa externo é o acoplamento que este
item existe para extinguir — ele só teria trocado o app por um arquivo de
configuração.

O run **já diz** que o código foi para outro lugar: `workspace.target_repo` é o
slug do alvo `[E]`, e o layout não exige que o repo alvo tenha `.esteira/` algum.

**Consequência:** dois PRs, um ciclo. O PR do repo **alvo** carrega só o código; o
PR do **âncora** carrega o run e os artefatos. Quem revisa o código não vê o run —
e é por isso que o run declara a branch, que é o que costura os dois. Essa
costura deixa de depender de um campo opcional: `[P-2]` torna
`workspace.branch` obrigatória ao pousar em `runs/` — regra do layout, cobrada
sobre a própria evidência que motivou a emenda.

**Custo da alternativa** (run no repo alvo): o `.esteira/` do âncora deixa de ser
o histórico inteiro do ciclo, e a frase "a ordem lexicográfica de `runs/` é o
histórico" passa a ser verdadeira só por repo — que é o mesmo que ser falsa.

### `[P-5]` Quem cria o `esteira.json`

**Decisão: `esteira init` é comando novo e NÃO é deste item.** Esta spec fixa o
**nome, o conteúdo e a versão** do arquivo (seção 7); quem o **cria** é o item
`wi-esteira4-solto-automaticas`, que é onde a superfície de execução das skills
soltas nasce.

Enquanto esse item não existir, o arquivo é escrito à mão — e isso não é
provisório envergonhado: `esteira.json` é **config de repo com autor humano**,
exatamente como `review-policy.json` já é hoje `[E]`, e a seção 6 já o classifica
assim.

**Custo da alternativa** (especificar o comando aqui): dois itens da mesma leva
passariam a declarar a mesma superfície — e a sequência de merge do plano põe o
modo solto **depois** deste item, então o comando especificado aqui chegaria ao
código por outro item de qualquer jeito, com duas descrições para reconciliar.

### `[P-6]` O endereço do worktree por card — fechado em 09/08

**Decisão: `local/worktrees.json`, com chave `<work_item_id>` → caminho do
worktree nesta máquina. Zona LOCAL, não versionada.**

O problema medido: `local/repos.json` mapeia **slug → um caminho** (o checkout do
repo nesta máquina); `workspace.worktree_path` é sanitizado para `null` por
`[P-2]` antes de pousar em `runs/`; e, medido em disco, **0 dos 64 runs** do
outbox preenchem esse campo. O único leitor no app hoje é
`src/main/esteira-dispatch.ts:120`. Depois da sanitização, o endereço do worktree
de um card não existia em lugar nenhum que sobrevivesse ao run — e "worktree por
card" `[D]` é o que permite dois itens do mesmo plano correrem ao mesmo tempo sem
se pisar.

**A fronteira, escrita para ninguém a atravessar depois:** este arquivo é da
máquina e **fica na máquina**. Ele resolve "onde, neste PC, mora o worktree do
card X" — e só. `C:\Users\xansd\…` não significa nada no PC de outra pessoa;
versioná-lo seria a fronteira da seção 2 deixando de ser fronteira.

**O que sustenta a delegação, então, não é este arquivo — é o `ciclos/`
versionado `[D-09/08]`.** Quem recebe o trabalho clona o repo e recebe o histórico
inteiro do ciclo: os runs, os planos, os artefatos, o estado derivado deles. O que
ele precisa fazer na própria máquina é declarar **onde as coisas ficam nela** —
`esteira repo add <slug> <caminho>`, uma vez —, e a esteira segue de onde parou. O
que viaja é contrato (**slug** e **branch**); o que não viaja é topologia de
disco. É exatamente essa separação que faz o trabalho ser **delegável** em vez de
preso à máquina de quem começou.

**Custo da alternativa** (versionar o mapa de worktrees, ou derivar o caminho por
convenção a partir do `work_item_id`): o primeiro põe caminho absoluto de máquina
no PR de todo mundo, inclusive no espelho público; o segundo obriga toda máquina a
adotar a mesma raiz de checkout — e quebra em silêncio na primeira que não adotar.

**Quem implementa:** não é este item. O leitor de `local/**` nasce no
`wi-esteira4-solto-automaticas`, junto do `esteira init` e do `esteira repo add`
(`[P-5]`); o **motor de execução** (plano `pln-esteira4-motor-de-execucao`) é o
consumidor, porque é ele que abre worktree por card.

---

## 9. O que este item toca no código, e o que não toca

| Componente | Este item… | Por quê |
|---|---|---|
| Contrato v1 (`esteira-result.schema.json`) | **não muda** | o schema diz o que um result **contém**; o layout diz onde ele **mora**. Misturar as duas perguntas faria uma mudança de pasta virar mudança de contrato |
| `tools/read_input.py` (fork 3.0.0) | **é substituído** por um leitor que deriva | é o único ponto do fork que exige um arquivo que alguém escreveu. A substituição é do item `wi-esteira4-solto-automaticas` |
| `tools/emit_result.py` | **muda só o destino** | continua sendo a única porta de saída; passa a escrever em `runs/`, com o nome da seção 4 e a sanitização de `[P-2]` |
| `src/main/esteira-result-watcher.ts` `[E]` | **muda o caminho**, não aqui | hoje monta `<stateRoot>/<repo>/<card>/<fase>`; passa a ler o canal versionado quando o app virar skill-adaptador |
| `.esteira/review-policy.json` | **não muda** | já mora na raiz e já tem dono humano — a zona de config nasce dele |
| `.esteira/` da 2.1.0 (as 5 pastas de fase) | **é congelado**, não migrado — e **quem move é outro item** | reescrever handoff antigo no formato novo é inventar fato que ninguém declarou. O movimento para `_legado-2x/` é do item `wi-esteira4-aposentar-21` |
| Motor da fila / catálogo das seis fases | **é consumidor** | especificado pelo plano irmão `pln-esteira4-catalogo-e-grafo` |

### O que este PR materializa

Esta spec não é só texto: o PR já cria a zona versionada mínima —
`esteira.json`, o `.gitignore` de `local/`, e os dois artefatos da fase Design
deste item movidos de `.esteira/design/<wi>/` (layout 2.1.0) para
`ciclos/dsc-15a7e7f5-fbb/itens/wi-esteira4-layout-esteira-dir/design/`. É a
promessa que a nota do Design deixou para a fase Implementar cumprir, e é o que
dá ao teste da seção 10 uma árvore real para conferir.

O que o PR **não** faz: mover as cinco pastas da 2.1.0 (item
`wi-esteira4-aposentar-21`), escrever o leitor (item `wi-esteira4-solto-*`) e
tocar o `emit_result.py` do fork (item `wi-esteira4-validador-que-viaja`).

---

## 10. Como este layout se verifica

Um layout que só existe em prosa volta a divergir do disco na primeira semana. O
que dá para pinar mecanicamente está em `tests/esteiraLayoutCanalV2.test.ts`:

- **o padrão de nome de run** é lido **deste documento** (seção 4) e aplicado aos
  exemplos que casam e aos que não casam, também lidos daqui. Editar a spec e
  quebrar os próprios exemplos derruba o teste;
- **a árvore materializada** obedece à seção 3: `esteira.json` com
  `layout_version: 2`, `.gitignore` com `local/`, e os artefatos do Design no
  caminho de quatro segmentos;
- **as evidências `[E]` que a spec cita** continuam verdadeiras: a raiz de estado
  da 2.x ainda é `~/.claude/esteira-state` e o `review-policy.json` ainda está na
  raiz de `.esteira/`. Se alguém mudar o código, o teste avisa que **a spec
  envelheceu** — em vez de a spec seguir afirmando o que não é mais verdade.

O que o teste **não** prova, e por isso é gate de gente: se as três zonas são as
certas, e se as cinco decisões da seção 8 são as que o dono quer. Isso se responde
na Validar, com ele.

**Respondido em 2026-08-09 — ✅ as três zonas ratificadas, as cinco decisões
ratificadas, e o `[P-6]` fechado.** O critério de aceite do layout — "um PR do
mesmo ciclo mostra só linhas novas" (seção 6) — foi conferido no próprio diff
desta branch contra `staging`: **9 arquivos, +1751, zero deleções**. Os três runs
já pousados em `runs/` têm timestamp com milissegundos, `workspace.branch`
preenchida e os três campos de `[P-2]` sanitizados; o
`esteira-result.schema.json` não aparece no diff, honrando a promessa da seção 9.
