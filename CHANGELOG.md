# Donel Dev — o que mudou

## 0.1.0 — 26/07/2026

Primeira versão compartilhada.

- **Várias sessões do Claude Code em abas**, cada uma rodando o `claude` de
  verdade — hooks, skills, MCPs e comandos funcionam sem adaptação.
- **Semáforo por sessão**: dá para ver de longe quem está trabalhando, quem
  terminou e quem está esperando uma resposta sua. Sessão aguardando permissão
  sobe para o topo da lista.
- **Painel de projetos**: aponte suas pastas de trabalho e o app lista os
  projetos e as sessões de cada um.
- **Sessões anteriores**: retomar de onde parou ou forkar a partir de um ponto.
- **Launcher**: escolha modelo, esforço e modo de permissões antes de subir a
  sessão.
- **Nomes de sessão**: renomeie pela aba (duplo-clique ou F2) ou use `/rename`
  dentro da sessão — o app acompanha e reflete na hora.
- **% de contexto consumido** na barra da sessão, para saber quando fazer
  handoff antes de a janela apertar.
- **Perfis de conta**: mais de uma conta Claude na mesma máquina, isoladas por
  `CLAUDE_CONFIG_DIR`.
- Instalação **por usuário, sem admin**.
