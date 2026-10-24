# Handoff de design — Chat (spec 014) · leva de 2026-10-07

Protótipo de forma da **Fase 0** da 014, pedido por `design/prompt-design-chat.md`
(10 telas). A conta antiga do Claude Design não existe mais. Este protótipo foi
desenhado a partir desta sessão do Claude Code, num canvas de design da conta
atual, que é compartilhada.

- **Canvas (temporário):** `https://claude.ai/artifact/Ef4aNVD6m8Ru7Z7q4tVrYR`.
  Ele será **apagado** depois da aprovação, a pedido do dono, para não poluir a
  conta. Esta pasta é o backup.
- **Arquivos:** `project/canvas.json` (índice dos quadros) e um `.dc.html` por
  quadro:

| Quadro | Tela |
|---|---|
| `Main.dc.html` | 1 · Conversa com Modo Foco ligado (interativo) |
| `T02-foco-desligado.dc.html` | 2 · Mesma rodada, Modo Foco desligado |
| `T03-pendencia-pergunta.dc.html` | 3 · Pendência: pergunta com opções (interativo) |
| `T04-pendencia-permissao.dc.html` | 4 · Pendência: permissão (comando, edição, subagente) |
| `T05-pendencia-plano.dc.html` | 5 · Pendência: plano (aprovar / pedir ajuste) |
| `T06-caixa-de-escrever.dc.html` | 6 · Caixa de escrever: menus, anexos, estados de envio |
| `T07-subagentes.dc.html` | 7 · Subagentes: linhas vivas, faixa, painel lateral (interativo) |
| `T07b-subagentes-1280.dc.html` | 7b · Subagentes em 1280×760 |
| `T08-faixas-e-avisos.dc.html` | 8 · Faixas, barras e avisos |
| `T09-comeco-e-carregamento.dc.html` | 9 · Começo da sessão e carregamento |
| `T10-aba.dc.html` | 10 · A aba: alternância Chat \| Terminal |

## Runtime — não duplicado aqui

Os quadros carregam `donel/styles.css`, `donel/_ds_bundle.css` e
`donel/_ds_bundle.js`, o bundle compilado do design system do Donel. Ele é
**idêntico** ao que já está versionado em
`design/modo-dev-v3-handoff/project/_ds/donel-dev-design-system-f6d68514-32ea-4734-9d90-1d716533bf62/`.
Para abrir um quadro localmente, copie aqueles três arquivos para
`project/donel/`. O `support.js` é do runtime do canvas.

## Próximo passo

A conferência contra a spec vai para `design/chat-verificacao.md` (gate da
Fase 0). Ela leva junto as decisões de forma do designer (A–F), as extensões
propostas e os comentários feitos no canvas.
