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

**Correção (pendente):** escolher o plano no disparo, e desabilitar a fase
enquanto não houver nenhum — igual ao "Preparar" desabilitado com a razão
escrita.

### 3b. Default de nascimento que finge ser afirmação

**Sintoma:** o card mostrava seis fases concluídas e "PR mergeado e verificado" e,
duas linhas abaixo, o item "aberto" e a etapa "Planejado" (roteiro
`ciclo-completo-de-item`, 04/08/2026). "Planejado" quer dizer *plano existe,
nenhum item começou* — dito sobre um trabalho que a mesma tela mostrava
terminado.

**Causa:** `work_item.recorded` não declara estado, e a ingestão escrevia
`state: 'open'` mesmo assim. Ninguém tinha afirmado "aberto": era default de
nascimento inventado pelo app, e nada o movia depois. D-13 manda a etapa ser
calculada do grafo — mas o grafo estava sendo alimentado com uma constante.

**Correção:** a ingestão parou de inventar o campo, e o estado passou a sair das
fases que tomam o item por assunto (`workItemStateAfterPhase`, pura). Quando
nenhuma fase o tocou, `open` volta a ser default honesto em vez de afirmação.

**O padrão:** todo campo que o app preenche "só para não ficar vazio" vira uma
afirmação quando alguém o lê. Ou ele sai de um fato, ou não existe.

### 3c. Fato torto no log, contornado na apresentação

**Sintoma:** com a correção acima, o print da fase preparada passou a mostrar
"Preparada — ninguém assumiu ainda" em cima e o item "em curso" logo abaixo —
duas frases da mesma tela se contradizendo.

**Causa:** o app grava `phase.started` no DISPARO, e disparar não é começar. A
tela já sabia disso e contornava com um flag (`phaseLine(phase, claimed)`); o
fato no log continuou torto, esperando o próximo leitor.

**Correção:** quem move o item é a **sessão assumida** — o fato honesto sobre
existir alguém trabalhando —, não `phase.started`. O `phase.started` do disparo
segue no log (histórico não se reescreve), mas nenhum consumidor novo o lê como
"começou".

**O padrão:** contornar um fato torto na apresentação não conserta o fato. O
próximo consumidor não vai saber do contorno — e a contradição reaparece em
outro lugar da mesma tela.

---

## No roteiro (achados da automação)

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

### 5b. Legenda que descreve o defeito, e sobrevive à correção

**Sintoma:** a legenda do passo dizia *"o ITEM continua aberto e a etapa continua
Planejado — é achado deste roteiro"*. Depois de o achado ser corrigido, o print
mostrava "Concluído" e a legenda continuava afirmando o contrário. O tutorial
passou a mentir no lugar da tela.

**Correção:** legenda descreve o que a tela **deve** dizer, não o defeito do dia.
Quando o achado merece ficar registrado, ele entra como história ("na primeira
captura ele dizia X"), nunca no presente do indicativo. Toda correção de app
pede uma leitura das legendas dos passos vizinhos.

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
