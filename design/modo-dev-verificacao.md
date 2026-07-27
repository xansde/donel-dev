# Verificação do design do Modo Dev contra a spec 003

**Data:** 2026-07-27 · **Design:** `design/modo-dev-handoff/project/Modo Dev.dc.html`
(handoff do Claude Design, projeto "Modo Dev — Árvore de fases interativa")
**Contra:** `specs/003-modo-dev/spec.md` (26 CA) e `specs/003-modo-dev/tasks.md`

> **Por que este arquivo existe:** o CA-25 exige que extensão ao design system seja
> **nomeada e aprovada**, nunca silenciosa, e o CA-24 separa alcance (spec) de forma
> (design). Este documento é o confronto — o que o design cumpriu, o que ele propõe e
> o que **contradiz a spec e precisa ser corrigido antes de virar código**.
>
> **Nota sobre o `_ds/` do bundle:** é um **snapshot** do `design-system/` no momento
> da sessão de design. Nunca editar e nunca usar como fonte de verdade — a fonte é
> `design-system/src/`.

## Veredito

O design **cumpre as 4 zonas e os 5 estados de fase**, usa **só tokens existentes**
(nenhum hex novo), e — o mais importante — **declarou suas 4 extensões
explicitamente**, com justificativa de por que nenhuma peça atual serve. Nada entrou
de contrabando: o CA-25 foi respeitado.

Restam **4 divergências** contra a spec, uma delas séria (a trava), e **1 lacuna de
processo que o design descobriu** (o subconjunto do Validar não tem mecanismo na
esteira de hoje). Nenhuma delas invalida o design; todas são ajuste de tasks.

## O que o design acertou (conformidade)

| CA | Como o design cumpre |
|---|---|
| CA-1, CA-2 | Porta de entrada como **overlay** com filtro (`TextInput`) + filtro de coluna (`SegmentedControl`) restrito a Backlog/Discovery/Plano; cards vinculados marcados com ação "trazer ao foco"; card de Plano rotulado "abre o discovery pai" |
| CA-3 | **`ArmedPrompt`**: faixa "Comando preparado — nada foi enviado", tecla `Enter` desenhada como tecla, ação de descartar. O botão é `SplitButton` **secondary** de propósito — "prepara", não "executa" |
| CA-6 | Barra de abas com no máximo a fase corrente + um terminal comum, e a frase "fases concluídas são arquivadas — acesso pelo mapa"; sessão arquivada mostra faixa própria no terminal |
| CA-7 | Árvore como **carrossel de marcos**: um em foco, vizinhos cortados a 34% de opacidade, setas + atalhos `[M1][M2][M3]`. Representação é decisão do design (CA-24) e esta escolhe legibilidade sobre densidade |
| CA-8, CA-10 | Painel direito com **Skills rodadas**, **Artefatos declarados** e **Recibos de conhecimento**, todos por nó |
| CA-12 | **Anotações do board** no nó e no painel: coluna real, PR + aprovação, "precisa atenção", trava, divergência |
| CA-13 | Bloco de divergência mostrando **os dois fatos** (disco × board) + botão "⌁ Preparar conciliação", com o texto "O app não corrige o board" |
| CA-15 | Os **5 estados** com dupla codificação (glifo + cor), sólido reservado a **falhou** e **travada** — a exigência de "falha inconfundível" foi levada a sério |
| CA-18 | "sem registro" discreto quando não há recibo, e a seção some quando não há vault |
| CA-20 | O switch reorganiza o layout; a tela de hoje aparece no mesmo arquivo com a frase "o Modo Dev não aposenta esta tela" |
| CA-25 | 4 extensões **nomeadas**, e uma lista explícita das peças **não usadas** (Select, Toggle, PostItCard) com o motivo |

Ponto de acessibilidade que o design acrescentou por conta e vale manter como
requisito: **legenda dos dois eixos no rodapé do mapa** (estado de fase × estado de
sessão), reforçando que a cor nunca é o único portador do estado.

## As 4 extensões propostas — precisam do seu OK

Todas se declaram do **grupo `modo-dev`** e usam apenas tokens já existentes
(confirmei em `design-system/src/tokens.css`: `--state-error: #b678f0`,
`--phase-discovery|plano|implementar|validar|concluir`, `--postit-bg`,
`--overlay-modal`, `--shadow-modal` — nenhum hex novo).

| Extensão | O que resolve | Por que nenhuma peça serve |
|---|---|---|
| **`PhaseStateGlyph`** | os 5 estados de fase num glifo de 16px, caractere + cor, sólido em falhou/travada | `StateDot` é o eixo **sessão** (4 estados, 8px, redondo) e os dois aparecem **lado a lado no mesmo nó** — reusar criaria ambiguidade exatamente onde a regra exige leitura instantânea. Dá dono ao `--state-error` (roxo), hoje reservado e sem uso |
| **`AnnotationTag`** | etiqueta curta com tom semântico (muted/ok/warn/error/lock/accent) para as anotações do board | `PhaseChip` é fechado nas 5 fases; nenhuma peça carrega texto curto arbitrário. Sem ela, anotação vira texto solto |
| **`WorktreeCard`** | o cartão do carrossel: cabeçalho, resumo em linguagem simples, faixa de worktree (pasta + branch + etiquetas) e os nós das 5 fases; variante orquestrador para o discovery | `PostItCard` é a voz do Donel (fundo `--postit-bg`, tom de conselho), não dado operacional; nenhuma outra peça é contêiner de conteúdo |
| **`ArmedPrompt`** | o gesto central: comando escrito e não enviado, com a tecla Enter explícita, aviso opcional e descartar | Nem `TerminalTab` nem `Button` expressam "armado, aguardando o humano" — e disparar por engano custa uma sessão de cota |

**Minha avaliação:** as quatro se justificam, e a mais bem argumentada é a
`PhaseStateGlyph` — ela resolve exatamente a colisão de vocabulário que eu havia
sinalizado no brief (semáforo de sessão × estado de fase), e resolve **sem** mexer no
`StateDot`. As quatro entram no pacote `design-system/`, com story, antes das tasks de
UI que as consomem.

## Divergências a corrigir (o design está errado, não a spec)

### D1 — A trava não é arquivo em disco 🔴 **séria**

O design mostra `.esteira/locks/142-m1.lock` como caminho da trava. **Não existe
lock em disco.** O MD-07 decidiu, e o CA-14 registra: a trava é o **label
`esteira:em-andamento:<fase>` no board**, checado pelo `preflight.py`; o app **não
persiste** esse fato. Consequências:

- o painel deve mostrar a **etiqueta do board** e desde quando, **não** um path;
- e como o dado vem do board, ele pertence à **Fatia 2** — na Fatia 1 o slot fica
  vazio, exatamente como o `plan.md` já previu na nota "CA-5 e a fronteira entre
  fatias";
- "Liberar trava…" não apaga arquivo: **pré-digita `/esteira-liberar <card_id>`**
  (CA-16). O texto do modal do design já está quase certo ("só remove o arquivo de
  trava" → trocar por "remove a etiqueta de trava no board").

### D2 — `/esteira-validar` não aceita `--subset` 🟠 **lacuna de processo**

O design pré-digita `/esteira-validar SZI-142-M1 --subset 1-4`. Verifiquei o
`SKILL.md` da fase: **não existe flag de subconjunto** — `esteira-validar` roda por
card, e "lote" ali significa apenas que o card enxerga o epic. Como a invariante 3 da
spec proíbe código novo na esteira, o comando pré-digitado **tem de ser o real**:
`/esteira-validar <card_id>`, sem flag inventada.

Isso expõe uma lacuna verdadeira: a decisão do MD-05 ("Validar é modular, testa
subconjuntos definidos no Plano") **não tem mecanismo hoje**. Três saídas possíveis —
**é decisão sua**, e por isso não escolhi nenhuma:

1. **O subconjunto é contexto humano**: o comando é o real, e o que você quer testar
   você diz dentro da sessão. O app só *exibe* qual subconjunto o Plano registrou.
   (Minha recomendação: zero código novo, cumpre o espírito da decisão.)
2. **O Plano grava o subconjunto no manifesto** e o app o mostra como anotação — ainda
   sem flag, mas exige que o Plano passe a declarar isso.
3. **A esteira ganha a flag** — viola a invariante 3 e vira esforço próprio, fora
   desta entrega.

### D3 — Worktree e branch não estavam na spec 🟡 **adicionar, não remover**

O `WorktreeCard` exibe pasta da worktree e branch por marco. Isso **não** está na pool
do CA-10 — mas é informação legítima e barata: o `ctx.md` de cada fase já traz
`worktree_path` e `branch` no frontmatter (medido no MD-03). Boa adição; entra como
campo lido pelo leitor de disco e como item da pool.

### D4 — Toast com "desfazer" na troca de foco 🟡 **cortar**

O mapa de componentes descreve um Toast de confirmação "com ação única de desfazer" ao
trazer um discovery ao foco. Trocar foco é operação trivial e reversível pelo próprio
gesto (clicar no outro card) — um "desfazer" cria máquina de estado sem valor. Manter o
Toast informativo, **sem** ação de desfazer.

## Observações menores (não bloqueiam)

- Os ids do mockup (`SZI-142-M1`) são ilustrativos: no real, o marco é card próprio com
  prefixo `[Mx]` no título, e o comando leva o `card_id` daquele marco.
- O design usa `--donel-accent` (âmbar) no ícone de recibo do vault; é token de
  identidade do buddy. Cosmético, fica a critério do design.
- `EditableLabel` não é usado — coerente: renomear sessão é a 004, não esta entrega.

## O que muda no `tasks.md`

1. **Novo lote de extensões do design system** (4 tasks), pré-requisito das tasks de
   UI que as consomem.
2. **D1**: a trava é etiqueta do board, não arquivo — corrigir a task de anotação de
   trava e manter o slot vazio na Fatia 1.
3. **D2**: o comando pré-digitado do Validar é o real, sem flag inventada; o
   subconjunto exibido depende da sua decisão acima.
4. **D3**: leitor de disco passa a expor `worktree_path` e `branch`; a pool do CA-10
   ganha os dois.
5. **D4**: Toast sem "desfazer".
6. **Legenda dos dois eixos** no rodapé do mapa entra como item verificável.
