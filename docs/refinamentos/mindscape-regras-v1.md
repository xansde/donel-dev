---
tema: mindscape-regras-v1
plano: docs/planos/mindscape.pda.md
item: 03 — Regras de comportamento do Mindscape
data: 2026-10-23
taskdex: []  # sem card: ferramenta pessoal — esta execução não conta na adoção
status: fechado
participantes: ["Claude por delegação de Alexandre Lentz, 2026-10-23"]
---

# Refinamento — Regras de comportamento do Mindscape

## Demanda

Fechar as pendências do spec (`docs/produto/mindscape.spec.md`) que o agente de código
assumiria sozinho: quando a sessão escreve o post-it dela, destaque de sessão em erro,
ligações, cores, persistência, onde o Mindscape mora, baselines e convenção `specs/NNN`.
Forma da tela: variante A, Canvas livre (`docs/prototipos/mindscape/final.html`).

> Todas as decisões abaixo foram **decididas por delegação do dono, 2026-10-23** ("Você pode
> seguir a estrutura atual da esteira, só que vai tomando as decisões"). Critério: a opção
> mais simples que respeita o spec. Uma rodada só; o dono revê no corte de versões (item 05
> do plano).

## Regras de negócio fechadas

1. **Post-it escrito pela sessão — quando.** A cada fim de turno (hook `Stop`), o app grava o
   texto de `last_assistant_message` no post-it escrito pela sessão. Sem chamar modelo, sem
   marcos intermediários. Fallback: última resposta `assistant` da cauda do `.jsonl`.
   Porquê: o dado já chega pronto ao app ([pesquisa](../pesquisas/mindscape-fonte-postit-sessao.md)).
2. **Um post-it escrito pela sessão por sessão**, sobrescrito a cada `Stop`, com a hora da
   escrita. Histórico de post-its fica para depois. Porquê: evita o quadro encher de cartões
   por turno.
3. **Destaque.** Ordem de avaliação:
   - `working` → **normal**;
   - `waiting`, `permission`, `done` e `error` com mudança de estado **depois** da última vez
     que o dono abriu a sessão → **destacada**;
   - os mesmos estados sem mudança desde a última abertura → **apagadinha**.
   Sessão em **erro** se comporta como "esperando decisão": destacada. Porquê: erro também
   pede ação do dono.
4. **"Abrir a sessão"** = a aba da sessão ficar focada no Uso geral (ou o dono ir ao terminal
   a partir do Mindscape). É esse instante que zera a novidade.
5. **Ligações.** O dono liga dois post-its quaisquer do mesmo mindscape, com seta ou sem seta.
   Sem semântica automática na V1: a ligação só existe, desenhada. Porquê: o spec pede
   ligações desde o início e deixa o significado para depois.
6. **Cores.** Paleta existente de aba (`TAB_COLOR_TOKENS`), sem significado fixo. O post-it de
   sessão herda a cor da aba. O post-it do dono escolhe entre Sem cor, Azul e Dourado; o
   Vermelho (`permission`) fica fora para não confundir com "permissão pendente".
7. **Persistência.** A arrumação do quadro (posições, post-its do dono, post-its escritos
   pela sessão, ligações, mindscapes) fica guardada ao fechar o app, em arquivo próprio no
   `userData`, no mesmo padrão dos stores existentes (`esteira-store.ts`).
8. **Onde mora.** Novo modo no SegmentedControl do casco, ao lado de "Uso geral". O "Dev"
   continua como está (o spec manda não mexer no Modo Dev): "Uso geral | Dev | Mindscape".
9. **Quais mindscapes na V1.** Um mindscape por projeto da barra lateral, criado sozinho
   quando o projeto tem sessão aberta; trocados por abas no topo, como no protótipo.
10. **Ir ao terminal.** Selecionar o post-it de uma sessão e acionar "ir ao terminal" troca
    para o Uso geral com a aba da sessão focada.
11. **Quais sessões aparecem.** As sessões das abas abertas. Aba fechada: o post-it da sessão
    sai do quadro; o post-it escrito por ela fica, com o nome da sessão, até o dono arquivar.
12. **Baselines.** Medição adiada. Baseline registrado como "desconhecido"; o dono reavalia as
    duas metas, de forma qualitativa, depois de duas semanas de uso no alfa. Porquê: um
    contador custa código antes de a V1 existir.
13. **Convenção `specs/NNN`.** Os artefatos da esteira ficam em `docs/` (produto, planos,
    pesquisas, protótipos, refinamentos). `specs/017-mindscape/README.md` aponta para eles,
    para a numeração do repo não pular.

## Unknowns decididos

- Assumiria: chamar o modelo para resumir a sessão → Decidido: usar `last_assistant_message`
  do `Stop`, sem modelo.
- Assumiria: um post-it novo por turno → Decidido: um por sessão, sobrescrito.
- Assumiria: erro com destaque próprio (vermelho) → Decidido: destacada, igual "esperando decisão".
- Assumiria: substituir o "Dev" pelo Mindscape, como no protótipo → Decidido: terceiro modo,
  Dev intacto.
- Assumiria: posições só em memória, como no protótipo → Decidido: persistem no `userData`.
- Assumiria: ligação só entre sessões → Decidido: entre quaisquer dois post-its do mesmo mindscape.
- Assumiria: mindscape criado à mão → Decidido: um por projeto, automático.
- Assumiria: o vermelho na paleta do dono → Decidido: fora.

## ADRs gerados

Nenhum. Nenhuma decisão passa no critério triplo: todas são baratas de reverter.

## Termos do glossário

- Mindscape (novo)
- Post-it de sessão (novo)
- Post-it escrito pela sessão (novo)
- Post-it do dono (novo)

## Ficou aberto

- Mindscape por sequência de esteira (o spec pede "por projeto ou por esteira"): a V1 entrega
  só por projeto; esteira vai para o corte de versões (item 04).
- Corte do texto longo de `last_assistant_message` no post-it: decisão de forma, fica para a
  arquitetura.
- Excalidraw como base do quadro: decisão da `/arquitetura`, como o spec já diz.
