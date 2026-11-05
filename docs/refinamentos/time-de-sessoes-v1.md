---
tema: time-de-sessoes-v1
plano: docs/planos/mindscape-openrig.pda.md
item: 13 — Conexões entre sessões com significado (+ B37, gerar sessões)
data: 2026-11-04
taskdex: []  # ferramenta pessoal, sem card
status: fechado
participantes: [Alexandre Lentz]
---

# Refinamento — Time de sessões, V1 (sessão abre e dirige sessões)

## Demanda

Uma V1 para usar **hoje**, nas homologações: uma sessão Líder abre sessões com papel, que nascem
no Mindscape ligadas a ela ("delega a"), manda trabalho pela ligação e acompanha. Tudo funciona
também na VPS. Base: protótipo A + C (`docs/prototipos/mindscape-openrig/decisao.md`), ferramentas
`sessao_*` do protótipo e B37.

Já decidido em 03/11 (não se re-pergunta): a ligação autoriza mandar mensagem sem OK; a mensagem
retida enquanto o dono digita entra sozinha depois; o papel é fixo por lugar, e outro papel significa
delegar.

## Escopo pedido pelo dono (04/11)

- Setas conectam sessões, o Líder abre sessões, chat com o Jobu (rodada 1, perguntas 1–3).
- **Acréscimo (04/11):** "sessões claude consigam configurar ambientes inteiros do mindscape sem
  ter que reabrir o app" — a sessão monta o quadro ao vivo (lugares com papel, post-its, desenhos,
  ligações, papéis), aplicado pelo app na hora (item 08 do PDA + metade "desenhar" do B37).

## Regras de negócio fechadas

- **Seta conecta sessões** (rodada 1, Q1): seta de A para B autoriza A a mandar trabalho para B; a
  mensagem entra no chat de B, retida enquanto o dono digita lá; quando B termina o turno, A é
  avisada com o resumo do que B fez.
- **Líder abre sessões** (Q2): ferramentas para abrir sessão com papel e pedido (nasce no quadro
  ligada "delega a" ao autor, no mesmo lugar de execução, VPS ou PC), listar, ler o que cada uma fez
  e mandar mensagem. Teto: **4 sessões abertas sem perguntar**; acima, vai para "Precisa de você".
- **Chat com o Jobu em janela flutuante já na V1** (Q3, dono recusou o balão dentro do app): clicar
  no Jobu abre uma janela própria de conversa com o Líder, que o dono arrasta, redimensiona e leva a
  outro monitor.
- **Sessão monta o quadro ao vivo** (acréscimo): ler o quadro, listar papéis e aplicar lotes
  (lugares com papel, post-its, desenhos, ligações, mover), cada lote um gesto desfazível pelo dono,
  sem reabrir o app.
- **Mensagem entre sessões nunca pede aprovação** (dono, 04/11, relatado pela sessão de homologação
  `homologa-o-b0`): em qualquer modo de permissão, a mensagem chega direto ao destino. Só fica
  retida enquanto o dono digita na aba de destino ou há permissão aberta lá, e entra sozinha
  depois. O caminho é o `sessao_enviar` do app; o SendMessage nativo do CLI fica fora (o "held by
  that session" é dele, não do Donel).
- **Sessão apaga e reorganiza só o que ela criou** (Q4); nunca o que é do dono (post-its, favoritas,
  desenhos).

## Unknowns decididos

- Assumiria: a sessão filha roda local → Decidido: no mesmo lugar de execução da chamadora (VPS ou PC).
- Assumiria: o SendMessage nativo serve entre sessões → Decidido: só `sessao_enviar` do app; o nativo
  segura a mensagem entre modos de permissão diferentes.

## ADRs gerados

- (nenhum ainda)

## Termos do glossário

- (nenhum ainda)

## Ficou aberto

- O dono não confirmou formalmente o fechamento ("vai rodando, mesmo que eu não veja a V1"); entregue
  nos PRs #195 (quadro e sessões por MCP) e #196 (janela flutuante do Líder), valida no alfa.
- "Precisa de você" da 5ª sessão é painel próprio, fora do aviso de sessão e do balão do Jobu.
- Quem abriu quem e mensagens retidas vivem só na memória do app (somem no restart).
