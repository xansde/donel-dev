# Roteiro E2E — Batch 4: Sessões anteriores + Perfis (T013–T014)

**Status no momento da escrita: PENDENTE (aguardando implementação).** Só
rode este roteiro depois que o batch estiver marcado como concluído.

## O que este batch entrega

UI de sessões anteriores com retomar/fork sobre o `SessionIndexer` já
existente do batch 3 (T013, FR-004, CA-2); `ProfileManager` completo +
dropdown "Tecnologia Claude {n}" com % de quota via `quota-axi` (T014,
FR-005, FR-012, CA-3). Este batch também é onde o **gate humano do T001**
(login real concorrente) precisa estar fechado — se o
[roteiro do batch 1](batch-1-spikes-perfis-semaforo.md) ainda não foi
validado, valide-o ANTES deste.

## Pré-requisitos

```powershell
cd C:\Users\xansd\seazone\donel-dev
npm install
npm run dev
```

- Ter pelo menos um projeto com 2-3 transcripts reais em
  `~/.claude/projects/<slug>/*.jsonl` (qualquer projeto usado antes serve —
  `donel-dev` mesmo, se você já teve sessões nele).
- Ter pelo menos **duas** contas Claude disponíveis para testar troca de
  perfil: a conta principal (perfil "principal" = `~/.claude`) e uma conta
  compartilhada de teste ("Tecnologia Claude {n}").
- `npx -y quota-axi` funcionando standalone no terminal (fora do app),
  para servir de referência do que a UI deveria mostrar:
  ```powershell
  npx -y quota-axi --provider claude --json
  ```

## Custos

Sessões de teste de troca de perfil: use `--model haiku`, prompts
triviais. A leitura de quota via `quota-axi` **não gasta cota** (é
read-only, nunca chama o CLI do Claude — ver SKILL.md do quota-axi) —
pode rodar quantas vezes quiser sem preocupação de custo.

## Segurança

- O login de uma conta nova **sempre** acontece dentro do `/login` do CLI,
  nunca em um formulário do app — o app **nunca** deve pedir email/senha
  diretamente. Se em algum momento a UI do Donel Dev pedir para digitar
  credencial fora do terminal embedado, **isso é uma falha de segurança**,
  pare o teste e reporte.
- Use exclusivamente contas "Tecnologia Claude {n}" para os perfis de
  teste — nunca a conta pessoal do Alexandre num perfil secundário.
- Não exiba nem registre neste roteiro o conteúdo de nenhum transcript
  real que tenha nome de proprietário/cliente/hóspede/liderado (LGPD) —
  se aparecer, generalize a descrição em vez de colar o texto.

## Passos

### 1. Sessões anteriores aparecem ao selecionar o projeto (T013, CA-2)

- [ ] **Ação:** selecionar na sidebar um projeto que tenha transcripts
  reais em `~/.claude/projects/<slug>/`.
- **Resultado esperado:** a lista de sessões anteriores aparece ordenada
  por data, com preview de texto (primeira mensagem de usuário genuína,
  sem payload de controle/slash-command), tamanho e modelo — igual ao
  formato de `nome/preview · data relativa · tamanho · modelo` do
  ui-spec §5.

### 2. Retomar sessão

- [ ] **Ação:** clicar "Retomar" numa das sessões anteriores.
- **Resultado esperado:** abre uma **nova aba** executando
  `claude -r <session-id>`, restaurando a conversa anterior — confirmar
  pedindo "resuma o que conversamos antes" e vendo que a resposta reflete
  contexto real da sessão anterior (não uma sessão vazia).

### 3. Fork de sessão

- [ ] **Ação:** clicar "Fork" numa sessão anterior.
- **Resultado esperado:** abre uma nova aba com
  `claude -r <session-id> --fork-session` — uma ramificação nova a partir
  daquele ponto, sem alterar a sessão original (confirmar que a sessão
  original continua intacta reabrindo-a separadamente depois).

### 4. Transcript corrompido não derruba a lista

- [ ] **Ação:** (se disponível) usar um projeto/transcript de teste
  propositalmente truncado, ou criar um `.jsonl` inválido de teste num
  projeto descartável em `~/.claude/projects/<algum-slug-de-teste>/`.
- **Resultado esperado:** a sessão corrompida aparece na lista com preview
  "(ilegível)", sem quebrar a listagem das outras sessões do projeto. Se
  não for viável testar com segurança na máquina real, marque como
  "(confirmar na implementação — já coberto por fixture automatizada em
  `tests/fixtures/sessions/fully-corrupted.jsonl` e
  `tests/fixtures/sessions/corrupted-lines-then-user.jsonl`)".

### 5. Criar perfil novo (T014, FR-005)

- [ ] **Ação:** pela UI de perfis, criar um novo perfil de conta chamado
  "Tecnologia Claude {n}" (escolher um número ainda não usado).
- **Resultado esperado:** o app cria
  `~/.claude-profiles/<slug>/` com as 6 junctions (`projects`, `skills`,
  `commands`, `rules`, `plugins`, `templates`) + cópia de `settings.json` e
  `CLAUDE.md` — confirmar no PowerShell:
  ```powershell
  Get-ChildItem "$env:USERPROFILE\.claude-profiles\<slug>" | Select Name, LinkType
  ```

### 6. Trocar de perfil e abrir sessão nova (CA-3)

- [ ] **Ação:** no dropdown de perfis, trocar do perfil "principal" para o
  perfil recém-criado; abrir uma sessão nova (`--model haiku`).
- **Resultado esperado:** a nova sessão abre com `CLAUDE_CONFIG_DIR`
  apontando pro perfil novo (confirmar rodando `echo $env:CLAUDE_CONFIG_DIR`
  dentro da aba, ou observando que ela pede `/login` se o perfil for
  novo/sem sessão prévia). A aba antiga (perfil principal) continua
  intacta e respondendo normalmente — trocar de perfil **não** afeta abas
  já abertas.

### 7. Skills/CLAUDE.md idênticos entre perfis (CA-3)

- [ ] **Ação:** dentro da sessão do perfil novo, pedir "liste as skills
  disponíveis" ou rodar `/help`; comparar com a mesma pergunta na sessão do
  perfil principal.
- **Resultado esperado:** a lista de skills/comandos é idêntica nos dois
  perfis (prova que as junctions resolvem pro mesmo conteúdo
  compartilhado), mesmo a conta autenticada sendo diferente.

### 8. Headroom de quota no dropdown (FR-012)

- [ ] **Ação:** abrir o dropdown de perfis com pelo menos 2 perfis
  autenticados (principal + o de teste, se já tiver feito login nele no
  batch 1).
- **Resultado esperado:** cada linha mostra o `%` de headroom
  (verde > 40%, âmbar 15–40%, vermelho < 15%, "—" se indisponível) — os
  números devem bater (aproximadamente, quota pode mudar entre leituras)
  com o que `npx -y quota-axi --provider claude --json` mostra rodado
  manualmente com o `CLAUDE_CONFIG_DIR` do mesmo perfil.
- [ ] **Ação:** observar o tempo até o dropdown ficar utilizável (não
  travar esperando todos os perfis).
- **Resultado esperado:** o dropdown não bloqueia esperando as 15 leituras
  — timeout de 3s por perfil, cache de 60s; um perfil lento/indisponível
  mostra só "—" nele, sem travar os demais.

### 9. Profile doctor — junction quebrada (edge case do spec.md)

- [ ] **Ação:** quebrar deliberadamente uma junction de um perfil de teste
  (ex.: `Remove-Item "$env:USERPROFILE\.claude-profiles\<slug>\skills"`)
  e voltar pro app.
- **Resultado esperado:** o "profile doctor" detecta a junction quebrada e
  oferece recriar (não falha silenciosamente nem quebra a listagem de
  perfis).

## Se falhar

| Grupo de passos | Sintoma | Investigar |
|---|---|---|
| 1-4 (sessões anteriores) | Lista vazia, preview errado, ou trava com transcript corrompido | `src/main/session-indexer.ts` (já tem cobertura de fixtures em `tests/fixtures/sessions/`); UI nova é onde procurar primeiro (arquivo de UI ainda não existe no batch 3 — conferir o nome real criado neste batch) |
| 5, 9 (criar perfil / doctor) | Junctions não criadas ou doctor não detecta quebra | Módulo `ProfileManager` (novo neste batch — verificar path exato criado, provavelmente `src/main/profile-manager.ts`); comparar contra o procedimento validado em `spike-t001-resultado.md` item 5 |
| 6-7 (troca de perfil / skills idênticas) | Aba nova não usa o perfil certo, ou skills divergem | Verificar se `CLAUDE_CONFIG_DIR` está sendo injetado no `env` do spawn (`src/main/pty-manager.ts` + `src/shared/commandBuilder.ts`); se skills divergem, checar se a junction de `skills`/`commands`/`plugins` resolve pro alvo certo |
| 8 (headroom) | "—" em todos, ou trava esperando | Checar se `quota-axi` está instalado/acessível via `npx`; conferir timeout/cache no módulo que chama `quota-axi` (provavelmente perto do `ProfileManager`) |

## Nota sobre o gate humano do T001

Se o [roteiro do batch 1](batch-1-spikes-perfis-semaforo.md) ainda não foi
executado (login real concorrente em duas contas), rode-o antes deste —
ele é pré-requisito lógico para confiar no passo 6 acima.
