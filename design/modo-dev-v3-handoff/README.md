# Handoff de design — Modo Dev v3 (leva de 2026-07-29/30)

Segunda leva de design do Modo Dev, pedida por `design/prompt-design-modo-dev-v3.md`
depois do Discovery e da spec `specs/009-modo-dev-v3/`. Sucede
`design/modo-dev-handoff/` (leva de 27/07), que fica como registro da v2.

- **Projeto no Claude Design:**
  `https://claude.ai/design/p/351e1df2-0d13-4fc3-a5eb-cedac6183092?file=Modo+Dev+v3.dc.html`
- **Arquivo principal:** `project/Modo Dev v3.dc.html` (1319 linhas) — quatro quadros:
  - **2a** — Modo Dev, 1440×900, interativo (o desenho a implementar).
  - **2b** — Sessões anteriores: coluna de conta por linha, engrenagem de
    configuração do projeto, criação de projeto.
  - **2c** — Estudos de estado: os quatro degraus do relógio de homologação e a
    anatomia da aba v3.
  - **2d** — Mapa de componentes, as duas decisões que eram do designer, as quatro
    extensões novas e a lista do que saiu de cena.
- **Verificação contra a spec:** `design/modo-dev-v3-verificacao.md` — ler **junto**
  com o mockup. Onde os dois discordarem em **forma**, vence o design; em **alcance
  ou comportamento**, vence a spec (regra "confia no design sempre", D1 do
  Discovery).

## Assets de runtime — deliberadamente não duplicados

O projeto remoto também tem `support.js`, `_ds/donel-dev-design-system-f6d68514-…/`
(`_ds_bundle.js`, `_ds_bundle.css`, `styles.css`) e `uploads/`. **Não estão
versionados aqui**: são o runtime do Claude Design e o bundle compilado do nosso
próprio design system — 600 KB de binário que já existem em
`../modo-dev-handoff/project/`, com o **mesmo UUID de design system**
(`f6d68514-32ea-4734-9d90-1d716533bf62`).

Para abrir o mockup localmente, copie ao lado do `.dc.html`:

```bash
cp -r ../modo-dev-handoff/project/_ds ../modo-dev-handoff/project/support.js \
      ../modo-dev-handoff/project/uploads project/
```

A fonte de verdade dos componentes é `design-system/src/`, não o bundle — o bundle
é a versão que o mockup consumiu, útil para conferir o que o designer tinha em mãos.

## O que o mockup vale como referência

Prototipagem em HTML/CSS/JS: **reproduzir o resultado visual**, não a estrutura
interna (o `.dc.html` usa `x-dc`/`sc-for`/`sc-if` do Claude Design, que não existem
no app). Os **números** do mockup são requisito — largura de painel, altura de
nível, opacidade de vizinho, tamanho de card. Ver a lição
"o design foi comprimido" no vault (`Projects/donel-dev/lessons.md`).
