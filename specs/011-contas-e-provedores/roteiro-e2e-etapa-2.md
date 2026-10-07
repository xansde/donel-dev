# Roteiro de teste manual — 011 Contas & Provedores, etapa 2 (demolição + migração)

Cobre só o que a suíte automatizada (vitest + smoke Playwright, ver
`e2e-etapa-2.md`/manifesto da fase Implementar) **não** prova: a virada real
no alfa, contra o `~/.claude-profiles` de verdade da máquina do operador.
Execução é sempre gesto humano — nenhuma task desta etapa roda isto sozinha.

**Pré-condição dura**: fazer backup manual de `~/.claude-profiles` antes de
começar (copiar a pasta inteira para outro lugar), mesmo o app nunca
deletando nada — é rede de segurança extra para o primeiro operador real.

## Passo a passo

### 1. Abrir o assistente

- [ ] Abrir o alfa numa máquina com `~/.claude-profiles` real (perfis
      criados pela etapa 1/pré-011).
- [ ] Abrir o painel **Contas** (badge do titlebar). Confirmar que aparece o
      botão **"Migrar perfis antigos"** — só aparece porque
      `~/.claude-profiles` tem pelo menos uma entrada.
- [ ] Clicar em "Migrar perfis antigos". Confirmar que o assistente lista
      **todos** os perfis existentes, um por linha, com status "pendente".

### 2. Importar credenciais, perfil a perfil (OK humano)

- [ ] Para CADA perfil com credencial (`hasCredentials`), clicar
      **"Importar"** individualmente. Confirmar:
  - o status da linha muda para "importado";
  - os demais perfis continuam "pendentes" (nunca importa em lote);
  - nenhuma tela em momento nenhum mostra token, e-mail ou trecho de
    credencial — só o rótulo do perfil e o status.
- [ ] Perfil **sem** credencial (`.credentials.json` ausente): confirmar que
      o status vai para "sem credencial" sem erro.

### 3. Conferir o diff de MCP (read-only)

- [ ] Para um perfil com `mcpServers` divergente do global, confirmar que a
      linha mostra os nomes "só no perfil"/"só no global" — nunca o bloco de
      configuração (comando, args, env). Clicar **"Revisado"** e confirmar
      que o status de MCP muda, sem nenhuma escrita aplicada (o
      `.claude.json` global não muda).

### 4. Consolidar transcripts

- [ ] Confirmar (via log/DevTools, ou aceitar o resultado da UI) que a
      consolidação de transcripts do perfil rodou junto com o import
      (o wizard encadeia `importCredentials` → `consolidateTranscripts`).
      Na topologia real (perfil com `projects` como junction pro
      `~/.claude/projects`), o resultado esperado é **already-consolidated**,
      zero cópias — é o comportamento correto (achado A7), não um bug.

### 5. Arquivar

- [ ] Com **todo** perfil em "importado"/"sem credencial"/"pulado" (nenhum
      "pendente"), confirmar que o botão **"Arquivar perfis antigos"** fica
      **habilitado**.
- [ ] Clicar em "Arquivar". Confirmar a mensagem de resultado
      ("Perfis arquivados em ...").
- [ ] **Fora do app**, no Explorer/PowerShell:
  - `~/.claude-profiles` **não existe mais** como pasta com esse nome exato.
  - `~/.claude-profiles.old` (ou `.old-YYYYMMDD` se já havia um `.old`)
    **existe**, com o conteúdo de cada perfil dentro — MENOS as 6 pastas
    linkadas (`projects`, `skills`, `commands`, `rules`, `plugins`,
    `templates`): elas não existem mais dentro do perfil arquivado, porque a
    junction foi desfeita (não um diretório real removido).
  - `~/.claude/projects` (e os outros 5 dirs em `~/.claude`) continuam
    **intactos**, com todo o conteúdo de sempre — a asserção que protege
    contra o pior caso da etapa (nada foi deletado, só a junction desfeita).

### 6. Abrir sessão e ver a conta na statusbar

- [ ] Abrir uma sessão `claude` nova. Confirmar que a statusbar mostra
      **"Sessão: `<label da conta>` · `<cota>%` usado"** (ou "—" sem
      leitura) — nunca mais um nome de perfil solto.
- [ ] Confirmar que **não existe mais** dropdown de perfis em lugar nenhum
      do titlebar — só a tela de Contas.

## O que fazer se algo falhar no meio

O assistente é **retomável** — nada foi deletado em nenhum passo intermediário:

- **Falhou no import de um perfil** (`vault-unavailable`/`invalid-format`):
  o perfil fica marcado "falhou"; os demais continuam disponíveis para
  importar normalmente. Reabrir o assistente depois mostra o mesmo estado —
  tentar de novo é seguro (idempotente, C28).
- **Falhou o arquivamento** (`aborted`, `junction-unlink-failed`): a raiz
  `~/.claude-profiles` **não foi renomeada** — continua exatamente onde
  estava, com as junctions do perfil que falhou ainda vivas. Investigar o
  perfil nomeado no erro (ex.: permissão de arquivo) antes de tentar
  arquivar de novo.
- **Em qualquer ponto**: fechar o app e reabrir não perde progresso — o
  estado da migração (`accounts.migration` no `config.json`) é persistido a
  cada passo.
- **Pior caso teórico (não deveria acontecer, mas se acontecer):** se
  `~/.claude-profiles.old` existir mas `~/.claude/projects` (ou outro dir
  linkado) parecer vazio/alterado, **parar imediatamente** e restaurar do
  backup do passo 0 — isso indicaria uma falha do próprio app na ordem
  invariante (C27/D12), não um estado esperado.
