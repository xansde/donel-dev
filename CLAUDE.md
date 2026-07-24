# donel-dev — contexto do projeto

IDE própria do Alexandre: Electron + xterm.js + node-pty embedando o `claude`
CLI, com sidebar de projetos, abas de terminal, launcher (modelo/esforço/
permissões), sessões anteriores (retomar/fork) e perfis de conta compartilhada
via `CLAUDE_CONFIG_DIR`.

## Repositório e canais (definido em 2026-07-24)

- **Remoto**: `https://github.com/xansde/donel-dev` (privado, conta pessoal
  `xansde`; `xansde-seazone` é colaborador com permissão de escrita).
- **Modelo de branch = modelo de canal**:
  - `main` → canal **stable**, o app que o Alexandre usa para trabalhar.
  - `staging` → canal **teste**, onde a novidade é instalada e olhada primeiro.
  - `feature/*` → trabalho em andamento; integra em `staging`.
- **Regra dura**: push/PR/merge em `main` só com instrução literal do Alexandre.
  "Comita", "deploya", "atualiza staging" NÃO autorizam tocar em `main`.
- **Os dois canais ainda NÃO estão isolados no app** — hoje os dois instaladores
  compartilham `appId`, `productName`, `app.setName('donel-dev')` e portanto o
  mesmo `userData`. O isolamento é o item **B10** do `specs/backlog.md`; até ele
  ser implementado, "stable × teste" é só pasta e nome de atalho diferentes.

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

## Gotchas conhecidos (do planejamento)

- node-pty precisa casar com a ABI do Electron — prebuilds/@electron/rebuild;
  pin de versões testadas.
- `~/.claude-profiles` fica no home local, nunca no OneDrive (junctions).
- Transcripts JSONL nunca são lidos inteiros — streaming + stat.
- Junction em Node: `fs.symlinkSync(target, path, 'junction')` — não pede admin.

## Vault

Documentação viva em `Claude Seazone/Projects/donel-dev/` (context.md, todo.md).
Atualizar ao concluir marcos.
