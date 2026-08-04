# Migração do dia da virada

Type: grilling
Status: resolved
Blocked by: 01, 04

## Question

No dia em que os perfis paralelos deixam de ser o meio de trocar de conta: o
que acontece com as sessões históricas, favoritos, defaults do launcher e
configs de MCP dos perfis existentes em `~/.claude-profiles`? Consolidar na
config única, arquivar, ou manter leitura-somente? E as junctions existentes —
desfazer quando?

## Answer

Pacote de migração aprovado pelo Alexandre (04/08):

| Item | Decisão |
|---|---|
| Credenciais por perfil (`.credentials.json`) | **Importação assistida única** para o cofre (`safeStorage`) no primeiro boot do motor — seed do pool próprio, com OK na tela perfil a perfil; evita relogar |
| Transcripts (`<perfil>/projects/*.jsonl`) | **Consolidar** copiando para `~/.claude/projects/<slug>/` (ids únicos); histórico e "retomar" preservados |
| Config de MCPs (`.claude.json` por perfil) | **Sem merge automático**: `~/.claude` real é a base; diffs de MCP exclusivos de perfil são listados para decisão manual |
| Junctions + diretórios | **Desfazer junctions e ARQUIVAR** (`~/.claude-profiles` → `.old`); **nunca deletar** na virada — deleção é gesto humano posterior |
| Favoritos/defaults do launcher (userData) | **Intocados** (nunca foram por perfil) |
