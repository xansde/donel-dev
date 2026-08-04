# Mapa — Contas & Provedores (wayfinder)

Label: wayfinder:map
Criado: 2026-08-04 · Origem: discovery da esteira `dsc-dfeead0d-bf9` (run `run-7085d8e4-391`)

> **MAPA CUMPRIDO em 2026-08-04** — frontier zerada (7/7 tickets resolvidos).
> Handoff: `/speckit.specify` (specs/NNN-contas-e-provedores). Itens em
> "Not yet specified" são pós-v1 deliberados, não pendência do mapa.

## Destination

Especificação fechada da frente **Contas & Provedores** (via `/speckit.specify`,
numa pasta `specs/NNN-contas-e-provedores/`): motor de contas próprio do Donel
(lógica do claude-switcher absorvida, pool plugável, sem dependência de runtime
do repo da Seazone) + registry de providers por sessão no launcher (modelo T3
Code) — com toda decisão de rota tomada e nenhuma pergunta aberta que trave o
plano.

## Notes

- Skills por sessão: `/grilling` e `/domain-modeling` (plugin esteira).
- Referências verificadas: `seazone-tech/claude-switcher-api` (README lido;
  código sob análise no ticket 02) e `pingdotgg/t3code` (MIT, ~16,6k ⭐; docs
  user e internals lidos — provider = driver+adapter por CLI, multi-conta
  Claude via `CLAUDE_CONFIG_DIR` por provider, segredos como server secrets).
- **Decisões de entrada** (entrevista do discovery, 04/08): perfis paralelos
  deixam de ser o meio de trocar conta do pool; a lógica do switcher é
  ABSORVIDA (vendorizada — funciona mesmo com desligamento da Seazone);
  independência é de código, não de infra hoje (backend pode ser a API Seazone
  enquanto durar); MCPs em config única que sobrevive à troca; Composio é
  ortogonal (MCP server com API key própria, quando a conta existir); escolha
  de provider é manual por sessão.
- Regras do repo: o app nunca lê/exibe credenciais; LGPD (sem nomes em
  artefato); `.scratch/` é versionado.
- Correção fina ao veredito do ticket 01/04: a injeção de env no spawn do PTY
  (`pty-manager`) NÃO morre — perde o papel "config dir por perfil" e ganha o
  papel "env por provider da classe A" (ticket 05).

## Decisions so far

<!-- uma linha por ticket resolvido: gist + link -->

- [Inventário de dependências no donel-dev](issues/01-inventario-dependencias-donel.md)
  — perfis: `profile-manager` e 4 smokes morrem, headroom/UI/rótulos mudam de
  fonte; premissas Claude-only: commandBuilder, hooks/semáforo (dura),
  session-indexer, openPhaseSession; colisão com a 010 concentra-se no hub
  `src/main/index.ts` e em `openPhaseSession.ts`.
- [Anatomia do código do claude-switcher](issues/02-anatomia-claude-switcher.md)
  — cliente Python stdlib ~4,2kL / servidor FastAPI ~4,8kL; adoção sem
  reiniciar = reescrever `.credentials.json` + apagar `oauthAccount` de
  `~/.claude.json`; auto-switch 90/20 (power-of-two-choices); **refresh do
  token é do SERVIDOR** (e há um monitor externo de pool) — clone só do
  cliente não renova sozinho; porte TS estimado em 2–4 dias, refresh local
  viável apenas para contas próprias.
- [Renovação de token e guarda de segredos no pool próprio](issues/03-renovacao-token-pool-proprio.md)
  — **motor de contas vira interface e cada backend é um MOD** (mod Seazone ×
  mod local); exceção à regra de credenciais confinada no mod local; cofre em
  `safeStorage`; **switch-time-only, sem heartbeat** (refresh HTTP só como
  fallback); carga via endpoint OAuth de uso. Rima a explorar no ticket 05:
  provider de CLI como segunda família de mods.
- [Destino de cada dependente de perfis](issues/04-destino-dependentes-de-perfis.md)
  — `profile-manager`/junctions morrem sem herdeiro; dropdown 002 vira UI do
  motor; rótulo de conta muda de fonte (fato no disparo); **B8/US-12 e
  auto-switch absorvidos no motor** (saem do backlog); B10 fica e simplifica;
  spec 002 + histórico 001 viram registro superseded.
- [Corte mínimo do registry de providers](issues/05-corte-do-registry-de-providers.md)
  — duas classes: **A Claude-compatible** (binário `claude` + env + config dir
  próprio; experiência completa) e **B CLIs terceiros** (só terminal; nasce
  VAZIA, sem piloto). V1 só com a A, estreando **OpenRouter** (chave no
  Bitwarden; WSL verificado, nada a migrar — config do zero no Windows).
  Provider = segunda família de mods.
- [Migração do dia da virada](issues/06-migracao-dia-da-virada.md)
  — importação assistida das credenciais dos perfis para o cofre (seed do
  pool, OK perfil a perfil); transcripts consolidados em `~/.claude/projects`;
  MCPs sem merge automático (diff manual); junctions desfeitas e
  `~/.claude-profiles` ARQUIVADO, nunca deletado na virada; userData intocado.
- [Convivência com a 010 em voo](issues/07-convivencia-com-a-010.md)
  — spec já, código pós-batches da 010; fronteiras de arquivo fixadas (risco
  restante: só `index.ts`); implementação em 3 etapas: motor+mod Seazone →
  demolição/migração → registry classe A.

## Not yet specified

- UI de gerenciamento de MCPs & integrações no Donel (inclui Composio) — só
  fica nítido depois do modelo de config única (tickets 02→03).
- Mods externos carregáveis (código de fora do repo no main process) — hoje os
  mods nascem in-repo; abrir para fora exige sandbox pensado. Névoa distante.
- Resume/fork e indexação de sessões para CLIs não-Claude (classe B plena) —
  obra por CLI, só quando um CLI real entrar na classe B.

## Out of scope

- **Fallback automático para provedor gratuito quando o pool encher** —
  decidido na entrevista: escolha manual no launcher basta. Voltaria só com o
  destino redesenhado.
- **Dependência de runtime do repositório/infra da Seazone** — vetada por
  requisito do dono; a integração com a API deles é um backend plugável, nunca
  acoplamento.
