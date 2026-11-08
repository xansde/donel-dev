# Proxy de saída no PC do dono: as VPS falam com a Anthropic pelo IP de casa

Decisão do dono (06/11), literal:

> "Vamos instalar o Proxy na minha máquina, assim terei mais controle e não dependerei do Bill. As VPSs vão
> usar esses proxys"

A pesquisa que pesou os riscos está em `Donel Dev Alfa - diario\proxy-vps\proxy-nas-vps.html` (opção "c").
O dono pesou e decidiu; este documento é só a operação.

> **Mudança de 08/11 (dono: "não pode deixar o proxy sair no IP da VPS. Se não algumas ferramentas minhas caem"):**
> a queda `direto` acabou. Sem o PC, o relay recusa Anthropic/Claude (503) e grava o aviso; a lista nunca sai pelo
> IP da nuvem. Uma `vps.json` antiga com `"queda": "direto"` sobe parando, com `queda-direto-ignorada` no log. O
> `proxy-saida.env` liga o proxy sempre (antes, só se o relay estivesse de pé na hora). Onde este texto fala em
> "cai para o direto", leia "para". Plano: `docs/planos/orquestradora-na-vps.md`.

## Como ficou

```
sessão do Claude na VPS ──HTTPS_PROXY──▶ relay 127.0.0.1:3128 ──┬─ Anthropic/Claude ─▶ proxy do PC (100.76.108.30:3128, Tailscale) ─▶ IP de casa
                                                               ├─ resto (git, npm, MCP...) ─▶ direto, IP da nuvem
                                                               └─ PC fora ─▶ para (503) + aviso no log; nunca direto (08/11)
```

- **Um arquivo**, `scripts/proxy-saida/proxy-saida.mjs`, Node puro, sem dependência. A config diz o modo.
- **PC** (`modo: "pc"`): proxy HTTP CONNECT. Escuta só no IP da Tailscale (recusa subir em 0.0.0.0, na rede de
  casa ou em loopback), aceita só clientes 100.64.0.0/10, exige usuário e senha (a config guarda só o hash
  scrypt), abre túnel só para a porta 443 de `anthropic.com`, `claude.ai`, `claude.com`,
  `http-intake.logs.us5.datadoghq.com` (telemetria do CLI) e `api.ipify.org` (para conferir o IP), com os
  subdomínios. Grava uma linha por conexão: hora, cliente, destino, decisão, bytes, duração. Nunca conteúdo.
- **VPS** (`modo: "vps"`): relay em 127.0.0.1:3128, sem senha (só a própria máquina alcança). Destinos da lista
  vão para o PC; o resto sai direto, para não quebrar git, npm e MCP das sessões. Se o PC não atende em 4 s,
  marca a queda, grava o aviso e passa a mandar a lista direto (`queda: "direto"`, padrão) ou a recusar
  (`queda: "parar"`); testa o PC a cada 15 s e volta sozinho, gravando a volta.
- **Lista medida** em 06/11 com `claude -p` (2.1.318) apontado direto para o proxy: `api.anthropic.com`,
  `mcp-proxy.anthropic.com` e `http-intake.logs.us5.datadoghq.com`. Os MCP das sessões (`mcp-sia*.seazone.com.br`,
  `hub.seazone.dev`, `mcp.supabase.com`) ficaram de fora: não são do Claude Code e saem direto pelo relay.

### O que está instalado agora

| Onde | O quê | Quem usa o proxy |
|---|---|---|
| PC (seazone173) | `%APPDATA%\donel-dev\proxy-saida\` (proxy, `pc.json`, `senha.dpapi`, `conexoes.log`, `iniciar.vbs`) + tarefa agendada **Donel Proxy de Saida** (no logon, sem janela; repete a cada 5 min e sobe de novo se o node tiver morrido) | — |
| `root@vps-time-homologacoes` | relay `donel-proxy-saida.service`, `~/.donel/proxy-saida.env`, drop-in do `donel-servico`, `tmux -L donel setenv -g` | **só sessões novas.** As vivas (Jornada, Revisor, Dev...) seguem saindo direto, sem nada mudado nelas. O `settings.json` do root **não** foi tocado. |
| `alexandrelentz@vps-alexandrelentz` | o mesmo + `env` no `~/.claude/settings.json` | todo Claude da VPS (não havia sessão ativa) |

Por que homologações ficou só com as sessões novas: o Claude Code relê o `env` do `~/.claude/settings.json` com
a sessão rodando (medido em 06/11: `!echo $VAR` muda sem reiniciar), então pôr lá mexeria nas sessões vivas.
Em vez disso:

1. `~/.donel/proxy-saida.env`, lido pelo `claude.sh` que o app gera para cada sessão remota (mudança deste PR
   em `src/main/remote-session.ts`). Só vale depois que o alfa com este PR estiver instalado no PC.
2. Até lá, o servidor tmux do Donel na VPS (`tmux -L donel`) recebeu o proxy no ambiente global: toda sessão
   que ele criar daqui em diante já nasce com o proxy. Conferido: uma sessão de teste nasceu com
   `HTTPS_PROXY=http://127.0.0.1:3128`, e nenhum dos 6 `claude` vivos tem a variável. Se o servidor tmux
   reiniciar antes do alfa novo, isso se perde (rode o `instalar-vps.ps1` de novo).
3. Quando não houver sessão ativa lá, se quiser cobrir também o Claude que não nasce pelo Donel (OpenRig, um
   `claude` à mão): `instalar-vps.ps1 -Destino root@vps-time-homologacoes -Settings`.

### O motor de contas

- **PC** (hoje quem troca as contas das VPS): já sai pelo IP de casa. Nada muda.
- **Motor por VPS** (ADR 0009, PR #248, ainda não mesclado nem instalado): o instalador já deixou
  `/etc/systemd/system/donel-servico.service.d/proxy-saida.conf` com `HTTPS_PROXY`, `NO_PROXY` e
  `NODE_USE_ENV_PROXY=1` (sem este último o `fetch` do Node ignora o proxy). Quando o `donel-servico` for
  instalado, ele já nasce saindo pelo mesmo caminho do CLI: uma conta, um IP. Nada a fazer no PR #248.

## Instalar

No PC, de um checkout do repositório (pede só o usuário comum, sem admin):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-pc.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-vps.ps1 -Destino root@vps-time-homologacoes
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-vps.ps1 -Destino alexandrelentz@vps-alexandrelentz -Settings
```

- A senha é gerada uma vez e fica em `senha.dpapi` (DPAPI: só este usuário do Windows lê). Nunca é impressa.
  Vai para a VPS só pelo stdin do ssh, para `~/.config/donel-proxy-saida/vps.json` (modo 600).
- `-Queda parar` faz a VPS parar o Claude em vez de sair direto quando o PC some.
- Reinstalar é seguro e idempotente. `instalar-pc.ps1 -NovaSenha` troca a senha (reinstale as VPS depois).
- **Bitwarden (pendente):** o cofre está trancado e a skill `bitwarden-save` não existe nesta máquina. O
  dono roda uma vez, no PowerShell:

  ```powershell
  $env:BW_SESSION = bw unlock --raw
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-pc.ps1 -SoBitwarden
  ```

  Cria (ou atualiza) o item **Donel proxy de saida (PC)**, usuário `donel-vps`.

## Conferir

```bash
# de qualquer VPS
curl -s https://api.ipify.org                              # IP da nuvem
curl -s -x http://127.0.0.1:3128 https://api.ipify.org     # IP de casa (189.4.75.55 em 06/11)
cat ~/.donel/proxy-saida.estado.json                       # {"estado":"proxy"|"direto"|"parado", "desde", "motivo"}
tail ~/.donel/proxy-saida.log                              # "proxy-caiu" / "proxy-voltou", uma linha cada
systemctl status donel-proxy-saida --no-pager
```

```powershell
# no PC
Get-Content "$env:APPDATA\donel-dev\proxy-saida\conexoes.log" -Tail 20
Get-NetTCPConnection -State Listen -LocalPort 3128          # só 100.76.108.30
Get-ScheduledTask -TaskName 'Donel Proxy de Saida'
```

O aviso de queda é a linha `"evento":"proxy-caiu"` em `~/.donel/proxy-saida.log` (também no journal da
unidade). O estado corrente fica em `~/.donel/proxy-saida.estado.json`: é o que um vigia lê para avisar.
Ainda não existe vigia que leia (a "faixa marrom" é do fim de semana); o Oráculo mora no PC, que é justo quem
está fora quando a VPS cai.

## Desfazer

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-vps.ps1 -Destino root@vps-time-homologacoes -Desinstalar
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-vps.ps1 -Destino alexandrelentz@vps-alexandrelentz -Desinstalar
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\desinstalar-pc.ps1          # -Apagar leva a pasta junto
```

Na VPS, o desinstalar tira o relay, a unidade, o drop-in, o `.env`, a config com a senha, o proxy do tmux
do Donel e do `settings.json` (só as chaves que o instalador pôs). O log fica. Sessões que nasceram com o
proxy perdem a rede quando o relay sai: rode sem sessão ativa ou reabra-as. Testado na VPS pessoal em
06/11 (desinstalou, saiu direto pela Azure, reinstalou).

## Provas (06/11/2026, 13:42–13:48)

```
### 1. IP de saída e lista
IP público da casa (curl no PC, sem proxy): 189.4.75.55
== root@vps-time-homologacoes
  direto, sem proxy:            20.114.48.171
  pelo proxy (relay local):     189.4.75.55
  no proxy do PC, com senha:    CONNECT=200 HTTP=404
  fora da lista (github.com):   CONNECT=403 (recusado)
  fora da lista (example.com):  CONNECT=403 (recusado)
  senha errada:                 CONNECT=407 (recusado)
== alexandrelentz@vps-alexandrelentz
  direto, sem proxy:            20.59.28.197
  pelo proxy (relay local):     189.4.75.55
  no proxy do PC, com senha:    CONNECT=200 HTTP=404
  fora da lista (github.com):   CONNECT=403 (recusado)
  fora da lista (example.com):  CONNECT=403 (recusado)
  senha errada:                 CONNECT=407 (recusado)

### 2. claude -p na VPS, pelo proxy
== root@vps-time-homologacoes (env do Donel: . ~/.donel/proxy-saida.env)
  HTTPS_PROXY=http://127.0.0.1:3128
  resposta: ok
  rc=0
== alexandrelentz@vps-alexandrelentz (env do ~/.claude/settings.json)
  resposta: You've hit your weekly limit · resets Nov 10, 5am (America/Sao_Paulo)
  rc=1

### 3. Fora da Tailscale (no PC)
  porta 3128 escuta em: 100.76.108.30
  rede de casa/loopback 192.168.0.58:3128 -> curl rc=7 (conexão recusada)
  rede de casa/loopback 127.0.0.1:3128 -> curl rc=7 (conexão recusada)

### 4. Proxy do PC parado e de volta (VPS de homologação, queda=direto)
  13:47:17 parando o proxy do PC... escutando? False
  saída pelo relay:  20.114.48.171
  claude -p:         ok (rc=0)
  aviso no log:      {"ts":"2026-11-06T16:47:36.087Z","evento":"proxy-caiu","motivo":"ETIMEDOUT","caminho":"direto (IP da nuvem)","aviso":"Proxy do PC fora; o Claude desta VPS está saindo direto, pelo IP da nuvem, até o PC voltar."}
  estado:            {"estado":"direto","desde":"2026-11-06T16:47:36.087Z","motivo":"ETIMEDOUT","queda":"direto"}
  13:47:40 subindo o proxy do PC...
  volta no log:      {"ts":"2026-11-06T16:48:12.068Z","evento":"proxy-voltou","caminho":"proxy do PC"}
  estado:            {"estado":"proxy","desde":"2026-11-06T16:48:12.068Z","queda":"direto"}
  saída pelo relay:  189.4.75.55
  claude -p:         ok (rc=0)

### 5. queda=parar (VPS pessoal, 13:37)
  anthropic com PC parado: CONNECT=503 (recusado, sem sair direto)
  github com PC parado:    HTTP=200 (fora da lista segue direto)
  {"evento":"proxy-caiu","motivo":"ETIMEDOUT","caminho":"parado ..."}
  de volta: 189.4.75.55 · {"evento":"proxy-voltou"}
```

A conta da VPS pessoal está no limite semanal (volta 10/11, 05:00): o pedido chegou à Anthropic pelo proxy
e a resposta foi a recusa por limite. Não troquei conta (fora do escopo).

## Pontos de atenção

- **PC desligado, dormindo ou antes do logon**: as VPS saem direto (ou param, com `queda=parar`) e voltam
  sozinhas. A tarefa sobe no logon, não no boot: subir antes do logon pediria admin.
- **IP de casa é residencial**: se a operadora trocar, o proxy segue funcionando (a saída acompanha).
- **Do PC, o Cloudflare às vezes demora** (medido: `api.ipify.org` de 0,5 s a 7,5 s, com e sem proxy). Por
  isso o relay só declara o PC fora se ele não atende em 4 s; um destino lento (502 do PC) faz o relay testar
  a Anthropic pelo PC antes de cair.
- **A senha do PC é conferida com scrypt uma vez** e o cabeçalho aceito fica em memória: sem isso, as ~10
  conexões que o CLI abre juntas travavam o proxy e o relay caía à toa (aconteceu no primeiro teste).
- **Firewall do Windows**: a regra "Tailscale-In" (perfis Domínio e Privado), que o instalador da Tailscale
  põe, já deixa a rede da Tailscale entrar; a rede de casa (Wi-Fi, perfil Público) não chega porque o proxy
  nem escuta nela.
