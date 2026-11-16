# [t-16393812] Instalar o coletor de saúde no PC

Para a sessão Dev que roda **no PC** (não para o dono). Tempo: ~3 min. Nada aqui pede senha, admin nem o dono.

## O que é
Um processo `saude-coletor.exe` (C#, compilado no próprio PC com o `csc` do .NET Framework que vem no Windows) que roda
oculto numa tarefa agendada (`DonelSaudeColetor`). A cada minuto mede CPU, RAM, arquivo de paginação, disco, rede, carga
equivalente e nº de processos `claude.exe`, e manda a linha por ssh à VPS pessoal (`saude_receber.sh pc`), que grava no
Supabase. Sem janela, alvo < 50 MB de RAM. Se a VPS não responder, guarda em `%LOCALAPPDATA%\donel-saude\pendente.jsonl`
(até 3 dias) e manda depois.

## Arquivos
Pasta `scripts/saude/pc/` do repo Donel Dev (branch `feat/saude-das-maquinas`, PR para `staging`):
`saude-coletor.cs` e `instalar-saude-pc.ps1`. Se a branch ainda não estiver no PC, copie os dois da VPS:
```
scp alexandrelentz@100.110.135.26:"'/home/alexandrelentz/seazone/Donel Dev/.claude/worktrees/dev-saude-das-maquinas-1116-1709/scripts/saude/pc/saude-coletor.cs'" .
scp alexandrelentz@100.110.135.26:"'/home/alexandrelentz/seazone/Donel Dev/.claude/worktrees/dev-saude-das-maquinas-1116-1709/scripts/saude/pc/instalar-saude-pc.ps1'" .
```
(Os dois ficam na mesma pasta; o instalador compila o `.cs` que está ao lado dele.)

## Instalar (um comando)
```
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar-saude-pc.ps1
```
Ele: (1) compila; (2) acha a chave ssh que já entra na VPS (a da tarefa `DonelEspelhoLedger`, a do `~/.ssh/config` ou
qualquer chave de `~/.ssh`) — se quiser forçar: `-Chave C:\caminho\da\chave`; (3) tira uma amostra de teste e a manda
à VPS; (4) registra e inicia a tarefa oculta (no logon e a cada 5 min, sem duplicar); (5) espera 75 s e mostra a RAM
do processo e o log.

## Conferir
- Passo 3 mostra uma linha JSON com `"maquina":"pc"` e `Envio de teste: ok 1`.
- Passo 5: `RAM do coletor` abaixo de 50 MB, `processos: 1`, `janela: nenhuma`, e o log com `enviado 1 linha(s): ok 1`.
- Nenhuma janela aparece a cada minuto (o ssh roda com `CreateNoWindow`). Se piscar alguma, diga.

## Se der erro
- Compilação: mande as linhas de erro do `csc` inteiras (arquivo e linha). Não corrija no PC: o Dev da VPS corrige no repo.
- `nenhuma chave ssh entrou`: diga qual chave a tarefa `DonelEspelhoLedger` usa (só o caminho) e rode de novo com `-Chave`.

## Desinstalar
```
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar-saude-pc.ps1 -Desinstalar
```

## O que responder ao Líder do quadro
A saída inteira do instalador (não tem segredo: o caminho da chave aparece, a chave não). Depois disso, a sessão pode fechar.
