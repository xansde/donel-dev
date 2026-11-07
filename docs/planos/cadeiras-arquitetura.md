---
demanda: cadeiras
origem: PDA `docs/planos/cadeiras.pda.md` (PR #256, rascunho) + escolha do dono em 06/11 (prototipos-cadeiras/decisao.md)
pedido: "Ontem aprovei protótipos de visualização do mindscape. Quero eles rodando" (dono, 07/11, via Líder)
criado: 2026-11-07
---

# Cadeiras — arquitetura curta

## Forma escolhida

- **Mindscape:** F2a (`f2a-esquema.html`), que combina o layout da A1 (canvas livre, rig e pod como molduras e o
  desenho do dono por cima) com a leitura da A3 (nó redondo com nome grande e "N sentados", setas do caminho do
  trabalho, faixa de contagem por estado e detalhe só na gaveta). A F2b fica como opção que se liga depois, se o
  dono pedir.
- **Tela de cadeira:** B1 (`final-cadeira.html`), com a coluna de custo recolhível e lembrada.

## Decisão 1: a 1ª fatia é uma lente derivada e não grava nada

O PDA ainda não fechou o que é a cadeira guardada (item 02), nem as molduras tipadas (03) e a migração (08). Para o
dono ver a F2a rodando sem decidir isso antes, a fatia 1 **deriva** as cadeiras do que o quadro já tem:

| Na F2a | De onde vem na fatia 1 |
|---|---|
| Rig | o quadro do projeto (nome do projeto) |
| Cadeira | um papel no quadro: todos os lugares com o mesmo `roleId`; os sem papel formam a cadeira "Sem papel" |
| Sentados | lugares cuja aba está aberta e o processo vivo (`deriveSessionAxes().process === 'aberta'`) |
| Quem já sentou | lugares com conversa fechada (nome, data e retomar com um clique) |
| Setas (caminho do trabalho) | as ligações entre lugares, somadas por par de papéis (a seta do `sessao_abrir` e as do dono) |
| Faixa por estado | regra **provisória** (o item 06 do PDA decide a final): erro ou limite de uso = problema; precisa de você = atenção; gente sentada = bem; ninguém = sem sinal |
| Onde parou | a nota mais nova escrita no quadro por quem sentou na cadeira |
| Oráculo | tarefas do quadro cujo `ownerPlaceId` é um lugar da cadeira |
| Configurado × observado | modelo e esforço do papel × motor lido das sessões sentadas (o esforço observado ainda não é medido) |

Consequências:
- **O `mindscape.json` não muda.** Nenhum campo novo, nenhuma escrita: o `schemaVersion` fica em 5, e os canais beta e
  stable seguem lendo e gravando o mesmo arquivo sem perder nada.
- A lente é preferência desta máquina (`localStorage`, `donel.mindscape.lens`), não dado do quadro.
- O desenho e os post-its do dono continuam no lugar e editáveis. O rig fica à esquerda de tudo o que está no quadro,
  então o layout nunca cobre nem move o desenho. Ao abrir a lente, a vista vai até o rig; ao voltar para Lugares, a
  vista volta para onde estava.
- O layout é automático: colunas seguem o caminho do trabalho (caminho mais longo depois de tirar as arestas que
  fecham ciclo, e Dev ⇄ Revisor mantém a direção com mais ligações); uma seta que passaria por baixo de outra cadeira
  vira curva.

Código: `src/shared/mindscape/chairs.ts` (derivação e layout, puro), `src/renderer/src/Mindscape/MindscapeChairs.tsx`
(rig, nós, setas, faixa e gaveta), integração em `MindscapeScreen.tsx`.

## Decisão 2: o que exige subir o `schemaVersion` fica para as fatias que guardam cadeira

Pods, missão, paradigma, posição própria da cadeira, endereço `papel@rig` estável e a cadeira com teto (elástica)
precisam de campo novo no `mindscape.json`, e campo novo sobe a versão (CLAUDE.md). Isso entra numa fatia própria,
com teste de parse v5 → v6 (dado persistido que um canal pode apagar), depois das decisões 02 e 03 do PDA.

## Decisão 3: a tela B1 começa lendo o papel

A cadeira de hoje é o papel no quadro, então a B1 abre a partir de "Definir cadeira ▸" na gaveta e mostra o que o
papel já guarda (instruções, escopo do #250, modelo, esforço e permissão), com a coluna de custo recolhível. Gravar
reaproveita o `roles-store` (único dono de `<userData>/papeis/`). A herança Rig → Pod e as folhas de rig e de pod
chegam quando existirem rig e pod guardados.

## Fora desta rodada

Os itens "Ainda não especificado" e "Fora de escopo" do PDA continuam fora: sentar alguém ou acordar a cadeira (com
fila), arquivo do time, cadeiras do OpenRig, celular, conta por cadeira, B2/B3, fita da A2, árvore e inspetor fixos
da A3.
