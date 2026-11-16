# Sessões remotas: um ssh por lugar, não um por aba

**Data:** 16/11/2026 · **Tarefa:** t-9accc989, item 3 (era a t-1a7d4143; recomendação 5 da arquitetura-alvo)
**Código:** `src/main/remote-place-link.ts` · **Teste:** `tests/ssh-ligacao-por-lugar.test.ts`

## Problema

Em 15/11 o app do PC abriu cerca de 320 ssh para a Homologações em 10 minutos (t-f0fb2f2e, t-eb9a736a). Cada aba
remota segurava um `ssh -t -R … run.sh` próprio enquanto vivia. Quando o lugar engasgava, todas caíam juntas e
voltavam juntas. O #441 (ssh-gate, 6 logins por lugar ao mesmo tempo) limita a rajada, mas o número de ssh vivos
continuava sendo um por aba, mais um do espelho de transcript.

## Por que não o ControlMaster

O caminho natural seria a multiplexação do próprio OpenSSH (`ControlMaster`/`ControlPersist`). Ela não existe no
ssh do Windows (Win32-OpenSSH): o mestre entrega a cada cliente os descritores do terminal por um socket unix
(`SCM_RIGHTS`), e o Windows não tem isso. O ssh do Git for Windows (MSYS) cai no mesmo limite. A biblioteca `ssh2`
(ssh em JavaScript) multiplexaria de verdade, mas o app teria de ler a chave ssh do dono, e o CLAUDE.md proíbe o app
de tocar credencial fora de `accounts/` e `proxies/`.

Não foi testado no PC: a VPS não alcança o PC por ssh. A escolha abaixo não depende dessa verificação, porque
funciona com o ssh de qualquer sistema.

## Paliativo (este PR): a ligação do lugar

O mesmo molde do espelho de transcript (`remote-mirror.ts`, 13/11), que já roda no Windows:

- **Um ssh por lugar** (`ssh … -T -- <alvo> bash -l -s`). A primeira linha do stdin confere o python3 e sobe um
  multiplexador pequeno no lugar. O script vai pelo stdin, nunca no argv do `ssh.exe`.
- **Cada aba é um canal** dessa ligação. O lugar abre um pty (`pty.fork`), roda nele o mesmo comando que o ssh da aba
  rodava (`bash -l …/run.sh`, que entra no tmux) e troca quadros com o app: saída, entrada, tamanho e fim. O tamanho
  vai por `TIOCSWINSZ`, e o tmux recebe o `SIGWINCH`.
- **Túneis reversos por canal**: o lugar escuta a porta remota do hook e a do MCP enquanto o canal vive; cada conexão
  vira quadros até a porta local do app. Porta ocupada encerra o canal com 255, como o `ExitOnForwardFailure`.
- **A ligação que cai encerra cada aba com 255**, o código de um ssh que caiu. Por isso o supervisor de religação
  (`remote-link.ts`), a semáforo, o chat e o resto não veem diferença: a aba fica "sem ligação", o app pergunta ao
  lugar e religa, agora num canal de uma ligação nova (um login para todas as abas, não um por aba).
- **Fechar a aba** pede ao lugar para desligar o terminal (`SIGHUP`, o mesmo que o ssh caindo); o tmux segue vivo e o
  fim da sessão continua sendo o script de fim, como antes.
- **Sem aba**, a ligação fecha depois de 30 s.

Resultado: **2 ssh longos por lugar** (a ligação e o espelho), com qualquer número de abas. Os scripts curtos
(preparo, sonda, fim, descoberta, renovação) seguem como ssh próprios, passando pelo ssh-gate.

## Volta

- **Automática, por lugar**: sem python3 (saída 127), ou 2 tentativas seguidas que não sobem em 20 s, e o lugar fica
  10 minutos fora da ligação. Nesse tempo as abas dele abrem o ssh próprio, como antes. As abas que estavam na ligação
  saem com 255 e o supervisor as religa já pelo ssh próprio.
- **Manual, para todos os lugares**: `DONEL_SSH_LINK=off` no ambiente do app. Desliga a ligação sem build novo.
- **De código**: reverter o PR. O desenho antigo continua inteiro no código (é a volta automática).

## Riscos

| Risco | O que acontece | Mitigação |
|---|---|---|
| A ligação cai | Todas as abas do lugar ficam "sem ligação" juntas (antes caíam juntas também, cada uma pelo seu ssh) | Religação já existente; um login religa todas |
| Multiplexador trava | As abas do lugar param de responder | Sem bloqueio no laço: toda escrita é não bloqueante, com fila própria por destino |
| Diferença de ambiente do pty | O CLI lá roda num pty aberto pelo python, não pelo sshd | Mesmo login (`bash -l`), `TERM=xterm-256color`, `SSH_TTY` e `SSH_CONNECTION` presentes; `TMUX` limpo |
| App antigo e novo no mesmo lugar | Canal alfa usa a ligação, beta usa ssh por aba | Os dois escrevem no mesmo tmux; portas remotas são sorteadas por sessão |
| Porta remota presa pelo sshd antigo | O canal sai com 255 e o app tenta de novo | O mesmo laço de antes, até o sshd soltar a porta |

## Alvo: a sessão vive no tmux do lugar e o PC conecta sob demanda

1. **Nada aberto por aba quando ninguém olha.** O chat lê o transcript pelo espelho e escreve pela ligação, sem
   terminal. O terminal de uma aba só abre canal quando o dono abre a aba (ou o Jobu precisa da tela); fecha quando
   ela sai da vista por um tempo.
2. **Um túnel por lugar para hooks e MCP**, roteado por token (a ponte e o MCP já reconhecem a sessão pelo token),
   em vez de duas portas sorteadas por aba. A ligação escuta uma porta só no lugar.
3. **Scripts pela ligação.** Preparo, sonda, fim, descoberta e renovação viram canais sem pty: zero login extra. A
   rajada de sondas de uma queda vira uma pergunta só.
4. **O espelho entra na ligação.** O mesmo multiplexador segue os transcripts: um ssh por lugar, ponto.
5. **Depois, sem o PC no caminho.** Quando o núcleo servidor (item 11) e o celular forem a tela, quem conecta sob
   demanda é o servidor central, com o mesmo protocolo. O tmux do lugar continua sendo o dono da sessão.

Cada passo é pequeno e tem a mesma volta: o lugar que falha cai para o caminho anterior.

## Prova (roteiro)

No sshd da Homologações, com o app do PC aberto e as abas remotas de sempre:

1. **Antes** (alfa atual, antes de instalar o novo): por 10 minutos,
   `journalctl -u ssh --since "-10min" | grep -c "Accepted"` (logins) e
   `ss -tnp state established '( sport = :22 or sport = :2222 )' | grep -c 100.76.108.30` (conexões vivas vindas do
   PC, IP do seazone173 na tailnet). Anotar também o número de abas remotas abertas na Homologações.
2. Instalar o alfa novo (na hora do dono).
3. **Depois**: o mesmo par de comandos, com as mesmas abas. Esperado: conexões vivas do PC = 2 (ligação + espelho),
   qualquer que seja o número de abas; logins em 10 minutos só os dos scripts curtos.
4. No PC, `Get-Process ssh | Measure-Object` antes e depois dá a mesma conta do lado de cá.
