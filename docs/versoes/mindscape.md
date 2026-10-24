---
demanda: mindscape
plano: docs/planos/mindscape.pda.md
data: 2026-10-23
taskdex: []  # sem card: ferramenta pessoal — esta execução não conta na adoção
autor: Claude por delegação de Alexandre Lentz
status: validado-com-cliente  # rascunho | aprovado | validado-com-cliente
aprovado-por: Claude por delegação de Alexandre Lentz, 2026-10-23
aprovado-em: 2026-10-23
validado-por: Claude por delegação de Alexandre Lentz, 2026-10-23  # o dono revê no alfa
validado-em: 2026-10-23
validacao-link: handoffs/mindscape-versionamento.md
---

# Versões — Mindscape

## Demanda

Quadro visual livre no Donel Dev onde o dono acompanha de relance as sessões do Claude e as
próprias anotações, por projeto, sem texto de terminal. Artefatos consumidos:
[plano](../planos/mindscape.pda.md), [spec](../produto/mindscape.spec.md),
[refinamento](../refinamentos/mindscape-regras-v1.md),
[pesquisa](../pesquisas/mindscape-fonte-postit-sessao.md),
[decisão do protótipo](../prototipos/mindscape/decisao.md) (variante A, Canvas livre).

> Corte decidido por delegação do dono, 2026-10-23 ("Você pode seguir a estrutura atual da
> esteira, só que vai tomando as decisões"). Critério: o menor conjunto que fecha as 7
> histórias do caminho feliz do spec; o dono quer ver o resultado rápido no alfa.

## V1 — Mindscape por projeto, no alfa

O dono abre o modo Mindscape, vê as sessões de cada projeto como post-its vivos, lê o que
cada uma fez, anota ao lado, liga cartões e vai ao terminal de qualquer sessão.

### O que entra

- **Modo "Mindscape"** no seletor do casco, ao lado de "Uso geral" e "Dev" (Dev intacto) —
  sem ele não há onde o quadro morar (refinamento, regra 8).
- **Um mindscape por projeto, trocado por abas no topo**, criado sozinho quando o projeto tem
  sessão aberta — história 6; é o mínimo de "vários mindscapes" (regra 9).
- **Post-it de sessão vivo**: selo "SESSÃO", glifo de estado, nome em mono, cor herdada da aba;
  o estado acompanha o semáforo sem recarregar — história 1.
- **Destaque** normal / destacada / apagadinha, zerado quando o dono abre a sessão; erro conta
  como destacada — história 2 (regras 3 e 4).
- **Post-it escrito pela sessão**, um por sessão, sobrescrito a cada fim de turno, com a hora;
  continua no quadro quando a aba fecha, até o dono arquivar — história 3 (regras 1, 2 e 11).
- **Post-its do dono**: criar, editar o texto, escolher cor (Sem cor, Azul, Dourado), arrastar,
  arquivar; visualmente distintos ("✎ você", canto dobrado) — história 4 (regra 6).
- **Ligações** entre dois post-its quaisquer do mesmo mindscape, com seta ou sem, e remover —
  história 5 (regra 5).
- **Arrastar os post-its de sessão** e mover a visão do quadro (pan) — sem isso não é "canvas
  livre" (decisão do protótipo).
- **Persistência** de posições, post-its, ligações e mindscapes ao fechar e reabrir o app —
  sem ela a arrumação se perde a cada boot (regra 7).
- **Ir ao terminal**: selecionar o post-it de uma sessão e ir à aba dela no Uso geral —
  história 7 (regra 10).

### Caminho feliz

1. O dono tem sessões abertas em dois projetos e troca o seletor do casco para "Mindscape".
2. Vê a aba do projeto `atlas` com os post-its de sessão e, ao lado de cada um, o post-it escrito
   pela sessão com a última resposta dela.
3. Uma sessão termina o turno em segundo plano: o post-it dela fica destacado e o texto do
   post-it escrito por ela é trocado pela resposta nova.
4. O dono cria um post-it seu dourado, arrasta para perto da sessão e liga os dois com seta.
5. Seleciona a sessão destacada e aciona "ir ao terminal": o app volta ao Uso geral com a aba
   da sessão focada.
6. Volta ao Mindscape: a sessão aparece apagadinha (sem novidade desde que ele abriu).
7. Troca para a aba do projeto `beacon`, vê as sessões de lá.
8. Fecha e reabre o app: o quadro está como ele deixou.

### O que fica de fora

- Mindscape por sequência de esteira → V2 — depende de como o dono usar o por projeto.
- Histórico de post-its escritos pela sessão (um por turno) → V2 — a V1 sobrescreve.
- Rabiscar no quadro, prints no quadro → V2 — a menos que a base escolhida na `/arquitetura`
  os traga sem custo (ver hipótese V2).
- Captura relâmpago (Ctrl+Alt+N), cartas do dia, ações "manter / virar prompt" do Tomo → V3.
- A sessão ler os post-its do dono → V3 — exige definir contrato com o CLI.
- Minimapa e zoom fino → V2 — conforto; pan basta para operar.
- Contador dos baselines das métricas → fora da V1 (regra 12); reavaliação qualitativa após
  duas semanas no alfa.
- Significado das cores e das ligações → V2+, quando o uso mostrar padrão.

### Critério de validação

- O dono, no alfa, opera os 8 passos do caminho feliz sem perguntar a uma sessão "o que você fez?".
- O estado das sessões no quadro bate com o semáforo da aba no mesmo instante.
- Depois de duas semanas de uso, o dono diz se o Mindscape virou o lugar onde começa o dia
  (meta 2 do spec, qualitativa).

## Hipóteses — V2..Vn

### V2 — Quadro mais rico (hipótese)

Rabisco à mão livre, prints colados, zoom e minimapa, histórico curto dos post-its escritos
pela sessão e um mindscape por sequência de esteira, ao lado dos por projeto.
**Condição**: a V1 em uso mostrar que o dono arruma o quadro à mão e sente falta de desenhar
ou de ver a esteira inteira num lugar só.

### V3 — Tomo completo (hipótese)

Captura relâmpago Ctrl+Alt+N de qualquer tela, cartas do dia, ações "virar prompt" e a sessão
lendo os post-its do dono como contexto.
**Condição**: os post-its do dono virarem hábito na V1/V2 (o dono anota no Mindscape pelo
menos uma vez por dia).

## Fora de escopo

- Texto de terminal ao vivo no quadro (spec).
- Qualquer mudança no Modo Dev (spec).
- Chamar modelo para resumir a sessão (refinamento, regra 1).
