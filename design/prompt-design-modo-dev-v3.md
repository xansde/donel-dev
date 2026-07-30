# Prompt pronto — segunda leva de design do Modo Dev (v3)

> **Como usar:** copie **tudo abaixo da linha divisória** e cole de uma vez em
> `claude.ai/design`. É o Brief 0 (design system, já com as 4 extensões aprovadas na
> primeira leva) concatenado com o brief da v3 — não precisa abrir outro arquivo.
>
> **Proveniência:** design system de `design-handoff.md` + as extensões aprovadas em
> `design/modo-dev-verificacao.md`; a parte nova vem de `specs/009-modo-dev-v3/spec.md`
> (31 CA) e do `specs/009-modo-dev-v3/discovery.md` (17 decisões, 29/07/2026). Se
> qualquer um mudar, **regere este arquivo**.
>
> **Anexe também:** `design/modo-dev-handoff/project/Modo Dev.dc.html` — é o desenho
> aprovado da primeira leva, e esta leva o **evolui**, não recomeça.

---

Você vai evoluir o design de uma tela de app desktop que **já foi desenhada por você
mesmo** numa sessão anterior. Absorva o design system, depois o que existe hoje, depois o
que muda.

# Parte 1 — Design system (linguagem visual obrigatória)

## Identidade

Donel Dev é um "cockpit de operador", não um app de consumo. A sensação-alvo é "sala de
controle calma": interface densa, escura, tipografia mono para dados técnicos (paths,
nomes de sessão, terminal), cor usada quase exclusivamente para comunicar **estado**.
Nada pisca sem motivo — o que pisca, importa de verdade.

## Paleta (dark, tema único)

| Token | Hex | Uso |
|---|---|---|
| `bg-app` | `#0E1116` | fundo da janela |
| `bg-panel` | `#151A21` | sidebar, painéis, cards |
| `bg-raised` | `#1C232C` | hover, aba ativa, inputs |
| `border` | `#28303B` | hairlines de 1px |
| `text-primary` | `#D7DDE5` | texto principal |
| `text-muted` | `#828D9C` | metadados, labels |
| `accent` | `#4C9CF0` | seleção, links, foco |
| `state-working` | `#4C9CF0` | sessão trabalhando (pulso sutil) |
| `state-waiting` | `#E8B44C` | sessão aguardando resposta |
| `state-permission` | `#F0684C` | sessão com permissão pendente (pulso forte) |
| `state-done` | `#5E6873` | sessão encerrada |
| `state-error` | `#B678F0` | estado de FASE: falhou |
| `zone-ok` | `#3DCE8F` | smart zone: dentro do limite |
| `zone-warn` | `#E8B44C` | smart zone: atenção |
| `zone-over` | `#F0684C` | smart zone: hora de handoff |

O terminal embutido usa tema próprio, casado com `bg-app` (ANSI de alto contraste, cursor
em `accent`).

## Tipografia e densidade

- UI: Inter (ou system-ui) — 13px base, 11px metadados, títulos 15px/peso 600.
- Dados técnicos (paths, nomes de sessão, terminal): **JetBrains Mono**, 12.5px.
- Linha em listas: 30–32px · radius 6px · ícones outline 16px estilo Lucide ·
  espaçamento base 8px · padding de painel 12px.

## Componentes existentes — não recriar nenhum

Peças originais: **dot de estado** (semáforo de sessão, 8px redondo, 4 estados), **medidor
smart zone**, **badge de conta**, **chip de fase**, **botão** (4 variantes) e **split
button**, **input de texto**, **dropdown com descrição por opção**, **switch**, **controle
segmentado**, **aba de terminal**, **label editável**, **card post-it**, **modal**,
**toast**, **barra de status**.

Extensões **aprovadas e já construídas** na primeira leva — trate como parte do sistema:

| Extensão | O que é |
|---|---|
| **PhaseStateGlyph** | os 5 estados de FASE num glifo quadrado de 16px: caractere + cor, dupla codificação, sólido reservado a *falhou* e *travada* |
| **AnnotationTag** | etiqueta curta com tom semântico (`muted`/`ok`/`warn`/`error`/`lock`/`accent`) |
| **WorktreeCard** | o cartão do carrossel: cabeçalho, resumo em linguagem simples, faixa de worktree (pasta + branch + etiquetas) e os nós de etapa. Tem variante "orquestrador" |
| **ArmedPrompt** | o gesto central: comando escrito e **não enviado**, com a tecla Enter explícita, aviso opcional e descartar |

Se um alcance deste brief não for componível com essas peças, **proponha uma extensão
nomeada** — nome, o que resolve, por que nenhuma peça atual serve. **Extensão silenciosa
não passa.**

**Regra de eixos que precisa sobreviver:** *estado de FASE* (glifo quadrado 16px) e
*estado de SESSÃO* (dot redondo 8px) são eixos diferentes e aparecem lado a lado no mesmo
nó. Não os aproxime visualmente.

---

# Parte 2 — O que existe hoje, e por que precisa mudar

O desenho anexo (`Modo Dev.dc.html`) foi aprovado e implementado — **mas foi
implementado comprimido**, e o dono do produto reclamou de duas coisas: *"não é intuitivo
graficamente"* e *"tela muito suja, com informação que não comunica muito"*.

O que aconteceu, medido no código:

- o mapa, que no seu desenho é o painel **esquerdo de 480px** com cards de **392px**, foi
  para uma **terceira coluna estreita à direita**;
- o painel de detalhe do nó, que no seu desenho é um **terceiro painel de 316px**, foi
  enfiado **dentro** do mapa;
- o **carrossel** (um card em foco, vizinhos a **34%** de opacidade, parcialmente
  cobertos, setas `‹ ›` e contador) virou **pilha vertical com todos os cards ao mesmo
  tempo**, vizinhos a 70%.

**A geometria do seu desenho está confirmada e volta como lei.** Você não precisa
redesenhá-la — precisa estendê-la.

## O processo mudou: a Esteira agora é v3

O vocabulário e a estrutura que você desenhou envelheceram. O que mudou:

**Morreu:** o conceito de **marco** e o prefixo `[M1]`/`[M2]` no título dos cards; a
**aprovação de PR** como fato exibido; o "subconjunto" da fase Validar.

**Nasceu:**

| Termo | O que é |
|---|---|
| **card de plano** | o que você desenhou como *marco*. Um Discovery fatia o trabalho em N cards de plano |
| **fase do plano** | fatia sequencial de um plano, e **a unidade de PR**. Um plano pode ter 1 ou N fases; elas são estritamente sequenciais |
| **garantia** | a prova de que uma fase está correta (roteiro manual, teste de API, testes herdados ou infra). Uma por fase |
| **homologação** | a fase **Validar** deixou de ser revisão de código antes do PR e virou **homologação depois do merge**: o PR entra em staging e há uma **janela de 24h** para provar que funciona, senão um processo automático **desfaz o merge** |
| **lote** | agregação de planos de um mesmo Discovery que precisam ser vistos juntos. O card de entrada fica como **capa** do lote |

## As mudanças pedidas

### 1. O mapa vira um carrossel de dois eixos

Esta é a mudança central, e é **uma regra só aplicada duas vezes**:

> **A esteira inteira é um carrossel vertical. Cada nível é um carrossel horizontal.
> Mesmas regras de opacidade e de recorte parcial nos dois eixos.**

Onde o operador está é sempre o **centro da cruz**: o card em foco cheio, e em volta —
acima, abaixo e aos lados — os vizinhos recuados, translúcidos, parcialmente cobertos.

O eixo vertical tem **quatro níveis**:

```
Discovery
    |
plano 1 — plano 2 — plano 3        ← carrossel horizontal
    |
implementação                      ← só as do plano em foco
    |
validação
```

**O carrossel horizontal é condicional: só nasce quando existe irmão.** As implementações
rodam numa **sessão única que orquestra subagentes**, então o nível de Implementação
normalmente é **um card** — e só vira carrossel se aquele plano propõe **mais de um PR**.
Mesma regra para Validação. **Nenhum ornamento de carrossel para um item só** (sem setas,
sem contador).

**Implementação e Validação são níveis distintos**, nunca irmãos no mesmo carrossel: na
v3 são o mesmo PR em dois momentos, antes e depois do merge.

**Nível que não existe não deixa buraco** — a sequência simplesmente fica mais curta. Há
um caminho alternativo em que Plano/Implementação/Validação são substituídos por um nível
único chamado **Documentação** (para trabalho cujo produto é um documento, não código);
esse caminho tem dois níveis, Discovery → Documentação, e o desenho tem que absorvê-lo sem
parecer defeituoso.

### 2. A trilha dentro do card mostra só o que existe

Dentro do card em foco, a trilha de etapas mostra **as etapas que já tiveram sessão + a
próxima**, e nada além. Etapa que nunca rodou e não é a próxima **não aparece**.

- clicar na **próxima** é como se avança (prepara o comando — nunca envia);
- clicar numa **passada** retoma a sessão dela, só para consulta.

### 3. Nenhum disparo fora do mapa

A progressão de fases vive **só no mapa**. A faixa superior perde a fileira de botões de
fase que a implementação criou — *"lá fica muito apertado e sujo"*. E **cada fato aparece
num lugar só**: hoje trava, divergência e estado aparecem duplicados entre o nó do mapa, o
botão da faixa e o bloco de detalhe.

### 4. A legenda dos dois eixos sai

O rodapé do mapa tinha uma legenda explicando estado de fase × estado de sessão. Ela
**sai**: os glifos e ícones têm que comunicar sozinhos. A dupla codificação (glifo **e**
cor) permanece obrigatória — era ela o requisito de acessibilidade, não a legenda.

### 5. A aba ganha ícone, cor e ordem

- **Ícone de estado no lugar do farol**, na aba — mesma cor do estado, **pode piscar**. O
  **dot redondo permanece no mapa**, onde convive com o glifo de fase.
- **Cor por aba**, definível pelo operador.
- **Abas reordenáveis** por arraste.

### 6. A barra inferior volta a mostrar contexto consumido

O medidor de contexto consumido (`%` da janela do modelo) desapareceu da tela quando uma
toolbar foi removida. Ele volta **na barra de status**, atualizando ao vivo. A barra pode
concentrar bastante informação — a exigência é que **atualize constantemente**.

### 7. Engrenagem de configuração por projeto

Na tela de **sessões anteriores**, um botão de engrenagem que abre a configuração daquele
projeto, com dois campos: o **ID do board de tarefas** e o **repositório GitHub** que
aquele projeto aponta. Hoje os dois são editados à mão em arquivos fora do app, e sem eles
o app não sabe onde procurar nada.

### 8. Reiniciar a sessão atual

Um gesto para **reiniciar a sessão em foco retomando-a de onde parou**, sob a conta
atualmente selecionada. Caso de uso real: a cota da conta original acabou no meio do
trabalho. O desenho precisa acomodar o aviso de que a sessão passa a existir em **duas
contas** a partir daí, e que a tela de sessões anteriores tem de dizer **de qual conta**
cada entrada é.

### 9. Lançar um projeto do zero

Não existe caminho para criar um projeto novo pelo app — só abrir os que já existem.
Desenhe esse caminho.

### 10. Moldura do terminal

A janela do terminal embutido aparece com uma pequena moldura cortada. Corrija na
composição.

---

# Parte 3 — Duas decisões que são suas

Estas duas o produto **não** fixou, de propósito, porque são forma:

**A. Onde mora o relógio de 24h.** É o fato mais acionável do processo novo: depois do
merge, há um prazo concreto para homologar, e passar do prazo **desfaz o merge
automaticamente**. Precisa aparecer com o horário-limite real, não como "faltam X horas"
vago, e precisa escalar de urgência conforme o prazo aproxima. Onde e como é sua escolha.

**B. Quais etiquetas ficam no card de plano.** A implementação atual empilha etiquetas que
não comunicam: `coluna: implementar`, `PR sem aprovação · <URL inteira do PR>`,
`conferir: [Mx] do board difere do disco`. As duas últimas morreram na v3. Decida a lista
final e o que ela precisa dizer. Os fatos disponíveis são: coluna real do card, trava de
fase em andamento, etiquetas de atenção ("escalado", "precisa atenção"), PR da fase e o
estado dele (mergeado · homologado · revertido), e o prazo de homologação.

---

# Regras de produto que a composição precisa refletir

- **O app conduz, nunca decide.** Nenhum botão de aprovação automática, nenhum gate que o
  app resolva sozinho.
- **O comando aparece digitado e NÃO enviado.** O Enter é sempre do operador — disparar
  por engano custa uma sessão inteira de cota. Este é o gesto central do modo.
- **O app não escreve** em board, repositório nem base de conhecimento. Ele exibe recibos,
  não os produz.
- **Trava nunca desabilita botão** — ela avisa. Uma trava esquecida de ontem bloquearia
  exatamente quem quer retomar hoje.
- **Núcleo agnóstico:** board e base de conhecimento são integrações plugáveis. Operador
  sem elas configuradas usa o modo inteiro sem ver cobrança.

# Entrega esperada

1. As telas em **HTML**, 1440×900, tema dark;
2. Um **mapa de componentes** — cada elemento anotado com qual peça do design system o
   realiza;
3. A **lista de extensões propostas**, se houver — cada uma nomeada e justificada.

# Dados de exemplo

- **Discovery em foco:** `PRJ-142 · Parcelamento no simulador` — capa de um lote de 3
  planos.
- **Planos:** `PRJ-143 Cálculo das parcelas` (em foco) · `PRJ-144 Tela de simulação` ·
  `PRJ-145 Relatório de repasse`.
- **O plano em foco tem 2 fases** (dois PRs): fase 1 homologada; fase 2 com PR mergeado
  em staging **há 6 horas**, aguardando homologação — prazo hoje às 09:00 do próximo dia
  útil. Use este card para exercitar a decisão **A**.
- **Um plano com 1 fase só**, para mostrar o nível SEM carrossel: `PRJ-144`.
- **Uma etapa travada:** `PRJ-143 · Implementar`, trava registrada desde ontem 18:42.
- **Uma divergência:** disco diz Plano concluído, board diz card ainda em Discovery.
- **Um plano do caminho documental:** `PRJ-150 · Mapa do processo de repasse` — Discovery →
  Documentação, sem Plano/Implementação/Validação.
- **Trilha do card em foco** (regra "só o que teve sessão + a próxima"): Discovery ✓ ·
  Plano ✓ · Implementação f1 ✓ · Validação f1 ✓ · Implementação f2 ✓ · **Validação f2 ← a
  próxima**.
- **Sessão em foco:** conta "Tecnologia Claude 3", contexto em 312k/400k.
- **Abas abertas:** 4, uma com cor personalizada, uma piscando por permissão pendente.
