# Roteiro E2E ÚNICO — lote 005 + 007 num só build (validação do Alexandre)

Gerado em 2026-07-26 pelo cockpit do lote. Substitui, para efeito de validação
humana, os dois roteiros por feature (`005-terminal-copy-paste/roteiro-e2e.md` e
`007-favoritos-sessoes/roteiro-e2e.md`) — eles seguem valendo como referência do
detalhe de cada CA.

## Por que um build só, e não os dois instalados lado a lado

Instalar as duas features como apps separados (all-users + per-user, como o §B14
descreve) **sabota o teste da 007**: os dois installs compartilham o mesmo
`%APPDATA%\donel-dev\config.json`, e o `AppConfig` do build da 005 tem lista
fechada de campos — não conhece `sessionRegistry` nem `collapsedFavorites`. Toda
escrita feita pelo app da 005 (favoritar, renomear sessão, trocar de perfil)
reescreveria o config **sem** o registro da 007, apagando os favoritos montados.
Verificado no código, não suposto.

Então: **um build da FUSÃO das duas** — branch `lote/005-007-e2e`, merge sem
fast-forward das duas features sobre `origin/feature/mvp-p0` @ `6894d00`. É
exatamente o código que vai existir depois que você mergear as duas, então o E2E
valida o alvo real, não um intermediário.

## O build

`C:\Users\xansd\seazone\donel-dev-wt-005\release\Donel Dev-Setup-0.1.0.exe`

**Instalar é ato seu.** Pelo §B14: escolher *all-users* no diálogo substitui
`C:\Program Files\Donel Dev`, que é o app que você usa para trabalhar; o
`%LOCALAPPDATA%\Programs\Donel Dev` (23/07) é o ponto de retorno. O instalador
individual da 005 ficou preservado ao lado como
`Donel Dev-Setup-0.1.0-SOMENTE-005.exe`, caso queira voltar a testar uma feature
isolada.

---

## Parte 1 — uma sessão só, de uma vez (~20–30 min)

A ordem abaixo é deliberada: **uma única execução longa** do modelo serve os
passos 3, 4 e 5, e a sessão aberta no passo 2 já alimenta o registro da 007. Não
reordene sem motivo — cota é o recurso escasso aqui.

### Preparação (007)

**1. Favoritar um projeto que você usa de verdade** — clique na estrela dele.
- ✅ Grupo **"Favoritos"** aparece no TOPO da sidebar, antes de "Projetos",
  colapsável.
- Se esse projeto nunca teve sessão neste app, a primeira expansão pode vir
  vazia e então preencher: é a semeadura (CA-8), uma leitura única de disco.

**2. Abrir uma sessão `claude` nesse projeto favoritado.**
- ✅ A sessão aparece na lista do grupo (é a visita sendo registrada).

### O coração da 005 — uma execução longa serve três passos

**3. `Ctrl+C` sem seleção DURANTE a execução — a execução NÃO PODE morrer** (CA-2).
Peça algo que rode um tempo (várias tool calls em sequência, ou um bash demorado).
Com a execução em andamento e **nada selecionado**, aperte `Ctrl+C`.
- ✅ A execução **continua**. Nada visível acontece (no-op silencioso, C1).
- ❌ **Reprova** se a execução parar. Este é o passo mais importante do lote — é
  a dor original ("muitas vezes interrompe as execuções").

**4. `Ctrl+C` COM seleção copia e não interrompe** (CA-1). Ainda com a execução
rodando, selecione um trecho com o mouse e aperte `Ctrl+C`.
- ✅ O texto vai pro clipboard (cole em outro app para confirmar) **e** a
  execução continua.

**5. `Esc` continua interrompendo** (CA-5). Ainda na mesma execução, aperte `Esc`.
- ✅ A execução é interrompida. `Esc` é agora a **única** forma de interromper em
  aba `claude`.

### Colar, na mesma sessão (005)

**6. Colar 1 linha** (CA-3): copie uma linha curta fora do app, foque o terminal,
`Ctrl+V`.
- ✅ O texto aparece no input, como digitado.

**7. Colar 5 linhas — UM bloco, não 5 Enters** (CA-3).
- ✅ O CLI mostra `[Pasted text #N]`.
- ❌ **Reprova** se as 5 linhas virarem 5 mensagens separadas.

**8. Colar print (imagem)** (CA-4, CA-4b): `PrtScn` ou recorte, depois `Ctrl+V`.
- ✅ Em ~1,5 s aparece `[Image #N]`. O `Pasting…` é do CLI.
- ❌ **Reprova** se aparecer qualquer UI do Donel (spinner, "salvando imagem…"),
  arquivo temporário visível, ou nada.

**9. `Alt+V` ainda cola imagem** (CA-8) — com imagem no clipboard, `Alt+V` direto.
- ✅ `[Image #N]`, igual antes desta entrega.

**10. `Ctrl+Shift+C` / `Ctrl+Shift+V` não regrediram** (CA-7).
- ✅ Copiam/colam como sempre (comportamento default do Electron/DOM).

### Aba `shell` (005)

**11. `Ctrl+C` mata o processo** (CA-6) — abra terminal livre, rode
`ping -t 127.0.0.1`, `Ctrl+C` sem seleção.
- ✅ O `ping` para. *(Já coberto por smoke automatizado; é confirmação visual.)*

**12. `Ctrl+C` com seleção copia e NÃO mata** (CA-1 em aba shell).

**13. `Ctrl+V` cola comando cru** (CA-3, sem bracketed paste) — ex.: `echo teste`
aparece no prompt, pronto para o Enter.

### Regressão de teclado, nas DUAS abas (005, CA-9/C3)

**14.** Setas `↑↓←→`, `Home`/`End`, `PgUp`/`PgDn`, `Delete`, `Tab`/`Shift+Tab`.
- ✅ Nenhuma muda de comportamento — o handler novo intercepta só
  `Ctrl+C`/`Ctrl+V`.

### Voltando à 007, com o registro já povoado

**15. Fixar uma sessão de uso contínuo** — clique no pin da linha.
- ✅ Passa a aparecer **sempre**, além das 5 recentes.

**16. Clicar numa sessão do grupo com a aba JÁ aberta** (CA-4).
- ✅ Foca a aba existente. ❌ Reprova se abrir uma segunda aba da mesma sessão.

**17. Clicar numa sessão do grupo com a aba FECHADA.**
- ✅ Retoma a sessão.

**18. Sessão com permissão pendente, com o grupo COLAPSADO** (CA-6 da 007 / T709).
- ✅ O cabeçalho do projeto **acende** e mostra a contagem, mesmo fechado — você
  não perde o sinal de que algo espera resposta.
- ❌ Reprova se o grupo colapsado esconder o sinal.

**19. Desfavoritar um projeto que tinha sessão fixada** (CA-9 da 007).
- ✅ O grupo some; as sessões voltam à lista geral. Favoritar de novo → a fixada
  reaparece.

**20. Fechar o app e reabrir** — persistência + boot (CA-1/CA-7 da 007).
- ✅ A fixada continua fixada; o estado colapsado/expandido do grupo é o mesmo;
  o grupo aparece **pronto**, sem sidebar em branco esperando carregar.
- ⚠️ O número já é conhecido: **103–149 ms** medidos (acima do alvo de < 100 ms
  da spec, `medicao-ca7.md`). Se você **perceber** demora, isso confirma a
  medição — não é surpresa nova, é a decisão pendente registrada lá.

---

## Parte 2 — só o tempo responde (dias, sem sessão dedicada)

**21. Trabalhe normalmente por alguns dias** nos projetos favoritados.
- ✅ O grupo se atualiza sozinho com as sessões mais recentes, sem você fazer
  nada; ao fim de cada dia reflete o que você trabalhou.

**22. O dia seguinte começando pelo grupo** (o motivo original do pedido): abrir o
app pela manhã, sem ter feito nada.
- ✅ Grupo pronto, nomes certos, ordenado por atividade.

---

## Consequências ACEITAS por você — não reprovar por isso

- **[C1 da 007]** `/rename` feito FORA do Donel deixa o nome no grupo velho até
  aquela sessão ser aberta. Sem botão de atualizar, sem revalidação — decisão sua
  no clarify.
- **[C3 da 007]** Sessão fixada cujo `.jsonl` foi apagado **desaparece sem
  aviso**. Você escolheu simples em vez de avisado.
- **Fora de escopo da 005:** copy-on-select, menu de contexto, seleção que
  sobrevive a output novo (backlog B7), colar imagem em aba `shell`, keybindings
  configuráveis.

## Vermelhos conhecidos — não são regressão deste lote

Suíte completa rodada pelo cockpit no código integrado. Cada vermelho tem causa
verificada: 2 da dívida T013 (§B11), 1 do §B15 (`fs.watch` perde evento — passou
em duas retentativas na base), 4 do **§B19** (specs hardcodam o nome `donel-dev` e
falham quando a suíte roda de worktree — comprovado por grupo de controle na pasta
principal) e 1 **por desenho** (`ca7-measurement.spec.ts` falha porque o alvo do
CA-7 não é atingido).

## Duas decisões suas que este roteiro não resolve

1. **CA-7 da 007:** aceitar 103–149 ms ou abrir task de otimização de boot
   (unificar `config:get` + `projects:list`; ver por que a bundle bloqueia 158 ms
   antes do `domcontentloaded`).
2. **T710 da 007:** o "esquecer entrada órfã quando a retomada falha" ficou fora —
   exigiria tocar `TerminalPane.tsx` (arquivo da 005 no lote) ou inventar o texto
   de erro do CLI para `-r <id inválido>`. A primeira pata do CA-11 (órfã some na
   semeadura) está implementada.
