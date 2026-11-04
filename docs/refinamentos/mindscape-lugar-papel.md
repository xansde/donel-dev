---
tema: mindscape-lugar-papel
data: 2026-11-03
plano: docs/planos/mindscape-openrig.pda.md · item 12, fatia 12a
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-11-03 (recomendação "papel fixo por lugar" aprovada com "segue")
---

# Refinamento — O cartão de sessão vira lugar, e o lugar tem papel (12a)

## Demanda

Base da ideia OpenRig no Mindscape ([estudo](../pesquisas/openrig-estudo-profundo-2026-11.md), seções
2, 6 e 7): o cartão de sessão deixa de ser "a conversa X" e passa a ser um **lugar** estável, com a
conversa do momento e as anteriores, e um **papel** fixo. Sem isso, renovação em voo (07), ligações
(13) e as estações da esteira montada (15) não têm onde morar.

## Regras fechadas

1. **O lugar tem id próprio.** O cartão migrado da v2 mantém o id antigo (`session:<primeira
   conversa>`), então posição, post-it e ligações ficam como estavam; lugar criado no quadro é
   `place:<uuid>`. O id nunca é lido como conversa.
2. **Conversa muda, lugar fica.** Renovar em voo, `/clear` e fork na mesma aba acrescentam a conversa
   nova ao lugar (a anterior vai para `previous`); o post-it escrito pela sessão passa junto, na mesma
   posição. `/resume` de uma conversa que já tem lugar próprio não esvazia ninguém: o lugar dela
   acorda com a aba e o outro adormece.
3. **Retomar uma conversa antiga** (pela lista de sessões) devolve o lugar a ela, se a conversa atual
   do lugar não estiver aberta; aberta, a antiga ganha um lugar novo (`session:<id>~2`).
4. **"Ainda não começou".** "＋ Sessão com papel…" na barra do quadro cria um lugar sem conversa,
   com o papel escolhido. Ele aparece com ○ e traço pontilhado; dois cliques (ou "Ir ao terminal")
   abre a sessão numa aba nova, com as sugestões do papel. O lugar se liga à conversa antes da aba
   receber o id, então o quadro nunca faz um segundo cartão. Delete tira um lugar que não começou;
   Ctrl+Z desfaz a criação. Lugar que já começou nunca sai do quadro pela borracha nem pelo Delete.
5. **Papel fixo por lugar** (dono, 03/11). O papel troca só enquanto o lugar não começou (clique no
   selo do cartão). Precisa de outro papel → outra sessão, e delega. "Continuar como Revisor" é um
   lugar novo com passagem de bastão, nunca troca de crachá. Lugar nascido de uma conversa (Launcher,
   retomada) já nasce começado.
6. **Onde o papel mora.** `<userData>/papeis/<id>.md`: cabeçalho (`nome`, `cor`, `motor`, `modelo`,
   `esforco`, `permissao`) e a orientação no corpo. Store próprio, fora do `config.json` (o sanitizador
   de um canal antigo apagaria a chave). Arquivo ilegível é pulado, nunca adivinhado. `motor` é o id
   de um provedor; vazio ou provedor que não existe aqui = conta ativa.
7. **Injeção a cada lançamento, retomada e renovação.** Para o Claude Code: `--append-system-prompt-file`
   (opção escondida do CLI, conferida no 2.1.317). O CLI grava o prompt de sistema uma vez por conversa
   e o reusa até a compactação, então repassar na retomada é inofensivo e, depois de compactar, é o
   que volta. Ponto de extensão por CLI (`roleDeliveryFor`, como o `mcpDeliveryFor`): CLI sem a opção
   recebe o mesmo texto como primeira mensagem. O main descobre o papel pelo que o renderer manda
   (lugar novo, Launcher) ou, na retomada e na renovação, pelo lugar que guarda a conversa no
   `mindscape.json`. Papel ou arquivo ausente → a sessão abre sem papel, nunca deixa de abrir.
8. **Identidade sem gastar turno.** A identidade curta ("Você é Revisor nesta sessão…" + a regra do
   papel fixo) vai como primeira linha do texto anexado ao prompt de sistema, não como mensagem: uma
   mensagem automática faria o agente responder sem tarefa, gastando cota a cada lugar aberto.
   `sessao_quem_sou` fica para o 13a, que ainda não existe.
9. **O dono vê.** Selo do papel no canto superior direito do cartão, na cor do papel (chips de fase do
   design system); "◆ Revisor" no slot curto da aba; campo "Papel" no Launcher, que preenche as
   sugestões e deixa tudo editável. Texto neutro: nada de nome de IA no que é novo.
10. **`schemaVersion` 3.** Um canal v2 apagaria o lugar que não começou e as conversas anteriores;
    com 3 ele lê e não grava.

## Fora desta fatia

- Papéis de fábrica e a tela de editar/criar papel: 12b.
- Camadas (regras do quadro, orientação de moldura): 12c, depois.
- Avisar uma sessão viva que o papel mudou: não se aplica, papel não muda depois de começar.

## Verificação

`npm run typecheck` + `npm test`. Testes novos (`tests/mindscape-place.test.ts`): migração v2 → v3 sem
perder posição, post-it nem ligação; conversa que muda no mesmo lugar; lugar que começa sem segundo
cartão; papel que não troca depois de começar.
