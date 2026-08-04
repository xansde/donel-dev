# Inventário de dependências no donel-dev (perfis, Claude-specific, 010)

Type: research
Status: resolved

## Question

O que exatamente no donel-dev (a) depende de perfis/`CLAUDE_CONFIG_DIR`/
junctions/`~/.claude-profiles`, (b) assume formato ou comportamento específico
do Claude Code CLI (transcripts JSONL, launch flags, resume/fork, hooks/
semáforo, Modo Dev), e (c) se cruza com os arquivos que a spec 010 (Esteira)
está tocando em voo? Cada item com arquivo:linha, papel, e veredito
morre/muda/fica nos modelos switcher e multi-CLI.

## Answer

Varredura completa (research subagent, 04/08). Síntese por bloco; vereditos
morre/muda/fica referem-se aos modelos switcher (contas) e multi-CLI (providers).

### (a) Dependentes de perfis/`CLAUDE_CONFIG_DIR`/junctions

**Morre inteiro (núcleo do mecanismo):**
- `src/main/profile-manager.ts:51-627` — módulo todo: junctions (6), doctor,
  repair, delete, probe de bootstrap com `claude -p "OK" --model haiku`.
- `src/main/transcript-copy.ts:13,50` — resolução de transcript por perfil;
  vira sempre `~/.claude/projects`.
- Lógica de override por env no spawn: `src/main/pty-manager.ts:39-134`.
- Testes: `tests/profile-manager.test.ts` (726 linhas, quase todo),
  `tests/smoke/profiles.spec.ts` (360), `profile-quota.spec.ts` (170),
  `profile-switcher-focus.spec.ts` (77), parte de `pty-manager.test.ts` e
  `transcriptCopy.test.ts`.

**Muda (conceito sobrevive, forma nova):**
- `src/main/quota-headroom.ts:132-349` — `readAllProfilesHeadroom` roda
  quota-axi por config dir; no switcher "todas as contas" precisa de outra
  fonte de listagem (o pool), não N config dirs.
- `src/main/index.ts:330-627,1201-1301` — estado `activeProfileSlug/ConfigDir`,
  IPC `PROFILE_CHANNELS.*`; troca de conta continua existindo, mas vira "qual
  credencial está escrita", sem configDir por sessão.
- `src/shared/profiles.ts:37-109` — contrato "listar contas" sobrevive, sem
  vocabulário de junction.
- `src/renderer/src/ProfileSwitcher.tsx:29-603` — UI sobrevive (trocar conta),
  textos/mecânica reescritos.
- `src/shared/sessionAccountLabel.ts:37,56,75` (+ consumidores
  `TerminalPane.tsx:98`, `terminalKeymap.ts:7`, `phaseDetailsView.ts:6`) —
  "perfil de nascimento" da aba não existe mais; rótulo precisa de nova fonte
  (conta ativa no disparo, gravada como fato) ou morre.

**Backlog/specs afetados:**
- `specs/backlog.md:10-28` auto-switch — premissa "escolher perfil por
  headroom" morre; vira "trocar credencial ativa" (é o próprio switcher).
- `specs/backlog.md:125-148` B8/US-12 — painel de todas as contas passa a
  listar o pool, não perfis instalados; gotcha do cache global do quota-axi
  deixa de ser o problema central.
- `specs/backlog.md:182-230` B10 — "perfis compartilhados entre canais" morre
  como frase; fundo (dois canais, mesmo `~/.claude`) fica e simplifica.
- `specs/002-quota-headroom/` inteira fica datada (nova spec supersede);
  histórico da 001 (spikes T001/T002, análise switch-account) vira registro
  superseded. `CLAUDE.md`/`README`/`LEIA-ME-colegas`/`CHANGELOG` a reescrever.

### (b) Premissas Claude Code CLI (quebram com codex/opencode/etc.)

- `src/shared/commandBuilder.ts:31-120` — `--model/--effort/--permission-mode`,
  `-r <id>`/`--fork-session` e parser inverso: flags do CLI `claude`.
- `src/main/claude-executable.ts:7-90` — binário fixo "claude" + argsPrefix
  por SO; precisa virar resolução por CLI (registry de launchers).
- `src/main/hooks-settings.ts:1-63` + `session-correlation.ts` — semáforo
  inteiro é o formato de hooks/`--settings` do Claude Code
  (`SEMAPHORE_HOOK_EVENTS`); não existe fora dele. Premissa dura.
- `src/main/session-indexer.ts:13,87-98,439-470` + `transcript-copy.ts` —
  indexação assume `~/.claude/projects/<slug>/*.jsonl`; outros CLIs gravam em
  outro lugar/formato — resume/fork e descoberta de sessão são Claude-only.
- `src/renderer/src/DevMode/openPhaseSession.ts:1-64` +
  `src/shared/devModeDefaults.ts`/`devMode.ts` — abrir fase da Esteira
  pré-digita slash-command de skill (`/esteira-*`) e monta `claude -r`; todo o
  Modo Dev assume CLI-alvo `claude`.
- `src/main/quota-headroom.ts:245-250` — chama quota-axi com `--provider
  claude` fixo; a ferramenta já é multi-provider — ponto de extensão barato.

### (c) Colisão com a 010 em voo

- **Hub de colisão real: `src/main/index.ts`** — hospeda estado de perfil,
  spawn com `buildClaudeArgs` E os IPC da Esteira. Qualquer refator passa por
  ele; risco de merge alto.
- `esteira-dispatch.ts`/`esteira-ingest.ts` NÃO montam comando nem tocam PTY
  (por design) e usam `homedir()` real (`~/.claude/esteira-donel/*`), fora de
  junction — sem colisão com switcher.
- O ponto onde 010 encosta no multi-CLI é `openPhaseSession.ts` (+
  `commandBuilder.ts`): risco médio-alto se as duas frentes mexerem juntas.
- `session-indexer.ts` — tocado pelos dois mundos: multi-CLI muda a indexação,
  e a Esteira depende dela para retomar fase (`kind: 'resume'`).
- Dependência oculta: correlação de sessão via hooks (semáforo) — a Esteira
  depende do sinal para saber quando fase começa/termina; abstrair hooks para
  multi-CLI afeta isso por design, não por arquivo.
- `profile-manager.ts`/`quota-headroom.ts`/`sessionAccountLabel.ts` não são
  tocados pela 010 — listas não colidem em arquivo, só no hub `index.ts`.
