---
name: Demolição dos perfis e migração assistida
type: adr
status: accepted
created: 2026-08-04
updated: 2026-08-04
tags: [adr, contas, perfis, migracao, 011-contas-e-provedores]
aliases: [ADR-0002, demolição dos perfis, migração assistida, MigrationWizard]
---

# ADR 0002 — Demolição dos perfis e migração assistida

<!-- managed:start -->

## Contexto

O ADR 0001 introduziu o motor de contas e deixou registrado, como invariante
própria, que nenhuma linha de perfis seria removida naquela etapa: motor
inerte e perfis vivos coexistiram de propósito, para validar o motor no canal
alfa sem apostar o fluxo que funcionava. Essa coexistência tinha prazo — dois
mecanismos de conta no mesmo app significam textos de garantia que descrevem
mal um ao outro, configuração de MCP duplicada por perfil e um dropdown que
promete uma troca que o motor faz melhor.

O gate para demolir foi cumprido antes de qualquer remoção: o dono executou um
switch real pelo motor (merge da etapa 1 em staging) e reconfirmou a decisão
no disparo desta etapa. Só então a fonte antiga morreu.

Restava o problema de transição: máquinas com perfis reais em
`~/.claude-profiles` guardam credenciais, transcripts e config de MCP que não
podem se perder na virada. O pior caso do domínio molda o desenho inteiro —
cada perfil contém **junctions** apontando para dentro de `~/.claude`
(inclusive `projects`), então qualquer verbo de deleção aplicado à árvore de
perfis pode atravessar o link e destruir o `~/.claude` verdadeiro.

## Decisão

Demolir o mecanismo de perfis por completo e entregar, no lugar da virada
manual, uma **migração assistida** (`src/main/accounts/migration/` +
`MigrationWizard.tsx`): inventariar os perfis existentes, importar as
credenciais para o cofre do mod local, consolidar transcripts que forem reais,
relatar diferenças de MCP e arquivar a árvore antiga **por renomeação**. As
invariantes abaixo são a decisão de fato — o resto é implementação.

### 1. Nada é deletado; o verbo é renomear

`ArchiveIoDeps` (`src/main/accounts/migration/archive-profiles.ts`) não expõe
nenhum método de remoção — a incapacidade é estrutural, não convenção. O fim
da migração renomeia `~/.claude-profiles` para `~/.claude-profiles.old`, que
o app nunca toca de novo. Desfazer é renomear de volta.

### 2. Desfazer as junctions vem antes do rename, sempre

Ordem invariante do arquivamento: **todo** unlink de junction (remoção do
reparse point, nunca do alvo) de todos os perfis roda antes do único rename
da raiz; falha em qualquer unlink aborta o arquivamento inteiro, sem renomear,
e o relatório diz qual perfil travou. Renomear com junction viva deixaria uma
armadilha permanente: uma deleção humana posterior do `.old` atravessaria o
link e apagaria `~/.claude`.

### 3. Inventário antes de plano, plano antes de ação

`profile-inventory.ts` só lê; `migration-plan.ts` é função pura que transforma
inventário em passos; a execução consome o plano passo a passo com estado
persistido (`migration-state.ts`). É o que torna o assistente reexecutável
após parar no meio — e auditável antes de agir.

### 4. Credencial migrada não abre canal novo

`credentials-import.ts` lê o `.credentials.json` de um perfil (formato real,
com o bloco `claudeAiOauth`) e grava o par direto no cofre `safeStorage` do
mod local. Tudo dentro de `src/main/accounts/` — a exceção nomeada do
`CLAUDE.md` **não foi ampliada**: o par não passa por variável de retorno
exposta, não cruza o preload, e os 5 canais IPC da migração
(`src/shared/migration.ts`) não carregam segredo em nenhuma direção
(`ImportResult` devolve id opaco e label, nunca e-mail).

### 5. Transcripts: comparar `realpath`, nunca sobrescrever

Na topologia real, `projects` é uma das junctions — todos os perfis já
apontam para o mesmo diretório físico, e copiar "os transcripts do perfil"
ao pé da letra copiaria arquivo sobre si mesmo. `transcript-consolidation.ts`
compara `realpath` e só consolida o que for diretório real; destino existente
nunca é sobrescrito. O mesmo código cobre a máquina onde a junction não
existir.

### 6. MCP: diff é relatório, e é sobre nomes

`mcp-diff.ts` devolve nomes de servidores que existem no perfil e faltam na
config única — nunca faz merge, porque argumento de MCP carrega token com
frequência. Não existe caminho de escrita; a decisão de reconfigurar é humana.

### 7. Config legada é tolerada, nunca destruída

`ArchivedPhaseSession.profileSlug` virou `accountId` com leitura tolerante: o
campo legado é lido como `accountId` quando o novo não existir. Nenhuma
migração de dados destrutiva acompanha a demolição de código.

### 8. `CLAUDE_CONFIG_DIR` sobrevive como mecanismo

A demolição matou o **uso** (spawn nunca mais aplica config dir de perfil),
não o mecanismo: `claudeConfigDir`/`buildPtyEnv` em `pty-manager.ts` ficaram
intocados de propósito — são a porta da etapa 3 (isolar providers externos em
dir próprio, modelo T3 Code).

O que morreu por inteiro: `profile-manager.ts`, `quota-headroom.ts`,
`transcript-copy`, `ProfileSwitcher`, `shared/profiles`, a ponte `profiles.*`
do preload e o fluxo "reiniciar sessão em outra conta" (com credencial única
e global, a UI prometia um congelamento que não acontece mais — o equivalente
é trocar a conta ativa e retomar por Sessões anteriores). A conta de uma aba
virou fato gravado no nascimento da aba, e a tela passou a ter **uma** unidade
de carga (% consumido), fechando o achado A3 da etapa 1.

## Consequências

**Positivas**

- O app encolheu: o diff da etapa é +1.125/−5.237 em 52 arquivos — a demolição
  removeu mais de quatro vezes o que a migração adicionou.
- Um mecanismo de conta só. O motor é a única fonte, o rótulo da sessão vem de
  `AccountLoad`, e a configuração de MCP vive numa config única que sobrevive
  à troca de conta.
- A virada de uma máquina real é um fluxo guiado e reexecutável, não um
  roteiro manual — e é estruturalmente incapaz de deletar o que quer que seja.
- O histórico dos perfis fica arquivado em `~/.claude-profiles.old`,
  recuperável à mão a qualquer momento.

**Negativas e limitações conhecidas**

- **O risco aceito da coexistência de canais disparou no primeiro uso real.**
  Os canais instalados (alfa/beta/stable) compartilham o mesmo `userData` por
  decisão de produto; no e2e real, um canal antigo aberto durante a migração
  reescreveu o `config.json` inteiro a partir da cópia em memória dele — o
  sanitize sem passthrough derrubou a chave `migration` e clobberou
  `accounts.localAccounts`, apagando o progresso do wizard (as credenciais no
  cofre sobreviveram). Agravante: o import não é idempotente entre execuções
  (id novo por import), então reimportar cria entradas órfãs no cofre. O
  conserto tem dono: item de produto "sanitize com passthrough" (e escrita
  read-merge-write), registrado no `CLAUDE.md`. Até lá, a instrução
  operacional é migrar com os outros canais fechados.
- A demolição apaga o meio de multi-conta que o modelo T3 usa para providers
  externos; a etapa 3 o reconstrói sobre a porta preservada (invariante 8),
  com escopo diferente — isolar provider, não trocar conta do pool.
- Suítes e smokes de perfil morreram nominalmente com os módulos; a cobertura
  da virada real vive nos smokes de migração em árvore de perfis falsa
  (fixture de disco com o formato real do `.credentials.json`) e no roteiro
  e2e manual — dublê em memória provou não bastar (lição de 2026-08-04).

## Referências

- [`docs/adr/0001-motor-de-contas-e-mods.md`](0001-motor-de-contas-e-mods.md) — o motor que esta etapa torna única fonte; a invariante 7 de lá é o que esta decisão executa.
- [`specs/011-contas-e-provedores/plan-etapa-2.md`](../../specs/011-contas-e-provedores/plan-etapa-2.md) — decisões D8–D16 que este ADR consolida, e os achados A7–A16 do cruzamento.
- [`specs/011-contas-e-provedores/spec.md`](../../specs/011-contas-e-provedores/spec.md) — clarifications C23–C34 da etapa.
- [`specs/011-contas-e-provedores/roteiro-e2e-etapa-2.md`](../../specs/011-contas-e-provedores/roteiro-e2e-etapa-2.md) — o que só um humano com máquina real confere.
- [`tasks/lessons.md`](../../tasks/lessons.md) — lições de 2026-08-04: formato real do `.credentials.json`, assinatura duplicada de IPC, e o clobber do `config.json` por canal antigo aberto.
- `CLAUDE.md` (raiz), seções **Credenciais** e **Repositório e canais** — a emenda não ampliada e o risco de canais que esta decisão herdou.

<!-- managed:end -->
