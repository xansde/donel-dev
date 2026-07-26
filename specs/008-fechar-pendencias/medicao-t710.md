# Medição T710 — o que o CLI faz quando a retomada falha

**Quando:** 2026-07-26 · **CLI:** `claude` 2.1.220 (Claude Code), em
`C:\Users\xansd\.local\bin\claude.exe` · **Máquina:** a do Alexandre, Windows 11.

Investigação **obrigatória** do plano da 008: o T710 ficou de fora da 007
justamente porque exigiria "inventar o texto de erro do CLI para sessão
inválida, não verificado contra o binário real". Aqui está o dado real.

Sonda: `node-pty` (o MESMO mecanismo de spawn do app —
`PtyManager.create`: `name: 'xterm-color'`, `cols/rows`, `cwd` do projeto, env
herdado), carregado do `node_modules` do próprio repo. Script em
`scratchpad/pty-probe2.js` (descartável, não versionado). Nenhum turno de API
foi consumido em nenhuma das medições.

## Achado 1 — sem TTY o exit code NÃO distingue nada (por isso a sonda é PTY)

Rodado direto no shell (stdout redirecionado, `stdin` fechado):

| Caso | exit | tempo | stderr |
|---|---|---|---|
| `-r <uuid inexistente>` | **1** | 4,8 s | `No conversation found with session ID: …` |
| `-r nao-e-uuid` | **1** | 4,1 s | `Error: --resume requires a valid session ID or session title when used with --print. …` |
| `-r <uuid VÁLIDO>` | **1** | 34,6 s | `Error: No deferred tool marker found in the resumed session. …` |

Sem TTY o CLI cai no modo `--print`, e **até a sessão válida sai com 1**. Medir
fora do PTY teria produzido a conclusão errada ("exit code não serve").

## Achado 2 — no PTY, exit code 1 é o contrato da retomada inválida

`claude -r 00000000-0000-4000-8000-000000000000` em
`C:\Users\xansd\seazone\donel-dev`, três execuções limpas:

| # | exit | mensagem aparece em | processo sai em |
|---|---|---|---|
| 1 | **1** | 6.283 ms | **8.611 ms** |
| 2 | **1** | 7.275 ms | **10.449 ms** |
| 3 | **1** | 6.152 ms | **8.517 ms** |

Texto impresso, idêntico nas três (ANSI stripado):

```
No conversation found with session ID: 00000000-0000-4000-8000-000000000000
```

O processo **sai sozinho** ~2,3 s depois de imprimir. Reproduziu 3/3, sem flake.

## Achado 3 — grupo de controle: o que NÃO deve disparar

| Caso (PTY, mesmo cwd) | Resultado |
|---|---|
| `-r <uuid VÁLIDO>` (sessão real do repo) | **VIVO** aos 40 s — nenhum `onExit` |
| `--session-id <uuid novo>` (sessão nova, o caminho normal do app) | **VIVO** aos 40 s — nenhum `onExit` |

Ou seja: dentro do PTY, "exit != 0 pouco depois do spawn" separa a retomada
inválida do funcionamento normal. **A hipótese do prompt está CONFIRMADA** — e
o parse do texto é dispensável.

## Achado 4 (não previsto) — o diálogo de workspace do CLI 2.1.220 vem ANTES

Na primeiríssima sonda, o CLI não chegou a validar o `-r`: parou num diálogo
que **não existia** nas medições anteriores deste projeto (feitas na 2.1.219):

```
Accessing workspace: C:\Users\xansd\seazone\donel-dev
Quick safety check: Is this a project you created or one you trust? …
❯ 1. Yes, I trust this folder   2. No, exit
```

Com o diálogo na frente, o processo fica **VIVO** (25 s, 40 s) e nunca sai —
nenhum exit code chega. Depois de responder "1" uma vez, ele não voltou a
aparecer em nenhuma execução seguinte, e o `-r` inválido passou a sair em ~8,5 s
como na tabela do Achado 2.

Consequência (registrada no backlog como **§B21**): é **condição de contorno do
sinal** — aba que nasce num workspace ainda não confiado não produz `onExit`
nenhum. Não é falso positivo (nada é esquecido), é ausência de sinal: o usuário
responde o diálogo e a retomada segue (ou falha, e aí o sinal chega).

> **Correção do que este achado dizia antes (medido depois, na verificação do
> §B19):** a primeira redação afirmava que "toda worktree nova é um workspace
> novo, então qualquer smoke que suba `claude` de lá pode travar nesse diálogo".
> **Refutado por medição:** numa worktree recém-criada
> (`donel-dev-wt-check`), o CLI **não** mostrou o diálogo — foi direto para
> `No conversation found` (mensagem em 4.930 ms, exit 1 em 7.319 ms). Ou seja, a
> aceitação não é por pasta; pelo que se observou, aceitar uma vez bastou para as
> pastas irmãs. Qual é a chave exata (repo, `~/seazone`, uma vez por versão do
> CLI) **não foi determinado** — só o comportamento observado está registrado.
> Não é precondição de rodar a suíte em worktree, como a versão anterior deste
> arquivo (e do `plan.md`) afirmava.

Também não foi possível medir o caso "usuário responde **2. No, exit**" — o
diálogo não reaparece depois de aceito. Fica **sem medição**; é um dos motivos
de o desenho não confiar só no exit code (ver abaixo).

## Decisão de desenho que este dado sustenta

Sinal de gatilho (contrato, não texto): **aba que nasceu com `-r <id>` +
`PtyManager.onExit` com `exitCode != 0` dentro de uma janela curta após o
spawn**.

Prova antes de apagar (é o que mata o falso positivo): o main confere se o
`.jsonl` daquela sessão existe no disco e **só remove se não existir** — que é
literalmente a definição do CA-11 ("entrada cujo `.jsonl` não existe mais").
Assim, cenários que também saem com código != 0 mas cuja sessão existe (cota
estourada, `claude` não encontrado, diálogo recusado, Ctrl+C precoce) não
apagam nada. O texto do CLI nunca é parseado.
