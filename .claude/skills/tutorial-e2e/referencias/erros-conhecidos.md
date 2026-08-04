# Erros que já se repetiram aqui

Registro vivo. Leia antes de investigar um achado novo — a chance de já estar
nesta lista é alta. Acrescente o que aparecer, com a correção estrutural.

---

## No app (achados dos prints)

### 1. A mesma palavra errada, em dois lugares

**Sintoma:** "em andamento" para um estado que não começou. Apareceu duas
vezes: no bloco da trava e, depois de corrigido lá, na lista de fases.

**Causa:** a correção parou na frase onde o defeito apareceu, em vez de descer
até a função que produz o texto.

**Correção:** o vocabulário mora numa função só (`phaseLine`, `lockView`), que
recebe o estado inteiro e decide a palavra. Corrigir na frase garante a
terceira aparição.

**Terceira aparição (captura do B2, print 16) — e ela veio.** A MESMA tela
dizia duas coisas incompatíveis sobre o MESMO item, com quatro linhas de
distância:

```
Planos e itens …  Medir onde o lote para · spike · open · sem repo alvo
Repo alvo:        donel-dev — repo herdado do card
```

A herança de repo tinha sido implementada só dentro do disparo (`dispatchView`);
a lista de itens era montada **à mão, no JSX**, e não sabia dela. Quem lê a
lista conclui que o item não tem alvo; quem lê o disparo conclui que tem. Junto
vieram dois vizinhos do mesmo vício: o título contava "1 plano(s)" e a lista não
mostrava plano nenhum, e o item travado não se distinguia do livre enquanto a
razão do bloqueio mandava "libere a trava" sem dizer qual.

**Correção estrutural:** `itemRepoOf()` e `cardContent()` em `esteiraView.ts` —
a linha da lista e a linha do disparo nascem da mesma função, e o componente
não monta frase nenhuma. Teste: `tests/esteiraCardContent.test.ts`, com um caso
que cobra explicitamente que as duas concordam.

**A regra que sai daqui:** *frase montada dentro do JSX é candidata a
divergir.* Se o texto descreve estado, ele nasce na camada pura — mesmo quando
é "só uma linha de lista".

### 2. Estado que só sai por gesto de terceiro

**Sintoma:** card continuava travado depois de a fase concluir.

**Causa:** o app dependia da skill declarar `lock.released`. Skill que morre no
meio deixa o card preso para sempre — a *trava órfã* que a divergência D-V3
proibia, voltando por omissão em vez de por arquivo.

**Correção:** todo estado que prende precisa de uma saída que não dependa de
quem pode sumir. `phase.completed`/`phase.failed` liberam a trava no reducer; a
declaração da skill continua sendo a via normal, não a única.

### 3. Disparo que a tela oferece e o modelo não comporta

**Sintoma:** dá para disparar a fase "Plano" num card que não tem plano
nenhum; o `run-input.json` sai com `plan_id: null`.

**Causa:** o seletor de fase não olha o estado do card.

**Correção (batch B2 da spec 010):** o catálogo de fases passou a ser lido
contra o card em `dispatchView()` (`esteiraView.ts`), e o disparo escolhe o
**assunto** — o discovery, um plano ou um item. Fase que o card não comporta
fica **visível e desabilitada, com a razão escrita**: sumir com a opção
pouparia pixel e faria a tela mentir por omissão, que é a mesma doença por
outra porta. O D-6 entrou no mesmo lugar: item `issue` sem repo alvo já
aparece recusado, com a frase, antes de o clique falhar.

**O que ficou como regra:** a decisão de "isto pode ser disparado?" mora numa
função só, compartilhada com o main pelo alcance da trava
(`store/lockChain.ts`) — a tela não pode oferecer o que `dispatchPhase` vai
recusar, nem esconder o que ele aceitaria.

### 3b. A mesma palavra errada, quarta aparição — agora com um fato por trás

**Sintoma:** o card dizia "Em andamento" enquanto o print seguinte, da MESMA
rodada, mostrava o comando parado no prompt. Ninguém tinha apertado nada.

**Causa:** o batch B1 ganhou um fato novo (`session.claimed` — o CLI devolveu o
id) e reaproveitou a palavra que já existia. O fato é real, mas diz outra coisa:
**a aba abriu**. Se o Enter é gesto humano, o app nunca sabe se a fase começou —
e a tela não pode afirmar o que o app não sabe.

**Correção:** um estado por fato (`LockState`: `running` / `session-open` /
`prepared`) numa função só (`lockStateOf`), e as três frases derivadas dele —
título do bloco, linha da lista de fases e razão do botão desabilitado. Antes,
essa terceira frase dizia "preparada" para um card cujo bloco dizia "Em
andamento": duas palavras, um estado, no mesmo print.

**A regra que sai daqui:** quando um fato novo chega, pergunte que palavra ele
merece. Reusar a palavra vizinha é como o vocabulário apodrece — e o teste não
pega, porque o teste repete a palavra que o código escolheu.

### 7. Etapa derivada que apaga o trabalho já feito

**Sintoma:** card com um item **concluído** e outro aberto aparecia como
"Planejado" — e, pior, a etapa dependia de QUAL item estava aberto: o mesmo
conjunto (um aberto, um fechado) dava "Planejado" num print e "Execução" no
outro, os dois se dizendo "calculada dos fatos".

**Causa:** `deriveStage` só reconhecia execução por item *em curso* ou item
*reaberto*. Item concluído sem ninguém reabrir não contava como "começou".

**Correção:** desfecho fechado (`everConcluded`) é prova de que a execução
aconteceu. Precedência hoje: todos fechados → Concluído; algum em curso **ou**
algum já concluído alguma vez → Execução; senão → Planejado. "Planejado" voltou
a significar só o que ele diz: existe plano e ninguém tocou em nada.

### 8. A tela prometendo o que ela mesma vai recusar

**Sintoma:** embaixo do item travado, "descartar é um gesto só, **sem
bloqueio**" — e o app recusando o descarte desse item na mesma tela, dois
centímetros acima.

**Causa:** `discardHint` só recebia o item. Quem sabia da trava era a recusa,
que morava noutra função (`GESTURE_REFUSAL_MESSAGE`). Promessa e recusa em
lugares diferentes divergem sempre.

**Correção:** `discardHint(item, lock)` — a mesma função decide as duas frases,
e a do caso travado **é** a constante da recusa, não uma cópia dela. Efeito
colateral bom: a tela avisa antes do clique, em vez de deixar o usuário
descobrir pelo erro.

### 9. Trava que não diz de que ela é

**Sintoma:** "Fase implementar, por uma skill, desde 04/08, 12:00" no topo do
card, com dois itens na tela. Qual dos dois? E, no rodapé, "Há uma fase
**preparada** neste **card**" para uma fase que a skill já tinha assumido, sobre
um **item** — duas palavras erradas na mesma frase.

**Causa:** a mesma de #1, nas duas pontas. `lockView` tinha `lock.subject` e não
o usava; a frase do rodapé estava escrita à mão dentro do componente, longe do
estado que ela descrevia.

**Correção:** `lockSubjectLabel(card, lock)` nomeia o assunto, `lockView` a usa,
e a frase do rodapé virou `dispatchHint(card)` — que reusa o título que
`lockView` já escolheu, para as duas nunca discordarem na mesma tela. Nada de
texto de estado dentro do `.tsx`.

### 10. Frase de estado cortada pela largura do card

**Sintoma (captura do B6, print 14):** a trilha dizia `discovery —
interrompida: a sessão terminou sem cor`, com barra de rolagem horizontal no
card. A palavra de estado aparecia; a explicação que a distingue de "falhou",
não.

**Causa:** `.trilhaState` com `flex: none; white-space: nowrap` — o texto
empurrava a linha para fora do card, e `.trilha` só tratava o overflow
vertical.

**Correção:** o texto de estado encolhe e quebra (`flex: 0 1 auto; min-width:
0`), e a trilha não rola na horizontal (`overflow: hidden auto`). **A regra:**
frase de estado é a informação da linha — cortá-la é a tela dizendo menos do
que sabe, e some justamente a parte que separa dois estados parecidos.

### 11. A mesma frase, duas vezes, a três linhas de distância

**Sintoma (captura do B6, print 19):** no painel de detalhe do `spike`
concluído, o fecho do ciclo aparecia como resumo do nó **e** de novo na seção
"Como este ciclo termina" — texto idêntico, adjacente. E, ao ocupar o resumo, o
fecho expulsava a meta do item: o painel deixava de dizer `spike · concluído ·
<repo> · criado pela skill` justamente no estado em que o item fecha.

**Causa:** `detailFor` usava `itemClosureLine(...) ?? itemMeta(...)` no resumo,
sem saber que o fecho já tinha seção própria logo abaixo.

**Correção:** o resumo é **sempre** a meta do item; o fecho fica só na seção
dele. Teste em `tests/esteiraMapView.test.ts` cobrando que os dois não sejam a
mesma string.

---

## Nomeados e NÃO corrigidos (a decisão é de produto)

### A. "Trabalhando" para uma sessão parada no prompt

**Sintoma (captura do B6, prints 10–13):** no cabeçalho do Modo Dev, `●
Trabalhando` ao lado do breadcrumb da fase — enquanto o painel direito, no
mesmo print, dizia "A aba está aberta com o comando da fase escrito; o app não
sabe se você já o enviou", e o terminal mostrava o comando parado no prompt.

**Causa:** é o semáforo de sessão (FR-010, spec 001), cujo estado inicial é
`working` por decisão documentada ("estado inicial otimista"). Ele só muda por
hook, e o único hook que tira de `working` fecha um TURNO — que nunca começou.

**Por que não corrigi aqui:** distinguir "palpite inicial" de "primeiro turno
rodando" exige mudar a máquina pura (`userPromptSubmit` refrescando
`stateEnteredAt`, hoje deliberadamente inalterado quando o estado não muda) ou
expor um campo novo pelo IPC — e depois decidir que **cor e palavra** o dot
recebe num estado que o design não desenhou. É contrato de outra spec mais
decisão de design; forçar aqui seria maquiar. **Fica como achado pendente.**

### 7. Veredito que sobrevive ao texto que o motivou

**Sintoma:** a lista de recusas do seed continuava na tela depois de o documento
ser corrigido — "campo obrigatório ausente — discovery.title" logo abaixo de uma
textarea onde `title` já estava escrito.

**Causa:** o erro virou estado da tela (`seedIssues`), solto do documento que o
produziu. Enquanto ninguém submetesse de novo, ele valia para sempre.

**Correção:** a recusa anda com o texto que julgou (`SeedRefusal { document,
issues }`) e a tela só mostra o que ainda se aplica (`seedIssuesShown`). Vale
para qualquer veredito sobre um input editável: validação, diff, preview.

### 8. Contar uma entidade que a tela esconde

**Sintoma:** o bloco dizia "Planos e itens (1 plano(s), 2 item(ns))" e listava só
os dois itens. O plano era contado, nunca nomeado — e a marca de proveniência
dele não aparecia em lugar nenhum.

**Causa:** a projeção guardava `planCount: number` em vez dos planos. Contagem é
o que sobra de uma entidade quando ela é jogada fora cedo demais.

**Correção:** `CardView.plans` com os snapshots inteiros, `planLines()` ao lado de
`itemLines()`, e o título do bloco (`plansAndItemsTitle`) saindo da mesma camada
pura — era o último texto de estado montado no JSX, e era justamente o que estava
errado.

---

## No roteiro (achados da automação)

### 3c. Painel que reabre sem lembrar o card, e o roteiro que assume o contrário

**Sintoma (captura do B6):** o roteiro morreu procurando o botão "Concluir" de
um item; o print mostrava o painel do store aberto, com **um** card na lista, e
o lado direito dizendo "Escolha um card para ver o que aconteceu nele."

**Causa (do roteiro):** a seleção é estado do componente, e o "Fechar"
desmonta o painel. Reabrir volta para o estado vazio — não há linha de item
nenhuma até escolher o card. O roteiro tinha selecionado o card uma vez, no
início, e assumiu que a escolha sobrevivia.

**Correção:** o helper que abre o painel também **escolhe o card**. Fica como
pergunta de produto (não corrigida aqui, porque não é mentira): com um nó em
foco no mapa e um card só na lista, abrir o painel em branco custa um clique
que ninguém pediu.

### 4. Print que vaza dado real

**Sintoma:** a primeira captura pegou a lista de cards do board do Alexandre
dentro de um modal que abriu sozinho.

**Correção:** `fecharPortaDeEntrada(win)` depois de ligar o Modo Dev, e
conferência dos prints antes de entregar. Relatório é artefato que circula.

### 5. Âncora por texto que o próprio fluxo muda

**Sintoma:** o locator do card parou de resolver no meio do roteiro.

**Causa:** o emissor declarava o título sem acentos, e o upsert renomeou o card.

**Correção:** âncora estável (`data-testid`, papel + nome), ou o mesmo texto
dos dois lados quando o roteiro é quem escreve o dado.

**Repetiu em 04/08, na variante mais silenciosa:** `locator('section').filter({
hasText: 'Em andamento' }).last()` casava com DUAS seções — o bloco da trava e a
lista de fases, que dizem a mesma palavra de propósito (`hasText` é substring, e
sem distinção de maiúscula). O `.last()` pegava a errada, e dois passos seguidos
fotografavam o mesmo elemento sem ninguém notar: o roteiro passou verde e o
bloco da trava nunca foi visto. Filtro por texto num app cujo vocabulário se
repete de propósito escolhe elemento por acaso — use `getByTestId`.

### 5b. Carrossel: fotografar o nó que não está em foco

**Sintoma (captura do B6, 04/08):** o anel circulava uma área vazia à direita
do mapa; o card do `spike` aparecia recortado pela borda, com "conclu… / não
d… / parser t…". Depois, o mesmo roteiro morreu em `element is outside of the
viewport` ao tentar clicar no card do discovery.

**Causa:** o carrossel tem **um foco por vez** nos dois eixos, e só desenha
inteiro o nó em foco — a trilha, inclusive, é renderizada apenas nele
(`focused && card.trail.length > 0`). O locator ACHA o card fora de foco (ele
está no DOM), mas ele está clipado pelo container: o `boundingBox` existe e
aponta para fora da área visível.

**Correção:** navegar com os gestos do próprio carrossel antes da foto —
`getByRole('button', { name: 'Itens — próximo item' })` no eixo X e
`mapa.press('ArrowUp'/'ArrowDown')` no eixo Y (o rótulo do nível também some do
viewport, então clicar nele não serve como saída). Regra: **antes de fotografar
um nó do mapa, traga-o para o foco** — senão o print documenta o nível de trás.

### 5c. Anel medido no meio da animação

**Sintoma:** anel deslocado ~100px para baixo do card que ele deveria circular.

**Causa:** `passo()` mede o `boundingBox` no instante da foto, e o carrossel
anima 320ms (`LevelCarousel.module.css`). Fotografar logo depois do clique
desenha o círculo onde o card **estava**.

**Correção:** esperar o carrossel assentar depois de qualquer gesto de
navegação (`assentar(win)` no roteiro do B6). Vale para qualquer componente com
transição: o anel é posicionado por medida, não por referência viva.

### 6. Elemento coberto por overlay

**Sintoma:** `<div class="_overlay_…"> intercepts pointer events`.

**Correção:** fechar o que abriu sozinho antes de agir. Se o overlay é
legítimo, fotografe-o — ele faz parte do fluxo que o leitor vai encontrar.

---

## O padrão acima dos padrões

**Nenhum dos achados no app foi pego por teste.** A suíte estava verde em todas
as iterações — 1.447 casos — enquanto a tela dizia que uma fase parada estava
em andamento e mantinha um card travado sem saída.

É o que o handoff da fase 1 da spec 010 já avisava: *"as duas tentativas
anteriores de consertar o mapa passaram nos testes e falharam na tela dele"*.
Aconteceu de novo, com quem escreveu este texto.

Daí a Iron Law da skill: **olhar cada print, um por um**. É a única etapa que
não pode ser automatizada, e é a que paga a conta.
