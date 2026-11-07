---
demanda: mindscape-homologacao-v1
titulo: Mindscape de homologação V1 — os dois rigs da factory e o painel de métricas dentro do Donel
cliente: Alexandre Lentz (dono do produto da factory de homologação e usuário diário do Donel Dev)
responsavel: Claude (lugar Dev "Mindscape de homologação V1 (plano)"), aberto pelo Líder único
canal-slack: "não existe — ferramenta pessoal, sem Slack"
taskdex: []  # ferramenta pessoal, sem card; a tarefa vive no Oráculo (t-9c8d319a)
origem: >-
  pedido do dono via Líder, 07/11: "Não vamos ligar as homologações enquanto não tivermos a versão 1 do
  mindscape de homologação pronto" e "eu serei o dono do produto, fazendo ajustes onde necessário. (Logo,
  preciso de métricas)"
criado: 2026-11-07
status: aguardando-decisoes-do-dono
---

# Mindscape de homologação V1

## Destino

As homologações só ligam quando o Alexandre abre o Donel, entra no quadro Homologação e vê, numa tela
só, **os dois rigs da factory** (Rig 1, que homologa apps, e Rig 2, que homologa esteiras de agentes),
**as cadeiras de cada rig**, **quem passa trabalho para quem**, **o estado vivo de cada cadeira** e
**os números da factory**, cada um dizendo se foi medido, estimado ou se ainda não tem fonte. Com isso,
ele acompanha a factory como dono do produto e ajusta o que precisar, sem estar no caminho de nenhum
selo.

## Notas

- **Duas regras do pedido valem para todas as fatias.**
  1. **Nenhuma pessoa no caminho do selo.** Nada na V1 pede clique, aceite ou atesto para uma rodada
     andar ou um selo sair. O Mindscape é **espelho**: ele lê e mostra, nunca libera.
  2. **Nada que vire gargalo das pessoas.** A V1 não cria aviso novo, fila nova nem pergunta nova ao
     dono. O que espera por gente aparece como número (o tempo que o time espera a factory), não como
     tarefa para alguém.
- **Material de base**, lido em 07/11 na VPS Homologações (`/root/pesquisas-rigs-homologacao/`):
  - os protótipos `prototipos/topologia.html`, `numeros.html` e `ficha.html`, com o `decisao.md`
    ainda em `pendente-de-escolha`; os prints estão em
    [`docs/prototipos/mindscape-homologacao/`](../prototipos/mindscape-homologacao/);
  - `explicador/estrutura.html` e `propostas/C-rig-adversarial.md`, a proposta C ("a Arena"), que lidera
    o hillclimbing com nota 71,7;
  - `metricas/metricas.json`, no formato `metricas-factory@1`, gerado às 16:48 UTC de 07/11 pelo "Dev ·
    métricas da factory" (tarefa t-8ba24d7d). Há uma cópia em
    [`metricas-exemplo-2026-11-07.json`](../prototipos/mindscape-homologacao/metricas-exemplo-2026-11-07.json).
- **Forma escolhida para a V1.** O dono ainda não escolheu entre os três protótipos. A interpretação
  confirmada com o Líder é: V1 = **topologia** (o quadro das cadeiras) + **números** (o painel). A
  **ficha do selo** fica para a V2 (ver Fora de escopo).
- **O que já existe e é reaproveitado** (`origin/staging` 3ee4ccf):
  - a lente **Cadeiras** do Mindscape (PR #278): `src/shared/mindscape/chairs.ts` deriva as cadeiras
    dos papéis do quadro e é pura, e `MindscapeChairs.tsx` desenha os nós, as setas, a faixa
    problema/atenção/bem/sem sinal e a gaveta;
  - a **tela de cadeira B1** (#282, #286 em revisão), que não muda nesta V1;
  - a **leitura de lugar remoto por ssh** da "Saúde das VPS" (`src/main/health/remote-health-service.ts`):
    um ssh curto por minuto, com timeout; se o lugar cai, vira "sem sinal" sem travar o main;
  - o **Oráculo**: tarefas por lugar, com risco e estado.
- **As cadeiras do Rig 1 já são lugares do Donel.** O Dalton tem um lugar ("Dalton · software
  factory"), e o laço da VPS abre o Conferente técnico **pelo Donel** com o papel `homol-conferente`
  (log de 07/11 na tarefa t-48b56f6a). Os papéis `homol-homologador`, `homol-correcao` e
  `homol-coordenador` também existem. Por isso o estado vivo de uma cadeira de agente vem dos lugares
  do quadro Homologação, que o app já conhece. Só o que não é sessão vem de arquivo: a forma dos rigs,
  as cadeiras de código e as filas.
- **A fatia 04 das cadeiras ("rig e pods guardados", `mindscape.json` v6) não bloqueia esta V1.**
  Nesta V1 a forma dos rigs vem de um arquivo do próprio rig, e o Donel só espelha (decisão D1). Por
  isso o `mindscape.json` não muda e o `schemaVersion` fica em 5. As decisões 02 e 03 do PDA das
  cadeiras seguem com o dono e valem para quando ele quiser desenhar rigs no quadro (V2).
- **Regras do projeto que mandam:**
  - toda integração com ferramenta da Seazone é **opcional**, desligada por padrão, com caminho e
    nome vindos da config e nada fixo no core;
  - fixtures genéricas;
  - testes quase zero: entra só o parser dos dois contratos, porque um número "estimado" que aparece
    como "medido" engana o dono sem ele perceber;
  - toda fatia visível ganha item em `patchnotes/notes.ts`;
  - `npm run verify` verde em cada PR.

## O que o dono vê

Mindscape → quadro **Homologação** → aba **Cadeiras**. O jeito é o do print
[`1-topologia.png`](../prototipos/mindscape-homologacao/1-topologia.png), com os dados reais:

1. **Duas molduras de rig**, lado a lado:
   - Rig 1 · Fábrica padrão (apps);
   - Rig 2 · esteiras de agentes, ainda sem nome escolhido ("Arena" vem da proposta C).

   Cada moldura tem o nome, a missão numa linha e os **pods** como subgrupos com título (Rodada,
   Entrega, Banca, Ataque, Treino). Entre as duas fica "Fora das duas cadeias", com o Revisor e o Dev de
   ferramenta.
2. **Cadeiras como nós redondos**, com nome grande e "N sentados". O tipo da cadeira aparece em
   **texto**, e a cor só reforça:
   - cadeira de agente: borda cheia;
   - cadeira de código (Portão, Julgamento): borda tracejada e a palavra "código";
   - fila: borda pontilhada e a palavra "fila".

   Uma cadeira que ainda não existe aparece como "vaga, ninguém sentado". É o caso do Rig 2 hoje.
3. **Setas de quem passa trabalho para quem**, cada uma com o tipo escrito na legenda: *delega*,
   *verifica*, *escala a você* e *rotina acorda*. A seta "escala a você" chega a um nó "Você", que
   **só recebe**. Nenhuma seta sai de "Você" para dentro do caminho do selo.
4. **O estado vivo de cada cadeira**:
   - a borda pela saúde (problema · atenção · bem · sem sinal) e a faixa do topo com as quatro
     contagens, que destaca as cadeiras quando clicada (como já faz a lente);
   - uma linha embaixo do nó com o que ela faz agora, por exemplo "3 itens sem verificar depois de 3
     tentativas".
5. **A gaveta de cadeira** (print [`1b-topologia-gaveta.png`](../prototipos/mindscape-homologacao/1b-topologia-gaveta.png)):
   - estado e onde parou;
   - quem está sentado, com modelo e esforço;
   - as tarefas do Oráculo presas à cadeira;
   - "recebe de" e "manda para".
6. **Painel "Números da factory"**, aberto por um botão na faixa do topo da lente. O jeito é o do print
   [`2-numeros.png`](../prototipos/mindscape-homologacao/2-numeros.png), só com números reais:
   - os números do arquivo, um cartão por número, com nome, valor em texto, a pergunta que ele
     responde e a etiqueta de origem (**medido**, **estimado**, **sem fonte**);
   - a marca **trava** nos números que têm de ficar em zero ou subir;
   - "de onde veio" recolhível em cada cartão;
   - no topo, "atualizado às 16:48" ou "parado desde 16:48" e as fontes que ainda não existem ("ninguém
     grava ainda: tokens.jsonl, revisoes.jsonl…").

   O Rig 2 aparece como "ainda não rodou". **Nenhum número de exemplo entra.**

O que a V1 **não** mostra:
- o "seu atesto" da ficha do selo (D2);
- botões que liberam alguma coisa;
- o post-it "esperando você" com 27 itens do protótipo. Ele vira só um número: quantas tarefas de
  risco alto do quadro Homologação esperam o dono, com um clique que abre o Oráculo já filtrado (fatia
  4). Não cria aviso nem tarefa.

## Decisões do dono

Cada uma tem uma pergunta, as opções e uma recomendação. Com a recomendação aceita, as fatias abaixo
andam sem mais nenhuma pergunta.

### D1 — Quem desenha a forma dos rigs: o próprio rig ou você no quadro?

- **Pergunta.** A lista de cadeiras, pods e setas de cada rig vem de um arquivo que a factory mantém
  junto do código dela, ou você desenha isso à mão no Mindscape?
- **Opção A, recomendada: o rig se descreve.** A factory mantém um arquivo com a própria forma (o
  `rigs.json`, contrato abaixo). O Donel lê e mostra. Para mudar o desenho, você pede a mudança à
  factory, como qualquer outro ajuste de produto, e ela fica registrada e revisada. A V1 sai sem
  esperar as decisões da fatia 04 das cadeiras. O desenho também nunca mente sobre o que roda: se a
  cadeira não está no arquivo, ela não existe na factory.
- **Opção B: você desenha no quadro.** Você arrasta molduras de rig e pod e põe as cadeiras dentro.
  Para isso a fatia 04 das cadeiras precisa vir antes, junto com as suas decisões 02 e 03 daquele plano
  (o que é cadeira guardada; se você posiciona a cadeira ou só o pod). A V1 atrasa e o desenho pode
  divergir do que a factory realmente roda.

### D2 — O selo sai sem ninguém: tirar o "seu atesto" e o revisor de fora da proposta C?

- **Pergunta.** A proposta C, que lidera, põe duas pessoas no caminho do selo: o **seu atesto** para o
  selo pleno e o **Vitor Rezende** como revisor de fora do selo do Dalton. Você disse "nada de humano
  no caminho do selo". Elas saem?
- **Opção A, recomendada: saem.** O selo é emitido pelo **Portão** (código, com os números) e
  conferido pelo **Revisor**, um agente fora das duas cadeias. Você **vê** cada selo no Mindscape e nos
  números e pode derrubá-lo depois, mas não precisa aprovar antes. A independência que o revisor de
  fora daria vem dos defeitos plantados (a factory precisa achar os defeitos que se plantam nela) e do
  "passou falso" como trava.
- **Opção B: ficam.** O selo pleno espera você, e o do Dalton espera um terceiro. Isso contraria a
  regra 1 desta V1 e cria a fila de gente que a regra 2 proíbe.
- **Consequência.** Isso muda a proposta C, então a Pesquisa do hillclimbing (tarefa t-2b51f9df)
  precisa saber. O Líder repassa. A V1 do Mindscape não depende da resposta: ela só não desenha o "seu
  atesto".

### D3 — Ajustar metas e travas pelo próprio painel já na V1?

- **Pergunta.** Como dono do produto, você quer mudar metas e limites (por exemplo "passou falso tem de
  ser zero" ou "1 selo por semana") direto no painel, ou só ver e pedir?
- **Opção A, recomendada: na V1 você só vê.** Para ajustar, você pede pela conversa e a factory muda as
  metas no arquivo dela, com registro. Isso evita dar ao Donel o poder de escrever na factory, que
  seria a primeira escrita do app numa VPS fora do perímetro de contas. Editar pelo painel vira a V2,
  quando você já tiver usado os números por alguns dias.
- **Opção B: editar já na V1.** Exige um contrato de escrita, um registro de quem mudou o quê e um
  cuidado para uma meta frouxa não derrubar uma trava. Atrasa a V1 em pelo menos uma fatia.

### D4 — O que conta como "V1 pronta" para ligar as homologações?

- **Pergunta.** Você liga as homologações quando as fatias 1 a 4 estiverem no alfa, ou já com uma parte
  delas?
- **Opção A, recomendada: as quatro fatias no alfa, vistas por você uma vez com dados reais.** A
  conferência é o roteiro da fatia 5 (dez minutos, sem nada para aprovar).
- **Opção B: só os números (fatia 1).** Você liga com o painel e o quadro vem depois. É mais rápido,
  mas você não vê qual cadeira está travada enquanto a factory roda.

## Contrato de leitura

Este contrato diz **o que o Mindscape lê**, não como a factory produz. O Líder o repassa ao Dev das
métricas e ao Dev de ferramenta da factory para os dois lados baterem.

### Regras gerais, para os dois arquivos

- **Onde.** Os dois arquivos ficam num lugar remoto do Donel, a VPS Homologações. O caminho vem da
  config do app, numa chave opcional e desligada por padrão:

  ```json
  "homologacao": {
    "lugar": "Homologações",
    "metricas": "/root/pesquisas-rigs-homologacao/metricas/metricas.json",
    "rigs": "/root/esteira-homologacao/rigs.json",
    "quadro": "Homologação"
  }
  ```

  O caminho do `rigs.json` é sugestão: quem o escreve decide onde ele mora. Nada disso fica fixo no
  código.
- **Como o Donel lê.** Do mesmo jeito que a Saúde das VPS: um `ssh … cat <arquivo>` curto, com timeout
  de 8 s, a cada minuto e ao abrir a lente. O main nunca espera essa leitura. **Só lê**: o Donel não
  escreve nada na VPS por este caminho.
- **Versão.** O campo `formato` vale `"<nome>@<maior>"`. O Donel aceita o maior que conhece (1).
  Quando chega um maior desconhecido, ele mostra "formato <x>: este Donel lê até @1" e não mostra
  nenhum número. Acrescentar campo **não** sobe o maior. Mudar o sentido de um campo, renomeá-lo ou
  tirá-lo **sobe**.
- **Campo desconhecido** é ignorado. **Campo opcional ausente** esconde aquele pedaço. **Campo
  obrigatório ausente ou de tipo errado** esconde aquele item e mostra "item fora do contrato: <id>". O
  resto continua aparecendo.
- **O Donel não recalcula nada.** Ele mostra o `texto` que vem pronto e o `status` que vem pronto. Quem
  decide se uma trava rompeu é a factory, em código. O Donel nunca formata um `valor` por conta
  própria nem deduz origem.
- **Atualidade.** Quando `geradoEm` tem mais de 2 h (métricas) ou mais de 15 min (rigs), aparece
  "parado desde HH:MM", e as cadeiras de código e de fila viram "sem sinal". Quando o ssh falha, aparece
  "sem sinal desde HH:MM" com a última leitura boa.

### `metricas.json` — formato `metricas-factory@1`

O formato é o que o gerador já produz em 07/11. O Donel lê:

| Campo | Tipo | Obrigatório | Uso no painel |
|---|---|---|---|
| `formato` | `"metricas-factory@1"` | sim | versão (regras acima) |
| `geradoEm` | data ISO 8601 | sim | "atualizado às" / "parado desde" |
| `fontesLidas[]` | lista | sim | rodapé "fontes": `existe: false` vira "ninguém grava ainda: `<id>`" |
| `fontesLidas[].id`, `.existe`, `.registros` | texto, sim/não, número ou nulo | sim | idem |
| `metricas[]` | lista, na ordem de exibição | sim | um cartão por item |
| `metricas[].id` | texto estável | sim | chave do cartão; nunca muda de sentido |
| `metricas[].nome` | texto | sim | título do cartão |
| `metricas[].pergunta` | texto | sim | a pergunta que o número responde |
| `metricas[].status` | `"medido"`, `"estimado"` ou `"sem-fonte"` | sim | etiqueta de origem; outro valor aparece como "sem fonte" com "origem desconhecida" |
| `metricas[].texto` | texto | sim | o valor mostrado, exatamente como veio |
| `metricas[].valor` | número ou nulo | não | só para a série; o painel não o formata |
| `metricas[].unidade` | texto | não | linha embaixo do valor |
| `metricas[].origem` | texto | sim | "de onde veio", recolhível |
| `metricas[].trava` | sim/não | não | marca **trava** |
| `metricas[].soMostrado` | sim/não | não | marca "só mostrado: sem meta" |
| `metricas[].serie[]` | `{ semana: "DD/MM", valor: número }` | não | linha das semanas no cartão |
| `metricas[].fontes[]` | caminhos | não | dentro de "de onde veio" |
| `metricas[].detalhe` | objeto livre | não | **ignorado na V1** |

**Acréscimos pedidos ao gerador**, todos opcionais e sem subir a versão:

| Campo | Tipo | Para quê |
|---|---|---|
| `metricas[].rig` | `"rig1"`, `"rig2"` ou ausente (factory toda) | agrupar os cartões por rig, como no protótipo; ausente vai para "Factory" |
| `metricas[].menorMelhor` | sim/não | a seta de tendência fica verde quando cai (retrabalho, passou falso, espera) |
| `metricas[].meta` | `{ texto, valor? }` | "meta: 1 por semana" embaixo do valor; quem muda a meta é a factory (D3) |
| `metricas[].travaRompida` | sim/não | calculado pela factory; quando `true`, o cartão e a faixa do quadro ficam em **problema** (fatia 4) |

Pendência para o gerador: o rótulo "sem fonte" do `metricas.html` precisa sair no JSON como
`"sem-fonte"`. Nenhum item de 07/11 usa esse status, então não deu para conferir o valor que o
gerador escreve.

### `rigs.json` — formato `rigs-factory@1` (novo, proposto à factory)

É a forma dos dois rigs, mais o estado das cadeiras que **não** são sessões do Donel. A factory
regrava o arquivo a cada volta do laço (5 min). O arquivo é de quem mantém a factory, e o Donel só lê.

```json
{
  "formato": "rigs-factory@1",
  "geradoEm": "2026-11-07T16:50:00Z",
  "rigs": [
    {
      "id": "rig1",
      "nome": "Fábrica padrão",
      "missao": "Homologa apps internos até o selo",
      "pods": [
        { "id": "rodada", "nome": "Rodada", "missao": "varre, confere, julga, corrige",
          "cadeiras": ["dalton", "homologador", "conferente", "julgamento", "correcao"] },
        { "id": "entrega", "nome": "Entrega", "cadeiras": ["sre"] }
      ]
    },
    { "id": "rig2", "nome": "Esteiras de agentes", "missao": "Ainda não rodou", "pods": [] }
  ],
  "foraDosRigs": ["revisor", "dev-ferramenta"],
  "cadeiras": [
    { "id": "conferente", "nome": "Conferente técnico", "tipo": "agente", "papel": "homol-conferente" },
    { "id": "julgamento", "nome": "Julgamento", "tipo": "codigo",
      "estado": { "saude": "bem", "linha": "12 itens segurando o selo", "desde": "2026-11-07T16:40:00Z" } },
    { "id": "fila-apps", "nome": "Fila de apps", "tipo": "fila",
      "estado": { "saude": "atencao", "linha": "55 abertas, 1 rodada em andamento" } }
  ],
  "ligacoes": [
    { "de": "homologador", "para": "conferente", "tipo": "verifica" },
    { "de": "sre", "para": "dono", "tipo": "escala", "rotulo": "mescla na produção" }
  ]
}
```

| Campo | Regra |
|---|---|
| `rigs[]` | 1 ou 2 itens. `id`, `nome` obrigatórios; `missao` opcional. A ordem é a da tela, da esquerda para a direita. |
| `rigs[].pods[]` | `id`, `nome` e `cadeiras` (ids) obrigatórios. Um pod sem cadeiras aparece como moldura vazia. |
| `foraDosRigs[]` | ids das cadeiras que ficam entre os rigs ("fora das duas cadeias"). |
| `cadeiras[]` | `id`, `nome` e `tipo` (`"agente"`, `"codigo"` ou `"fila"`) obrigatórios. **Não existe tipo para pessoa.** "Você" é o destino especial `"dono"`, que só recebe setas. |
| `cadeiras[].papel` | Só em `agente`: o id do papel do Donel. Os lugares do quadro Homologação com esse papel são os "sentados". Sem `papel`, a cadeira fica "vaga". |
| `cadeiras[].modelo` | Opcional, texto. Vai para "combinado" na gaveta; o "visto" vem do lugar sentado. |
| `cadeiras[].estado` | Só em `codigo` e `fila`: `saude` (`"problema"`, `"atencao"`, `"bem"` ou `"sem-sinal"`) obrigatório; `linha` (até 60 caracteres) e `desde` opcionais. Em cadeira de agente o campo é **ignorado**: o estado vivo vem do Donel. |
| `ligacoes[]` | `de` e `para` (ids de cadeira ou `"dono"`) e `tipo` (`"delega"`, `"verifica"`, `"escala"` ou `"acorda"`) obrigatórios; `rotulo` opcional. **`de: "dono"` é recusado** e aparece como "ligação fora do contrato", porque o dono não fica no caminho de nada. |

**O estado vivo de uma cadeira de agente** é o da lente Cadeiras de hoje (`chairs.ts`), filtrado pelo
`papel`:
- os sentados são os lugares do quadro Homologação com esse papel e a aba aberta;
- erro ou limite de uso conta como problema, "precisa de você" como atenção, sentado e quieto como
  bem, e ninguém sentado como sem sinal;
- "onde parou" é a nota mais nova do lugar;
- as tarefas são as do Oráculo cujo dono é um desses lugares.

Um lugar com papel que não está em nenhuma cadeira do arquivo aparece numa cadeira "fora do desenho",
sem rig. Assim, nada que roda some da tela.

## Fatias

Cada fatia é um PR contra `staging`:
- com `npm run verify` verde;
- com item em `patchnotes/notes.ts`;
- com um print lado a lado com o protótipo em `docs/prototipos/mindscape-homologacao/`;
- **sem mexer** em `mindscape.json`, no ledger, em `src/main/accounts/` nem na tela B1.

As fatias 2, 3 e 4 mexem nos mesmos arquivos da lente e por isso andam em sequência, numa frente só. A
fatia 1 pode correr em paralelo com a 2.

| # | Fatia | O que o dono ganha | Pronto quando (dá para conferir) | Depende de |
|---|---|---|---|---|
| 1 | **Números da factory** | Painel com os números reais da factory, cada um com medido, estimado ou sem fonte | (a) com a chave `homologacao` na config, o painel mostra os **8** números do `metricas.json` da VPS, com o **mesmo `texto`** do `metricas.html` gerado na mesma hora; (b) "Defeitos plantados" e "Passou falso" levam a marca trava; "Tokens" leva "só mostrado"; (c) "atualizado às HH:MM" bate com o `geradoEm`; (d) com o arquivo renomeado na VPS, o painel diz "sem sinal desde HH:MM" em até 1 min, e o resto do app segue normal; (e) um `formato` `@2` falso mostra "formato metricas-factory@2: este Donel lê até @1"; (f) sem a chave na config, nada aparece e nenhum ssh sai; (g) **teste** do parser: status desconhecido nunca vira "medido", item fora do contrato some sem derrubar os outros, maior desconhecido é recusado | — |
| 2 | **Os dois rigs no quadro** | O desenho dos rigs, pods, cadeiras e setas, tirado do arquivo da factory | (a) no quadro Homologação → Cadeiras aparecem duas molduras de rig com os pods e as cadeiras do `rigs.json`, e o Rig 2 "ainda não rodou"; (b) cada seta tem o tipo na legenda, e nenhuma sai de "Você"; (c) cadeira de código e fila se distinguem por texto, sem depender da cor; (d) o quadro Donel Dev → Cadeiras continua igual ao de hoje (um rig = o quadro); (e) sem `rigs.json`, o quadro Homologação cai na lente de hoje, com o aviso "sem a forma dos rigs"; (f) o desenho e os post-its do dono continuam no lugar; (g) **teste** do parser do `rigs.json`: `de: "dono"` é recusado e cadeira sem `tipo` some sem derrubar as outras | D1 |
| 3 | **Estado vivo das cadeiras** | Cada cadeira mostra quem está sentado, a saúde e o que faz agora | (a) quando o laço abre um Conferente pelo Donel, a cadeira Conferente passa a "1 sentado" e **bem** em até 5 s; quando a aba fecha, volta a "sem sinal"; (b) um lugar com pedido de permissão aberto põe a cadeira em **atenção**, e a faixa do topo conta; (c) a cadeira Julgamento mostra a `linha` do arquivo, e com o arquivo parado há mais de 15 min vira "sem sinal"; (d) a gaveta mostra sentados (modelo e esforço), onde parou, tarefas do Oráculo presas, "recebe de" e "manda para"; (e) um lugar de papel `homol-*` fora do arquivo aparece em "fora do desenho" | 2 |
| 4 | **Travas e o que espera por você** | A faixa do quadro acusa trava rompida, e você vê quanto do trabalho espera por gente | (a) com `travaRompida: true` num número, o cartão e a faixa do quadro mostram **problema** com o nome da trava; (b) um número "Esperando você" no topo conta as tarefas de risco alto do quadro Homologação no estado entregue, e o clique abre o Oráculo filtrado; **não cria aviso nem tarefa**; (c) "Tempo que o time espera a factory" fica em destaque na faixa, como sinal de gargalo; (d) nenhum botão da V1 muda estado da factory (conferido por busca no diff: o painel não chama nenhum canal de escrita) | 1, 3 |
| 5 | **Conferência da V1 com o dono** (sem código) | O roteiro para você olhar uma vez e ligar as homologações | Uma carta no Oráculo com: os quatro prints com dados reais lado a lado com os protótipos; o roteiro de dez minutos (abrir o quadro, abrir uma gaveta, abrir os números, comparar um número com o `metricas.html`); e a lista do que ficou fora. Você lê e decide ligar. **Não há aprovação de selo nem de rodada nesse passo.** | 1–4, D4 |

Fora o que está escrito em cada fatia, a V1 não traz nenhum teste. Tela, layout e texto o dono confere
no alfa.

## Riscos

| Risco | Contenção |
|---|---|
| O gerador muda um campo sem subir a versão, e o painel mostra número errado | O contrato fica neste arquivo; o parser rejeita o que não reconhece; um teste guarda as três regras de origem |
| A factory não chega a escrever o `rigs.json` | A fatia 1 sai sem ele; a fatia 2 cai na lente de hoje com o aviso "sem a forma dos rigs" |
| A chave `homologacao` some quando um canal mais antigo (beta ou stable) grava a config | Risco já conhecido do `userData` compartilhado ("sanitize com passthrough"). O painel some, o dono percebe e a chave volta; nada da factory é afetado |
| O ssh na VPS Homologações pede a verificação do Tailscale | O Donel usa o mesmo destino ssh do lugar remoto "Homologações", que já abre sessões lá; se ele cair, aparece "sem sinal" e nada trava |
| O Rig 2 muda de forma no hillclimbing (Arena × Curador/Cartógrafo) | A forma é do arquivo (D1); o Donel não sabe de nome de cadeira |
| Ler o arquivo a cada minuto custa RAM ou rede na VPS | É um `cat` de ~17 KB por minuto, o mesmo custo da Saúde das VPS |

## Fora de escopo (V2 ou depois)

- **A ficha do selo** (`ficha.html`): a escada de níveis, a impressão digital, os gatilhos e a
  simulação de mudança. Entra quando a Arena emitir o primeiro selo.
- **Editar metas e travas pelo painel** (D3, opção B).
- **Desenhar rigs e pods no quadro** e guardá-los no `mindscape.json` v6: fatia 04 das cadeiras e as
  decisões 02 e 03 daquele plano.
- **A base comum** do protótipo (Oráculo, rotinas, vagas e memória, contas, impressão digital, espelho)
  como faixa: a memória da VPS já aparece na Saúde das VPS.
- **O histórico** (`metricas/historico/`) além da série que vem no próprio arquivo.
- O painel no celular, sentar alguém ou acordar uma cadeira pelo quadro, e qualquer escrita do Donel
  na VPS da factory.
