Type: task
Status: open

# Encanamento da C17 parado no meio + segredo órfão no cofre

Origem: fase Validar da etapa 3 (`wi-registry-providers-classe-a`, 2026-08-04),
findings **não bloqueantes** F-1 e F-2 — confirmados no código pela
sessão-cockpit antes do merge em `staging`. Não travam a integração (o gate
passou com `blocking_findings: []`), mas são dívida nomeada, não "detalhe".

## F-1 — sessão com provider some do painel "Sessões anteriores" (prioridade)

A C17 prometeu: *a sessão carrega `providerId` de nascimento e o painel de
sessões anteriores segue o provider selecionado, com a limitação visível na
UI*. Foi assim que o achado **A1** do `analyze` (HIGH) foi resolvido no
`plan.md` — sem ampliar promessa.

**O encanamento parou no meio** (verificado):

- `src/renderer/src/TerminalPane.tsx:114` declara a prop
  `onProviderResolved` e a dispara internamente (`:345`), mas
  **nenhum ancestral passa a prop** — `grep onProviderResolved
  src/renderer/src/App.tsx` não retorna nada. É código morto.
- O caminho de sessões anteriores (`indexProjectSessions` via
  `claudeHome`, `src/main/index.ts:192,517`) respeita o override de
  `accounts.claudeHome`, mas **não** o config dir do provider
  (`<userData>/providers/<id>/`).

**Efeito no uso**: uma sessão lançada com provider grava o transcript em
`<userData>/providers/<id>/projects/...` (isso funciona — smoke T1323 cobre),
mas ela **não aparece** no painel "Sessões anteriores", e **sem aviso** — que
era justamente a metade da C17 destinada a evitar "lista vazia sem
explicação".

Nota de honestidade: a **T1321** está marcada `[x]` no `tasks.md` com esse
item no DoD. O grosso da task foi entregue (UI de gerenciamento, write-only,
recusa de classe B), mas este pedaço do DoD não foi — registrado aqui em vez
de desmarcar a task inteira.

**Opções** (decisão de produto, não do fix): (a) passar a prop e fazer o
painel seguir o provider selecionado, como a C17 escreveu; (b) manter a
limitação mas **mostrá-la** (nota de origem no painel). O que não pode
continuar é o silêncio.

## F-2 — segredo órfão no cofre

O campo de segredo do `ProviderForm` itera `provider.envKeys` (união
diagnóstica de chaves), o que permite gravar no cofre uma entrada para uma
variável que **não** está em `secretEnvKeys` — ela nunca é lida no
`buildProviderEnv` e **não é apagada** pelo `remove()` do provider. Fica
segredo residual no cofre sem dono.

Correção esperada: o formulário oferece só as chaves de `secretEnvKeys`, e/ou
o `remove()` varre o namespace `provider:<id>` inteiro.

## F-3 — placeholder com `/v1`

Já registrado na [issue 09](09-ux-cadastro-provedores.md), continua lá.

## DoD

- Sessão com provider aparece no painel, ou a limitação está visível na UI.
- Nenhuma prop órfã (`onProviderResolved` com chamador ou removida).
- Impossível gravar no cofre segredo que ninguém lê; `remove()` não deixa
  resíduo.
