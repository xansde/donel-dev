# Verificação — handoff de design "Modo Dev v3" × spec 009

**Data:** 2026-07-29/30 · **Mockup:** `design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html`
(lido inteiro, 1319 linhas) · **Prints:** `design/modo-dev-v3-handoff/prints/`
**Spec:** `specs/009-modo-dev-v3/spec.md` (31 CA) · **Discovery:** `discovery.md` (17 decisões)

Mesmo papel que `design/modo-dev-verificacao.md` teve para a leva de 27/07: dizer onde
o mockup e a spec discordam, para ninguém descobrir isso implementando. **Regra que
decide** (D1 do Discovery, "confia no design sempre"): divergência de **forma** → vence
o design, sem abrandar; divergência de **alcance ou comportamento** → vence a spec.

---

## 1. O que o design resolveu (as duas perguntas abertas)

**[?] A1 — onde mora o relógio de 24h → RESPONDIDO (Decisão A do designer).**
No **card de Validação da fase**, não no plano nem na sessão: horário-limite **absoluto
em mono** como dado principal ("amanhã (30/07) · 09:00"), barra de 4px consumindo a
janela, relativo ("faltam 18h 30min") como apoio, e uma frase de consequência. Quatro
degraus, medidos no mockup (`clockData`):

| degrau | faixa | cor | animação | frase |
|---|---|---|---|---|
| tranquilo | > 12h | `--zone-ok` | nenhuma | "janela de 24h aberta — homologar antes do prazo mantém o merge." |
| atenção | 4–12h | `--state-waiting` | nenhuma | "menos de meia janela — homologue hoje ou o merge é desfeito." |
| urgente | 0–4h | `--state-permission` | pisca 1s | "reta final — passando do prazo, o merge é desfeito automaticamente." |
| estourado | ≤ 0 | `--state-error` | pisca rápido | "prazo estourado — reversão automática em curso, o PR volta a staging zerado." |

Mais duas regras de comportamento que a spec **não previa** e agora são requisito:
o plano em foco também carrega o prazo como **etiqueta curta**, e no degrau **urgente** o
relógio **se promove à barra de status** quando o card não está em foco — "promoção, não
duplicação". Componente novo: `HomologationClock`, com variante compacta só para o
degrau urgente.

**[?] A2 — lista final de etiquetas do card de plano → RESPONDIDO (Decisão B).**
Ficam **quatro**, e a régua declarada é "só entra o que muda o que o operador faz nos
próximos minutos, ou o que contradiz o disco":

1. **coluna real do board** — `muted` quando concorda com o disco; vira marcador de
   divergência em `error` quando discorda, com a ação de conciliar ali mesmo;
2. **trava de fase em andamento**, com data e a ação de liberar;
3. **etiqueta de atenção do board** ("escalado", "precisa atenção");
4. **prazo de homologação em formato curto**, quando há janela aberta.

Saem: a URL do PR, "PR sem aprovação" e o texto genérico de conferência. O **estado do
PR** (mergeado · homologado · revertido) **desce para o card da fase**, onde o PR é a
unidade — nenhuma etiqueta repete o que o nível de baixo já diz.

## 2. Geometria confirmada (os números são requisito)

- Painéis: mapa **480px** (esquerda) · terminal **flex:1** (centro) · detalhe **316px**
  (direita). Confirma CA-7/CA-8 e a medição da lição "o design foi comprimido".
- Card de nível: **392px**, `border-top: 2px` na cor do tone quando em foco.
- **Opacidades do carrossel:** `1` no card em foco · **`0.34`** nos irmãos do nível em
  foco · **`0.22`** nos cards de níveis fora de foco. (A spec falava de 34%; o segundo
  patamar, 22%, é novo e é do design.)
- Alturas de nível: **402px** no nível de planos em foco (`tall`), **206px** nos outros
  em foco, **124px** fora de foco; gap **14px**; `translateY = 110 − offset(nível)`.
- Eixo horizontal: `translateX = −índice × 404px` (392 + 12 de gap).
- Ornamento condicional confirmado: contador "N de M" e setas `‹ ›` **só** quando
  `cards.length > 1` (CA-13).
- Trilha do card em foco: linha de **24px**, **32px** na linha "é a próxima"; rail
  `├`/`└`; glifo quadrado de **16px**; `PhaseChip`; fase; `StateDot`; botão
  **"⌁ Preparar"** só na próxima. Sem legenda (CA-28 cumprido).
- Estados (glifo + cor, dupla codificação): `○` não rodou · `▶` em execução · `✓`
  concluída · `✕` falhou · `⊘` travada · `→` é a próxima.

## 3. Extensões novas do sistema (4, todas marcadas como aprovadas no mockup)

| # | nome | tipo | resolve |
|---|---|---|---|
| 5 | `LevelCarousel` | componente novo | o trilho de dois eixos; sabe encurtar quando um nível não existe e absorver o caminho documental de 2 níveis |
| 6 | `HomologationClock` | componente novo | a janela de 24h, 4 degraus, variante compacta para a barra |
| 7 | `TerminalTab · variante v3` | variante de existente | ícone de estado no lugar do farol, faixa de cor do operador, alça de arraste |
| 8 | `PhaseChip · variante documentacao` | variante de existente | 6º valor de chip para o caminho documental, usando `--donel-accent` |

Somadas às 4 da leva anterior (`PhaseStateGlyph`, `AnnotationTag`, `WorktreeCard`,
`ArmedPrompt`), o sistema fica com **8 extensões nomeadas**. **Conferido:** o mockup não
introduz **nenhum hex novo** — todos os tokens que ele usa (`--state-done`,
`--state-error`, `--donel-accent`, `--zone-ok/warn/over`, `--overlay-modal`) já existem
em `design-system/src/tokens.css`.

## 4. Divergências — e quem vence cada uma

**D-V1 · O rodapé do mockup mostra tokens, a spec pede `%`.** No print 2a a barra é
`fable/high · 4 sessões · [barra] 312k/400k`. **Vence a spec (CA-22):** o `%` é o dado
que ele nomeou ("o acompanhamento de contexto % sumiu"). Implementado em 29/07 como
`contexto 45% · 135k/300k` — o `%` acrescido ao rótulo do medidor, mantendo a forma
desenhada (mini medidor no slot `smartZone`).
**Divergência que eu assumi por cima disso:** o rótulo textual **"contexto"** antes do
medidor não existe no mockup. Motivo: o `accountLabel` ao lado já mostra um `%` (a cota
do perfil), e dois percentuais sem dizer de quê foi confusão relatada na rodada 6 da 006.
Se ele preferir a barra sem rótulo, é remover uma linha.

**D-V2 · Régua de 400k no mockup, 300k na decisão dele.** O mockup passa
`smart-zone="{{ {usedTokens} }}"` sem denominador, caindo no default de 400k da lib.
**Vence a decisão de 24/07:** `min(300k, janela do modelo)` via `effectiveContextZone`.
Já é assim no código. Ver `specs/backlog.md` §B16.

**D-V3 · A trava aparece como arquivo `.lock` em dois lugares do mockup.** O texto do
terminal (`PRJ-143:impl-1`) mostra `.esteira/locks/143-implementar.lock` e o modal de
liberar trava diz "remove o arquivo de trava". **Vence a spec:** na v3 a trava é
**etiqueta do board**, nunca arquivo em disco — é a divergência **D1** já registrada na
verificação de 27/07, e ela reincidiu. O resto do tratamento da trava no mockup (etiqueta
no card + botão "⊘ Liberar trava…" + modal que só prepara o comando) está correto;
só o **vocabulário** dos dois textos é que não pode ser copiado.

**D-V4 · `--fase 1` (espaço) no mockup, `--fase=n` no contrato.** Os comandos preparados
usam `'/esteira-validacao ' + p.id + ' --fase ' + n`. **Vence o contrato v3**
(`006-esteira-v3/contracts/handoff-v3.md` §F). Detalhe pequeno com efeito real: o comando
é o que vai para o prompt.

**D-V5 · nome da fase documental: `documentar` (spec) × `documentacao` (chip).** O mockup
usa `chip: 'concluir'` com um `docChip` por cima, e a extensão 8 chama a variante
`documentacao`. **Decidir na implementação e usar um nome só:** recomendo `documentar`
para o valor de `EsteiraPhase` (é o que a spec e as skills usam) e aceitar
`documentacao` apenas como rótulo visível do chip.

**D-V6 · o modo "Uso geral" do mockup ressuscita o painel de detalhes da sessão.** No
quadro 2a, o modo geral tem painel direito com `SmartZoneMeter` completo, `AccountBadge`,
Modelo, Esforço, Permissões, aviso de permissão e `PostItCard`. Esse painel
(`SessionDetails`) **foi removido dos dois modos a pedido dele em 27/07** — "não tem sido
nem um pouco útil" (`App.tsx:1878`). **Vence a decisão dele**, que é mais recente que o
desenho e específica: não reintroduzir sem ele dizer que mudou de ideia. Fica como
**pergunta a ele**, não como tarefa.

**D-V7 · a engrenagem ganhou um terceiro campo.** CA-23 pedia **board + repo**; o mockup
pede também **"Base de conhecimento (opcional)"**, com a nota "sem ela, o mapa
simplesmente não mostra recibos — nunca cobra". É **alcance novo** (a spec vence), mas é
alcance *aditivo, opcional e coerente* com a seção "Recibos de conhecimento" do painel
direito. **Recomendo aceitar** e registrar como extensão de CA-23 — decisão dele.

## 5. O que o mockup declara que saiu de cena

A fileira de botões de fase na faixa superior (progressão vive só no mapa) · a legenda
dos dois eixos no rodapé do mapa · o prefixo `[M1]` e a palavra *marco* · aprovação de PR
como fato exibido · o subconjunto de Validar · a duplicação de trava, divergência e estado
entre nó, botão e detalhe. E, dentro do Modo Dev, **nem `SplitButton` nem `PostItCard`** —
os dois vivem só no modo uso geral.

## 6. Ordem de implementação que este handoff habilita

O desenho **não** desbloqueia tudo: o mapa depende das fontes v3 que ainda não existem
(raiz nova do handoff, `gh`, coluna do board). O que ele desbloqueia **agora**, com dados
reais já no app, é a **extensão 7 — `TerminalTab · variante v3`** (CA-26 reordenar, CA-27
cor, CA-28 ícone), que era o único bloco parado por falta de forma. A fila completa,
lote por lote, está no vault: `Projects/donel-dev/implementar-009-modo-dev-v3/PROXIMO.md`.
