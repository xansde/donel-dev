---
demanda: carta-oraculo
plano: invocação direta (tarefa do Oráculo Harrow, pedido do dono em 05/11)
taskdex: []  # Donel Dev não usa TaskDex; o registro é a tarefa no Oráculo Harrow
status: decidido
decidido-por: Alexandre (dono), repassado pelo Líder único
decidido-em: 2026-11-05
---

# Decisão de UI — Cartas do Oráculo que se entendem

## Pergunta

Que forma de carta faz o dono entender, em 5 segundos e sem abrir link, o que decide, a
recomendação, o efeito de cada opção, um visual e o risco (celular e desktop)?

## Base visual

- Carta: tokens de `src/main/celular/pwa/app.css` (claro e escuro) e glifos de
  `src/main/celular/pwa/app.js`, lidos em `origin/staging`.
- Moldura do desktop: `design-system/src/tokens.css` (dark-only).
- Jobu: `src/renderer/src/pet/assets/poses/talking.png` (copiado como `jobu.png`).
- Dados: `%APPDATA%\donel-dev\ledger.json` (só leitura, 05/11 ~14h): as tarefas da fase 2 da
  VPS, da conta sem limite e do painel de progresso.

## Ângulos gerados

- **A — Carta Harrow**: baralho de verdade; a frente decide, o verso explica.
- **B — Conversa com o Jobu**: o Jobu conta a história em falas; as opções ficam fixas embaixo.
- **C — Visual grande**: o visual primeiro (metade do celular, coluna larga no desktop); a decisão numa folha ao lado.
- **D — Escolha o caminho**: cada opção é um bloco com o futuro (sinal), o efeito e o risco daquele caminho.

Proposta de contrato e régua de quando sobe ao dono: `contrato.html`.

## Escolha

**Forma A, Carta Harrow**: a frente decide e o verso explica, no celular e no desktop. Compilada em `final.html`.

Nas palavras do dono (05/11): “A ideia é ser a forma A. Mas não existe suporte para eu ver os
protótipos nas próprias cartas nem como escrever lá. É esse tipo de coisa que falta.” Antes,
no mesmo dia: “Esse negócio de código das tarefas não me explica nada. Sou um humano, coopera
comigo, por favor.” e “Podemos lançar uns protótipos interessantes das cartas para decidir.”

Por isso o `final.html` traz, além da forma A, as duas lacunas que ele apontou:
- **protótipo dentro da carta**: a carta 3 roda o HTML anexado pelo Dev, isolado
  (`iframe sandbox="allow-scripts"`), com Antes e Depois clicáveis dentro dela;
- **escrever na carta**: “✎ Escrever para <quem fez>”, texto livre que vai a quem fez a tarefa.

Decisões em aberto que o Líder fechou com as recomendações desta etapa, até o dono dizer o
contrário: decisão com **opções com nome** (não só aceitar ou rejeitar); **quadro de checagens
desenhado** pelo app quando não há tela; protótipo sobe ao dono **só quando há 2 jeitos bons**.

Spec para implementar: `docs/specs/cartas-forma-a.md`.

## Descartado

- **B — Conversa com o Jobu**: o dono escolheu a carta; a conversa fica como ideia para o balão do Jobu, sem compromisso.
- **C — Visual grande**: o visual grande cabe na frente da A; não precisou de forma própria.
- **D — Escolha o caminho**: o risco por caminho foi para o verso da A.

## Limitações do mock

- Os textos “para o dono” foram reescritos por mim a partir do critério, da nota e das provas:
  é o que o contrato novo pediria a quem entrega. Hoje nenhum agente escreve assim.
- A carta do painel de progresso é **simulada**: em 05/11 14h a tarefa ainda estava em
  execução. O antes/depois foi redesenhado com as tarefas reais do quadro, não é print do app.
- As cartas da VPS e da conta já tinham sido aceitas pelo dono; aparecem como pendentes.
- Nada grava: tocar numa opção só passa para a próxima carta; “Enviar” do escrever só mostra o recibo.
- O protótipo embutido do `final.html` usa `srcdoc`; no app ele vem como arquivo de prova servido com CSP própria (ver a spec).
- O gesto de arrastar (aceita/rejeita) da PWA atual não foi reproduzido.
