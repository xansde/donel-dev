---
tema: mindscape-papeis-prontos
data: 2026-11-03
plano: docs/planos/mindscape-openrig.pda.md · item 12, fatia 12b
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-11-03
---

# Refinamento — Papéis prontos e edição (12b)

Continua a [12a](mindscape-lugar-papel.md) (lugar com papel fixo).

## Regras fechadas

1. **Três papéis de fábrica**, genéricos, em pt-BR e sem nome de IA:
   - **Dev** (cor de "implementar"): faz a mudança pedida, roda a verificação do projeto e pede
     revisão; não aprova o próprio trabalho.
   - **Revisor** (cor de "validar"): confere o efeito prometido contra o contrato real, prova pelo
     produto quando pode, não é o autor e não corrige: devolve achados e um veredito. Adaptado do papel
     de QA do OpenRig ("the evaluator must not be the author").
   - **Pesquisa** (cor de "discovery"): lê e resume com fonte, separa o lido do suposto, não altera
     código nem arquivos.
   Sem sugestão de motor, modelo, esforço ou permissão: valem os padrões do Launcher até o dono pôr.
2. **De fábrica = embutido no app.** Sem arquivo, vale o texto de fábrica; editar grava
   `<userData>/papeis/<id>.md`, que passa a valer. Não há "apagar" nesta fatia (nem para os criados).
3. **Tela "Papéis"** (modal), aberta por "Papéis…" no menu de "＋ Sessão com papel…", no selo de um
   lugar que não começou e ao lado do campo "Papel" do Launcher: selos dos papéis no topo, "＋ Novo",
   e o formulário (nome, cor em bolinhas com prévia do selo, motor/modelo/esforço/permissões
   sugeridos, orientação). O id do papel novo sai do nome ("Revisor de UI" → `revisor-de-ui`) e não
   muda depois.
4. **Editar um papel não troca o papel de ninguém.** O texto novo vale no próximo lançamento,
   retomada ou renovação de quem já tem aquele papel (o app reentrega a orientação a cada um). Trocar o
   papel de um lugar que já começou continua impossível.

## Verificação

`npm run typecheck` + `npm test`. Sem teste novo: tela e texto não ganham teste (regra do dono); a
regra que mentiria calada ("papel não troca depois de começar") já tem o dela na 12a.
