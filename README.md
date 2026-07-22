# Donel Dev

IDE própria do Alexandre: app desktop Windows com terminal embedado rodando o
**Claude Code CLI**, cercado por painéis de organização — projetos, sessões
anteriores (retomar/fork), launcher de modelo/esforço/permissões e perfis de
conta compartilhada (`CLAUDE_CONFIG_DIR`).

Princípio central: **o app não reimplementa o agente** — embeda o `claude` real
num PTY e orquestra o CLI por fora. Hooks, skills, MCPs e Esteira continuam
funcionando sem adaptação.

## Estado

Fase de especificação — código só após aprovação do MVP.

- [specs/001-mvp/spec.md](specs/001-mvp/spec.md) — requisitos e critérios
- [specs/001-mvp/plan.md](specs/001-mvp/plan.md) — arquitetura e riscos
- [specs/001-mvp/tasks.md](specs/001-mvp/tasks.md) — sequência de implementação

## Stack (decidida no plan)

Electron · @xterm/xterm · node-pty (ConPTY) · React + TypeScript +
electron-vite · electron-builder · vitest.
