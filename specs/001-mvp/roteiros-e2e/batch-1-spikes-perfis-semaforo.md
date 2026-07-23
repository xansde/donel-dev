# Roteiro E2E — Batch 1: Spikes T001 (perfis) + T002 (semáforo)

## O que este batch entregou

Dois spikes de validação técnica, sem UI: T001 provou que `CLAUDE_CONFIG_DIR`
isola login/identidade por perfil no Windows (via automação, sem login humano
real); T002 provou que 3 dos 4 estados do semáforo (trabalhando, aguardando
resposta, encerrada) e o estado de permissão pendente (`Notification`, testado
depois num PTY real) têm sinal confiável via hooks do Claude Code. Resultados
completos em [`spike-t001-resultado.md`](../spike-t001-resultado.md) e
[`spike-t002-resultado.md`](../spike-t002-resultado.md).

**O que este roteiro cobre:** só o que os spikes deixaram como "Não
verificado" porque exige um humano de verdade — sobretudo o **login real
concorrente em duas contas** (T001, critério "a"). O resto dos spikes já foi
validado por automação com evidência em log; não repita aqui.

## Pré-requisitos

- `claude.exe` no PATH ou em `~/.local/bin/claude.exe` (`where.exe claude`
  deve resolver).
- Duas contas Claude disponíveis para o teste: a conta principal do
  Alexandre (perfil global `~/.claude`, já autenticada) e **uma conta
  compartilhada de teste** — usar uma das contas "Tecnologia Claude {n}"
  reservada para isso, **nunca** uma conta pessoal de terceiro.
- Perfil de teste já existe no disco a partir do spike T001:
  `C:\Users\xansd\.claude-profiles\spike-test\` (junctions + `settings.json`
  + `CLAUDE.md` já copiados). Se não existir mais, recriar com o script do
  plan.md (seção "Operação interina").
- PowerShell (o próprio terminal do Windows, não precisa do Donel Dev
  rodando — este roteiro valida o CLI standalone, o app ainda não existe
  nesta fase).

## Custos

Os dois passos abaixo abrem sessões `claude` reais e fazem login de verdade.
Depois do login, use **sempre `--model haiku`** e um prompt trivial
("Responda apenas OK") para os testes de confirmação — não precisa de
sessão longa nem modelo caro para provar isolamento.

## Segurança

- O login acontece **exclusivamente** via `/login` dentro do próprio CLI
  (fluxo OAuth oficial no navegador). Nunca digite email/senha em nenhum
  outro lugar, nunca cole token em arquivo ou chat.
- A conta de teste usada no perfil `spike-test` deve ser uma conta
  compartilhada "Tecnologia Claude {n}", nunca a conta pessoal do Alexandre.
- Ao final do teste, se quiser, faça `/logout` na sessão do perfil de teste
  para não deixar credencial de conta compartilhada residente à toa — não é
  obrigatório para o roteiro passar, mas é boa prática.

## Passos

### 1. Confirmar que o perfil de teste ainda existe e as junctions resolvem

- [ ] **Ação:** `Get-ChildItem C:\Users\xansd\.claude-profiles\spike-test |
  Select-Object Name, LinkType, Target`
- **Resultado esperado:** `projects`, `skills`, `commands`, `rules`,
  `plugins`, `templates` aparecem com `LinkType = Junction` apontando para
  os diretórios equivalentes em `~/.claude`. Se algum estiver quebrado ou
  ausente, recriar antes de prosseguir (comando no plan.md, seção "Operação
  interina").

### 2. Login real na conta de teste, dentro do perfil isolado

- [ ] **Ação:** abrir um PowerShell novo e rodar:
  ```powershell
  $env:CLAUDE_CONFIG_DIR = "C:\Users\xansd\.claude-profiles\spike-test"
  claude --model haiku
  ```
  Dentro da sessão, rodar `/login` e completar o fluxo OAuth no navegador
  usando uma conta "Tecnologia Claude {n}" de teste.
- **Resultado esperado:** login completa com sucesso; a sessão passa a
  responder normalmente (testar com "Responda apenas OK"). Depois de
  logado, checar que `C:\Users\xansd\.claude-profiles\spike-test\.claude.json`
  agora tem a chave `oauthAccount` preenchida (`Get-Content
  "$env:CLAUDE_CONFIG_DIR\.claude.json" | ConvertFrom-Json | Select
  oauthAccount` — não precisa exibir o valor completo, só confirmar que
  não é `null`).

### 3. Sessão paralela na conta global, ao mesmo tempo

- [ ] **Ação:** **sem fechar** a sessão do passo 2, abrir um **segundo**
  PowerShell (nenhuma variável `CLAUDE_CONFIG_DIR` setada) e rodar:
  ```powershell
  claude --model haiku -p "Responda apenas OK"
  ```
- **Resultado esperado:** responde "OK" normalmente, autenticado como a
  conta principal do Alexandre — sem pedir login, sem qualquer interferência
  da sessão do perfil de teste rodando em paralelo na outra janela.

### 4. Confirmar que as duas identidades não se pisaram

- [ ] **Ação:** com as duas sessões ainda vivas (ou logo depois de
  fechá-las), comparar:
  ```powershell
  (Get-Item "$env:USERPROFILE\.claude.json").LastWriteTime
  (Get-Item "$env:USERPROFILE\.claude\.credentials.json").LastWriteTime
  (Get-Item "C:\Users\xansd\.claude-profiles\spike-test\.claude.json").LastWriteTime
  (Get-Item "C:\Users\xansd\.claude-profiles\spike-test\.credentials.json").LastWriteTime
  ```
- **Resultado esperado:** os dois pares de timestamps evoluem de forma
  independente (o `.claude.json`/`.credentials.json` global muda pela
  atividade da sessão global; o do perfil muda pela atividade da sessão de
  teste) — nenhum dos dois fica com o `oauthAccount` da outra conta. Se
  quiser confirmar de forma mais direta: rodar `claude -p "qual é minha
  conta?"` em cada janela separadamente e checar que cada uma reconhece a
  conta certa (sem expor o email/id da conta compartilhada em nenhum
  arquivo ou log deste roteiro — LGPD/confidencialidade de conta
  corporativa).

### 5. Sanidade rápida do que os spikes já provaram (1-2 min, não repetir tudo)

- [ ] **Ação:** dentro da sessão do perfil de teste (passo 2), pedir para
  rodar um comando trivial via Bash (ex.: "rode `echo hello` no bash") e
  observar se aparece um prompt de aprovação de ferramenta.
- **Resultado esperado:** só sanidade visual de que o CLI está funcionando
  normalmente dentro do perfil isolado — o T002 já provou por log que os
  hooks `PreToolUse`/`Stop`/`Notification` disparam corretamente num PTY
  real; não é necessário reinstrumentar hooks aqui.

## Se falhar

| Grupo de passos | Sintoma | Investigar |
|---|---|---|
| 1 (junctions) | `LinkType` não é `Junction` ou pasta ausente | Antivírus/OneDrive pode ter limpado a junction — recriar com `mklink /J`; confirmar que `~/.claude-profiles` não está sob OneDrive (ver edge case do spec.md) |
| 2 (login no perfil) | `/login` trava, ou perfil cai de volta pra "Not logged in" | Checar se `CLAUDE_CONFIG_DIR` foi exportado na MESMA janela antes de rodar `claude`; conferir `claude --version` funciona sem erro |
| 3 (sessão global) | Sessão global pede login ou usa a conta errada | `CLAUDE_CONFIG_DIR` pode ter vazado de uma janela pra outra (variável de ambiente de sessão anterior do PowerShell) — abrir janela nova e confirmar com `$env:CLAUDE_CONFIG_DIR` (deve estar vazio) |
| 4 (isolamento) | Um `.claude.json` mostra a conta do outro | Falha real de isolamento — reabrir o T001 como spike, não seguir para T014 até resolver; comparar com a arquitetura documentada em `spike-t001-resultado.md` item 5 |
| 5 (sanidade hooks) | Nenhum prompt de aprovação aparece | Pode ser só permissão já liberada por `settings.json` copiado do global — não é falha deste roteiro; revisitar T002 (`specs/001-mvp/spike-t002/`) se realmente quiser reinstrumentar |

## Ao concluir

Se os passos 1-4 passarem, o critério (a) do spike T001 (isolamento de login
sob uso humano real) fica definitivamente confirmado, liberando o T014
(ProfileManager) sem mais gates pendentes de spike. Marque este roteiro como
validado e anote a data no PR/card correspondente.
