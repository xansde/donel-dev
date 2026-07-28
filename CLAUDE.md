# donel-dev — contexto do projeto

IDE própria do Alexandre: Electron + xterm.js + node-pty embedando o `claude`
CLI, com sidebar de projetos, abas de terminal, launcher (modelo/esforço/
permissões), sessões anteriores (retomar/fork) e perfis de conta compartilhada
via `CLAUDE_CONFIG_DIR`.

## Repositório e canais (modelo alfa/beta/stable — redefinido em 2026-07-28)

- **Remoto**: `https://github.com/xansde/donel-dev` (privado, conta pessoal
  `xansde`; `xansde-seazone` é colaborador com permissão de escrita).
- **Modelo de branch = modelo de canal** (escada de maturidade, do mais cru ao
  fechado):
  - `feature/*` → trabalho em andamento; integra em `staging` por PR.
  - `staging` → canal **alfa**: a novidade cai aqui primeiro e é olhada aqui.
  - `main` → canal **beta**: sobe quando o Alexandre validou o alfa e confia.
  - `xansde/donel` (repo público) → canal **stable**: só release fechado e
    versionado — ver a seção abaixo.
- Versão anterior deste modelo (24/07, pré-repo público) chamava `main` de
  stable; o público assumiu esse papel e o `main` privado desceu para beta.
- **Regra dura (inalterada)**: push/PR/merge em `main` e publicação no repo
  público só com instrução literal do Alexandre. "Comita", "deploya",
  "atualiza staging" NÃO autorizam tocar em `main` nem no público.
- **Os canais instalados ainda NÃO estão isolados no app** — os instaladores
  compartilham `appId`, `productName`, `app.setName('donel-dev')` e portanto o
  mesmo `userData`. O isolamento é o item **B10** do `specs/backlog.md`; até ele
  ser implementado, a distinção entre canais instalados é só pasta e atalho.

## Repo público (canal stable) — aberto em 2026-07-27

- **Remoto**: `https://github.com/xansde/donel` (**público**, MIT). Cópia de
  trabalho local: `../donel-dev-publico`.
- **Papéis**: este repo é o de **trabalho** (specs, docs de processo, histórico
  completo); o público é o **estável** — só o app, para quem quiser clonar e
  buildar na própria máquina. Não há histórico compartilhado entre os dois.
- **Nunca vão para o público**: `specs/`, `docs/`, `scripts/`, `design/`,
  `.claude/`. O público tem `README.md`, `LICENSE` e `CLAUDE.md` **próprios**,
  editados à mão — o sync não os sobrescreve.
- **Promover**: `powershell -File scripts/sincronizar-publico.ps1` espelha
  `src/ tests/ patches/ design-system/` + configs de build e imprime o `git
  status` do lado público. Ele **não** commita nem faz push — revisar, rodar
  `npm test` lá e commitar à mão. `package.json` diverge de propósito
  (license/repository/author + scripts `publicar*`): o script avisa quando
  versão ou dependência mudou, para levar a mão.
- **Vocabulário interno fica fora**: nomes de projeto real em fixture/story
  foram trocados por genéricos (`atlas`, `beacon`, `vega`) **nos dois repos**,
  justamente para as árvores continuarem idênticas. Ao criar fixture nova, usar
  nome genérico. Ainda expostos e assumidos: `Esteira`/`EsteiraPhase` e
  `TaskDex` (intenção de design real, não placeholder) e `seazone` como nome de
  pasta-raiz default.

## Regras do projeto

- **Fonte de verdade do escopo**: `specs/001-mvp/` (spec → plan → tasks).
  Não implementar nada fora das tasks sem atualizar a spec primeiro.
- **Gate ativo**: o Alexandre aprovou apenas spec/plan (2026-07-22). Implementar
  código do MVP exige novo OK explícito dele.
- **T001 (spike de perfis) é bloqueante**: nenhuma UI de perfis antes do spike
  validar `CLAUDE_CONFIG_DIR` — resultado vai em
  `specs/001-mvp/spike-t001-resultado.md`.
- **Credenciais**: o app NUNCA lê, grava ou exibe credenciais. Login acontece
  exclusivamente dentro do terminal, pelo fluxo oficial do CLI.
- **TDD com escopo**: CommandBuilder, SessionIndexer e paths de perfil são
  módulos puros com vitest; PTY/UI validam por smoke roteirizado (T014).
- UI em pt-BR; código, comentários e identificadores em inglês.

## Issue tracker (para skills que precisam de um)

Este repo usa **local-markdown**: mapa e tickets em `.scratch/<effort>/`,
versionados. A convenção completa está em `.claude/issue-tracker.md` — ler antes
de rodar `/wayfinder` ou qualquer skill que fale em "issue tracker". Não é
TaskDex: o Donel Dev é ferramenta pessoal, sem `.taskdex.json`.

**Mapa ativo — "Modo Dev do Donel Dev".** Mora no vault Claude Seazone, em
`Projects/donel-dev/wayfinder-modo-dev/` (não em `.scratch/`, apesar da
convenção acima — divergência conhecida, resolver movendo se incomodar).
Pedido "**wayfinder no próximo MD**" = abrir `PROXIMO.md` daquela pasta e pegar
o primeiro `⬜`; a ordem **não é numérica**. Prompts prontos em `sessoes.md`.
**O mapa está CUMPRIDO desde 27/07** (MD-01..MD-08 resolvidos) — ele virou a
entrega `specs/003-modo-dev/`. Só voltar ao mapa se a spec parecer contraditória.

## Gatilho — "implementar melhorias Modo Dev"

Pedido "**implementar melhorias Modo Dev**" (ou "implementar o próximo lote do
Modo Dev") = abrir a fila
`Claude Seazone/Projects/donel-dev/implementar-modo-dev/PROXIMO.md` no vault e
pegar o **primeiro lote `⬜`**. Aqui a ordem **é** sequencial. Prompt pronto (e a
variante de retomada) em `prompt.md`, na mesma pasta.

Fonte de verdade do escopo: `specs/003-modo-dev/spec.md` (26 CA). Forma da UI:
`design/modo-dev-handoff/project/Modo Dev.dc.html` **lido junto de**
`design/modo-dev-verificacao.md` — onde o mockup e a spec discordam, **vence a
spec** (o mockup tem 5 divergências conhecidas, D1–D5; a mais séria: a trava é
etiqueta do board, nunca arquivo `.lock`). Um lote por sessão; PR é ato humano.

## Gotchas conhecidos (do planejamento)

- node-pty precisa casar com a ABI do Electron — prebuilds/@electron/rebuild;
  pin de versões testadas.
- `~/.claude-profiles` fica no home local, nunca no OneDrive (junctions).
- Transcripts JSONL nunca são lidos inteiros — streaming + stat.
- Junction em Node: `fs.symlinkSync(target, path, 'junction')` — não pede admin.

## Vault

Documentação viva em `Claude Seazone/Projects/donel-dev/` (context.md, todo.md).
Atualizar ao concluir marcos.
