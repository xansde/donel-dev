# Serviço Donel na VPS pessoal: instalação e passagem das contas

Desenho e decisões no [ADR 0008](adr/0008-contas-das-vps-sem-o-pc.md). Este
arquivo é o passo a passo do dono.

O serviço `donel-servico` roda na VPS pessoal por systemd e reinicia sozinho.
Ele troca a conta da **VPS pessoal** ("aqui") e de **Homologações** a 90%, com
o PC desligado. As VPS usam um **conjunto de contas próprio**, e o PC continua
com as dele, com preferência.

Regra de ouro: **uma conta, um conjunto.** A conta que vai para as VPS sai do
PC antes (ou no mesmo passo). Nunca rode `/logout`, porque ele revoga o token
no servidor.

## 0. Instalar (uma vez; a cada atualização, rode de novo)

Na VPS pessoal, num checkout de `staging`:

```bash
cd ~/seazone/"Donel Dev" && git fetch origin
git worktree add ../donel-wt/servico origin/staging 2>/dev/null || git -C ../donel-wt/servico checkout --detach origin/staging
cd ../donel-wt/servico && npm ci
sudo bash scripts/servico/instalar.sh
```

O script cria a chave do cofre uma vez, cifrada pelo systemd deste host
(`/etc/donel/vault-key.cred`). **Não apague esse arquivo**: sem ele, o cofre
fica ilegível e as contas precisam de login de novo. Para ver se o serviço está
de pé, use `systemctl status donel-servico` e `donel-servico estado`.

## 1. Liberar o ssh da VPS pessoal até Homologações (painel da Tailscale)

Hoje a política da tailnet recusa esse ssh, então o serviço não alcança
Homologações. No painel da Tailscale (Access controls), na regra `ssh`, permita
a origem `vps-alexandrelentz` no destino `vps-time-homologacoes`, como o
**mesmo usuário** que o PC usa hoje em Contas › Lugares (o `usuario@host` de
Homologações). A regra precisa ser `"action": "accept"`. Com `check`, a
Tailscale pede login no navegador, e o serviço não tem navegador.

Teste na VPS pessoal:

```bash
ssh -o BatchMode=yes <usuario>@vps-time-homologacoes 'node -v'
```

Depois cadastre o lugar no serviço:

```bash
donel-servico lugar definir homologacoes "Homologações" <usuario>@vps-time-homologacoes
```

## 2. Tirar as VPS do PC (o PC continua com as contas dele)

Hoje o PC controla os lugares das VPS. Se os dois motores mexerem no mesmo
lugar, um renova o token do outro. No PC:

1. Em Contas › Lugares, anote a conta de cada VPS (Homologações estava na
   Conta 8).
2. Feche **todos** os canais do Donel (Alfa, Beta e o estável usam os mesmos
   dados).
3. Faça uma cópia: `copy %APPDATA%\donel-dev\config.json %APPDATA%\donel-dev\config.json.bak-0611`.
4. Abra `config.json` e, dentro de `"accounts"`:
   - em `"remotes"`, apague as entradas das VPS (Homologações e a VPS pessoal);
   - em `"localAccounts"`, apague as entradas das contas que estavam nelas
     (pelo `id` anotado; o `label` ajuda a achar).
   Não mexa em mais nada.
5. Abra o Donel. A faxina da abertura tira do cofre do PC o par dessas contas.
   Em Contas, confira se as VPS sumiram dos lugares e se as contas do PC estão
   lá.

O app do PC não tem botão para isso: o painel bloqueia tirar um lugar que tem
conta, de propósito. Esse botão ("Entregar à VPS") é uma fatia seguinte.

## 3. Adotar as contas que já estão logadas nas VPS (sem login novo)

Na VPS pessoal:

```bash
donel-servico contas adotar homologacoes "Conta 8"
donel-servico contas adotar aqui "<rótulo da conta da VPS pessoal>"
```

O par vivo de cada lugar vai para o cofre da VPS, e o lugar fica com a conta.
Nenhum token passa pelo PC.

## 4. Dar contas de reserva para as VPS trocarem

Sem reserva, não há para onde trocar. Sugestão: as 7 contas que o PC marcou
"Reconectar" em 05/11 (Conta 1, 2, 3, 5, 7, Orca e Tech 89). No PC elas já
estão mortas, e logar de novo na VPS custa o mesmo que reconectar no PC. Para
cada uma:

1. **No PC:** Contas › a conta › Remover.
2. **Na VPS pessoal** (terminal do Donel na VPS):

   ```bash
   mkdir -m 700 ~/.donel/login-conta1
   CLAUDE_CONFIG_DIR=~/.donel/login-conta1 claude
   # dentro do claude: /login, abra o link, entre na Conta 1, cole o código; depois /exit (nunca /logout)
   donel-servico contas colher ~/.donel/login-conta1 "Conta 1"
   rm -rf ~/.donel/login-conta1
   ```

   O `colher` guarda o par no cofre e apaga o `.credentials.json` da pasta.

## 5. Conferir

```bash
donel-servico estado        # cada conta com carga, o lugar de cada uma, motor "ready"
tail ~/.donel/accounts-maintenance.log
journalctl -u donel-servico -n 50
```

A troca automática aparece no log como `remote-switch` (Homologações) ou
`auto-switch` (aqui). Uma conta de lugar com carga desconhecida por 10 minutos
gera `remote-blind-as-full` e é tratada como cheia.

Troca à mão: `donel-servico contas trocar homologacoes <id da conta>` (os ids
estão no `estado`).

## 6. Oráculo na VPS (migração: só depois da fatia 02b)

O serviço já hospeda um Oráculo vazio em `~/.donel/ledger.json`, com API em
`http://<ip tailscale da VPS>:47816`. **Ainda não migre.** Enquanto o app do PC
não for cliente dele (fatia 02b), o PC continuaria gravando no Oráculo dele, e
os dois se separariam. Quando a 02b entrar:

1. Na VPS: `donel-servico oraculo token`. O token aparece uma vez só, então
   guarde-o. Rodar de novo invalida o anterior.
2. No PC, feche o Donel e copie o Oráculo para a VPS:
   `scp %APPDATA%\donel-dev\ledger.json vps-alexandrelentz:~/.donel/importar-ledger.json`
   `scp -r %APPDATA%\donel-dev\ledger-provas vps-alexandrelentz:~/.donel/importar-provas`
3. Na VPS: `donel-servico oraculo importar ~/.donel/importar-ledger.json ~/.donel/importar-provas`.
   A importação recusa se alguma tarefa se perderia ou se faltar alguma prova.
   No fim, ela mostra quantas tarefas, eventos e provas entraram.
4. No PC, configure o cliente (passo da 02b) e abra o Donel. O `ledger.json`
   do PC fica como cópia e não é apagado.

## Desfazer

```bash
sudo systemctl disable --now donel-servico
```

No PC, feche o Donel, volte `config.json.bak-0611` para `config.json` e abra de
novo. As contas adotadas continuam logadas onde estavam. As contas colhidas na
VPS ficam no cofre da VPS (`~/.donel/accounts-vault.json`) até um novo login no
PC.
