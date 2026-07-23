# Roteiro E2E — Batch 5: Acabamento + Empacotamento + Smoke final (T015–T017)

**Status no momento da escrita: PENDENTE (aguardando implementação).** Só
rode este roteiro depois que o batch estiver marcado como concluído. Este
é o roteiro mais longo — é literalmente o smoke final do MVP (T017),
cobrindo CA-1 a CA-6 de ponta a ponta, mais empacotamento (T016) e
persistência (T015).

## O que este batch entrega

`ConfigStore` persistente com escrita atômica (T015, FR-007); statusbar com
conta ativa, modelo/esforço da aba em foco e contagem de sessões (T015,
FR-009); empacotamento via `electron-builder` (NSIS) + atalho de Desktop
via `/create-executable` (T016); smoke final roteirizado cobrindo CA-1..CA-6
+ teclas especiais + colar multilinha + resize + 6 abas + troca de perfil +
restart + app via atalho instalado + notificação Windows (dev e instalado)
+ startup < 3s + RAM < 400MB com 3 abas (T017).

**Este roteiro é, na prática, a versão manual do T017** — os batches 1–4
já cobriram cada funcionalidade isoladamente; aqui o objetivo é a jornada
completa, do zero, incluindo o instalador.

## Pré-requisitos

```powershell
cd C:\Users\xansd\seazone\donel-dev
npm install
npm run build
# gerar o instalador (ajustar comando conforme o script real definido no T016,
# tipicamente algo como):
npm run dist   # ou "electron-builder" direto — confirmar no package.json do batch 5
```

Ter no mínimo 2 perfis de conta já configurados (principal + 1 de teste, do
batch 4) para o passo de troca de perfil. Ter o Windows Defender **ativo**
(não desativar para o teste — o objetivo é justamente confirmar que o
instalador funciona com Defender ligado, conforme o risco documentado no
plan.md).

## Custos

Este roteiro abre várias sessões `claude` reais, incluindo 6 simultâneas.
**Use `--model haiku` em todas** e prompts curtos/triviais — o volume de
sessões já é alto, não precisa somar custo de modelo caro.

## Segurança

- Nenhum passo pede para digitar credencial fora do `/login` do CLI.
- Login/troca de perfil usa exclusivamente contas "Tecnologia Claude {n}"
  já validadas no batch 1/4 — não crie conta nova neste roteiro.
- Ao testar o instalador NSIS, é esperado que o Windows/Defender façam
  alguma checagem de SmartScreen (o app não é assinado por padrão, risco
  documentado no plan.md) — isso é esperado, não é falha automática; só
  reporte como falha se o instalador for **bloqueado** de forma que
  impeça a instalação mesmo permitindo manualmente.

## Passos

### 1. Preferências sobrevivem a restart (T015, FR-007)

- [ ] **Ação:** com o app rodando (`npm run dev` ou instalado), mudar ao
  menos 3 preferências: favoritar um projeto, trocar o tema (se
  disponível) ou o perfil ativo default, e mudar um default do launcher
  (ex.: modelo default). Fechar o app completamente e reabrir.
- **Resultado esperado:** as 3 mudanças persistem depois do restart —
  confirmar também que `%APPDATA%\donel-dev\config.json` existe e reflete
  os valores (`Get-Content "$env:APPDATA\donel-dev\config.json"`).
  **Correção (T017, 2026-07-23):** o path real usa `donel-dev` com hífen
  (`app.setName('donel-dev')`, `src/main/index.ts`), não `DonelDev` — o
  texto original estava errado (NTFS case-insensitive não cobre um hífen
  ausente). Confirmado em disco nesta task.
- [ ] **Ação:** durante uma escrita de config (ex.: favoritar um projeto),
  se possível observar o diretório `%APPDATA%\donel-dev\` num segundo
  terminal.
- **Resultado esperado:** a escrita é atômica (arquivo temporário +
  rename) — não deve haver uma janela em que o `config.json` fique
  truncado/corrompido caso o app seja fechado no meio de uma escrita (mais
  difícil de forçar manualmente; se não for viável testar o timing, marque
  como "(confirmar na implementação)").

### 2. Statusbar (T015, FR-009)

- [ ] **Ação:** com pelo menos 2 sessões abertas e uma delas em foco,
  observar a statusbar na base da janela.
- **Resultado esperado:** mostra a conta ativa, modelo/esforço da aba em
  foco (atualiza ao trocar de aba) e a contagem total de sessões abertas.

### 3. Empacotamento — instala numa condição realista (T016)

- [ ] **Ação:** rodar o instalador NSIS gerado (`npm run dist` ou
  equivalente) numa janela com Defender ativo.
- **Resultado esperado:** instala sem erro fatal — se o SmartScreen barrar
  com "Windows protegeu seu PC", usar "Mais informações → Executar assim
  mesmo" é uma mitigação **documentada e aceitável** (não uma falha,
  conforme risco do plan.md); só é falha se não houver NENHUM caminho para
  seguir com a instalação.
- [ ] **Ação:** confirmar que o atalho de Desktop foi criado (via
  `/create-executable`, conforme o CLAUDE.md do projeto exige para
  interfaces executáveis).
- **Resultado esperado:** ícone na Área de Trabalho, aponta para o
  executável instalado.

### 4. CA-1 — Launcher monta o comando exato

> **Nota (2026-07-23, rodada 5 do feedback E2E):** o painel "Lançar sessão"
> deixou de ser fixo desde o commit `5c8d254` (feedback E2E rodada 3, "painel
> lateral fixo rouba espaço") — ele nasce FECHADO; os passos de abertura
> abaixo são literais, não "está sempre visível" como o texto original deste
> item sugeria.

- [ ] **Ação:**
  1. Na titlebar, clicar na **seta** do botão split "＋ Nova sessão" (botão
     "Mais opções de ＋ Nova sessão", ao lado do botão principal) — **não**
     no corpo do botão, que dispara o quick-launch direto (última config
     usada) sem abrir o painel.
  2. No menu que abre, clicar em **"Sessão Claude"** — o painel "Lançar
     sessão" abre à direita (`aria-label="Lançar sessão"`). `Esc` fecha o
     painel a qualquer momento sem lançar nada.
  3. Preencher os campos do painel: **Modelo**=`sonnet`, **Esforço**=`high`,
     **Permissões**=`acceptEdits`, **Nome**=`radar`, **Projeto-alvo**
     (seletor "Selecione um projeto") = `spotsys` (ou outro projeto
     disponível na sidebar).
  4. Clicar **"▶ Iniciar"** — o botão fica **desabilitado** até um projeto
     ser escolhido no passo 3 (é esperado não conseguir clicar antes disso).
- **Resultado esperado:** aba abre executando exatamente
  `claude --model sonnet --effort high --permission-mode acceptEdits -n "radar"`
  com `cwd` correto. (Repetição intencional do CA-1 já testado no batch 3 —
  aqui é sanidade rápida dentro do fluxo completo, não precisa re-auditar
  a fundo.)

### 5. CA-2 — Sessões anteriores e retomar

- [ ] **Ação:** selecionar um projeto com transcripts reais; clicar
  "Retomar" numa sessão antiga.
- **Resultado esperado:** as sessões aparecem ordenadas por data com
  preview; "retomar" abre aba com `claude -r <id>` restaurando a conversa.

### 6. CA-3 — Perfis

- [ ] **Ação:** com perfil A ativo, trocar para perfil B (contas
  "Tecnologia Claude {n}" já validadas) e abrir sessão nova.
- **Resultado esperado:** nova sessão autentica como B; aba antiga (A)
  continua intacta; skills e CLAUDE.md idênticos nas duas.

### 7. CA-4 — Ctrl+C

- [ ] **Ação:** rodar `Start-Sleep -Seconds 30` numa aba de terminal livre
  e apertar `Ctrl+C` antes de completar.
- **Resultado esperado:** processo interrompido imediatamente, comportamento
  igual ao Windows Terminal.

### 8. CA-5 — Aviso de `claude` ausente

- [ ] **Ação:** (se seguro testar — preferencialmente numa máquina/VM
  limpa) simular `claude` fora do PATH e do local esperado, abrir o app.
- **Resultado esperado:** aviso claro com o caminho esperado
  (`~/.local/bin/claude.exe`), sem aba quebrada. Se não for seguro testar
  na máquina real, marcar "(confirmar na implementação — já coberto no
  batch 2)".

### 9. CA-6 — Semáforo com múltiplos estados + ordenação por prioridade

- [ ] **Ação:** repetir o cenário do batch 3 (3 sessões com estados
  diferentes sem focar nenhuma; 2 sessões com permissão pendente em
  momentos diferentes).
- **Resultado esperado:** os 3 estados aparecem simultaneamente sem foco;
  a pendência mais antiga aparece acima, com contador de tempo visível em
  cada uma. (Repetição do batch 3 — sanidade rápida, não re-auditar a
  fundo.)

### 10. Teclas especiais, completas

- [ ] **Ação:** dentro de uma sessão/terminal, testar em sequência: setas
  (histórico), Home/End, Ctrl+A/Ctrl+E (início/fim de linha, se suportado
  pelo shell), Backspace/Delete, Tab (autocomplete do PowerShell).
- **Resultado esperado:** todas se comportam como no Windows Terminal
  nativo, sem captura indevida pelo Electron (ex.: Tab não deveria mudar
  foco de elemento da UI enquanto o terminal está focado).

### 11. Colar multilinha

- [ ] **Ação:** colar um bloco de 5+ linhas dentro de uma sessão Claude
  ativa (não só terminal livre).
- **Resultado esperado:** o texto chega completo, em ordem, sem disparar
  envio prematuro linha a linha.

### 12. Resize

- [ ] **Ação:** redimensionar a janela com uma sessão ativa gerando output
  contínuo.
- **Resultado esperado:** o terminal reflow sem quebrar, sem travar o
  output em andamento.

### 13. 6 abas simultâneas

- [ ] **Ação:** abrir 6 sessões (mistura de Claude `--model haiku` e
  terminal livre) ao mesmo tempo, interagir brevemente com cada uma.
- **Resultado esperado:** todas respondem de forma independente e estável,
  sem uma aba travar/afetar as outras; semáforo reflete o estado real de
  cada uma.

### 14. Troca de perfil em pleno uso

- [ ] **Ação:** com as 6 abas do passo 13 ainda abertas (algumas no perfil
  A), trocar o perfil ativo para B e abrir uma 7ª aba.
- **Resultado esperado:** a 7ª aba nasce no perfil B; as 6 anteriores
  continuam no perfil com que nasceram, sem interrupção.

### 15. Restart com sessões abertas

- [ ] **Ação:** com abas abertas, fechar o app completamente (não só
  minimizar) e reabrir.
- **Resultado esperado:** app volta ao estado esperado conforme o que foi
  definido para persistência de sessões (conferir se sessões antigas
  aparecem na lista de "sessões anteriores" do projeto, já que o processo
  PTY em si não sobrevive ao restart do app — isso é esperado, não bug).
  Preferências (perfil ativo, favoritos) persistem, conforme passo 1.

### 16. App via atalho do Desktop — PATH e MCPs

- [ ] **Ação:** fechar completamente o `npm run dev`; abrir o app **pelo
  atalho instalado na Área de Trabalho** (não pelo terminal de dev).
  Dentro de uma sessão Claude aberta assim, checar se o `claude` resolve
  MCPs configurados (ex.: pedir para listar ferramentas/MCPs disponíveis)
  e se comandos do PATH do usuário funcionam dentro de uma aba de terminal
  livre (ex.: `git --version`, `gh --version`).
- **Resultado esperado:** o app funciona de forma idêntica ao modo dev —
  MCPs carregam, PATH do usuário está disponível dentro das abas. Esse é
  um ponto de risco real (apps empacotados às vezes herdam um `env`
  reduzido) — testar com atenção.

### 17. Notificação Windows — dev E instalado

- [ ] **Ação:** repetir o teste de notificação (sessão em background
  chegando em "aguardando"/"permissão pendente") tanto via `npm run dev`
  quanto via o atalho instalado do passo 16.
- **Resultado esperado:** nos dois casos a notificação aparece atribuída
  ao "Donel Dev" (não a "Electron" genérico) — confirma que
  `app.setAppUserModelId` está configurado corretamente e funciona nos
  dois contextos (risco explícito do plan.md).

### 18. Startup < 3s

- [ ] **Ação:** medir o tempo entre clicar no atalho instalado e a janela
  ficar interativa (cronômetro manual ou `Measure-Command` em torno do
  processo, se viável).
- **Resultado esperado:** menos de 3 segundos, conforme requisito
  não-funcional do spec.md.

### 19. RAM < 400MB com 3 abas

- [ ] **Ação:** com exatamente 3 abas abertas (mistura de Claude/terminal
  livre), rodar:
  ```powershell
  Get-Process | Where-Object { $_.ProcessName -like "*Donel*" -or $_.ProcessName -eq "electron" } |
    Measure-Object WorkingSet64 -Sum |
    Select-Object -ExpandProperty Sum
  ```
  (ajustar o filtro de nome do processo conforme o nome real do executável
  empacotado) e converter o resultado de bytes para MB.
- **Resultado esperado:** soma do `WorkingSet64` de todos os processos do
  app (main + renderer + qualquer processo utilitário do Electron) fica
  abaixo de 400MB.

## Se falhar

| Grupo de passos | Sintoma | Investigar |
|---|---|---|
| 1-2 (ConfigStore/statusbar) | Preferências não persistem, statusbar não atualiza | Módulo `ConfigStore` (novo neste batch, path provável `src/main/config-store.ts`); confirmar escrita em `%APPDATA%\DonelDev\config.json` |
| 3 (instalador) | NSIS falha, atalho não criado | Config do `electron-builder` (provável `electron-builder.yml` ou seção `build` do `package.json`); script de `/create-executable` |
| 4-9 (CA-1..CA-6) | Qualquer regressão nos critérios já validados nos batches 2-3 | Ver as tabelas "Se falhar" dos [roteiros de batch 2](batch-2-fundacao-terminal.md) e [batch 3](batch-3-cockpit-sidebar-launcher-semaforo.md) — os mesmos módulos se aplicam |
| 10-12 (teclas/colar/resize) | Regressão de comportamento de terminal | `src/renderer/src/TerminalPane.tsx`, `src/main/pty-manager.ts` |
| 13-15 (6 abas/troca perfil/restart) | Instabilidade com carga real, vazamento de PTY | `src/main/pty-manager.ts` (limite de processos), Gerenciador de Tarefas pra achar processo órfão |
| 16 (atalho/PATH/MCPs) | MCPs não carregam ou PATH reduzido no app instalado | Configuração de `env` do processo spawnado em `src/main/pty-manager.ts`/`src/shared/commandBuilder.ts` — apps empacotados no Windows nem sempre herdam o `PATH` completo do shell do usuário; pode precisar resolver o `PATH` explicitamente (`%USERPROFILE%\.local\bin`, etc.) em vez de confiar no `env` herdado do processo pai |
| 17 (notificação) | Notificação atribuída a "Electron" | `app.setAppUserModelId` no `src/main/index.ts` — conferir se está sendo chamado ANTES de qualquer notificação disparar, e se o instalador NSIS seta o mesmo AppUserModelId usado no código |
| 18-19 (startup/RAM) | Acima do limite | Perfilar com DevTools do Electron (`--inspect`) ou `Get-Process`; candidatos comuns: excesso de `require`/import síncrono no main process, muitos listeners de IPC, xterm com scrollback grande demais por padrão |

## O que a automação (T017, 2026-07-23) já provou vs. o que resta ao humano

Checklist item a item, com evidência, em
[t017-checklist.md](../t017-checklist.md). Resumo:

**Já provado por automação (com números reais):**
- 1-1b (persistência/escrita atômica), 3 (instalador já presente nesta
  máquina), 4-6 (CA-1/CA-2/CA-3), 8 (CA-5, via testes unitários), 12-13
  (resize básico, 6 abas), 15 (persistência pós-restart), 16 (PATH do exe
  instalado — `git`/`gh`/`claude --version` resolvendo), 17 (mecanismo do
  `appUserModelId`, não o disparo visual), 18 (startup: 917-1913ms, < 3s),
  19 (RAM: **423.8-451.4 MB — ACIMA do budget de 400MB**, achado real, ver
  checklist).
- Item 9 (CA-6) rodou 2x e falhou 2x **por carga concorrente da máquina**
  (14 processos `claude.exe` simultâneos no momento), não por regressão de
  código — precisa de uma rodada limpa fora de horário de esteira pra
  confirmar.

**Lista enxuta do que resta ao humano** (nada disso é automatizável com
segurança/custo razoável):
1. **Item 2** — conferir visualmente a statusbar completa (conta + modelo/
   esforço da aba em foco + contagem), só coberta incidentalmente.
2. **Item 7** — Ctrl+C numa sessão real (sinal de teclado, sem smoke E2E
   dedicado).
3. **Item 10** — teclas especiais completas (setas, Home/End, Ctrl+A/E,
   Backspace/Delete, Tab). **Este é o mesmo item 10 do roteiro batch 2 que
   ficou "não testado" na rodada 2 do feedback-e2e.md — segue em aberto,
   nunca foi validado por ninguém ainda.**
4. **Item 11** — colar multilinha dentro de uma sessão Claude real (visual).
5. **Item 14** — troca de perfil com 6 abas já abertas (a combinação exata;
   as duas metades isoladas já são cobertas).
6. **Item 17, metade visual** — confirmar que o toast do Windows aparece
   mesmo, atribuído a "Donel Dev" (o mecanismo/appUserModelId já está
   confirmado por automação; falta só ver o toast na tela).
7. **Item 16, metade MCP** — dentro do app instalado, pedir pra uma sessão
   real listar os MCPs disponíveis (não automatizado pra não gastar cota
   só nessa checagem).
8. **Item 19 (RAM)** — decisão do Alexandre: aceitar os ~424-451MB medidos
   (acima do budget de 400MB) ou abrir uma task de otimização antes do
   MVP ir pra uso diário.
9. **Item 9 (CA-6)** — revalidar numa janela sem outras sessões `claude`
   concorrentes rodando, pra separar "flake de carga" de "regressão real".

## Ao concluir

Os itens automatizáveis passaram (ou têm achado real documentado, não
apenas "não testado") — ver `t017-checklist.md`. Os itens 1-9 da lista
"resta ao humano" acima ficam pendentes de validação manual antes do MVP
P0 ser considerado pronto para uso real no dia a dia. Atualizar o vault
(`Projects/donel-dev/` no Obsidian) com a data de conclusão e os achados
reais (RAM acima do budget, CA-6 instável sob carga) — não só "concluído".
