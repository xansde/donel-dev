# Roteiro E2E de fechamento — 0.2.0, o build que vai virar o app de trabalho

Gerado em 2026-07-26, ao fim da **008-fechar-pendencias** (§B19 + T710). Um
roteiro só, **numa sessão de app**, para você rodar de uma vez.

Cobre o que é NOVO (T710) e a regressão do que você usa todo dia (007, 006, 005,
004) — porque este é o build que vai substituir o app de trabalho.

## O build

`C:\Users\xansd\seazone\donel-dev\release\Donel Dev-Setup-0.2.0.exe`

**Instalar é ato seu.** Pelo §B14: escolher *all-users* no diálogo do
instalador substitui `C:\Program Files\Donel Dev`, que é o app que você usa
para trabalhar; o `%LOCALAPPDATA%\Programs\Donel Dev` (23/07) é o seu ponto de
retorno. Escolher "somente para mim" substitui justamente esse ponto de retorno
— então, se quer manter uma saída, instale em all-users.

Versão **0.2.0** e não 0.1.0 de novo porque a 0.1.0 já está na mão de outra
pessoa; dois builds diferentes com o mesmo número é o que faz alguém dizer
"estou na 0.1.0 e não tem esse botão" e ninguém saber quem está certo.

## Cota: gasta UMA vez, no passo 5

| Passos | Precisa de turno real do modelo (cota)? |
|---|---|
| 1–4 (preparação + **T710**) | **Não.** A retomada que falha morre antes de qualquer chamada ao modelo. |
| **5 (execução longa)** | **SIM — é a única.** Serve 005 (`Ctrl+C`/`Esc`) e 006 (`contexto NN%`) de uma vez. |
| 6–10 | **Não.** `/rename`, colar, `Ctrl+C` em terminal livre e a lista de favoritos não chamam o modelo. |

Não reordene os passos 3–5 sem motivo: a ordem existe para a cota ser gasta uma
única vez.

---

## Preparação — 2 minutos, sem cota

**1. Abra o app 0.2.0 e confirme que ele é o novo.**
- ✅ Suas preferências, projetos, favoritos e nomes de sessão continuam lá (o
  `config.json` é o mesmo — `%APPDATA%\donel-dev`).

**2. Favorite um projeto que você usa de verdade** (a estrela na linha dele) e
**expanda** o grupo.
- ✅ Grupo **"Favoritos"** no TOPO da sidebar, antes de "Projetos".
- ✅ Até **5 sessões mais recentes** desse projeto aparecem na lista (se for a
  primeira vez, a primeira expansão pode vir vazia e então preencher — é a
  leitura única de disco).

---

## O novo — T710: a sessão que não existe mais sai da lista (sem cota)

Aqui você precisa de uma sessão **órfã**: uma linha na lista cujo arquivo de
transcript não existe mais. Como isso normalmente acontece por acaso (você
limpou `~/.claude/projects`), o roteiro fabrica o caso **movendo** um arquivo —
nada é apagado, e o passo 4b devolve tudo.

**3. Escolha, na lista do grupo, uma sessão ANTIGA que você não precisa** e
clique no alfinete dela (fixar).
- ✅ A linha fica marcada como fixada. Fixe de propósito: o requisito diz que a
  órfã sai da lista **inclusive fixada**, e é isso que este teste prova.

**3b. Descubra o id dessa sessão e mova o arquivo dela para um backup.** No
PowerShell, trocando `<PASTA-DO-PROJETO>` pelo caminho do projeto favoritado:

```powershell
$slug = ((Resolve-Path "<PASTA-DO-PROJETO>").Path -replace '[^a-zA-Z0-9]','-')
$dir  = "$env:USERPROFILE\.claude\projects\$slug"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\_backup-e2e" | Out-Null
# lista as sessões, mais recentes primeiro — escolha a MESMA que você fixou
Get-ChildItem "$dir\*.jsonl" | Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime
# depois, com o nome do arquivo escolhido:
Move-Item "$dir\<ID-DA-SESSAO>.jsonl" "$env:USERPROFILE\.claude\_backup-e2e\"
```

- ✅ O arquivo saiu da pasta do projeto. **O app não precisa ser reiniciado** — a
  lista vem do registro dele, não do disco, então a linha continua aparecendo.
  É exatamente a situação que enganava antes.

**4. Clique nessa linha fixada.**
- ✅ Uma aba nova nasce e tenta retomar.
- ✅ Em cerca de **10 segundos** a aba mostra que o processo saiu (código 1) e a
  **linha desaparece da lista do grupo**, sozinha, sem aviso e sem perguntar.
- ✅ As outras linhas do grupo — inclusive as fixadas cujo arquivo existe —
  **continuam lá**. Isso é o mais importante: o app confere o arquivo antes de
  esquecer, não sai apagando tudo que falhou.
- ❌ **Reprova** se a linha continuar na lista depois de ~30 s, ou se alguma
  OUTRA linha desaparecer.
- Feche a aba morta.

**4b. Devolva o arquivo** (nada foi perdido):

```powershell
Move-Item "$env:USERPROFILE\.claude\_backup-e2e\<ID-DA-SESSAO>.jsonl" "$dir\"
```

- Observação esperada, não é bug: a linha **não volta** sozinha para a lista. O
  registro é a fonte de verdade dessa lista e ela já foi esquecida; a sessão
  continua acessível em **"Sessões anteriores"** do projeto, com o arquivo de
  volta no lugar.

---

## O coração da regressão — UMA execução longa serve três provas (usa cota)

**5. Abra uma sessão no projeto favoritado e peça algo demorado** (várias tool
calls em sequência, ou um bash que leve um tempo). Com a execução **em
andamento**:

**5a. `Ctrl+C` com NADA selecionado, numa aba de sessão** (005, o que mais
importa):
- ✅ A execução **continua**. Nada visível acontece.
- ❌ **Reprova** se a execução morrer — é a dor original ("muitas vezes
  interrompe as execuções").

**5b. `Ctrl+C` COM texto selecionado**, na mesma aba:
- ✅ Copia a seleção (cole em qualquer lugar para confirmar) e a execução segue.

**5c. `contexto NN%` na barra da sessão** (006), enquanto o turno roda:
- ✅ O número **sobe** conforme a conversa cresce, e acompanha o modelo da aba.
- ❌ Reprova se ficar em `—` ou travar no mesmo número depois de vários turnos.
  (Se travar UMA vez e destravar no turno seguinte, é o §B15 conhecido — anote,
  não reprove.)

**5d. Agora sim interrompa: `Esc`** (005):
- ✅ A execução para. É o gesto novo de interromper dentro de uma sessão.

**5e. Enquanto a aba está em segundo plano**, olhe o semáforo dela na barra/
sidebar:
- ✅ O ponto muda de **Trabalhando** para **Aguardando resposta** sem você
  precisar focar a aba.

---

## Resto da regressão — sem cota

**6. `/rename meu-nome-novo` dentro da sessão viva** (004):
- ✅ O nome da **aba** muda em menos de 1 s, sem reiniciar nada.
- ✅ Duplo-clique (ou F2) na aba renomeia pela UI; `Esc` cancela a edição.

**7. Colar texto multilinha** (`Ctrl+V` com 3–4 linhas no clipboard) (005):
- ✅ Entra como **um bloco só**, não como 4 mensagens enviadas.

**8. Colar print** (`Print Screen` / `Win+Shift+S`, depois `Ctrl+V` na sessão) (005):
- ✅ A imagem entra na conversa (não o caminho do arquivo, não texto vazio).

**9. Aba de terminal livre: `Ctrl+C` sem seleção** (005 — o que NÃO podia mudar):
- ✅ **Interrompe** o processo, como sempre foi. Rode um `ping -t 8.8.8.8` e mate
  com `Ctrl+C`.

**10. Fechamento da 007 — a lista de acesso rápido** (sem cota):
- ✅ **Colapsar** o grupo e **fechar o app**: ao reabrir, ele continua colapsado.
- ✅ Com o grupo **fechado**, o cabeçalho dele **acende** com o pior estado das
  sessões de dentro (se alguma está aguardando permissão, é isso que aparece).
- ✅ Uma sessão que está no grupo **não** aparece duplicada na lista geral
  "Sessões".
- ✅ Clicar numa linha cuja aba **já está aberta** apenas **foca** a aba (nunca
  abre a mesma sessão duas vezes); numa linha **sem** aba aberta, **retoma**.
- ✅ Fixe mais de 5 sessões: as fixadas aparecem **além** das 5 recentes.
- ✅ **Desfavoritar** o projeto some com o grupo e devolve as sessões à lista
  geral, **sem perder** as fixadas (refavorite para confirmar que voltam).

---

## O que ficou SEM validação humana neste roteiro, e por quê

- **§B19 (a bateria de testes valer em qualquer pasta)** — não tem nada para você
  clicar: é correção de TESTE, não de produto. A prova é mecânica e já foi feita
  rodando a bateria **nos dois lugares** (pasta principal e uma cópia de trabalho
  paralela descartável); os 5 testes que falhavam sempre na cópia passaram.
- **Cenários de falso positivo do T710** (cota estourada, `claude` fora do PATH,
  você fechando a aba nos primeiros segundos de uma retomada) — não dá para
  provocar de propósito sem estragar sua máquina ou esperar a cota virar. Estão
  cobertos por teste automatizado da regra e pela decisão de desenho: o app
  **confere o arquivo no disco** antes de esquecer, então uma falha que não seja
  "a sessão não existe mais" não apaga nada.
- **"2. No, exit" no diálogo de workspace do CLI** — o diálogo não reaparece
  depois de aceito uma vez, e não achei como forçá-lo de novo. Fica sem medição
  (registrado no §B21 do backlog).
- **Dois vermelhos conhecidos da bateria** (`previous-sessions.spec.ts` ×2, a
  dívida T013 de restauração de sessão) seguem vermelhos, com causa nomeada —
  não são regressão desta entrega e não afetam nada deste roteiro.
- **§B18 (primeira abertura na máquina de outra pessoa)** — fora de escopo por
  sua decisão de 26/07 ("é só mais pra frente, pode ignorar esse"); quem valida
  isso é o seu amigo abrindo a 0.1.0.
